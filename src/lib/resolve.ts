import type { ApiClient } from './api.ts'
import { cached, cacheDelete } from './cache.ts'
import { notFoundError } from './errors.ts'
import { listProperties, listTags } from './objects.ts'
import { listSpaces, resolveSpace } from './spaces.ts'
import { sameName } from './text.ts'
import type { Tag } from '../model/object.ts'


/**
 * Resolving Anytype identifiers **by name**, with a cache
 * (docs/ANYTYPE-LIMITS.md §3.1).
 *
 * Semantic keys (`dev_issue`, `state`, `priority`…) are accepted constants: stable
 * and readable. Opaque identifiers are never hardcoded — they all come through here.
 */

export async function resolveSpaceId(api: ApiClient, spaceName: string): Promise<string> {
  const key = `space:${spaceName}`
  const id = await cached(key, async () => resolveSpace(await listSpaces(api), spaceName).id)

  return id
}

/** Call when a cached id has proved stale. */
export async function forgetSpaceId(spaceName: string): Promise<void> {
  await cacheDelete(`space:${spaceName}`)
}

export async function resolvePropertyId(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
): Promise<string> {
  return cached(`property:${spaceId}:${propertyKey}`, async () => {
    const properties = await listProperties(api, spaceId)

    const match = properties.find((p) => p.key === propertyKey)
    if (!match) {
      throw notFoundError(
        `Property "${propertyKey}" not found in this space.`,
        `Available keys: ${properties.map((p) => p.key).sort().join(', ')}`,
      )
    }
    return match.id
  })
}

/** The tags of a select / multi-select property, cached: every lookup below reads this. */
async function tagTable(api: ApiClient, spaceId: string, propertyKey: string): Promise<Tag[]> {
  return cached(`taglist:${spaceId}:${propertyKey}`, async () =>
    listTags(api, spaceId, await resolvePropertyId(api, spaceId, propertyKey)),
  )
}

/** Name → id table for the tags of a select / multi-select property. */
export async function resolveTagIds(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
): Promise<Record<string, string>> {
  const tags = await tagTable(api, spaceId, propertyKey)
  return Object.fromEntries(tags.map((t) => [t.name, t.id]))
}

/** Tag **key** → id. */
async function resolveTagKeys(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
): Promise<Record<string, string>> {
  const tags = await tagTable(api, spaceId, propertyKey)
  return Object.fromEntries(tags.map((t) => [t.key, t.id]))
}

/**
 * Tag keys the property carries. A search filter naming any other key is refused with
 * a 400, so callers check here before pushing a condition they cannot take back.
 */
export async function knownTagKeys(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
): Promise<ReadonlySet<string>> {
  return new Set((await tagTable(api, spaceId, propertyKey)).map((t) => t.key))
}

/** Key of the tag a name designates (casing and accents ignored), if there is one. */
export async function resolveTagKey(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
  name: string,
): Promise<string | undefined> {
  const tags = await tagTable(api, spaceId, propertyKey)
  return tags.find((t) => sameName(t.name, name))?.key
}

/**
 * Id of a tag, found **by key first** and only then by name.
 *
 * States and priorities pass their key, which survives the owner renaming the tag.
 * Labels pass a name, being free vocabulary the CLI does not decide on — hence the
 * fallback, which also keeps working on a space whose tags predate explicit keys.
 */
export async function resolveTagId(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
  tagKeyOrName: string,
): Promise<string> {
  const byKey = await resolveTagKeys(api, spaceId, propertyKey)
  const keyed = byKey[tagKeyOrName]
  if (keyed) return keyed

  const tags = await resolveTagIds(api, spaceId, propertyKey)
  const exact = tags[tagKeyOrName]
  if (exact) return exact

  const match = Object.entries(tags).find(([name]) => sameName(name, tagKeyOrName))
  if (match) return match[1]

  throw notFoundError(
    `No tag "${tagKeyOrName}" on property ${propertyKey}.`,
    `Existing values: ${Object.keys(tags).join(', ')}`,
  )
}

/**
 * Name the space currently displays for a tag, found by key. Used when a command has
 * to name a value it is about to write: the seed name would be a guess, and would
 * differ from what the application shows on a renamed space.
 */
export async function resolveTagName(
  api: ApiClient,
  spaceId: string,
  propertyKey: string,
  tagKey: string,
): Promise<string | undefined> {
  const [byKey, byName] = await Promise.all([
    resolveTagKeys(api, spaceId, propertyKey),
    resolveTagIds(api, spaceId, propertyKey),
  ])
  const id = byKey[tagKey]
  if (!id) return undefined
  return Object.entries(byName).find(([, tagId]) => tagId === id)?.[0]
}
