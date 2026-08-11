import { color } from '../../lib/color.ts'
import { withContext, type Context } from '../../lib/context.ts'
import { listTypes, searchObjects } from '../../lib/objects.ts'
import { info, json, out } from '../../lib/output.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { buildGraph } from '../../model/graph.ts'
import { PROJECT_TYPE_KEY, TICKET_TYPE_KEY, toIssue, type Issue } from '../../model/issue.ts'
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

  const [tickets, projects] = await Promise.all([
    searchObjects(context.api, context.spaceId, { types: [TICKET_TYPE_KEY] }),
    searchObjects(context.api, context.spaceId, { types: [PROJECT_TYPE_KEY] }),
  ])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const issues = tickets.map(toIssue)

  // The graph is built on **every** issue, not on the filtered rows: a blocker may
  // live outside the folder scope or outside a state filter.
  const graph = buildGraph(issues)

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
    await explainEmptiness(context, tickets.length + projects.length)
    return
  }

  out(renderTable(rows))
  reportDiagnostics(rows, graph)
  info(color.dim(`${rows.length} issue${rows.length > 1 ? 's' : ''}`))
}

/**
 * A space that was never bootstrapped returns zero results, exactly like an empty
 * one. Telling them apart costs one call, here only, where there is nothing to
 * display anyway.
 */
async function explainEmptiness(context: Context, objectCount: number): Promise<void> {
  if (objectCount === 0) {
    const missing = missingTypes(await listTypes(context.api, context.spaceId))
    if (missing.length > 0) throw spaceNotInitialised(missing, context.spaceName)
  }
  info(color.dim('No issue matches.'))
}
