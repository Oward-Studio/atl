import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { before, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'

const git = promisify(execFile)

/**
 * A command that runs `git pull` cannot be tested against the repository it lives in, so
 * each case gets a throwaway clone of a throwaway remote — `ATL_INSTALL_ROOT` is what
 * points the command at it. No network: the remote is a bare repository on disk.
 */
async function installation(): Promise<{ clone: string; remote: string }> {
  const base = await mkdtemp(join(tmpdir(), 'atl-update-'))
  const remote = join(base, 'remote.git')
  const work = join(base, 'work')
  const clone = join(base, 'clone')

  await git('git', ['init', '--bare', '-b', 'main', remote])
  await git('git', ['clone', '-q', remote, work])
  const config = async (dir: string): Promise<void> => {
    await git('git', ['-C', dir, 'config', 'user.email', 'probe@example.com'])
    await git('git', ['-C', dir, 'config', 'user.name', 'Probe'])
  }
  await config(work)
  await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'atl', version: '1.0.0' }))
  await git('git', ['-C', work, 'add', '.'])
  await git('git', ['-C', work, 'commit', '-qm', 'feat: first'])
  await git('git', ['-C', work, 'push', '-q', 'origin', 'main'])
  await git('git', ['clone', '-q', remote, clone])
  await config(clone)

  return { clone, remote: work }
}

/** Publishes a commit the clone has not seen, optionally bumping the version. */
async function publish(work: string, version?: string, alsoTouchLock = false): Promise<void> {
  if (version) {
    await writeFile(join(work, 'package.json'), JSON.stringify({ name: 'atl', version }))
  }
  if (alsoTouchLock) await writeFile(join(work, 'package-lock.json'), '{}')
  await writeFile(join(work, 'README.md'), `updated ${version ?? ''}`)
  await git('git', ['-C', work, 'add', '.'])
  await git('git', ['-C', work, 'commit', '-qm', 'feat: more'])
  await git('git', ['-C', work, 'push', '-q', 'origin', 'main'])
}

describe('atl update', () => {
  let sandbox: Sandbox
  let clone: string
  let remote: string

  before(async () => {
    sandbox = await makeSandbox({ authenticated: false })
  })

  beforeEach(async () => {
    ;({ clone, remote } = await installation())
  })

  const update = async (args: readonly string[] = []) =>
    runCli(['update', ...args], { sandbox, env: { ATL_INSTALL_ROOT: clone } })

  it('pulls, and reports the version it moved to', async () => {
    await publish(remote, '1.1.0')
    const result = await update(['--json'])

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { from: string; to: string; updated: boolean }
    assert.deepEqual([data.from, data.to, data.updated], ['1.0.0', '1.1.0', true])

    // The pull really happened, rather than the command reporting an intention.
    const declared = JSON.parse(await readFile(join(clone, 'package.json'), 'utf8')) as {
      version: string
    }
    assert.equal(declared.version, '1.1.0')
  })

  it('says so and writes nothing when there is nothing to pull', async () => {
    const result = await update(['--json'])

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { updated: boolean; reinstalled: boolean }
    assert.deepEqual([data.updated, data.reinstalled], [false, false])
  })

  it('reinstalls only when the lockfile moved', async () => {
    // Reinstalling on every update would spend a network round trip to learn that
    // nothing changed.
    await publish(remote, '1.1.0')
    const withoutLock = parseJson(await update(['--json'])) as { reinstalled: boolean }
    assert.equal(withoutLock.reinstalled, false)
  })

  it('refuses to invent a merge, and says what blocks the fast-forward', async () => {
    // A local commit diverges the clone. `--ff-only` reports rather than merging: an
    // update must not rewrite a history someone was working in.
    await writeFile(join(clone, 'local.txt'), 'mine')
    await git('git', ['-C', clone, 'add', '.'])
    await git('git', ['-C', clone, 'commit', '-qm', 'chore: local'])
    await publish(remote, '1.1.0')

    const result = await update()

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /fast-forward/)
  })

  it('works without an app key, since it touches neither Anytype nor the config', async () => {
    const result = await update(['--json'])

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { installedAt: string }
    assert.equal(data.installedAt, clone)
  })
})
