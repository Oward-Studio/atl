import { router } from './commands/index.ts'
import { flagBool, parseArgs, GLOBAL_FLAGS } from './lib/args.ts'
import { color, setColorEnabled } from './lib/color.ts'
import { AtlError, ExitCode } from './lib/errors.ts'
import { fail, info, out } from './lib/output.ts'
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

const VERSION = '0.1.0'

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
    out(VERSION)
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
