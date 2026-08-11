import { flagString, type ParsedArgs } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { AtlError, ExitCode, usageError } from '../../lib/errors.ts'
import { findIssue, loadBody } from '../../lib/issues.ts'
import { updateObject } from '../../lib/objects.ts'
import { definitionList, info, json, out, success } from '../../lib/output.ts'
import { findProject, listProjects } from '../../lib/projects.ts'
import { resolveTagId, resolveTagIds } from '../../lib/resolve.ts'
import { sameName } from '../../lib/text.ts'
import { hasRichBlocks, parseBody, replaceDescription } from '../../model/acceptance.ts'
import { parsePriority, type PriorityKey,
  priorityLabel,
} from '../../model/enums.ts'
import { displayRef, PROP, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

/**
 * Edits the fields passed as options, and **nothing else**. State transitions have
 * their own commands, acceptance criteria theirs.
 */
export async function issueEdit(ctx: CommandContext): Promise<void> {
  const reference = ctx.args.positionals[0]
  if (!reference) {
    throw usageError(
      'Missing issue reference.',
      'Usage: `atl issue edit <ref> --title "…" --priority high`',
    )
  }

  const wanted = parseWanted(ctx.args)
  if (Object.keys(wanted).length === 0) {
    throw usageError(
      'No change requested.',
      'Editable fields: --title, --description, --priority, --label, --project.',
    )
  }

  await withContext(ctx.json, async (context) => {
    await apply(context, reference, wanted)
  })
}

type Wanted = {
  title?: string
  description?: string
  priority?: PriorityKey
  label?: string
  project?: string
  /** Pull request URL, pasted by hand: the CLI does not go looking for it. */
  link?: string
}

/** Pure validation: an invalid priority fails before any network call. */
function parseWanted(args: ParsedArgs): Wanted {
  const wanted: Wanted = {}

  const title = flagString(args, 'title')
  if (title !== undefined) {
    if (!title.trim()) throw usageError('`--title` cannot be empty.')
    wanted.title = title.trim()
  }

  const description = flagString(args, 'description')
  if (description !== undefined) wanted.description = description

  const priority = flagString(args, 'priority')
  if (priority !== undefined) wanted.priority = parsePriority(priority)

  const label = flagString(args, 'label')
  if (label !== undefined) wanted.label = label

  const project = flagString(args, 'project')
  if (project !== undefined) wanted.project = project

  const link = flagString(args, 'link')
  if (link !== undefined) {
    if (!/^https?:\/\//.test(link)) {
      throw usageError('`--link` expects a URL starting with http:// or https://.')
    }
    wanted.link = link
  }

  return wanted
}

type Change = { field: string; from: string; to: string }

async function apply(context: Context, reference: string, wanted: Wanted): Promise<void> {
  const { issue } = await findIssue(context, reference)

  const changes: Change[] = []
  const unchanged: string[] = []
  const patch: {
    name?: string
    markdown?: string
    properties?: unknown[]
  } = {}
  const properties: unknown[] = []

  if (wanted.title !== undefined) {
    if (wanted.title === issue.title) unchanged.push('title')
    else {
      patch.name = wanted.title
      changes.push({ field: 'title', from: issue.title, to: wanted.title })
    }
  }

  if (wanted.description !== undefined) {
    const markdown = (await loadBody(context, issue.id)) ?? ''
    const current = parseBody(markdown).description

    if (current === wanted.description) unchanged.push('description')
    else {
      // Rewriting a body with a table would damage it: same rule as `issue ac`.
      if (hasRichBlocks(markdown)) {
        throw new AtlError(
          'This issue body contains a table, which rewriting would damage.',
          ExitCode.error,
          'Edit the description directly in Anytype.',
        )
      }
      patch.markdown = replaceDescription(markdown, wanted.description)
      changes.push({ field: 'description', from: preview(current), to: preview(wanted.description) })
    }
  }

  if (wanted.priority !== undefined) {
    if (wanted.priority === issue.priority) unchanged.push('priority')
    else {
      properties.push({
        key: PROP.priority,
        select: await resolveTagId(context.api, context.spaceId, PROP.priority, wanted.priority),
      })
      changes.push({
      field: 'priority',
      from: issue.priorityName ?? '–',
      to: priorityLabel(wanted.priority),
    })
    }
  }

  if (wanted.label !== undefined) {
    const tagId = await resolveTagId(context.api, context.spaceId, PROP.label, wanted.label)
    const resolved = await labelName(context, wanted.label)

    if (resolved === issue.label) unchanged.push('label')
    else {
      properties.push({ key: PROP.label, select: tagId })
      changes.push({ field: 'label', from: issue.label ?? '–', to: resolved })
    }
  }

  if (wanted.project !== undefined) {
    const project = await findProject(context, wanted.project)
    const before = await projectNames(context, issue)

    if (issue.projectIds.length === 1 && issue.projectIds[0] === project.id) {
      unchanged.push('project')
    } else {
      properties.push({ key: PROP.projects, objects: [project.id] })
      changes.push({ field: 'project', from: before || '–', to: project.name })
    }
  }

  if (wanted.link !== undefined) {
    if (wanted.link === issue.link) unchanged.push('lien')
    else {
      properties.push({ key: PROP.link, url: wanted.link })
      changes.push({ field: 'lien', from: issue.link ?? '–', to: wanted.link })
    }
  }

  if (properties.length > 0) patch.properties = properties

  if (changes.length > 0) {
    await updateObject(context.api, context.spaceId, issue.id, patch)
  }

  if (context.json) {
    json({ ref: displayRef(issue), changes, unchanged })
    return
  }

  if (changes.length === 0) {
    info(color.dim(`${displayRef(issue)}: nothing to change (${unchanged.join(', ')}).`))
    return
  }

  success(`${color.cyan(displayRef(issue))} — ${changes.length} field(s) changed`)
  out(
    definitionList(
      changes.map((c) => [c.field, `${color.dim(c.from)} → ${c.to}`] as const),
    ),
  )
  if (unchanged.length > 0) info(color.dim(`  unchanged: ${unchanged.join(', ')}`))
}

/** Canonical label name, to compare against what the issue carries. */
async function labelName(context: Context, input: string): Promise<string> {
  const tags = await resolveTagIds(context.api, context.spaceId, PROP.label)
  return Object.keys(tags).find((name) => sameName(name, input)) ?? input
}

async function projectNames(context: Context, issue: Issue): Promise<string> {
  if (issue.projectIds.length === 0) return ''

  const projects = await listProjects(context)
  return issue.projectIds
    .map((id) => projects.find((p) => p.id === id)?.name ?? id)
    .join(', ')
}

function preview(text: string): string {
  const first = text.split('\n')[0] ?? ''
  return first.length > 60 ? `${first.slice(0, 59)}…` : first || '(empty)'
}
