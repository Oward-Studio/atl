import { flagBool, flagList, flagString, type ParsedArgs } from '../../lib/args.ts'
import { usageError } from '../../lib/errors.ts'
import { normalize, sameName } from '../../lib/text.ts'
import {
  ACTIVE_STATES,
  isNoPriority,
  NO_PRIORITY,
  parsePriority,
  parseState,
  priorityRank,
  stateRank,
} from '../../model/enums.ts'
import { JSON_FIELDS, type JsonField, type Row } from './list-view.ts'

export type Filters = {
  sort: string
  fields: string[] | undefined
  allProjects: boolean
  states: ReturnType<typeof parseState>[]
  priorities: ReturnType<typeof parsePriority>[]
  labels: string[]
  project: string | undefined
  all: boolean
}

/**
 * Pure validation, no network: a typo in a filter must fail immediately, without
 * opening a connection or consuming the cache.
 */
export function parseFilters(args: ParsedArgs): Filters {
  const sort = flagString(args, 'sort') ?? 'state'
  if (!['updated', 'priority', 'state'].includes(sort)) {
    throw usageError(`Unknown sort: "${sort}".`, 'Accepted values: state, priority, updated.')
  }

  return {
    sort,
    fields: parseFields(flagString(args, 'fields')),
    states: flagList(args, 'state').map(parseState),
    priorities: flagList(args, 'priority').map(parsePriority),
    labels: flagList(args, 'label'),
    project: flagString(args, 'project'),
    all: flagBool(args, 'all'),
    allProjects: flagBool(args, 'all-projects'),
  }
}

function parseFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined

  const asked = raw
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)

  if (asked.length === 0) {
    throw usageError('`--fields` expects at least one field.', `Champs : ${JSON_FIELDS.join(', ')}.`)
  }

  const unknown = asked.filter((f) => !JSON_FIELDS.includes(f as JsonField))
  if (unknown.length > 0) {
    throw usageError(`Champ inconnu : ${unknown.join(', ')}.`, `Champs : ${JSON_FIELDS.join(', ')}.`)
  }

  return asked
}

/**
 * The search API does not filter on properties: everything happens here, on the
 * already-loaded objects. `project` is the project the scope settled on, which is not
 * necessarily the one passed as an option.
 */
export function applyFilters(
  rows: readonly Row[],
  filters: Filters,
  project: string | undefined,
): Row[] {
  const { states, priorities, labels, all } = filters
  let kept = [...rows]

  if (states.length > 0) {
    kept = kept.filter((r) => states.some((s) => r.state === s))
  } else if (!all) {
    kept = kept.filter((r) => ACTIVE_STATES.some((s) => r.state === s))
  }

  if (priorities.length > 0) {
    kept = kept.filter((r) =>
      priorities.some((p) => (p === NO_PRIORITY ? isNoPriority(r.priority) : r.priority === p)),
    )
  }

  for (const label of labels) {
    kept = kept.filter((r) => r.label !== undefined && sameName(r.label, label))
  }

  if (project) {
    const needle = normalize(project)
    kept = kept.filter((r) => r.projects.some((p) => normalize(p).includes(needle)))
  }

  return kept.sort(comparator(filters.sort))
}

function comparator(sort: string): (a: Row, b: Row) => number {
  if (sort === 'priority') {
    return (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || byUpdated(a, b)
  }
  if (sort === 'state') {
    // Within a state, the most urgent first: a status group ordered at random reads as
    // noise, and priority is the only thing that ranks work inside the same status.
    return (a, b) =>
      stateRank(a.state) - stateRank(b.state) ||
      priorityRank(a.priority) - priorityRank(b.priority) ||
      byUpdated(a, b)
  }
  return byUpdated
}

const byUpdated = (a: Row, b: Row): number => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
