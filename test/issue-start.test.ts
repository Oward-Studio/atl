import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type StartJson = {
  ref: string
  from: string | null
  to: string
  branch: string | null
  branchUrl: string | null
}

describe('atl issue start', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const start = async (args: readonly string[]): Promise<StartJson> => {
    const result = await runCli(['issue', 'start', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as StartJson
  }

  const prop = (id: string, key: string) =>
    api.state.tickets.find((t) => t.id === id)?.properties.find((p) => p.key === key)

  it('moves the issue to In Progress', async () => {
    const result = await start(['atl-doc-deploy'])
    assert.equal(result.from, 'Todo', 'the name the fixture stores')
    assert.equal(result.to, 'In Progress', 'the name the fixture stores, not the seed name')
  })

  it('records the branch name derived from the ref, checking nothing', async () => {
    const result = await start(['atl-doc-deploy'])

    assert.equal(result.branch, 'atl-doc-deploy')
    assert.equal(prop('tk-2', 'github_branch')?.['text'], 'atl-doc-deploy')
  })

  it('writes the link built from the repo of the project', async () => {
    const result = await start(['atl-doc-deploy'])

    assert.equal(result.branchUrl, 'https://github.com/Oward-Studio/atl/tree/atl-doc-deploy')
    assert.equal(
      prop('tk-2', 'github_link')?.['url'],
      'https://github.com/Oward-Studio/atl/tree/atl-doc-deploy',
    )
  })

  it('sets the yellow marker of the In Progress state', async () => {
    await start(['atl-doc-deploy'])
    assert.deepEqual(api.state.tickets.find((t) => t.id === 'tk-2')?.icon, {
      format: 'emoji',
      emoji: '🟡',
    })
  })

  it('writes no link when the project has no repo', async () => {
    const result = await start(['atl-idea'])
    assert.equal(result.branch, 'atl-idea')
    assert.equal(result.branchUrl, null)
  })

  it('--branch replaces the derived name', async () => {
    const result = await start(['atl-doc-deploy', '--branch', 'feat/autre-nom'])

    assert.equal(result.branch, 'feat/autre-nom')
    assert.equal(
      result.branchUrl,
      'https://github.com/Oward-Studio/atl/tree/feat/autre-nom',
      'the slashes of the branch must not be encoded',
    )
  })

  it('--no-branch touches the state only', async () => {
    const result = await start(['atl-doc-deploy', '--no-branch'])

    assert.equal(result.to, 'In Progress', 'the name the fixture stores, not the seed name')
    assert.equal(result.branch, null)
    assert.equal(prop('tk-2', 'github_branch'), undefined)
    assert.equal(prop('tk-2', 'github_link'), undefined)
  })

  it('says already In Progress rather than In Progress → In Progress', async () => {
    const result = await runCli(['issue', 'start', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /already/)
    assert.doesNotMatch(result.stderr, /In Progress → In Progress/)
  })

  it('warns when the issue is still blocked', async () => {
    const result = await runCli(['issue', 'start', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.match(result.stderr, /still blocked/)
  })

  it('accepts a reference supplied by the shell', async () => {
    // The documented idiom: supplying the Git context is the caller's job.
    const result = await start(['atl-doc-deploy'])
    assert.equal(result.branch, 'atl-doc-deploy')
  })

  it('exits with 2 without a reference, showing the shell idiom', async () => {
    const result = await runCli(['issue', 'start'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /git branch --show-current/)
  })

  it('issue view displays the stored link', async () => {
    await start(['atl-doc-deploy'])

    const viewed = parseJson(
      await runCli(['issue', 'view', 'atl-doc-deploy', '--json'], { sandbox, apiUrl: api.url }),
    ) as { branchUrl: string | null }
    assert.equal(viewed.branchUrl, 'https://github.com/Oward-Studio/atl/tree/atl-doc-deploy')
  })
})
