import { flagBool, flagString } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { findIssue } from '../../lib/issues.ts'
import { updateObject } from '../../lib/objects.ts'
import { listProjects } from '../../lib/projects.ts'
import { info, json, success, warn } from '../../lib/output.ts'
import { resolveTagId, resolveTagName } from '../../lib/resolve.ts'
import { slugify } from '../../lib/text.ts'
import { isSettled, paintState, stateEmoji, type StateKey, stateLabel } from '../../model/enums.ts'
import { buildGraph } from '../../model/graph.ts'
import { branchUrl, displayRef, PROJECT_PROP, PROP, toIssue, type Issue } from '../../model/issue.ts'
import { propUrl } from '../../model/object.ts'
import type { CommandContext } from '../../router.ts'

const TARGET: StateKey = 'in_progress'

/**
 * The key workflow, Linear's equivalent: move the issue to In Progress and record the
 * branch name to use.
 *
 * **The CLI does not talk to Git.** It looks at neither whether we are inside a
 * repository, nor which branch, nor whether that branch exists: it drives Anytype,
 * full stop. The branch name is a *convention of the issue*, not an observation of
 * the repository — exactly like Linear, which shows the name before the branch exists
 * and will never create it for you. If the developer picks another name, that is
 * their choice.
 */
export async function issueStart(ctx: CommandContext): Promise<void> {
  const reference = ctx.args.positionals[0]
  if (!reference) {
    throw usageError(
      'Missing issue reference.',
      'Usage: `atl issue start <ref>`. From a branch: `atl issue start "$(git branch --show-current)"`.',
    )
  }

  const noBranch = flagBool(ctx.args, 'no-branch')
  const forced = flagString(ctx.args, 'branch')

  await withContext(ctx.json, async (context) => {
    const { issue, tickets } = await findIssue(context, reference)
    warnIfBlocked(issue, tickets)

    // The name the space displays for the target state, rather than the seed name:
    // the two differ once the owner has renamed a tag.
    const targetName =
      (await resolveTagName(context.api, context.spaceId, PROP.state, TARGET)) ?? stateLabel(TARGET)

    const branch = noBranch ? undefined : (forced ?? branchName(issue))
    const repo = branch ? await projectRepo(context, issue) : undefined
    const url = branchUrl(repo, branch)

    const properties: unknown[] = [
      {
        key: PROP.state,
        select: await resolveTagId(context.api, context.spaceId, PROP.state, TARGET),
      },
    ]
    if (branch) {
      properties.push({ key: PROP.branch, text: branch })
      if (url) properties.push({ key: PROP.link, url })
    }

    await updateObject(context.api, context.spaceId, issue.id, {
      icon: { format: 'emoji', emoji: stateEmoji(TARGET) },
      properties,
    })

    if (context.json) {
      json({
        ref: displayRef(issue),
        from: issue.stateName ?? null,
        to: targetName,
        branch: branch ?? null,
        branchUrl: url ?? null,
      })
      return
    }

    const move =
      issue.state === TARGET
        ? `already ${paintState(TARGET, targetName)}`
        : `${paintState(issue.state, issue.stateName ?? '–')} → ${paintState(TARGET, targetName)}`
    success(`${stateEmoji(TARGET)} ${color.cyan(displayRef(issue))} — ${move}`)

    if (!branch) return
    info(color.dim(`  branch: ${branch}`))
    if (url) info(color.dim(`  ${url}`))
  })
}

/** Branch name: the issue's `ref`, otherwise the slugified title (docs/ANYTYPE-LIMITS.md §3.7). */
function branchName(issue: Issue): string {
  const name = issue.ref ?? slugify(issue.title)
  if (!name) throw usageError('Cannot derive a branch name from this issue.')
  return name
}

async function projectRepo(context: Context, issue: Issue): Promise<string | undefined> {
  if (issue.projectIds.length === 0) return undefined

  const projects = await listProjects(context)
  for (const id of issue.projectIds) {
    const project = projects.find((p) => p.id === id)
    const repo = project ? propUrl(project.object, PROJECT_PROP.repo) : undefined
    if (repo) return repo
  }
  return undefined
}

function warnIfBlocked(issue: Issue, tickets: Parameters<typeof toIssue>[0][]): void {
  // Through the graph rather than `issue.blockedBy` alone: a relation posted in the
  // app fills only one side, and the warning is due in that case too.
  const blockers = buildGraph(tickets.map(toIssue))
    .blockersOf(issue.id)
    .map((link) => link.issue)
    .filter((blocker): blocker is Issue => blocker !== undefined && !isSettled(blocker.state))

  if (blockers.length === 0) return

  warn(`This issue is still blocked by ${blockers.length} unfinished issue(s):`)
  for (const blocker of blockers) {
    info(color.dim(`    ${displayRef(blocker)} — ${blocker.title} (${blocker.state ?? '–'})`))
  }
}
