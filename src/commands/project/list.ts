import { color } from '../../lib/color.ts'
import { withContext } from '../../lib/context.ts'
import { listTickets } from '../../lib/issues.ts'
import { info, json, out, table, type Column } from '../../lib/output.ts'
import { listProjects } from '../../lib/projects.ts'
import { paintState, stateIcon , stateLabel} from '../../model/enums.ts'
import { countByState, issuesOfProject, toProject, type ProjectDetail } from '../../model/project.ts'
import type { CommandContext } from '../../router.ts'

type Row = ProjectDetail & { total: number; active: number; done: number }

export async function projectList(ctx: CommandContext): Promise<void> {
  await withContext(ctx.json, async (context) => {
    const [projects, tickets] = await Promise.all([listProjects(context), listTickets(context)])

    const rows: Row[] = projects
      .map(({ object }) => {
        const project = toProject(object)
        const counts = countByState(issuesOfProject(tickets, project.id))

        return {
          ...project,
          total: counts.total,
          active: counts.active,
          done: counts.byState['done'] ?? 0,
        }
      })
      .sort((a, b) => b.total - a.total)

    if (context.json) {
      json(
        rows.map((r) => ({
          name: r.name,
          id: r.id,
          state: r.stateName ?? null,
          progress: r.progress ?? null,
          repo: r.repo ?? null,
          tickets: { total: r.total, active: r.active, done: r.done },
        })),
      )
      return
    }

    if (rows.length === 0) {
      info(color.dim('No project.'))
      return
    }

    out(table(rows, COLUMNS))
  })
}

const COLUMNS: readonly Column<Row>[] = [
  { header: 'PROJECT', value: (r) => r.name, render: (r) => color.bold(r.name), flex: 2 },
  {
    header: 'STATE',
    value: (r) => `${stateIcon(r.state)} ${stateLabel(r.state, r.stateName)}`,
    render: (r) => paintState(r.state, `${stateIcon(r.state)} ${stateLabel(r.state, r.stateName)}`),
  },
  {
    header: 'PROGRESS',
    value: (r) => (r.progress === undefined ? '–' : `${r.progress} %`),
    align: 'right',
  },
  { header: 'DONE', value: (r) => `${r.done}/${r.total}`, align: 'right' },
  { header: 'ACTIVE', value: (r) => String(r.active), align: 'right' },
  { header: 'REPO', value: (r) => r.repo ?? '', render: (r) => color.dim(r.repo ?? ''), flex: 3 },
]
