import { flagBool } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { loadConfig } from '../../lib/config.ts'
import { withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { listTickets } from '../../lib/issues.ts'
import { updateObject } from '../../lib/objects.ts'
import { definitionList, info, json, out, success } from '../../lib/output.ts'
import { findProject } from '../../lib/projects.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { PROJECT_PROP } from '../../model/issue.ts'
import { computeProgress, issuesOfProject, toProject } from '../../model/project.ts'
import type { CommandContext } from '../../router.ts'

/**
 * Recomputes and writes a project's progress.
 *
 * Formula from docs/ANYTYPE-LIMITS.md §3.4: done / (total − cancelled − backlog).
 * Backlog and Canceled leave the denominator because they do not represent committed
 * work — that is what makes the percentage measure progress on the work taken on,
 * rather than the size of the backlog.
 */
export async function projectStats(ctx: CommandContext): Promise<void> {
  const given = ctx.args.positionals.join(' ').trim()

  // The current folder supplies the project when it is not named.
  const scope = resolveScope(await loadConfig(), { explicit: given || undefined })
  const name = scope.project
  if (!name) {
    throw usageError(
      'Missing project name.',
      'Usage: `atl project stats "<name>" [--dry-run]`, or link the folder with `atl project link <project>`.',
    )
  }

  const dryRun = flagBool(ctx.args, 'dry-run')

  await withContext(ctx.json, async (context) => {
    const notice = scopeNotice(scope)
    if (notice) info(color.dim(notice))

    const found = await findProject(context, name)
    const project = toProject(found.object)

    const issues = issuesOfProject(await listTickets(context), project.id)
    const computed = computeProgress(issues)

    const changed = project.progress !== computed.percent
    if (changed && !dryRun) {
      await updateObject(context.api, context.spaceId, project.id, {
        properties: [{ key: PROJECT_PROP.progress, number: computed.percent }],
      })
    }

    if (context.json) {
      json({
        name: project.name,
        id: project.id,
        stored: project.progress ?? null,
        computed: computed.percent,
        changed,
        written: changed && !dryRun,
        dryRun,
        done: computed.done,
        denominator: computed.denominator,
        total: issues.length,
        excluded: computed.excluded,
      })
      return
    }

    const headline = changed
      ? `${color.dim(`${project.progress ?? '–'} %`)} → ${color.bold(`${computed.percent} %`)}`
      : `${color.bold(`${computed.percent} %`)} ${color.dim('(unchanged)')}`

    if (changed && !dryRun) success(`${color.bold(project.name)} — ${headline}`)
    else info(`${color.bold(project.name)} — ${headline}${dryRun && changed ? color.dim(' · nothing written') : ''}`)

    out(
      definitionList([
        ['Done', String(computed.done)],
        [
          'Denominator',
          `${computed.denominator} ${color.dim(
            `(${issues.length} issues − ${computed.excluded.backlog} backlog − ${computed.excluded.canceled} cancelled)`,
          )}`,
        ],
      ]),
    )
  })
}
