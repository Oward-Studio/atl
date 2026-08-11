import { color } from '../lib/color.ts'
import { usageError } from '../lib/errors.ts'
import { normalize } from '../lib/text.ts'
import type { TagColor } from './palette.ts'

/**
 * States and priorities are **identified by their tag key**, never by their display
 * name.
 *
 * A tag renamed in the application keeps its key — measured, and the reason this
 * module works that way: the owner renamed the six states to English and every
 * name-based comparison in the CLI broke at once (docs/ANYTYPE-LIMITS.md §1.13).
 * Display names belong to whoever owns the space; keys are the contract.
 *
 * Keys are English, and so is everything the CLI writes. A space whose tags carry other
 * keys is not read: `atl init` seeds these, and renaming a tag key in Anytype
 * propagates to every object carrying it (docs/ANYTYPE-LIMITS.md §1.13).
 */

export const STATE_KEYS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const
export type StateKey = (typeof STATE_KEYS)[number]

/**
 * Everything decided per state, in a single table: adding a state forces a decision
 * on every column, the compiler rejecting an incomplete entry.
 *
 * The derived lists come out of it instead of being maintained alongside — an
 * omission in one of those lists is what once dropped a state from the default view.
 */
type StateFacts = {
  /** Name given when bootstrapping a space. The owner may rename it afterwards. */
  seedName: string
  /** Narrow table glyph: the rendered width must stay 1. */
  icon: string
  paint: (text: string) => string
  /** Anytype object icon, set by the transition commands. */
  emoji: string
  /** Tag colour, when bootstrapping the space. */
  tag: TagColor
  /** Kept by the default view of `atl issue list`. */
  active: boolean
  /** Closed: blocks nothing any more. */
  settled: boolean
  /** Counted in the progress denominator. */
  counted: boolean
}

const STATE_FACTS: Record<StateKey, StateFacts> = {
  backlog:     { seedName: 'Backlog',     icon: '○', paint: color.grey,    emoji: '⚪', tag: 'grey',   active: true,  settled: false, counted: false },
  todo:        { seedName: 'Todo',        icon: '◔', paint: color.blue,    emoji: '🔵', tag: 'blue',   active: true,  settled: false, counted: true  },
  in_progress: { seedName: 'In Progress', icon: '◑', paint: color.yellow,  emoji: '🟡', tag: 'yellow', active: true,  settled: false, counted: true  },
  in_review:   { seedName: 'In Review',   icon: '◕', paint: color.magenta, emoji: '🟣', tag: 'purple', active: true,  settled: false, counted: true  },
  done:        { seedName: 'Done',        icon: '●', paint: color.green,   emoji: '🟢', tag: 'lime',   active: false, settled: true,  counted: true  },
  canceled:    { seedName: 'Canceled',    icon: '⊘', paint: color.grey,    emoji: '🔴', tag: 'red',    active: false, settled: true,  counted: false },
}

const facts = (state: string | undefined): StateFacts | undefined =>
  state !== undefined && state in STATE_FACTS ? STATE_FACTS[state as StateKey] : undefined

/** States kept by the default view of `atl issue list`. */
export const ACTIVE_STATES: readonly StateKey[] = STATE_KEYS.filter((k) => STATE_FACTS[k].active)

/** A closed issue blocks nothing any more. */
export function isSettled(state: string | undefined): boolean {
  return facts(state)?.settled === true
}

/** An issue outside the denominator does not weigh on project progress. */
export function isCounted(state: string | undefined): boolean {
  return facts(state)?.counted === true
}

/** Tag colour and seed name, for bootstrapping a space. */
export function stateSeed(state: StateKey): { name: string; color: TagColor } {
  return { name: STATE_FACTS[state].seedName, color: STATE_FACTS[state].tag }
}

/**
 * What a user may type. The Linear terms are accepted alongside the keys, so a habit
 * formed there carries over without having to check what the space displays today.
 */
const STATE_ALIASES: Record<string, StateKey> = {
  backlog: 'backlog',
  todo: 'todo',
  'to do': 'todo',
  started: 'in_progress',
  'in progress': 'in_progress',
  'in-progress': 'in_progress',
  wip: 'in_progress',
  review: 'in_review',
  'in review': 'in_review',
  'in-review': 'in_review',
  done: 'done',
  canceled: 'canceled',
  cancelled: 'canceled',
}

export const PRIORITY_KEYS = ['urgent', 'high', 'medium', 'low', 'none'] as const
export type PriorityKey = (typeof PRIORITY_KEYS)[number]

/**
 * The lowest priority is a **real tag** as much as an absence: an issue may carry it
 * explicitly or carry nothing at all. Both are treated the same.
 */
export const NO_PRIORITY: PriorityKey = 'none'

