import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { color } from '../lib/color.ts'
import { info, json, out } from '../lib/output.ts'
import type { CommandContext } from '../router.ts'

/**
 * Where `atl` is installed, and what to run to move it forward.
 *
 * It prints and never executes, for the same reason `issue start` names a branch instead
 * of checking it out: the CLI does not run Git commands. What it can offer is the part
 * a human genuinely forgets — the path its own clone lives at, which no `cd` will
 * recall for them.
 *
 * `import.meta.url` rather than `process.cwd()`: the command is useful precisely when
 * run from somewhere else.
 */
export function update(ctx: CommandContext): void {
  const root = installRoot()
  const version = (
    JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
  ).version

  const commands = [`cd ${root}`, 'git pull', 'npm install']

  if (ctx.json) {
    json({ version, installedAt: root, commands })
    return
  }

  info(`atl ${color.bold(version)} — installed at ${color.dim(root)}`)
  out(commands.join(' && '))
  info(color.dim('  Printed, not run: the CLI never invokes Git on your behalf.'))
}

/** The package root: this file sits in `src/commands/`. */
function installRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}
