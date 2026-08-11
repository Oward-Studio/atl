import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { APP_KEY, SPACE_NAME, startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl auth', () => {
  let api: FakeServer
  let sandbox: Sandbox

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox()
  })

  after(async () => {
    await api.close()
  })

  it('reports a missing app key without writing anything', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['auth', '--status', '--json'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(result.code, 0)

    const payload = parseJson(result) as { appKey: string | null; authenticated: boolean }
    assert.equal(payload.appKey, null)
    assert.equal(payload.authenticated, false)
  })

  it('creates a challenge and returns its id', async () => {
    const result = await runCli(['auth', '--request', '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.deepEqual(parseJson(result), { challengeId: 'challenge-123' })
  })

  it('exchanges challenge + code for an app key and saves the config', async () => {
    const result = await runCli(
      ['auth', '--challenge', 'challenge-123', '--code', '1234', '--json'],
      { sandbox, apiUrl: api.url },
    )
    assert.equal(result.code, 0)

    const payload = parseJson(result) as { space: string; appKey: string }
    assert.equal(payload.space, SPACE_NAME)
    // The key is never returned in clear text.
    assert.doesNotMatch(result.stdout, new RegExp(APP_KEY))
    assert.match(payload.appKey, /…/)

    const stored = JSON.parse(await readFile(sandbox.configFile, 'utf8')) as {
      appKey: string
      space: string
    }
    assert.equal(stored.appKey, APP_KEY)
    assert.equal(stored.space, SPACE_NAME, 'the space is stored by its name, not by its id')
  })

  it('writes the config with mode 0600', async () => {
    const info = await stat(sandbox.configFile)
    assert.equal(info.mode & 0o777, 0o600)
  })

  it('reports the authenticated state once the key is saved', async () => {
    const result = await runCli(['auth', '--status', '--json'], { sandbox, apiUrl: api.url })
    const payload = parseJson(result) as { authenticated: boolean; spaces: number }
    assert.equal(payload.authenticated, true)
    assert.equal(payload.spaces, 1)
  })

  it('rejects an invalid code', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['auth', '--challenge', 'challenge-123', '--code', '0000'], {
      sandbox: fresh,
      apiUrl: api.url,
    })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /invalid code|HTTP 400/)
  })

  it('exits with 2 when --code is passed without --challenge', async () => {
    const result = await runCli(['auth', '--code', '1234'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /go together/)
  })

  it('exits with 2 on an empty --key', async () => {
    const result = await runCli(['auth', '--key', ''], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
  })

  it('exits with 4 when the key is refused', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['auth', '--key', 'mauvaise-cle'], {
      sandbox: fresh,
      apiUrl: api.url,
    })
    assert.equal(result.code, 4)
    assert.match(result.stderr, /App key refused/)
  })

  it('refuses the interactive flow outside a TTY rather than blocking', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['auth'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Input required/)
  })
})
