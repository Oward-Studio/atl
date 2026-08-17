import { stateSeed } from '../model/enums.ts'
import type { Command, Router } from '../router.ts'
import { auth } from './auth.ts'
import { cacheClear } from './cache.ts'
import { gain } from './gain.ts'
import { init } from './init.ts'
import { space } from './space.ts'
import { issueAc } from './issue/ac.ts'
import { issueBlock, issueUnblock } from './issue/block.ts'
import { issueEdit } from './issue/edit.ts'
import { issueList } from './issue/list.ts'
import { issueNew } from './issue/new.ts'
import { issueStart } from './issue/start.ts'
import { issueIcons, transition } from './issue/state.ts'
import { issueView } from './issue/view.ts'
import { projectList } from './project/list.ts'
import { projectLink, projectUnlink } from './project/link.ts'
import { projectNew } from './project/new.ts'
import { projectStats } from './project/stats.ts'
import { projectView } from './project/view.ts'

/**
 * Command registry.
 *
 * A command without `run` is *planned*: it appears in the help with its phase and
 * fails cleanly when called. The registry is the single source of the surface, which
 * makes `atl --help` usable as a roadmap.
 */

const STATE_FLAGS = [
  {
    name: 'state',
    short: 's',
    kind: 'string',
    placeholder: '<state>',
    description: 'Filter by state (backlog, todo, started, review, done, canceled)',
    repeatable: true,
  },
] as const

