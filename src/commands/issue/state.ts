import { flagBool, flagString } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { findIssue, listTickets } from '../../lib/issues.ts'
import { updateObject } from '../../lib/objects.ts'
import { reportProgress, syncProgress, withState } from '../../lib/progress.ts'
import { info, json, out, success, table, type Column } from '../../lib/output.ts'
import { findProject } from '../../lib/projects.ts'
import { resolveTagId, resolveTagName } from '../../lib/resolve.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { paintState, stateEmoji, stateIcon, type StateKey , stateLabel} from '../../model/enums.ts'
import { displayRef, PROP, toIssue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

/**
 * State transitions. Every change also aligns the issue icon with the tag colour, so
 * the marker stays readable inside Anytype.
 */
export function transition(target: StateKey) {
  return async (ctx: CommandContext): Promise<void> => {
    const reference = ctx.args.positionals[0]
    if (!reference) {
      throw usageError(
        'Missing issue reference.',
        'From a branch: `atl issue done "$(git branch --show-current)"`.',
      )
    }

    await withContext(ctx.json, async (context) => {
      await applyTransition(context, reference, target)
    })
  }
}

async function applyTransition(
  context: Context,
  reference: string,
  target: StateKey,
): Promise<void> {
  const { issue, tickets } = await findIssue(context, reference)
  const from = issue.state

  if (from === target) {
    if (context.json) {
      json({ ref: displayRef(issue), from: issue.stateName ?? null, to: issue.stateName ?? stateLabel(target), changed: false })
      return
    }
    info(`${color.dim(displayRef(issue))} is already ${paintState(target, stateLabel(target))}.`)
    return
  }

  const tagId = await resolveTagId(context.api, context.spaceId, PROP.state, target)
  // The name the space displays, not the seed name: on a renamed space the two differ,
  // and the CLI must not announce a value the application does not show.
  const toName =
    (await resolveTagName(context.api, context.spaceId, PROP.state, target)) ?? stateLabel(target)
  await updateObject(context.api, context.spaceId, issue.id, {
    icon: { format: 'emoji', emoji: stateEmoji(target) },
    properties: [{ key: PROP.state, select: tagId }],
  })

  // Progress is derived: leaving it wrong until the next `project stats` would mean
  // displaying a figure known to be stale.
  const written = await syncProgress(
    context,
    withState(tickets.map(toIssue), issue.id, target),
    issue.projectIds,
  )

  if (context.json) {
    json({
      ref: displayRef(issue),
      from: issue.stateName ?? null,
      to: toName,
      changed: true,
      progress: written,
    })
    return
  }

  success(
    `${stateEmoji(target)} ${color.cyan(displayRef(issue))} — ${paintState(from, issue.stateName ?? '–')} → ${paintState(target, toName)}`,
  )
  reportProgress(written)
}

// ------------------------------------------------------------ icon catch-up

type IconRow = {
  ref: string
  title: string
  state: string | undefined
  stateName: string | undefined
  from: string
  to: string
}

/**
 * Realigns icons with states. Useful for issues created before the convention
 * existed, or edited directly in the app.
 *
 * **A bulk write, so a scope is mandatory.** The "icon = state colour" convention
 * holds for one project, not for a whole space: elsewhere, a personal icon may carry
 * meaning. Without scope and without `--project`, the command refuses rather than
 * overwrite (docs/ANYTYPE-LIMITS.md §3.2).
 */
export async function issueIcons(ctx: CommandContext): Promise<void> {
  const dryRun = flagBool(ctx.args, 'dry-run')
  const everywhere = flagBool(ctx.args, 'all-projects')

  await withContext(ctx.json, async (context) => {
    const scope = everywhere
      ? { project: undefined, source: 'none' as const }
      : resolveScope(context.config, { explicit: flagString(ctx.args, 'project') })

    if (!scope.project && !everywhere) {
      throw usageError(
        'No target project: this command writes in bulk.',
        'Link the folder (`atl project link <project>`), pass `--project`, or take on the whole space with `--all-projects`.',
      )
    }

    const notice = scopeNotice(scope)
    if (notice) info(color.dim(notice))

    const projectId = scope.project ? (await findProject(context, scope.project)).id : undefined
    const tickets = await listTickets(context)

    const rows: (IconRow & { id: string })[] = []
    for (const object of tickets) {
      const issue = toIssue(object)
      if (projectId && !issue.projectIds.includes(projectId)) continue
      if (!issue.state) continue

      const expected = stateEmoji(issue.state as StateKey)
      const current = object.icon?.emoji
      if (!expected || current === expected) continue

      rows.push({
        id: issue.id,
        ref: displayRef(issue),
        title: issue.title,
        state: issue.state,
        stateName: issue.stateName,
        from: current ?? '–',
        to: expected,
      })
    }

    if (!dryRun) {
      for (const row of rows) {
        await updateObject(context.api, context.spaceId, row.id, {
          icon: { format: 'emoji', emoji: row.to },
        })
      }
    }

    if (context.json) {
      json({ dryRun, updated: rows.map(({ id, ...rest }) => ({ id, ...rest })) })
      return
    }

    if (rows.length === 0) {
      info(color.dim('Every icon is already aligned with its state.'))
      return
    }

    out(table(rows, ICON_COLUMNS))
    info(
      color.dim(
        `${rows.length} icon${rows.length > 1 ? 's' : ''} ${dryRun ? 'to realign' : 'realigned'}`,
      ),
    )
  })
}

const ICON_COLUMNS: readonly Column<IconRow>[] = [
  { header: 'REF', value: (r) => r.ref, render: (r) => color.cyan(r.ref), flex: 1 },
  { header: 'STATE', value: (r) => `${stateIcon(r.state)} ${stateLabel(r.state, r.stateName)}`, render: (r) => paintState(r.state, `${stateIcon(r.state)} ${stateLabel(r.state, r.stateName)}`) },
  { header: 'ICON', value: (r) => `${r.from} → ${r.to}` },
  { header: 'TITLE', value: (r) => r.title, flex: 4 },
]
