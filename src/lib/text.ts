/**
 * Normalises for comparing hand-typed names: case, accents, whitespace, and
 * typographic apostrophes — "Won’t fix" must equal "Won't fix", and nobody should
 * have to think about which one they typed.
 */
export function normalize(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function sameName(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

/** Slug usable as a Git branch name. */
export function slugify(s: string): string {
  return normalize(s)
    .replace(/^\[\d+\]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Masks a secret key for display: `sk-abc…xyz`. */
export function maskSecret(s: string): string {
  if (s.length <= 8) return '•'.repeat(s.length)
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}
