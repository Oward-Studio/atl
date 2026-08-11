import { AtlError, ExitCode } from '../lib/errors.ts'
import { PRIORITY_KEYS, prioritySeed, STATE_KEYS, stateSeed } from './enums.ts'
import type { TagColor } from './palette.ts'
import { PROJECT_PROP, PROP, PROJECT_TYPE_KEY, TICKET_TYPE_KEY } from './issue.ts'

/**
 * Schema of the two dev types, for `atl init`.
 *
 * **Derived** from the constants the CLI already reads: `PROP`, `PROJECT_PROP`,
 * `STATE_KEYS`, `PRIORITY_KEYS`. That is the only guarantee that matters here — a schema
 * copied by hand would eventually create a space the CLI could not read back.
 */

/** Formats the API accepts (`create-property`). */
export type PropertyFormat = 'text' | 'number' | 'select' | 'url' | 'objects'

export type TagSeed = {
  /**
   * Explicit key: it is what the CLI identifies the tag by, and it must survive the
   * owner renaming the tag afterwards (docs/ANYTYPE-LIMITS.md §1.13).
   */
  key: string
  name: string
  color: TagColor
}

export type PropertySeed = {
  key: string
  name: string
  format: PropertyFormat
  /** Required for a select: the CLI resolves states by their **name**. */
  tags?: TagSeed[]
}


/**
 * Starting labels. Unlike states, they are validated nowhere: the CLI accepts any
 * name present on the property. They are seeds, not a contract — whoever bootstraps
 * is free to add more in the app.
 */
const LABEL_SEEDS: TagSeed[] = [
  { key: 'bug', name: 'Bug', color: 'red' },
  { key: 'feature', name: 'Feature', color: 'blue' },
  { key: 'refactor', name: 'Refactor', color: 'purple' },
  { key: 'improvement', name: 'Improvement', color: 'teal' },
  { key: 'qa', name: 'QA', color: 'orange' },
]

const STATE_PROPERTY: PropertySeed = {
  key: PROP.state,
  name: 'State',
  format: 'select',
  tags: STATE_KEYS.map((key) => ({ key, ...stateSeed(key) })),
}

/** Issue properties. The order is the one `issue view` displays. */
export const TICKET_PROPERTIES: readonly PropertySeed[] = [
  { key: PROP.ref, name: 'Ref', format: 'text' },
  STATE_PROPERTY,
  {
    key: PROP.priority,
    name: 'Priority',
    format: 'select',
    tags: PRIORITY_KEYS.map((key) => ({ key, ...prioritySeed(key) })),
  },
  { key: PROP.label, name: 'Dev label', format: 'select', tags: LABEL_SEEDS },
  { key: PROP.projects, name: 'Linked Projects', format: 'objects' },
  { key: PROP.blockedBy, name: 'Blocked by', format: 'objects' },
  { key: PROP.blocking, name: 'Blocking', format: 'objects' },
  { key: PROP.branch, name: 'GitHub branch', format: 'text' },
  { key: PROP.link, name: 'GitHub link', format: 'url' },
]

/** Project properties. `state` is **the same** property as the issue's. */
export const PROJECT_PROPERTIES: readonly PropertySeed[] = [
  STATE_PROPERTY,
  { key: PROJECT_PROP.progress, name: 'Progress', format: 'number' },
  { key: PROJECT_PROP.repo, name: 'Repo', format: 'url' },
]

export type TypeSeed = {
  key: string
  name: string
  pluralName: string
  properties: readonly PropertySeed[]
}

export const TYPE_SEEDS: readonly TypeSeed[] = [
  {
    key: TICKET_TYPE_KEY,
    name: 'Dev issue',
    pluralName: 'Dev issues',
    properties: TICKET_PROPERTIES,
  },
  {
    key: PROJECT_TYPE_KEY,
    name: 'Dev project',
    pluralName: 'Dev projects',
    properties: PROJECT_PROPERTIES,
  },
]

/** Every property to create, deduplicated by key (`state` is shared). */
export function allProperties(): PropertySeed[] {
  const seen = new Map<string, PropertySeed>()
  for (const type of TYPE_SEEDS) {
    for (const property of type.properties) {
      if (!seen.has(property.key)) seen.set(property.key, property)
    }
  }
  return [...seen.values()]
}

/**
 * The space lacks the dev types. Without this guard the API answers an opaque 500 on
 * creation and zero results on a listing (docs/ANYTYPE-LIMITS.md §1.10).
 *
 * Code 4 like a missing app key: the installation is unfinished, and no option of the
 * command will change that.
 */
export function spaceNotInitialised(missing: readonly string[], space: string): AtlError {
  return new AtlError(
    `Space "${space}" has no ${missing.length > 1 ? 'types' : 'type'} ${missing.join(' and ')}.`,
    ExitCode.config,
    'Run `atl init` to create them, or `atl space` to target another one.',
  )
}

/** Type keys missing from the space, in schema order. */
export function missingTypes(existing: readonly { key: string }[]): string[] {
  const keys = new Set(existing.map((t) => t.key))
  return TYPE_SEEDS.map((t) => t.key).filter((key) => !keys.has(key))
}
