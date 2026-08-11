import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type Row = {
  name: string
  state: string | null
  progress: number | null
  repo: string | null
  tickets: { total: number; active: number; done: number }
}

describe('atl project list', () => {
  let api: FakeServer
  let sandbox: Sandbox

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  const list = async (): Promise<Row[]> => {
    const result = await runCli(['project', 'list', '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as Row[]
  }

  it('lists the projects of the space', async () => {
    const rows = await list()
    assert.deepEqual(
      rows.map((r) => r.name).sort(),
      ['AnyTypeLinear', 'Other project'],
    )
  })

  it('counts the issues of each project', async () => {
    const rows = await list()
    const atl = rows.find((r) => r.name === 'AnyTypeLinear')

    // tk-1 through tk-4, tk-7 and tk-8 belong to AnyTypeLinear.
    assert.equal(atl?.tickets.total, 6)
    assert.equal(atl?.tickets.done, 1)
    assert.equal(atl?.tickets.active, 5)
  })

  it('returns the stored progress and the repo', async () => {
    const rows = await list()
    const atl = rows.find((r) => r.name === 'AnyTypeLinear')

    assert.equal(atl?.progress, 20)
    assert.equal(atl?.state, 'In Progress')
    assert.match(atl?.repo ?? '', /github\.com/)
  })

  it('returns null rather than an invented value when progress is missing', async () => {
    const rows = await list()
    assert.equal(rows.find((r) => r.name === 'Other project')?.progress, null)
  })

  it('ranks the projects from the fullest to the emptiest', async () => {
    const rows = await list()
    assert.equal(rows[0]?.name, 'AnyTypeLinear')
  })

  it('prints a readable table without --json', async () => {
    const result = await runCli(['project', 'list'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /PROJECT\s+STATE\s+PROGRESS/)
    assert.match(result.stdout, /AnyTypeLinear/)
  })

  it('exits with 4 without an app key', async () => {
    const fresh = await makeSandbox()
    const result = await runCli(['project', 'list'], { sandbox: fresh, apiUrl: api.url })
    assert.equal(result.code, 4)
  })
})
