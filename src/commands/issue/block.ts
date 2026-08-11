import { flagString } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { AtlError, ExitCode, usageError } from '../../lib/errors.ts'
import { listTickets, resolveIn } from '../../lib/issues.ts'
import { updateObject } from '../../lib/objects.ts'
import { info, json, success, warn } from '../../lib/output.ts'
import { displayRef, PROP, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

/**
 * Blocked-by / blocks relations.
 *
 * Anytype **does not maintain the reciprocal**: setting `A.blocked_by = [B]` leaves
 * `B.blocking` empty — verified on the real space. The CLI therefore writes both
 * sides, otherwise `atl issue view` on B would not show that it blocks A.
 */
export function blockCommand(remove: boolean) {
  return async (ctx: CommandContext): Promise<void> => {
    const reference = ctx.args.positionals[0]
    if (!reference) {
      throw usageError(
        'Missing issue reference.',
        'Usage: `atl issue block <ref> --by <ref2>` or `--blocks <ref2>`.',
      )
    }

    const by = flagString(ctx.args, 'by')
    const blocks = flagString(ctx.args, 'blocks')

    if ((by && blocks) || (!by && !blocks)) {
      throw usageError(
        'Give exactly one direction: `--by` or `--blocks`.',
        '`--by <ref2>`: this issue is blocked by ref2. `--blocks <ref2>`: it blocks ref2.',
      )
    }

    await withContext(ctx.json, async (context) => {
      await apply(context, { reference, other: (by ?? blocks) as string, blockedBy: Boolean(by), remove })
    })
  }
}

type Request = {
  reference: string
  other: string
  /** True for `--by`: the reference is blocked by the other one. */
  blockedBy: boolean
  remove: boolean
}

async function apply(context: Context, request: Request): Promise<void> {
  // A single search for both references: that is the expensive call.
  const tickets = await listTickets(context)
  const subject = resolveIn(tickets, request.reference)
  const other = resolveIn(tickets, request.other)

  if (subject.issue.id === other.issue.id) {
    throw usageError('An issue cannot block itself.')
  }

  // The subject's side, then the reciprocal one.
  const near = request.blockedBy ? PROP.blockedBy : PROP.blocking
  const far = request.blockedBy ? PROP.blocking : PROP.blockedBy

  if (!request.remove) guardAgainstCycle(subject.issue, other.issue, request.blockedBy)

  const nearIds = links(subject.issue, near)
  const farIds = links(other.issue, far)

  const nextNear = request.remove
    ? nearIds.filter((id) => id !== other.issue.id)
    : [...new Set([...nearIds, other.issue.id])]
  const nextFar = request.remove
    ? farIds.filter((id) => id !== subject.issue.id)
    : [...new Set([...farIds, subject.issue.id])]

  const changed = nextNear.length !== nearIds.length || nextFar.length !== farIds.length
  if (!changed) {
    if (context.json) {
      json({ ref: displayRef(subject.issue), other: displayRef(other.issue), changed: false })
      return
    }
    info(color.dim('This relation already exists.'))
    return
  }

  await updateObject(context.api, context.spaceId, subject.issue.id, {
    properties: [{ key: near, objects: nextNear }],
  })

  // If the reciprocal fails the graph is half-posted: say so, the command being
  // safe to replay.
  try {
    await updateObject(context.api, context.spaceId, other.issue.id, {
      properties: [{ key: far, objects: nextFar }],
    })
  } catch (error) {
    throw new AtlError(
      'The reciprocal side could not be written: the relation is incomplete.',
      ExitCode.error,
      `Run the same command again — it is replayable. (${(error as Error).message})`,
    )
  }

  if (context.json) {
    json({
      ref: displayRef(subject.issue),
      other: displayRef(other.issue),
      direction: request.blockedBy ? 'blocked-by' : 'blocks',
      removed: request.remove,
      changed: true,
    })
    return
  }

  const relation = request.blockedBy
    ? request.remove
      ? 'is no longer blocked by'
      : 'is blocked by'
    : request.remove
      ? 'no longer blocks'
      : 'blocks'
  success(
    `${color.cyan(displayRef(subject.issue))} ${relation} ${color.cyan(displayRef(other.issue))}`,
  )
}

/**
 * Refuses the direct cycle: "A blocks B" and "B blocks A" at once would empty the
 * notion of blocking of its meaning. Longer cycles are not looked for.
 */
function guardAgainstCycle(subject: Issue, other: Issue, blockedBy: boolean): void {
  const opposite = blockedBy ? subject.blocking : subject.blockedBy
  if (!opposite.includes(other.id)) return

  throw usageError(
    `Contradictory relation: ${displayRef(subject)} and ${displayRef(other)} would block each other.`,
    'Remove the inverse relation first with `atl issue unblock`.',
  )
}

function links(issue: Issue, key: string): string[] {
  return key === PROP.blockedBy ? [...issue.blockedBy] : [...issue.blocking]
}

export const issueBlock = blockCommand(false)
export const issueUnblock = blockCommand(true)
