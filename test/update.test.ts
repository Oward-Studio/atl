import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'

describe('atl update', () => {
  let sandbox: Sandbox

  const declared = (): string =>
    (
      JSON.parse(
        readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
      ) as { version: string }
    ).version

  before(async () => {
    sandbox = await makeSandbox({ authenticated: true })
  })

  it('reports the installation, without needing Anytype', async () => {
    // No app key, no server: the command touches neither, which is why it works when
    // everything else is broken.
    const bare = await makeSandbox({ authenticated: false })
    const result = await runCli(['update', '--json'], { sandbox: bare })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { version: string; installedAt: string; commands: string[] }
    assert.equal(data.version, declared())
    assert.match(data.installedAt, /atl$/)
    assert.deepEqual(data.commands.slice(1), ['git pull', 'npm install'])
  })

  it('prints a line that can be pasted as it stands', async () => {
    const result = await runCli(['update'], { sandbox })

    assert.equal(result.code, 0, result.stderr)
    // stdout carries the command and nothing else, so `atl update | sh` is the user's
    // choice to make rather than the CLI's.
    assert.match(result.stdout.trim(), /^cd \S+ && git pull && npm install$/)
  })

  it('says it printed rather than ran', async () => {
    const result = await runCli(['update'], { sandbox })

    assert.match(result.stderr, /never invokes Git/)
  })

  it('finds its own installation, not the current directory', async () => {
    // Run from elsewhere: a path derived from `process.cwd()` would answer the sandbox.
    const result = await runCli(['update', '--json'], { sandbox, cwd: sandbox.configHome })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { installedAt: string }
    assert.notEqual(data.installedAt, sandbox.configHome)
    assert.match(data.installedAt, /atl$/)
  })
})
