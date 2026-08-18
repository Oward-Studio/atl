import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

/**
 * The notice is the one thing in `atl` that reaches a host other than Anytype, so no test
 * here is allowed to. `ATL_UPDATE_ORIGIN` points the check at the fake server instead,
 * and the cases that must not call at all assert on the hit count.
 */
async function installation(version: string, origin?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atl-notice-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'atl', version }))
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(
    join(root, '.git', 'config'),
    `[remote "origin"]\n\turl = ${origin ?? 'https://github.com/Oward-Studio/atl.git'}\n`,
  )
  return root
}

describe('the update notice', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const run = async (root: string, extra: Record<string, string> = {}) =>
    runCli(['ls', '--json'], {
      sandbox,
      apiUrl: api.url,
      env: { ATL_INSTALL_ROOT: root, ATL_UPDATE_ORIGIN: api.url, ...extra },
    })

  it('stays silent off a terminal, and makes no call at all', async () => {
    // The suite never runs against a terminal, which is the point: a pipeline, a CI job
    // and an agent all get no notice and cost no request.
    const root = await installation('1.0.0')
    const before = api.hits.get('/releases/latest') ?? 0
    const result = await run(root)

    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /is available/)
    assert.equal(api.hits.get('/releases/latest') ?? 0, before, 'no request was made')
  })

  it('stays silent when switched off, even on a terminal', async () => {
    const root = await installation('1.0.0')
    const result = await run(root, { ATL_NO_UPDATE_CHECK: '1', ATL_UPDATE_CHECK: '1' })

    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /is available/)
    assert.equal(api.hits.get('/releases/latest') ?? 0, 0)
  })

  it('names the newer version, on stderr, leaving stdout parseable', async () => {
    const root = await installation('1.0.0')
    const result = await run(root, { ATL_UPDATE_CHECK: '1' })

    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /1\.1\.0 is available/)
    assert.match(result.stderr, /atl update/)
    assert.doesNotThrow(() => JSON.parse(result.stdout), 'stdout stays JSON')
  })

  it('says nothing when the installation is current or ahead', async () => {
    for (const version of ['1.1.0', '2.0.0']) {
      const root = await installation(version)
      const result = await run(root, { ATL_UPDATE_CHECK: '1' })
      assert.doesNotMatch(result.stderr, /is available/, version)
    }
  })

  it('compares numerically, so 1.10.0 is not behind 1.1.0', async () => {
    // A string comparison would read "1.1.0" as greater and invite a downgrade.
    const root = await installation('1.10.0')
    const result = await run(root, { ATL_UPDATE_CHECK: '1' })

    assert.doesNotMatch(result.stderr, /is available/)
  })

  it('calls once a day, and repeats the notice from the cache', async () => {
    const root = await installation('1.0.0')
    const first = await run(root, { ATL_UPDATE_CHECK: '1' })
    const calls = api.hits.get('/releases/latest') ?? 0
    const second = await run(root, { ATL_UPDATE_CHECK: '1' })

    assert.match(first.stderr, /is available/)
    assert.match(second.stderr, /is available/, 'the notice repeats')
    assert.equal(api.hits.get('/releases/latest') ?? 0, calls, 'the second run did not call')
  })

  it('says nothing, and fails nothing, when the call goes wrong', async () => {
    const root = await installation('1.0.0', 'https://github.com/nobody/nothing.git')
    const result = await run(root, { ATL_UPDATE_CHECK: '1', ATL_UPDATE_ORIGIN: 'http://127.0.0.1:1' })

    assert.equal(result.code, 0, 'a courtesy must not fail a command that worked')
    assert.doesNotMatch(result.stderr, /is available/)
  })

  it('says nothing when the install carries no Git config to read a remote from', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atl-notice-bare-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'atl', version: '1.0.0' }))
    const result = await run(root, { ATL_UPDATE_CHECK: '1' })

    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /is available/)
  })
})
