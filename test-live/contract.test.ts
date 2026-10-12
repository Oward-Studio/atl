import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import {
  getObject,
  listProperties,
  listTags,
  listTypes,
  searchObjects,
  updateObject,
} from '../src/lib/objects.ts'
import { createV2BodyStore } from '../src/lib/body-store-v2.ts'
import { issueFilters, type IssueCriteria } from '../src/lib/search-filters.ts'
import { resolvePropertyId, resolveTagId, resolveTagIds, resolveTagKey } from '../src/lib/resolve.ts'
import { parseBody } from '../src/model/acceptance.ts'
import {
  PROJECT_PROP,
  PROJECT_TYPE_KEY,
  PROP,
  TICKET_TYPE_KEY,
  toIssue,
} from '../src/model/issue.ts'
import { STATE_KEYS, PRIORITY_KEYS, SETTLED_STATES, isSettled } from '../src/model/enums.ts'
import { TAGS as FAKE_TAGS } from '../test/helpers/fake-anytype.ts'
import { liveContext, LOREM_PROJECT, REF_PREFIX } from './helpers/live.ts'

/**
 * Contract tests: they verify that the fake server in `test/` still matches the real
 * API. Skipped cleanly when Anytype is unreachable.
 */
const live = await liveContext()

describe(
  'real API contract',
  { skip: live.available ? false : `skipped: ${live.reason}` },
  () => {
    if (!live.available) return
    const { api, spaceId, projectId, createTicket, createProperty, createType, cleanup } =
      live.context

    after(async () => {
      await cleanup()
    })

    it('targets the LOREM project and nothing else', async () => {
      const object = await getObject(api, spaceId, projectId)
      assert.equal(object.name, LOREM_PROJECT)
    })

    it('search returns the shape the model expects', async () => {
      const tickets = await searchObjects(api, spaceId, { types: [TICKET_TYPE_KEY] })
      assert.ok(tickets.length > 0, 'the space holds issues')

      const object = tickets[0]!
      assert.equal(typeof object.id, 'string')
      assert.equal(typeof object.name, 'string')
      assert.ok(Array.isArray(object.properties))
      assert.equal(object.type?.key, TICKET_TYPE_KEY)
    })

    it('server-side filters return what filtering the whole result would', async () => {
      const all = await searchObjects(api, spaceId, { types: [TICKET_TYPE_KEY] })
      const issues = all.map(toIssue)
      const bug = await resolveTagKey(api, spaceId, PROP.label, 'Bug')
      assert.ok(bug, 'the space has a Bug label')

      const cases: [string, IssueCriteria, (i: ReturnType<typeof toIssue>) => boolean][] = [
        ['one state', { state: 'in_progress' }, (i) => i.state === 'in_progress'],
        ['unsettled', { notStates: SETTLED_STATES }, (i) => !isSettled(i.state)],
        ['one priority', { priority: 'high' }, (i) => i.priority === 'high'],
        ['one label', { labels: [bug] }, (i) => i.label === 'Bug'],
        ['one project', { projectIds: [projectId] }, (i) => i.projectIds.includes(projectId)],
        [
          'combined',
          { notStates: SETTLED_STATES, priority: 'high', projectIds: [projectId] },
          (i) => !isSettled(i.state) && i.priority === 'high' && i.projectIds.includes(projectId),
        ],
      ]

      for (const [label, criteria, keep] of cases) {
        const filters = issueFilters(criteria)
        assert.ok(filters, label)

        const served = await searchObjects(api, spaceId, { types: [TICKET_TYPE_KEY], filters })
        const expected = issues.filter(keep).map((i) => i.id).sort()
        assert.deepEqual(served.map((o) => o.id).sort(), expected, `filters differ for: ${label}`)
      }
    })

    it('every property of the issue type resolves by its key', async () => {
      for (const key of Object.values(PROP)) {
        const id = await resolvePropertyId(api, spaceId, key)
        assert.match(id, /^bafy/, `property "${key}" did not resolve`)
      }
    })

    it('the types do declare the properties the model reads', async () => {
      const types = await listTypes(api, spaceId)

      const declaredBy = (key: string): Set<string> =>
        new Set((types.find((t) => t.key === key)?.properties ?? []).map((p) => p.key))

      const ticket = declaredBy(TICKET_TYPE_KEY)
      for (const key of Object.values(PROP)) {
        assert.ok(ticket.has(key), `type ${TICKET_TYPE_KEY} no longer declares "${key}"`)
      }

      const project = declaredBy(PROJECT_TYPE_KEY)
      for (const key of Object.values(PROJECT_PROP)) {
        assert.ok(project.has(key), `type ${PROJECT_TYPE_KEY} no longer declares "${key}"`)
      }
    })

    it('every state the CLI knows resolves in the space', async () => {
      // By key, which is the contract: the display names are the owner's business and
      // may have been renamed since.
      for (const state of STATE_KEYS) {
        const id = await resolveTagId(api, spaceId, PROP.state, state)
        assert.match(id, /^bafy/, `state "${state}" does not resolve`)
      }
    })

    it('every priority the CLI knows resolves in the space', async () => {
      for (const priority of PRIORITY_KEYS) {
        const id = await resolveTagId(api, spaceId, PROP.priority, priority)
        assert.match(id, /^bafy/, `priority "${priority}" does not resolve`)
      }
    })

    it('the fake server declares the same tag keys as the real API', async () => {
      // Keys, not names: a renamed tag keeps its key, so this is what the fake has to
      // agree with. Comparing names would break the day the owner renames one.
      for (const [property, fakeTags] of Object.entries(FAKE_TAGS)) {
        const propertyId = await resolvePropertyId(api, spaceId, property)
        const real = new Set((await listTags(api, spaceId, propertyId)).map((t) => t.key))
        for (const fake of fakeTags) {
          assert.ok(
            real.has(fake.key),
            `the fake server declares key "${fake.key}" on ${property}, absent from the real API`,
          )
        }
      }
    })

    it('resolves a label by its name, ignoring case and accents', async () => {
      // Labels stay resolved by name: they are free vocabulary, not a closed set the
      // CLI decides on.
      const id = await resolveTagId(api, spaceId, PROP.label, 'bug')
      const propertyId = await resolvePropertyId(api, spaceId, PROP.label)
      const tags = await listTags(api, spaceId, propertyId)

      assert.equal(tags.find((t) => t.id === id)?.key, 'bug')
    })

    it('creates an issue from the template and finds it back by its ref', async () => {
      const created = await createTicket('creation')
      assert.ok(created.id)

      const found = await getObject(api, spaceId, created.id)
      const issue = toIssue(found)

      assert.equal(issue.ref, `${REF_PREFIX}creation`)
      assert.deepEqual(issue.projectIds, [projectId])
    })

    it('writes then reads back an acceptance-criteria section', async () => {
      const created = await createTicket('acceptance')

      const body = [
        'Description of the test issue.',
        '',
        '## Acceptance criteria',
        '',
        '- [x] first criterion',
        '- [ ] second criterion',
      ].join('\n')

      await updateObject(api, spaceId, created.id, { markdown: body })

      const reread = await getObject(api, spaceId, created.id)
      const parsed = parseBody(reread.markdown)

      assert.equal(parsed.criteria.length, 2, `criteria not read back from: ${reread.markdown}`)
      assert.deepEqual(parsed.criteria[0], { text: 'first criterion', checked: true })
      assert.deepEqual(parsed.criteria[1], { text: 'second criterion', checked: false })
      assert.match(parsed.description, /Description of the test issue/)
    })

    it('the /v2 body store edits criteria and description on the real API', async () => {
      // The `/v2` shapes `createV2BodyStore` relies on (docs/ANYTYPE-LIMITS.md §1.2). It is a
      // pre-release: if a block type or an op moves, this is the test that says so.
      const store = createV2BodyStore(api, spaceId)
      const created = await createTicket('bodystore')
      await updateObject(api, spaceId, created.id, {
        markdown: [
          'Old description.',
          '',
          '| a | b |',
          '|---|---|',
          '| 1 | 2 |',
          '',
          '## Acceptance criteria',
          '- [ ] first',
          '- [ ] second',
        ].join('\n'),
      })

      const read = await store.read(created.id)
      assert.deepEqual(read.criteria.map((c) => c.text), ['first', 'second'])
      assert.match(read.description, /Old description\./)
      assert.match(read.description, /\| 1 \| 2 \|/, 'the table is part of what the description shows')

      const ticked = await store.setChecked(read, [2], true)
      assert.deepEqual(ticked.criteria.map((c) => c.checked), [false, true])
      assert.match(ticked.description, /\| 1 \| 2 \|/, 'ticking leaves the table alone')

      const added = await store.addCriterion(await store.read(created.id), 'third')
      assert.deepEqual(added.criteria.map((c) => c.text), ['first', 'second', 'third'])

      await store.setDescription(await store.read(created.id), 'New description.')
      const after = await store.read(created.id)
      assert.equal(after.description, 'New description.')
      assert.deepEqual(after.criteria.map((c) => c.text), ['first', 'second', 'third'])
      assert.deepEqual(after.criteria.map((c) => c.checked), [false, true, false])

      // A stale snapshot must be refused, not written over the newer body.
      const stale = await store.read(created.id)
      await store.addCriterion(await store.read(created.id), 'fourth')
      await assert.rejects(store.setChecked(stale, [1], true), /changed since it was read/)
    })

    it('does not maintain the inverse relation, hence the double write', async () => {
      // The whole design of `atl issue block` rests on this
      // (docs/ANYTYPE-LIMITS.md §1.11). If Anytype starts maintaining the reciprocal,
      // this test will say so and the double write can go.
      const a = await createTicket('bloque')
      const b = await createTicket('bloquant')

      await updateObject(api, spaceId, a.id, {
        properties: [{ key: PROP.blockedBy, objects: [b.id] }],
      })

      const rereadA = await getObject(api, spaceId, a.id)
      const rereadB = await getObject(api, spaceId, b.id)

      assert.deepEqual(toIssue(rereadA).blockedBy, [b.id], 'the written side must read back')
      assert.deepEqual(
        toIssue(rereadB).blocking,
        [],
        'Anytype now maintains the reciprocal: simplify `issue block` and the docs',
      )
    })

    it('writes a state by its key and reads the same key back', async () => {
      const created = await createTicket('state')
      const tagId = await resolveTagId(api, spaceId, PROP.state, 'in_review')

      await updateObject(api, spaceId, created.id, {
        properties: [{ key: PROP.state, select: tagId }],
      })

      const reread = await getObject(api, spaceId, created.id)
      const issue = toIssue(reread)
      assert.equal(issue.state, 'in_review', 'canonical key, whatever the space displays')
      assert.ok(issue.stateName, 'and the stored name comes along for display')
    })

    describe('what `atl init` relies on', () => {
      // The fake server asserts these three behaviours so `atl init` can be tested
      // hermetically. Nothing else re-checks them: if Anytype changes one, the CLI
      // breaks on a fresh space while CI stays green.

      it('creates a select property with its tags in one call', async () => {
        // Bootstrapping depends on this: tags added afterwards would leave the
        // select empty in between, and the CLI resolves states by name.
        const property = await createProperty('state', {
          name: 'ZZ Live State',
          format: 'select',
          tags: [
            { name: 'ZZ Backlog', color: 'grey' },
            { name: 'ZZ Done', color: 'lime' },
          ],
        })

        const tags = await listTags(api, spaceId, property.id)
        assert.deepEqual(
          tags.map((t) => t.name).sort(),
          ['ZZ Backlog', 'ZZ Done'],
        )
      })

      it('refuses the colour green, which the palette does not have', async () => {
        // `lime` stands in for Done because of this; a schema seeded with green
        // would fail halfway through.
        await assert.rejects(
          () =>
            createProperty('green', {
              name: 'ZZ Live Green',
              format: 'select',
              tags: [{ name: 'ZZ Green', color: 'green' }],
            }),
          /invalid color/,
        )
      })

      it('links an existing property to a new type without duplicating it', async () => {
        // The order `atl init` uses depends on this: properties first, then the type
        // that claims them by key.
        const property = await createProperty('link', { name: 'ZZ Live Link', format: 'text' })
        const type = await createType('type', {
          name: 'ZZ Live Type',
          plural_name: 'ZZ Live Types',
          properties: [{ key: property.key, name: 'ZZ Live Link', format: 'text' }],
        })

        const keys = (type.properties ?? []).map((p) => p.key)
        assert.ok(keys.includes(property.key), `the type must claim ${property.key}: ${keys}`)

        const all = await listProperties(api, spaceId)
        assert.equal(
          all.filter((p) => p.key === property.key).length,
          1,
          'no duplicate property created',
        )
      })

      it('attaches `tag` and `backlinks` to a new type by itself', async () => {
        // This is the manual chore `atl init` announces, since `update-type` cannot
        // remove a property.
        const type = await createType('auto', {
          name: 'ZZ Live Auto',
          plural_name: 'ZZ Live Autos',
          properties: [],
        })

        const keys = (type.properties ?? []).map((p) => p.key)
        assert.ok(keys.includes('tag'), `expected \`tag\` attached by default: ${keys}`)
        assert.ok(keys.includes('backlinks'), `expected \`backlinks\` attached by default: ${keys}`)
      })
    })
  },
)
