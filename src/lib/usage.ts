import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'

import { usageDir, usageFile } from './paths.ts'

/**
 * Usage accounting, for `atl gain`.
 *
 * Two volumes measured per invocation: **absorbed**, what the API returns, and
 * **rendered**, what `atl` writes. The saving does not follow directly from those —
 * it is counted against a per-command baseline, capped twice. The method, the
 * baselines and how they were obtained live in docs/ANYTYPE-LIMITS.md §3.8.
 *
 * Counted in characters rather than bytes: an `é` weighs two bytes for a single
 * character, and it is the character that matters to a tokenizer.
 */

/** Divisor of `rtk`'s heuristic: 4 characters per token. */
export const CHARS_PER_TOKEN = 4

/** Cost of one object read through MCP, type schema included (docs/ANYTYPE-LIMITS.md §3.8). */
export const BASELINE_OBJECT_TOKENS = 1_964

/**
 * Ceiling for a baseline, per invocation.
 *
 * **A convention, not a measurement.** Without it, `atl ls` on this space counts
 * 261,000 tokens of baseline: the volume is real — `search-space` returns whole
 * objects, with no projection available — but nobody would ever have paid that
 * price, because a response that size fits in no context. The MCP alternative was
 * not expensive, it was **impossible**, and counting the impossible as a saving
 * flatters the figure.
 *
 * 50,000 tokens: a quarter of a 200,000 context, already far more than one would
 * spend on a single tool response. Generous on purpose — the ceiling exists to
 * correct the absurd, not to trim the plausible.
 */
export const BASELINE_CEILING_TOKENS = 50_000

/**
 * How many objects an MCP agent would have had to bring into its context for the
 * same intent. A command missing from here necessarily reads a set (search,
 * statistics): its baseline is then the absorbed volume itself, since the API cannot
 * return less.
 */
const OBJECT_TRIPS: Record<string, number> = {
  'issue view': 1,
  'issue new': 2,
  'issue edit': 2,
  'issue ac': 2,
  'issue start': 2,
  'issue todo': 2,
  'issue review': 2,
  'issue done': 2,
  'issue cancel': 2,
  'issue backlog': 2,
  'issue block': 3,
  'issue unblock': 3,
  'project new': 2,
  'project link': 1,
}

/**
 * Baseline for one invocation, in tokens. Two bounds, for two distinct reasons:
 * never more than what actually travelled, and never more than a context could have
 * absorbed.
 */
export function baselineOf(entry: Record_): number {
  const absorbed = tokens(entry.in)
  const trips = OBJECT_TRIPS[entry.cmd]
  const intent = trips === undefined ? absorbed : trips * BASELINE_OBJECT_TOKENS

  return Math.min(absorbed, intent, BASELINE_CEILING_TOKENS)
}

/** True when this invocation's baseline was brought down to the ceiling. */
export function isCapped(entry: Record_): boolean {
  const absorbed = tokens(entry.in)
  const trips = OBJECT_TRIPS[entry.cmd]
  const intent = trips === undefined ? absorbed : trips * BASELINE_OBJECT_TOKENS

  return Math.min(absorbed, intent) > BASELINE_CEILING_TOKENS
}

export type Record_ = {
  /** ISO timestamp, truncated to the second. */
  at: string
  /** Command invoked, without arguments: `issue list`, not the ref targeted. */
  cmd: string
  /** Characters returned by the Anytype API. */
  in: number
  /** Characters written by `atl`. */
  out: number
  /** Number of HTTP requests. */
  calls: number
  ms: number
}

let absorbed = 0
let rendered = 0
let calls = 0

export function countApi(chars: number): void {
  absorbed += chars
  calls += 1
}

export function countOutput(chars: number): void {
  rendered += chars
}

export function meter(): { absorbed: number; rendered: number; calls: number } {
  return { absorbed, rendered, calls }
}

/** Reset, for tests: the module holds process-wide state. */
export function resetMeter(): void {
  absorbed = 0
  rendered = 0
  calls = 0
}

/** True when the user disabled recording. */
export function disabled(): boolean {
  const value = process.env['ATL_NO_USAGE']
  return value !== undefined && value !== '' && value !== '0'
}

/**
 * Appends a line to the journal, if the command talked to the API.
 *
 * Purely local commands (`--help`, `cache clear`, `project link`) are left out:
 * without an API call there is no absorbed volume, and counting them would produce a
 * negative saving — their output would be a cost with no counterpart, when no MCP
 * call replaces them.
 *
 * Synchronous append: a hundred bytes at the end of a command, no prior read, so
 * nothing for the user to wait on.
 */
export function record(cmd: string, startedAt: number, now: number): void {
  if (disabled()) return

  const { absorbed: chars, rendered: written, calls: count } = meter()
  if (count === 0) return

  const line: Record_ = {
    at: new Date(now).toISOString().slice(0, 19) + 'Z',
    cmd,
    in: chars,
    out: written,
    calls: count,
    ms: Math.round(now - startedAt),
  }

  try {
    mkdirSync(usageDir(), { recursive: true, mode: 0o700 })
    appendFileSync(usageFile(), `${JSON.stringify(line)}\n`, { mode: 0o600 })
  } catch {
    // A lost statistic must never make a command fail.
  }
}

export type Totals = {
  invocations: number
  calls: number
  /** Measured: characters returned by the API, converted to tokens. */
  absorbed: number
  /** Measured: what entered the context. */
  rendered: number
  /** Calibrated: what the same intent would have cost through MCP, capped. */
  baseline: number
  /** Invocations whose baseline was brought down to the ceiling. */
  capped: number
  saved: number
  ratio: number
  since: string | undefined
}

export type PerCommand = Totals & { cmd: string }

export function tokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN)
}

export function readRecords(): Record_[] {
  let raw: string
  try {
    raw = readFileSync(usageFile(), 'utf8')
  } catch {
    return []
  }

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      // A truncated line — cut mid-write — must not lose the whole journal.
      try {
        const parsed = JSON.parse(line) as Record_
        return typeof parsed.in === 'number' && typeof parsed.out === 'number' ? [parsed] : []
      } catch {
        return []
      }
    })
}

export function aggregate(records: readonly Record_[]): Totals {
  const rendered = tokens(sum(records, (r) => r.out))
  const baseline = sum(records, baselineOf)

  return {
    invocations: records.length,
    calls: sum(records, (r) => r.calls),
    absorbed: tokens(sum(records, (r) => r.in)),
    rendered,
    baseline,
    capped: records.filter(isCapped).length,
    saved: baseline - rendered,
    ratio: baseline === 0 ? 0 : (baseline - rendered) / baseline,
    since: records.map((r) => r.at).sort()[0],
  }
}

export function byCommand(records: readonly Record_[]): PerCommand[] {
  const groups = new Map<string, Record_[]>()
  for (const entry of records) {
    const bucket = groups.get(entry.cmd)
    if (bucket) bucket.push(entry)
    else groups.set(entry.cmd, [entry])
  }

  return [...groups.entries()]
    .map(([cmd, group]) => ({ cmd, ...aggregate(group) }))
    .sort((a, b) => b.saved - a.saved)
}

const sum = <T>(items: readonly T[], of: (item: T) => number): number =>
  items.reduce((total, item) => total + of(item), 0)
