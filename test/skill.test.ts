import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { router } from '../src/commands/index.ts'
import { GLOBAL_FLAGS } from '../src/lib/args.ts'
import { commandFlags, findCommand } from '../src/router.ts'

/**
 * The skill describes the CLI to Claude. If it drifts — a renamed command, a vanished
 * option — it will lie silently, and nobody will notice before a session goes wrong.
 * These tests confront it with the real registry.
 */
const SKILL = readFileSync(fileURLToPath(new URL('../skill/SKILL.md', import.meta.url)), 'utf8')

/** The invocations inside code blocks, the only executable ones. */
function invocations(markdown: string): string[] {
  const blocks = markdown.match(/```sh\n[\s\S]*?```/g) ?? []

  return blocks
    .flatMap((block) => block.split('\n'))
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.startsWith('atl '))
}

const tokens = (line: string): string[] =>
  line
    // A shell substitution is an argument, not atl options: `$(git
    // branch --show-current)` must not read as a `--show-current`.
    .replace(/\$\([^)]*\)/g, 'ARG')
    .slice(4)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/^\[|\]$/g, ''))

describe('skill/SKILL.md', () => {
  const lines = invocations(SKILL)

  it('contains executable examples', () => {
    assert.ok(lines.length >= 10, `${lines.length} invocation(s) found`)
  })

  for (const line of lines) {
    it(`"${line}" resolves to an implemented command`, () => {
      const match = findCommand(router, tokens(line))
      assert.ok(match, 'no command matches')
      assert.ok(match.command.run, `\`${match.command.path.join(' ')}\` is not implemented`)
    })
  }

  for (const line of lines) {
    const flags = tokens(line).filter((t) => t.startsWith('--'))
    if (flags.length === 0) continue

    it(`"${line}" uses only declared options`, () => {
      const match = findCommand(router, tokens(line))
      assert.ok(match)

      const declared = new Set(commandFlags(match.command).map((f) => f.name))
      for (const flag of flags) {
        assert.ok(declared.has(flag.slice(2)), `${flag} does not exist on this command`)
      }
    })
  }

  it('mentions every implemented command, hiding nothing from Claude', () => {
    const documented = SKILL.replace(/\s+/g, ' ')

    for (const command of router.commands.filter((c) => c.run)) {
      const names = [command.path.join(' '), ...(command.aliases ?? [])]
      assert.ok(
        names.some((name) => documented.includes(name)),
        `\`atl ${command.path.join(' ')}\` is documented under none of its names`,
      )
    }
  })

  it('documents the exit codes of the contract', () => {
    for (const code of ['2', '3', '4', '5']) {
      assert.match(SKILL, new RegExp(`\\|\\s*${code}\\s*\\|`), `code ${code} absent`)
    }
  })

  it('carries the token-saving instruction, which is its reason to exist', () => {
    assert.match(SKILL, /--json/)
    assert.match(SKILL, /table/i)
  })

  it('states that the CLI does not touch Git', () => {
    assert.match(SKILL, /never touches Git|runs no Git/)
  })

  it('declares a frontmatter with a name and a description', () => {
    const frontmatter = SKILL.match(/^---\n([\s\S]*?)\n---/)
    assert.ok(frontmatter, 'frontmatter absent')
    assert.match(frontmatter[1] as string, /^name: atl$/m)
    assert.match(frontmatter[1] as string, /description:/)
  })

  it('the global options stay valid', () => {
    assert.deepEqual(
      GLOBAL_FLAGS.map((f) => f.name).sort(),
      ['help', 'json', 'no-color', 'version'],
    )
  })
})
