import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type NewJson = {
  name: string
  id: string
  state: string
  repo: string | null
}

describe('atl project new', () => {
  let api: FakeServer
  let sandbox: Sandbox

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  const create = async (args: readonly string[]): Promise<NewJson> => {
    const result = await runCli(['project', 'new', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as NewJson
  }

  it('creates a project', async () => {
    const project = await create(['New project'])
    assert.equal(project.name, 'New project')
    assert.equal(project.state, 'In Progress')
  })

  it('creates from the template of the project type', async () => {
    await create(['With a template'])
    assert.equal(api.state.created.at(-1)?.template_id, 'template-t-p')
  })

  it("passes no body: the template's dynamic table must survive", async () => {
    const project = await create(['No body'])
    assert.equal(
      api.state.bodies[project.id],
      undefined,
      'a custom body would overwrite the linked-issues table block',
    )
  })

  it('accepts --repo and --state', async () => {
    const project = await create([
      'Complete project',
      '--repo',
      'https://github.com/Oward-Studio/x',
      '--state',
      'backlog',
    ])
    assert.equal(project.state, 'Backlog')
    assert.equal(project.repo, 'https://github.com/Oward-Studio/x')
  })

  it('joins the project list', async () => {
    await create(['Listed project'])
    const rows = parseJson(
      await runCli(['project', 'list', '--json'], { sandbox, apiUrl: api.url }),
    ) as { name: string }[]
    assert.ok(rows.some((r) => r.name === 'Listed project'))
  })

  it('refuses a duplicate name, which would make resolution by name ambiguous', async () => {
    const result = await runCli(['project', 'new', 'AnyTypeLinear'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /already exists/)
  })

  it('refuses a duplicate name differing only in case', async () => {
    const result = await runCli(['project', 'new', 'anytypelinear'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
  })

  it('exits with 2 without a name', async () => {
    const result = await runCli(['project', 'new'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing project name/)
  })

  it('exits with 2 on an unknown state, before any network call', async () => {
    const fresh = await makeSandbox({ authenticated: true })
    const before = api.hits.get('/v1/spaces') ?? 0

    const result = await runCli(['project', 'new', 'X', '--state', 'bogus'], {
      sandbox: fresh,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.equal(api.hits.get('/v1/spaces') ?? 0, before)
  })
})
