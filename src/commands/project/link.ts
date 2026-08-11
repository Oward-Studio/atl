import { color } from '../../lib/color.ts'
import { loadConfig, readConfigFile, saveConfig } from '../../lib/config.ts'
import { withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { definitionList, info, json, out, success } from '../../lib/output.ts'
import { findProject } from '../../lib/projects.ts'
import { resolve } from 'node:path'
import type { CommandContext } from '../../router.ts'

/**
 * Links the current folder to a project. The table lives in the config, not in a
 * versioned file: it is personal, machine-local data.
 */
export async function projectLink(ctx: CommandContext): Promise<void> {
  const name = ctx.args.positionals.join(' ').trim()
  const here = resolve(process.cwd())

  if (!name) {
    await listLinks(ctx)
    return
  }

  await withContext(ctx.json, async (context) => {
    // Resolved to validate the name and store it in canonical form: a link to a
    // project that does not exist would serve nobody.
    const project = await findProject(context, name)

    const stored = await readConfigFile()
    const paths = { ...(stored.paths ?? {}), [here]: project.name }
    await saveConfig({ ...stored, apiUrl: context.config.apiUrl, paths })

    if (ctx.json) {
      json({ path: here, project: project.name })
      return
    }
    success(`${here} → ${color.bold(project.name)}`)
  })
}

export async function projectUnlink(ctx: CommandContext): Promise<void> {
  const here = resolve(process.cwd())
  const stored = await readConfigFile()
  const paths = { ...(stored.paths ?? {}) }

  if (!(here in paths)) {
    if (ctx.json) {
      json({ path: here, removed: false })
      return
    }
    info(color.dim(`${here} is linked to no project.`))
    return
  }

  const previous = paths[here]
  delete paths[here]
  await saveConfig({ ...stored, apiUrl: stored.apiUrl ?? '', paths })

  if (ctx.json) {
    json({ path: here, removed: true, project: previous ?? null })
    return
  }
  success(`link removed: ${here} ✗ ${previous}`)
}

async function listLinks(ctx: CommandContext): Promise<void> {
  const config = await loadConfig()
  const entries = Object.entries(config.paths ?? {})

  if (ctx.json) {
    json({ paths: config.paths ?? {} })
    return
  }

  if (entries.length === 0) {
    info(color.dim('No folder linked. `atl project link <project>` links the current folder.'))
    return
  }

  out(definitionList(entries.map(([path, project]) => [path, project] as const)))
}
