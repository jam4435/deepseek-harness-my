import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml'

/** One row in the visual Cordis composition tree. */
export interface CompositionRow {
  /** Stable path into the YAML sequence. */
  path: readonly CompositionPath[]
  /** Entry id, if present. */
  id: string
  /** Human-readable name or module name. */
  name: string
  /** Whether this row is a plugin group. */
  group: boolean
  /** Whether this row is disabled. */
  disabled: boolean
  /** Whether disabled is a tagged expression such as `!!js`, not a boolean. */
  conditionalDisabled: boolean
  /** Nested rows for a group. */
  children: readonly CompositionRow[]
}

/** One prompt or regex program row found in the composition. */
export interface ProgramRow {
  /** YAML path of the owning plugin row. */
  readonly path: readonly CompositionPath[]
  /** The row's stable plugin id. */
  readonly id: string
  /** Detached UI-readable program entries. */
  readonly entries: readonly Record<string, unknown>[]
}

/** YAML path segment used by the visual tree; group children pass through `config`. */
export type CompositionPath = number | string

function parse(source: string): { document: Document; root: YAMLSeq } {
  const document = parseDocument(source, { prettyErrors: true })
  if (!isSeq(document.contents)) throw new Error('the composition must be a top-level list of plugin rows')
  return { document, root: document.contents }
}

