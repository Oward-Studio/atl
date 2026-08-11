import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { listTickets } from '../../lib/issues.ts'
import { reportProgress, syncProgress } from '../../lib/progress.ts'
import { spaceNotInitialised } from '../../model/schema.ts'
import { createObject, listTemplates, listTypes } from '../../lib/objects.ts'
import { info, json, success, warn } from '../../lib/output.ts'
import { findProject } from '../../lib/projects.ts'
import { resolveTagId } from '../../lib/resolve.ts'
import { resolveScope, scopeNotice } from '../../lib/scope.ts'
import { normalize, slugify } from '../../lib/text.ts'
import { AC_HEADING } from '../../model/acceptance.ts'
import {
  parsePriority,
  parseState,
  stateEmoji,
  priorityLabel,
  stateLabel,
  STATE_KEYS,
  type PriorityKey,
  type StateKey,
} from '../../model/enums.ts'
import { PROP, TICKET_TYPE_KEY, toIssue, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'
import { parseDraft, promptDraft, type Draft } from './new-input.ts'

export async function issueNew(ctx: CommandContext): Promise<void> {
  const draft = parseDraft(ctx.args)

  await withContext(ctx.json, async (context) => {
    await run(context, draft)
  })
}

async function run(context: Context, given: Draft | undefined): Promise<void> {
  const draft = given ?? (await promptDraft())

  // First, before resolving any tag: on a space that was never bootstrapped `state`
  // does not exist and the failure would be "tag not found" (code 3), a symptom
  // instead of the cause. No extra call — the type then serves for the template.
  const ticketType = await requireTicketType(context)

  if (draft.criteria.length === 0) {
    warn("No acceptance criteria. Add them with `--ac \"…\"`.")
  }

  const stateTag = await resolveTagId(context.api, context.spaceId, PROP.state, draft.state)
  const priorityTag = draft.priority
    ? await resolveTagId(context.api, context.spaceId, PROP.priority, draft.priority)
    : undefined
  const labelTag = draft.label
    ? await resolveTagId(context.api, context.spaceId, PROP.label, draft.label)
    : undefined

  // The project comes from folder scope unless told otherwise. This is a write, so
  // it announces itself when implicit.
  const scope = draft.allProjects
    ? { project: undefined, source: 'none' as const }
    : resolveScope(context.config, { explicit: draft.project })

  const notice = scopeNotice(scope)
  if (notice) info(color.dim(notice))

  const projectId = scope.project ? (await findProject(context, scope.project)).id : undefined
  // One read of the issues for two needs: ref uniqueness, and the progress
  // denominator.
  const existing = (await listTickets(context)).map(toIssue)
  const ref = uniqueRef(existing, draft.ref ?? slugify(draft.title))

  const properties: unknown[] = [
    { key: PROP.ref, text: ref },
    { key: PROP.state, select: stateTag },
    ...(priorityTag ? [{ key: PROP.priority, select: priorityTag }] : []),
    ...(labelTag ? [{ key: PROP.label, select: labelTag }] : []),
    ...(projectId ? [{ key: PROP.projects, objects: [projectId] }] : []),
  ]

  const templateId = await firstTemplate(context, ticketType.id)
  const created = await createObject(context.api, context.spaceId, {
    type_key: TICKET_TYPE_KEY,
    name: draft.title,
    icon: { format: 'emoji', emoji: stateEmoji(draft.state) },
    ...(templateId ? { template_id: templateId } : {}),
    ...(buildBody(draft) ? { body: buildBody(draft) } : {}),
    properties,
  })

  const issue = toIssue(created)

  // One more issue changes the denominator: the created issue is not in the list
  // loaded above, so it is appended rather than re-reading everything.
  const written = await syncProgress(context, [...existing, issue], issue.projectIds)

  if (context.json) {
    json({
      ref: issue.ref ?? ref,
      id: created.id,
      title: issue.title,
      state: issue.stateName ?? stateLabel(draft.state),
      priority: issue.priorityName ?? null,
      label: issue.label ?? null,
      criteria: draft.criteria.length,
      progress: written,
    })
    return
  }

  success(`${stateEmoji(draft.state)} ${color.cyan(ref)} — ${issue.title}`)
  info(
    color.dim(
      `  ${stateLabel(draft.state)}${draft.priority ? ` · ${priorityLabel(draft.priority)}` : ''}`,
    ),
  )
  reportProgress(written)
}

/** Issue body: description, then the acceptance-criteria section. */
function buildBody(draft: Draft): string {
  const parts: string[] = []
  if (draft.description) parts.push(draft.description)

  if (draft.criteria.length > 0) {
    parts.push(`## ${AC_HEADING}`, draft.criteria.map((c) => `- [ ] ${c}`).join('\n'))
  }
  return parts.join('\n\n')
}

/**
 * A duplicate `ref` would make resolution ambiguous for every later command: suffix
 * rather than create the conflict.
 */
/** The issue list is passed in, not re-read: it also serves the progress figure. */
function uniqueRef(existing: readonly Issue[], base: string): string {
  if (!base) throw usageError('Cannot derive a reference from this title.')

  const taken = new Set(
    existing
      .map((issue) => issue.ref)
      .filter((r): r is string => Boolean(r))
      .map(normalize),
  )

  if (!taken.has(normalize(base))) return base

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(normalize(candidate))) return candidate
  }
  throw usageError(`Too many issues share the reference "${base}".`)
}

async function requireTicketType(context: Context): Promise<{ id: string }> {
  const types = await listTypes(context.api, context.spaceId)
  const type = types.find((t) => t.key === TICKET_TYPE_KEY)
  if (!type) throw spaceNotInitialised([TICKET_TYPE_KEY], context.spaceName)

  return type
}

async function firstTemplate(context: Context, typeId: string): Promise<string | undefined> {
  const templates = await listTemplates(context.api, context.spaceId, typeId)
  return templates[0]?.id
}

