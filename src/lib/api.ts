import { AtlError, ExitCode, unreachableError } from './errors.ts'
import { countApi } from './usage.ts'

/**
 * HTTP client for the local Anytype API.
 *
 * Deliberately generic: resolving ids (space, type, tag…) happens one layer up, by
 * name, never hardcoded (docs/ANYTYPE-LIMITS.md §3.1).
 */

export const DEFAULT_API_URL = 'http://127.0.0.1:31009'

/** Anytype API version targeted, sent with every request. */
export const API_VERSION = '2025-05-20'

export type ApiClientOptions = {
  baseUrl: string
  appKey: string | undefined
  timeoutMs?: number
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | undefined>
  body?: unknown
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly appKey: string | undefined
  private readonly timeoutMs: number

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.appKey = options.appKey
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Anytype-Version': API_VERSION,
    }
    if (this.appKey) headers['Authorization'] = `Bearer ${this.appKey}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)

    let response: Response
    try {
      response = await fetch(url, init)
    } catch {
      throw unreachableError(
        `API Anytype injoignable sur ${this.baseUrl}.`,
        "Is the Anytype desktop application running?",
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new AtlError(
        "App key refused by the Anytype API.",
        ExitCode.config,
        'Run `atl auth` again to store a new one.',
      )
    }

    if (!response.ok) {
      throw new AtlError(
        `${options.method ?? 'GET'} ${path} → HTTP ${response.status}${await detail(response)}`,
      )
    }

    if (response.status === 204) {
      countApi(0)
      return undefined as T
    }

    // Read the text rather than `.json()` to measure exactly what the API returned:
    // that is the volume `atl` absorbs on the context's behalf.
    const text = await response.text()
    countApi(text.length)
    return JSON.parse(text) as T
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, query === undefined ? {} : { query })
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body })
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body })
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }
}

async function detail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return ''
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string }
      const message = parsed.message ?? parsed.error
      return message ? ` — ${message}` : ` — ${text.slice(0, 200)}`
    } catch {
      return ` — ${text.slice(0, 200)}`
    }
  } catch {
    return ''
  }
}
