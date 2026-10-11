import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { AtlError, ExitCode, usageError } from '../../lib/errors.ts'
import { findIssue } from '../../lib/issues.ts'
import { info, json, out, success } from '../../lib/output.ts'
import { acProgress, AC_HEADING, type Criterion } from '../../model/acceptance.ts'
import { displayRef, type Issue } from '../../model/issue.ts'
import type { CommandContext } from '../../router.ts'

const ACTIONS = ['check', 'uncheck', 'add'] as const
type Action = (typeof ACTIONS)[number]

/**
 * `atl issue ac <ref>` lists, `atl issue ac check|uncheck <ref> <n…>` tick and untick,
 * `atl issue ac add <ref> "text"` appends.
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
    const snapshot = await context.body.read(issue.id)

    if (!action) {
      render(context, issue, snapshot.criteria)
      return
    }

    const { criteria } =
      action === 'add'
        ? await context.body.addCriterion(snapshot, criterionText(operands))
        : await context.body.setChecked(
            snapshot,
            checkNumbers(snapshot.criteria.length, operands, action),
            action === 'check',
          )

    if (context.json) {
      json({ ref: displayRef(issue), criteria, progress: acProgress(criteria) })
      return
    }

    success(`${color.cyan(displayRef(issue))} — ${acProgress(criteria)}`)
    list(criteria)
  })
}

function checkNumbers(total: number, operands: readonly string[], action: 'check' | 'uncheck') {
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

function render(context: Context, issue: Issue, criteria: readonly Criterion[]): void {
  if (context.json) {
    json({ ref: displayRef(issue), criteria, progress: acProgress(criteria) })
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
