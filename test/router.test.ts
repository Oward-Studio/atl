import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import { router } from '../src/commands/index.ts'
import { AtlError } from '../src/lib/errors.ts'
import { assertImplemented } from '../src/router.ts'
import { makeSandbox, runCli, type Sandbox } from './helpers/cli.ts'

describe('routing', () => {
  let sandbox: Sandbox

  before(async () => {
    sandbox = await makeSandbox()
  })

  it('displays the help with no argument', async () => {
    const result = await runCli([], { sandbox })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /Anytype as Linear/)
    assert.match(result.stdout, /issue list/)
    assert.match(result.stdout, /Global options/)
  })

  it('prints the version', async () => {
    const result = await runCli(['--version'], { sandbox })
    assert.equal(result.code, 0)
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/)
  })

  it('displays the help of a bare domain', async () => {
    const result = await runCli(['issue'], { sandbox })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /atl issue <action>/)
    assert.doesNotMatch(result.stdout, /project list/)
  })

  it('displays the help of a command with its aliases', async () => {
    const result = await runCli(['issue', 'start', '--help'], { sandbox })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /Alias:.*atl start/)
    assert.match(result.stdout, /--branch/)
  })

  it('resolves a top-level alias', async () => {
    const alias = await runCli(['ls', '--help'], { sandbox })
    assert.equal(alias.code, 0)
    assert.match(alias.stdout, /atl issue list/)
  })

  it('exits with 2 on an unknown command', async () => {
    const result = await runCli(['bogus', 'cmd'], { sandbox })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Unknown command/)
  })

  it('suggests the nearest command rather than only pointing at --help', async () => {
    const result = await runCli(['isue', 'list'], { sandbox })

    assert.equal(result.code, 2)
    assert.match(result.stderr, /Did you mean `atl issue list`\?/)
  })

  it('suggests nothing when the typo resembles no command', async () => {
    const result = await runCli(['wxyz'], { sandbox })

    assert.equal(result.code, 2)
    assert.doesNotMatch(result.stderr, /Did you mean/)
    assert.match(result.stderr, /atl --help/)
  })

  it('exits with 2 on an unknown option', async () => {
    const result = await runCli(['issue', 'list', '--nope'], { sandbox })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Unknown option/)
  })

  it('exits with 2 when an option expects a value', async () => {
    const result = await runCli(['issue', 'list', '--sort'], { sandbox })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /expects a value/)
  })

  it('reports the version package.json declares, not a copy of it', async () => {
    // release-please bumps package.json alone. A literal anywhere else would drift at
    // the first release, and `--version` is what a bug report quotes.
    const declared = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    const result = await runCli(['--version'], { sandbox })

    assert.equal(result.stdout.trim(), declared.version)
  })

  it('every declared command is implemented', () => {
    // A command in the help that answers "not implemented yet" is a promise the project
    // has to keep. Two were declared and then cancelled as duplicates of `issue edit`,
    // and stayed in the help for a week.
    const planned = router.commands.filter((c) => !c.run).map((c) => c.path.join(' '))
    assert.deepEqual(planned, [])
  })

  it('refuses a command declared without an implementation, naming its phase', () => {
    // The guard still has to work: `assertImplemented` is what stands between a
    // half-declared command and a confusing crash.
    assert.throws(
      () => assertImplemented({ path: ['issue', 'ghost'], summary: '', phase: 7 }),
      (error: unknown) => {
        assert.ok(error instanceof AtlError)
        assert.equal(error.exitCode, 1)
        assert.match(error.message, /not implemented yet/)
        assert.match(error.message, /phase 7/)
        return true
      },
    )
  })

  after(() => {})

  describe('the CLI does not touch Git', () => {
    // Frozen decision: `atl` drives Anytype, the caller supplies the Git context. A
    // structural guard beats a code review.
    const SRC = fileURLToPath(new URL('../src', import.meta.url))

    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = `${dir}/${entry}`
        return statSync(full).isDirectory() ? sources(full) : full.endsWith('.ts') ? [full] : []
      })

    it('runs no external process', () => {
      for (const file of sources(SRC)) {
        const code = readFileSync(file, 'utf8')
        for (const forbidden of ['child_process', 'execFile', 'execSync', 'spawn']) {
          assert.doesNotMatch(
            code,
            new RegExp(forbidden),
            `${file.slice(SRC.length + 1)} references ${forbidden}`,
          )
        }
      }
    })

    it('no command summary promises a Git operation', () => {
      for (const command of router.commands) {
        assert.doesNotMatch(
          command.summary,
          /creates? the branch|checkout|git (add|commit|push|pull|branch|switch)/i,
          `atl ${command.path.join(' ')}`,
        )
      }
    })

    it('no command advertises its ref as optional', () => {
      // Inferring the issue from the current branch was abandoned: a ref in brackets
      // would promise an implicit fallback that does not exist.
      for (const command of router.commands) {
        assert.doesNotMatch(
          command.operands ?? '',
          /\[<ref>\]/,
          `atl ${command.path.join(' ')}`,
        )
      }
    })
  })
})
