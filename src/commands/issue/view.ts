import { color } from '../../lib/color.ts'
import { withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { findIssue, loadBody, titleIndex } from '../../lib/issues.ts'
import { searchObjects } from '../../lib/objects.ts'
import { definitionList, json, out } from '../../lib/output.ts'
import { acProgress, parseBody, AC_HEADING, type Criterion } from '../../model/acceptance.ts'
import { isSettled, paintPriority, paintState, stateIcon,
  stateLabel,
  priorityLabel,
} from '../../model/enums.ts'
import { buildGraph, type Link } from '../../model/graph.ts'
import {
  branchUrl,
  displayRef,
  PROJECT_PROP,
  PROJECT_TYPE_KEY,
  toIssue,
  type Issue,
} from '../../model/issue.ts'
import { propUrl } from '../../model/object.ts'
import type { CommandContext } from '../../router.ts'

export async function issueView(ctx: CommandContext): Promise<void> {
  const reference = ctx.args.positionals[0]
  if (!reference) {
    throw usageError(
      'Missing issue reference.',
      'Usage: `atl issue view <ref>`. From a branch: `atl issue view "$(git branch --show-current)"`.',
    )
  }

  await withContext(ctx.json, async (context) => {
    const { object, issue, tickets } = await findIssue(context, reference)

    const [markdown, projects] = await Promise.all([
      loadBody(context, issue.id),
      searchObjects(context.api, context.spaceId, { types: [PROJECT_TYPE_KEY] }),
    ])

    const { description, criteria } = parseBody(markdown)
    const titles = titleIndex(tickets)
    const projectNames = new Map(projects.map((p) => [p.id, p.name]))

    // The branch link derives from the project's `repo`: nothing hardcoded.
    const repo = issue.projectIds
      .map((id) => projects.find((p) => p.id === id))
      .map((p) => (p ? propUrl(p, PROJECT_PROP.repo) : undefined))
      .find(Boolean)
    // The stored link wins: the caller replaces it with the pull request's, which
    // supersedes the branch. Failing that, derive it from the repo and the branch.
    const url = issue.link ?? branchUrl(repo, issue.branch)

    const related = (ids: readonly string[]): string[] =>
      ids.map((id) => titles.get(id) ?? id)

    // The issues are already loaded by `findIssue`: reading both directions of the
    // relation costs nothing and catches those posted on one side in the app.
    const graph = buildGraph(tickets.map(toIssue))
    const blockedBy = graph.blockersOf(issue.id)
    const blocking = graph.blockedOf(issue.id)

    if (context.json) {
      json({
        ref: issue.ref ?? null,
        id: issue.id,
        title: issue.title,
        state: issue.stateName ?? null,
        priority: issue.priorityName ?? null,
        label: issue.label ?? null,
        projects: issue.projectIds.map((id) => projectNames.get(id) ?? id),
        branch: issue.branch ?? null,
        branchUrl: url ?? null,
        blockedBy: blockedBy.map((l) => titles.get(l.id) ?? l.id),
        blocking: blocking.map((l) => titles.get(l.id) ?? l.id),
        description,
        acceptanceCriteria: criteria,
        updatedAt: issue.updatedAt ?? null,
      })
      return
    }

    out(render(issue, { description, criteria, projectNames, titles, url, blockedBy, blocking }))
  })
}

type RenderInput = {
  description: string
  criteria: Criterion[]
  projectNames: Map<string, string>
  titles: Map<string, string>
  url: string | undefined
  blockedBy: Link[]
  blocking: Link[]
}

function render(issue: Issue, input: RenderInput): string {
  const { description, criteria, projectNames, titles, url } = input
  const none = color.grey('–')

  const entries: [string, string][] = [
    ['State', paintState(issue.state, `${stateIcon(issue.state)} ${stateLabel(issue.state, issue.stateName)}`)],
    ['Priority', issue.priority ? paintPriority(issue.priority, priorityLabel(issue.priority, issue.priorityName)) : none],
    [
      'Project',
      issue.projectIds.length
        ? issue.projectIds.map((id) => projectNames.get(id) ?? id).join(', ')
        : none,
    ],
    ['Label', issue.label ?? none],
    ['Branch', issue.branch ? `${issue.branch}${url ? `\n${color.dim(url)}` : ''}` : none],
  ]

  // The linked issue's state is already known: showing it saves one more
  // `issue view` just to learn whether the block still holds.
  const relation = (link: Link): string => {
    const label = link.issue
      ? `${paintState(link.issue.state, stateIcon(link.issue.state))} ${displayRef(link.issue)} — ${link.issue.title}`
      : (titles.get(link.id) ?? link.id)
    return link.declared ? label : `${label} ${color.dim('(inferred: relation posted on one side only)')}`
  }

  /**
   * A blocker that is done or cancelled no longer blocks anything. Like Linear, the
   * relation is not deleted — it is history — it is **demoted** under `Related`, so an
   * issue does not look blocked by a cancelled one.
   *
   * A target that is not an issue stays in its section: its state is out of reach, and
   * demoting on a presumption is not done.
   */
  const closed = (link: Link): boolean => link.issue !== undefined && isSettled(link.issue.state)

  const blockers = input.blockedBy.filter((l) => !closed(l))
  const blocked = input.blocking.filter((l) => !closed(l))
  const related = [...input.blockedBy, ...input.blocking].filter(closed)

  if (blockers.length > 0) entries.push(['Blocked by', blockers.map(relation).join('\n')])
  if (blocked.length > 0) entries.push(['Blocks', blocked.map(relation).join('\n')])
  if (related.length > 0) entries.push(['Related', related.map(relation).join('\n')])

  const lines = [
    '',
    `${color.cyan(displayRef(issue))}  ${color.bold(issue.title)}`,
    '',
    definitionList(entries),
  ]

  if (description) {
    lines.push('', color.dim('Description'), '', description)
  }

  if (criteria.length > 0) {
    lines.push('', `${color.dim(AC_HEADING)}  ${color.bold(acProgress(criteria))}`, '')
    for (const criterion of criteria) {
      const mark = criterion.checked ? color.green('✓') : color.grey('○')
      const text = criterion.checked ? color.dim(criterion.text) : criterion.text
      lines.push(`  ${mark} ${text}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
