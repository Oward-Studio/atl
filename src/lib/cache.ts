import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { cacheDir, cacheFile } from './paths.ts'

/**
 * Local cache of name resolutions (space, tags…), to avoid walking the API on every
 * command. Cleared by `atl cache clear`.
 *
 * A corrupt or stale cache is never an error: fall back to the API.
 */

type Entry = { value: unknown; expiresAt: number }
type Store = { version: number; entries: Record<string, Entry> }

const VERSION = 1
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

let store: Store | undefined
let dirty = false

async function load(): Promise<Store> {
  if (store) return store

  try {
    const parsed = JSON.parse(await readFile(cacheFile(), 'utf8')) as Store
    store = parsed.version === VERSION ? parsed : { version: VERSION, entries: {} }
  } catch {
    store = { version: VERSION, entries: {} }
  }
  return store
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const { entries } = await load()
  const entry = entries[key]
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    delete entries[key]
    dirty = true
    return undefined
  }
  return entry.value as T
}

export async function cacheSet(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  const { entries } = await load()
  entries[key] = { value, expiresAt: Date.now() + ttlMs }
  dirty = true
}

/** Invalidates an entry whose value proved wrong in use. */
export async function cacheDelete(key: string): Promise<void> {
  const { entries } = await load()
  if (entries[key] !== undefined) {
    delete entries[key]
    dirty = true
  }
}

/** Writes the cache if needed. A write failure is silent: it is only a cache. */
export async function cacheFlush(): Promise<void> {
  if (!dirty || !store) return
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(cacheFile(), JSON.stringify(store), 'utf8')
    dirty = false
  } catch {
    // deliberately ignored
  }
}

/** Memoises a resolution. `compute` runs only on a miss or an expiry. */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = await cacheGet<T>(key)
  if (hit !== undefined) return hit

  const value = await compute()
  await cacheSet(key, value, ttlMs)
  return value
}
