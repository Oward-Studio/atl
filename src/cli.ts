import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { router } from './commands/index.ts'
import { flagBool, parseArgs, GLOBAL_FLAGS } from './lib/args.ts'
import { color, setColorEnabled } from './lib/color.ts'
import { AtlError, ExitCode } from './lib/errors.ts'
import { fail, info, out } from './lib/output.ts'
import { notifyIfBehind } from './lib/update-check.ts'
import { record } from './lib/usage.ts'
import {
  assertImplemented,
  findCommand,
  parseCommand,
  renderCommandHelp,
  renderDomainHelp,
  renderRootHelp,
  unknownCommand,
} from './router.ts'

/**
 * Read rather than copied: release-please bumps `package.json` and nothing else, so a
 * literal here would start lying at the first release. Read from the installation root so
 * `--version` and the update notice can never disagree about which install they describe.
 */
const version = (): string =>
  (
    JSON.parse(readFileSync(resolve(installRoot(), 'package.json'), 'utf8')) as {
      version: string
    }
  ).version

export async function main(argv: readonly string[]): Promise<void> {
  const startedAt = Date.now()
  // The name is captured as soon as routing resolves: a command failing after it
  // queried the API did absorb volume, and must be counted.
  const invoked = { cmd: 'unknown' }

  try {
    await run(argv, invoked)
  } catch (error) {
    process.exitCode = report(error)
  } finally {
    record(invoked.cmd, startedAt, Date.now())
  }
}

async function run(argv: readonly string[], invoked: { cmd: string }): Promise<void> {
  // Colours are decided before any output, errors included.
  if (argv.includes('--no-color')) setColorEnabled(false)

  if (argv.includes('--version') || argv.includes('-v')) {
    out(version())
    // Checking a version is the moment someone most wants to know theirs is behind, so
    // this flag is worth the one deadline-bounded call a day that the rest of the CLI
    // pays for too.
    await notifyIfBehind(installRoot())
    return
  }

  const match = findCommand(router, argv)

  if (!match) {
    const global = parseArgs(argv, GLOBAL_FLAGS)
    if (flagBool(global, 'help') || global.positionals.length === 0) {
      out(renderRootHelp(router))
      return
    }

    const domainHelp =
      global.positionals.length === 1
        ? renderDomainHelp(router, global.positionals[0] as string)
        : undefined
    if (domainHelp) {
      out(domainHelp)
      return
    }

    throw unknownCommand(router, argv)
  }

  const { command, rest } = match
  invoked.cmd = command.path.join(' ')
  const args = parseCommand(command, rest)

  if (flagBool(args, 'help')) {
    out(renderCommandHelp(command))
    return
  }

  assertImplemented(command)
  await command.run({ args, json: flagBool(args, 'json') })

  // After the command, so what was asked for is read first and a courtesy never delays
  // it. `atl update` is exempt: being told an update exists while running the update is
  // noise.
  if (command.path[0] !== 'update') await notifyIfBehind(installRoot())
}

/** The package root: this file sits in `src/`. */
function installRoot(): string {
  return process.env['ATL_INSTALL_ROOT'] ?? fileURLToPath(new URL('..', import.meta.url))
}

function report(error: unknown): ExitCode {
  if (error instanceof AtlError) {
    fail(error.message)
    if (error.hint) info(color.dim(`  ${error.hint}`))
    return error.exitCode
  }

  fail(error instanceof Error ? error.message : String(error))
  if (error instanceof Error && error.stack && process.env['ATL_DEBUG']) {
    info(color.dim(error.stack))
  } else {
    info(color.dim('  Re-run with ATL_DEBUG=1 for the stack trace.'))
  }
  return ExitCode.error
}
