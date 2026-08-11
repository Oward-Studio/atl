import { color } from '../lib/color.ts'
import { definitionList, info, json, out, table, type Column } from '../lib/output.ts'
import { usageFile } from '../lib/paths.ts'
import {
  aggregate,
  BASELINE_CEILING_TOKENS,
  byCommand,
  CHARS_PER_TOKEN,
  disabled,
  readRecords,
  type PerCommand,
  type Totals,
} from '../lib/usage.ts'
import type { CommandContext } from '../router.ts'

/**
 * `atl gain` — what the CLI kept out of the context.
 *
 * Two volumes measured per invocation: what the API returned to `atl`, and what `atl`
 * wrote. The saving, however, is counted against a per-command baseline — the minimal
 * MCP sequence for the same intent — because "absorbed − rendered" would flatter the
 * commands that sweep the whole space for a single issue.
 *
 * The output keeps the two natures apart: what is measured, what is estimated.
 */
export async function gain(ctx: CommandContext): Promise<void> {
  const records = readRecords()
  const totals = aggregate(records)
  const perCommand = byCommand(records)

  if (ctx.json) {
    json({
      recording: !disabled(),
      log: usageFile(),
      charsPerToken: CHARS_PER_TOKEN,
      ceiling: BASELINE_CEILING_TOKENS,
      ...totals,
      commands: perCommand,
    })
    return
  }

  if (records.length === 0) {
    info(color.dim('No invocation recorded.'))
    info(
      color.dim(
        disabled()
          ? "Recording is disabled by ATL_NO_USAGE."
          : `The journal will fill up on the next command — ${usageFile()}`,
      ),
    )
    return
  }

  out('')
  out(definitionList(summary(totals)))
  out('')
  out(table(perCommand, COLUMNS))
  out('')

  // The figure would be dishonest without its method: the measured part and the
  // assumed part must stay distinct.
  info(color.dim(`${CHARS_PER_TOKEN} characters per token, the rtk heuristic.`))
  info(color.dim('Absorbed and rendered are measured; the MCP baseline is an estimate.'))

  if (totals.capped > 0) {
    info(
      color.dim(
        `${totals.capped} invocation(s) capped at ${tk(BASELINE_CEILING_TOKENS)} tokens: beyond that,`,
      ),
    )
    info(color.dim('the MCP equivalent was not expensive, it was impossible — see docs/ANYTYPE-LIMITS.md §3.8.'))
  } else {
    info(color.dim('Method in full: docs/ANYTYPE-LIMITS.md §3.8.'))
  }
  info(color.dim(`Journal: ${usageFile()} · ATL_NO_USAGE=1 records nothing.`))
}

function summary(totals: Totals): [string, string][] {
  const since = totals.since ? totals.since.slice(0, 10) : '–'

  return [
    ['Since', `${since} · ${totals.invocations} invocation(s) · ${totals.calls} API call(s)`],
    ['Absorbed by atl', `${tk(totals.absorbed)} tk ${color.dim('measured · returned by the API')}`],
    ['Rendered to context', `${tk(totals.rendered)} tk ${color.dim('measured · what you read')}`],
    ['MCP equivalent', `${tk(totals.baseline)} tk ${color.dim('calibrated · same intent')}`],
    [
      'Estimated saving',
      `${color.green(tk(totals.saved))} tk ${color.dim(`(${percent(totals.ratio)})`)}`,
    ],
  ]
}

const COLUMNS: readonly Column<PerCommand>[] = [
  { header: 'COMMAND', value: (r) => r.cmd, render: (r) => color.cyan(r.cmd), flex: 2 },
  { header: 'CALLS', value: (r) => String(r.invocations), align: 'right' },
  { header: 'RENDERED', value: (r) => tk(r.rendered), align: 'right' },
  { header: 'BASELINE', value: (r) => tk(r.baseline), align: 'right' },
  {
    header: 'SAVED',
    value: (r) => tk(r.saved),
    render: (r) => color.green(tk(r.saved)),
    align: 'right',
  },
  { header: '%', value: (r) => percent(r.ratio), align: 'right' },
]

/** Thousands grouping with a thin space, without relying on an ICU locale. */
function tk(value: number): string {
  const sign = value < 0 ? '-' : ''
  const digits = Math.abs(value).toString()
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ','
    grouped += digits[i]
  }
  return `${sign}${grouped}`
}

/**
 * A ratio of 0.997 must not print as "100 %": nothing is free, and rounding to the
 * integer would turn the saving into a perfection it does not reach.
 */
function percent(ratio: number): string {
  const rounded = Math.round(ratio * 100)
  if (rounded === 100 && ratio < 1) return `${(Math.floor(ratio * 1000) / 10).toFixed(1)} %`
  return `${rounded} %`
}
