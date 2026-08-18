import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Fake server for the local Anytype API.
 *
 * Command tests talk to this server, never to the real one: no suite may depend on the
 * desktop app or touch the owner's space.
 */

export const SPACE_ID = 'space-test-001'
/** Deliberately artificial name: test output must never look like one of the
 * owner's real spaces. */
export const SPACE_NAME = 'Test Space'
export const APP_KEY = 'test-app-key'

export const TAGS = {
  state: [
    { id: 'tag-backlog', key: 'backlog', name: 'Backlog', color: 'grey' },
    { id: 'tag-todo', key: 'todo', name: 'Todo', color: 'blue' },
    { id: 'tag-in-progress', key: 'in_progress', name: 'In Progress', color: 'yellow' },
    { id: 'tag-in-review', key: 'in_review', name: 'In Review', color: 'purple' },
    { id: 'tag-done', key: 'done', name: 'Done', color: 'lime' },
    { id: 'tag-canceled', key: 'canceled', name: 'Canceled', color: 'red' },
  ],
  priority: [
    { id: 'tag-urgent', key: 'urgent', name: 'Urgent', color: 'red' },
    { id: 'tag-high', key: 'high', name: 'High', color: 'orange' },
    { id: 'tag-medium', key: 'medium', name: 'Medium', color: 'yellow' },
    { id: 'tag-low', key: 'low', name: 'Low', color: 'ice' },
    { id: 'tag-none', key: 'none', name: 'No priority', color: 'grey' },
  ],
  // The space's real dev labels: `dev_label`, a select, not `tag`.
  dev_label: [
    { id: 'tag-bug', key: 'bug', name: 'Bug', color: 'red' },
    { id: 'tag-feature', key: 'feature', name: 'Feature', color: 'blue' },
    { id: 'tag-refactor', key: 'refactor', name: 'Refactor', color: 'purple' },
  ],
}

const PROPERTIES = [
  { id: 'prop-state', key: 'state', name: 'State', format: 'select' },
  { id: 'prop-priority', key: 'priority', name: 'Priority', format: 'select' },
  { id: 'prop-dev_label', key: 'dev_label', name: 'Dev label', format: 'select' },
  { id: 'prop-ref', key: 'ref', name: 'Ref', format: 'text' },
]

type Prop = Record<string, unknown> & { key: string; format: string }

const select = (key: string, tag: { id: string; key: string; name: string }): Prop => ({
  key,
  format: 'select',
  select: { object: 'tag', ...tag },
})

const text = (key: string, value: string): Prop => ({ key, format: 'text', text: value })

const multi = (key: string, tags: { id: string; key: string; name: string }[]): Prop => ({
  key,
  format: 'multi_select',
  multi_select: tags.map((t) => ({ object: 'tag', ...t })),
})

const objects = (key: string, ids: string[]): Prop => ({ key, format: 'objects', objects: ids })

const date = (key: string, value: string): Prop => ({ key, format: 'date', date: value })

const tag = (property: keyof typeof TAGS, name: string) => {
  const found = TAGS[property].find((t) => t.name === name)
  if (!found) throw new Error(`Tag de test inconnu : ${property}/${name}`)
  return found
}

const projectType = { id: 't-p', key: 'dev_project', name: 'Dev project' }

const url = (key: string, value: string): Prop => ({ key, format: 'url', url: value })

type FakeObject = {
  id: string
  name: string
  space_id: string
  archived: boolean
  type: { id: string; key: string; name: string }
  properties: Prop[]
  icon?: unknown
  template_id?: string
}

const tagById = (id: string) =>
  Object.values(TAGS)
    .flat()
    .find((t) => t.id === id)

/** Rebuilds a stored property from what the CLI sends. */
function hydrate(input: {
  key: string
  text?: string
  url?: string
  number?: number
  select?: string
  multi_select?: string[]
  objects?: string[]
}): Prop {
  if (input.text !== undefined) return text(input.key, input.text)
  if (input.url !== undefined) return url(input.key, input.url)
  if (input.number !== undefined) return { key: input.key, format: 'number', number: input.number }

  if (input.select) {
    const found = tagById(input.select)
    if (!found) throw new Error(`Unknown tag sent by the CLI: ${input.select}`)
    return select(input.key, found)
  }

  if (input.multi_select) {
    const found = input.multi_select.map((id) => {
      const t = tagById(id)
      if (!t) throw new Error(`Unknown tag sent by the CLI: ${id}`)
      return t
    })
    return multi(input.key, found)
  }

  if (input.objects) return objects(input.key, input.objects)
  return { key: input.key, format: 'text' }
}

