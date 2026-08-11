import { usageError } from './errors.ts'

export type FlagKind = 'string' | 'boolean'

export type FlagSpec = {
  name: string
  kind: FlagKind
  /** Short alias, without the dash: `p` for `-p`. */
  short?: string
  description: string
  /** Placeholder shown in the help, e.g. `<state>`. */
  placeholder?: string
  /** The flag may repeat; values accumulate. */
  repeatable?: boolean
}

export type ParsedArgs = {
  positionals: string[]
  flags: Record<string, string | string[] | boolean>
}

/** Flags every command accepts. */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: 'json', kind: 'boolean', description: 'Raw JSON output on stdout' },
  { name: 'no-color', kind: 'boolean', description: 'Disables colours' },
  { name: 'help', kind: 'boolean', short: 'h', description: 'Shows this help' },
  { name: 'version', kind: 'boolean', short: 'v', description: 'Shows the version' },
]

export function parseArgs(argv: readonly string[], specs: readonly FlagSpec[]): ParsedArgs {
  const byName = new Map<string, FlagSpec>()
  for (const spec of specs) {
    byName.set(spec.name, spec)
    if (spec.short) byName.set(spec.short, spec)
  }

  const positionals: string[] = []
  const flags: Record<string, string | string[] | boolean> = {}

  const setFlag = (spec: FlagSpec, value: string | boolean): void => {
    if (!spec.repeatable || typeof value === 'boolean') {
      flags[spec.name] = value
      return
    }
    const previous = flags[spec.name]
    flags[spec.name] = Array.isArray(previous) ? [...previous, value] : [value]
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string

    // POSIX convention: after `--`, no more options. It is the only way to pass
    // text starting with a dash — an acceptance criterion mentioning `--json`,
    // for instance.
    if (token === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }

    if (!token.startsWith('-') || token === '-') {
      positionals.push(token)
      continue
    }

    const isLong = token.startsWith('--')
    const body = isLong ? token.slice(2) : token.slice(1)
    const eq = body.indexOf('=')
    const key = eq === -1 ? body : body.slice(0, eq)
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1)

    const spec = byName.get(key)
    if (!spec) {
      throw usageError(
        `Unknown option: ${token}`,
        `If it is text rather than an option: atl … -- ${token}`,
      )
    }

    if (spec.kind === 'boolean') {
      if (inlineValue !== undefined) {
        throw usageError(`Option --${spec.name} takes no value.`)
      }
      setFlag(spec, true)
      continue
    }

    if (inlineValue !== undefined) {
      setFlag(spec, inlineValue)
      continue
    }

    const next = argv[i + 1]
    if (next === undefined || (next.startsWith('-') && next !== '-')) {
      throw usageError(
        `Option --${spec.name} expects a value.`,
        `For a value starting with a dash: --${spec.name}=<value>.`,
      )
    }
    setFlag(spec, next)
    i++
  }

  return { positionals, flags }
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  if (value === undefined || typeof value === 'boolean') return undefined
  return Array.isArray(value) ? value[value.length - 1] : value
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name]
  if (value === undefined || typeof value === 'boolean') return []
  return Array.isArray(value) ? value : [value]
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true
}
