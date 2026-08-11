import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APP_KEY, SPACE_NAME } from './fake-anytype.ts'

const BIN = fileURLToPath(new URL('../../bin/atl.mjs', import.meta.url))

export type RunResult = {
  code: number
  stdout: string
  stderr: string
}

export type Sandbox = {
  configHome: string
  cacheHome: string
  configFile: string
  stateHome: string
  usageFile: string
}

/**
 * Disposable XDG directories: no test may read or write the owner's real config in
 * ~/.config/atl/, nor pollute their usage journal.
 */
export async function makeSandbox(options: { authenticated?: boolean } = {}): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), 'atl-test-'))
  const configHome = join(root, 'config')
  const cacheHome = join(root, 'cache')
  const stateHome = join(root, 'state')
  await mkdir(join(configHome, 'atl'), { recursive: true })
  await mkdir(cacheHome, { recursive: true })
  await mkdir(stateHome, { recursive: true })

  const configFile = join(configHome, 'atl', 'config.json')
  if (options.authenticated) {
    await writeFile(
      configFile,
      JSON.stringify({ apiUrl: 'http://127.0.0.1:1', appKey: APP_KEY, space: SPACE_NAME }),
      { mode: 0o600 },
    )
  }

  return {
    configHome,
    cacheHome,
    configFile,
    stateHome,
    usageFile: join(stateHome, 'atl', 'usage.jsonl'),
  }
}

/** Runs the real binary: the CLI's public contract is what gets tested. */
export function runCli(
  args: readonly string[],
  options: {
    sandbox: Sandbox
    apiUrl?: string
    env?: Record<string, string>
    /** Working directory, for commands that depend on where they run. */
    cwd?: string
  } = { sandbox: undefined as unknown as Sandbox },
): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Neutralises any real config exported in the developer's shell.
  delete env['ATL_APP_KEY']
  delete env['ATL_SPACE']
  delete env['ATL_API_URL']

  env['XDG_CONFIG_HOME'] = options.sandbox.configHome
  env['XDG_CACHE_HOME'] = options.sandbox.cacheHome
  env['XDG_STATE_HOME'] = options.sandbox.stateHome
  delete env['ATL_NO_USAGE']
  env['NO_COLOR'] = '1'
  if (options.apiUrl) env['ATL_API_URL'] = options.apiUrl
  Object.assign(env, options.env ?? {})

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        env,
        // Generous on purpose: each call boots Node and lets tsx compile, and a loaded
        // CI runner is an order of magnitude slower than a laptop. A real hang still
        // trips this; 20 s did not survive contention.
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        ...(options.cwd ? { cwd: options.cwd } : {}),
      },
      (error, stdout, stderr) => {
        // A killed process must not masquerade as an exit code: reporting a bare 1 is
        // what made a CI timeout look like a CLI bug, success message and all.
        const killed = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
        if (killed?.killed === true) {
          reject(
            new Error(
              `atl ${args.join(' ')} was killed after 60 s — a hang, or a runner too slow.\n` +
                `stderr so far:\n${stderr}`,
            ),
          )
          return
        }

        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
            ? ((error as unknown as { code: number }).code ?? 1)
            : error
              ? 1
              : 0
        resolve({ code, stdout, stderr })
      },
    )
  })
}

/** Parses the stdout of a `--json` command, failing clearly when it is not JSON. */
export function parseJson(result: RunResult): unknown {
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `stdout is not valid JSON (code ${result.code}):\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    )
  }
}
