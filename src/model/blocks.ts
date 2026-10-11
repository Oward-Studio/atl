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
