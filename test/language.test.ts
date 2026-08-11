import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * Everything in this repository is written in English — code, comments, tests, docs and
 * CLI output alike. This suite is what enforces it.
 *
 * It exists because reviewing by eye did not work: the switch to English was declared
 * finished three times while prompts, `--help` descriptions, number formatting and 88
 * test names were still French. A grep-based check finds in a second what reading
 * misses, and it fails the build instead of reaching a reader.
 */

/**
 * French function words and the vocabulary this project actually used. Deliberately
 * short: a word only earns its place here if its presence is decisive, since an English
 * text containing "sans" or "par" is not a thing.
 */
const FRENCH = new RegExp(
  String.raw`(?:^|[^\p{L}])(` +
    [
      // articles, prepositions, conjunctions
      'le',
      'la',
      'les',
      'une',
      'des',
      'du',
      'aux',
      'pour',
      'avec',
      'sans',
      'dans',
      'est',
      'sont',
      'pas',
      'qui',
      'que',
      'quand',
      'donc',
      'mais',
      'cela',
      'celui',
      'celle',
      'leur',
      'cette',
      'être',
      'déjà',
      'même',
      // this project's own French vocabulary
      'aucune?',
      'inconnues?',
      'manquante?',
      'absentes?',
      'vide',
      'titres?',
      'projets?',
      'dossiers?',
      'portée',
      'clés?',
      'états?',
      'etat',
      'priorité',
      'avancement',
      'critères?',
      'étiquettes?',
      'recettage',
      'refacto',
      'appairage',
      // state and priority names, before they were renamed
      'à faire',
      'en cours',
      'en revue',
      'terminé',
      'annulé',
      'urgentes?',
      'hautes?',
      'moyennes?',
      'basses?',
      // legacy keys, which no longer exist anywhere
      'a_faire',
      'en_cours',
      'en_revue',
      'priorite',
      'branche_git_hub',
      'lien_git_hub',
    ].join('|') +
    `)(?:[^\\p{L}]|$)`,
  'iu',
)

/**
 * Lines allowed to carry French, each for a stated reason. Matched as substrings so a
 * line stays exempt when it moves.
 *
 * Kept minimal on purpose: every entry is a place where French is **data** rather than
 * prose, and a growing list would mean the rule is being worked around.
 */
const ALLOWED = [
  // The §1.13 migration note names the keys it replaced; that naming is the point.
  '`etat` became `state`',
  '`branche_git_hub` became `github_branch`',
]

/** French typography that reads as a bug in English output. */
const TYPOGRAPHY: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /«|»/, why: 'French quotation marks' },
  { pattern: /\d \d|\d \d/, why: 'space as a thousands separator' },
  { pattern: /\breplace\('\.', ','\)/, why: 'comma as a decimal separator' },
]

const sourceFiles = (): string[] => {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      // This suite names what it forbids, so it cannot scan itself.
      else if (/\.(ts|mjs|md|sh|yml)$/.test(entry) && entry !== 'language.test.ts') found.push(path)
    }
  }
  for (const root of ['src', 'test', 'test-live', 'docs', 'skill', 'bin', '.github']) {
    try {
      walk(root)
    } catch {
      // A directory absent from a checkout is not a failure.
    }
  }
  for (const file of ['README.md', 'CONTRIBUTING.md', 'install.sh', 'package.json']) found.push(file)
  return found
}

/** Strings and comments, which is where prose lives — not identifiers. */
const prose = (line: string): string[] => {
  const trimmed = line.trim()
  if (/^(\/\/|\*|\/\*)/.test(trimmed)) return [trimmed]
  const literals = [...line.matchAll(/'([^'\\]{3,})'|"([^"\\]{3,})"|`([^`\\]{3,})`/g)]
  const found = literals.map((m) => m[1] ?? m[2] ?? m[3] ?? '')
  // A template literal containing an escaped backtick escapes the pattern above — which
  // is exactly how `Commande inconnue : \`atl …\`` survived the first sweeps. Scan the
  // whole line too when one is present; the word list is specific enough to carry it.
  if (line.includes('`')) found.push(line)
  return found
}

describe('the repository is written in English', () => {
  const files = sourceFiles()

  it('scans a plausible number of files', () => {
    // Guards the walker itself: a broken path would make every assertion below vacuous.
    assert.ok(files.length > 50, `only ${files.length} files scanned`)
  })

  it('carries no French in comments or strings', () => {
    const offences: string[] = []

    for (const file of files) {
      const isMarkdown = file.endsWith('.md')
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (ALLOWED.some((allowed) => line.includes(allowed))) return
          const candidates = isMarkdown ? [line] : prose(line)
          for (const text of candidates) {
            const match = FRENCH.exec(text)
            if (match) {
              offences.push(`${file}:${index + 1}  "${match[1]}"  ${text.trim().slice(0, 70)}`)
              break
            }
          }
        })
    }

    assert.deepEqual(offences, [], `\n${offences.join('\n')}\n`)
  })

  it('uses English typography for quotes and numbers', () => {
    const offences: string[] = []

    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (ALLOWED.some((allowed) => line.includes(allowed))) return
          for (const { pattern, why } of TYPOGRAPHY) {
            if (pattern.test(line)) {
              offences.push(`${file}:${index + 1}  ${why}: ${line.trim().slice(0, 70)}`)
              break
            }
          }
        })
    }

    assert.deepEqual(offences, [], `\n${offences.join('\n')}\n`)
  })
})
