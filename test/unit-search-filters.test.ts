import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { issueFilters } from '../src/lib/search-filters.ts'

describe('issueFilters', () => {
  it('sends nothing when nothing constrains the search', () => {
    assert.equal(issueFilters({}), undefined)
    assert.equal(issueFilters({ notStates: [], labels: [] }), undefined)
  })

  it('names a state by its tag key', () => {
    assert.deepEqual(issueFilters({ state: 'in_progress' }), {
      operator: 'and',
      conditions: [{ property_key: 'state', condition: 'eq', select: 'in_progress' }],
    })
  })

  it('excludes states with one ne per state, never an array', () => {
    assert.deepEqual(issueFilters({ notStates: ['done', 'canceled'] })?.conditions, [
      { property_key: 'state', condition: 'ne', select: 'done' },
      { property_key: 'state', condition: 'ne', select: 'canceled' },
    ])
  })

  it('asks for projects with in, never eq', () => {
    assert.deepEqual(issueFilters({ projectIds: ['p1', 'p2'] })?.conditions, [
      { property_key: 'linked_projects', condition: 'in', objects: ['p1', 'p2'] },
    ])
  })

  it('combines every dimension into one flat conjunction', () => {
    const filters = issueFilters({
      state: 'todo',
      priority: 'high',
      labels: ['bug', 'feature'],
      projectIds: ['p1'],
    })
    assert.equal(filters?.operator, 'and')
    assert.deepEqual(
      filters?.conditions.map((c) => `${c.property_key} ${c.condition}`),
      ['state eq', 'priority eq', 'dev_label eq', 'dev_label eq', 'linked_projects in'],
    )
  })

  it('never nests and never emits a multi-valued select', () => {
    const filters = issueFilters({ state: 'todo', notStates: ['done'], labels: ['bug'] })
    for (const c of filters?.conditions ?? []) {
      assert.ok('select' in c ? typeof c.select === 'string' : Array.isArray(c.objects))
      assert.ok(!('conditions' in c))
    }
  })
})
