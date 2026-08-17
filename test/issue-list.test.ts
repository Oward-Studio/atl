import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type Row = {
  ref: string | null
  title: string
  state: string | null
  priority: string | null
  label: string | null
  projects: string[]
}

/** Display names as the fake serves them, in the order `--sort state` must produce. */
const STATE_ORDER = ['In Review', 'In Progress', 'Todo', 'Backlog', 'Done', 'Canceled']
const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No priority']

const rank = (order: readonly string[], value: string | null): number => {
  const index = order.indexOf(value ?? '')
  return index === -1 ? order.length : index
}

describe('atl issue list', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const list = async (args: readonly string[]): Promise<Row[]> => {
    const result = await runCli(['ls', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as Row[]
  }

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  it('lists active issues by default, Done and Canceled excluded', async () => {
    const rows = await list([])
    const states = new Set(rows.map((r) => r.state))
    assert.ok(!states.has('Done'))
    assert.ok(!states.has('Canceled'))
  })

  it('includes In Review in the default view', async () => {
    const rows = await list([])
    assert.ok(
      rows.some((r) => r.state === 'In Review'),
      'an issue in review must not vanish from the list',
    )
  })

  it('--all includes finished issues', async () => {
    const rows = await list(['--all'])
    assert.ok(rows.some((r) => r.state === 'Done'))
  })

  it('--state accepts the Linear aliases', async () => {
    const rows = await list(['--state', 'started'])
    assert.deepEqual(
      rows.map((r) => r.ref),
      ['atl-label-sort'],
    )
  })

  it('--state accepts the seed name whatever the case', async () => {
    const rows = await list(['--state', 'IN PROGRESS'])
    assert.deepEqual(
      rows.map((r) => r.ref),
      ['atl-label-sort'],
    )
  })

  it('--state is repeatable and cumulative', async () => {
    const rows = await list(['--state', 'started', '--state', 'review'])
    assert.deepEqual(
      rows.map((r) => r.ref).sort(),
      ['atl-label-sort', 'atl-review-migration'],
    )
  })

  it('--priority none catches the No priority tag as well as a missing value', async () => {
    const rows = await list(['--priority', 'none', '--all'])
    const refs = rows.map((r) => r.ref).sort()
    assert.deepEqual(refs, ['atl-idea', 'atl-no-priority', 'atl-corrupt-title', null].sort())
  })

  it('--label filters on the dev label', async () => {
    const rows = await list(['--label', 'bug'])
    assert.deepEqual(
      rows.map((r) => r.ref),
      ['atl-label-sort'],
    )
  })

  it('--project filters by partial name', async () => {
    const rows = await list(['--project', 'anytypelinear'])
    assert.ok(rows.length > 0)
    assert.ok(rows.every((r) => r.projects.includes('AnyTypeLinear')))
  })

  it('--sort priority orders from urgent to least prioritised', async () => {
    const rows = await list(['--sort', 'priority', '--all'])
    assert.deepEqual(rows.slice(0, 3).map((r) => r.priority), ['Urgent', 'High', 'Medium'])
  })

  it('sorts by state then priority by default', async () => {
    // The expected order is written out rather than imported: reusing the production
    // comparator would make the assertion agree with whatever it happens to do.
    const rows = await list(['--all'])
    const keys = rows.map((r) => [rank(STATE_ORDER, r.state), rank(PRIORITY_ORDER, r.priority)])

    for (let i = 1; i < keys.length; i++) {
      const [previousState, previousPriority] = keys[i - 1] as [number, number]
      const [currentState, currentPriority] = keys[i] as [number, number]
      assert.ok(
        previousState < currentState ||
          (previousState === currentState && previousPriority <= currentPriority),
        `row ${i}: ${rows[i - 1]?.state}/${rows[i - 1]?.priority} then ${rows[i]?.state}/${rows[i]?.priority}`,
      )
    }
  })

  it('puts what awaits review before what is merely started', async () => {
    const states = (await list([])).map((r) => r.state)
    assert.ok(states.indexOf('In Review') < states.indexOf('In Progress'), states.join(' · '))
  })

  it('--sort updated still gives the most recently touched first', async () => {
    const rows = await list(['--sort', 'updated'])
    assert.equal(rows[0]?.ref, 'atl-label-sort')
  })

  it('renders a short id for an issue without a ref', async () => {
    const result = await runCli(['ls'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /#abcdef/)
  })

  it('writes only JSON on stdout with --json', async () => {
    const result = await runCli(['ls', '--json'], { sandbox, apiUrl: api.url })
    assert.doesNotThrow(() => JSON.parse(result.stdout))
  })

  it('prints a readable table without --json', async () => {
    const result = await runCli(['ls'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /REF\s+STATE/)
    assert.match(result.stderr, /\d+ issues?/)
  })

  it('reports the absence of results without polluting stdout', async () => {
    const result = await runCli(['ls', '--label', 'inexistant'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /No issue matches/)
  })

  it('reports icons misaligned from their state', async () => {
    // The fixture has no icons at all: every issue is therefore misaligned.
    const result = await runCli(['ls'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /icon\(s\) misaligned/)
    assert.match(result.stderr, /atl issue icons/)
  })

  it('reports nothing when the icons are aligned', async () => {
    const fresh = await startFakeAnytype()
    try {
      // Align first, then list: nothing left to report.
      await runCli(['issue', 'icons', '--all-projects', '--json'], { sandbox, apiUrl: fresh.url })
      const result = await runCli(['ls'], { sandbox, apiUrl: fresh.url })
      assert.doesNotMatch(result.stderr, /misaligned/)
    } finally {
      await fresh.close()
    }
  })

  it('caps the warning so it does not drown the output', async () => {
    const result = await runCli(['ls', '--all'], { sandbox, apiUrl: api.url })
    const detail = result.stderr.split('\n').filter((l) => l.includes('→')).length
    assert.ok(detail <= 5, `${detail} detail lines`)
  })

  it('the detection adds no API call', async () => {
    const fresh = await startFakeAnytype()
    try {
      const sandboxA = await makeSandbox({ authenticated: true })
      await runCli(['ls', '--json'], { sandbox: sandboxA, apiUrl: fresh.url })
      const calls = [...fresh.hits.entries()].reduce((n, [, v]) => n + v, 0)

      const sandboxB = await makeSandbox({ authenticated: true })
      await runCli(['ls', '--json'], { sandbox: sandboxB, apiUrl: fresh.url })
      const after = [...fresh.hits.entries()].reduce((n, [, v]) => n + v, 0)

      assert.equal(after - calls, calls, 'two identical runs: the same number of calls')
    } finally {
      await fresh.close()
    }
  })

  it('reports titles containing HTML entities', async () => {
    const result = await runCli(['ls'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /HTML entities/)
    assert.match(result.stderr, /atl-corrupt-title/)
  })

  it('reports nothing when the titles are clean', async () => {
    const result = await runCli(['ls', '--label', 'Bug'], { sandbox, apiUrl: api.url })
    assert.doesNotMatch(result.stderr, /HTML entities/)
  })

  it('exits with 2 on an unknown state, before any network call', async () => {
    // Fresh sandbox: with no cache, resolving the space would necessarily call the API.
    const fresh = await makeSandbox({ authenticated: true })
    const before = api.hits.get('/v1/spaces') ?? 0

    const result = await runCli(['ls', '--state', 'bogus'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Unknown state/)
    assert.equal(api.hits.get('/v1/spaces') ?? 0, before, 'no network call must happen')
  })

  it('exits with 2 on an unknown priority', async () => {
    const result = await runCli(['ls', '--priority', 'bogus'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Unknown priority/)
  })

  it('exits with 2 on an unknown sort', async () => {
    const result = await runCli(['ls', '--sort', 'bogus'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Unknown sort/)
  })

  it('exits with 4 without an app key', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['ls'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(result.code, 4)
    assert.match(result.stderr, /app key/i)
  })

  it('exits with 5 when the API is unreachable', async () => {
    const result = await runCli(['ls'], { sandbox, apiUrl: 'http://127.0.0.1:1' })
    assert.equal(result.code, 5)
    assert.match(result.stderr, /injoignable/)
  })

  it('caches the space: the second invocation does not re-read /v1/spaces', async () => {
    const fresh = await makeSandbox({ authenticated: true })
    await runCli(['ls', '--json'], { sandbox: fresh, apiUrl: api.url })
    const afterFirst = api.hits.get('/v1/spaces') ?? 0

    await runCli(['ls', '--json'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(api.hits.get('/v1/spaces') ?? 0, afterFirst, 'the space must come from the cache')
  })

  describe('blocking marker, drawn from the reverse index', () => {
    // The fixture sets tk-1.blocked_by=[tk-2] and tk-1.blocking=[tk-3], each on one
    // side only: enough to exercise the union of both directions.
    it('marks blocked issues and explains the glyph', async () => {
      const result = await runCli(['ls'], { sandbox, apiUrl: api.url })

      const line = (ref: string) =>
        result.stdout.split('\n').find((l) => l.includes(ref)) ?? ''

      assert.match(line('atl-label-sort'), /⊘/, 'blocked by tk-2 through its own blocked_by')
      assert.match(line('atl-review-migration'), /⊘/, 'blocked through tk-1 blocking it')
      assert.doesNotMatch(line('atl-doc-deploy'), /⊘/)
      assert.match(result.stderr, /⊘ blocked by an unfinished issue/)
    })

    it('does not add the column when nothing is blocked', async () => {
      // Filter down to an unblocked issue: an empty column would cost two spaces per
      // row for nothing.
      const result = await runCli(['ls', '--state', 'backlog'], { sandbox, apiUrl: api.url })

      assert.doesNotMatch(result.stdout, /⊘/)
      assert.doesNotMatch(result.stderr, /blocked by an unfinished issue/)
    })

    it('carries the blocking in --json', async () => {
      const rows = parseJson(
        await runCli(['ls', '--all', '--json'], { sandbox, apiUrl: api.url }),
      ) as { ref: string; blocked: boolean }[]

      assert.equal(rows.find((r) => r.ref === 'atl-label-sort')?.blocked, true)
      assert.equal(rows.find((r) => r.ref === 'atl-doc-deploy')?.blocked, false)
    })

    it('reports relations posted on one side only, with the command that repairs them', async () => {
      const result = await runCli(['ls'], { sandbox, apiUrl: api.url })

      assert.match(result.stderr, /2 blocking relation\(s\) posted on one side only/)
      assert.match(result.stderr, /atl issue block atl-label-sort --by atl-doc-deploy/)
      assert.match(result.stderr, /atl issue block atl-review-migration --by atl-label-sort/)
    })

    it('a finished blocker no longer blocks', async () => {
      await runCli(['issue', 'done', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
      const result = await runCli(['ls'], { sandbox, apiUrl: api.url })

      const line = result.stdout.split('\n').find((l) => l.includes('atl-label-sort')) ?? ''
      assert.doesNotMatch(line, /⊘/)
    })
  })

  describe('--fields: trimming the JSON output', () => {
    it('keeps only the requested fields, in the requested order', async () => {
      const rows = parseJson(
        await runCli(['ls', '--json', '--fields', 'state,ref'], { sandbox, apiUrl: api.url }),
      ) as Record<string, unknown>[]

      assert.deepEqual(Object.keys(rows[0] ?? {}), ['state', 'ref'], 'the order is the one asked for')
    })

    it('leaves the output complete without the option', async () => {
      const rows = parseJson(await runCli(['ls', '--json'], { sandbox, apiUrl: api.url })) as Record<
        string,
        unknown
      >[]

      assert.ok(Object.keys(rows[0] ?? {}).length >= 10, 'no regression of the existing contract')
    })

    it('rejects an unknown field, listing the valid ones', async () => {
      const result = await runCli(['ls', '--json', '--fields', 'ref,nawak'], {
        sandbox,
        apiUrl: api.url,
      })

      assert.equal(result.code, 2)
      assert.match(result.stderr, /Unknown field: nawak/)
      assert.match(result.stderr, /ref, id, title/)
    })

    it('rejects an empty list', async () => {
      const result = await runCli(['ls', '--fields', ','], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 2)
      assert.match(result.stderr, /at least one field/)
    })

    it('validates before any network call', async () => {
      // Unreachable server: a typo must exit with 2, not 5.
      const result = await runCli(['ls', '--json', '--fields', 'nawak'], {
        sandbox,
        apiUrl: 'http://127.0.0.1:1',
      })

      assert.equal(result.code, 2, result.stderr)
    })
  })
})
