import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AtlError } from '../src/lib/errors.ts'
import {
  ACTIVE_STATES,
  isCounted,
  isNoPriority,
  isSettled,
  parsePriority,
  parseState,
  priorityRank,
  stateEmoji,
  stateIcon,
  stateRank,
  stateSeed,
  STATE_KEYS,
} from '../src/model/enums.ts'

describe('states', () => {
  it('accepts the Linear aliases', () => {
    assert.equal(parseState('todo'), 'todo')
    assert.equal(parseState('started'), 'in_progress')
    assert.equal(parseState('review'), 'in_review')
    assert.equal(parseState('done'), 'done')
    assert.equal(parseState('cancelled'), 'canceled')
  })

  it('accepts the seed names, whatever the case', () => {
    assert.equal(parseState('IN PROGRESS'), 'in_progress')
    assert.equal(parseState('To Do'), 'todo')
    assert.equal(parseState('Done'), 'done')
  })

  it('rejects an unknown state as a usage error', () => {
    assert.throws(() => parseState('bogus'), (e: unknown) => {
      assert.ok(e instanceof AtlError)
      assert.equal(e.exitCode, 2)
      return true
    })
  })

  it('treats every state as active except done and canceled', () => {
    assert.deepEqual(
      [...ACTIVE_STATES].sort(),
      STATE_KEYS.filter((s) => s !== 'done' && s !== 'canceled').sort(),
    )
  })

  it('sorts by what deserves attention, not by lifecycle order', () => {
    assert.ok(stateRank('in_review') < stateRank('in_progress'))
    assert.ok(stateRank('in_progress') < stateRank('todo'))
    assert.ok(stateRank('todo') < stateRank('backlog'))
    assert.ok(stateRank('backlog') < stateRank('done'))
    assert.ok(stateRank('done') < stateRank('canceled'))
    assert.ok(stateRank(undefined) >= STATE_KEYS.length)
  })

  it('ranks a key it does not know last', () => {
    assert.ok(stateRank('zzz') > stateRank('canceled'))
  })
})

describe('priorities', () => {
  it('accepts the aliases and the digits', () => {
    assert.equal(parsePriority('urgent'), 'urgent')
    assert.equal(parsePriority('h'), 'high')
    assert.equal(parsePriority('3'), 'medium')
    assert.equal(parsePriority('low'), 'low')
  })

  it('maps none and 0 onto the lowest priority', () => {
    assert.equal(parsePriority('none'), 'none')
    assert.equal(parsePriority('0'), 'none')
  })

  it('treats the lowest priority tag and a missing value the same way', () => {
    assert.equal(isNoPriority('none'), true)
    assert.equal(isNoPriority(undefined), true)
    assert.equal(isNoPriority('high'), false)
  })

  it('rejects an unknown priority', () => {
    assert.throws(() => parsePriority('bogus'), AtlError)
  })

  it('ranks the urgent one first', () => {
    assert.ok(priorityRank('urgent') < priorityRank('high'))
    assert.ok(priorityRank('low') < priorityRank('none'))
  })

  describe('facts derived from the state table', () => {
    it('the active states come from the table, not from a list kept aside', () => {
      assert.deepEqual([...ACTIVE_STATES], ['backlog', 'todo', 'in_progress', 'in_review'])
    })

    it('closed and counted are two different things', () => {
      // Done counts in the denominator; Backlog and Canceled do not — and Backlog
      // stays active in the view.
      assert.equal(isSettled('done'), true)
      assert.equal(isSettled('canceled'), true)
      assert.equal(isSettled('backlog'), false)

      assert.equal(isCounted('done'), true)
      assert.equal(isCounted('backlog'), false)
      assert.equal(isCounted('canceled'), false)
      assert.equal(isCounted('in_review'), true)
    })

    it('an unknown state is neither closed nor counted', () => {
      for (const value of [undefined, '', 'blocked']) {
        assert.equal(isSettled(value), false, String(value))
        assert.equal(isCounted(value), false, String(value))
      }
    })

    it('every state has a marker and a tag colour', () => {
      for (const state of STATE_KEYS) {
        assert.match(stateEmoji(state), /\p{Emoji}/u, state)
        assert.ok(stateSeed(state).color.length > 0, state)
        assert.notEqual(stateSeed(state).color, 'green', 'the Anytype palette has no green')
      }
    })

    it('the table glyphs stay one column wide', () => {
      // The table aligns on code-point count: a wide glyph would shift every
      // following column.
      for (const state of STATE_KEYS) {
        assert.equal([...stateIcon(state)].length, 1, state)
      }
    })
  })

  describe('keys are the only contract', () => {
    it('reads nothing from a key it does not know', () => {
      // A space whose tags carry other keys is not silently half-understood: the state
      // is simply unknown, and `atl init` is what seeds the expected ones.
      for (const foreign of ['whatever', 'zzz', 'unknown']) {
        assert.equal(isSettled(foreign), false, foreign)
        assert.equal(isCounted(foreign), false, foreign)
        assert.equal(stateIcon(foreign), '·', foreign)
      }
    })

    it('ranks an unknown key last rather than first', () => {
      assert.ok(stateRank('zzz') > stateRank('canceled'))
      assert.ok(priorityRank('zzz') > priorityRank('none'))
    })
  })
})
