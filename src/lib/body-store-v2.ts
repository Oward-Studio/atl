import type { ApiClient } from './api.ts'
import { patchBlocks, readBlocks, type BlockDocument } from './blocks.ts'
import type { BodySnapshot, BodyStore, IssueBody } from './body-store.ts'
import {
  addCriterionOp,
  criteriaBlocks,
  descriptionOf,
  setCheckedOps,
  setDescriptionOps,
} from '../model/blocks.ts'
import type { Criterion } from '../model/acceptance.ts'

/**
 * The `/v2` body: typed blocks, each edited on its own. A write touches only the blocks
 * it names and carries the `ETag` it was read under, so nothing else in the body — a
 * table included — is rewritten, and a concurrent change is refused rather than
 * overwritten (docs/ANYTYPE-LIMITS.md §1.2).
 */
export function createV2BodyStore(api: ApiClient, spaceId: string): BodyStore {
  const documentOf = (snapshot: BodySnapshot): BlockDocument => snapshot.revision as BlockDocument

  const bodyOf = (document: BlockDocument): IssueBody => ({
    description: descriptionOf(document.blocks),
    // The ids stay inside the store: callers address criteria by number.
    criteria: criteriaBlocks(document.blocks).map(
      ({ text, checked }): Criterion => ({ text, checked }),
    ),
  })

  const read = async (objectId: string): Promise<BodySnapshot> => {
    const document = await readBlocks(api, spaceId, objectId)
    return { objectId, revision: document, ...bodyOf(document) }
  }

  const write = async (
    snapshot: BodySnapshot,
    ops: readonly Record<string, unknown>[],
  ): Promise<void> => {
    if (ops.length === 0) return
    await patchBlocks(api, spaceId, snapshot.objectId, ops, documentOf(snapshot).etag)
  }

  // Read back: check the API really stored what we think it did.
  const reread = async (objectId: string): Promise<IssueBody> => {
    const { description, criteria } = await read(objectId)
    return { description, criteria }
  }

  return {
    read,

    async setChecked(snapshot, numbers, checked) {
      const criteria = criteriaBlocks(documentOf(snapshot).blocks)
      await write(snapshot, setCheckedOps(criteria, numbers, checked))
      return reread(snapshot.objectId)
    },

    async addCriterion(snapshot, text) {
      await write(snapshot, [addCriterionOp(documentOf(snapshot).blocks, text)])
      return reread(snapshot.objectId)
    },

    async setDescription(snapshot, description) {
      await write(snapshot, setDescriptionOps(documentOf(snapshot).blocks, description))
    },
  }
}
