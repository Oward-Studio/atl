import { color } from '../../lib/color.ts'
import { loadConfig } from '../../lib/config.ts'
import { withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { listTickets } from '../../lib/issues.ts'
import { definitionList, info, json, out } from '../../lib/output.ts'
import { findProject } from '../../lib/projects.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { paintPriority, paintState, priorityIcon, stateIcon, STATE_KEYS,
  stateLabel,
} from '../../model/enums.ts'
import { displayRef, type Issue } from '../../model/issue.ts'
import { computeProgress, countByState, issuesOfProject, toProject } from '../../model/project.ts'
import type { CommandContext } from '../../router.ts'

export async function projectView(ctx: CommandContext): Promise<void> {
  const given = ctx.args.positionals.join(' ').trim()

  // The current folder supplies the project when it is not named.
  const scope = resolveScope(await loadConfig(), { explicit: given || undefined })
  const name = scope.project
  if (!name) {
    throw usageError(
      'Missing project name.',
      'Usage: `atl project view "<name>"`, or link the folder with `atl project link <project>`.',
    )
  }

  await withContext(ctx.json, async (context) => {
    const notice = scopeNotice(scope)
    if (notice) info(color.dim(notice))

    const found = await findProject(context, name)
    const project = toProject(found.object)

    const issues = issuesOfProject(await listTickets(context), project.id)
    const counts = countByState(issues)
    const computed = computeProgress(issues)

    if (context.json) {
      json({
        name: project.name,
        id: project.id,
        state: project.stateName ?? null,
        progress: project.progress ?? null,
        computedProgress: computed.percent,
        repo: project.repo ?? null,
        tickets: {
          total: counts.total,
          active: counts.active,
          byState: counts.byState,
        },
        issues: issues.map((i) => ({
          ref: i.ref ?? null,
          title: i.title,
          state: i.stateName ?? null,
          priority: i.priority ?? null,
        })),
      })
      return
    }

    out('')
    out(color.bold(project.name))
    out('')
    out(
      definitionList([
        ['State', paintState(project.state, `${stateIcon(project.state)} ${stateLabel(project.state, project.stateName)}`)],
        ['Progress', progressLine(project.progress, computed.percent)],
        ['Issues', `${counts.total} in total, ${counts.active} active`],
        ['Repo', project.repo ?? color.grey('–')],
      ]),
    )

    for (const state of STATE_KEYS) {
      const group = issues.filter((i) => i.state === state)
      if (group.length === 0) continue

      out('')
      const label = stateLabel(state, group[0]?.stateName)
      out(`${paintState(state, `${stateIcon(state)} ${label}`)} ${color.dim(`(${group.length})`)}`)
      for (const issue of group) out(`  ${line(issue)}`)
    }

    const orphans = issues.filter((i) => !STATE_KEYS.includes(i.state as never))
    if (orphans.length > 0) {
      out('')
      out(color.grey(`· No state (${orphans.length})`))
      for (const issue of orphans) out(`  ${line(issue)}`)
    }

    out('')
  })
}

/**
 * The progress shown is the one **stored** in Anytype. Any gap with the current
 * computation is reported rather than quietly fixed: writing is `atl project stats`'
 * job.
 */
function progressLine(stored: number | undefined, computed: number): string {
  if (stored === undefined) {
    return `${color.grey('not set')} ${color.dim(`(computed: ${computed} %)`)}`
  }
  if (stored === computed) return `${stored} %`

  return `${stored} % ${color.yellow(`≠ ${computed} % computed`)} ${color.dim('— `atl project stats` to recompute')}`
}

function line(issue: Issue): string {
  const priority = paintPriority(issue.priority, priorityIcon(issue.priority))
  return `${priority}  ${color.cyan(displayRef(issue).padEnd(28))} ${issue.title}`
}
