import { GLOBAL_FLAGS, parseArgs, type FlagSpec, type ParsedArgs } from './lib/args.ts'
import { color } from './lib/color.ts'
import { AtlError, usageError } from './lib/errors.ts'
import { out } from './lib/output.ts'

export type CommandContext = {
  args: ParsedArgs
  json: boolean
}

export type Command = {
  /** Command path: ['issue', 'list'] → `atl issue list`. */
  path: readonly string[]
  /** Raccourcis de premier niveau : ['ls'] → `atl ls`. */
  aliases?: readonly string[]
  summary: string
  /** Positional arguments, for the help: '<ref> <project>'. */
  operands?: string
  flags?: readonly FlagSpec[]
  /** Planned delivery phase, for commands declared but not yet written. */
  phase: number
  /** Absent = planned command, not implemented yet. */
  run?: (ctx: CommandContext) => Promise<void> | void
}

export type Router = {
  commands: readonly Command[]
}

const key = (path: readonly string[]): string => path.join(' ')

export function findCommand(
  router: Router,
  argv: readonly string[],
): { command: Command; rest: string[] } | undefined {
  const words = takeWhile(argv, (t) => !t.startsWith('-'))

  // Longest path first: `issue list` wins over a possible `issue`.
  for (let depth = Math.min(words.length, 3); depth >= 1; depth--) {
    const candidate = key(words.slice(0, depth))
    const command = router.commands.find(
      (c) => key(c.path) === candidate || c.aliases?.includes(candidate),
    )
    if (command) {
      const consumed = countTokens(argv, depth)
      return { command, rest: argv.slice(consumed) }
    }
  }
  return undefined
}

/** How many argv tokens to consume to cover `wordCount` words (options aside). */
function countTokens(argv: readonly string[], wordCount: number): number {
  let seen = 0
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string
    if (token.startsWith('-')) continue
    seen++
    if (seen === wordCount) return i + 1
  }
  return argv.length
}

function takeWhile(argv: readonly string[], predicate: (t: string) => boolean): string[] {
  const words: string[] = []
  for (const token of argv) {
    if (token === '--') break
    if (predicate(token)) words.push(token)
  }
  return words
}

export function commandFlags(command: Command): FlagSpec[] {
  return [...(command.flags ?? []), ...GLOBAL_FLAGS]
}

export function parseCommand(command: Command, rest: readonly string[]): ParsedArgs {
  return parseArgs(rest, commandFlags(command))
}

export function assertImplemented(command: Command): asserts command is Command & {
  run: NonNullable<Command['run']>
} {
  if (!command.run) {
    throw new AtlError(
      `\`atl ${key(command.path)}\` is not implemented yet (planned for phase ${command.phase}).`,
      1,
      'See `atl --help` for the available surface.',
    )
  }
}

export function unknownCommand(argv: readonly string[]): AtlError {
  const attempted = takeWhile(argv, (t) => !t.startsWith('-')).slice(0, 2).join(' ')
  return usageError(
    `Unknown command: \`atl ${attempted}\`.`,
    'See `atl --help` for the list of commands.',
  )
}

// ---------------------------------------------------------------- aide

export function renderRootHelp(router: Router): string {
  const lines: string[] = [
    '',
    `  ${color.bold('atl')} ${color.dim('— Anytype as Linear')}`,
    '',
    `  ${color.dim('Usage:')} atl <command> [options]`,
    '',
  ]

  for (const [group, commands] of groupByDomain(router)) {
    lines.push(`  ${color.bold(group)}`)
    const width = Math.max(...commands.map((c) => signature(c).length))
    for (const command of commands) {
      const sig = signature(command).padEnd(width)
      const planned = command.run ? '' : color.dim(`  (phase ${command.phase})`)
      const summary = command.run ? command.summary : color.dim(command.summary)
      lines.push(`    ${sig}  ${summary}${planned}`)
    }
    lines.push('')
  }

  lines.push(`  ${color.bold('Global options')}`)
  for (const flag of GLOBAL_FLAGS) {
    lines.push(`    ${`--${flag.name}`.padEnd(20)}  ${flag.description}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Help for a single domain (`atl issue`), without the other groups. */
export function renderDomainHelp(router: Router, domain: string): string | undefined {
  const commands = router.commands.filter((c) => c.path.length > 1 && c.path[0] === domain)
  if (commands.length === 0) return undefined

  const width = Math.max(...commands.map((c) => signature(c).length))
  const lines = [
    '',
    `  ${color.bold(`atl ${domain}`)}`,
    '',
    `  ${color.dim('Usage:')} atl ${domain} <action> [options]`,
    '',
  ]
  for (const command of commands) {
    const planned = command.run ? '' : color.dim(`  (phase ${command.phase})`)
    const summary = command.run ? command.summary : color.dim(command.summary)
    lines.push(`    ${signature(command).padEnd(width)}  ${summary}${planned}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderCommandHelp(command: Command): string {
  const lines: string[] = [
    '',
    `  ${color.bold(`atl ${key(command.path)}`)} ${color.dim(`— ${command.summary}`)}`,
    '',
    `  ${color.dim('Usage:')} atl ${signature(command)}`,
  ]

  if (command.aliases?.length) {
    lines.push('', `  ${color.dim('Alias:')} ${command.aliases.map((a) => `atl ${a}`).join(', ')}`)
  }

  const flags = commandFlags(command)
  if (flags.length > 0) {
    lines.push('', `  ${color.bold('Options')}`)
    const rendered = flags.map((f) => ({
      left: [f.short ? `-${f.short},` : '   ', `--${f.name}`, f.placeholder ?? '']
        .filter(Boolean)
        .join(' ')
        .trimEnd(),
      description: f.description,
    }))
    const width = Math.max(...rendered.map((r) => r.left.length))
    for (const r of rendered) lines.push(`    ${r.left.padEnd(width)}  ${r.description}`)
  }

  if (!command.run) {
    lines.push('', `  ${color.yellow(`Not implemented yet — planned for phase ${command.phase}.`)}`)
  }

  lines.push('')
  return lines.join('\n')
}

function signature(command: Command): string {
  return [key(command.path), command.operands].filter(Boolean).join(' ')
}

function groupByDomain(router: Router): Array<[string, Command[]]> {
  const groups = new Map<string, Command[]>()
  for (const command of router.commands) {
    const domain = command.path.length > 1 ? (command.path[0] as string) : 'general'
    const bucket = groups.get(domain)
    if (bucket) bucket.push(command)
    else groups.set(domain, [command])
  }
  return [...groups.entries()]
}

export function printHelp(text: string): void {
  out(text)
}
