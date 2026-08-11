import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type StatsJson = {
  name: string
  stored: number | null
  computed: number
  changed: boolean
  written: boolean
  dryRun: boolean
  done: number
  denominator: number
  total: number
  excluded: { backlog: number; canceled: number }
}

describe('atl project stats', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const stats = async (args: readonly string[]): Promise<StatsJson> => {
    const result = await runCli(['project', 'stats', ...args, '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as StatsJson
  }

  const stored = (name: string): unknown =>
    api.state.projects
      .find((p) => p.name === name)
      ?.properties.find((p) => p.key === 'progress')?.['number']

  it('applies the documented formula: done / (total − backlog − cancelled)', async () => {
    const result = await stats(['AnyTypeLinear'])

    // 6 issues attached, 1 done, no backlog and no cancelled one on AnyTypeLinear.
    assert.equal(result.total, 6)
    assert.equal(result.done, 1)
    assert.equal(result.denominator, 6)
    assert.equal(result.computed, 17)
  })

  it('excludes backlog and cancelled from the denominator', async () => {
    const result = await stats(['Other'])

    assert.equal(result.excluded.backlog, 1)
    assert.equal(result.denominator, result.total - result.excluded.backlog - result.excluded.canceled)
  })

  it('writes the recomputed value', async () => {
    assert.equal(stored('AnyTypeLinear'), 20)

    const result = await stats(['AnyTypeLinear'])
    assert.equal(result.written, true)
    assert.equal(stored('AnyTypeLinear'), 17)
  })

  it('--dry-run computes without writing', async () => {
    const result = await stats(['AnyTypeLinear', '--dry-run'])

    assert.equal(result.dryRun, true)
    assert.equal(result.changed, true)
    assert.equal(result.written, false)
    assert.equal(stored('AnyTypeLinear'), 20, 'the stored value must not move')
  })

  it('writes nothing when the value is already right', async () => {
    await stats(['AnyTypeLinear'])
    const second = await stats(['AnyTypeLinear'])

    assert.equal(second.changed, false)
    assert.equal(second.written, false)
  })

  it('is idempotent', async () => {
    await stats(['AnyTypeLinear'])
    const first = stored('AnyTypeLinear')
    await stats(['AnyTypeLinear'])

    assert.equal(stored('AnyTypeLinear'), first)
  })

  it('returns 0 rather than NaN when the denominator is zero', async () => {
    // A brand-new project has no issue: 0 / 0 must not produce NaN.
    await runCli(['project', 'new', 'Empty project', '--json'], { sandbox, apiUrl: api.url })

    const result = await stats(['Empty project'])
    assert.equal(result.denominator, 0)
    assert.equal(result.computed, 0)
  })

  it('displays the detail of the computation', async () => {
    const result = await runCli(['project', 'stats', 'AnyTypeLinear'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /Done\s+1/)
    assert.match(result.stdout, /Denominator\s+6/)
    assert.match(result.stdout, /6 issues − 0 backlog/)
  })

  it('exits with 3 on a project that cannot be found', async () => {
    const result = await runCli(['project', 'stats', 'inexistant'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 3)
  })

  it('the linked folder supplies the project when it is not named', async () => {
    const linked = await makeSandbox({ authenticated: true })
    await runCli(['project', 'link', 'anytypelinear'], { sandbox: linked, apiUrl: api.url })

    const result = await runCli([...['project', 'stats'], '--json'], { sandbox: linked, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.equal((parseJson(result) as { name: string }).name, 'AnyTypeLinear')
  })

  it('exits with 2 without a project name', async () => {
    const result = await runCli(['project', 'stats'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing project name/)
    assert.match(result.stderr, /project link/, 'the error must say how to link the folder')
  })

  it('project view reports no gap after a recomputation', async () => {
    await stats(['AnyTypeLinear'])

    const result = await runCli(['project', 'view', 'AnyTypeLinear'], { sandbox, apiUrl: api.url })
    assert.doesNotMatch(result.stdout, /computed/)
  })
})
