import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl issue delete', () => {
  let api: FakeServer
  let sandbox: Sandbox

  before(async () => {
    sandbox = await makeSandbox({ authenticated: true })
  })

  beforeEach(async () => {
    api = await startFakeAnytype()
  })

  afterEach(async () => {
    await api.close()
  })

  const remaining = (): string[] => api.state.tickets.map((t) => t.id)

  it('deletes an issue and names what it removed', async () => {
    const result = await runCli(['issue', 'delete', 'atl-label-sort', '--yes', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { archived: { ref: string; title: string }[] }
    assert.deepEqual(data.archived, [{ ref: 'atl-label-sort', title: 'Fix the label sorting' }])
    assert.ok(!remaining().includes('tk-1'))
  })

  it('deletes several references in one call', async () => {
    const result = await runCli(
      ['issue', 'delete', 'atl-label-sort', 'atl-doc-deploy', '--yes', '--json'],
      { sandbox, apiUrl: api.url },
    )

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(api.state.deleted.sort(), ['tk-1', 'tk-2'])
  })

  it('deletes once when the same issue is named twice', async () => {
    const result = await runCli(
      ['issue', 'delete', 'atl-label-sort', 'atl-label-sort', '--yes', '--json'],
      { sandbox, apiUrl: api.url },
    )

    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(api.state.deleted, ['tk-1'])
  })

  it('recomputes the progress of the projects it touched', async () => {
    // Deleting the only Done issue of the project takes the numerator to zero.
    const result = await runCli(['issue', 'delete', 'atl-old-shipped', '--yes', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { progress: { project: string; to: number }[] }
    assert.deepEqual(data.progress, [{ project: 'AnyTypeLinear', from: 20, to: 0 }])
  })

  it('writes no progress when the deletion leaves the figure unchanged', async () => {
    // Removing one Todo from 1 Done out of 6 counted gives 1 out of 5 — the 20 % the
    // project already stores. A write that changes nothing is still a write.
    const result = await runCli(['issue', 'delete', 'atl-doc-deploy', '--yes', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { progress: unknown[] }
    assert.deepEqual(data.progress, [])
  })

  it('exits with 3 on an unknown reference, having deleted nothing', async () => {
    // Resolution happens before any write, so a typo in the second argument must not
    // cost the first issue.
    const result = await runCli(['issue', 'delete', 'atl-label-sort', 'nawak', '--yes'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 3)
    assert.deepEqual(api.state.deleted, [], 'nothing must have been deleted')
    assert.ok(remaining().includes('tk-1'))
  })

  it('refuses to delete without a confirmation it cannot ask for', async () => {
    const result = await runCli(['issue', 'delete', 'atl-label-sort', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 2)
    assert.match(result.stderr, /--yes/)
    assert.deepEqual(api.state.deleted, [])
  })

  it('exits with 2 without a reference', async () => {
    const result = await runCli(['issue', 'delete', '--yes'], { sandbox, apiUrl: api.url })

    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing issue reference/)
  })

  it('prints the deletion readably outside --json', async () => {
    const result = await runCli(['issue', 'delete', 'atl-label-sort', '--yes'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', 'a deletion writes nothing to stdout')
    assert.match(result.stderr, /atl-label-sort/)
    assert.match(result.stderr, /Fix the label sorting/)
    assert.match(result.stderr, /emptying the bin is done in Anytype/)
  })
})
