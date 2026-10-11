import { color } from '../lib/color.ts'
import {
  API_VERSIONS,
  DEFAULT_API_VERSION,
  loadConfig,
  parseApiVersion,
  readConfigFile,
  saveConfig,
} from '../lib/config.ts'
import { info, json, out, success } from '../lib/output.ts'
import type { CommandContext } from '../router.ts'

/**
 * `atl config api` — shows which Anytype API edits issue bodies, or changes it.
 *
 * A setting of the machine, kept in the config file next to the space and the folder
 * links. `ATL_API` overrides it for a single command.
 */
export async function configApi(ctx: CommandContext): Promise<void> {
  const wanted = ctx.args.positionals[0]
  const stored = await readConfigFile()

  if (wanted === undefined) {
    const effective = (await loadConfig()).api ?? DEFAULT_API_VERSION
    const source = process.env['ATL_API']
      ? 'ATL_API'
      : stored.api
        ? 'config file'
        : 'default'

    if (ctx.json) {
      json({ api: effective, source })
      return
    }
    out(`${color.bold(effective)} ${color.dim(`(${source})`)}`)
    info(color.dim(`\`atl config api ${API_VERSIONS.join('|')}\` to change it`))
    return
  }

  // Validated before writing: a typo must not leave a config that no command accepts.
  const api = parseApiVersion(wanted)
  const previous = stored.api ?? DEFAULT_API_VERSION
  await saveConfig({ ...stored, apiUrl: stored.apiUrl ?? (await loadConfig()).apiUrl, api })

  if (ctx.json) {
    json({ api, previous, changed: api !== previous })
    return
  }
  if (api === previous) {
    info(color.dim(`API ${api} is already selected.`))
    return
  }
  success(`API for issue bodies: ${color.bold(api)} ${color.dim(`(was ${previous})`)}`)
}
