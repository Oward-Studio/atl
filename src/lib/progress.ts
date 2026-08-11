import { color } from './color.ts'
import { updateObject } from './objects.ts'
import { info } from './output.ts'
import { listProjects } from './projects.ts'
import type { Context } from './context.ts'
import { PROJECT_PROP, type Issue } from '../model/issue.ts'
import { computeProgress } from '../model/project.ts'
import { propNumber } from '../model/object.ts'

/**
 * Progress is derived data: any event changing the numerator or the denominator
 * makes it wrong. Transitions and creations recompute it.
 *
 * The caller supplies the issues, already loaded and corrected for the write it just
 * made: nothing is re-read. Projects are fetched, though — for the stored value and
 * the name, which avoids a write when nothing moves and allows printing the
 * variation. Writing without saying so is forbidden (docs/ANYTYPE-LIMITS.md §3.2).
 */
export type ProgressWrite = { project: string; from: number | undefined; to: number }

export async function syncProgress(
  context: Context,
  issues: readonly Issue[],
  projectIds: readonly string[],
): Promise<ProgressWrite[]> {
  if (projectIds.length === 0) return []

  const projects = await listProjects(context)
  const writes: ProgressWrite[] = []

  for (const id of projectIds) {
    const project = projects.find((p) => p.id === id)
    if (!project) continue

    const stored = propNumber(project.object, PROJECT_PROP.progress)
    const computed = computeProgress(issues.filter((issue) => issue.projectIds.includes(id)))
    if (stored === computed.percent) continue

    await updateObject(context.api, context.spaceId, id, {
      properties: [{ key: PROJECT_PROP.progress, number: computed.percent }],
    })
    writes.push({ project: project.name, from: stored, to: computed.percent })
  }

  return writes
}

/** One quiet line per project touched, on stderr like every human message. */
export function reportProgress(writes: readonly ProgressWrite[]): void {
  for (const write of writes) {
    const from = write.from === undefined ? '–' : `${write.from} %`
    info(color.dim(`  ${write.project} — ${from} → ${write.to} %`))
  }
}

/**
 * The issues as they stand **after** the write just performed: the loaded list
 * predates it, and computing on it would yield the old percentage.
 */
export function withState(issues: readonly Issue[], id: string, state: string): Issue[] {
  return issues.map((issue) => (issue.id === id ? { ...issue, state } : issue))
}
