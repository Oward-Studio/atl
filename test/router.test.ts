import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import { router } from '../src/commands/index.ts'
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

  it('exits with 1 on a planned command, announcing its phase', async () => {
    const result = await runCli(['issue', 'mv', 'x', 'y'], { sandbox })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /not implemented yet/)
    assert.match(result.stderr, /phase 2/)
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
            `${file.slice(SRC.length + 1)} référence ${forbidden}`,
          )
        }
      }
    })

    it('no command summary promises a Git operation', () => {
      for (const command of router.commands) {
        assert.doesNotMatch(
          command.summary,
          /crée la branche|checkout|git (add|commit|push|pull|branch|switch)/i,
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
