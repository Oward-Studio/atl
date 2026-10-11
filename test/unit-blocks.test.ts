import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { blocksToMarkdown, criteriaBlocks, descriptionOf, type Block } from '../src/model/blocks.ts'

describe('blocksToMarkdown', () => {
  it('renders a table whose header row has no cells, as the real API serves an empty header', () => {
    // Shape measured on a real issue: the columns carry no `header` and the header row has
    // `is_header` but no `cells` key at all.
    const table: Block = {
      id: 't1',
      type: 'table',
      columns: [{ id: 'c1' }, { id: 'c2' }],
      rows: [
        { is_header: true },
        { cells: ['a 41 457 units', 'moves the swell'] },
        { cells: ['**0.004° is enough**', 'to redraw the sea'] },
      ],
    }

    assert.equal(
      blocksToMarkdown([table]),
      [
        '|  |  |',
        '|---|---|',
        '| a 41 457 units | moves the swell |',
        '| **0.004° is enough** | to redraw the sea |',
      ].join('\n'),
    )
  })

  it('reads a cell holding blocks as the text of those blocks', () => {
    const table: Block = {
      id: 't1',
      type: 'table',
      rows: [{ is_header: true, cells: ['h'] }, { cells: [[{ text: 'one' }, { text: 'two' }]] }],
    }
    assert.equal(blocksToMarkdown([table]), ['| h |', '|---|', '| one two |'].join('\n'))
  })

  it('renders a table with no row at all as nothing, rather than throwing', () => {
    assert.equal(blocksToMarkdown([{ id: 't1', type: 'table' }]), '')
  })

  it('keeps a table in the description and out of the criteria', () => {
    const blocks: Block[] = [
      { id: 'p', type: 'paragraph', text: 'Intro' },
      { id: 't', type: 'table', rows: [{ is_header: true }, { cells: ['x'] }] },
      { id: 'h', type: 'heading_2', text: 'Acceptance criteria' },
      { id: 'c', type: 'checkbox', text: 'done', checked: true },
    ]
    assert.match(descriptionOf(blocks), /Intro\n\n\| {2}\|\n\|---\|\n\| x \|/)
    assert.deepEqual(criteriaBlocks(blocks).map((c) => c.text), ['done'])
  })
})
