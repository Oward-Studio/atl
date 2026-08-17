import { createInterface } from 'node:readline/promises'

import { usageError } from './errors.ts'

export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true
}

/**
 * The question goes to stderr: stdout stays reserved for the result
 * (docs/ANYTYPE-LIMITS.md §3.5). Outside a TTY, refuse rather than block on input
 * that will never come.
 */
export async function ask(question: string, hint?: string): Promise<string> {
  if (!isInteractive()) {
    throw usageError(`Input required: ${question}`, hint ?? 'Pass the value as an option.')
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(`${question} `)).trim()
  } finally {
    rl.close()
  }
}

export async function choose<T>(
  question: string,
  options: readonly T[],
  label: (option: T) => string,
): Promise<T> {
  if (options.length === 1) return options[0] as T

  for (const [index, option] of options.entries()) {
    process.stderr.write(`  ${index + 1}. ${label(option)}\n`)
  }

  const answer = await ask(`${question} [1-${options.length}]`)
  const index = Number.parseInt(answer, 10) - 1
  const chosen = options[index]
  if (!chosen) throw usageError(`Choix invalide : ${answer}`)
  return chosen
}

/**
 * A yes/no question, defaulting to **no**: the caller of a destructive command has to
 * type something, and an empty line — a stray Return, a paste ending in a newline —
 * cancels rather than confirms.
 */
export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} [y/N]`)
  return /^(y|yes)$/i.test(answer.trim())
}
