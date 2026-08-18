import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { color } from '../lib/color.ts'
import { AtlError, ExitCode } from '../lib/errors.ts'
import { info, json, success } from '../lib/output.ts'
import type { CommandContext } from '../router.ts'

/**
 * Updating the installation — the one command that runs Git and npm, on its own clone,
 * as `install.sh` does. Everywhere else the caller supplies the Git context; here there
 * is no caller to supply anything, since the thing being updated is the CLI itself.
 *
 * `import.meta.url` gives the root, not `process.cwd()`: the command is useful precisely
 * when run from somewhere else.
 */
export async function update(ctx: CommandContext): Promise<void> {
  const root = installRoot()
  // Checked before anything runs: without this, a root that is not a clone surfaced as a
  // raw `ENOENT ... /package.json` from the version read, or as a git exit code with no
  // stated cause.
  assertClone(root)
  const from = declaredVersion(root)

  const before = await capture('git', ['rev-parse', 'HEAD'], root)
  await run('git', ['pull', '--ff-only'], root, ctx.json)
  const after = await capture('git', ['rev-parse', 'HEAD'], root)

  const pulled = before === after ? 0 : Number(await capture('git', ['rev-list', '--count', `${before}..${after}`], root))
  const reinstalled = await needsInstall(root, before, after)
  // `ci` rather than `install`: it never rewrites the lockfile. `install` may normalise
  // it under a different npm, and since the file is tracked, the next `--ff-only` pull
  // would then refuse over a local change to the very file that triggers reinstalls.
  if (reinstalled) await run('npm', ['ci'], root, ctx.json)

  const to = declaredVersion(root)

  if (ctx.json) {
    json({ from, to, pulled, updated: pulled > 0, reinstalled, installedAt: root })
    return
  }

  if (pulled === 0 && !reinstalled) {
    info(`atl ${color.bold(to)} — already up to date.`)
    return
  }
  // Between releases `main` carries commits while `package.json` still holds the last
  // released version, so an arrow between two identical numbers is the common case, not
  // the exception. Say what moved instead.
  success(
    from === to
      ? `atl ${color.bold(to)} — ${pulled} commit(s) pulled, version unchanged`
      : `atl ${color.bold(from)} → ${color.bold(to)}`,
  )
  info(color.dim(reinstalled ? '  Dependencies reinstalled.' : '  Dependencies unchanged.'))
}

/** The package root: this file sits in `src/commands/`. */
function installRoot(): string {
  // Overridable so the suite can point at a throwaway clone instead of this one — a
  // command that runs `git pull` cannot be tested against the repository it lives in.
  const override = process.env['ATL_INSTALL_ROOT']
  if (override) return override
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function assertClone(root: string): void {
  for (const [entry, what] of [
    ['package.json', 'a package'],
    ['.git', 'a Git clone'],
  ] as const) {
    if (!existsSync(resolve(root, entry))) {
      throw new AtlError(
        `${root} is not ${what}, so there is nothing to update.`,
        ExitCode.error,
        'Installations made from an archive rather than `git clone` update by re-downloading.',
      )
    }
  }
}

function declaredVersion(root: string): string {
  return (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string })
    .version
}

/**
 * Reinstall when the pull moved the lockfile — and also when npm left no record of an
 * install at all.
 *
 * That second condition is what makes a failure recoverable. `npm ci` empties
 * `node_modules` before it fetches, so an install interrupted halfway leaves the clone on
 * new code with no dependencies. Deciding from the pull range alone, the next run would
 * see nothing to pull, report "already up to date", and never retry — leaving an
 * installation that cannot boot and no command able to fix it.
 */
async function needsInstall(root: string, before: string, after: string): Promise<boolean> {
  if (!existsSync(resolve(root, 'node_modules', '.package-lock.json'))) return true
  if (before === after) return false

  const changed = await capture('git', ['diff', '--name-only', before, after], root)
  return changed.split('\n').includes('package-lock.json')
}

/**
 * Inherits the terminal so `git pull` and `npm ci` report their own progress, which is
 * what a caller waiting on a network operation wants to see. Under `--json` stdout is
 * reserved for the payload, so their output is captured and folded into the error
 * instead of discarded — an agent that only gets "exited with 1" has nothing to act on.
 */
function run(command: string, args: readonly string[], cwd: string, quiet: boolean): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit',
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => reject(missing(command)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(failed(command, args, code, stderr))
    })
  })
}

function capture(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => reject(missing(command)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise(out.trim())
      else reject(failed(command, args, code, stderr))
    })
  })
}

const missing = (command: string): AtlError =>
  new AtlError(`\`${command}\` was not found on the PATH.`, ExitCode.error)

/**
 * The hint is drawn from what the command actually said, not from which command it was.
 * Attaching "a local commit stops a fast-forward" to every git failure named the wrong
 * cause for a clone that is not a repository, or a branch with no upstream.
 */
function failed(
  command: string,
  args: readonly string[],
  code: number | null,
  stderr: string,
): AtlError {
  const reported = stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n  ')
  const divergent = /fast-forward|diverged|local changes/i.test(stderr)

  return new AtlError(
    `\`${command} ${args.join(' ')}\` exited with ${code ?? 'a signal'}.`,
    ExitCode.error,
    [
      reported,
      divergent
        ? 'A local commit or an uncommitted change stops a fast-forward. Resolve it, then run `atl update` again.'
        : undefined,
    ]
      .filter(Boolean)
      .join('\n  ') || undefined,
  )
}
