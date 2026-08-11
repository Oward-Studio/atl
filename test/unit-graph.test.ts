import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildGraph } from '../src/model/graph.ts'
import type { Issue } from '../src/model/issue.ts'

/**
 * The reverse index is free — the issues are already loaded — but only worth having if
 * it is correct: it decides the `⊘` marker of `atl ls` and the warning of
 * `atl issue start`.
 */
const issue = (id: string, over: Partial<Issue> = {}): Issue =>
  ({
    id,
    ref: id,
    title: id,
    state: 'todo',
    priority: undefined,
    label: undefined,
    projectIds: [],
    branch: undefined,
    link: undefined,
    blockedBy: [],
    blocking: [],
    updatedAt: undefined,
    ...over,
  }) as Issue

describe('blocking graph', () => {
  it('unions both directions: blocked_by alone is enough', () => {
    const graph = buildGraph([issue('a', { blockedBy: ['b'] }), issue('b')])

    assert.deepEqual(
      graph.blockersOf('a').map((l) => [l.id, l.declared]),
      [['b', true]],
    )
    // Seen from b, the relation is inferred: b does not declare it itself.
    assert.deepEqual(
      graph.blockedOf('b').map((l) => [l.id, l.declared]),
      [['a', false]],
    )
  })

  it('unions both directions: blocking alone is enough too', () => {
    const graph = buildGraph([issue('a', { blocking: ['b'] }), issue('b')])

    assert.deepEqual(
      graph.blockersOf('b').map((l) => [l.id, l.declared]),
      [['a', false]],
    )
    assert.equal(graph.isBlocked('b'), true, 'un blocage déclaré d’un seul côté bloque quand même')
  })

  it('does not count twice a relation posted on both sides', () => {
    const graph = buildGraph([issue('a', { blockedBy: ['b'] }), issue('b', { blocking: ['a'] })])

    assert.equal(graph.blockersOf('a').length, 1)
    assert.equal(graph.blockersOf('a')[0]?.declared, true)
    assert.deepEqual(graph.halfPosed(), [], 'relation complète : rien à signaler')
  })

  it('a blocker that is done or cancelled no longer blocks', () => {
    for (const state of ['done', 'canceled'] as const) {
      const graph = buildGraph([issue('a', { blockedBy: ['b'] }), issue('b', { state })])
      assert.equal(graph.isBlocked('a'), false, state)
      // The relation stays displayable: it is the issue's history.
      assert.equal(graph.blockersOf('a').length, 1, state)
    }
  })

  it('a blocker in the backlog does block', () => {
    const graph = buildGraph([issue('a', { blockedBy: ['b'] }), issue('b', { state: 'backlog' })])
    assert.equal(graph.isBlocked('a'), true)
  })

  it('a target that is not an issue stays visible but does not block', () => {
    // Anytype lets any object be linked: a note, a document.
    const graph = buildGraph([issue('a', { blockedBy: ['note-42'] })])

    assert.deepEqual(
      graph.blockersOf('a').map((l) => [l.id, l.issue]),
      [['note-42', undefined]],
    )
    assert.equal(graph.isBlocked('a'), false, 'its state is out of reach: no presumption is made')
    assert.deepEqual(graph.halfPosed(), [], 'no point offering a repair that cannot happen')
  })

  it('reports relations posted on one side only, with the direction', () => {
    const graph = buildGraph([
      issue('a', { blockedBy: ['b'] }),
      issue('b'),
      issue('c', { blocking: ['d'] }),
      issue('d'),
    ])

    assert.deepEqual(
      graph.halfPosed().map((h) => [h.blocker.id, h.blocked.id, h.side]),
      [
        ['b', 'a', 'blocked_by'],
        ['c', 'd', 'blocking'],
      ],
    )
  })

  it('stays silent on an issue with no relation', () => {
    const graph = buildGraph([issue('a'), issue('b')])
    assert.deepEqual(graph.blockersOf('a'), [])
    assert.deepEqual(graph.blockedOf('a'), [])
    assert.equal(graph.isBlocked('a'), false)
  })
})
