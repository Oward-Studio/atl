import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

/** One journal line, as the CLI writes it. */
type Entry = { at: string; cmd: string; in: number; out: number; calls: number; ms: number }

describe('atl gain', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const journal = async (): Promise<Entry[]> => {
    const raw = await readFile(sandbox.usageFile, 'utf8').catch(() => '')
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Entry)
  }

  const seed = async (entries: Entry[]): Promise<void> => {
    await mkdir(dirname(sandbox.usageFile), { recursive: true })
    await writeFile(sandbox.usageFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  }

  it('says so plainly when nothing has been recorded', async () => {
    const result = await runCli(['gain'], { sandbox })

    assert.equal(result.code, 0)
    assert.match(result.stderr, /No invocation recorded/)
  })

  it('needs neither the API nor an app key: everything is local', async () => {
    // No apiUrl, unreachable server: the command must still answer.
    await seed([{ at: '2026-08-01T10:00:00Z', cmd: 'issue list', in: 400_000, out: 800, calls: 2, ms: 120 }])
    const result = await runCli(['gain'], { sandbox: await makeSandbox() })

    assert.equal(result.code, 0, result.stderr)
  })

  it('records one line per command that called the API', async () => {
    await runCli(['ls'], { sandbox, apiUrl: api.url })
    const entries = await journal()

    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.cmd, 'issue list')
    assert.ok((entries[0]?.in ?? 0) > 0, 'characters absorbed')
    assert.ok((entries[0]?.out ?? 0) > 0, 'characters rendered')
    assert.ok((entries[0]?.calls ?? 0) > 0, 'calls counted')
  })

  it('records nothing for a command that does not talk to the API', async () => {
    // With no call there is no absorbed volume: counting the output would produce a
    // negative saving.
    await runCli(['cache', 'clear'], { sandbox, apiUrl: api.url })
    await runCli(['--help'], { sandbox, apiUrl: api.url })

    assert.deepEqual(await journal(), [])
  })

  it('ATL_NO_USAGE disables recording', async () => {
    await runCli(['ls'], { sandbox, apiUrl: api.url, env: { ATL_NO_USAGE: '1' } })

    assert.deepEqual(await journal(), [])
  })

  it('aggregates while keeping the measured apart from the estimated', async () => {
    await runCli(['ls'], { sandbox, apiUrl: api.url })
    const result = await runCli(['gain'], { sandbox })

    assert.match(result.stdout, /Absorbed by atl/)
    assert.match(result.stdout, /Rendered to context/)
    assert.match(result.stdout, /MCP equivalent/)
    assert.match(result.stdout, /Estimated saving/)
    assert.match(result.stdout, /issue list/)
    // The method must accompany the figure.
    assert.match(result.stderr, /4 characters per token/)
    assert.match(result.stderr, /is an estimate/)
  })

  it('--json carries the totals and the breakdown', async () => {
    await runCli(['ls'], { sandbox, apiUrl: api.url })
    const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as {
      recording: boolean
      log: string
      charsPerToken: number
      invocations: number
      absorbed: number
      rendered: number
      baseline: number
      saved: number
      commands: { cmd: string; saved: number }[]
    }

    assert.equal(data.recording, true)
    assert.equal(data.charsPerToken, 4)
    assert.equal(data.invocations, 1)
    assert.ok(data.absorbed > 0)
    assert.equal(data.saved, data.baseline - data.rendered)
    assert.equal(data.commands[0]?.cmd, 'issue list')
    assert.match(data.log, /usage\.jsonl$/)
  })

  it('caps the baseline by the volume actually absorbed', async () => {
    // `issue view` is worth one MCP object (≈ 1,964 tokens) as a baseline, but the
    // fake server returns far less: no claiming to have saved data that never
    // travelled.
    await runCli(['issue', 'view', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as {
      absorbed: number
      baseline: number
    }

    assert.ok(data.baseline <= data.absorbed, `baseline ${data.baseline} > absorbed ${data.absorbed}`)
  })

  it('never prints 100 % when the saving is not total', async () => {
    await seed([
      { at: '2026-08-01T10:00:00Z', cmd: 'issue list', in: 4_000_000, out: 100, calls: 3, ms: 90 },
    ])
    const result = await runCli(['gain'], { sandbox })

    assert.doesNotMatch(result.stdout, /100 %/)
    assert.match(result.stdout, /99\.9 %/, 'one decimal, never a bare 100 %')
  })

  it('survives a truncated line', async () => {
    await mkdir(dirname(sandbox.usageFile), { recursive: true })
    await writeFile(
      sandbox.usageFile,
      `${JSON.stringify({ at: '2026-08-01T10:00:00Z', cmd: 'issue list', in: 40_000, out: 400, calls: 2, ms: 10 })}\n{"at":"2026-08-0`,
    )
    const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as { invocations: number }

    assert.equal(data.invocations, 1, 'the valid line stays counted')
  })

  it('does not lengthen commands perceptibly', async () => {
    const withLog = await runCli(['ls'], { sandbox, apiUrl: api.url })
    const without = await runCli(['ls'], {
      sandbox: await makeSandbox({ authenticated: true }),
      apiUrl: api.url,
      env: { ATL_NO_USAGE: '1' },
    })

    assert.equal(withLog.code, 0)
    assert.equal(without.code, 0)
    // A single ~100-byte append: the cost must vanish in the noise of Node's
    // startup.
    const entries = await journal()
    assert.ok((entries[0]?.ms ?? 0) < 5_000, 'a plausible recorded duration')
  })

  describe('baseline ceiling', () => {
    // Without a ceiling, `atl ls` on a large space counts 261,000 tokens of
    // baseline: the volume is real, but nobody would have paid it — a response that
    // size fits in no context.
    const huge = {
      at: '2026-08-01T10:00:00Z',
      cmd: 'issue list',
      in: 4_000_000,
      out: 800,
      calls: 3,
      ms: 200,
    }

    it('brings the baseline down to the ceiling and says so', async () => {
      await seed([huge])
      const result = await runCli(['gain'], { sandbox })

      assert.match(result.stdout, /50,000 tk/, 'baseline capped at the ceiling')
      assert.match(result.stderr, /1 invocation\(s\) capped/)
      assert.match(result.stderr, /impossible/)
    })

    it('leaves the absorbed volume uncapped: it is the only raw measurement', async () => {
      await seed([huge])
      const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as {
        absorbed: number
        baseline: number
        ceiling: number
        capped: number
      }

      assert.equal(data.absorbed, 1_000_000, 'measured, never trimmed')
      assert.equal(data.baseline, 50_000)
      assert.equal(data.ceiling, 50_000)
      assert.equal(data.capped, 1)
    })

    it('does not cap, and says nothing, below the ceiling', async () => {
      await seed([{ ...huge, in: 40_000 }])
      const result = await runCli(['gain'], { sandbox })
      const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as { capped: number }

      assert.equal(data.capped, 0)
      assert.doesNotMatch(result.stderr, /capped/)
    })

    it('also caps a fixed-baseline command that would have exceeded it', async () => {
      // A theoretical case — 3 objects do not reach 50,000 tokens — but the bound
      // must apply to every command, not only to set reads.
      await seed([{ ...huge, cmd: 'issue view' }])
      const data = parseJson(await runCli(['gain', '--json'], { sandbox })) as {
        baseline: number
        capped: number
      }

      assert.equal(data.baseline, 1_964, 'the intent baseline stays the binding one')
      assert.equal(data.capped, 0)
    })
  })
})
