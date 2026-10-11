import type { ApiClient } from './api.ts'
import type { Block } from '../model/blocks.ts'

/**
 * Reads and edits an object body through the `/v2` block operations.
 *
 * `/v1` can only rewrite the whole body, and what it returns is not what was written.
 * `/v2` addresses one block at a time (docs/ANYTYPE-LIMITS.md §1.2).
 */

export type BlockDocument = {
  blocks: Block[]
  /** Must come back as `If-Match`, so a write fails when the object changed since. */
  etag: string | undefined
}

export async function readBlocks(
  api: ApiClient,
  spaceId: string,
  objectId: string,
): Promise<BlockDocument> {
  const { body, etag } = await api.exchange<{ blocks?: Block[] }>(
    `/v2/spaces/${spaceId}/objects/${objectId}`,
  )
  return { blocks: body.blocks ?? [], etag }
}

/** Applies the ops in order as one atomic edit: if one is refused, none is applied. */
export async function patchBlocks(
  api: ApiClient,
  spaceId: string,
  objectId: string,
  ops: readonly Record<string, unknown>[],
  etag: string | undefined,
): Promise<void> {
  await api.request(`/v2/spaces/${spaceId}/objects/${objectId}`, {
    method: 'PATCH',
    body: { ops },
    ...(etag === undefined ? {} : { headers: { 'If-Match': etag } }),
  })
}