function scalarString(map: YAMLMap, key: string): string {
  const value = map.get(key)
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function scalarBoolean(map: YAMLMap, key: string): boolean {
  return map.get(key) === true
}

function readRows(sequence: YAMLSeq, parent: readonly CompositionPath[] = []): CompositionRow[] {
  return sequence.items.flatMap((item, index) => {
    if (!isMap(item)) return []
    const path = [...parent, index]
    const group = scalarBoolean(item, 'group') || scalarString(item, 'name') === 'cordis:group'
    const disabledNode = item.get('disabled', true) as { tag?: string } | undefined
    const conditionalDisabled = disabledNode?.tag?.includes('js') === true
    const nested = item.get('config')
    const children = group && isSeq(nested) ? readRows(nested, [...path, 'config']) : []
    return [{
      path,
      id: scalarString(item, 'id'),
      name: scalarString(item, 'name'),
      group,
      disabled: scalarBoolean(item, 'disabled'),
      conditionalDisabled,
      children,
    }]
  })
}

/**
 * Parse a composition for the visual editor. Invalid YAML is reported to the caller.
 * @param source - complete agent.cordis.yml source.
 * @returns nested plugin rows with YAML paths.
 */
export function readCompositionRows(source: string): readonly CompositionRow[] {
  return readRows(parse(source).root)
}

function documentFor(source: string): Document {
  return parse(source).document
}

/**
 * Toggle one row while preserving the rest of the YAML document.
 * @param source - complete composition source.
 * @param path - YAML path of the row.
 * @param disabled - new disabled state.
 * @returns updated YAML source.
 */
export function setCompositionDisabled(source: string, path: readonly CompositionPath[], disabled: boolean): string {
  const document = documentFor(source)
  document.setIn([...path, 'disabled'], disabled)
  return document.toString()
}

/**
 * Remove one row from a root or nested plugin group.
 * @param source - complete composition source.
 * @param path - YAML path of the row.
 * @returns updated YAML source.
 */
export function deleteCompositionRow(source: string, path: readonly CompositionPath[]): string {
  if (path.length === 0) return source
  const document = documentFor(source)
  document.deleteIn(path)
  return document.toString()
}

/**
 * Reorder one row inside a sequence, optionally moving it across groups.
 * @param source - complete composition source.
 * @param from - YAML path of the row to move.
 * @param toIndex - destination index in the target sequence.
 * @param targetParent - destination sequence path.
 * @returns updated YAML source.
 */
export function moveCompositionRow(source: string, from: readonly CompositionPath[], toIndex: number, targetParent: readonly CompositionPath[] = from.slice(0, -1)): string {
  if (from.length === 0) return source
  const document = documentFor(source)
  const parent = from.slice(0, -1)
  const sourceSequence = document.getIn(parent) as unknown
  const sequence = document.getIn(targetParent) as unknown
  if (!isSeq(sourceSequence) || !isSeq(sequence)) throw new Error('the selected composition parent is not a list')
  const fromIndex = from[from.length - 1]
  if (typeof fromIndex !== 'number') throw new Error('the selected composition row is not indexed')
  if (fromIndex === toIndex && parent.every((part, index) => part === targetParent[index]) && parent.length === targetParent.length) return source
  if (fromIndex < 0 || fromIndex >= sourceSequence.items.length || toIndex < 0 || toIndex > sequence.items.length) return source
  const [item] = sourceSequence.items.splice(fromIndex, 1)
  sequence.items.splice(toIndex, 0, item)
  return document.toString()
}

/**
 * Append a plugin or plugin group to the root or a selected group.
 * @param source - complete composition source.
 * @param row - identity and module fields for the new row.
 * @param parent - destination sequence path.
 * @returns updated YAML source.
 */
export function addCompositionRow(
  source: string,
  row: { id: string; name: string; group?: boolean; config?: Record<string, unknown> },
  parent: readonly CompositionPath[] = [],
): string {
  const document = documentFor(source)
  const sequence = document.getIn(parent) as unknown
  if (!isSeq(sequence)) throw new Error('the selected composition parent is not a list')
  const value: Record<string, unknown> = { id: row.id, name: row.name }
  if (row.group === true) {
    value.group = true
    value.config = []
  }
  if (row.config !== undefined) value.config = row.config
  sequence.items.push(document.createNode(value))
  return document.toString()
}

/** Read every program row matching one module name without normalizing its YAML. */
export function readProgramRows(source: string, moduleName: string): readonly ProgramRow[] {
  const { root } = parse(source)
  return root.items.flatMap((item, index) => {
    if (!isMap(item) || scalarString(item, 'name') !== moduleName) return []
    const entries = item.getIn(['config', 'entries'])
    if (!isSeq(entries)) return [{ path: [index], id: scalarString(item, 'id'), entries: [] }]
    return [{
      path: [index],
      id: scalarString(item, 'id'),
      entries: entries.items.flatMap((entry) => {
        if (!isMap(entry)) return []
        const value = entry.toJSON()
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? [value as Record<string, unknown>] : []
      }),
    }]
  })
}

/** Toggle one boolean program entry field with a narrow YAML AST patch. */
export function setProgramEntryBoolean(
  source: string,
  rowPath: readonly CompositionPath[],
  index: number,
  field: 'enabled' | 'disabled',
  value: boolean,
): string {
  const document = documentFor(source)
  document.setIn([...rowPath, 'config', 'entries', index, field], value)
  return document.toString()
}

/** Patch one scalar program-entry field while retaining its sibling YAML nodes. */
export function setProgramEntryValue(
  source: string,
  rowPath: readonly CompositionPath[],
  index: number,
  field: string,
  value: string | number,
): string {
  const document = documentFor(source)
  document.setIn([...rowPath, 'config', 'entries', index, field], value)
  return document.toString()
}

/** Move an entry within one prompt or regex program. */
export function moveProgramEntry(source: string, rowPath: readonly CompositionPath[], from: number, to: number): string {
  const document = documentFor(source)
  const entries = document.getIn([...rowPath, 'config', 'entries'])
  if (!isSeq(entries) || from < 0 || from >= entries.items.length || to < 0 || to >= entries.items.length) return source
  const [entry] = entries.items.splice(from, 1)
  entries.items.splice(to, 0, entry)
  return document.toString()
}

/** Delete one program entry without rewriting sibling YAML nodes. */
export function deleteProgramEntry(source: string, rowPath: readonly CompositionPath[], index: number): string {
  const document = documentFor(source)
  document.deleteIn([...rowPath, 'config', 'entries', index])
  return document.toString()
}

/** Append one default entry to a program row, creating the plugin row when absent. */
export function addProgramEntry(
  source: string,
  moduleName: string,
  pluginId: string,
  entry: Record<string, unknown>,
): string {
  const document = documentFor(source)
  const root = document.contents
  if (!isSeq(root)) throw new Error('the composition must be a top-level list of plugin rows')
  const index = root.items.findIndex(item => isMap(item) && scalarString(item, 'name') === moduleName)
  if (index < 0) {
    root.items.push(document.createNode({ id: pluginId, name: moduleName, config: { entries: [entry] } }))
    return document.toString()
  }
  const entries = document.getIn([index, 'config', 'entries'])
  if (!isSeq(entries)) {
    document.setIn([index, 'config', 'entries'], [entry])
  } else {
    entries.items.push(document.createNode(entry))
  }
  return document.toString()
}
