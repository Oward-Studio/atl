import { homedir } from 'node:os'
import { join } from 'node:path'

const xdg = (envVar: string, fallback: string): string => {
  const value = process.env[envVar]
  return value && value.length > 0 ? value : join(homedir(), fallback)
}

export const configDir = (): string => join(xdg('XDG_CONFIG_HOME', '.config'), 'atl')
export const configFile = (): string => join(configDir(), 'config.json')

export const cacheDir = (): string => join(xdg('XDG_CACHE_HOME', '.cache'), 'atl')
export const cacheFile = (): string => join(cacheDir(), 'resolve.json')

export const usageDir = (): string => join(xdg('XDG_STATE_HOME', '.local/state'), 'atl')
export const usageFile = (): string => join(usageDir(), 'usage.jsonl')
