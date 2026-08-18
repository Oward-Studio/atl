import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { cacheFlush, cacheGet, cacheSet } from './cache.ts'
import { flag } from './env.ts'
import { color } from './color.ts'
import { notice } from './output.ts'

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
/**
 * A lookup that failed is cached too, for an hour rather than a day. Without it a private
 * repository, a repository with no release yet, or an exhausted anonymous rate limit — 60
 * requests an hour — would make **every** command pay a request up to the deadline, which
 * is the opposite of what this cache is for. An hour bounds the damage while still
 * noticing when the cause goes away.
 */
const FAILURE_TTL_MS = 60 * 60 * 1000
const NOTHING = ''
const DEADLINE_MS = 1_500

/** Called after a command has run, so its own output comes first. Never throws. */
export async function notifyIfBehind(root: string): Promise<void> {
  try {
    if (!enabled()) return

    const local = declaredVersion(root)
    const latest = await latestRelease(root)
    if (!latest || !isNewer(latest, local)) return

    notice(color.yellow(`  atl ${latest} is available — you have ${local}. Run \`atl update\`.`))
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
  if (flag('ATL_NO_UPDATE_CHECK')) return false
  if (flag('ATL_UPDATE_CHECK')) return true
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
  if (cached !== undefined) return cached === NOTHING ? undefined : cached

  const slug = originSlug(root)
  if (slug === undefined) return undefined

  const version = await ask(slug)
  await remember(version ?? NOTHING, version === undefined ? FAILURE_TTL_MS : DAY_MS)
  return version
}

async function ask(slug: string): Promise<string | undefined> {
  // Overridable like `ATL_API_URL` is for Anytype, which is also what lets the suite
  // exercise this without reaching a host it does not control.
  const origin = process.env['ATL_UPDATE_ORIGIN'] ?? 'https://api.github.com'
  const response = await fetch(`${origin}/repos/${slug}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(DEADLINE_MS),
  })
  if (!response.ok) return undefined

  const { tag_name } = (await response.json()) as { tag_name?: string }
  return tag_name?.replace(/^v/, '')
}

async function remember(version: string, ttl: number): Promise<void> {
  await cacheSet(CACHE_KEY, version, ttl)
  // Flushed here rather than left to the command: `withContext` persists the cache in a
  // `finally` that has already run by the time this notice does, so a write made now
  // would be marked dirty and never reach the disk — and the call would repeat on every
  // single command instead of once a day.
  await cacheFlush()
}

/**
 * `owner/repo` read out of the clone's own config, so a fork checks its own source rather
 * than being told about releases it does not carry. Parsed as a file: reading the config
 * is not running Git.
 */
function originSlug(root: string): string | undefined {
  const config = gitConfig(root)
  if (config === undefined) return undefined

  // Anchored on the origin section rather than taking the first GitHub URL in the file: a
  // clone whose origin is a mirror, with GitHub as a second remote, would otherwise be
  // told about releases `atl update` will never pull.
  // `[^[]*` runs to the next section header, `[` being what opens one and never appearing
  // in a URL. A lookahead for end-of-input would have wanted `\Z`, which JavaScript does
  // not have — writing it silently matched nothing and switched the feature off.
  const section = /^\[remote "origin"\][^[]*/m.exec(config)?.[0]
  const url = /^\s*url\s*=\s*(\S+)/m.exec(section ?? '')?.[1]
  if (!url?.includes('github.com')) return undefined

  return url.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
}

/**
 * `.git` is a directory in a normal clone and a **file** in a linked worktree, pointing at
 * the real one. Handling both keeps the notice working in a shape the guard would
 * otherwise silently skip.
 */
function gitConfig(root: string): string | undefined {
  const dotGit = resolve(root, '.git')
  if (!existsSync(dotGit)) return undefined

  try {
    if (statSync(dotGit).isFile()) {
      const pointer = /gitdir:\s*(.+)/.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
      if (!pointer) return undefined
      return readFileSync(resolve(root, pointer, 'config'), 'utf8')
    }
    return readFileSync(resolve(dotGit, 'config'), 'utf8')
  } catch {
    return undefined
  }
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