export function isNoPriority(priority: string | undefined): boolean {
  return priority === undefined || priority === NO_PRIORITY
}

type PriorityFacts = { seedName: string; icon: string; paint: (t: string) => string; tag: TagColor }

const PRIORITY_FACTS: Record<PriorityKey, PriorityFacts> = {
  urgent: { seedName: 'Urgent', icon: '▲', paint: color.red, tag: 'red' },
  high: { seedName: 'High', icon: '▰▰▰', paint: color.orange, tag: 'orange' },
  medium: { seedName: 'Medium', icon: '▰▰▱', paint: color.yellow, tag: 'yellow' },
  low: { seedName: 'Low', icon: '▰▱▱', paint: color.cyan, tag: 'blue' },
  none: { seedName: 'No priority', icon: '–', paint: color.grey, tag: 'grey' },
}

/** Tag colour and seed name, for bootstrapping a space. */
export function prioritySeed(priority: PriorityKey): { name: string; color: TagColor } {
  return { name: PRIORITY_FACTS[priority].seedName, color: PRIORITY_FACTS[priority].tag }
}

const PRIORITY_ALIASES: Record<string, PriorityKey> = {
  urgent: 'urgent',
  u: 'urgent',
  '1': 'urgent',
  high: 'high',
  h: 'high',
  '2': 'high',
  medium: 'medium',
  med: 'medium',
  m: 'medium',
  '3': 'medium',
  low: 'low',
  l: 'low',
  '4': 'low',
  none: 'none',
  'no priority': 'none',
  '0': 'none',
}

/**
 * Resolves what the user typed to a tag key. The seed names are accepted too, so a
 * space bootstrapped by `atl init` answers to what it displays.
 */
export function parseState(input: string): StateKey {
  const needle = normalize(input)

  const alias = STATE_ALIASES[needle]
  if (alias) return alias

  const seeded = STATE_KEYS.find((k) => normalize(STATE_FACTS[k].seedName) === needle)
  if (seeded) return seeded

  throw usageError(
    `Unknown state: "${input}".`,
    'Accepted values: backlog, todo, started, review, done, canceled.',
  )
}

export function parsePriority(input: string): PriorityKey {
  const needle = normalize(input)

  const alias = PRIORITY_ALIASES[needle]
  if (alias) return alias

  const seeded = PRIORITY_KEYS.find((k) => normalize(PRIORITY_FACTS[k].seedName) === needle)
  if (seeded) return seeded

  throw usageError(
    `Unknown priority: "${input}".`,
    'Accepted values: urgent, high, medium, low, none.',
  )
}

// ------------------------------------------------------------ display

/**
 * Display falls back on the seed name when the object carries no stored name, which
 * only happens for a value the CLI wrote without reading back.
 */
export function stateLabel(state: string | undefined, stored?: string): string {
  return stored ?? facts(state)?.seedName ?? '–'
}

export function stateEmoji(state: StateKey): string {
  return STATE_FACTS[state].emoji
}

export function stateIcon(state: string | undefined): string {
  return facts(state)?.icon ?? '·'
}

export function paintState(state: string | undefined, text: string): string {
  return (facts(state)?.paint ?? color.grey)(text)
}

const priorityFacts = (priority: string | undefined): PriorityFacts | undefined =>
  priority !== undefined && priority in PRIORITY_FACTS
    ? PRIORITY_FACTS[priority as PriorityKey]
    : undefined

export function priorityLabel(priority: string | undefined, stored?: string): string {
  return stored ?? (priorityFacts(priority)?.seedName ?? '–')
}

export function priorityIcon(priority: string | undefined): string {
  return priorityFacts(priority)?.icon ?? '–'
}

export function paintPriority(priority: string | undefined, text: string): string {
  return (priorityFacts(priority)?.paint ?? color.grey)(text)
}

/**
 * Sort order, distinct from `STATE_KEYS` — which follows the lifecycle and drives tag
 * creation and the interactive picker, where backlog-first is the sensible reading.
 *
 * Sorting answers another question: what deserves attention now. An issue awaiting
 * review is one step from done, so it comes first; the backlog is what nobody committed
 * to, so it comes last among the active states. Closed states trail behind, visible
 * only with `--all`.
 */
const STATE_SORT_ORDER: readonly StateKey[] = [
  'in_review',
  'in_progress',
  'todo',
  'backlog',
  'done',
  'canceled',
]

export function stateRank(state: string | undefined): number {
  const index = STATE_SORT_ORDER.indexOf(state as StateKey)
  return index === -1 ? STATE_SORT_ORDER.length : index
}

export function priorityRank(priority: string | undefined): number {
  const index = PRIORITY_KEYS.indexOf(priority as PriorityKey)
  return index === -1 ? PRIORITY_KEYS.length : index
}
