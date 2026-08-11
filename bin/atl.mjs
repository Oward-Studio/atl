#!/usr/bin/env node
// The `atl` entry point. Registers the tsx loader so the TypeScript in src/ runs
// directly, with no build step (docs/ANYTYPE-LIMITS.md §2.7).
import { register } from 'tsx/esm/api'

register()

const { main } = await import('../src/cli.ts')
await main(process.argv.slice(2))
