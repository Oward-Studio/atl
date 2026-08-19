import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { closest, didYouMean } from '../src/lib/suggest.ts'

const OPTIONS = ['state', 'project', 'priority', 'label', 'all', 'sort', 'fields', 'json']

describe('nearest-name suggestion', () => {
  it('reaches the name that actually cost a ticket', () => {
    // `--status` for `--state` is what led an agent to report that `atl issue list`
    // accepts no filters at all.
    assert.equal(closest('status', OPTIONS), 'state')
  })

  it('tolerates one edit on a short name and two on a long one', () => {
    // `projet` is deliberate input, not a stray French label: it is the typo a French
    // speaker actually makes, which is the point of the whole feature.
    assert.equal(closest('stat', OPTIONS), 'state')
    assert.equal(closest('projet', OPTIONS), 'project')
    assert.equal(closest('prioriy', OPTIONS), 'priority')
  })

  it('says nothing rather than guessing when nothing is close', () => {
    assert.equal(closest('wxyz', OPTIONS), undefined)
    assert.equal(closest('completely-different', OPTIONS), undefined)
    assert.equal(didYouMean('wxyz', OPTIONS), undefined)
  })

  it('refuses to suggest anything for a single character', () => {
    // Every letter is one edit from every other, so a suggestion here would only ever
    // name whichever candidate is declared first — confident and uninformative.
    for (const input of ['x', 'q', 'z']) {
      assert.equal(closest(input, ['s', 'p', 'l', 'a']), undefined, input)
    }
  })

  it('matches whatever the case', () => {
    assert.equal(closest('STATUS', OPTIONS), 'state')
    assert.equal(closest('Projet', OPTIONS), 'project')
  })

  it('keeps a name that differs only in length out of reach', () => {
    // `all` and `label` share a letter and little else; pairing them would send the
    // reader to the wrong option.
    assert.equal(closest('lbel', ['all', 'label']), 'label')
    assert.equal(closest('aaaaaa', ['all', 'label']), undefined)
  })

  it('resolves a tie by declaration order, so the message does not drift', () => {
    assert.equal(closest('ab', ['ac', 'ad']), 'ac')
    assert.equal(closest('ab', ['ad', 'ac']), 'ad')
  })

  it('wraps the match in the sentence the commands print', () => {
    assert.equal(didYouMean('status', OPTIONS), 'Did you mean `state`?')
  })

  it('costs nothing on an empty candidate list', () => {
    assert.equal(closest('state', []), undefined)
  })
})
