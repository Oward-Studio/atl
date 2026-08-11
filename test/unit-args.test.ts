import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  flagBool,
  flagList,
  flagString,
  parseArgs,
  type FlagSpec,
} from '../src/lib/args.ts'
import { AtlError } from '../src/lib/errors.ts'

const SPECS: FlagSpec[] = [
  { name: 'state', short: 's', kind: 'string', description: '', repeatable: true },
  { name: 'sort', kind: 'string', description: '' },
  { name: 'all', short: 'a', kind: 'boolean', description: '' },
]

describe('parseArgs', () => {
  it('separates positionals from options', () => {
    const args = parseArgs(['issue', '--all', 'x'], SPECS)
    assert.deepEqual(args.positionals, ['issue', 'x'])
    assert.equal(flagBool(args, 'all'), true)
  })

  it('accepts --flag value and --flag=value', () => {
    assert.equal(flagString(parseArgs(['--sort', 'priority'], SPECS), 'sort'), 'priority')
    assert.equal(flagString(parseArgs(['--sort=priority'], SPECS), 'sort'), 'priority')
  })

  it('accepts the short aliases', () => {
    const args = parseArgs(['-s', 'todo', '-a'], SPECS)
    assert.deepEqual(flagList(args, 'state'), ['todo'])
    assert.equal(flagBool(args, 'all'), true)
  })

  it('accumulates repeatable options', () => {
    const args = parseArgs(['-s', 'todo', '--state', 'started'], SPECS)
    assert.deepEqual(flagList(args, 'state'), ['todo', 'started'])
  })

  it('keeps the last value of a non-repeatable option', () => {
    assert.equal(flagString(parseArgs(['--sort', 'a', '--sort', 'b'], SPECS), 'sort'), 'b')
  })

  it('treats what follows -- as positionals', () => {
    const args = parseArgs(['x', '--', '--all', 'brut'], SPECS)
    assert.deepEqual(args.positionals, ['x', '--all', 'brut'])
    assert.equal(flagBool(args, 'all'), false)
  })

  it('rejects an unknown option', () => {
    assert.throws(() => parseArgs(['--nope'], SPECS), (e: unknown) => {
      assert.ok(e instanceof AtlError)
      assert.equal(e.exitCode, 2)
      return true
    })
  })

  it('rejects a value given to a boolean', () => {
    assert.throws(() => parseArgs(['--all=1'], SPECS), AtlError)
  })

  it('rejects a value-taking option left empty', () => {
    assert.throws(() => parseArgs(['--sort'], SPECS), AtlError)
    assert.throws(() => parseArgs(['--sort', '--all'], SPECS), AtlError)
  })

  it('treats a lone dash as a positional', () => {
    assert.deepEqual(parseArgs(['-'], SPECS).positionals, ['-'])
  })
})
