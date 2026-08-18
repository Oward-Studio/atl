import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cacheFlush, cacheGet, cacheSet } from './cache.ts'
import { color } from './color.ts'
import { info } from './output.ts'

/**
 * Telling the owner a newer version exists, at most once a day.
 *
 * Synchronous, with a short deadline, rather than detached in a background process. The
 * call costs about 105 ms against the CLI's own 132 ms of startup, so one slower command
 * a day is the whole price — measured, after an earlier figure of 783 ms turned out to
 * have been timing the `gh` binary rather than the network. Detaching would have wanted a
 * second exemption to the guard that forbids starting a process from `src/`, and would
 * have shown the notice one command later than the run that found it.
 *
 * It is also the one place `atl` reaches the network for something other than Anytype,
 * which is why it is opt-out and never fires off a terminal.
 */

const CACHE_KEY = 'update:latest'
const DAY_MS = 24 * 60 * 60 * 1000
const DEADLINE_MS = 1_500

/** Called after a command has run, so its own output comes first. Never throws. */
export async function notifyIfBehind(root: string): Promise<void> {
  try {
    if (!enabled()) return

    const local = declaredVersion(root)
    const latest = await latestRelease(root)
    if (!latest || !isNewer(latest, local)) return

    info(color.yellow(`  atl ${latest} is available — you have ${local}. Run \`atl update\`.`))
  } catch {
    // A notice is a courtesy. Nothing it can fail at is worth surfacing, let alone
    // failing a command that already did its work.
  }
}

/**
 * Off when asked, and off whenever nobody is watching: a pipeline, a CI run or an agent
 * gets no notice, which also means no network call in those contexts.
 *
 * Both directions are forceable, since a terminal is a guess about intent rather than a
 * statement of it: a wrapper script that does want the notice says so with
 * `ATL_UPDATE_CHECK=1`, and refusal wins over insistence.
 */
function enabled(): boolean {
  if (process.env['ATL_NO_UPDATE_CHECK']) return false
  if (process.env['ATL_UPDATE_CHECK']) return true
  return process.stderr.isTTY === true
}

function declaredVersion(root: string): string {
  return (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string })
    .version
}

/**
 * The cached tag, or one fetch. The 24-hour window is on the **call**, not on the
 * message: while a version is behind, every command says so from the cache, for free.
 */
async function latestRelease(root: string): Promise<string | undefined> {
  const cached = await cacheGet<string>(CACHE_KEY)
  if (cached !== undefined) return cached

  const slug = originSlug(root)
  if (!slug) return undefined

  // Overridable like `ATL_API_URL` is for Anytype, which is also what lets the suite
  // exercise this without reaching a host it does not control.
  const origin = process.env['ATL_UPDATE_ORIGIN'] ?? 'https://api.github.com'
  const response = await fetch(`${origin}/repos/${slug}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(DEADLINE_MS),
  })
  if (!response.ok) return undefined

  const { tag_name } = (await response.json()) as { tag_name?: string }
  if (!tag_name) return undefined

  const version = tag_name.replace(/^v/, '')
  await cacheSet(CACHE_KEY, version, DAY_MS)
  // Flushed here rather than left to the command: `withContext` persists the cache in a
  // `finally` that has already run by the time this notice does, so a write made now
  // would be marked dirty and never reach the disk — and the call would repeat on every
  // single command instead of once a day.
  await cacheFlush()
  return version
}

/**
 * `owner/repo` read out of the clone's own config, so a fork checks its own source rather
 * than being told about releases it does not carry. Parsed as a file: reading the config
 * is not running Git.
 */
function originSlug(root: string): string | undefined {
  const config = resolve(root, '.git', 'config')
  if (!existsSync(config)) return undefined

  const url = /url\s*=\s*(\S+github\.com\S+)/.exec(readFileSync(config, 'utf8'))?.[1]
  return url?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
}

/** Numeric comparison, so 1.10.0 is not read as older than 1.9.0. */
function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]

  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}
