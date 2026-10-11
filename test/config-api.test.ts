import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { SPACE_ID, startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl config api', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const run = (args: readonly string[], env?: Record<string, string>) =>
    runCli(['config', 'api', ...args], { sandbox, apiUrl: api.url, ...(env ? { env } : {}) })

  it('defaults to v2', async () => {
    const result = parseJson(await runCli(['config', 'api', '--json'], { sandbox })) as {
      api: string
      source: string
    }
    assert.deepEqual(result, { api: 'v2', source: 'default' })
  })

  it('persists the choice in the config file, next to what was already there', async () => {
    const changed = await run(['v1'])
    assert.equal(changed.code, 0, changed.stderr)

    const stored = JSON.parse(await readFile(sandbox.configFile, 'utf8')) as Record<string, string>
    assert.equal(stored['api'], 'v1')
    assert.ok(stored['appKey'], 'the app key must survive')
    assert.ok(stored['space'], 'and so must the space')

    const shown = await run([])
    assert.match(shown.stdout, /v1 \(config file\)/)
  })

  it('is case-insensitive and idempotent', async () => {
    await run(['V1'])
    const again = await run(['v1'])
    assert.equal(again.code, 0)
    assert.match(again.stderr, /already selected/)
  })

  it('rejects an unknown version without touching the config', async () => {
    const before = await readFile(sandbox.configFile, 'utf8')
    const result = await run(['v3'])
    assert.equal(result.code, 4)
    assert.match(result.stderr, /Unknown API version "v3"/)
    assert.match(result.stderr, /v1, v2/)
    assert.equal(await readFile(sandbox.configFile, 'utf8'), before)
  })

  it('ATL_API overrides the config file for one command', async () => {
    await run(['v1'])
    const result = parseJson(
      await runCli(['config', 'api', '--json'], { sandbox, env: { ATL_API: 'v2' } }),
    ) as { api: string; source: string }
    assert.deepEqual(result, { api: 'v2', source: 'ATL_API' })
  })

  it('rejects an invalid ATL_API instead of silently falling back', async () => {
    const result = await run([], { ATL_API: 'nope' })
    assert.equal(result.code, 4)
    assert.match(result.stderr, /Unknown API version/)
  })

  describe('selects what reads issue bodies', () => {
    const bodyPaths = (hits: Map<string, number>, prefix: string) =>
      [...hits.keys()].filter((path) => path.startsWith(`${prefix}/spaces/${SPACE_ID}/objects/tk-`))

    it('v2 reads blocks and never the /v1 markdown of the object', async () => {
      await runCli(['config', 'api', 'v2'], { sandbox })
      const result = await runCli(['issue', 'ac', 'atl-label-sort'], { sandbox, apiUrl: api.url })
      assert.equal(result.code, 0, result.stderr)
      assert.ok(bodyPaths(api.hits, '/v2').length > 0)
      assert.deepEqual(bodyPaths(api.hits, '/v1'), [])
    })

    it('v1 reads the markdown and never touches /v2', async () => {
      await runCli(['config', 'api', 'v1'], { sandbox })
      const result = await runCli(['issue', 'ac', 'atl-label-sort'], { sandbox, apiUrl: api.url })
      assert.equal(result.code, 0, result.stderr)
      assert.ok(bodyPaths(api.hits, '/v1').length > 0)
      assert.deepEqual(bodyPaths(api.hits, '/v2'), [])
    })
  })
})
