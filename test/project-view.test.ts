import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type ViewJson = {
  name: string
  state: string | null
  progress: number | null
  computedProgress: number
  tickets: { total: number; active: number; byState: Record<string, number> }
  issues: { ref: string | null; state: string | null }[]
}

describe('atl project view', () => {
  let api: FakeServer
  let sandbox: Sandbox

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  const view = async (name: string): Promise<ViewJson> => {
    const result = await runCli(['project', 'view', name, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as ViewJson
  }

  it('displays the project and its linked issues', async () => {
    const project = await view('AnyTypeLinear')
    assert.equal(project.name, 'AnyTypeLinear')
    assert.equal(project.tickets.total, 6)
    assert.equal(project.issues.length, 6)
  })

  it('lists only the issues of the requested project', async () => {
    const project = await view('Other')
    const refs = project.issues.map((i) => i.ref)
    assert.ok(refs.includes('atl-idea'))
    assert.ok(!refs.includes('atl-label-sort'))
  })

  it('groups the issues by state', async () => {
    const project = await view('AnyTypeLinear')
    assert.equal(project.tickets.byState['done'], 1)
    assert.equal(project.tickets.byState['in_progress'], 1)
  })

  it('returns the stored progress and the computation, without writing', async () => {
    const before = api.state.projects.find((p) => p.name === 'AnyTypeLinear')
    const storedBefore = before?.properties.find((p) => p.key === 'progress')?.['number']

    const project = await view('AnyTypeLinear')

    // 6 issues, no backlog and no cancelled one on AnyTypeLinear → 1/6 = 17 %.
    assert.equal(project.progress, 20)
    assert.equal(project.computedProgress, 17)

    const storedAfter = api.state.projects
      .find((p) => p.name === 'AnyTypeLinear')
      ?.properties.find((p) => p.key === 'progress')?.['number']
    assert.equal(storedAfter, storedBefore, 'view must never write')
  })

  it('reports the gap between the stored value and the computation', async () => {
    const result = await runCli(['project', 'view', 'AnyTypeLinear'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /20 %/)
    assert.match(result.stdout, /17 % computed/)
    assert.match(result.stdout, /project stats/)
  })

  it('resolves the project by a partial name', async () => {
    const project = await view('anytype')
    assert.equal(project.name, 'AnyTypeLinear')
  })

  it('exits with 3 on a project that cannot be found', async () => {
    const result = await runCli(['project', 'view', 'inexistant'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /No project named/)
  })

  it('the linked folder supplies the project when it is not named', async () => {
    const linked = await makeSandbox({ authenticated: true })
    await runCli(['project', 'link', 'anytypelinear'], { sandbox: linked, apiUrl: api.url })

    const result = await runCli([...['project', 'view'], '--json'], { sandbox: linked, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    assert.equal((parseJson(result) as { name: string }).name, 'AnyTypeLinear')
  })

  it('exits with 2 without a project name', async () => {
    const result = await runCli(['project', 'view'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing project name/)
    assert.match(result.stderr, /project link/, 'the error must say how to link the folder')
  })
})
