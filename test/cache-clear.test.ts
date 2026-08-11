import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'

describe('atl cache clear', () => {
  let sandbox: Sandbox

  before(async () => {
    sandbox = await makeSandbox()
  })

  it('deletes the cache folder and confirms it in JSON', async () => {
    const dir = join(sandbox.cacheHome, 'atl')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'resolve.json'), '{"version":1,"entries":{}}')

    const result = await runCli(['cache', 'clear', '--json'], { sandbox })
    assert.equal(result.code, 0)

    const payload = parseJson(result) as { cleared: boolean; path: string }
    assert.equal(payload.cleared, true)
    assert.equal(payload.path, dir)

    const remaining = await readdir(sandbox.cacheHome)
    assert.ok(!remaining.includes('atl'), 'the cache folder must be gone')
  })

  it('is idempotent when the cache does not exist', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['cache', 'clear'], { sandbox: fresh })
    assert.equal(result.code, 0)
    assert.match(result.stderr, /Cache cleared/)
  })
})
