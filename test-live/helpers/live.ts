import { ApiClient } from '../../src/lib/api.ts'
import { loadConfig } from '../../src/lib/config.ts'
import {
  createObject,
  deleteObject,
  listTemplates,
  listTypes,
  searchObjects,
  type CreateObjectInput,
} from '../../src/lib/objects.ts'
import { listSpaces, resolveSpace } from '../../src/lib/spaces.ts'
import type { AnytypeObject } from '../../src/model/object.ts'
import { PROJECT_TYPE_KEY, TICKET_TYPE_KEY } from '../../src/model/issue.ts'

/**
 * Harness for the contract tests, which talk to the **real** Anytype API.
 *
 * The cycle the owner asked for: **create, test, clean up**. The suite creates its own
 * LOREM project and deletes it at the end — the space keeps no trace between runs.
 *
 * Guards, in the order they apply:
 *  1. without a key or a reachable API, the suite is skipped, not failed;
 *  2. the working project is named exactly LOREM, otherwise it refuses to start;
 *  3. every created issue carries a reserved `ref` prefix;
 *  4. cleanup deletes only what the suite created, issues first.
 */

export const LOREM_PROJECT = 'LOREM'
export const REF_PREFIX = 'lorem-test-'

/**
 * Key prefix for the throwaway schema. Distinctive on purpose: a leftover from an
 * interrupted run must be recognisable at a glance in the application.
 *
 * A per-run token is appended because **deleting an object does not free its key**:
 * `create-property` and `create-type` keep refusing a key that was used once, even
 * after the object is gone (docs/ANYTYPE-LIMITS.md §1.13). Reusing a fixed key would
 * make the suite pass exactly once.
 */
export const SCHEMA_PREFIX = 'zz_live_'

export type LiveContext = {
  api: ApiClient
  spaceId: string
  projectId: string
  /** Creates a test issue, tracked for cleanup. */
  createTicket: (suffix: string, input?: Partial<CreateObjectInput>) => Promise<AnytypeObject>
  /**
   * Creates a throwaway property, tracked for cleanup. Needed to verify what the
   * fake server claims about `create-property` — claims nothing else re-checks.
   */
  createProperty: (
    suffix: string,
    body: Record<string, unknown>,
  ) => Promise<{ id: string; key: string }>
  /** Creates a throwaway type, tracked for cleanup. */
  createType: (
    suffix: string,
    body: Record<string, unknown>,
  ) => Promise<{ id: string; key: string; properties?: { key: string }[] }>
  cleanup: () => Promise<void>
}

export type LiveAvailability =
  | { available: true; context: LiveContext }
  | { available: false; reason: string }

/** Resolves everything needed, or says why the suite must be skipped. */
export async function liveContext(): Promise<LiveAvailability> {
  const config = await loadConfig()
  if (!config.appKey) {
    return { available: false, reason: 'no app key — run `atl auth`' }
  }
  if (!config.space) {
    return { available: false, reason: 'no default space in the config' }
  }

  const api = new ApiClient({ baseUrl: config.apiUrl, appKey: config.appKey, timeoutMs: 8000 })

  let spaceId: string
  try {
    spaceId = resolveSpace(await listSpaces(api), config.space).id
  } catch (error) {
    return {
      available: false,
      reason: `API Anytype indisponible (${(error as Error).message})`,
    }
  }

  const projects = await searchObjects(api, spaceId, { types: [PROJECT_TYPE_KEY] })
  const existing = projects.find((p) => p.name === LOREM_PROJECT)

  // A project left behind by an interrupted run is reused then cleaned up: the suite
  // repairs itself.
  const project = existing ?? (await createLoremProject(api, spaceId))

  // Belt and braces: only ever work on LOREM, never anywhere else.
  if (project.name !== LOREM_PROJECT) {
    throw new Error(
      `Refusing to start: the working project is named "${project.name}", not "${LOREM_PROJECT}".`,
    )
  }

  const templateId = await templateFor(api, spaceId, TICKET_TYPE_KEY)
  const created: string[] = []

  const createTicket: LiveContext['createTicket'] = async (suffix, input = {}) => {
    const ref = `${REF_PREFIX}${suffix}`
    const object = await createObject(api, spaceId, {
      type_key: TICKET_TYPE_KEY,
      name: `[live] ${suffix}`,
      ...(templateId ? { template_id: templateId } : {}),
      ...input,
      properties: [
        { key: 'ref', text: ref },
        { key: 'linked_projects', objects: [project.id] },
        ...((input.properties as unknown[]) ?? []),
      ],
    })
    created.push(object.id)
    return object
  }

  const schema: { properties: string[]; types: string[] } = { properties: [], types: [] }
  const runToken = `${Date.now()}`

  const createProperty: LiveContext['createProperty'] = async (suffix, body) => {
    const { property } = await api.post<{ property: { id: string; key: string } }>(
      `/v1/spaces/${spaceId}/properties`,
      { key: `${SCHEMA_PREFIX}${suffix}_${runToken}`, ...body },
    )
    schema.properties.push(property.id)
    return property
  }

  const createType: LiveContext['createType'] = async (suffix, body) => {
    const { type } = await api.post<{
      type: { id: string; key: string; properties?: { key: string }[] }
    }>(`/v1/spaces/${spaceId}/types`, { key: `${SCHEMA_PREFIX}${suffix}_${runToken}`, layout: 'basic', ...body })
    schema.types.push(type.id)
    return type
  }

  const cleanup: LiveContext['cleanup'] = async () => {
    // Types before properties: a type still claiming a deleted property would be
    // left describing something that no longer exists.
    await Promise.allSettled(schema.types.map((id) => api.delete(`/v1/spaces/${spaceId}/types/${id}`)))
    await Promise.allSettled(
      schema.properties.map((id) => api.delete(`/v1/spaces/${spaceId}/properties/${id}`)),
    )
    schema.types.length = 0
    schema.properties.length = 0

    // Issues first: deleting a project with linked issues would leave dangling
    // references.
    const results = await Promise.allSettled(created.map((id) => deleteObject(api, spaceId, id)))
    created.length = 0

    results.push(...(await Promise.allSettled([deleteObject(api, spaceId, project.id)])))

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      // Reported without failing: a botched cleanup must not mask the test results,
      // but it must not go unnoticed either.
      process.stderr.write(`⚠ ${failed.length} test object(s) left undeleted\n`)
    }
  }

  return {
    available: true,
    context: { api, spaceId, projectId: project.id, createTicket, createProperty, createType, cleanup },
  }
}

/** Creates the working project from its template, **with no custom body**: a body
 * would overwrite the dynamic table block of linked issues. */
async function createLoremProject(api: ApiClient, spaceId: string) {
  const templateId = await templateFor(api, spaceId, PROJECT_TYPE_KEY)

  return createObject(api, spaceId, {
    type_key: PROJECT_TYPE_KEY,
    name: LOREM_PROJECT,
    icon: { format: 'emoji', emoji: '🧪' },
    ...(templateId ? { template_id: templateId } : {}),
  })
}

async function templateFor(
  api: ApiClient,
  spaceId: string,
  typeKey: string,
): Promise<string | undefined> {
  const types = await listTypes(api, spaceId)
  const type = types.find((t) => t.key === typeKey)
  if (!type) return undefined

  const templates = await listTemplates(api, spaceId, type.id)
  return templates[0]?.id
}
