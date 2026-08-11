import { rm } from 'node:fs/promises'

import { cacheDir } from '../lib/paths.ts'
import { json, success } from '../lib/output.ts'
import type { CommandContext } from '../router.ts'

export async function cacheClear(ctx: CommandContext): Promise<void> {
  const dir = cacheDir()
  await rm(dir, { recursive: true, force: true })

  if (ctx.json) {
    json({ cleared: true, path: dir })
    return
  }
  success(`Cache cleared: ${dir}`)
}
