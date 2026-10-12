import type { Context } from './context.ts'
import { searchObjects } from './objects.ts'
import type { Project } from './projects.ts'
import { knownTagKeys, resolveTagKey } from './resolve.ts'
import { issueFilters, type IssueCriteria, type SearchFilters } from './search-filters.ts'
import { normalize } from './text.ts'
import { NO_PRIORITY, SETTLED_STATES } from '../model/enums.ts'
import { PROP, TICKET_TYPE_KEY } from '../model/issue.ts'
import type { AnytypeObject } from '../model/object.ts'

/**
 * Searching issues with the server doing the narrowing.
 *
 * A space holds every issue ever closed — hundreds, most of them Done — and the
 * default view wants a few dozen. Asking for all of them to throw most away is the
 * cost this module removes.
 *
 * The server only takes a flat conjunction (see `search-filters.ts`), so a request
 * like "state A or B" cannot be pushed whole. What is pushed is therefore a
 * **narrowing**: the result is always a superset of what the caller wants, and the
 * caller's own pass over it stays the authority on what is kept.
 */
export type IssueWanted = {
  /** State keys, any of. */
  states: readonly string[]
  /** Priority keys, any of. */
  priorities: readonly string[]
  /** Label names, all of them. */
  labels: readonly string[]
  /** Part of a project name, as typed. */
  project: string | undefined
  /** With no state asked for, keep the settled issues too. */
  includeSettled: boolean
}

export type IssueSearchResult = {
  /** What the server matched. */
  matches: AnytypeObject[]
  /**
   * Matches plus every unsettled issue: the blocking graph must see a blocker
   * whatever the filters, and an unsettled issue is the only kind that blocks.
   */
  universe: AnytypeObject[]
}

const NOTHING: IssueSearchResult = { matches: [], universe: [] }

/** Projects whose name contains what was typed — the same reading as the in-memory pass. */
export function projectsMatching(projects: readonly Project[], needle: string): Project[] {
  const wanted = normalize(needle)
  return projects.filter((p) => normalize(p.name).includes(wanted))
}

export async function searchIssues(
  context: Context,
  wanted: IssueWanted,
  projects: readonly Project[],
): Promise<IssueSearchResult> {
  const { api, spaceId } = context
  const criteria: IssueCriteria = {}

  // A condition naming a tag key the space does not have is refused with a 400, so each
  // key is checked against the property's tags and left to the caller when unknown.
  const states = await knownTagKeys(api, spaceId, PROP.state)

  if (wanted.states.length === 1 && states.has(wanted.states[0] as string)) {
    criteria.state = wanted.states[0] as string
  } else if (wanted.states.length === 0 && !wanted.includeSettled) {
    criteria.notStates = SETTLED_STATES.filter((s) => states.has(s))
  }

  const priority = wanted.priorities.length === 1 ? (wanted.priorities[0] as string) : undefined
  // "No priority" is both the `none` tag and no value at all: one condition cannot say it.
  if (priority !== undefined && priority !== NO_PRIORITY) {
    if ((await knownTagKeys(api, spaceId, PROP.priority)).has(priority)) {
      criteria.priority = priority
    }
  }

  const labels: string[] = []
  for (const name of wanted.labels) {
    const key = await resolveTagKey(api, spaceId, PROP.label, name)
    if (key === undefined) return NOTHING
    labels.push(key)
  }
  if (labels.length > 0) criteria.labels = labels

  if (wanted.project) {
    const ids = projectsMatching(projects, wanted.project).map((p) => p.id)
    if (ids.length === 0) return NOTHING
    criteria.projectIds = ids
  }

  const search = (filters: SearchFilters | undefined): Promise<AnytypeObject[]> =>
    searchObjects(api, spaceId, {
      types: [TICKET_TYPE_KEY],
      ...(filters ? { filters } : {}),
    })

  const filters = issueFilters(criteria)
  const unsettled = issueFilters({ notStates: SETTLED_STATES.filter((s) => states.has(s)) })

  // Nothing pushed: the search returned everything, graph included.
  if (filters === undefined) {
    const matches = await search(undefined)
    return { matches, universe: matches }
  }

  // The default view is the unsettled set: one query serves both.
  if (JSON.stringify(filters) === JSON.stringify(unsettled)) {
    const matches = await search(filters)
    return { matches, universe: matches }
  }

  const [matches, blockers] = await Promise.all([search(filters), search(unsettled)])
  return { matches, universe: union(matches, blockers) }
}

function union(first: readonly AnytypeObject[], second: readonly AnytypeObject[]): AnytypeObject[] {
  const seen = new Set(first.map((o) => o.id))
  return [...first, ...second.filter((o) => !seen.has(o.id))]
}
