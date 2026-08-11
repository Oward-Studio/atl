import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { DEFAULT_API_URL } from './api.ts'
import { AtlError, ExitCode, configError } from './errors.ts'
import { configDir, configFile } from './paths.ts'

export type Config = {
  apiUrl: string
  appKey?: string
  /** Space name, never its id (docs/ANYTYPE-LIMITS.md §3.1). */
  space?: string
  /**
   * Folder → project-name mapping, to scope commands without passing `--project`.
   * Absolute paths; the longest prefix wins.
   */
  paths?: Record<string, string>
}

const DEFAULTS: Config = { apiUrl: DEFAULT_API_URL }

/** On-disk config, overridden by the environment. */
export async function loadConfig(): Promise<Config> {
  const stored = await readConfigFile()
  const env = {
    apiUrl: process.env['ATL_API_URL'],
    appKey: process.env['ATL_APP_KEY'],
    space: process.env['ATL_SPACE'],
  }

  const config: Config = {
    ...DEFAULTS,
    ...stored,
    ...(env.apiUrl ? { apiUrl: env.apiUrl } : {}),
    ...(env.appKey ? { appKey: env.appKey } : {}),
    ...(env.space ? { space: env.space } : {}),
  }
  return config
}

export async function readConfigFile(): Promise<Partial<Config>> {
  let raw: string
  try {
    raw = await readFile(configFile(), 'utf8')
  } catch (error) {
    if (isNotFound(error)) return {}
    throw error
  }

  try {
    return JSON.parse(raw) as Partial<Config>
  } catch {
    throw new AtlError(
      `Unreadable config: ${configFile()} is not valid JSON.`,
      ExitCode.config,
      'Fix the file, or delete it and run `atl auth` again.',
    )
  }
}

/** Writes the config as 0600: it holds the app key. */
export async function saveConfig(config: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 })
  await writeFile(configFile(), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

/** Config guaranteed usable by a command that talks to the API. */
export type ReadyConfig = Config & { appKey: string }

export function requireAppKey(config: Config): asserts config is ReadyConfig {
  if (!config.appKey) {
    throw configError(
      "No Anytype app key saved.",
      'Run `atl auth` (the Anytype desktop application must be open).',
    )
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
