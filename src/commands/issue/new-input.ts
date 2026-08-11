import { flagBool, flagList, flagString, type ParsedArgs } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { usageError } from '../../lib/errors.ts'
import { info } from '../../lib/output.ts'
import { ask, choose, isInteractive } from '../../lib/prompt.ts'
import {
  parsePriority,
  parseState,
  STATE_KEYS,
  type PriorityKey,
  type StateKey,
} from '../../model/enums.ts'

/**
 * Where the issue to create comes from: the options, or a dialogue when the command is
 * called without a title from a terminal. Both produce the same `Draft`, which the rest
 * of the command consumes without knowing which one served.
 */

/**
 * An issue created by an explicit command is **committed** work: nobody types
 * `atl issue new` for something they do not intend to do. Backlog stays reachable
 * through `-s backlog`, to deliberately park a thought.
 *
 * Linear makes this a per-team setting; its answer to "not committed yet" is a
 * separate triage inbox, not a backlog by default.
 */
const DEFAULT_STATE: StateKey = 'todo'

export type Draft = {
  title: string
  description: string | undefined
  state: StateKey
  priority: PriorityKey | undefined
  label: string | undefined
  project: string | undefined
  criteria: string[]
  ref: string | undefined
  allProjects: boolean
}

/** Reads and validates the arguments, with no network. */
export function parseDraft(args: ParsedArgs): Draft | undefined {
  const title = args.positionals.join(' ').trim()

  if (!title) {
    if (!isInteractive()) {
      throw usageError(
        'Missing title.',
        'Usage: `atl issue new "<title>"`. Interactive mode needs a terminal.',
      )
    }
    return undefined
  }

  const priority = flagString(args, 'priority')
  const state = flagString(args, 'state')

  return {
    title,
    description: flagString(args, 'description'),
    state: state ? parseState(state) : DEFAULT_STATE,
    priority: priority ? parsePriority(priority) : undefined,
    label: flagString(args, 'label'),
    project: flagString(args, 'project'),
    criteria: flagList(args, 'ac'),
    ref: flagString(args, 'ref'),
    allProjects: flagBool(args, 'all-projects'),
  }
}

// ------------------------------------------------------------ interactive

export async function promptDraft(): Promise<Draft> {
  const title = await ask('Title:')
  if (!title) throw usageError('Empty title.')

  const description = (await ask('Description (empty for none):')) || undefined
  const state = await choose('Initial state?', STATE_KEYS, (s) => s)
  const priorityInput = await ask('Priority (empty for none):')
  const project = (await ask('Project (empty for none):')) || undefined

  info(color.dim('Acceptance criteria, one per line. Empty line to finish.'))
  const criteria: string[] = []
  for (;;) {
    const criterion = await ask(`  ${criteria.length + 1}.`)
    if (!criterion) break
    criteria.push(criterion)
  }

  return {
    title,
    description,
    state,
    priority: priorityInput ? parsePriority(priorityInput) : undefined,
    label: undefined,
    project,
    criteria,
    ref: undefined,
    allProjects: false,
  }
}
