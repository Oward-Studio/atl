import type { Criterion } from '../model/acceptance.ts'

/**
 * How an issue's body is read and edited.
 *
 * Commands depend on this contract and never on the API behind it: one implementation
 * rewrites the markdown body (`/v1`), another edits blocks (`/v2`). Which one runs is
 * decided once, when the context is built (docs/ANYTYPE-LIMITS.md §1.2).
 */

export type IssueBody = {
  /** The body without the criteria section. */
  description: string
  criteria: Criterion[]
}

/**
 * A body as it was read, handed back to the store when writing. It carries whatever the
 * implementation needs to write safely — the markdown that will be rewritten, or the
 * blocks and the `ETag` that `If-Match` must repeat — and nothing else may look inside.
 */
export type BodySnapshot = IssueBody & {
  readonly objectId: string
  readonly revision: unknown
}

export type BodyStore = {
  read(objectId: string): Promise<BodySnapshot>
  /** Ticks or unticks criteria by their 1-based number; returns the body as stored. */
  setChecked(snapshot: BodySnapshot, numbers: readonly number[], checked: boolean): Promise<IssueBody>
  /** Appends a criterion, creating the section if needed; returns the body as stored. */
  addCriterion(snapshot: BodySnapshot, text: string): Promise<IssueBody>
  /** Replaces the description and leaves the criteria section as it was. */
  setDescription(snapshot: BodySnapshot, description: string): Promise<void>
}
