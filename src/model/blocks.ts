import { AC_HEADING, isAcHeading, type Criterion } from './acceptance.ts'

/**
 * An object body as `/v2` serves it: a flat list of typed blocks, with the text of each
 * block untouched — no `<br>` in table cells, no accumulated backslashes
 * (docs/ANYTYPE-LIMITS.md §1.2).
 */
export type Block = {
  id: string
  type: string
  text?: string
  checked?: boolean
  indent?: number
  language?: string
  /** Columns may carry no `header` at all. */
  columns?: { id: string; header?: string }[]
  /** A row with nothing in it comes without `cells` (an empty header, say). */
  rows?: { is_header?: boolean; cells?: unknown[] }[]
}

/** A criterion together with the block that holds it, which is what an edit addresses. */
export type CriterionBlock = Criterion & { id: string }

const HEADING_TYPE_RE = /^heading_(\d)$/

function headingLevel(block: Block): number | undefined {
  const match = HEADING_TYPE_RE.exec(block.type)
  return match ? Number(match[1]) : undefined
}

/** Where the criteria section sits: its heading and the index range it covers. */
function section(blocks: readonly Block[]): { heading: number; end: number } | undefined {
  const heading = blocks.findIndex(
    (block) => headingLevel(block) !== undefined && isAcHeading(block.text ?? ''),
  )
  if (heading === -1) return undefined

  const level = headingLevel(blocks[heading] as Block) as number
  let end = blocks.length
  for (let index = heading + 1; index < blocks.length; index++) {
    const next = headingLevel(blocks[index] as Block)
    // A heading of equal or higher level closes the section.
    if (next !== undefined && next <= level) {
      end = index
      break
    }
  }
  return { heading, end }
}

export function criteriaBlocks(blocks: readonly Block[]): CriterionBlock[] {
  const found = section(blocks)
  if (!found) return []

  return blocks
    .slice(found.heading + 1, found.end)
    .filter((block) => block.type === 'checkbox')
    .map((block) => ({ id: block.id, text: block.text ?? '', checked: block.checked === true }))
}

/**
 * The `insert_blocks` op that appends a criterion: after the last one, else under the
 * existing heading, else as a new section at the end of the body.
 */
export function addCriterionOp(blocks: readonly Block[], text: string): Record<string, unknown> {
  const found = section(blocks)
  const last = criteriaBlocks(blocks).at(-1)
  const item = `- [ ] ${text}`

  if (last) return { op: 'insert_blocks', after: last.id, markdown: item }
  if (found) return { op: 'insert_blocks', after: (blocks[found.heading] as Block).id, markdown: item }
  return { op: 'insert_blocks', markdown: `## ${AC_HEADING}\n${item}` }
}

export function setCheckedOps(
  criteria: readonly CriterionBlock[],
  numbers: readonly number[],
  checked: boolean,
): Record<string, unknown>[] {
  return numbers.map((number) => ({
    op: 'update_block',
    id: (criteria[number - 1] as CriterionBlock).id,
    set: { checked },
  }))
}

// ------------------------------------------------------------ description

/**
 * What the description shows: every block but the criteria section's heading and its
 * checkboxes, so free text written inside the section stays visible, as it is on `/v1`.
 */
function shownBlocks(blocks: readonly Block[]): Block[] {
  const found = section(blocks)
  if (!found) return [...blocks]
  return blocks.filter(
    (block, index) =>
      index < found.heading ||
      index >= found.end ||
      (index > found.heading && block.type !== 'checkbox'),
  )
}

/** What replacing the description removes: only the blocks outside the section. */
function replaceableBlocks(blocks: readonly Block[]): Block[] {
  const found = section(blocks)
  if (!found) return [...blocks]
  return [...blocks.slice(0, found.heading), ...blocks.slice(found.end)]
}

export function descriptionOf(blocks: readonly Block[]): string {
  return blocksToMarkdown(shownBlocks(blocks))
}

/**
 * The ops that replace the description: the new text goes in first, ahead of the criteria
 * section (at the end when there is none), then the old top-level blocks are removed —
 * their children go with them.
 */
export function setDescriptionOps(
  blocks: readonly Block[],
  description: string,
): Record<string, unknown>[] {
  const found = section(blocks)
  const text = description.trim()
  const ops: Record<string, unknown>[] = []

  if (text) {
    ops.push(
      found
        ? { op: 'insert_blocks', before: (blocks[found.heading] as Block).id, markdown: text }
        : { op: 'insert_blocks', markdown: text },
    )
  }

  for (const block of replaceableBlocks(blocks)) {
    if ((block.indent ?? 0) === 0) ops.push({ op: 'delete_block', id: block.id, recursive: true })
  }
  return ops
}

// ------------------------------------------------------------ rendering

const cellText = (cell: unknown): string => {
  if (typeof cell === 'string') return cell
  if (Array.isArray(cell)) return cell.map(cellText).join(' ')
  if (cell && typeof cell === 'object' && 'text' in cell) return String((cell as { text: unknown }).text)
  return ''
}

function tableMarkdown(block: Block): string[] {
  const rows = block.rows ?? []
  const width = Math.max(block.columns?.length ?? 0, ...rows.map((row) => row.cells?.length ?? 0))
  if (width === 0) return []

  const line = (cells: readonly unknown[] = []): string =>
    `| ${Array.from({ length: width }, (_, index) => cellText(cells[index])).join(' | ')} |`

  const [first, ...rest] = rows
  // A table's first row is its header, empty or not: the separator goes right under it.
  return [line(first?.cells), `|${Array(width).fill('---').join('|')}|`, ...rest.map((row) => line(row.cells))]
}

/** Renders blocks back to the markdown a person would have typed. */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  const lines: string[] = []
  let ordinal = 0

  for (const block of blocks) {
    const pad = '  '.repeat(block.indent ?? 0)
    const text = block.text ?? ''
    ordinal = block.type === 'numbered_list_item' ? ordinal + 1 : 0
    const level = HEADING_TYPE_RE.exec(block.type)?.[1]

    if (level) lines.push(`${'#'.repeat(Number(level))} ${text}`)
    else if (block.type === 'bulleted_list_item') lines.push(`${pad}- ${text}`)
    else if (block.type === 'numbered_list_item') lines.push(`${pad}${ordinal}. ${text}`)
    else if (block.type === 'checkbox') lines.push(`${pad}- [${block.checked ? 'x' : ' '}] ${text}`)
    else if (block.type === 'quote') lines.push(`> ${text}`)
    else if (block.type === 'divider') lines.push('---')
    else if (block.type === 'code') lines.push(`\`\`\`${block.language ?? ''}`, text.replace(/\n$/, ''), '```')
    else if (block.type === 'table') lines.push(...tableMarkdown(block))
    else lines.push(text)

    // List items stay tight; every other block is its own paragraph.
    if (!/_list_item$|^checkbox$/.test(block.type)) lines.push('')
  }

  return lines.join('\n').trim()
}
