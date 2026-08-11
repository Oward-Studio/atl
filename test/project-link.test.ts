import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl project link / unlink', () => {
  let api: FakeServer
  let sandbox: Sandbox
  let dir: string

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
    dir = await mkdtemp(join(tmpdir(), 'atl-scope-'))
  })

  afterEach(async () => {
    await api.close()
  })

  const stored = async (): Promise<Record<string, string>> => {
    const raw = JSON.parse(await readFile(sandbox.configFile, 'utf8')) as {
      paths?: Record<string, string>
    }
    return raw.paths ?? {}
  }

  it('links the current folder to a project', async () => {
    const result = await runCli(['project', 'link', 'anytypelinear', '--json'], {
      sandbox,
      apiUrl: api.url,
      cwd: dir,
    })
    assert.equal(result.code, 0, result.stderr)

    const payload = parseJson(result) as { path: string; project: string }
    assert.equal(payload.project, 'AnyTypeLinear', 'the canonical name must be stored')
    assert.match(payload.path, /atl-scope-/)
  })

  it('writes the link into the config, not into a file in the folder', async () => {
    await runCli(['project', 'link', 'anytypelinear'], { sandbox, apiUrl: api.url, cwd: dir })

    const paths = await stored()
    assert.equal(Object.values(paths)[0], 'AnyTypeLinear')
    assert.equal(Object.keys(paths).length, 1)
  })

  it('without an argument, lists the links', async () => {
    await runCli(['project', 'link', 'anytypelinear'], { sandbox, apiUrl: api.url, cwd: dir })

    const result = await runCli(['project', 'link', '--json'], { sandbox, apiUrl: api.url })
    const payload = parseJson(result) as { paths: Record<string, string> }
    assert.equal(Object.values(payload.paths)[0], 'AnyTypeLinear')
  })

  it('says clearly when no folder is linked', async () => {
    const result = await runCli(['project', 'link'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /No folder linked/)
  })

  it('unlink removes the link', async () => {
    await runCli(['project', 'link', 'anytypelinear'], { sandbox, apiUrl: api.url, cwd: dir })
    const result = await runCli(['project', 'unlink', '--json'], { sandbox, apiUrl: api.url, cwd: dir })

    assert.equal((parseJson(result) as { removed: boolean }).removed, true)
    assert.deepEqual(await stored(), {})
  })

  it('unlink on an unlinked folder breaks nothing', async () => {
    const result = await runCli(['project', 'unlink', '--json'], { sandbox, apiUrl: api.url, cwd: dir })
    assert.equal(result.code, 0)
    assert.equal((parseJson(result) as { removed: boolean }).removed, false)
  })

  it('refuses to link a project that does not exist', async () => {
    const result = await runCli(['project', 'link', 'inexistant'], {
      sandbox,
      apiUrl: api.url,
      cwd: dir,
    })
    assert.equal(result.code, 3)
    assert.deepEqual(await stored(), {}, 'nothing must be written')
  })

  it('atl auth --status shows the links', async () => {
    await runCli(['project', 'link', 'anytypelinear'], { sandbox, apiUrl: api.url, cwd: dir })

    const result = await runCli(['auth', '--status', '--json'], { sandbox, apiUrl: api.url })
    const payload = parseJson(result) as { paths: Record<string, string> }
    assert.equal(Object.values(payload.paths)[0], 'AnyTypeLinear')
  })
})
