import { flagString } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { createObject, listTemplates, listTypes } from '../../lib/objects.ts'
import { spaceNotInitialised } from '../../model/schema.ts'
import { info, json, success } from '../../lib/output.ts'
import { listProjects } from '../../lib/projects.ts'
import { resolveTagId } from '../../lib/resolve.ts'
import { sameName } from '../../lib/text.ts'
import { parseState, type StateKey, stateLabel } from '../../model/enums.ts'
import { PROJECT_PROP, PROJECT_TYPE_KEY } from '../../model/issue.ts'
import { toProject } from '../../model/project.ts'
import type { CommandContext } from '../../router.ts'

const DEFAULT_STATE: StateKey = 'in_progress'

export async function projectNew(ctx: CommandContext): Promise<void> {
  const name = ctx.args.positionals.join(' ').trim()
  if (!name) {
    throw usageError('Missing project name.', 'Usage: `atl project new "<name>"`')
  }

  const stateInput = flagString(ctx.args, 'state')
  const state = stateInput ? parseState(stateInput) : DEFAULT_STATE
  const repo = flagString(ctx.args, 'repo')

  await withContext(ctx.json, async (context) => {
    const existing = await listProjects(context)
    if (existing.some((p) => sameName(p.name, name))) {
      throw usageError(
        `A project named "${name}" already exists.`,
        'Projects resolve by name: two with the same name would make resolution ambiguous.',
      )
    }

    const created = await createObject(context.api, context.spaceId, {
      type_key: PROJECT_TYPE_KEY,
      name,
      ...(await template(context)),
      // No `body`: the template's body carries the dynamic table of linked issues,
      // which a custom body would overwrite (docs/ANYTYPE-LIMITS.md §1.4).
      properties: [
        { key: PROJECT_PROP.state, select: await resolveTagId(context.api, context.spaceId, PROJECT_PROP.state, state) },
        ...(repo ? [{ key: PROJECT_PROP.repo, url: repo }] : []),
      ],
    })

    const project = toProject(created)

    if (context.json) {
      json({ name: project.name, id: created.id, state: project.stateName ?? stateLabel(state), repo: project.repo ?? null })
      return
    }

    success(`${color.bold(project.name)} created`)
    info(color.dim(`  ${project.state ?? state}${repo ? ` · ${repo}` : ''}`))
  })
}

async function template(context: Context): Promise<{ template_id?: string }> {
  const types = await listTypes(context.api, context.spaceId)
  const type = types.find((t) => t.key === PROJECT_TYPE_KEY)
  if (!type) throw spaceNotInitialised([PROJECT_TYPE_KEY], context.spaceName)

  const templates = await listTemplates(context.api, context.spaceId, type.id)
  const id = templates[0]?.id
  return id ? { template_id: id } : {}
}
