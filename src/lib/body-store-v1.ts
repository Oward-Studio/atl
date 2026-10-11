import { AtlError, ExitCode } from './errors.ts'
import type { ApiClient } from './api.ts'
import type { BodySnapshot, BodyStore, IssueBody } from './body-store.ts'
import { getObject, updateObject } from './objects.ts'
import {
  addCriterion,
  hasRichBlocks,
  parseBody,
  replaceDescription,
  setChecked,
} from '../model/acceptance.ts'

/**
 * The `/v1` body: markdown that can only be rewritten whole, and that comes back
 * altered. Hence the refusal to rewrite a body holding a table or HTML — it would
 * degrade it (docs/ANYTYPE-LIMITS.md §1.2).
 */
export function createV1BodyStore(api: ApiClient, spaceId: string): BodyStore {
  const markdownOf = (snapshot: BodySnapshot): string => snapshot.revision as string

  const read = async (objectId: string): Promise<BodySnapshot> => {
    const markdown = (await getObject(api, spaceId, objectId)).markdown ?? ''
    return { objectId, revision: markdown, ...parseBody(markdown) }
  }

  const write = async (snapshot: BodySnapshot, markdown: string): Promise<void> => {
    if (hasRichBlocks(markdownOf(snapshot))) {
      throw new AtlError(
        'This issue body contains a table or HTML, which rewriting would damage.',
        ExitCode.error,
        'Edit it directly in Anytype. See docs/ANYTYPE-LIMITS.md §1.2.',
      )
    }
    await updateObject(api, spaceId, snapshot.objectId, { markdown })
  }

  // Read back: check the API really stored what we think it did.
  const reread = async (objectId: string): Promise<IssueBody> => {
    const { description, criteria } = await read(objectId)
    return { description, criteria }
  }

  return {
    read,

    async setChecked(snapshot, numbers, checked) {
      await write(snapshot, setChecked(markdownOf(snapshot), numbers, checked).markdown)
      return reread(snapshot.objectId)
    },

    async addCriterion(snapshot, text) {
      await write(snapshot, addCriterion(markdownOf(snapshot), text).markdown)
      return reread(snapshot.objectId)
    },

    async setDescription(snapshot, description) {
      await write(snapshot, replaceDescription(markdownOf(snapshot), description))
    },
  }
}
