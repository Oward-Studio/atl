import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type NewJson = {
  ref: string
  id: string
  title: string
  state: string
  priority: string | null
  label: string | null
  criteria: number
}

describe('atl issue new', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const create = async (args: readonly string[]): Promise<NewJson> => {
    const result = await runCli(['issue', 'new', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as NewJson
  }

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  it('creates an issue and derives its ref from the title', async () => {
    const issue = await create(['Fix the date parser'])
    assert.equal(issue.ref, 'fix-the-date-parser')
    assert.equal(issue.title, 'Fix the date parser')
  })

  it('puts the issue in Todo by default: a created issue is committed work', async () => {
    const issue = await create(['An issue with no state'])
    assert.equal(issue.state, 'Todo')
  })

  it('-s backlog deliberately parks an issue outside the progress figure', async () => {
    const issue = await create(['A thought to park', '--state', 'backlog'])
    assert.equal(issue.state, 'Backlog')
  })

  it('sets an icon whose colour follows the state', async () => {
    await create(['Issue in progress', '--state', 'started'])
    const created = api.state.created.at(-1)
    assert.deepEqual(created?.icon, { format: 'emoji', emoji: '🟡' })

    await create(['Ticket a faire', '--state', 'todo'])
    assert.deepEqual(api.state.created.at(-1)?.icon, { format: 'emoji', emoji: '🔵' })
  })

  it('creates from the template of the type', async () => {
    await create(['Issue with a template'])
    assert.equal(api.state.created.at(-1)?.template_id, 'template-t-t')
  })

  it('resolves state, priority and label by name', async () => {
    const issue = await create([
      'Ticket complet',
      '--state',
      'started',
      '--priority',
      'high',
      '--label',
      'bug',
    ])
    assert.equal(issue.state, 'In Progress')
    assert.equal(issue.priority, 'High')
    assert.equal(issue.label, 'Bug')
  })

  it('attaches to the project resolved by name', async () => {
    await create(['Ticket projeté', '--project', 'anytypelinear'])
    const props = api.state.created.at(-1)?.properties ?? []
    const linked = props.find((p) => p.key === 'linked_projects')
    assert.deepEqual(linked?.['objects'], ['proj-atl'])
  })

  it('writes the acceptance criteria as checkboxes', async () => {
    const issue = await create([
      'Issue with criteria',
      '--ac',
      'first criterion',
      '--ac',
      'second criterion',
    ])
    assert.equal(issue.criteria, 2)

    const body = api.state.bodies[issue.id] ?? ''
    assert.match(body, /## Acceptance criteria/)
    assert.match(body, /- \[ \] first criterion/)
    assert.match(body, /- \[ \] second criterion/)
  })

  it('puts the description before the criteria section', async () => {
    const issue = await create([
      'Ticket décrit',
      '--description',
      'The context of the issue.',
      '--ac',
      'a criterion',
    ])
    const body = api.state.bodies[issue.id] ?? ''
    assert.ok(
      body.indexOf('The context of the issue.') < body.indexOf("## Acceptance criteria"),
      'the description must precede the criteria',
    )
  })

  it('warns when no criterion is given', async () => {
    const result = await runCli(['issue', 'new', 'Issue with no criterion', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /No acceptance criteria/)
  })

  it('does not warn when criteria are given', async () => {
    const result = await runCli(['issue', 'new', 'Ticket critérié', '--ac', 'x', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.doesNotMatch(result.stderr, /No acceptance criteria/)
  })

  it('suffixes the ref rather than creating a duplicate', async () => {
    const first = await create(['Doublon de ref'])
    const second = await create(['Doublon de ref'])

    assert.equal(first.ref, 'doublon-de-ref')
    assert.equal(second.ref, 'doublon-de-ref-2', 'a duplicate ref would make resolution ambiguous')
  })

  it('accepts an explicit ref', async () => {
    const issue = await create(['Some title', '--ref', 'atl-ref-choisie'])
    assert.equal(issue.ref, 'atl-ref-choisie')
  })

  it('strips the phase prefix from the title to derive the ref', async () => {
    const issue = await create(['[3] Un ticket phasé'])
    assert.equal(issue.ref, 'un-ticket-phase')
  })

  it('exits with 2 without a title outside a TTY, instead of hanging', async () => {
    const result = await runCli(['issue', 'new'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing title/)
  })

  it('exits with 2 on an unknown state, before any network call', async () => {
    const fresh = await makeSandbox({ authenticated: true })
    const before = api.hits.get('/v1/spaces') ?? 0

    const result = await runCli(['issue', 'new', 'x', '--state', 'bogus'], {
      sandbox: fresh,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.equal(api.hits.get('/v1/spaces') ?? 0, before)
  })

  it('exits with 3 on a nonexistent label, listing the known values', async () => {
    const result = await runCli(['issue', 'new', 'x', '--label', 'inexistant'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /No tag/)
    assert.match(result.stderr, /Bug/)
  })

  it('exits with 3 on a nonexistent project', async () => {
    const result = await runCli(['issue', 'new', 'x', '--project', 'inexistant'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /No project/)
  })

  it('the created issue is visible to issue list and issue view', async () => {
    const issue = await create(['Ticket relisible', '--state', 'todo', '--ac', 'vérifiable'])

    const listed = parseJson(
      await runCli(['ls', '--json'], { sandbox, apiUrl: api.url }),
    ) as { ref: string | null }[]
    assert.ok(listed.some((r) => r.ref === issue.ref))

    const viewed = parseJson(
      await runCli(['issue', 'view', issue.ref, '--json'], { sandbox, apiUrl: api.url }),
    ) as { acceptanceCriteria: unknown[] }
    assert.equal(viewed.acceptanceCriteria.length, 1)
  })

  it('recomputes progress: one more issue changes the denominator', async () => {
    // The created issue is not in the list loaded for ref uniqueness: it is appended
    // rather than re-reading everything.
    //
    // Self-consistent assertions, no frozen percentage: this suite shares one server,
    // and earlier tests have already created issues.
    const stored = (): number | undefined =>
      (
        api.state.projects
          .find((p) => p.id === 'proj-atl')
          ?.properties.find((p) => p.key === 'progress') as { number?: number } | undefined
      )?.number

    const before = stored()
    const data = parseJson(
      await runCli(['issue', 'new', 'Un ticket de plus', '--project', 'AnyTypeLinear', '--json'], {
        sandbox,
        apiUrl: api.url,
      }),
    ) as { progress: { project: string; from: number; to: number }[] }

    assert.equal(data.progress.length, 1)
    assert.equal(data.progress[0]?.project, 'AnyTypeLinear')
    assert.equal(data.progress[0]?.from, before, 'the value announced as the old one')
    assert.equal(data.progress[0]?.to, stored(), 'the announced value is the written one')
    assert.ok((data.progress[0]?.to ?? 0) < (before ?? 100), 'one more issue dilutes the ratio')
  })

  it('recomputes nothing for an issue without a project', async () => {
    const data = parseJson(
      await runCli(['issue', 'new', 'No project', '--all-projects', '--json'], {
        sandbox,
        apiUrl: api.url,
      }),
    ) as { progress: unknown[] }

    assert.deepEqual(data.progress, [])
  })
})
