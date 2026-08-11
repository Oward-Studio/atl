import { isSettled } from './enums.ts'
import type { Issue } from './issue.ts'

/**
 * Blocking graph, built on the issues **already loaded**: `findIssue` and
 * `issue list` read the whole space anyway, so the reverse index costs no call. That
 * is what lets `atl ls` say which issue is startable without an `issue view` per row.
 *
 * The graph **unions both directions**: an edge exists if the blocked issue declares
 * `blocked_by` **or** if the blocker declares `blocking`. Anytype does not maintain
 * the reciprocal (docs/ANYTYPE-LIMITS.md §1.11) and the app fills only one side when
 * clicked; reading the union keeps the display correct despite those half-posted
 * relations, and `declared: false` is what flags them.
 */
export type Link = {
  id: string
  /** Absent when the target is not a dev issue (an object linked by hand in the app). */
  issue: Issue | undefined
  /** True when the issue being viewed declares the relation itself. */
  declared: boolean
}

/** A relation posted on one side only, hence invisible from the other. */
export type HalfPosed = {
  blocker: Issue
  blocked: Issue
  /** The property carrying the relation, the only one of the two filled in. */
  side: 'blocked_by' | 'blocking'
}

export type Graph = {
  /** Issues that block this one. */
  blockersOf: (id: string) => Link[]
  /** Issues this one blocks. */
  blockedOf: (id: string) => Link[]
  /** True when at least one known blocker is neither done nor cancelled. */
  isBlocked: (id: string) => boolean
  halfPosed: () => HalfPosed[]
}

export function buildGraph(issues: readonly Issue[]): Graph {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))

  // blocker -> blocked, and the reverse; the value records who declares the edge.
  const forward = new Map<string, Map<string, Sides>>()
  const backward = new Map<string, Map<string, Sides>>()

  const connect = (blocker: string, blocked: string, side: keyof Sides): void => {
    sides(forward, blocker, blocked)[side] = true
    sides(backward, blocked, blocker)[side] = true
  }

  for (const issue of issues) {
    for (const blocker of issue.blockedBy) connect(blocker, issue.id, 'blockedBy')
    for (const blocked of issue.blocking) connect(issue.id, blocked, 'blocking')
  }

  const links = (index: Map<string, Map<string, Sides>>, id: string, own: keyof Sides): Link[] =>
    [...(index.get(id) ?? new Map<string, Sides>())].map(([other, side]) => ({
      id: other,
      issue: byId.get(other),
      declared: side[own] === true,
    }))

  return {
    blockersOf: (id) => links(backward, id, 'blockedBy'),
    blockedOf: (id) => links(forward, id, 'blocking'),

    isBlocked: (id) =>
      links(backward, id, 'blockedBy').some(
        // An unknown target is not an issue: its state is out of reach, so it
        // cannot be declared blocking.
        (link) => link.issue !== undefined && !isSettled(link.issue.state),
      ),

    halfPosed: () => {
      const found: HalfPosed[] = []
      for (const [blocker, targets] of forward) {
        for (const [blocked, side] of targets) {
          if (side.blockedBy === side.blocking) continue

          const from = byId.get(blocker)
          const to = byId.get(blocked)
          if (!from || !to) continue

          found.push({ blocker: from, blocked: to, side: side.blocking ? 'blocking' : 'blocked_by' })
        }
      }
      return found
    },
  }
}

type Sides = { blockedBy?: true; blocking?: true }

function sides(
  index: Map<string, Map<string, Sides>>,
  from: string,
  to: string,
): Sides {
  let targets = index.get(from)
  if (!targets) {
    targets = new Map()
    index.set(from, targets)
  }

  let entry = targets.get(to)
  if (!entry) {
    entry = {}
    targets.set(to, entry)
  }
  return entry
}