export const PROJECTS: FakeObject[] = [
  {
    id: 'proj-atl',
    name: 'AnyTypeLinear',
    space_id: SPACE_ID,
    archived: false,
    type: projectType,
    // Repo set: the branch link must derive from it.
    properties: [
      url('repo', 'https://github.com/Oward-Studio/atl.git'),
      select('state', tag('state', 'In Progress')),
      { key: 'progress', format: 'number', number: 20 },
    ],
  },
  // Without a repo: no link, and above all no crash.
  {
    id: 'proj-autre',
    name: 'Other project',
    space_id: SPACE_ID,
    archived: false,
    type: projectType,
    properties: [],
  },
]

const ticket = (
  id: string,
  name: string,
  props: {
    ref?: string
    state?: string
    priority?: string
    label?: string
    project?: string
    branch?: string
    blockedBy?: string[]
    blocking?: string[]
    updated: string
  },
) => ({
  id,
  name,
  space_id: SPACE_ID,
  archived: false,
  type: { id: 't-t', key: 'dev_issue', name: 'Dev issue' },
  properties: [
    ...(props.ref ? [text('ref', props.ref)] : []),
    ...(props.state ? [select('state', tag('state', props.state))] : []),
    ...(props.priority ? [select('priority', tag('priority', props.priority))] : []),
    ...(props.label ? [select('dev_label', tag('dev_label', props.label))] : []),
    ...(props.project ? [objects('linked_projects', [props.project])] : []),
    ...(props.branch ? [text('github_branch', props.branch)] : []),
    ...(props.blockedBy ? [objects('blocked_by', props.blockedBy)] : []),
    ...(props.blocking ? [objects('blocking', props.blocking)] : []),
    date('last_modified_date', props.updated),
  ],
})

/**
 * Markdown body per issue, as the API returns them: trailing spaces and escaping. The
 * criteria parser has to cope with that.
 */
export const BODIES: Record<string, string> = {
  'tk-1': [
    '   ',
    'Sorting by `dev\\_label` returns the labels out of order.   ',
    '## Acceptance criteria   ',
    '- [x] reproduce the bug in a test   ',
    '- [ ] fix the comparator   ',
    '- [ ] check against the real space   ',
    'Free text left inside the section.   ',
  ].join('\n'),
  'tk-2': 'Nothing special, no criteria here.',
}

export const TICKETS = [
  ticket('tk-1', 'Fix the label sorting', {
    ref: 'atl-label-sort',
    state: 'In Progress',
    priority: 'Urgent',
    label: 'Bug',
    project: 'proj-atl',
    branch: 'atl-label-sort',
    blockedBy: ['tk-2'],
    blocking: ['tk-3'],
    updated: '2026-08-09T10:00:00Z',
  }),
  ticket('tk-2', 'Document the deployment', {
    ref: 'atl-doc-deploy',
    state: 'Todo',
    priority: 'Medium',
    project: 'proj-atl',
    updated: '2026-08-08T10:00:00Z',
  }),
  ticket('tk-3', 'Review the migration PR', {
    ref: 'atl-review-migration',
    state: 'In Review',
    priority: 'High',
    project: 'proj-atl',
    updated: '2026-08-07T10:00:00Z',
  }),
  ticket('tk-4', 'Old shipped issue', {
    ref: 'atl-old-shipped',
    state: 'Done',
    priority: 'Low',
    project: 'proj-atl',
    updated: '2026-08-06T10:00:00Z',
  }),
  ticket('tk-5', 'Idea to triage', {
    ref: 'atl-idea',
    state: 'Backlog',
    project: 'proj-autre',
    label: 'Refactor',
    updated: '2026-08-05T10:00:00Z',
  }),
  ticket('tk-6', 'Explicitly no priority', {
    ref: 'atl-no-priority',
    state: 'Todo',
    priority: 'No priority',
    project: 'proj-autre',
    updated: '2026-08-04T10:00:00Z',
  }),
  // Title corrupted by HTML entities: the CLI must report it, not hide it.
  ticket('tk-8', 'Title with HTML &lt;entities&gt;', {
    ref: 'atl-corrupt-title',
    state: 'Todo',
    project: 'proj-atl',
    updated: '2026-08-02T10:00:00Z',
  }),
  // Without a ref: the CLI must fall back on a short id.
  ticket('tk-7-abcdef', 'Issue without a ref', {
    state: 'Todo',
    project: 'proj-atl',
    updated: '2026-08-03T10:00:00Z',
  }),
]

