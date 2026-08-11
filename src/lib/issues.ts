import type { Context } from './context.ts'
import { notFoundError } from './errors.ts'
import { getObject, searchObjects } from './objects.ts'
import { normalize } from './text.ts'
import type { AnytypeObject } from '../model/object.ts'
import { displayRef, toIssue, TICKET_TYPE_KEY, type Issue } from '../model/issue.ts'

/**
 * Resolving an issue reference, from strictest to loosest: exact `ref`, then `ref`
 * prefix, then title substring.
 *
 * Ambiguity is never resolved silently: the candidates are listed and the command
 * exits with code 3 (docs/ANYTYPE-LIMITS.md §3.5).
 */

export type IssueMatch = {
  object: AnytypeObject
  issue: Issue
  /** Every issue in the space, already loaded: saves a second round trip. */
  tickets: AnytypeObject[]
}

export async function listTickets(context: Context): Promise<AnytypeObject[]> {
  return searchObjects(context.api, context.spaceId, { types: [TICKET_TYPE_KEY] })
}

export async function findIssue(context: Context, reference: string): Promise<IssueMatch> {
  return resolveIn(await listTickets(context), reference)
}

/**
 * Same resolution against an already-loaded list: resolves several references
 * without repeating the search, which is the expensive call.
 */
export function resolveIn(tickets: AnytypeObject[], reference: string): IssueMatch {
  const issues = tickets.map((object) => ({ object, issue: toIssue(object), tickets }))
  const needle = normalize(reference)

  const byExactRef = issues.filter(({ issue }) => issue.ref && normalize(issue.ref) === needle)
  const byId = issues.filter(({ issue }) => issue.id === reference)
  const byRefPrefix = issues.filter(({ issue }) => issue.ref && normalize(issue.ref).startsWith(needle))
  const byTitle = issues.filter(({ issue }) => normalize(issue.title).includes(needle))

  for (const candidates of [byExactRef, byId, byRefPrefix, byTitle]) {
    if (candidates.length === 1) return candidates[0] as IssueMatch
    if (candidates.length > 1) throw ambiguous(reference, candidates)
  }

  throw notFoundError(
    `No issue matches "${reference}".`,
    'List the references with `atl ls`.',
  )
}

/** Loads the markdown body, absent from search results. */
export async function loadBody(context: Context, objectId: string): Promise<string | undefined> {
  const object = await getObject(context.api, context.spaceId, objectId)
  return object.markdown
}

/** id → title table, to show relations by something other than their id. */
export function titleIndex(tickets: readonly AnytypeObject[]): Map<string, string> {
  return new Map(tickets.map((t) => [t.id, t.name]))
}

function ambiguous(reference: string, candidates: readonly IssueMatch[]): Error {
  const list = candidates
    .slice(0, 8)
    .map(({ issue }) => `  ${displayRef(issue)} — ${issue.title}`)
    .join('\n')
  const more = candidates.length > 8 ? `\n  … et ${candidates.length - 8} autres` : ''

  return notFoundError(
    `"${reference}" matches ${candidates.length} issues.`,
    `Narrow the reference:\n${list}${more}`,
  )
}
