/** Exit codes — contract documented in docs/ANYTYPE-LIMITS.md §3.5. */
export const ExitCode = {
  ok: 0,
  /** Generic error. */
  error: 1,
  /** Usage: missing or invalid argument. */
  usage: 2,
  /** Object not found, or ambiguous reference. */
  notFound: 3,
  /** Missing or invalid config / app key. */
  config: 4,
  /** API Anytype injoignable. */
  unreachable: 5,
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

/** Expected error: printed cleanly, without a stack trace. */
export class AtlError extends Error {
  readonly exitCode: ExitCode
  readonly hint: string | undefined

  constructor(message: string, exitCode: ExitCode = ExitCode.error, hint?: string) {
    super(message)
    this.name = 'AtlError'
    this.exitCode = exitCode
    this.hint = hint
  }
}

export const usageError = (message: string, hint?: string): AtlError =>
  new AtlError(message, ExitCode.usage, hint)

export const notFoundError = (message: string, hint?: string): AtlError =>
  new AtlError(message, ExitCode.notFound, hint)

export const configError = (message: string, hint?: string): AtlError =>
  new AtlError(message, ExitCode.config, hint)

export const unreachableError = (message: string, hint?: string): AtlError =>
  new AtlError(message, ExitCode.unreachable, hint)
