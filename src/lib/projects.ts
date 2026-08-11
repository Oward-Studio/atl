import type { Context } from './context.ts'
import { notFoundError } from './errors.ts'
import { searchObjects } from './objects.ts'
import { normalize } from './text.ts'
import { PROJECT_TYPE_KEY } from '../model/issue.ts'
import type { AnytypeObject } from '../model/object.ts'

export type Project = {
  id: string
  name: string
  object: AnytypeObject
}

export async function listProjects(context: Context): Promise<Project[]> {
  const objects = await searchObjects(context.api, context.spaceId, {
    types: [PROJECT_TYPE_KEY],
  })
  return objects.map((object) => ({ id: object.id, name: object.name, object }))
}

/** Resolves a project by name: exact first, then a unique substring. */
export function resolveProject(projects: readonly Project[], name: string): Project {
  const needle = normalize(name)

  const exact = projects.filter((p) => normalize(p.name) === needle)
  if (exact.length === 1) return exact[0] as Project

  const partial = projects.filter((p) => normalize(p.name).includes(needle))
  if (partial.length === 1) return partial[0] as Project

  if (partial.length > 1) {
    throw notFoundError(
      `"${name}" matches ${partial.length} projects.`,
      `Candidates: ${partial.map((p) => p.name).join(', ')}`,
    )
  }

  throw notFoundError(
    `No project named "${name}".`,
    `Available projects: ${projects.map((p) => p.name).join(', ')}`,
  )
}

export async function findProject(context: Context, name: string): Promise<Project> {
  return resolveProject(await listProjects(context), name)
}
