import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { color } from '../lib/color.ts'
import { AtlError, ExitCode } from '../lib/errors.ts'
import { info, json, success } from '../lib/output.ts'
import type { CommandContext } from '../router.ts'

/**
 * Updating the installation — the one command that runs Git and npm, as `install.sh`
 * does. Everywhere else the caller supplies the Git context; here there is no caller to
 * supply anything, since the thing being updated is the CLI itself.
 *
 * `import.meta.url` gives the root, not `process.cwd()`: the command is useful precisely
 * when run from somewhere else.
 */
export async function update(ctx: CommandContext): Promise<void> {
  const root = installRoot()
  const from = declaredVersion(root)

  const before = await capture('git', ['rev-parse', 'HEAD'], root)
  await run('git', ['pull', '--ff-only'], root, ctx.json)
  const after = await capture('git', ['rev-parse', 'HEAD'], root)

  // Reinstalling on every update would spend a network round trip to learn that nothing
  // moved. The lockfile is what decides whether anything has to be fetched.
  const changed = before === after ? [] : await changedFiles(root, before, after)
  const reinstalled = changed.includes('package-lock.json')
  if (reinstalled) await run('npm', ['install'], root, ctx.json)

  const to = declaredVersion(root)

  if (ctx.json) {
    json({ from, to, updated: before !== after, reinstalled, installedAt: root })
    return
  }

  if (before === after) {
    info(`atl ${color.bold(to)} — already up to date.`)
    return
  }
  success(`atl ${color.bold(from)} → ${color.bold(to)}`)
  if (!reinstalled) info(color.dim('  Dependencies unchanged, nothing reinstalled.'))
}

/** The package root: this file sits in `src/commands/`. */
function installRoot(): string {
  // Overridable so the suite can point at a throwaway clone instead of this one — a
  // command that runs `git pull` cannot be tested against the repository it lives in.
  const override = process.env['ATL_INSTALL_ROOT']
  if (override) return override
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function declaredVersion(root: string): string {
  return (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string })
    .version
}

async function changedFiles(root: string, from: string, to: string): Promise<string[]> {
  const out = await capture('git', ['diff', '--name-only', from, to], root)
  return out.split('\n').filter(Boolean)
}

/**
 * Inherits the terminal so `git pull` and `npm install` report their own progress, which
 * is what a caller waiting on a network operation wants to see. Under `--json` the output
 * is swallowed instead, stdout being reserved for the payload.
 */
function run(command: string, args: readonly string[], cwd: string, quiet: boolean): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: quiet ? 'ignore' : 'inherit' })
    child.on('error', () => reject(missing(command)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(failed(command, args, code))
    })
  })
}

function capture(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('error', () => reject(missing(command)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise(out.trim())
      else reject(failed(command, args, code))
    })
  })
}

const missing = (command: string): AtlError =>
  new AtlError(`\`${command}\` was not found on the PATH.`, ExitCode.error)

/**
 * `--ff-only` is deliberate: a divergent history is reported rather than merged, so an
 * update never invents a commit in a clone someone was working in.
 */
const failed = (command: string, args: readonly string[], code: number | null): AtlError =>
  new AtlError(
    `\`${command} ${args.join(' ')}\` exited with ${code ?? 'a signal'}.`,
    ExitCode.error,
    command === 'git'
      ? 'A local commit or an uncommitted change stops a fast-forward. Resolve it, then run `atl update` again.'
      : undefined,
  )
