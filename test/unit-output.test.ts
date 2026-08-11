import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { setColorEnabled, stripAnsi, visibleLength } from '../src/lib/color.ts'
import { table, type Column } from '../src/lib/output.ts'
import { hasHtmlEntities } from '../src/model/object.ts'
import { maskSecret, normalize, slugify } from '../src/lib/text.ts'

type Row = { ref: string; title: string }

const COLUMNS: readonly Column<Row>[] = [
  { header: 'REF', value: (r) => r.ref },
  { header: 'TITLE', value: (r) => r.title, flex: 1 },
]

describe('table', () => {
  it('renders empty for zero rows', () => {
    assert.equal(table([], COLUMNS), '')
  })

  it('aligns the second column at the same place on every row', () => {
    const [header, first, second] = table(
      [
        { ref: 'a', title: 'court' },
        { ref: 'a-much-longer-ref', title: 'autre' },
      ],
      COLUMNS,
    ).split('\n')

    const column = header?.indexOf('TITLE')
    assert.ok(column !== undefined && column > 0)
    assert.equal(first?.indexOf('court'), column)
    assert.equal(second?.indexOf('autre'), column)
  })

  it('leaves no trailing spaces', () => {
    for (const line of table([{ ref: 'a', title: 'b' }], COLUMNS).split('\n')) {
      assert.equal(line, line.trimEnd())
    }
  })

  it('truncates with an ellipsis rather than overflowing', () => {
    const rendered = table([{ ref: 'a', title: 'x'.repeat(500) }], COLUMNS)
    for (const line of rendered.split('\n')) {
      assert.ok(visibleLength(line) <= (process.stdout.columns || 100))
    }
    assert.match(rendered, /…/)
  })
})

describe('couleur', () => {
  it('measures the visible length ignoring ANSI sequences', () => {
    const esc = String.fromCharCode(27)
    const painted = `${esc}[31mrouge${esc}[39m`

    assert.equal(visibleLength(painted), 5)
    assert.equal(stripAnsi(painted), 'rouge')
  })

  it('emits no sequence when colour is disabled', async () => {
    const { color } = await import('../src/lib/color.ts')
    setColorEnabled(false)
    assert.equal(color.red('rouge'), 'rouge')
  })
})

describe('texte', () => {
  it('normalises case, diacritics and spaces', () => {
    assert.equal(normalize('  À   Faire '), 'a faire')
  })

  it('slugifies a title into a branch name, phase prefix removed', () => {
    assert.equal(slugify('[1] atl issue list / ls (filtres)'), 'atl-issue-list-ls-filtres')
  })

  it('masks a secret key', () => {
    assert.equal(maskSecret('abcd1234wxyz'), 'abcd…wxyz')
    assert.equal(maskSecret('court'), '•••••')
  })

  it('spots an HTML entity in a name, without hiding it', () => {
    // The API performs no escaping: an entity in a name is genuine data corruption,
    // not a transport artefact.
    assert.equal(hasHtmlEntities('atl issue view &lt;ref&gt;'), true)
    assert.equal(hasHtmlEntities('Specification &amp; mapping'), true)
    assert.equal(hasHtmlEntities('atl issue view <ref> & co'), false)
  })
})
