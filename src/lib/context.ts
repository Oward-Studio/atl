import { ApiClient } from './api.ts'
import { cacheFlush } from './cache.ts'
import { loadConfig, requireAppKey, type ReadyConfig } from './config.ts'
import { configError } from './errors.ts'
import { resolveSpaceId } from './resolve.ts'

/** Everything a command talking to Anytype needs at hand. */
export type Context = {
  config: ReadyConfig
  api: ApiClient
  spaceId: string
  /** Name of the targeted space, as resolved. */
  spaceName: string
  json: boolean
}

/**
 * The space comes from the config, never from whatever is open in the application:
 * the API has no notion of a current space.
 *
 * `space` targets another one **without rewriting the config** — `atl auth` would
 * change the default, a side effect rarely wanted when merely bootstrapping
 * someone else's space.
 */
export async function createContext(json: boolean, space?: string): Promise<Context> {
  const config = await loadConfig()
  requireAppKey(config)

  const spaceName = space ?? config.space
  if (!spaceName) {
    throw configError(
      'No default space in the config.',
      'Run `atl auth --space "<name>"`.',
    )
  }

  const api = new ApiClient({ baseUrl: config.apiUrl, appKey: config.appKey })
  const spaceId = await resolveSpaceId(api, spaceName)

  return { config, api, spaceId, spaceName, json }
}

/** Call at the end of a command to persist cached resolutions. */
export const finish = cacheFlush

/**
 * Opens a context and guarantees the cache is persisted even when the command
 * fails: without this `finally`, resolutions made before the error are lost and the
 * next command redoes them.
 */
export async function withContext<T>(
  json: boolean,
  run: (context: Context) => Promise<T>,
  space?: string,
): Promise<T> {
  const context = await createContext(json, space)
  try {
    return await run(context)
  } finally {
    await finish()
  }
}
