import { normalize } from '../lib/text.ts'

/**
 * Acceptance criteria live in an `## Acceptance criteria` section of the issue body, as
 * markdown checkboxes (docs/ANYTYPE-LIMITS.md §3.3).
 *
 * The markdown the Anytype API returns is not faithful to what was written:
 * trailing spaces, escaped underscores and pipes. The parser has to tolerate that.
 */

export const AC_HEADING = 'Acceptance criteria'

/**
 * The heading is matched on its normalised text, so casing and typographic apostrophes
 * do not decide whether a section is found. Shared by the parser and the writer: two
 * different answers to "is this the criteria section?" would let one add a section the
 * other cannot see.
 */
function isAcHeading(title: string): boolean {
  return normalize(title) === normalize(AC_HEADING)
}

export type Criterion = {
  text: string
  checked: boolean
}

export type ParsedBody = {
  /** The body without the criteria section: the description proper. */
  description: string
  criteria: Criterion[]
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const CRITERION_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/

export function parseBody(markdown: string | undefined): ParsedBody {
  if (!markdown) return { description: '', criteria: [] }

  const lines = markdown.split('\n').map((line) => line.replace(/\s+$/, ''))

  let acLevel: number | undefined
  const description: string[] = []
  const criteria: Criterion[] = []

  for (const line of lines) {
    const heading = HEADING_RE.exec(line)

    if (heading) {
      const level = heading[1]?.length ?? 1
      const title = normalize(stripInline(heading[2] ?? ''))

      if (isAcHeading(title)) {
        acLevel = level
        continue
      }
      // A heading of equal or higher level closes the criteria section.
      if (acLevel !== undefined && level <= acLevel) acLevel = undefined
    }

    if (acLevel !== undefined) {
      const criterion = CRITERION_RE.exec(line)
      if (criterion) {
        criteria.push({
          text: unescapeMarkdown(criterion[2] ?? ''),
          checked: (criterion[1] ?? ' ').toLowerCase() === 'x',
        })
        continue
      }
      // Free text inside the criteria section is still content: it returns to the
      // description rather than being lost silently.
      if (line.trim() !== '') description.push(line)
      continue
    }

    description.push(line)
  }

  // Escaping is an artefact of the API's rendering, not of what the owner wrote:
  // strip it from both sides.
  return { description: unescapeMarkdown(description.join('\n').trim()), criteria }
}

export function acProgress(criteria: readonly Criterion[]): string {
  return `${criteria.filter((c) => c.checked).length}/${criteria.length}`
}

// ------------------------------------------------------------ writing

/**
 * The Anytype API has no partial write: `update-object` replaces the whole body. And
 * the markdown it returns is not faithful to what was written — tables come back
 * with `<br>` inside cells. Rewriting a body containing one would damage it, so the
 * command refuses rather than degrade silently.
 *
 * The test targets what actually breaks: table rows and `<br>`. Rejecting any tag
 * would refuse bodies merely mentioning `<ref>` in inline code — a false positive
 * blocking perfectly rewritable issues.
 */
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/m
const LINE_BREAK_TAG_RE = /<br\s*\/?>/i

export function hasRichBlocks(markdown: string): boolean {
  return TABLE_ROW_RE.test(markdown) || LINE_BREAK_TAG_RE.test(markdown)
}

type Located = {
  lines: string[]
  /** Line numbers of the criteria, in display order. */
  criterionLines: number[]
  /** Line of the section heading, or -1 when the section does not exist. */
  headingLine: number
}

function locate(markdown: string): Located {
  const lines = markdown.split('\n')
  const criterionLines: number[] = []
  let headingLine = -1
  let acLevel: number | undefined

  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, '')
    const heading = HEADING_RE.exec(line)

    if (heading) {
      const level = heading[1]?.length ?? 1
      if (isAcHeading(stripInline(heading[2] ?? ''))) {
        acLevel = level
        headingLine = index
        continue
      }
      if (acLevel !== undefined && level <= acLevel) acLevel = undefined
    }

    if (acLevel !== undefined && CRITERION_RE.test(line)) criterionLines.push(index)
  }

  return { lines, criterionLines, headingLine }
}

export type CriteriaEdit = {
  markdown: string
  criteria: Criterion[]
}

/**
 * Prepares a body for writing.
 *
 * The API escapes punctuation on read (`dev_label` comes back as `dev\_label`) then
 * re-escapes the backslash on the next write. Rewriting as-is therefore **grows the
 * escaping every cycle** — measured at +1 backslash per round trip, indefinitely.
 * They are stripped, since they come from the rendering and not from what was
 * written.
 */
function forWriting(markdown: string): string {
  // One pass undoes a single level (`\\_` → `\_` → `_`), so iterate to a fixed
  // point: otherwise an already over-escaped body only cleans up one level per
  // write. Bounded, so as not to depend on the input's shape.
  let previous = markdown
  for (let pass = 0; pass < 5; pass++) {
    const next = unescapeMarkdown(previous)
    if (next === previous) break
    previous = next
  }
  return previous
}

function edited(markdown: string): CriteriaEdit {
  const next = forWriting(markdown)
  return { markdown: next, criteria: parseBody(next).criteria }
}

/**
 * Ticks or unticks criteria by their display number (1-based).
 *
 * The only intended change is the character between brackets. The rest of the body is
 * rewritten identically, save for rendering escapes, which `forWriting` strips so
 * they do not accumulate.
 */
export function setChecked(
  markdown: string,
  numbers: readonly number[],
  checked: boolean,
): CriteriaEdit {
  const { lines, criterionLines } = locate(markdown)

  for (const number of numbers) {
    const lineIndex = criterionLines[number - 1]
    if (lineIndex === undefined) continue

    const line = lines[lineIndex] as string
    lines[lineIndex] = line.replace(/\[([ xX])\]/, `[${checked ? 'x' : ' '}]`)
  }

  return edited(lines.join('\n'))
}

/**
 * Replaces the description while keeping the criteria section **verbatim**.
 * Everything after the section heading is copied as-is, free text included: editing a
 * description must never make criteria disappear.
 */
export function replaceDescription(markdown: string, description: string): string {
  const { lines, headingLine } = locate(markdown)
  const body = description.replace(/\s+$/, '')

  if (headingLine === -1) return forWriting(body)

  const section = lines.slice(headingLine).join('\n')
  return forWriting(body ? `${body}\n\n${section}` : section)
}

/** Appends a criterion to the section, creating the section if needed. */
export function addCriterion(markdown: string, text: string): CriteriaEdit {
  const { lines, criterionLines, headingLine } = locate(markdown)
  const entry = `- [ ] ${text}`

  if (headingLine === -1) {
    const body = markdown.replace(/\s+$/, '')
    return edited(`${body ? `${body}\n\n` : ''}## ${AC_HEADING}\n\n${entry}`)
  }

  const last = criterionLines.at(-1)
  const insertAt = last === undefined ? headingLine + 1 : last + 1
  lines.splice(insertAt, 0, entry)

  return edited(lines.join('\n'))
}

/** Strips inline markup from a heading so it compares by its text. */
function stripInline(s: string): string {
  return s.replace(/[*_`]/g, '')
}

/** Undoes the escaping added by Anytype's markdown rendering. */
export function unescapeMarkdown(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
}
