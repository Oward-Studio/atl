import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type EditJson = {
  ref: string
  changes: { field: string; from: string; to: string }[]
  unchanged: string[]
}

describe('atl issue edit', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const edit = async (args: readonly string[]): Promise<EditJson> => {
    const result = await runCli(['issue', 'edit', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as EditJson
  }

  const prop = (id: string, key: string) =>
    api.state.tickets.find((t) => t.id === id)?.properties.find((p) => p.key === key)

  /** Name of the tag carried by a select property. */
  const selectName = (id: string, key: string): string | undefined =>
    (prop(id, key)?.['select'] as { name?: string } | undefined)?.name

  beforeEach(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  afterEach(async () => {
    await api.close()
  })

  it('edits the title', async () => {
    const result = await edit(['atl-label-sort', '--title', 'New title'])
    assert.deepEqual(result.changes, [
      { field: 'title', from: 'Fix the label sorting', to: 'New title' },
    ])
    assert.equal(api.state.tickets.find((t) => t.id === 'tk-1')?.name, 'New title')
  })

  it('edits the priority, resolved by name', async () => {
    const result = await edit(['atl-label-sort', '--priority', 'low'])
    assert.deepEqual(result.changes, [{ field: 'priority', from: 'Urgent', to: 'Low' }])
    assert.equal(selectName('tk-1', 'priority'), 'Low')
  })

  it('edits the label', async () => {
    const result = await edit(['atl-label-sort', '--label', 'feature'])
    assert.deepEqual(result.changes, [{ field: 'label', from: 'Bug', to: 'Feature' }])
    assert.equal(selectName('tk-1', 'dev_label'), 'Feature')
  })

  it('edits the project, resolved by name', async () => {
    const result = await edit(['atl-label-sort', '--project', 'other'])
    assert.deepEqual(result.changes, [
      { field: 'project', from: 'AnyTypeLinear', to: 'Other project' },
    ])
    assert.deepEqual(prop('tk-1', 'linked_projects')?.['objects'], ['proj-autre'])
  })

  it('edits several fields at once', async () => {
    const result = await edit(['atl-label-sort', '--title', 'T', '--priority', 'low', '--label', 'Refactor'])
    assert.deepEqual(
      result.changes.map((c) => c.field).sort(),
      ['label', 'priority', 'title'],
    )
  })

  it('leaves untouched the fields not passed', async () => {
    await edit(['atl-label-sort', '--priority', 'low'])
    assert.equal(selectName('tk-1', 'dev_label'), 'Bug')
    assert.equal(selectName('tk-1', 'state'), 'In Progress')
    assert.equal(api.state.tickets.find((t) => t.id === 'tk-1')?.name, 'Fix the label sorting')
  })

  it('--link pastes a PR URL', async () => {
    const url = 'https://github.com/Oward-Studio/atl/pull/18'
    const result = await edit(['atl-label-sort', '--link', url])

    assert.deepEqual(result.changes, [{ field: 'lien', from: '–', to: url }])
    assert.equal(prop('tk-1', 'github_link')?.['url'], url)
  })

  it('--link refuses anything that is not a URL', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--link', 'not-a-url'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /URL/)
  })

  it('reports a field whose value does not change, without writing', async () => {
    const result = await edit(['atl-label-sort', '--priority', 'urgent'])
    assert.deepEqual(result.changes, [])
    assert.deepEqual(result.unchanged, ['priority'])
  })

  it('edits the description while preserving the acceptance criteria', async () => {
    const result = await edit(['atl-label-sort', '--description', 'Toute nouvelle description.'])
    assert.equal(result.changes[0]?.field, 'description')

    const body = api.state.bodies['tk-1'] as string
    assert.match(body, /Toute nouvelle description\./)
    assert.match(body, /## Acceptance criteria/)
    assert.match(body, /- \[x\] reproduce the bug in a test/)
    assert.match(body, /- \[ \] fix the comparator/)
    assert.doesNotMatch(body, /Sorting by/, 'the old description must be gone')
  })

  it('the criteria stay readable by issue ac after editing the description', async () => {
    await edit(['atl-label-sort', '--description', 'Something else.'])

    const ac = parseJson(
      await runCli(['issue', 'ac', 'atl-label-sort', '--json'], { sandbox, apiUrl: api.url }),
    ) as { progress: string }
    assert.equal(ac.progress, '1/3')
  })

  it('simply creates the body when the issue has no criteria section', async () => {
    await edit(['atl-doc-deploy', '--description', 'Nouvelle description seule.'])
    assert.equal(api.state.bodies['tk-2'], 'Nouvelle description seule.')
  })

  it('refuses to rewrite a body containing a table', async () => {
    api.state.bodies['tk-1'] = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')

    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--description', 'x'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /contains a table/)
    assert.match(api.state.bodies['tk-1'] as string, /\| a \| b \|/, 'nothing must be written')
  })

  it('exits with 2 when given no field to edit', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /No change requested/)
    assert.match(result.stderr, /--title/)
  })

  it('exits with 2 without a reference', async () => {
    const result = await runCli(['issue', 'edit', '--title', 'x'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing issue reference/)
  })

  it('exits with 2 on an empty title', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--title', ''], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
  })

  it('exits with 2 on an invalid priority, before any network call', async () => {
    const fresh = await makeSandbox({ authenticated: true })
    const before = api.hits.get('/v1/spaces') ?? 0

    const result = await runCli(['issue', 'edit', 'x', '--priority', 'bogus'], {
      sandbox: fresh,
      apiUrl: api.url,
    })
    assert.equal(result.code, 2)
    assert.equal(api.hits.get('/v1/spaces') ?? 0, before)
  })

  it('exits with 3 on a nonexistent label', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--label', 'inexistant'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
  })

  it('exits with 3 on a nonexistent project', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--project', 'inexistant'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 3)
  })

  it('prints the changes as before → after', async () => {
    const result = await runCli(['issue', 'edit', 'atl-label-sort', '--priority', 'low'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /priority\s+Urgent → Low/)
  })
})
