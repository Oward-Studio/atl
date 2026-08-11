/** Shapes returned by the Anytype API, reduced to what the CLI consumes. */

export type Tag = {
  id: string
  key: string
  name: string
  color?: string
}

export type PropertyValue = {
  key: string
  format: string
  text?: string
  number?: number
  date?: string
  url?: string
  select?: Tag
  multi_select?: Tag[]
  objects?: string[]
}

export type AnytypeType = {
  id: string
  key: string
  name: string
}

export type Icon = {
  format: string
  emoji?: string
}

export type AnytypeObject = {
  id: string
  name: string
  space_id: string
  archived: boolean
  icon?: Icon | null
  snippet?: string
  type?: AnytypeType
  properties?: PropertyValue[]
  markdown?: string
}

export type Property = {
  id: string
  key: string
  name: string
  format: string
}

export type Paginated<T> = {
  data: T[]
  pagination: { total: number; offset: number; limit: number; has_more: boolean }
}

// ------------------------------------------------------------ accesseurs

const find = (object: AnytypeObject, key: string): PropertyValue | undefined =>
  object.properties?.find((p) => p.key === key)

export const propText = (object: AnytypeObject, key: string): string | undefined =>
  find(object, key)?.text

export const propNumber = (object: AnytypeObject, key: string): number | undefined =>
  find(object, key)?.number

export const propDate = (object: AnytypeObject, key: string): string | undefined =>
  find(object, key)?.date

export const propUrl = (object: AnytypeObject, key: string): string | undefined =>
  find(object, key)?.url

/** Tag name of a select property, or `undefined` when the property is empty. */
export const propSelect = (object: AnytypeObject, key: string): string | undefined =>
  find(object, key)?.select?.name

/**
 * Tag **key** of a select property — the stable identifier. A tag renamed in the
 * application keeps its key, so anything the CLI decides on must key off this rather
 * than off the display name (docs/ANYTYPE-LIMITS.md §1.13).
 */
export const propSelectKey = (object: AnytypeObject, key: string): string | undefined =>
  find(object, key)?.select?.key

export const propMultiSelect = (object: AnytypeObject, key: string): string[] =>
  find(object, key)?.multi_select?.map((t) => t.name) ?? []

export const propObjects = (object: AnytypeObject, key: string): string[] =>
  find(object, key)?.objects ?? []

/**
 * The Anytype API performs **no** HTML escaping: it returns names as they are
 * stored. Verified by creating an object named `sonde <marqueur> html` and reading it
 * back unchanged.
 *
 * An HTML entity in a name is therefore genuine data corruption, visible as such in
 * the app. The CLI does not hide it: hiding it would conceal damaged titles.
 */
const HTML_ENTITY_RE = /&(?:lt|gt|amp|quot|#39);/

export function hasHtmlEntities(name: string): boolean {
  return HTML_ENTITY_RE.test(name)
}
