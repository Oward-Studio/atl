import {
  propDate,
  propMultiSelect,
  propObjects,
  propSelect,
  propSelectKey,
  propText,
  propUrl,
  type AnytypeObject,
} from './object.ts'

/** Semantic keys of the `dev_issue` type. Stable and readable, not ids. */
export const TICKET_TYPE_KEY = 'dev_issue'
export const PROJECT_TYPE_KEY = 'dev_project'

/** Properties declared by the `dev_issue` type. */
export const PROP = {
  ref: 'ref',
  state: 'state',
  priority: 'priority',
  /** Dev label. Never `tag`, which is reserved for the space's personal vocabulary. */
  label: 'dev_label',
  projects: 'linked_projects',
  blockedBy: 'blocked_by',
  blocking: 'blocking',
  branch: 'github_branch',
  /**
   * Direct link to the code: the branch once `atl issue start` records it, then the
   * pull request once the caller sets it — the PR supersedes the branch as the
   * reference artefact, as in Linear.
   */
  link: 'github_link',
} as const

/** Properties declared by the `dev_project` type. */
export const PROJECT_PROP = {
  state: 'state',
  progress: 'progress',
  repo: 'repo',
} as const

/** Provided by Anytype on every object, not declared by a type. */
export const UPDATED_PROP = 'last_modified_date'

export type Issue = {
  id: string
  /** May be missing: an issue created by hand in Anytype has no ref necessarily. */
  ref: string | undefined
  title: string
  /** Tag **key** of the state — stable across renames. */
  state: string | undefined
  /** Name Anytype currently stores for that state, for display. */
  stateName: string | undefined
  /** Tag **key** of the priority. */
  priority: string | undefined
  /** Name Anytype currently stores for that priority. */
  priorityName: string | undefined
  /** `dev_label` is a select: at most one label per issue. Resolved by name, since
   * labels are free vocabulary rather than a closed set the CLI decides on. */
  label: string | undefined
  projectIds: string[]
  branch: string | undefined
  /** Stored link: branch, then PR. Absent until `start` has run. */
  link: string | undefined
  blockedBy: string[]
  blocking: string[]
  updatedAt: string | undefined
}

export function toIssue(object: AnytypeObject): Issue {
  return {
    id: object.id,
    ref: propText(object, PROP.ref),
    title: object.name,
    // Canonicalised once, here: everything downstream compares canonical keys, and a
    // space still carrying the legacy ones reads identically.
    state: propSelectKey(object, PROP.state),
    stateName: propSelect(object, PROP.state),
    priority: propSelectKey(object, PROP.priority),
    priorityName: propSelect(object, PROP.priority),
    label: propSelect(object, PROP.label),
    projectIds: propObjects(object, PROP.projects),
    branch: propText(object, PROP.branch),
    link: propUrl(object, PROP.link),
    blockedBy: propObjects(object, PROP.blockedBy),
    blocking: propObjects(object, PROP.blocking),
    updatedAt: propDate(object, UPDATED_PROP),
  }
}

/**
 * Direct link to the branch on the forge, built from the project's `repo` property:
 * no account and no host is hardcoded.
 */
export function branchUrl(repo: string | undefined, branch: string | undefined): string | undefined {
  if (!repo || !branch) return undefined

  const base = repo.replace(/\.git$/, '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) return undefined

  return `${base}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
}

/** Displayed identifier: the `ref` when present, otherwise a short recognisable id. */
export function displayRef(issue: Issue): string {
  return issue.ref ?? `#${issue.id.slice(-6)}`
}
