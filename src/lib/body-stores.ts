import type { ApiClient } from './api.ts'
import { createV1BodyStore } from './body-store-v1.ts'
import { createV2BodyStore } from './body-store-v2.ts'
import type { BodyStore } from './body-store.ts'
import type { ApiVersion } from './config.ts'

/** The one place that knows which implementation each API version stands for. */
export function createBodyStore(version: ApiVersion, api: ApiClient, spaceId: string): BodyStore {
  return version === 'v1' ? createV1BodyStore(api, spaceId) : createV2BodyStore(api, spaceId)
}