const TYPES = [
  {
    id: 't-t',
    key: 'dev_issue',
    name: 'Dev issue',
    properties: PROPERTIES,
  },
  { id: 't-p', key: 'dev_project', name: 'Dev project', properties: PROPERTIES },
]

export type FakeServer = {
  url: string
  /** Requests received per path, to verify the cache. */
  hits: Map<string, number>
  /** This server's mutable state: created objects are added to it. */
  state: FakeState
  close: () => Promise<void>
}

/** Each server has its own data set: no leaking between suites. */
type FakeState = {
  tickets: FakeObject[]
  projects: FakeObject[]
  bodies: Record<string, string>
  created: FakeObject[]
  /** The space's schema, mutable: `atl init` adds to it. */
  properties: { id: string; key: string; name: string; format: string }[]
  types: { id: string; key: string; name: string; properties: unknown[] }[]
  /** Tags per property key, for properties created at run time. */
  createdTags: Record<string, { name: string; color: string }[]>
  /** Ids removed through DELETE, so a suite can assert what was and was not touched. */
  deleted: string[]
}

const page = <T>(data: T[]) => ({
  data,
  pagination: { total: data.length, offset: 0, limit: 100, has_more: false },
})

/**
 * `empty: true` simulates a newcomer's space: no dev type, no property, no object. It
 * is the only case where `atl init` has anything to do.
 */
