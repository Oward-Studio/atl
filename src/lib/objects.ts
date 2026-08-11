import type { ApiClient } from './api.ts'
import type { AnytypeObject, Paginated, Property, Tag } from '../model/object.ts'

/** Generic access to a space's objects. No notion of an issue here. */

/**
 * The API accepts large pages: a space of 232 issues fits in one call instead of
 * three, and the response weighs no more — the volume depends on the number of
 * objects, not on the slicing. Pagination stays for spaces beyond that size.
 */
const PAGE_SIZE = 1000
/** Backstop: past this, the query is badly filtered, not legitimately large. */
const MAX_PAGES = 20

export type SearchOptions = {
  query?: string
  types?: readonly string[]
  sortBy?: 'created_date' | 'last_modified_date' | 'name'
  direction?: 'asc' | 'desc'
}

/** Walks every page of results. */
export async function searchObjects(
  api: ApiClient,
  spaceId: string,
  options: SearchOptions = {},
): Promise<AnytypeObject[]> {
  const body = {
    query: options.query ?? '',
    types: options.types ?? [],
    sort: {
      property_key: options.sortBy ?? 'last_modified_date',
      direction: options.direction ?? 'desc',
    },
  }

  const all: AnytypeObject[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await api.request<Paginated<AnytypeObject>>(
      `/v1/spaces/${spaceId}/search`,
      { method: 'POST', body, query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
    )
    all.push(...response.data)
    if (!response.pagination.has_more) break
  }
  return all
}

export async function getObject(
  api: ApiClient,
  spaceId: string,
  objectId: string,
): Promise<AnytypeObject> {
  const response = await api.get<{ object: AnytypeObject }>(
    `/v1/spaces/${spaceId}/objects/${objectId}`,
    { format: 'md' },
  )
  return response.object
}

export type CreateObjectInput = {
  type_key: string
  name: string
  template_id?: string
  body?: string
  icon?: { format: 'emoji'; emoji: string }
  properties?: unknown[]
}

export async function createObject(
  api: ApiClient,
  spaceId: string,
  input: CreateObjectInput,
): Promise<AnytypeObject> {
  const response = await api.post<{ object: AnytypeObject }>(
    `/v1/spaces/${spaceId}/objects`,
    input,
  )
  return response.object
}

export async function updateObject(
  api: ApiClient,
  spaceId: string,
  objectId: string,
  patch: { name?: string; markdown?: string; icon?: unknown; properties?: unknown[] },
): Promise<AnytypeObject> {
  const response = await api.patch<{ object: AnytypeObject }>(
    `/v1/spaces/${spaceId}/objects/${objectId}`,
    patch,
  )
  return response.object
}

export async function deleteObject(
  api: ApiClient,
  spaceId: string,
  objectId: string,
): Promise<void> {
  await api.delete(`/v1/spaces/${spaceId}/objects/${objectId}`)
}

export async function listTemplates(
  api: ApiClient,
  spaceId: string,
  typeId: string,
): Promise<AnytypeObject[]> {
  const response = await api.get<Paginated<AnytypeObject>>(
    `/v1/spaces/${spaceId}/types/${typeId}/templates`,
    { limit: PAGE_SIZE },
  )
  return response.data
}

export type TypeDefinition = {
  id: string
  key: string
  name: string
  /** Properties the type declares, with their ids. */
  properties?: Property[]
}

export async function listTypes(api: ApiClient, spaceId: string): Promise<TypeDefinition[]> {
  const response = await api.get<Paginated<TypeDefinition>>(`/v1/spaces/${spaceId}/types`, {
    limit: PAGE_SIZE,
  })
  return response.data
}

export async function listProperties(api: ApiClient, spaceId: string): Promise<Property[]> {
  const response = await api.get<Paginated<Property>>(`/v1/spaces/${spaceId}/properties`, {
    limit: PAGE_SIZE,
  })
  return response.data
}

export async function listTags(
  api: ApiClient,
  spaceId: string,
  propertyId: string,
): Promise<Tag[]> {
  const response = await api.get<Paginated<Tag>>(
    `/v1/spaces/${spaceId}/properties/${propertyId}/tags`,
    { limit: PAGE_SIZE },
  )
  return response.data
}
