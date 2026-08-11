import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { router } from '../src/commands/index.ts'

/**
 * Guard: every implemented command must have its suite, named after its path
 * (`issue list` → `test/issue-list.test.ts`). Adding a command without a test fails
 * this suite, which is the point.
 *
 * Exception declared below: several commands that are mere parameterisations of one
 * another share a suite, rather than forcing six near-identical files. The exception
 * has to stay explicit so an untested command cannot be slipped into it.
 */
const SHARED_SUITES: Record<string, string> = {
  'issue-todo': 'issue-states',
  'issue-review': 'issue-states',
  'issue-done': 'issue-states',
  'issue-cancel': 'issue-states',
  'issue-backlog': 'issue-states',
  'issue-icons': 'issue-states',
  'project-unlink': 'project-link',
  'issue-unblock': 'issue-block',
}

describe('command coverage', () => {
  const implemented = router.commands.filter((c) => c.run)

  it('there really are implemented commands to cover', () => {
    assert.ok(implemented.length >= 3)
  })

  for (const command of implemented) {
    const own = command.path.join('-')
    const name = SHARED_SUITES[own] ?? own

    it(`\`atl ${command.path.join(' ')}\` a sa suite (${name}.test.ts)`, () => {
      const file = fileURLToPath(new URL(`./${name}.test.ts`, import.meta.url))
      assert.ok(existsSync(file), `missing suite: test/${name}.test.ts`)
    })
  }
})
