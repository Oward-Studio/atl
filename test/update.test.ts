import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  await writeFile(
    join(work, 'package.json'),
    JSON.stringify({ name: 'atl', version: '1.0.0', dependencies: {} }),
  )
  // A lockfile npm will accept, and the marker it writes once dependencies are in place.
  // `npm ci` refuses without the first; `needsInstall` reinstalls without the second.
  await writeFile(
    join(work, 'package-lock.json'),
    JSON.stringify({
      name: 'atl',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'atl', version: '1.0.0' } },
    }),
  )
  await git('git', ['-C', work, 'add', '.'])
  await git('git', ['-C', work, 'commit', '-qm', 'feat: first'])
  await git('git', ['-C', work, 'push', '-q', 'origin', 'main'])
  await git('git', ['clone', '-q', remote, clone])
  await config(clone)
  await mkdir(join(clone, 'node_modules'), { recursive: true })
  await writeFile(join(clone, 'node_modules', '.package-lock.json'), '{}')

  return { clone, remote: work }
}

/** Publishes a commit the clone has not seen, optionally bumping the version. */
async function publish(work: string, version?: string, alsoTouchLock = false): Promise<void> {
  if (version) {
    await writeFile(
      join(work, 'package.json'),
      JSON.stringify({ name: 'atl', version, dependencies: {} }),
    )
  }
  if (alsoTouchLock) {
    await writeFile(
      join(work, 'package-lock.json'),
      JSON.stringify({
        name: 'atl',
        version: version ?? '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'atl', version: version ?? '1.0.0' } },
      }),
    )
  }
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

  it('leaves the dependencies alone when the lockfile did not move', async () => {
    // Reinstalling on every update would spend a network round trip to learn that
    // nothing changed.
    await publish(remote, '1.1.0')
    const data = parseJson(await update(['--json'])) as { reinstalled: boolean }
    assert.equal(data.reinstalled, false)
  })

  it('reinstalls when the lockfile moved', async () => {
    await publish(remote, '1.1.0', true)
    const result = await update(['--json'])

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { reinstalled: boolean }
    assert.equal(data.reinstalled, true)
  })

  it('retries the install when npm left no record of one', async () => {
    // `npm ci` empties node_modules before fetching, so an interrupted install leaves a
    // clone on new code with no dependencies. Deciding from the pull range alone, the
    // next run would report "already up to date" and never retry.
    await rm(join(clone, 'node_modules'), { recursive: true, force: true })
    const data = parseJson(await update(['--json'])) as { pulled: number; reinstalled: boolean }

    assert.equal(data.pulled, 0, 'nothing to pull, yet')
    assert.equal(data.reinstalled, true, 'the missing install is retried')
  })

  it('refuses on a working branch instead of reporting a no-op as success', async () => {
    // The trap this replaces: `git pull` updated *that* branch, whose remote had not
    // moved, reported being up to date, and the version read afterwards was still the old
    // one — a success covering a clone left a version behind.
    await git('git', ['-C', clone, 'checkout', '-q', '-b', 'work'])
    await publish(remote, '1.1.0')

    const result = await update()

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /on `work`, not `main`/)
    assert.match(result.stderr, /git checkout main/)

    // And nothing was pulled: refusing must not half-do the job either.
    const declared = JSON.parse(await readFile(join(clone, 'package.json'), 'utf8')) as {
      version: string
    }
    assert.equal(declared.version, '1.0.0')
  })

  it('treats a detached HEAD as pinned rather than behind', async () => {
    const head = (await git('git', ['-C', clone, 'rev-parse', 'HEAD'])).stdout.trim()
    await git('git', ['-C', clone, 'checkout', '-q', head])

    const result = await update()

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /detached HEAD/)
    assert.match(result.stderr, /not behind by accident/)
  })

  it('says a root is not a clone rather than leaking a filesystem error', async () => {
    // Two wrong answers were possible here: the fast-forward hint attached to any git
    // failure, and a raw `ENOENT … /package.json` from reading the version first.
    const result = await runCli(['update'], { sandbox, env: { ATL_INSTALL_ROOT: tmpdir() } })

    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /nothing to update/)
    assert.doesNotMatch(result.stderr, /stops a fast-forward/)
    assert.doesNotMatch(result.stderr, /ENOENT/)
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
