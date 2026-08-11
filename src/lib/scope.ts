import { resolve, sep } from 'node:path'

import type { Config } from './config.ts'

/**
 * Folder scope: which Anytype project matches the current directory.
 *
 * The mapping lives in `~/.config/atl/config.json`, not in a file versioned per
 * repository: it is **personal and machine-local**, since the space and the project
 * names belong to the owner.
 *
 * Reading the current directory and comparing it to one's own config is not
 * inspecting a repository: no Git command is involved.
 */

export type ScopeSource = 'flag' | 'env' | 'path' | 'none'

export type Scope = {
  project: string | undefined
  source: ScopeSource
  /** The configured path that won, so it can be announced. */
  matched?: string
}

export function resolveScope(
  config: Config,
  options: { explicit?: string | undefined; cwd?: string } = {},
): Scope {
  if (options.explicit) return { project: options.explicit, source: 'flag' }

  const fromEnv = process.env['ATL_PROJECT']
  if (fromEnv) return { project: fromEnv, source: 'env' }

  const match = longestPrefix(config.paths ?? {}, options.cwd ?? process.cwd())
  if (match) return { project: match.project, source: 'path', matched: match.path }

  return { project: undefined, source: 'none' }
}

/**
 * Longest prefix, on folder boundaries: `/Sites/atl` must not capture
 * `/Sites/atl-autre`.
 */
function longestPrefix(
  paths: Record<string, string>,
  cwd: string,
): { path: string; project: string } | undefined {
  const here = resolve(cwd)

  return Object.entries(paths)
    .map(([path, project]) => ({ path: resolve(path), project }))
    .filter(({ path }) => here === path || here.startsWith(`${path}${sep}`))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

/** Sentence announcing an implicit scope, to be written on stderr. */
export function scopeNotice(scope: Scope): string | undefined {
  if (scope.source === 'path') return `project: ${scope.project} (${scope.matched})`
  if (scope.source === 'env') return `project: ${scope.project} (ATL_PROJECT)`
  return undefined
}
