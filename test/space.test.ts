import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { SPACE_NAME, startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl space', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const configured = async (): Promise<string | undefined> =>
    (JSON.parse(await readFile(sandbox.configFile, 'utf8')) as { space?: string }).space

  it('lists the spaces, marking the current one', async () => {
    const result = await runCli(['space'], { sandbox, apiUrl: api.url })

    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, new RegExp(`● ${SPACE_NAME}`))
    assert.match(result.stderr, /to change the default/)
  })

  it('--json renders the list and the current one', async () => {
    const data = parseJson(await runCli(['space', '--json'], { sandbox, apiUrl: api.url })) as {
      current: string
      spaces: { name: string; current: boolean }[]
    }

    assert.equal(data.current, SPACE_NAME)
    assert.equal(data.spaces.find((s) => s.name === SPACE_NAME)?.current, true)
  })

  it('rewrites nothing when the requested space is already the default', async () => {
    const before = await readFile(sandbox.configFile, 'utf8')
    const result = await runCli(['space', SPACE_NAME, '--json'], { sandbox, apiUrl: api.url })

    assert.equal((parseJson(result) as { changed: boolean }).changed, false)
    assert.equal(await readFile(sandbox.configFile, 'utf8'), before)
  })

  it('exits with 3 on an unknown space, without touching the config', async () => {
    const before = await readFile(sandbox.configFile, 'utf8')
    const result = await runCli(['space', 'nawak'], { sandbox, apiUrl: api.url })

    assert.equal(result.code, 3)
    assert.equal(await readFile(sandbox.configFile, 'utf8'), before, 'résolu avant d’écrire')
  })

  it('keeps the rest of the config when changing space', async () => {
    // The key and the folder links must not vanish along the way.
    await runCli(['project', 'link', 'AnyTypeLinear'], { sandbox, apiUrl: api.url })
    const before = JSON.parse(await readFile(sandbox.configFile, 'utf8')) as {
      appKey: string
      paths: Record<string, string>
    }

    await runCli(['space', SPACE_NAME], { sandbox, apiUrl: api.url })
    const after = JSON.parse(await readFile(sandbox.configFile, 'utf8')) as {
      appKey: string
      paths: Record<string, string>
    }

    assert.equal(after.appKey, before.appKey)
    assert.deepEqual(after.paths, before.paths)
  })

  it('requires no re-pairing: the key is left untouched', async () => {
    // This is the command's reason to exist — `atl auth --space` would ask for a
    // four-digit code again for a mere change of target.
    const result = await runCli(['space', SPACE_NAME], { sandbox, apiUrl: api.url })

    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /code|challenge|appairage/i)
    assert.equal(await configured(), SPACE_NAME)
  })
})
