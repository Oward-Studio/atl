import { ApiClient } from '../lib/api.ts'
import { color } from '../lib/color.ts'
import { loadConfig, readConfigFile, requireAppKey, saveConfig } from '../lib/config.ts'
import { info, json, out, success, warn } from '../lib/output.ts'
import { resolveSpace, listSpaces, type Space } from '../lib/spaces.ts'
import type { CommandContext } from '../router.ts'

/**
 * `atl space` — list the spaces, or change the default one.
 *
 * The space lives in the config, never in the application: the API has no notion of an
 * open space. `atl auth --space` can change it, but at the cost of **re-pairing** — a
 * new four-digit code for a mere change of target. Hence this command, which only
 * touches the config.
 *
 * One verb and an optional operand, like `atl project link`: without an argument it
 * lists, with one it changes.
 */
export async function space(ctx: CommandContext): Promise<void> {
  const wanted = ctx.args.positionals[0]

  const config = await loadConfig()
  requireAppKey(config)
  const api = new ApiClient({ baseUrl: config.apiUrl, appKey: config.appKey })
  const spaces = await listSpaces(api)

  if (wanted === undefined) {
    list(ctx, spaces, config.space)
    return
  }

  // Resolved before writing: a misspelled name exits with 3 and the list of spaces,
  // rather than leaving a config that no longer resolves.
  const chosen = resolveSpace(spaces, wanted)

  if (chosen.name === config.space) {
    if (ctx.json) {
      json({ space: chosen.name, changed: false })
      return
    }
    info(color.dim(`"${chosen.name}" is already the default space.`))
    return
  }

  // `readConfigFile` returns a Partial: `apiUrl` is restored from the file when it
  // was there, never from the effective config, so as not to freeze an
  // environment override into the file.
  const previous = await readConfigFile()
  await saveConfig({
    ...previous,
    apiUrl: previous.apiUrl ?? config.apiUrl,
    space: chosen.name,
  })

  if (ctx.json) {
    json({ space: chosen.name, previous: config.space ?? null, changed: true })
    return
  }

  success(`Default space: ${color.bold(chosen.name)} ${color.dim(`(was ${config.space})`)}`)

  // Folder → project links name projects, and a project only exists in its space:
  // leaving them unmentioned would promise a scope that no longer resolves.
  const paths = Object.entries(previous.paths ?? {})
  if (paths.length > 0) {
    warn(
      `${paths.length} folder link(s) name projects of the previous space:`,
    )
    for (const [path, project] of paths.slice(0, 5)) {
      info(color.dim(`    ${project} — ${path}`))
    }
    info(color.dim('`atl project link <project>` to redo them, `atl project unlink` to remove them.'))
  }
}

function list(ctx: CommandContext, spaces: readonly Space[], current: string | undefined): void {
  if (ctx.json) {
    json({
      current: current ?? null,
      spaces: spaces.map((s) => ({ name: s.name, current: s.name === current })),
    })
    return
  }

  for (const item of spaces) {
    const mark = item.name === current ? color.green('●') : color.grey('○')
    out(`${mark} ${item.name}`)
  }
  info(color.dim(`${spaces.length} space(s) · \`atl space "<name>"\` to change the default`))
}
