import { color } from '../../lib/color.ts'
import { withContext, type Context } from '../../lib/context.ts'
import { searchIssues } from '../../lib/issue-search.ts'
import { listTypes } from '../../lib/objects.ts'
import { info, json, out } from '../../lib/output.ts'
import { listProjects } from '../../lib/projects.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { buildGraph } from '../../model/graph.ts'
import { toIssue, type Issue } from '../../model/issue.ts'
import { missingTypes, spaceNotInitialised } from '../../model/schema.ts'
import type { CommandContext } from '../../router.ts'
import { applyFilters, parseFilters, type Filters } from './list-filters.ts'
import { pick, renderTable, reportDiagnostics, type Row } from './list-view.ts'

export async function issueList(ctx: CommandContext): Promise<void> {
  // Filters are validated before opening a context: a typo must not cost a network
  // call.
  const filters = parseFilters(ctx.args)

  await withContext(ctx.json, (context) => run(context, filters))
}

async function run(context: Context, filters: Filters): Promise<void> {
  // Folder scope applies unless --all-projects, and announces itself: invisible
  // filtering would make the space look smaller than it is.
  const scope = filters.allProjects
    ? { project: undefined, source: 'none' as const }
    : resolveScope(context.config, { explicit: filters.project })

  const notice = scopeNotice(scope)
  if (notice) info(color.dim(notice))

  // Projects first: the project filter is pushed as ids, and a space with none is the
  // sign to check it was bootstrapped before searching on properties it may not have.
  const projects = await listProjects(context)
  if (projects.length === 0) await requireBootstrapped(context)

  const { matches: tickets, universe } = await searchIssues(
    context,
    {
      states: filters.states,
      priorities: filters.priorities,
      labels: filters.labels,
      project: scope.project,
      includeSettled: filters.all,
    },
    projects,
  )

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const issues = tickets.map(toIssue)

  // The graph is built on the matches **and** every unsettled issue, not on the rows
  // alone: a blocker may live outside the folder scope or outside a state filter.
  const graph = buildGraph(universe.map(toIssue))

  const all: Row[] = tickets.map((object, index) => {
    const issue = issues[index] as Issue
    return {
      ...issue,
      projects: issue.projectIds.map((id) => projectName.get(id) ?? '?'),
      icon: object.icon?.emoji,
      blocked: graph.isBlocked(issue.id),
    }
  })

  const rows = applyFilters(all, filters, scope.project)

  if (context.json) {
    json(rows.map((r) => pick(r, filters.fields)))
    return
  }

  if (rows.length === 0) {
    info(color.dim('No issue matches.'))
    return
  }

  out(renderTable(rows))
  reportDiagnostics(rows, graph)
  info(color.dim(`${rows.length} issue${rows.length > 1 ? 's' : ''}`))
}

/**
 * A space that was never bootstrapped has no `state` property to filter on, and the
 * API answers that with an opaque 400 rather than an empty list.
 */
async function requireBootstrapped(context: Context): Promise<void> {
  const missing = missingTypes(await listTypes(context.api, context.spaceId))
  if (missing.length > 0) throw spaceNotInitialised(missing, context.spaceName)
}
