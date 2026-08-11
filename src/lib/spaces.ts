import type { ApiClient } from './api.ts'
import { notFoundError } from './errors.ts'
import { normalize } from './text.ts'

export type Space = {
  id: string
  name: string
}

type ListResponse<T> = { data: T[] }

export async function listSpaces(api: ApiClient): Promise<Space[]> {
  const response = await api.get<ListResponse<Space>>('/v1/spaces', { limit: 100 })
  return response.data.map((s) => ({ id: s.id, name: s.name }))
}

/**
 * Resolves a space **by name**. Exact (normalised) match first, then a unique
 * substring. Never a hardcoded id (docs/ANYTYPE-LIMITS.md §3.1).
 */
export function resolveSpace(spaces: readonly Space[], name: string): Space {
  const target = normalize(name)

  const exact = spaces.filter((s) => normalize(s.name) === target)
  if (exact.length === 1) return exact[0] as Space

  const partial = spaces.filter((s) => normalize(s.name).includes(target))
  if (partial.length === 1) return partial[0] as Space

  if (partial.length > 1) {
    throw notFoundError(
      `Several spaces match "${name}".`,
      `Candidates: ${partial.map((s) => s.name).join(', ')}`,
    )
  }

  throw notFoundError(
    `No space named "${name}".`,
    `Available spaces: ${spaces.map((s) => s.name).join(', ')}`,
  )
}
