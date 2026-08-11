import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'

type ViewJson = {
  ref: string | null
  title: string
  state: string | null
  priority: string | null
  label: string | null
  projects: string[]
  branch: string | null
  branchUrl: string | null
  blockedBy: string[]
  blocking: string[]
  description: string
  acceptanceCriteria: { text: string; checked: boolean }[]
}

describe('atl issue view', () => {
  let api: FakeServer
  let sandbox: Sandbox

  const view = async (args: readonly string[]): Promise<ViewJson> => {
    const result = await runCli(['issue', 'view', ...args, '--json'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0, result.stderr)
    return parseJson(result) as ViewJson
  }

  before(async () => {
    api = await startFakeAnytype()
    sandbox = await makeSandbox({ authenticated: true })
  })

  after(async () => {
    await api.close()
  })

  it('displays every property of the issue', async () => {
    const issue = await view(['atl-label-sort'])
    assert.equal(issue.ref, 'atl-label-sort')
    assert.equal(issue.state, 'In Progress')
    assert.equal(issue.priority, 'Urgent')
    assert.equal(issue.label, 'Bug')
    assert.deepEqual(issue.projects, ['AnyTypeLinear'])
    assert.equal(issue.branch, 'atl-label-sort')
  })

  it("builds the branch link from the project's repository", async () => {
    const issue = await view(['atl-label-sort'])
    assert.equal(
      issue.branchUrl,
      'https://github.com/Oward-Studio/atl/tree/atl-label-sort',
      'the trailing .git of the repo must be stripped',
    )
  })

  it('shows the branch link under its name', async () => {
    const result = await runCli(['issue', 'view', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /Branch\s+atl-label-sort/)
    assert.match(result.stdout, /github\.com\/Oward-Studio\/atl\/tree\/atl-label-sort/)
  })

  it('renders no link when the project has no repo', async () => {
    const issue = await view(['atl-no-priority'])
    assert.equal(issue.branchUrl, null)
  })

  it('renders no link when the issue has no branch', async () => {
    const issue = await view(['atl-doc-deploy'])
    assert.equal(issue.branch, null)
    assert.equal(issue.branchUrl, null)
  })

  it('displays relations by the title of the target issue, not by its id', async () => {
    const issue = await view(['atl-label-sort'])
    assert.deepEqual(issue.blockedBy, ['Document the deployment'])
    assert.deepEqual(issue.blocking, ['Review the migration PR'])
  })

  it('separates the acceptance criteria from the description', async () => {
    const issue = await view(['atl-label-sort'])

    assert.equal(issue.acceptanceCriteria.length, 3)
    assert.deepEqual(issue.acceptanceCriteria[0], {
      text: 'reproduce the bug in a test',
      checked: true,
    })
    assert.equal(issue.acceptanceCriteria[1]?.checked, false)

    assert.doesNotMatch(issue.description, /\[x\]|\[ \]/, 'the checkboxes do not stay in the body')
    assert.doesNotMatch(issue.description, /Acceptance criteria/, 'the section heading is stripped')
  })

  it('undoes the escaping of the markdown returned by the API', async () => {
    const issue = await view(['atl-label-sort'])
    assert.match(issue.description, /dev_label/)
    assert.doesNotMatch(issue.description, /dev\\_label/)
  })

  it('does not lose the free text written in the criteria section', async () => {
    const issue = await view(['atl-label-sort'])
    assert.match(issue.description, /Free text left inside the section/)
  })

  it('returns an empty criteria list for an issue without a criteria section', async () => {
    const issue = await view(['atl-doc-deploy'])
    assert.deepEqual(issue.acceptanceCriteria, [])
  })

  it('displays no empty criteria section in table mode', async () => {
    const result = await runCli(['issue', 'view', 'atl-doc-deploy'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.stdout, /Acceptance criteria/)
  })

  it('displays the criteria counter in table mode', async () => {
    const result = await runCli(['issue', 'view', 'atl-label-sort'], { sandbox, apiUrl: api.url })
    assert.match(result.stdout, /Acceptance criteria\s+1\/3/)
  })

  it('resolves by ref prefix', async () => {
    const issue = await view(['atl-label'])
    assert.equal(issue.ref, 'atl-label-sort')
  })

  it('resolves by title substring', async () => {
    const issue = await view(['migration'])
    assert.equal(issue.ref, 'atl-review-migration')
  })

  it('resolves ignoring case', async () => {
    const issue = await view(['DEPLOYMENT'])
    assert.equal(issue.ref, 'atl-doc-deploy')
  })

  it('exits with 3 and lists the candidates on an ambiguous reference', async () => {
    const result = await runCli(['issue', 'view', 'atl-'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /matches \d+ issues/)
    assert.match(result.stderr, /atl-label-sort/)
  })

  it('exits with 3 on a reference that cannot be found', async () => {
    const result = await runCli(['issue', 'view', 'zzzz'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 3)
    assert.match(result.stderr, /No issue matches/)
  })

  it('exits with 2 when the reference is omitted', async () => {
    const result = await runCli(['issue', 'view'], { sandbox, apiUrl: api.url })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Missing issue reference/)
  })

  it('writes only JSON on stdout with --json', async () => {
    const result = await runCli(['issue', 'view', 'atl-label-sort', '--json'], {
      sandbox,
      apiUrl: api.url,
    })
    assert.doesNotThrow(() => JSON.parse(result.stdout))
  })
})