export async function startFakeAnytype(
  options: { empty?: boolean } = {},
): Promise<FakeServer> {
  const hits = new Map<string, number>()
  const state: FakeState = {
    tickets: options.empty ? [] : TICKETS.map((t) => structuredClone(t)),
    projects: options.empty ? [] : PROJECTS.map((p) => structuredClone(p)),
    bodies: options.empty ? {} : { ...BODIES },
    created: [],
    properties: options.empty ? [] : PROPERTIES.map((p) => structuredClone(p)),
    types: options.empty ? [] : TYPES.map((t) => structuredClone(t)),
    createdTags: {},
    deleted: [],
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res, hits, state)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  hits: Map<string, number>,
  state: FakeState,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  hits.set(path, (hits.get(path) ?? 0) + 1)

  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  // Pairing endpoints: no app key required.
  // The releases endpoint the update notice reads, so no test reaches api.github.com.
  if (path.endsWith('/releases/latest')) {
    hits.set('/releases/latest', (hits.get('/releases/latest') ?? 0) + 1)
    if (path.includes('/nobody/nothing/')) {
      send(404, { message: 'Not Found' })
      return
    }
    send(200, { tag_name: 'v1.1.0' })
    return
  }

  if (path === '/v1/auth/challenges' && req.method === 'POST') {
    send(200, { challenge_id: 'challenge-123' })
    return
  }
  if (path === '/v1/auth/api_keys' && req.method === 'POST') {
    const body = (await readJson(req)) as { code?: string }
    if (body.code !== '1234') {
      send(400, { message: 'invalid code' })
      return
    }
    send(200, { api_key: APP_KEY })
    return
  }

  if (req.headers.authorization !== `Bearer ${APP_KEY}`) {
    send(401, { message: 'unauthorized' })
    return
  }

  if (path === '/v1/spaces') {
    send(200, page([{ id: SPACE_ID, name: SPACE_NAME }]))
    return
  }

  if (path === `/v1/spaces/${SPACE_ID}/search` && req.method === 'POST') {
    const body = (await readJson(req)) as { types?: string[] }
    const types = body.types ?? []
    const data = types.includes('dev_project')
      ? state.projects
      : types.includes('dev_issue')
        ? state.tickets
        : []
    send(200, page(data))
    return
  }

  if (path === `/v1/spaces/${SPACE_ID}/properties`) {
    if (req.method === 'POST') {
      const body = (await readJson(req)) as {
        key: string
        name: string
        format: string
        tags?: { name: string; color: string }[]
      }
      // The real API refuses `green`: the Anytype palette has none.
      const bad = (body.tags ?? []).find((t) => t.color === 'green')
      if (bad) {
        send(400, { message: `bad input: invalid color: "green"` })
        return
      }

      const property = {
        id: `prop-${body.key}`,
        key: body.key,
        name: body.name,
        format: body.format,
      }
      state.properties.push(property)
      state.createdTags[body.key] = body.tags ?? []
      send(201, { property })
      return
    }

    send(200, page(state.properties))
    return
  }

  if (path === `/v1/spaces/${SPACE_ID}/types`) {
    if (req.method === 'POST') {
      const body = (await readJson(req)) as {
        key: string
        name: string
        properties?: { key: string }[]
      }
      // Anytype attaches `tag` and `backlinks` by default: reproduce it, otherwise
      // the tests would not see the chore the command announces.
      const linked = [
        { key: 'tag' },
        { key: 'backlinks' },
        ...(body.properties ?? []).map((p) => ({ key: p.key })),
      ]
      const type = { id: `type-${body.key}`, key: body.key, name: body.name, properties: linked }
      state.types.push(type)
      send(201, { type })
      return
    }

    send(200, page(state.types))
    return
  }

  const templatesMatch = path.match(
    new RegExp(`^/v1/spaces/${SPACE_ID}/types/([\\w-]+)/templates$`),
  )
  if (templatesMatch) {
    send(200, page([{ id: `template-${templatesMatch[1]}`, name: 'Template' }]))
    return
  }

  // Creation: the object joins the server's state, so later searches see it — as the
  // real API would.
  if (path === `/v1/spaces/${SPACE_ID}/objects` && req.method === 'POST') {
    const body = (await readJson(req)) as {
      name?: string
      type_key?: string
      template_id?: string
      body?: string
      icon?: unknown
      properties?: { key: string; text?: string; select?: string; multi_select?: string[]; objects?: string[] }[]
    }

    const id = `tk-new-${state.created.length + 1}`
    const object: FakeObject = {
      id,
      name: body.name ?? '',
      space_id: SPACE_ID,
      archived: false,
      ...(body.icon ? { icon: body.icon } : {}),
      type: TYPES.find((t) => t.key === body.type_key) ?? TYPES[0]!,
      properties: [
        ...(body.properties ?? []).map((p) => hydrate(p)),
        date('last_modified_date', '2026-08-10T00:00:00Z'),
      ],
      ...(body.template_id ? { template_id: body.template_id } : {}),
    }

    if (body.type_key === 'dev_project') state.projects.push(object)
    else state.tickets.push(object)
    state.created.push(object)
    if (body.body) state.bodies[id] = body.body

    send(200, { object })
    return
  }

  const tagsMatch = path.match(new RegExp(`^/v1/spaces/${SPACE_ID}/properties/prop-(\\w+)/tags$`))
  if (tagsMatch) {
    const key = tagsMatch[1] as keyof typeof TAGS
    send(200, page(TAGS[key] ?? []))
    return
  }

  const patchMatch = path.match(new RegExp(`^/v1/spaces/${SPACE_ID}/objects/([\\w-]+)$`))
  if (patchMatch && req.method === 'DELETE') {
    const id = patchMatch[1] as string
    const before = state.tickets.length + state.projects.length
    state.tickets = state.tickets.filter((o) => o.id !== id)
    state.projects = state.projects.filter((o) => o.id !== id)
    if (state.tickets.length + state.projects.length === before) {
      send(404, { message: 'not found' })
      return
    }
    state.deleted.push(id)
    send(200, { object: { id } })
    return
  }

  if (patchMatch && req.method === 'PATCH') {
    const object = [...state.tickets, ...state.projects].find((o) => o.id === patchMatch[1])
    if (!object) {
      send(404, { message: 'not found' })
      return
    }

    const body = (await readJson(req)) as {
      name?: string
      icon?: unknown
      markdown?: string
      properties?: Parameters<typeof hydrate>[0][]
    }

    if (body.name !== undefined) object.name = body.name
    if (body.icon !== undefined) object.icon = body.icon
    if (body.markdown !== undefined) state.bodies[object.id] = body.markdown

    // Partial update: properties absent from the patch are preserved.
    for (const input of body.properties ?? []) {
      const next = hydrate(input)
      const index = object.properties.findIndex((p) => p.key === next.key)
      if (index === -1) object.properties.push(next)
      else object.properties[index] = next
    }

    send(200, { object })
    return
  }

  const objectMatch = patchMatch
  if (objectMatch) {
    const object = [...state.tickets, ...state.projects].find((o) => o.id === objectMatch[1])
    if (!object) {
      send(404, { message: 'not found' })
      return
    }
    send(200, { object: { ...object, markdown: state.bodies[object.id] ?? '' } })
    return
  }

  send(404, { message: `no fake route for ${path}` })
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}