const commands: Command[] = [
  // ------------------------------------------------------------ tickets
  {
    path: ['issue', 'new'],
    aliases: ['new'],
    operands: '"<title>"',
    summary: 'Creates an issue',
    phase: 1,
    flags: [
      { name: 'priority', short: 'p', kind: 'string', placeholder: '<priority>', description: 'Priority (urgent, high, medium, low, none)' },
      { name: 'label', short: 'l', kind: 'string', placeholder: '<label>', description: 'Dev label (Bug, Feature, Refactor…)' },
      { name: 'state', short: 's', kind: 'string', placeholder: '<state>', description: `Initial state (default: ${stateSeed('todo').name.toLowerCase()}; \`backlog\` to park it)` },
      { name: 'project', kind: 'string', placeholder: '<project>', description: 'Project to attach to' },
      { name: 'description', short: 'd', kind: 'string', placeholder: '<text>', description: 'Description (issue body)' },
      { name: 'ac', kind: 'string', placeholder: '<text>', description: 'Acceptance criterion (repeatable)', repeatable: true },
      { name: 'ref', kind: 'string', placeholder: '<slug>', description: 'Reference (default: derived from the title)' },
      { name: 'all-projects', kind: 'boolean', description: 'Creates without a project, despite folder scope' },
    ],
    run: issueNew,
  },
  {
    path: ['issue', 'list'],
    aliases: ['ls'],
    summary: 'Lists the issues (active ones by default)',
    phase: 1,
    flags: [
      ...STATE_FLAGS,
      { name: 'project', kind: 'string', placeholder: '<project>', description: 'Filter by project' },
      { name: 'priority', short: 'p', kind: 'string', placeholder: '<priority>', description: 'Filter by priority' },
      { name: 'label', short: 'l', kind: 'string', placeholder: '<label>', description: 'Filter by dev label' },
      { name: 'all', short: 'a', kind: 'boolean', description: 'Includes done and canceled issues' },
      { name: 'sort', kind: 'string', placeholder: '<field>', description: 'Sort: state (default), priority, updated' },
      { name: 'fields', kind: 'string', placeholder: '<list>', description: 'Fields of the JSON output, comma separated' },
      { name: 'all-projects', kind: 'boolean', description: 'Ignores the current folder scope' },
    ],
    run: issueList,
  },
  {
    path: ['issue', 'view'],
    aliases: ['view'],
    operands: '<ref>',
    summary: 'Shows the detail of an issue',
    phase: 1,
    run: issueView,
  },
  {
    path: ['issue', 'edit'],
    operands: '<ref>',
    summary: 'Edits title, description, priority, label or project',
    phase: 1,
    flags: [
      { name: 'title', short: 't', kind: 'string', placeholder: '<title>', description: 'New title' },
      { name: 'description', short: 'd', kind: 'string', placeholder: '<text>', description: 'New description (criteria are preserved)' },
      { name: 'priority', short: 'p', kind: 'string', placeholder: '<priority>', description: 'Priority' },
      { name: 'label', short: 'l', kind: 'string', placeholder: '<label>', description: 'Dev label' },
      { name: 'project', kind: 'string', placeholder: '<project>', description: 'Project to attach to' },
      { name: 'link', kind: 'string', placeholder: '<url>', description: 'GitHub link (branch or PR)' },
    ],
    run: issueEdit,
  },
  {
    path: ['issue', 'start'],
    aliases: ['start'],
    operands: '<ref>',
    summary: `Moves to ${stateSeed('in_progress').name} and records the branch (no Git command)`,
    phase: 1,
    flags: [
      { name: 'branch', short: 'b', kind: 'string', placeholder: '<name>', description: 'Forces the branch name' },
      { name: 'no-branch', kind: 'boolean', description: 'Changes the state only, touching no branch field' },
    ],
    run: issueStart,
  },
  { path: ['issue', 'todo'], operands: '<ref>', summary: `Moves the issue to ${stateSeed('todo').name}`, phase: 1, run: transition('todo') },
  { path: ['issue', 'review'], aliases: ['review'], operands: '<ref>', summary: `Moves the issue to ${stateSeed('in_review').name}`, phase: 1, run: transition('in_review') },
  { path: ['issue', 'done'], aliases: ['done'], operands: '<ref>', summary: `Moves the issue to ${stateSeed('done').name}`, phase: 1, run: transition('done') },
  { path: ['issue', 'cancel'], operands: '<ref>', summary: `Moves the issue to ${stateSeed('canceled').name}`, phase: 1, run: transition('canceled') },
  { path: ['issue', 'backlog'], operands: '<ref>', summary: `Sends the issue back to ${stateSeed('backlog').name}`, phase: 1, run: transition('backlog') },
  {
    path: ['issue', 'ac'],
    operands: '[check|uncheck|add] <ref> [<n…>|"<text>"]',
    summary: 'Lists, ticks or adds acceptance criteria',
    phase: 1,
    run: issueAc,
  },
  {
    path: ['issue', 'icons'],
    summary: 'Realigns issue icons with their state',
    phase: 1,
    flags: [
      { name: 'project', kind: 'string', placeholder: '<project>', description: 'Restricts to that project' },
      { name: 'dry-run', kind: 'boolean', description: 'Shows what would change, without writing' },
      { name: 'all-projects', kind: 'boolean', description: 'The whole space — overwrites personal icons of other projects' },
    ],
    run: issueIcons,
  },
  {
    path: ['issue', 'label'],
    operands: 'add|rm <ref> <label>',
    summary: 'Adds or removes a label',
    phase: 1,
  },
  {
    path: ['issue', 'mv'],
    operands: '<ref> <project>',
    summary: 'Attaches the issue to another project',
    phase: 2,
  },
  {
    path: ['issue', 'block'],
    operands: '<ref> --by|--blocks <ref2>',
    summary: 'Declares a blocked-by / blocks relation',
    phase: 2,
    flags: [
      { name: 'by', kind: 'string', placeholder: '<ref>', description: 'Issue that blocks this one' },
      { name: 'blocks', kind: 'string', placeholder: '<ref>', description: 'Issue blocked by this one' },
    ],
    run: issueBlock,
  },
  {
    path: ['issue', 'unblock'],
    operands: '<ref> --by|--blocks <ref2>',
    summary: 'Removes a blocked-by / blocks relation',
    phase: 2,
    flags: [
      { name: 'by', kind: 'string', placeholder: '<ref>', description: 'Issue that was blocking this one' },
      { name: 'blocks', kind: 'string', placeholder: '<ref>', description: 'Issue this one was blocking' },
    ],
    run: issueUnblock,
  },

  // ------------------------------------------------------------ projects
  { path: ['project', 'list'], summary: 'Lists the projects', phase: 3, run: projectList },
  {
    path: ['project', 'view'],
    operands: '<project>',
    summary: 'Detail of a project and its issues',
    phase: 3,
    run: projectView,
  },
  {
    path: ['project', 'new'],
    operands: '"<name>"',
    summary: 'Creates a project from the template',
    phase: 3,
    flags: [
      { name: 'state', short: 's', kind: 'string', placeholder: '<state>', description: `Initial state (default: ${stateSeed('in_progress').name.toLowerCase()})` },
      { name: 'repo', kind: 'string', placeholder: '<url>', description: 'Repository URL' },
    ],
    run: projectNew,
  },
  {
    path: ['project', 'link'],
    operands: '[<project>]',
    summary: 'Links the current folder to a project, or lists the links',
    phase: 5,
    run: projectLink,
  },
  {
    path: ['project', 'unlink'],
    summary: 'Removes the link of the current folder',
    phase: 5,
    run: projectUnlink,
  },
  {
    path: ['project', 'stats'],
    operands: '<project>',
    summary: 'Recomputes and writes the progress (%)',
    phase: 3,
    flags: [{ name: 'dry-run', kind: 'boolean', description: 'Shows the computation without writing' }],
    run: projectStats,
  },

  // ------------------------------------------------------------ system
  {
    path: ['space'],
    operands: '[<name>]',
    summary: 'Changes the default space, or lists the spaces',
    phase: 0,
    flags: [],
    run: space,
  },
  {
    path: ['init'],
    summary: 'Creates the dev types in an empty space',
    phase: 7,
    flags: [
      { name: 'dry-run', kind: 'boolean', description: 'Announces what would be created, without writing' },
      { name: 'space', kind: 'string', placeholder: '<name>', description: 'Space to bootstrap (default: the one in the config)' },
    ],
    run: init,
  },
  {
    path: ['gain'],
    summary: 'Tokens absorbed by atl instead of the context',
    phase: 5,
    flags: [],
    run: gain,
  },
  {
    path: ['auth'],
    summary: 'Saves and verifies the Anytype app key',
    phase: 0,
    flags: [
      { name: 'key', kind: 'string', placeholder: '<app-key>', description: 'App key (otherwise typed interactively)' },
      { name: 'request', kind: 'boolean', description: 'Creates a challenge and prints its id (non-interactive mode)' },
      { name: 'challenge', kind: 'string', placeholder: '<id>', description: 'Challenge id, together with --code' },
      { name: 'code', kind: 'string', placeholder: '<code>', description: 'Four-digit code shown by Anytype' },
      { name: 'space', kind: 'string', placeholder: '<name>', description: 'Default space' },
      { name: 'api-url', kind: 'string', placeholder: '<url>', description: 'Local Anytype API' },
      { name: 'status', kind: 'boolean', description: 'Prints the current config without changing it' },
    ],
    run: auth,
  },
  {
    path: ['cache', 'clear'],
    summary: 'Clears the name-resolution cache',
    phase: 0,
    run: cacheClear,
  },
]

export const router: Router = { commands }
