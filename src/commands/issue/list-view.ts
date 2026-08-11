import { color } from '../../lib/color.ts'
import { info, table, warn, type Column } from '../../lib/output.ts'
import {
  paintPriority,
  paintState,
  priorityIcon,
  stateEmoji,
  stateIcon,
  type StateKey,
  stateLabel,
} from '../../model/enums.ts'
import type { Graph } from '../../model/graph.ts'
import { displayRef, type Issue } from '../../model/issue.ts'
import { hasHtmlEntities } from '../../model/object.ts'

/** An issue ready to display: the issue, plus what only the view can say. */
export type Row = Issue & {
  projects: string[]
  /** Icon carried by the object, to spot a misaligned one. */
  icon: string | undefined
  /** Blocked by an unclosed issue — saves an `issue view` per row. */
  blocked: boolean
}

/**
 * Narrow glyph: the table aligns on code-point count, not rendered width, so a wide
 * emoji would shift every following column.
 */
const BLOCKED_MARK = '⊘'

const BLOCKED_COLUMN: Column<Row> = {
  header: '',
  value: (r) => (r.blocked ? BLOCKED_MARK : ''),
  render: (r) => (r.blocked ? color.red(BLOCKED_MARK) : ''),
}

const COLUMNS: readonly Column<Row>[] = [
  {
    header: 'REF',
    value: (r) => displayRef(r),
    render: (r) => color.cyan(displayRef(r)),
    flex: 1,
  },
  {
    header: '',
    value: (r) => stateIcon(r.state),
    render: (r) => paintState(r.state, stateIcon(r.state)),
  },
  {
    header: 'STATE',
    value: (r) => stateLabel(r.state, r.stateName),
    render: (r) => paintState(r.state, stateLabel(r.state, r.stateName)),
  },
  {
    header: 'PRIO',
    value: (r) => priorityIcon(r.priority),
    render: (r) => paintPriority(r.priority, priorityIcon(r.priority)),
  },
  BLOCKED_COLUMN,
  { header: 'TITLE', value: (r) => r.title, flex: 4 },
  {
    header: 'PROJECT',
    value: (r) => r.projects.join(', '),
    render: (r) => color.dim(r.projects.join(', ')),
    flex: 2,
  },
]

/**
 * The blocking column only appears when it has something to say: an empty one would
 * cost two spaces per row for nothing.
 */
export function renderTable(rows: readonly Row[]): string {
  const showBlocked = rows.some((r) => r.blocked)
  return table(rows, showBlocked ? COLUMNS : COLUMNS.filter((c) => c !== BLOCKED_COLUMN))
}

export const JSON_FIELDS = [
  'ref',
  'id',
  'title',
  'state',
  'priority',
  'label',
  'projects',
  'branch',
  'blocked',
  'updatedAt',
] as const

export type JsonField = (typeof JSON_FIELDS)[number]

/** JSON row, trimmed to the requested fields when there are any. */
export function pick(row: Row, fields: readonly string[] | undefined): Record<string, unknown> {
  const full: Record<JsonField, unknown> = {
    ref: row.ref ?? null,
    id: row.id,
    title: row.title,
    // The stored names, not the keys: `--json` mirrors what the space displays.
    state: row.stateName ?? null,
    priority: row.priorityName ?? null,
    label: row.label ?? null,
    projects: row.projects,
    branch: row.branch ?? null,
    blocked: row.blocked,
    updatedAt: row.updatedAt ?? null,
  }

  if (fields === undefined) return full

  // The requested order is honoured: it is the one that gets read back.
  return Object.fromEntries(fields.map((f) => [f, full[f as JsonField]]))
}

/**
 * What the already-fetched objects allow reporting without one more call. No fixing
 * here: fixing would be a write triggered by a read command.
 */
export function reportDiagnostics(rows: readonly Row[], graph: Graph): void {
  if (rows.some((r) => r.blocked)) {
    info(color.dim(`${BLOCKED_MARK} blocked by an unfinished issue`))
  }

  // A relation posted on one side only is invisible from the other in the app.
  const halves = graph
    .halfPosed()
    .filter((h) => rows.some((r) => r.id === h.blocker.id || r.id === h.blocked.id))
  if (halves.length > 0) {
    warn(`${halves.length} blocking relation(s) posted on one side only:`)
    for (const half of halves.slice(0, 5)) {
      info(
        color.dim(
          `    atl issue block ${displayRef(half.blocked)} --by ${displayRef(half.blocker)}  to complete it`,
        ),
      )
    }
  }

  const misaligned = rows.filter(
    (r) => r.state !== undefined && r.icon !== stateEmoji(r.state as StateKey),
  )
  if (misaligned.length > 0) {
    warn(
      `${misaligned.length} icon(s) misaligned from their state — \`atl issue icons\` to realign:`,
    )
    for (const row of misaligned.slice(0, 5)) {
      info(
        color.dim(
          `    ${displayRef(row)} — ${row.icon ?? '–'} → ${stateEmoji(row.state as StateKey)}  ${row.title}`,
        ),
      )
    }
  }

  // An HTML entity in a title is data corruption, not a display artefact.
  const corrupted = rows.filter((r) => hasHtmlEntities(r.title))
  if (corrupted.length > 0) {
    warn(`${corrupted.length} title(s) contain HTML entities, unreadable in Anytype:`)
    for (const row of corrupted.slice(0, 5)) {
      info(color.dim(`    ${displayRef(row)} — ${row.title}`))
    }
  }
}
