import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type Condition = { property_key: string; condition: string; select?: string; objects?: string[] }
type Filters = { operator: string; conditions: Condition[] }

/**
 * What `atl ls` asks the server. The fake answers 400 to any filter shape the real API
 * refuses (docs/ANYTYPE-LIMITS.md §1.17), so these tests also prove the shapes are valid.
 */
describe('atl ls pushes its filters to the server', () => {
  let api: FakeServer
  let sandbox: Sandbox

  /** Runs the command and returns the filters of every issue search it made. */
  const searched = async (args: readonly string[]): Promise<(Filters | undefined)[]> => {
    api.state.searches.length = 0
    const result = await runCli(['ls', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return api.state.searches
      .filter((s) => s.types?.includes('dev_issue'))
      .map((s) => s.filters as Filters | undefined)
  }

  const summary = (filters: Filters | undefined): string[] =>
    (filters?.conditions ?? []).map(
      (c) => `${c.property_key} ${c.condition} ${c.select ?? c.objects?.join(',')}`,
    )

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  it('expresses the default view on the server, in one query', async () => {
    const searches = await searched([])
    assert.equal(searches.length, 1)
    assert.deepEqual(summary(searches[0]), ['state ne done', 'state ne canceled'])
  })

  it('asks for everything with --all', async () => {
    const searches = await searched(['--all'])
    assert.deepEqual(searches, [undefined])
  })

  it('pushes a single --state as the tag key, not the display name', async () => {
    const searches = await searched(['--state', 'started'])
    assert.deepEqual(summary(searches[0]), ['state eq in_progress'])
  })

  it('pushes a single --priority as the tag key', async () => {
    const searches = await searched(['--priority', 'high'])
    assert.deepEqual(summary(searches[0]), [
      'state ne done',
      'state ne canceled',
      'priority eq high',
    ])
  })

  it('pushes --label as the tag key of the label', async () => {
    const searches = await searched(['--label', 'bug'])
    assert.ok(summary(searches[0]).includes('dev_label eq bug'))
  })

  it('pushes --project as the ids of the projects whose name matches', async () => {
    const searches = await searched(['--project', 'anytypelinear'])
    assert.ok(summary(searches[0]).includes('linked_projects in proj-atl'))
  })

  it('combines every filter into one conjunction', async () => {
    const searches = await searched(['--state', 'todo', '--priority', 'medium', '--label', 'bug'])
    assert.deepEqual(summary(searches[0]), [
      'state eq todo',
      'priority eq medium',
      'dev_label eq bug',
    ])
    assert.equal(searches[0]?.operator, 'and')
  })

  it('leaves what one conjunction cannot say to the in-memory pass', async () => {
    // Two states are an "or", and "no priority" is a tag or a missing value: neither
    // can be pushed, and the rows must still come out exact.
    const multi = await searched(['--state', 'todo', '--state', 'review'])
    assert.ok(!summary(multi[0]).some((c) => c.startsWith('state eq')))

    const none = await searched(['--priority', 'none'])
    assert.ok(!summary(none[0]).some((c) => c.startsWith('priority')))
  })

  it('still returns exactly the issues asked for when a condition stays local', async () => {
    const result = await runCli(['ls', '--state', 'todo', '--state', 'review', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    const states = new Set((parseJson(result) as { state: string }[]).map((r) => r.state))
    assert.deepEqual([...states].sort(), ['In Review', 'Todo'])
  })

  it('never builds a shape the API refuses', async () => {
    for (const args of [[], ['--all'], ['--state', 'done'], ['--label', 'bug', '--project', 'atl']]) {
      for (const filters of await searched(args)) {
        for (const c of filters?.conditions ?? []) {
          if (c.objects) assert.equal(c.condition, 'in', 'an objects property takes in, never eq')
          if (c.select !== undefined) assert.equal(typeof c.select, 'string')
          assert.ok(!c.select?.startsWith('tag-'), 'a filter names tags by key, never by id')
        }
      }
    }
  })

  it('asks nothing of the server when a label or a project matches nothing', async () => {
    assert.deepEqual(await searched(['--label', 'nonexistent']), [])
    assert.deepEqual(await searched(['--project', 'no-such-project']), [])
  })

  it('keeps a blocker visible when the filters leave it out', async () => {
    // tk-3 (In Review) is blocked by tk-1 (In Progress): a state filter on review would
    // drop the blocker if the graph were built on the rows alone.
    const searches = await searched(['--state', 'review'])
    assert.equal(searches.length, 2, 'the unsettled issues are fetched for the graph')

    const result = await runCli(['ls', '--state', 'review'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /⊘/)
  })
})
