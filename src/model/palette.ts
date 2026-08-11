/**
 * Anytype's tag palette. `green` is not part of it — the API refuses it, and `lime`
 * stands in (docs/ANYTYPE-LIMITS.md §1.6).
 *
 * Isolated here so states can declare their colour without depending on the schema,
 * which depends on them.
 */
export type TagColor =
  | 'grey'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple'
  | 'blue'
  | 'ice'
  | 'teal'
  | 'lime'
