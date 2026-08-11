import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl issue block / unblock', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  /** Ids linked by an objects property, as stored. */
  const links = (id: string, key: string): string[] =>
    (api.state.tickets.find((t) => t.id === id)?.properties.find((p) => p.key === key)?.[
      'objects'
    ] as string[] | undefined) ?? []

  it('--by posts the relation and its reciprocal', async () => {
    // Anytype does not maintain the inverse: the CLI must write both sides.
    const result = await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0, result.stderr)

    assert.deepEqual(links('tk-5', 'blocked_by'), ['tk-2'])
    assert.deepEqual(links('tk-2', 'blocking'), ['tk-5'], 'the reciprocal must be written')
  })

  it('--blocks posts the relation the other way round', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--blocks', 'atl-doc-deploy'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.deepEqual(links('tk-5', 'blocking'), ['tk-2'])
    assert.deepEqual(links('tk-2', 'blocked_by'), ['tk-5'], 'the reciprocal must be written')
  })

  it('keeps the existing relations', async () => {
    // tk-1 is already blocked by tk-2 in the fixture.
    await runCli(['issue', 'block', 'atl-label-sort', '--by', 'atl-idea'], { sandbox, apiUrl: api.url })

    assert.deepEqual(links('tk-1', 'blocked_by').sort(), ['tk-2', 'tk-5'])
  })

  it('is idempotent: posting the same relation again changes nothing', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
    const again = await runCli(
      ['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy', '--json'],
      { sandbox, apiUrl: api.url },
    )

    assert.equal((parseJson(again) as { changed: boolean }).changed, false)
    assert.deepEqual(links('tk-5', 'blocked_by'), ['tk-2'])
  })

  it('unblock removes both sides', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
    const result = await runCli(['issue', 'unblock', 'atl-idea', '--by', 'atl-doc-deploy'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.match(result.stderr, /is no longer blocked by/)

    assert.deepEqual(links('tk-5', 'blocked_by'), [])
    assert.deepEqual(links('tk-2', 'blocking'), [])
  })

  it('refuses the direct cycle, which would drain blocking of meaning', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--blocks', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

    const result = await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Contradictory/)
  })

  it('refuses to let an issue block itself', async () => {
    const result = await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-idea'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /itself/)
  })

  it('requires exactly one direction', async () => {
    const none = await runCli(['issue', 'block', 'atl-idea'], { sandbox, apiUrl: api.url })
    assert.equal(none.code, 2)
    assert.match(none.stderr, /exactly one direction/)

    const both = await runCli(
      ['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy', '--blocks', 'atl-old-shipped'],
      { sandbox, apiUrl: api.url },
    )
    assert.equal(both.code, 2)
  })

  it('exits with 3 on a reference that cannot be found', async () => {
    const result = await runCli(['issue', 'block', 'atl-idea', '--by', 'zzzz'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
  })

  it('issue view shows the relation from both sides', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

    const a = parseJson(
      await runCli(['issue', 'view', 'atl-idea', '--json'], { sandbox, apiUrl: api.url }),
    ) as { blockedBy: string[] }
    const b = parseJson(
      await runCli(['issue', 'view', 'atl-doc-deploy', '--json'], { sandbox, apiUrl: api.url }),
    ) as { blocking: string[] }

    assert.deepEqual(a.blockedBy, ['Document the deployment'])
    // The fixture declares `tk-1.blocked_by = [tk-2]` without the matching
    // `blocking`: the view infers it, on top of the relation just posted.
    assert.deepEqual(b.blocking, ['Fix the label sorting', 'Idea to triage'])
  })

  it('issue start warns about a block posted by the command', async () => {
    await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

    const result = await runCli(['issue', 'start', 'atl-idea'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /still blocked/)
  })

  it('issue view shows the blocker state, with no second call', async () => {
    // Learning whether the block still holds must not cost another `issue view`.
    const result = await runCli(['issue', 'view', 'atl-label-sort'], { sandbox, apiUrl: api.url })

    assert.match(result.stdout, /Blocked by.*atl-doc-deploy — Document the deployment/s)
    assert.match(result.stdout, /Blocked by\s+◔/, "the blocker's state icon")
  })

  it('issue view marks a relation inferred from the other side', async () => {
    // tk-1 declares blocking=[tk-3]; tk-3 declares nothing in return.
    const result = await runCli(['issue', 'view', 'atl-review-migration'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.match(result.stdout, /Blocked by/)
    assert.match(result.stdout, /inferred: relation posted on one side only/)
  })

  it('issue start warns even when only the blocker declares the relation', async () => {
    const result = await runCli(['issue', 'start', 'atl-review-migration'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /still blocked/)
    assert.match(result.stderr, /Fix the label sorting/)
  })

  describe('relation whose blocker is closed', () => {
    // Like Linear: the relation is not deleted, it moves under `Related`.
    it('demotes a finished blocker under `Related`', async () => {
      await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
      await runCli(['issue', 'done', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

      const result = await runCli(['issue', 'view', 'atl-idea'], { sandbox, apiUrl: api.url })

      assert.match(result.stdout, /Related\s+.*atl-doc-deploy/)
      assert.doesNotMatch(result.stdout, /Blocked by/)
    })

    it('also demotes a cancelled blocker, the misleading case', async () => {
      await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
      await runCli(['issue', 'cancel', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

      const result = await runCli(['issue', 'view', 'atl-idea'], { sandbox, apiUrl: api.url })

      assert.match(result.stdout, /Related/)
      assert.doesNotMatch(result.stdout, /Blocked by/)
    })

    it('deletes nothing: the relation stays in the data', async () => {
      await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
      await runCli(['issue', 'cancel', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

      const data = parseJson(
        await runCli(['issue', 'view', 'atl-idea', '--json'], { sandbox, apiUrl: api.url }),
      ) as { blockedBy: string[] }

      assert.deepEqual(data.blockedBy, ['Document the deployment'], '--json returns the raw data')
    })

    it('keeps active blockers in place when both kinds coexist', async () => {
      await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
      await runCli(['issue', 'block', 'atl-idea', '--by', 'atl-review-migration'], { sandbox, apiUrl: api.url })
      await runCli(['issue', 'cancel', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })

      const result = await runCli(['issue', 'view', 'atl-idea'], { sandbox, apiUrl: api.url })

      assert.match(result.stdout, /Blocked by\s+.*atl-review-migration/)
      assert.match(result.stdout, /Related\s+.*atl-doc-deploy/)
    })

    it('does not demote a target that is not an issue', async () => {
      // Anytype allows linking any object. A note's state is out of reach: no
      // demoting on a presumption. Set in the fake server's state rather than in the
      // fixture, so as not to shift the counts other suites rely on.
      const target = api.state.tickets.find((t) => t.id === 'tk-5')
      target?.properties.push({ key: 'blocked_by', objects: ['note-externe'] } as never)

      const result = await runCli(['issue', 'view', 'atl-idea'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /Blocked by\s+.*note-externe/)
      assert.doesNotMatch(result.stdout, /Related/)
    })
  })
})
