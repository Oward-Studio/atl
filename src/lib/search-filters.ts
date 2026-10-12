import { PROP } from '../model/issue.ts'

/**
 * Server-side filters for `POST /v1/spaces/{id}/search`, in the one shape the API
 * accepts (docs/ANYTYPE-LIMITS.md §1.17).
 *
 * The shape is narrower than it looks. The API takes a **flat** list of conditions
 * joined by a single operator: no nesting, so "state is A or B, and priority is C"
 * cannot be written. A select takes one tag **key** (a display name or an array is
 * refused with a 400), and an `objects` property takes `in`, never `eq`. The builder
 * only emits what is known to work; whatever it cannot express is left to the caller
 * to apply on the result.
 */
export type FilterCondition =
  | { property_key: string; condition: 'eq' | 'ne'; select: string }
  | { property_key: string; condition: 'in'; objects: string[] }

export type SearchFilters = { operator: 'and'; conditions: FilterCondition[] }

/**
 * What can be pushed to the server, already resolved: every value is a tag key or an
 * object id, and an absent field constrains nothing.
 */
export type IssueCriteria = {
  /** The issue is in exactly this state. */
  state?: string
  /** The issue is in none of these states. */
  notStates?: readonly string[]
  priority?: string
  /** Label tag keys; the issue must carry all of them. */
  labels?: readonly string[]
  /** The issue belongs to at least one of these projects. */
  projectIds?: readonly string[]
}

/** `undefined` when nothing constrains the search: the field is then left out. */
export function issueFilters(criteria: IssueCriteria): SearchFilters | undefined {
  const conditions: FilterCondition[] = []

  if (criteria.state !== undefined) {
    conditions.push({ property_key: PROP.state, condition: 'eq', select: criteria.state })
  }
  for (const state of criteria.notStates ?? []) {
    conditions.push({ property_key: PROP.state, condition: 'ne', select: state })
  }
  if (criteria.priority !== undefined) {
    conditions.push({ property_key: PROP.priority, condition: 'eq', select: criteria.priority })
  }
  for (const label of criteria.labels ?? []) {
    conditions.push({ property_key: PROP.label, condition: 'eq', select: label })
  }
  if (criteria.projectIds !== undefined) {
    conditions.push({
      property_key: PROP.projects,
      condition: 'in',
      objects: [...criteria.projectIds],
    })
  }

  return conditions.length === 0 ? undefined : { operator: 'and', conditions }
}
