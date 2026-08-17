import { flagBool } from '../../lib/args.ts'
import { color } from '../../lib/color.ts'
import { type Context, withContext } from '../../lib/context.ts'
import { usageError } from '../../lib/errors.ts'
import { listTickets } from '../../lib/issues.ts'
import { deleteObject } from '../../lib/objects.ts'
import { info, json, success } from '../../lib/output.ts'
import { findProject, type Project } from '../../lib/projects.ts'
import { ask, isInteractive } from '../../lib/prompt.ts'
import type { Issue } from '../../model/issue.ts'
import { issuesOfProject } from '../../model/project.ts'
import type { CommandContext } from '../../router.ts'

/**
 * Deleting a project — and deciding what becomes of its issues, which Anytype does not
 * decide for you. Archiving a project there leaves every issue behind with no project:
 * fifteen of them survived the demonstration project that way, invisible outside
 * `atl ls --all-projects`. Closing that hole is the reason this command exists, so it
 * never performs the split silently.
 *
 * Issues go first, the project last. A failure midway then leaves a project holding
 * fewer issues — visible, and finishable — rather than the orphans the reverse order
 * would produce.
 */
export async function projectDelete(ctx: CommandContext): Promise<void> {
  const name = ctx.args.positionals.join(' ').trim()
  if (!name) {
    throw usageError(
      'Missing project name.',
      'Usage: `atl project delete "<name>"`, `--with-issues` to take its issues along.',
    )
  }

  await withContext(ctx.json, async (context) => {
    await deleteProject(context, name, {
      yes: flagBool(ctx.args, 'yes'),
      withIssues: flagBool(ctx.args, 'with-issues'),
    })
  })
}

type Options = { yes: boolean; withIssues: boolean }

async function deleteProject(context: Context, name: string, options: Options): Promise<void> {
  const project = await findProject(context, name)
  const issues = issuesOfProject(await listTickets(context), project.id)

  const decision = await decide(context, project, issues, options)
  if (decision === 'cancel') {
    info('Nothing deleted.')
    return
  }

  const taken = decision === 'with-issues' ? issues : []
  for (const issue of taken) {
    await deleteObject(context.api, context.spaceId, issue.id)
  }
  await deleteObject(context.api, context.spaceId, project.id)

  if (context.json) {
    json({
      archived: { project: project.name, issues: taken.length },
      orphaned: decision === 'project-only' ? issues.length : 0,
    })
    return
  }

  if (taken.length > 0) success(`${taken.length} issue(s) moved to the bin`)
  success(`${color.cyan(project.name)} moved to the bin`)
  if (decision === 'project-only' && issues.length > 0) {
    info(color.dim(`  ${issues.length} issue(s) now have no project.`))
    info(color.dim('  `atl issue edit <ref> --project <other>` re-files them.'))
  }
  info(color.dim('  Archived, not erased — emptying the bin is done in Anytype.'))
}

type Decision = 'with-issues' | 'project-only' | 'cancel'

/**
 * An empty project is a plain confirmation. A populated one is a choice, and the options
 * are worded by their consequence rather than as yes/no: the outcome nobody wants —
 * issues left without a project — must not be reachable by misreading a question.
 */
async function decide(
  context: Context,
  project: Project,
  issues: readonly Issue[],
  options: Options,
): Promise<Decision> {
  if (issues.length === 0) {
    if (options.yes) return 'project-only'
    if (context.json || !isInteractive()) throw needsTerminal(project, issues.length)
    return (await confirmed(`Send ${project.name} to Anytype's bin?`)) ? 'project-only' : 'cancel'
  }

  if (options.yes) return options.withIssues ? 'with-issues' : 'project-only'
  if (context.json || !isInteractive()) throw needsTerminal(project, issues.length)

  info(`${color.bold(project.name)} holds ${issues.length} issue(s).`)
  info(`  1. Send the project and its ${issues.length} issue(s) to the bin`)
  info(`  2. Send the project only — the ${issues.length} issue(s) stay, with no project`)
  info(color.dim('     `atl issue edit <ref> --project <other>` re-files them afterwards'))
  info('  3. Cancel')

  const answer = (await ask('Choose [1/2/3]')).trim()
  if (answer === '1') return 'with-issues'
  if (answer === '2') return 'project-only'
  return 'cancel'
}

const confirmed = async (question: string): Promise<boolean> =>
  /^(y|yes)$/i.test((await ask(`${question} [y/N]`)).trim())

/**
 * The only interface a script or an agent gets, so it spells out both commands rather
 * than naming a flag: the two outcomes differ by fifteen objects, and `--yes` alone does
 * not say which one it picks.
 */
function needsTerminal(project: Project, count: number) {
  const quoted = `"${project.name}"`
  if (count === 0) {
    return usageError(
      `Deleting ${project.name} needs a confirmation, and there is no terminal to ask in.`,
      `\`atl project delete ${quoted} --yes\` confirms from a script.`,
    )
  }
  return usageError(
    `${project.name} holds ${count} issue(s), and there is no terminal to ask in.`,
    [
      `\`atl project delete ${quoted} --with-issues --yes\``,
      `    sends the project and its ${count} issue(s) to the bin`,
      `\`atl project delete ${quoted} --yes\``,
      `    sends the project only — the ${count} issue(s) stay, with no project`,
    ].join('\n  '),
  )
}
