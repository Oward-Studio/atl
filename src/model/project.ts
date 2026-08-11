import { ACTIVE_STATES, isCounted, type StateKey } from './enums.ts'
import { PROJECT_PROP, toIssue, type Issue } from './issue.ts'
import { propNumber, propSelect, propSelectKey, propUrl, type AnytypeObject } from './object.ts'

export type ProjectDetail = {
  id: string
  name: string
  /** Tag key of the state; `stateName` carries what Anytype displays. */
  state: string | undefined
  stateName: string | undefined
  /** Progress stored in Anytype, as a percentage. */
  progress: number | undefined
  repo: string | undefined
}

export function toProject(object: AnytypeObject): ProjectDetail {
  return {
    id: object.id,
    name: object.name,
    state: propSelectKey(object, PROJECT_PROP.state),
    stateName: propSelect(object, PROJECT_PROP.state),
    progress: propNumber(object, PROJECT_PROP.progress),
    repo: propUrl(object, PROJECT_PROP.repo),
  }
}

export type Counts = {
  total: number
  byState: Record<string, number>
  /** Issues neither done nor cancelled. */
  active: number
}

export function countByState(issues: readonly Issue[]): Counts {
  const byState: Record<string, number> = {}
  for (const issue of issues) {
    const key = issue.state ?? '–'
    byState[key] = (byState[key] ?? 0) + 1
  }

  return {
    total: issues.length,
    byState,
    active: issues.filter((i) => ACTIVE_STATES.includes(i.state as StateKey)).length,
  }
}

/**
 * Progress = done / (total − cancelled − backlog), rounded
 * (docs/ANYTYPE-LIMITS.md §3.4).
 *
 * Backlog and Canceled leave the denominator: they do not represent committed work. A
 * zero denominator yields 0 rather than NaN.
 */
export function computeProgress(issues: readonly Issue[]): {
  percent: number
  done: number
  denominator: number
  excluded: { backlog: number; canceled: number }
} {
  const count = (state: StateKey): number => issues.filter((i) => i.state === state).length

  const done = count('done')
  const backlog = count('backlog')
  const canceled = count('canceled')
  // The denominator is read from the state table, not from a list of names copied
  // here: adding a state would force a decision on its case over there.
  const denominator = issues.filter((i) => isCounted(i.state)).length

  return {
    percent: denominator > 0 ? Math.round((done / denominator) * 100) : 0,
    done,
    denominator,
    excluded: { backlog, canceled },
  }
}

export function issuesOfProject(objects: readonly AnytypeObject[], projectId: string): Issue[] {
  return objects.map(toIssue).filter((issue) => issue.projectIds.includes(projectId))
}
