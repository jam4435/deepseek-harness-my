import { describe, expect, it } from 'vitest'
import {
  addCompositionRow,
  deleteCompositionRow,
  moveCompositionRow,
  readCompositionRows,
  setCompositionDisabled,
} from '../src/client/composition.ts'

const SOURCE = `# keep this comment
- id: group
  name: cordis:group
  group: true
  config:
    - id: first
      name: plugin:first
    - id: second
      name: plugin:second
`

describe('visual composition tree helpers', () => {
  it('reads nested groups and toggles a row without losing comments', () => {
    const rows = readCompositionRows(SOURCE)
    expect(rows[0]?.children.map(row => row.id)).toEqual(['first', 'second'])
    const changed = setCompositionDisabled(SOURCE, [0, 1], true)
    expect(changed).toContain('# keep this comment')
    expect(changed).toContain('disabled: true')
  })

  it('moves, adds, and deletes rows in the selected sequence', () => {
    const moved = moveCompositionRow(SOURCE, [0, 'config', 1], 0)
    expect(readCompositionRows(moved)[0]?.children[0]?.id).toBe('second')
    const added = addCompositionRow(moved, { id: 'third', name: 'plugin:third' }, [0, 'config'])
    expect(readCompositionRows(added)[0]?.children.map(row => row.id)).toEqual(['second', 'first', 'third'])
    const deleted = deleteCompositionRow(added, [0, 'config', 1])
    expect(readCompositionRows(deleted)[0]?.children.map(row => row.id)).toEqual(['second', 'third'])
  })

  it('moves a row across plugin groups', () => {
    const source = `${SOURCE}- id: outside\n  name: plugin:outside\n`
    const moved = moveCompositionRow(source, [1], 0, [0, 'config'])
    expect(readCompositionRows(moved)[0]?.children[0]?.id).toBe('outside')
  })

  it('rejects non-list compositions', () => {
    expect(() => readCompositionRows('name: invalid\n')).toThrow(/top-level list/)
  })

  it('leaves conditional JavaScript tags to the advanced source editor', () => {
    expect(readCompositionRows('- id: shell\n  name: plugin:shell\n  disabled: !!js process.platform === \'win32\'\n')[0]?.conditionalDisabled).toBe(true)
  })
})
