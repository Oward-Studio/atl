import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { makeSandbox, parseJson, runCli, type Sandbox } from './helpers/cli.ts'
import { SPACE_NAME, startFakeAnytype, type FakeServer } from './helpers/fake-anytype.ts'
import { PRIORITY_KEYS, prioritySeed, STATE_KEYS, stateSeed } from '../src/model/enums.ts'
import { allProperties, TYPE_SEEDS } from '../src/model/schema.ts'

describe('atl init', () => {
  let sandbox: Sandbox

  beforeEach(async () => {
    sandbox = await makeSandbox({ authenticated: true })
  })

  describe('on an empty space', () => {
    let api: FakeServer

    beforeEach(async () => {
      api = await startFakeAnytype({ empty: true })
    })

    afterEach(async () => {
      await api.close()
    })

    it('creates both types and all their properties', async () => {
      const result = await runCli(['init'], { sandbox, apiUrl: api.url })
      assert.equal(result.code, 0, result.stderr)

      assert.deepEqual(
        api.state.types.map((t) => t.key).sort(),
        ['dev_issue', 'dev_project'],
      )
      assert.deepEqual(
        api.state.properties.map((p) => p.key).sort(),
        allProperties()
          .map((p) => p.key)
          .sort(),
      )
    })

    it('creates `state` only once, though both types share it', async () => {
      await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(api.state.properties.filter((p) => p.key === 'state').length, 1)
      for (const type of api.state.types) {
        assert.ok(
          (type.properties as { key: string }[]).some((p) => p.key === 'state'),
          `${type.key} must carry state`,
        )
      }
    })

    it('seeds every state and every priority, otherwise resolution by name breaks', async () => {
      await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.deepEqual(
        api.state.createdTags['state']?.map((t) => t.name),
        STATE_KEYS.map((k) => stateSeed(k).name),
      )
      assert.deepEqual(
        api.state.createdTags['priority']?.map((t) => t.name),
        PRIORITY_KEYS.map((k) => prioritySeed(k).name),
      )
      assert.ok((api.state.createdTags['dev_label'] ?? []).length > 0, 'seed labels')
    })

    it('never uses the colour green, which the API refuses', async () => {
      const result = await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      const colors = Object.values(api.state.createdTags).flatMap((tags) => tags.map((t) => t.color))
      assert.ok(colors.length > 0)
      assert.ok(!colors.includes('green'), 'the Anytype palette has no green; lime stands in')
    })

    it('announces what is left to do by hand', async () => {
      const result = await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.match(result.stderr, /template/, 'the template cannot be created through the API')
      assert.match(result.stderr, /tag/, 'the tag property must be removed by hand')
    })

    it('--dry-run writes nothing', async () => {
      const result = await runCli(['init', '--dry-run'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(api.state.types, [])
      assert.deepEqual(api.state.properties, [])
      assert.match(result.stdout, /dev_issue/, 'but announces the plan')
      assert.match(result.stderr, /nothing was written/)
    })

    it('--json describes the plan and the manual steps', async () => {
      const data = parseJson(await runCli(['init', '--json'], { sandbox, apiUrl: api.url })) as {
        alreadyReady: boolean
        types: string[]
        properties: string[]
        manualSteps: string[]
      }

      assert.equal(data.alreadyReady, false)
      assert.deepEqual(data.types.sort(), ['dev_issue', 'dev_project'])
      assert.equal(data.properties.length, allProperties().length)
      assert.equal(data.manualSteps.length, 2)
    })

    it('leaves a space the CLI can work in', async () => {
      await runCli(['init'], { sandbox, apiUrl: api.url })

      // The proof that matters: create an issue, then read it back by its ref.
      const created = await runCli(['issue', 'new', 'Premier ticket', '--all-projects'], {
        sandbox,
        apiUrl: api.url,
      })
      assert.equal(created.code, 0, created.stderr)

      const rows = parseJson(
        await runCli(['ls', '--all-projects', '--json'], { sandbox, apiUrl: api.url }),
      ) as { title: string; state: string }[]
      assert.equal(rows[0]?.title, 'Premier ticket')
      assert.equal(rows[0]?.state, 'Todo')
    })
  })

  describe('on an already bootstrapped space', () => {
    let api: FakeServer

    beforeEach(async () => {
      api = await startFakeAnytype()
    })

    afterEach(async () => {
      await api.close()
    })

    it('creates nothing and says so', async () => {
      const before = api.state.properties.length
      const result = await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stderr, /already bootstrapped/)
      assert.equal(api.state.properties.length, before, 'no write')
      assert.equal(api.state.types.length, 2)
    })

    it('is idempotent: two runs equal one', async () => {
      await runCli(['init'], { sandbox, apiUrl: api.url })
      await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(api.state.types.filter((t) => t.key === 'dev_issue').length, 1)
    })

    it('--json reports it through alreadyReady', async () => {
      const data = parseJson(await runCli(['init', '--json'], { sandbox, apiUrl: api.url })) as {
        alreadyReady: boolean
        types: string[]
      }

      assert.equal(data.alreadyReady, true)
      assert.deepEqual(data.types, [])
    })
  })

  it('the schema derives from the model: nothing copied by hand', () => {
    // The guarantee that matters: a drifting schema would create a space the CLI
    // could not read back.
    const keys = allProperties().map((p) => p.key)
    for (const expected of ['ref', 'state', 'priority', 'dev_label', 'linked_projects']) {
      assert.ok(keys.includes(expected), `${expected} manque au schéma`)
    }
    assert.deepEqual(
      TYPE_SEEDS.map((t) => t.key).sort(),
      ['dev_issue', 'dev_project'],
    )
  })

  describe('native Anytype properties', () => {
    // A fresh space already carries 34, `linked_projects` among them with format
    // `objects`. Reusing them is intended.
    let api: FakeServer

    beforeEach(async () => {
      api = await startFakeAnytype({ empty: true })
    })

    afterEach(async () => {
      await api.close()
    })

    it('reuses a same-named property at the right format without recreating it', async () => {
      api.state.properties.push({
        id: 'prop-linked_projects',
        key: 'linked_projects',
        name: 'Linked Projects',
        format: 'objects',
      })

      const result = await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.equal(
        api.state.properties.filter((p) => p.key === 'linked_projects').length,
        1,
        'no duplicate',
      )
      assert.ok(
        (api.state.types.find((t) => t.key === 'dev_issue')?.properties as { key: string }[]).some(
          (p) => p.key === 'linked_projects',
        ),
        'the type must still claim it',
      )
    })

    it('refuses to build on a same-named property of another format', async () => {
      // Building on that would give a space the CLI reads wrongly.
      api.state.properties.push({
        id: 'prop-ref',
        key: 'ref',
        name: 'Ref',
        format: 'number',
      })

      const result = await runCli(['init'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 1)
      assert.match(result.stderr, /different format/)
      assert.match(result.stderr, /found number, expected text/)
      assert.deepEqual(api.state.types, [], 'rien n’a été créé')
    })
  })

  describe('choosing the space', () => {
    let api: FakeServer

    beforeEach(async () => {
      api = await startFakeAnytype({ empty: true })
    })

    afterEach(async () => {
      await api.close()
    })

    it('--space does not rewrite the config, unlike `atl auth --space`', async () => {
      const before = await readFile(sandbox.configFile, 'utf8')
      await runCli(['init', '--dry-run', '--space', SPACE_NAME], { sandbox, apiUrl: api.url })

      assert.equal(await readFile(sandbox.configFile, 'utf8'), before, 'the config is untouched')
    })

    it('exits with 3 on an unknown space, listing the available ones', async () => {
      const result = await runCli(['init', '--space', 'nawak'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 3)
      assert.deepEqual(api.state.types, [], 'rien n’a été créé')
    })

    it('announces the targeted space before writing', async () => {
      // Bootstrapping the wrong space is repaired in the app, not by the CLI: the
      // name must be in plain sight.
      const result = await runCli(['init', '--dry-run'], { sandbox, apiUrl: api.url })

      assert.match(result.stdout, new RegExp(`space ${SPACE_NAME}`))
    })

    it('never asks: the space comes from the config or from --space', async () => {
      // No interactive picker here — `atl auth` and `atl space` handle that, and a
      // prompt would block a non-interactive call.
      const result = await runCli(['init', '--dry-run'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.doesNotMatch(result.stderr, /[Ll]equel/)
    })
  })

  describe('space never bootstrapped: fail clearly', () => {
    // Without a guard the real API answers `HTTP 500 — failed to create object` on a
    // creation, and zero results silently on a listing.
    let api: FakeServer

    beforeEach(async () => {
      api = await startFakeAnytype({ empty: true })
    })

    afterEach(async () => {
      await api.close()
    })

    it('issue new exits with 4, naming atl init', async () => {
      const result = await runCli(['issue', 'new', 'Un ticket', '--all-projects'], {
        sandbox,
        apiUrl: api.url,
      })

      assert.equal(result.code, 4)
      assert.match(result.stderr, /dev_issue/)
      assert.match(result.stderr, /atl init/)
      assert.deepEqual(api.state.created, [], 'rien n’a été créé')
    })

    it('project new exits with 4, naming atl init', async () => {
      const result = await runCli(['project', 'new', 'A project'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 4)
      assert.match(result.stderr, /dev_project/)
      assert.match(result.stderr, /atl init/)
    })

    it('ls tells a non-bootstrapped space from an empty one', async () => {
      const result = await runCli(['ls', '--all-projects'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 4)
      assert.match(result.stderr, /atl init/)
      assert.doesNotMatch(result.stderr, /No issue matches/)
    })

    it('names the targeted space, so a wrong target is visible', async () => {
      const result = await runCli(['ls', '--all-projects'], { sandbox, apiUrl: api.url })

      assert.match(result.stderr, new RegExp(SPACE_NAME))
      assert.match(result.stderr, /atl space/, 'l’autre issue : viser un autre space')
    })

    it('once bootstrapped, no warning left', async () => {
      await runCli(['init'], { sandbox, apiUrl: api.url })
      const result = await runCli(['ls', '--all-projects'], { sandbox, apiUrl: api.url })

      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stderr, /No issue matches/)
    })
  })
})
