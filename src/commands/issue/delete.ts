import { flagBool } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { listTickets, resolveIn } from '../../lib/issues.ts'
import { deleteObject } from '../../lib/objects.ts'
import { info, json, success } from '../../lib/output.ts'
import { reportProgress, syncProgress, without } from '../../lib/progress.ts'
import { confirm, isInteractive } from '../../lib/prompt.ts'
import { displayRef, toIssue, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

/**
 * Deleting issues — which Anytype implements as **archiving**: the object survives with
 * `archived: true`, body and properties intact, and stops appearing in searches
 * (docs/ANYTYPE-LIMITS.md §1.14). The output says so rather than claiming a destruction
 * that does not happen.
 *
 * No route back through the API, though: `permanently` is ignored, `archived: false`
 * answers OK and restores nothing, and there is no bin endpoint. Undoing means opening
 * the application. That is what the confirmation guards — not a loss, a trip out of the
 * terminal.
 *
 * Every reference is resolved **before** anything is removed, so a typo in the third
 * argument cannot cost the first two.
 */
export async function issueDelete(ctx: CommandContext): Promise<void> {
  const references = ctx.args.positionals
  if (references.length === 0) {
    throw usageError(
      'Missing issue reference.',
      'Usage: `atl issue delete <ref> [<ref>…]`, `--yes` to skip the confirmation.',
    )
  }

  await withContext(ctx.json, async (context) => {
    await deleteIssues(context, references, flagBool(ctx.args, 'yes'))
  })
}

async function deleteIssues(
  context: Context,
  references: readonly string[],
  yes: boolean,
): Promise<void> {
  const tickets = await listTickets(context)

  // Resolution first, for every reference: an unknown one exits 3 having deleted
  // nothing. Named twice, an issue is deleted once.
  const targets = new Map<string, Issue>()
  for (const reference of references) {
    const { issue } = resolveIn(tickets, reference)
    targets.set(issue.id, issue)
  }
  const issues = [...targets.values()]

  if (!(await approved(context, issues, yes))) {
    info('Nothing deleted.')
    return
  }

  for (const issue of issues) {
    await deleteObject(context.api, context.spaceId, issue.id)
  }

  // The percentage is derived from the issues that remain, so it has to be recomputed
  // from the list minus the deleted ones — every project any of them belonged to.
  const projectIds = [...new Set(issues.flatMap((issue) => issue.projectIds))]
  const written = await syncProgress(
    context,
    without(tickets.map(toIssue), new Set(targets.keys())),
    projectIds,
  )

  if (context.json) {
    // `archived`, not `deleted`: a script reading this should not believe the object
    // is gone from the space.
    json({
      archived: issues.map((issue) => ({ ref: displayRef(issue), title: issue.title })),
      progress: written,
    })
    return
  }

  for (const issue of issues) {
    success(`${color.cyan(displayRef(issue))} — ${issue.title}  ${color.dim('moved to the bin')}`)
  }
  // Said once, because the CLI cannot do it: removing an object for good, or putting it
  // back, happens in the application (docs/ANYTYPE-LIMITS.md §1.14).
  info(color.dim(`  Archived, not erased — emptying the bin is done in Anytype.`))
  reportProgress(written)
}

/**
 * `--json` implies a non-interactive caller, so it demands `--yes` like any other
 * script would: a command that blocked on a prompt no one can answer would hang a
 * pipeline instead of failing it.
 */
async function approved(context: Context, issues: readonly Issue[], yes: boolean): Promise<boolean> {
  if (yes) return true

  if (context.json || !isInteractive()) {
    throw usageError(
      'Deleting needs a confirmation, and there is no terminal to ask in.',
      'Pass `--yes` to confirm from a script.',
    )
  }

  for (const issue of issues) {
    info(`  ${color.cyan(displayRef(issue))} — ${issue.title}`)
  }
  const plural = issues.length > 1 ? `${issues.length} issues` : 'this issue'
  return confirm(`Send ${plural} to Anytype's bin?`)
}
