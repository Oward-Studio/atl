/**
 * Suggesting the nearest name when one is misspelled.
 *
 * A mistyped option is not a harmless error: `atl ls --status todo` answered
 * `Unknown option: --status` with no hint that `--state` exists, and reading that as
 * "this command cannot filter" is a reasonable conclusion — one that cost a ticket
 * asking for filters the command already had. Naming the near miss closes that gap
 * where it opens.
 */

/**
 * Levenshtein distance, bounded by `limit`: the moment every cell of a row exceeds it,
 * no longer path can come back under, so the rest is not worth computing. Inputs here
 * are a dozen characters at most, but the bound also states the intent — this is a
 * near-miss test, not a similarity score.
 */
function distance(a: string, b: string, limit: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const insertion = (row[j - 1] as number) + 1
      const deletion = (previous[j] as number) + 1
      row.push(Math.min(substitution, insertion, deletion))
    }
    if (Math.min(...row) > limit) return limit + 1
    previous = row
  }

  return previous[b.length] as number
}

/**
 * How far a name may be and still count as a near miss: **one edit up to four
 * characters, two beyond**.
 *
 * The ceiling is deliberately low. Two edits reach `--state` from `--status` and `issue`
 * from `isue`, which is the point; three would start pairing names that share nothing
 * but a length, and a confident wrong suggestion is worse than none — it sends the
 * reader to the wrong page instead of to the help.
 *
 * A single character gets **no** tolerance, which rules it out entirely. Every letter is
 * one edit from every other, so `-x` would always be answered with whichever short alias
 * happens to be declared first — a suggestion carrying no information while looking as
 * confident as a useful one.
 */
const tolerance = (input: string): number => {
  if (input.length <= 1) return 0
  return input.length <= 4 ? 1 : 2
}

/**
 * The closest candidate, or `undefined` when none is close enough.
 *
 * Ties go to the first candidate in declaration order, which keeps the message stable
 * between runs rather than depending on how the list happens to be built.
 */
export function closest(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase()
  const limit = tolerance(needle)

  let best: string | undefined
  let bestDistance = limit + 1

  for (const candidate of candidates) {
    const d = distance(needle, candidate.toLowerCase(), limit)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }

  return best
}

/** `Did you mean …?`, or nothing to add when no candidate is close. */
export function didYouMean(input: string, candidates: Iterable<string>): string | undefined {
  const match = closest(input, candidates)
  return match === undefined ? undefined : `Did you mean \`${match}\`?`
}
