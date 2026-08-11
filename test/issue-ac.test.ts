import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type AcJson = {
  ref: string
  criteria: { text: string; checked: boolean }[]
  progress: string
}

describe('atl issue ac', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const ac = async (args: readonly string[]): Promise<AcJson> => {
    const result = await runCli(['issue', 'ac', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as AcJson
  }

  // These cases write issue bodies: a fresh server per test.
  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  it('lists the numbered criteria with their progress', async () => {
    const result = await ac(['atl-label-sort'])
    assert.equal(result.progress, '1/3')
    assert.equal(result.criteria.length, 3)
    assert.equal(result.criteria[0]?.checked, true)
  })

  it('numbers the criteria on display', async () => {
    const result = await runCli(['issue', 'ac', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /1\.\s+✓|1\.\s+○/)
    assert.match(result.stdout, /3\./)
  })

  it('ticks a criterion by its number', async () => {
    const result = await ac(['check', 'atl-label-sort', '2'])
    assert.equal(result.progress, '2/3')
    assert.equal(result.criteria[1]?.checked, true)
  })

  it('ticks several criteria at once', async () => {
    const result = await ac(['check', 'atl-label-sort', '2', '3'])
    assert.equal(result.progress, '3/3')
  })

  it('unticks', async () => {
    const result = await ac(['uncheck', 'atl-label-sort', '1'])
    assert.equal(result.progress, '0/3')
    assert.equal(result.criteria[0]?.checked, false)
  })

  it('touches only the brackets: the rest of the body is unchanged', async () => {
    // Compared modulo rendering escapes: the API adds them on read, and the CLI
    // strips them on write so they do not accumulate.
    const unescape = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')

    const before = unescape(api.state.bodies['tk-1'] as string)
    await ac(['check', 'atl-label-sort', '2'])
    const after = api.state.bodies['tk-1'] as string

    const b = before.split('\n')
    const a = after.split('\n')
    assert.equal(a.length, b.length)

    const changed = a.map((line, i) => (line === b[i] ? undefined : i)).filter((i) => i !== undefined)
    assert.equal(changed.length, 1, `changed lines: ${changed.join(', ')}`)
    assert.equal(a[changed[0] as number], (b[changed[0] as number] as string).replace('[ ]', '[x]'))
  })

  it('escapes do not accumulate from one write to the next', async () => {
    // Bug measured on the real API: every round trip added a backslash,
    // indefinitely. The fixture body contains `dev\_label`.
    const count = (s: string) => (s.match(/\\/g) ?? []).length
    assert.ok(count(api.state.bodies['tk-1'] as string) > 0, 'the fixture must contain an escape')

    await ac(['check', 'atl-label-sort', '2'])
    const first = count(api.state.bodies['tk-1'] as string)

    await ac(['uncheck', 'atl-label-sort', '2'])
    const second = count(api.state.bodies['tk-1'] as string)

    assert.equal(first, 0, 'rendering escapes are stripped on write')
    assert.equal(second, 0, 'and do not come back')
  })

  it('preserves the free text written in the section', async () => {
    await ac(['check', 'atl-label-sort', '3'])
    assert.match(api.state.bodies['tk-1'] as string, /Free text left inside the section/)
  })

  it('appends a criterion at the end of the existing section', async () => {
    const result = await ac(['add', 'atl-label-sort', 'one more criterion'])
    assert.equal(result.criteria.length, 4)
    assert.deepEqual(result.criteria[3], { text: 'one more criterion', checked: false })
  })

  it('creates the section when the issue has none', async () => {
    const result = await ac(['add', 'atl-doc-deploy', 'first criterion'])
    assert.equal(result.criteria.length, 1)

    const body = api.state.bodies['tk-2'] as string
    assert.match(body, /## Acceptance criteria/)
    assert.match(body, /Nothing special/, 'the existing description is preserved')
  })

  it('says clearly that an issue without a section has nothing to tick', async () => {
    const result = await runCli(['issue', 'ac', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /no acceptance criteria/)
    assert.equal(result.stdout, '')
  })

  it('exits with 3 when ticking an issue that has no section', async () => {
    const result = await runCli(['issue', 'ac', 'check', 'atl-doc-deploy', '1'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /no "Acceptance criteria" section/)
  })

  it('exits with 2 on an out-of-range number', async () => {
    const result = await runCli(['issue', 'ac', 'check', 'atl-label-sort', '9'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /only 3 criterion/)
  })

  it('exits with 2 on a non-integer number', async () => {
    const result = await runCli(['issue', 'ac', 'check', 'atl-label-sort', 'deux'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Invalid criterion number/)
  })

  it('exits with 2 when check is given no number', async () => {
    const result = await runCli(['issue', 'ac', 'check', 'atl-label-sort'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /at least one criterion number/)
  })

  it('exits with 2 without a reference', async () => {
    const result = await runCli(['issue', 'ac'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing issue reference/)
  })

  it('refuses to write a body containing a table', async () => {
    api.state.bodies['tk-1'] = [
      '| Column | Value |',
      '|---|---|',
      '| a | b |',
      '',
      "## Acceptance criteria",
      '- [ ] a criterion',
    ].join('\n')

    const result = await runCli(['issue', 'ac', 'check', 'atl-label-sort', '1'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /table or HTML/)
    assert.match(api.state.bodies['tk-1'] as string, /- \[ \] a criterion/, 'nothing must be written')
  })

  it('does not read `<ref>` in inline code as HTML', async () => {
    // Regression: rejecting any tag would block issues describing
    // `atl issue ac <ref>` in their body.
    api.state.bodies['tk-1'] = [
      'Usage : `atl issue ac <ref>` puis `atl issue view <ref>`.',
      '',
      "## Acceptance criteria",
      '- [ ] a criterion',
    ].join('\n')

    const result = await ac(['check', 'atl-label-sort', '1'])
    assert.equal(result.progress, '1/1')
  })

  it('refuses a body containing <br>, the mark of a rendered table', async () => {
    api.state.bodies['tk-1'] = [
      'Text with a forced<br>break.',
      "## Acceptance criteria",
      '- [ ] a criterion',
    ].join('\n')

    const result = await runCli(['issue', 'ac', 'check', 'atl-label-sort', '1'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 1)
  })

  it('issue view sees the freshly ticked criterion', async () => {
    await ac(['check', 'atl-label-sort', '2'])

    const viewed = parseJson(
      await runCli(['issue', 'view', 'atl-label-sort', '--json'], { sandbox, apiUrl: api.url }),
    ) as { acceptanceCriteria: { checked: boolean }[] }

    assert.equal(viewed.acceptanceCriteria.filter((c) => c.checked).length, 2)
  })
})
