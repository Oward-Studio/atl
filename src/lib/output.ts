import { color, visibleLength } from './color.ts'
import { countOutput } from './usage.ts'

/**
 * Output contract (docs/ANYTYPE-LIMITS.md §3.5):
 * - stdout carries the result only (table, or JSON with --json);
 * - every human-facing message (info, warning, error) goes to stderr.
 */

export function out(line = ''): void {
  write(process.stdout, `${line}\n`)
}

export function json(value: unknown): void {
  write(process.stdout, `${JSON.stringify(value, null, 2)}\n`)
}

export function info(message: string): void {
  write(process.stderr, `${message}\n`)
}

export function success(message: string): void {
  write(process.stderr, `${color.green('✓')} ${message}\n`)
}

export function warn(message: string): void {
  write(process.stderr, `${color.yellow('!')} ${message}\n`)
}

export function fail(message: string): void {
  write(process.stderr, `${color.red('✗')} ${message}\n`)
}

/**
 * All output goes through here so `atl gain` measures what actually reaches the
 * context. ANSI codes are excluded from the count: they only cost tokens in a
 * terminal, and an agent's context receives the text uncoloured.
 */
function write(stream: NodeJS.WriteStream, text: string): void {
  countOutput(visibleLength(text))
  stream.write(text)
}

export type Align = 'left' | 'right'

export type Column<T> = {
  header: string
  /** Raw value, used for width and truncation. */
  value: (row: T) => string
  /** Optional coloured rendering; must produce the same visible text as `value`. */
  render?: (row: T) => string
  align?: Align
  /** Column sacrificed first when the terminal is narrow (higher = truncated sooner). */
  flex?: number
}

export function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100
}

const GAP = 2

/**
 * Aligned table, no borders (Linear / gh style).
 * `flex` columns absorb the truncation when width runs short.
 */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) return ''

  const cells = rows.map((row) => columns.map((c) => c.value(row)))
  const widths = columns.map((c, i) =>
    Math.max(visibleLength(c.header), ...cells.map((r) => visibleLength(r[i] ?? ''))),
  )

  shrinkToFit(widths, columns, terminalWidth())

  const header = columns
    .map((c, i) => color.dim(pad(c.header, widths[i] ?? 0, c.align)))
    .join(' '.repeat(GAP))
    .trimEnd()

  const body = rows.map((row, r) =>
    columns
      .map((c, i) => {
        const width = widths[i] ?? 0
        const raw = truncate(cells[r]?.[i] ?? '', width)
        const rendered = c.render && raw === cells[r]?.[i] ? c.render(row) : raw
        return pad(rendered, width, c.align)
      })
      .join(' '.repeat(GAP))
      .trimEnd(),
  )

  return [header, ...body].join('\n')
}

/** Shrinks `flex` columns (most flexible first) until they fit in `available`. */
function shrinkToFit<T>(
  widths: number[],
  columns: readonly Column<T>[],
  available: number,
): void {
  const gaps = GAP * Math.max(0, columns.length - 1)
  let excess = widths.reduce((a, b) => a + b, 0) + gaps - available
  if (excess <= 0) return

  const flexible = columns
    .map((c, i) => ({ i, flex: c.flex ?? 0 }))
    .filter((c) => c.flex > 0)
    .sort((a, b) => b.flex - a.flex)

  const MIN = 8
  for (const { i } of flexible) {
    if (excess <= 0) break
    const current = widths[i] ?? 0
    const reducible = Math.max(0, current - MIN)
    const cut = Math.min(reducible, excess)
    widths[i] = current - cut
    excess -= cut
  }
}

function truncate(s: string, width: number): string {
  if (visibleLength(s) <= width) return s
  if (width <= 1) return '…'.slice(0, width)
  return `${Array.from(s).slice(0, width - 1).join('')}…`
}

function pad(s: string, width: number, align: Align = 'left'): string {
  const padding = ' '.repeat(Math.max(0, width - visibleLength(s)))
  return align === 'right' ? padding + s : s + padding
}

/**
 * Aligned key / value list, for detail views.
 * A multi-line value stays aligned under the first line.
 */
export function definitionList(entries: readonly (readonly [string, string])[]): string {
  const width = Math.max(...entries.map(([k]) => visibleLength(k)))
  const indent = ' '.repeat(width + GAP)

  return entries
    .map(([key, value]) => {
      const [first, ...rest] = value.split('\n')
      const head = `${color.dim(key.padEnd(width))}${' '.repeat(GAP)}${first ?? ''}`
      return [head, ...rest.map((line) => `${indent}${line}`)].join('\n')
    })
    .join('\n')
}
