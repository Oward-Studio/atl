import { rm } from 'node:fs/promises'

import { flagBool, flagString } from '../lib/args.ts'
import { color } from '../lib/color.ts'
import { type Context, withContext } from '../lib/context.ts'
import { AtlError, ExitCode } from '../lib/errors.ts'
import { listProperties, listTypes } from '../lib/objects.ts'
import { cacheDir } from '../lib/paths.ts'
import { info, json, out, success, warn } from '../lib/output.ts'
import {
  TYPE_SEEDS,
  type PropertySeed,
  type TypeSeed,
} from '../model/schema.ts'
import type { CommandContext } from '../router.ts'

/**
 * `atl init` — bootstrap an empty space.
 *
 * Properties first, with their tags, then the types that claim them by key:
 * properties created inline by `create-type` would be born without tags, and an empty
 * select would break resolution by name.
 *
 * Idempotent, and not a migration: an existing type is left untouched
 * (docs/ANYTYPE-LIMITS.md §2.6).
 */
export async function init(ctx: CommandContext): Promise<void> {
  const dryRun = flagBool(ctx.args, 'dry-run')
  const space = flagString(ctx.args, 'space')

  await withContext(ctx.json, async (context) => {
    await run(context, dryRun)
  }, space)
}

type Plan = {
  properties: PropertySeed[]
  types: TypeSeed[]
  /** Same-named property already present, but with a different format. */
  conflicts: { key: string; expected: string; found: string }[]
}

async function run(context: Context, dryRun: boolean): Promise<void> {
  const plan = await inspect(context)
  const nothingToDo = plan.properties.length === 0 && plan.types.length === 0

  // A fresh space already carries native properties, `linked_projects` among them
  // (docs/ANYTYPE-LIMITS.md §1.7). Reusing a same-named one is intended, but only at
  // the right format: otherwise the CLI would read the space wrongly.
  if (plan.conflicts.length > 0) {
    if (context.json) {
      json({ space: context.spaceName, conflicts: plan.conflicts })
    }
    throw new AtlError(
      `${plan.conflicts.length} property(ies) already exist with a different format.`,
      ExitCode.error,
      plan.conflicts
        .map((c) => `${c.key}: found ${c.found}, expected ${c.expected}`)
        .join(' · '),
    )
  }

  if (context.json) {
    json({
      space: context.spaceName,
      dryRun,
      alreadyReady: nothingToDo,
      properties: plan.properties.map((p) => p.key),
      types: plan.types.map((t) => t.key),
      manualSteps: MANUAL_STEPS,
    })
    if (!dryRun && !nothingToDo) await apply(context, plan)
    return
  }

  if (nothingToDo) {
    success(`"${context.spaceName}" is already bootstrapped: both dev types exist.`)
    info(color.dim('Nothing to create. `atl init` never modifies what is already there.'))
    return
  }

  out('')
  out(`${color.bold(dryRun ? 'To create' : 'Creating')}  ${color.dim(`space ${context.spaceName}`)}`)
  out('')
  for (const property of plan.properties) {
    const tags = property.tags ? ` ${color.dim(`(${property.tags.length} tags)`)}` : ''
    out(`  property  ${property.key.padEnd(18)} ${color.dim(property.format)}${tags}`)
  }
  for (const type of plan.types) {
    out(`  type      ${type.key.padEnd(18)} ${color.dim(`${type.properties.length} properties`)}`)
  }
  out('')

  if (dryRun) {
    info(color.dim('`--dry-run`: nothing was written.'))
    return
  }

  await apply(context, plan)
  success('Space bootstrapped.')
  warn('Two things remain to be done by hand, in the application:')
  for (const step of MANUAL_STEPS) info(color.dim(`    ${step}`))
}

/**
 * What the API cannot do, and what it would be dishonest to leave unsaid: the command
 * announces the work it leaves behind.
 */
const MANUAL_STEPS = [
  'create the default template of each type — the API can neither read nor write a block (docs/ANYTYPE-LIMITS.md §1.4)',
  'remove the `tag` property from both types — Anytype attaches it by default, and update-type cannot remove it',
]

/**
 * What is missing, in one read pass.
 *
 * The plan starts from the **missing types** and adds only the properties they need.
 * An existing type is left intact: creating a property without attaching it — `apply`
 * never amends an existing type — would leave an orphan. Bootstrapping an empty space
 * and migrating a populated one are two different jobs, and this is only the first.
 */
async function inspect(context: Context): Promise<Plan> {
  const [existingProperties, existingTypes] = await Promise.all([
    listProperties(context.api, context.spaceId),
    listTypes(context.api, context.spaceId),
  ])

  const typeKeys = new Set(existingTypes.map((t) => t.key))

  const byKey = new Map(existingProperties.map((p) => [p.key, p]))
  const missingTypes = TYPE_SEEDS.filter((t) => !typeKeys.has(t.key))

  const needed = new Map<string, PropertySeed>()
  const conflicts: Plan['conflicts'] = []

  for (const type of missingTypes) {
    for (const property of type.properties) {
      const existing = byKey.get(property.key)
      if (!existing) {
        needed.set(property.key, property)
        continue
      }
      if (existing.format !== property.format) {
        conflicts.push({ key: property.key, expected: property.format, found: existing.format })
      }
    }
  }

  return { properties: [...needed.values()], types: missingTypes, conflicts }
}

async function apply(context: Context, plan: Plan): Promise<void> {
  for (const property of plan.properties) {
    await context.api.post(`/v1/spaces/${context.spaceId}/properties`, {
      key: property.key,
      name: property.name,
      format: property.format,
      ...(property.tags ? { tags: property.tags } : {}),
    })
  }

  for (const type of plan.types) {
    await context.api.post(`/v1/spaces/${context.spaceId}/types`, {
      key: type.key,
      name: type.name,
      plural_name: type.pluralName,
      layout: 'basic',
      properties: type.properties.map((p) => ({ key: p.key, name: p.name, format: p.format })),
    })
  }

  // Without this the CLI would not see what it just created: name resolution is
  // cached for 24 h, and the read above has just populated it.
  await rm(cacheDir(), { recursive: true, force: true })
}
