import { ApiClient, DEFAULT_API_URL } from '../lib/api.ts'
import { flagBool, flagString } from '../lib/args.ts'
import { color } from '../lib/color.ts'
import { loadConfig, readConfigFile, saveConfig, type Config } from '../lib/config.ts'
import { AtlError, ExitCode, usageError } from '../lib/errors.ts'
import { definitionList, info, json, out, success } from '../lib/output.ts'
import { configFile } from '../lib/paths.ts'
import { ask, choose, isInteractive } from '../lib/prompt.ts'
import { listSpaces, resolveSpace, type Space } from '../lib/spaces.ts'
import { maskSecret } from '../lib/text.ts'
import type { CommandContext } from '../router.ts'

const APP_NAME = 'atl'

export async function auth(ctx: CommandContext): Promise<void> {
  const apiUrl = flagString(ctx.args, 'api-url') ?? (await loadConfig()).apiUrl ?? DEFAULT_API_URL

  if (flagBool(ctx.args, 'status')) {
    await status(ctx, apiUrl)
    return
  }

  if (flagBool(ctx.args, 'request')) {
    await requestChallenge(ctx, apiUrl)
    return
  }

  const provided = flagString(ctx.args, 'key')?.trim()
  if (provided !== undefined && provided.length === 0) {
    throw usageError('`--key` cannot be empty.')
  }

  const appKey = provided ?? (await obtainAppKey(ctx, apiUrl))
  const api = new ApiClient({ baseUrl: apiUrl, appKey })

  // A real check: a key that cannot list spaces is useless.
  const spaces = await listSpaces(api)
  const space = await pickSpace(spaces, flagString(ctx.args, 'space'))

  const previous = await readConfigFile()
  const config: Config = { ...previous, apiUrl, appKey, space: space.name }
  await saveConfig(config)

  if (ctx.json) {
    json({ apiUrl, space: space.name, appKey: maskSecret(appKey), configFile: configFile() })
    return
  }

  success(`App key saved to ${configFile()}`)
  info(`  Default space: ${color.bold(space.name)}`)
}

/** Folder → project links, or an explicit mention when there are none. */
function pathsLine(paths: Record<string, string> | undefined): string {
  const entries = Object.entries(paths ?? {})
  if (entries.length === 0) return color.grey('none')

  return entries.map(([path, project]) => `${project} ${color.dim(`(${path})`)}`).join('\n')
}

async function status(ctx: CommandContext, apiUrl: string): Promise<void> {
  const config = await loadConfig()

  let reachable = false
  let spaceCount: number | undefined
  if (config.appKey) {
    try {
      const spaces = await listSpaces(new ApiClient({ baseUrl: apiUrl, appKey: config.appKey }))
      reachable = true
      spaceCount = spaces.length
    } catch {
      reachable = false
    }
  }

  if (ctx.json) {
    json({
      configFile: configFile(),
      apiUrl,
      space: config.space ?? null,
      appKey: config.appKey ? maskSecret(config.appKey) : null,
      authenticated: reachable,
      spaces: spaceCount ?? null,
      paths: config.paths ?? {},
    })
    return
  }

  out(
    definitionList([
      ['Config', configFile()],
      ['API', apiUrl],
      ['App key', config.appKey ? maskSecret(config.appKey) : color.grey('absent')],
      ['Space', config.space ?? color.grey('not set')],
      ['Folders', pathsLine(config.paths)],
      [
        'State',
        !config.appKey
          ? color.yellow('not authenticated — run `atl auth`')
          : reachable
            ? color.green(`OK (${spaceCount} space${(spaceCount ?? 0) > 1 ? 's' : ''})`)
            : color.red('key refused or API unreachable'),
      ],
    ]),
  )
}

/**
 * Step 1 of the non-interactive flow: creates the challenge and returns its id. The
 * code appears in the app; the exchange happens in a second call.
 */
async function requestChallenge(ctx: CommandContext, apiUrl: string): Promise<void> {
  const api = new ApiClient({ baseUrl: apiUrl, appKey: undefined })
  const { challenge_id } = await api.post<{ challenge_id: string }>('/v1/auth/challenges', {
    app_name: APP_NAME,
  })

  if (ctx.json) {
    json({ challengeId: challenge_id })
    return
  }

  info("A four-digit code appears in Anytype. To finish pairing:")
  info(color.dim(`  atl auth --challenge ${challenge_id} --code <code>`))
  out(challenge_id)
}

/**
 * Anytype pairing flow: request a challenge, the desktop app shows a four-digit code,
 * exchange it for an app key.
 *
 * Three paths: `--challenge` + `--code` (non-interactive, in two calls), typing the
 * code at the prompt (terminal), or pasting an existing key by hand if the API does
 * not offer this flow.
 */
async function obtainAppKey(ctx: CommandContext, apiUrl: string): Promise<string> {
  const api = new ApiClient({ baseUrl: apiUrl, appKey: undefined })
  const code = flagString(ctx.args, 'code')?.trim()
  const challengeFlag = flagString(ctx.args, 'challenge')?.trim()

  if (challengeFlag || code) {
    if (!challengeFlag || !code) {
      throw usageError(
        '`--challenge` and `--code` go together.',
        'Get a challenge id with `atl auth --request`.',
      )
    }
    return exchange(api, challengeFlag, code)
  }

  let challengeId: string
  try {
    const challenge = await api.post<{ challenge_id: string }>('/v1/auth/challenges', {
      app_name: APP_NAME,
    })
    challengeId = challenge.challenge_id
  } catch (error) {
    if (error instanceof AtlError && error.exitCode === ExitCode.unreachable) throw error
    return askAppKeyManually()
  }

  info("A four-digit code has just appeared in Anytype.")
  const typed = await ask(
    'Code:',
    'Without an interactive terminal: `atl auth --request`, then `atl auth --challenge <id> --code <code>`.',
  )
  return exchange(api, challengeId, typed)
}

async function exchange(api: ApiClient, challengeId: string, code: string): Promise<string> {
  const result = await api.post<{ api_key: string }>('/v1/auth/api_keys', {
    challenge_id: challengeId,
    code,
  })

  if (!result.api_key) {
    throw new AtlError("The API returned no app key.", ExitCode.config)
  }
  return result.api_key
}

async function askAppKeyManually(): Promise<string> {
  if (!isInteractive()) {
    throw new AtlError(
      'Cannot obtain an app key without an interactive terminal.',
      ExitCode.config,
      'Pass the key with `atl auth --key <app-key>`.',
    )
  }

  info('Automatic pairing unavailable — paste an existing Anytype app key.')
  const key = await ask('App key:')
  if (!key) throw new AtlError('Empty app key.', ExitCode.config)
  return key
}

async function pickSpace(spaces: readonly Space[], requested: string | undefined): Promise<Space> {
  if (spaces.length === 0) {
    throw new AtlError('No space is reachable with this app key.', ExitCode.config)
  }
  if (requested) return resolveSpace(spaces, requested)
  if (spaces.length === 1) return spaces[0] as Space
  return choose('Default space?', spaces, (s) => s.name)
}
