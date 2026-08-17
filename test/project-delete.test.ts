import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

describe('atl project delete', () => {
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

  const projects = (): string[] => api.state.projects.map((p) => p.id)

  it('takes the issues along when asked, and the project last', async () => {
    const result = await runCli(
      ['project', 'delete', 'AnyTypeLinear', '--with-issues', '--yes', '--json'],
      { sandbox, apiUrl: api.url },
    )

    assert.equal(result.code, 0, result.stderr)
    // Order is the guarantee: a failure midway leaves a project holding fewer issues,
    // never issues holding no project.
    assert.equal(api.state.deleted.at(-1), 'proj-atl', 'the project goes last')
    assert.ok(api.state.deleted.length > 1, 'its issues went first')
    assert.ok(!projects().includes('proj-atl'))
  })

  it('leaves the issues behind when only the project is asked for', async () => {
    const result = await runCli(['project', 'delete', 'AnyTypeLinear', '--yes', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { archived: { issues: number }; orphaned: number }
    assert.equal(data.archived.issues, 0)
    assert.ok(data.orphaned > 0, 'the count of issues left without a project is reported')
    assert.deepEqual(api.state.deleted, ['proj-atl'])
  })

  it('names both commands when there is no terminal to choose in', async () => {
    // A script and an agent get this message instead of the menu, so `--yes` alone
    // would not say which of the two outcomes it picks.
    const result = await runCli(['project', 'delete', 'AnyTypeLinear'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 2)
    assert.match(result.stderr, /--with-issues --yes/)
    assert.match(result.stderr, /stay, with no project/)
    assert.deepEqual(api.state.deleted, [])
  })

  it('deletes an empty project on a plain confirmation', async () => {
    const result = await runCli(['project', 'delete', 'Other project', '--yes', '--json'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    const data = parseJson(result) as { orphaned: number }
    assert.ok(data.orphaned >= 0)
    assert.ok(!projects().includes('proj-autre'))
  })

  it('exits with 3 on a project that cannot be found, deleting nothing', async () => {
    const result = await runCli(['project', 'delete', 'nawak', '--yes'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 3)
    assert.deepEqual(api.state.deleted, [])
  })

  it('exits with 2 without a project name', async () => {
    const result = await runCli(['project', 'delete', '--yes'], { sandbox, apiUrl: api.url })

    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing project name/)
  })

  it('says where the bin is emptied, since it is not here', async () => {
    const result = await runCli(['project', 'delete', 'Other project', '--yes'], {
      sandbox,
      apiUrl: api.url,
    })

    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /moved to the bin/)
    assert.match(result.stderr, /emptying the bin is done in Anytype/)
  })
})
