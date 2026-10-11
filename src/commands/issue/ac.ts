import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { AtlError, ExitCode, usageError } from '../../lib/errors.ts'
import { patchBlocks, readBlocks } from '../../lib/blocks.ts'
import { findIssue } from '../../lib/issues.ts'
import { info, json, out, success } from '../../lib/output.ts'
import { acProgress, AC_HEADING, type Criterion } from '../../model/acceptance.ts'
import { addCriterionOp, criteriaBlocks, setCheckedOps } from '../../model/blocks.ts'
import { displayRef, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

const ACTIONS = ['check', 'uncheck', 'add'] as const
type Action = (typeof ACTIONS)[number]

/**
 * `atl issue ac <ref>` lists, `atl issue ac check|uncheck <ref> <n…>` tick and untick,
 * `atl issue ac add <ref> "text"` appends.
 *
 * Reads and writes go through the `/v2` block operations: an edit touches the one block
 * concerned, so the rest of the body — tables included — is never rewritten.
 */
export async function issueAc(ctx: CommandContext): Promise<void> {
  const [first, ...rest] = ctx.args.positionals
  const action = ACTIONS.includes(first as Action) ? (first as Action) : undefined
  const reference = action ? rest[0] : first
  const operands = action ? rest.slice(1) : []

  if (!reference) {
    throw usageError(
      'Missing issue reference.',
      'Usage: `atl issue ac <ref>` · `atl issue ac check <ref> 1 2` · `atl issue ac add <ref> "text"`',
    )
  }

  await withContext(ctx.json, async (context) => {
    const { issue } = await findIssue(context, reference)
    const { api, spaceId } = context
    const { blocks, etag } = await readBlocks(api, spaceId, issue.id)

    if (!action) {
      render(context, issue, criteriaBlocks(blocks))
      return
    }

    const op =
      action === 'add'
        ? [addCriterionOp(blocks, criterionText(operands))]
        : setCheckedOps(criteriaBlocks(blocks), checkNumbers(blocks, operands, action), action === 'check')

    await patchBlocks(api, spaceId, issue.id, op, etag)

    // Read back: check the API really stored what we think it did.
    const reread = criteriaBlocks((await readBlocks(api, spaceId, issue.id)).blocks)

    if (context.json) {
      json({ ref: displayRef(issue), criteria: texts(reread), progress: acProgress(reread) })
      return
    }

    success(`${color.cyan(displayRef(issue))} — ${acProgress(reread)}`)
    list(reread)
  })
}

function checkNumbers(
  blocks: Parameters<typeof criteriaBlocks>[0],
  operands: readonly string[],
  action: 'check' | 'uncheck',
): number[] {
  if (operands.length === 0) {
    throw usageError(`\`atl issue ac ${action}\` expects at least one criterion number.`)
  }

  const numbers = operands.map((operand) => {
    const value = Number.parseInt(operand, 10)
    if (!Number.isInteger(value) || value < 1) {
      throw usageError(`Invalid criterion number: "${operand}".`)
    }
    return value
  })

  const total = criteriaBlocks(blocks).length
  if (total === 0) {
    throw new AtlError(
      `This issue has no "${AC_HEADING}" section.`,
      ExitCode.notFound,
      'Add one with `atl issue ac add <ref> "text"`.',
    )
  }

  const outOfRange = numbers.filter((n) => n > total)
  if (outOfRange.length > 0) {
    throw usageError(
      `This issue has only ${total} criterion(s): ${outOfRange.join(', ')} does not exist.`,
    )
  }

  return numbers
}

function criterionText(operands: readonly string[]): string {
  const text = operands.join(' ').trim()
  if (!text) throw usageError('`atl issue ac add` expects the criterion text.')
  return text
}

/** The ids stay internal: the output carries what the owner reads. */
function texts(criteria: readonly Criterion[]): Criterion[] {
  return criteria.map(({ text, checked }) => ({ text, checked }))
}

function render(context: Context, issue: Issue, criteria: readonly Criterion[]): void {
  if (context.json) {
    json({ ref: displayRef(issue), criteria: texts(criteria), progress: acProgress(criteria) })
    return
  }

  if (criteria.length === 0) {
    info(color.dim(`${displayRef(issue)} has no acceptance criteria.`))
    return
  }

  out(`${color.cyan(displayRef(issue))}  ${color.bold(acProgress(criteria))}`)
  out('')
  list(criteria)
}

function list(criteria: readonly Criterion[]): void {
  for (const [index, criterion] of criteria.entries()) {
    const mark = criterion.checked ? color.green('✓') : color.grey('○')
    const text = criterion.checked ? color.dim(criterion.text) : criterion.text
    out(`  ${color.dim(String(index + 1).padStart(2))}. ${mark} ${text}`)
  }
}
