import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type TransitionJson = {
  ref: string
  from: string | null
  to: string
  changed: boolean
  progress?: { project: string; from: number | undefined; to: number }[]
}

describe('state transitions', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const move = async (args: readonly string[]): Promise<TransitionJson> => {
    const result = await runCli([...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as TransitionJson
  }

  const iconOf = (id: string): string | undefined => {
    const object = api.state.tickets.find((t) => t.id === id)
    return (object?.icon as { emoji?: string } | undefined)?.emoji
  }

  // A fresh server per test: these cases write, and tests that depend on their
  // execution order always end up lying.
  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  it('done moves the issue to Done and returns the former state', async () => {
    const result = await move(['issue', 'done', 'atl-doc-deploy'])
    assert.deepEqual(result, {
      ref: 'atl-doc-deploy',
      from: 'Todo',
      to: 'Done',
      changed: true,
      // Project progress is recomputed in the same breath: it is derived, and leaving
      // it wrong until the next `project stats` would display a figure known to be
      // stale.
      // 20 is the value *stored* in the fixture; 33 the recomputed one (2 done out of
      // 6 issues, none excluded). The gap between them is exactly the drift this
      // recomputation removes.
      progress: [{ project: 'AnyTypeLinear', from: 20, to: 33 }],
    })
  })

  describe('recomputed progress', () => {
    it('fixes, along the way, the drift coming from the app', async () => {
      // In Progress → Todo changes neither numerator nor denominator: 1 done out of
      // 6, so 17 %. But the fixture stores 20 %, as after an edit made by hand. The
      // recomputation sets the value straight.
      const result = await move(['issue', 'todo', 'atl-label-sort'])

      assert.deepEqual(result.progress, [{ project: 'AnyTypeLinear', from: 20, to: 17 }])
    })

    it('writes nothing when the stored value is already right', async () => {
      // Once the drift is fixed, a neutral transition must write nothing.
      await move(['issue', 'todo', 'atl-label-sort'])
      const result = await move(['issue', 'review', 'atl-label-sort'])

      assert.deepEqual(result.progress, [], 'a pointless write is still a write')
    })

    it('touches nothing for an issue without a project', async () => {
      const target = api.state.tickets.find((t) => t.id === 'tk-2')
      target!.properties = target!.properties.filter((p) => p.key !== 'linked_projects')

      const result = await move(['issue', 'done', 'atl-doc-deploy'])

      assert.deepEqual(result.progress, [])
    })

    it('prints the variation, never silently', async () => {
      const result = await runCli(['issue', 'done', 'atl-doc-deploy'], {
        sandbox,
        apiUrl: api.url,
      })

      assert.match(result.stderr, /AnyTypeLinear — 20 % → 33 %/)
    })

    it('really writes the value onto the project', async () => {
      await move(['issue', 'done', 'atl-doc-deploy'])

      const project = api.state.projects.find((p) => p.id === 'proj-atl')
      const stored = project?.properties.find((p) => p.key === 'progress')

      assert.equal((stored as { number?: number } | undefined)?.number, 33)
    })
  })

  it('aligns the icon with the colour of the state', async () => {
    // tk-3 starts In Review in the fixture.
    await move(['issue', 'done', 'atl-review-migration'])
    assert.equal(iconOf('tk-3'), '🟢')

    await move(['issue', 'backlog', 'atl-review-migration'])
    assert.equal(iconOf('tk-3'), '⚪')

    await move(['issue', 'todo', 'atl-review-migration'])
    assert.equal(iconOf('tk-3'), '🔵')

    await move(['issue', 'review', 'atl-review-migration'])
    assert.equal(iconOf('tk-3'), '🟣')

    await move(['issue', 'cancel', 'atl-review-migration'])
    assert.equal(iconOf('tk-3'), '🔴')
  })

  it('start moves to In Progress with the yellow marker', async () => {
    await move(['issue', 'start', 'atl-idea'])
    assert.equal(iconOf('tk-5'), '🟡')
  })

  it('writes nothing when the issue is already in the target state', async () => {
    const before = api.hits.get(`/v1/spaces/space-test-001/objects/tk-6`) ?? 0

    const result = await move(['issue', 'todo', 'atl-no-priority'])
    assert.equal(result.changed, false)
    assert.equal(result.from, 'Todo')
    assert.equal(api.hits.get(`/v1/spaces/space-test-001/objects/tk-6`) ?? 0, before)
  })

  it('reports it readably outside --json', async () => {
    const result = await runCli(['issue', 'todo', 'atl-no-priority'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /already/)
    assert.equal(result.stdout, '')
  })

  it('warns when starting an issue that is still blocked', async () => {
    // atl-label-sort is already In Progress in the fixture: move it out first, otherwise
    // `start` is a no-op with nothing to warn about.
    await move(['issue', 'backlog', 'atl-label-sort'])

    const result = await runCli(['issue', 'start', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /still blocked/)
    assert.match(result.stderr, /atl-doc-deploy/, 'the blocker must be named')
  })

  it('does not warn when the blocker is finished', async () => {
    await move(['issue', 'done', 'atl-doc-deploy']) // le bloqueur de atl-label-sort
    await move(['issue', 'backlog', 'atl-label-sort'])

    const result = await runCli(['issue', 'start', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /still blocked/)
  })

  it('exits with 2 without a reference', async () => {
    const result = await runCli(['issue', 'done'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing issue reference/)
  })

  it('exits with 3 on a reference that cannot be found', async () => {
    const result = await runCli(['issue', 'done', 'zzzz'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 3)
  })

  it('the top-level aliases work', async () => {
    const result = await runCli(['done', 'atl-old-shipped', '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.equal((parseJson(result) as TransitionJson).changed, false)
  })
})

describe('atl issue icons', () => {
  let api: FakeServer
  let sandbox: Sandbox

  // These cases write icons: a fresh server per test, otherwise the first aligns
  // everything and the rest find nothing left to do.
  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  it('refuses to write without a target project: this is a bulk write', async () => {
    // The "icon = state" convention holds for one project, not for a whole space:
    // other projects may carry personal icons that mean something.
    const result = await runCli(['issue', 'icons'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /writes in bulk/)

    const untouched = api.state.tickets.every((t) => t.icon === undefined)
    assert.ok(untouched, 'nothing must be written')
  })

  it('--all-projects explicitly takes on the whole space', async () => {
    const result = await runCli(['issue', 'icons', '--all-projects', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0, result.stderr)
    assert.ok((parseJson(result) as { updated: unknown[] }).updated.length > 0)
  })

  it('lists the icons to realign without writing anything in --dry-run', async () => {
    const result = await runCli(['issue', 'icons', '--project', 'AnyTypeLinear', '--dry-run', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0, result.stderr)

    const payload = parseJson(result) as { dryRun: boolean; updated: { to: string }[] }
    assert.equal(payload.dryRun, true)
    assert.ok(payload.updated.length > 0, 'the fixture issues carry no icon')

    const untouched = api.state.tickets.every((t) => t.icon === undefined)
    assert.ok(untouched, '--dry-run must write nothing')
  })

  it('really realigns the icons, then has nothing left to do', async () => {
    const first = parseJson(
      await runCli(['issue', 'icons', '--all-projects', '--json'], { sandbox, apiUrl: api.url }),
    ) as { updated: { to: string }[] }
    assert.ok(first.updated.length > 0)

    for (const ticket of api.state.tickets) {
      const state = ticket.properties.find((p) => p.key === 'state')
      if (!state) continue
      assert.ok((ticket.icon as { emoji?: string } | undefined)?.emoji, `${ticket.id} has no icon`)
    }

    const second = parseJson(
      await runCli(['issue', 'icons', '--all-projects', '--json'], { sandbox, apiUrl: api.url }),
    ) as { updated: unknown[] }
    assert.deepEqual(second.updated, [], 'the command must be idempotent')
  })

  it('limits the catch-up to one project', async () => {
    const fresh = await startFakeAnytype()
    try {
      const payload = parseJson(
        await runCli(['issue', 'icons', '--project', 'Other', '--dry-run', '--json'], {
          sandbox,
          apiUrl: fresh.url,
        }),
      ) as { updated: { ref: string }[] }

      const refs = payload.updated.map((u) => u.ref)
      assert.ok(refs.includes('atl-idea'))
      assert.ok(!refs.includes('atl-label-sort'), 'an issue from another project must not be touched')
    } finally {
      await fresh.close()
    }
  })
})
