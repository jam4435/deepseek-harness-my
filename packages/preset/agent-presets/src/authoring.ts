/**
 * Copying, reading, and deleting locally authored presets.
 *
 * Authoring is confined to a `user` root: the shipped `.system` set is part of
 * the deployment, and letting a browser rewrite it would turn "reset to a known
 * preset" into something the same caller could have broken first.
 *
 * The only authoring write is a whole-directory copy of an existing preset.
 * No caller supplies composition text: the inputs are ids the host resolves
 * against its own roots plus an optional display name, so authoring grants no
 * capability the copied preset did not already carry.
 * @module @deepseek-ai/dsh-agent-presets/authoring
 */

import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dump as dumpYaml } from 'js-yaml'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { METADATA_FILE, renderPresetMetadata } from './metadata.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'
import type { SillyTavernImportPreview } from './sillytavern.ts'
import type { PresetFileContent, PresetFileEntry, PresetFileOperation } from './editor-types.ts'
export type { PresetFileContent, PresetFileEntry, PresetFileOperation } from './editor-types.ts'
import { revisionForPresetDirectory } from './revisions.ts'

/** A preset id that cannot be used as a directory name under a root. */
export class InvalidPresetIdError extends Error {
  constructor(
    /** The rejected id. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — `
      + 'the id is a directory name, so anything else could escape the preset root',
    )
  }
}

/** A copy target that is already occupied — a copy never overwrites. */
export class PresetExistsError extends Error {
  constructor(
    /** The id that is already taken. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset "${presetId}" already exists — `
      + 'a copy never overwrites; delete the existing preset first or choose another id',
    )
  }
}

/** Authoring was attempted where the deployment allows none. */
export class PresetNotWritableError extends Error {
  constructor(
    /** What the caller tried to change, for the diagnostic. */
    readonly presetId: string,
    reason: string,
  ) {
    super(`agent-presets: preset "${presetId}" cannot be written: ${reason}`)
  }
}

/** The preset changed after an editor opened it, so its draft cannot be applied safely. */
export class PresetRevisionConflictError extends Error {
  constructor(
    /** The id whose editable directory changed. */
    readonly presetId: string,
    /** The revision supplied by the editor. */
    readonly expected: string,
    /** The revision currently on disk. */
    readonly actual: string,
  ) {
    super(`agent-presets: preset "${presetId}" changed while it was being edited; reload before saving`)
  }
}

/** Maximum text-file size exposed by the visual editor. */
export const PRESET_TEXT_FILE_LIMIT = 1024 * 1024
/** Maximum one file read/write attachment. */
export const PRESET_FILE_LIMIT = 16 * 1024 * 1024
/** Maximum combined editor save payload. */
export const PRESET_SAVE_LIMIT = 64 * 1024 * 1024
/** Maximum published version size. */
export const PRESET_VERSION_LIMIT = 256 * 1024 * 1024
/** Maximum files and directories in one published version. */
export const PRESET_ENTRY_LIMIT = 10_000

const REVISION_LIMITS = { versionBytes: PRESET_VERSION_LIMIT, entries: PRESET_ENTRY_LIMIT } as const

const RESERVED_PRESET_FILES = new Set(['agent.cordis.yml', METADATA_FILE])

/** Files owned by the studio itself, never by the generic file-tree editor. */
function isReservedPresetPath(path: string): boolean {
  return RESERVED_PRESET_FILES.has(path) || path === '.dsh' || path.startsWith('.dsh/')
}

/**
 * Normalize one editor path, rejecting traversal, drive letters, and separators.
 * @param path - user-supplied relative path.
 * @param allowEmpty - permit the root directory marker.
 * @returns normalized POSIX path.
 */
export function normalizePresetRelativePath(path: string, allowEmpty = false): string {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new PresetNotWritableError('', `path "${path}" is not a relative POSIX path`)
  }
  const segments = path.split('/')
  if ((!allowEmpty && segments.length === 0) || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    if (allowEmpty && path === '') return ''
    throw new PresetNotWritableError('', `path "${path}" is not normalized`)
  }
  return segments.join('/')
}

/** Resolve a safe path and verify every existing component is not a link. */
async function safePresetPath(dir: string, relative: string, allowEmpty = false): Promise<string> {
  const normalized = normalizePresetRelativePath(relative, allowEmpty)
  const target = resolve(dir, normalized)
  if (target !== resolve(dir) && !target.startsWith(`${resolve(dir)}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new PresetNotWritableError('', `path "${relative}" escapes the preset root`)
  }
  let current = resolve(dir)
  for (const segment of normalized === '' ? [] : normalized.split('/')) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new PresetNotWritableError('', `path "${relative}" traverses a symbolic link`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return target
}

/**
 * Recursively list regular files/directories under a preset root.
 * @param preset - resolved preset directory.
 * @param directory - relative directory prefix.
 * @param cursor - exclusive lexicographic continuation cursor.
 * @param limit - maximum number of rows.
 * @returns stable file-tree page.
 */
export async function listPresetFiles(
  preset: AgentPreset,
  directory = '',
  cursor = '',
  limit = 200,
): Promise<{ entries: PresetFileEntry[]; nextCursor?: string }> {
  const root = dirname(preset.path)
  const base = await safePresetPath(root, directory, true)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new PresetNotWritableError(preset.id, 'file list limit must be between 1 and 1000')
  const rows: PresetFileEntry[] = []
  const visit = async (current: string, relative: string): Promise<boolean> => {
    const children = await readdir(current, { withFileTypes: true })
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative === '' ? child.name : `${relative}/${child.name}`
      if (child.isSymbolicLink()) throw new PresetNotWritableError(preset.id, `"${childRelative}" is a symbolic link`)
      if (child.isDirectory()) {
        if (childRelative > cursor) rows.push({ path: childRelative, type: 'directory', size: 0, executable: false })
        if (rows.length > limit) return true
        if (await visit(join(current, child.name), childRelative)) return true
      } else if (child.isFile()) {
        const info = await lstat(join(current, child.name))
        if (childRelative > cursor) rows.push({ path: childRelative, type: 'file', size: info.size, executable: (info.mode & 0o100) !== 0 })
      } else {
        throw new PresetNotWritableError(preset.id, `"${childRelative}" is not a regular file or directory`)
      }
      if (rows.length > limit) return true
    }
    return false
  }
  await visit(base, directory)
  const entries = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? entries.at(-1)?.path : undefined
  return nextCursor === undefined ? { entries } : { entries, nextCursor }
}

/**
 * Read one regular file without following a link or exceeding attachment limits.
 * @param preset - resolved preset directory.
 * @param relative - normalized file path.
 * @returns bounded text or Base64 content.
 */
export async function readPresetFile(preset: AgentPreset, relative: string): Promise<PresetFileContent> {
  const file = await safePresetPath(dirname(preset.path), relative)
  const info = await lstat(file)
  if (!info.isFile()) throw new PresetNotWritableError(preset.id, `"${relative}" is not a regular file`)
  if (info.size > PRESET_FILE_LIMIT) throw new PresetNotWritableError(preset.id, `"${relative}" exceeds ${PRESET_FILE_LIMIT} bytes`)
  const bytes = await readFile(file)
  const text = bytes.toString('utf8')
  if (!text.includes('\uFFFD') && !bytes.includes(0)) {
    if (bytes.length > PRESET_TEXT_FILE_LIMIT) throw new PresetNotWritableError(preset.id, `\"${relative}\" exceeds ${PRESET_TEXT_FILE_LIMIT} text bytes`)
    return { kind: 'text', path: normalizePresetRelativePath(relative), size: bytes.length, content: text }
  }
  return { kind: 'binary', path: normalizePresetRelativePath(relative), size: bytes.length, base64: bytes.toString('base64') }
}

/**
 * Apply a complete editor draft in a private clone, then replace the directory.
 * @param roots - configured preset roots.
 * @param preset - user-owned preset being edited.
 * @param expectedRevision - revision observed when the editor opened.
 * @param draft - metadata, composition, and staged file operations.
 * @returns immutable revision hash after commit.
 */
export async function saveComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
  expectedRevision: string,
  draft: { composition: string; name?: string; description?: string; files?: readonly PresetFileOperation[] },
  validate?: (directory: string) => Promise<void>,
): Promise<string> {
  if (preset.trust !== 'user') throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  if (Buffer.byteLength(draft.composition, 'utf8') > PRESET_TEXT_FILE_LIMIT) throw new PresetNotWritableError(preset.id, 'agent.cordis.yml exceeds the text-file limit')
  let payloadBytes = Buffer.byteLength(draft.composition, 'utf8')
    + (draft.name === undefined ? 0 : Buffer.byteLength(draft.name, 'utf8'))
    + (draft.description === undefined ? 0 : Buffer.byteLength(draft.description, 'utf8'))
  for (const operation of draft.files ?? []) {
    payloadBytes += Buffer.byteLength(operation.path, 'utf8')
    if (operation.kind === 'write-text') {
      payloadBytes += Buffer.byteLength(operation.content, 'utf8')
    } else if (operation.kind === 'write-base64') {
      const bytes = decodeBase64(operation.base64, preset.id, operation.path)
      if (bytes.length > PRESET_FILE_LIMIT) throw new PresetNotWritableError(preset.id, `\"${operation.path}\" exceeds the file limit`)
      payloadBytes += bytes.length
    } else if (operation.kind === 'rename') {
      payloadBytes += Buffer.byteLength(operation.target, 'utf8')
    }
  }
  if (payloadBytes > PRESET_SAVE_LIMIT) throw new PresetNotWritableError(preset.id, `save payload exceeds ${PRESET_SAVE_LIMIT} bytes`)
  const dir = join(writableRoot(roots), preset.id)
  if (!isAbsolute(preset.path) || dirname(resolve(preset.path)) !== resolve(dir)) throw new PresetNotWritableError(preset.id, 'it does not live under the writable preset root')
  const actual = (await revisionForPresetDirectory(preset.id, dir, REVISION_LIMITS)).revision as string
  if (actual !== expectedRevision) throw new PresetRevisionConflictError(preset.id, expectedRevision, actual)
  const temp = await mkdtemp(join(writableRoot(roots), `.dsh-preset-${preset.id}-`))
  let backup: string | undefined
  try {
    await cp(dir, temp, { recursive: true, dereference: true, force: true })
    await writeFile(join(temp, 'agent.cordis.yml'), draft.composition, { encoding: 'utf8', mode: 0o600 })
    const metadata = renderPresetMetadata({
      ...draft.name === undefined ? {} : { name: draft.name },
      ...draft.description === undefined ? {} : { description: draft.description },
    })
    if (metadata === undefined) await rm(join(temp, METADATA_FILE), { force: true })
    else await writeFile(join(temp, METADATA_FILE), metadata, { encoding: 'utf8', mode: 0o600 })
    for (const operation of draft.files ?? []) await applyFileOperation(temp, preset.id, operation)
    await tightenModes(temp)
    await validate?.(temp)
    const revision = await revisionForPresetDirectory(preset.id, temp, REVISION_LIMITS)
    backup = `${dir}.recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`
    await rename(dir, backup)
    try {
      await rename(temp, dir)
    } catch (error) {
      await rename(backup, dir)
      backup = undefined
      throw error
    }
    await rm(backup, { recursive: true, force: true })
    backup = undefined
    return revision.revision as string
  } finally {
    if (backup !== undefined) {
      try { await rename(backup, dir) } catch { /* recovery is best effort after a failed replacement */ }
    }
    await rm(temp, { recursive: true, force: true })
  }
}

/** Apply one safe operation to the private editor clone. */
async function applyFileOperation(dir: string, presetId: string, operation: PresetFileOperation): Promise<void> {
  const path = normalizePresetRelativePath(operation.path)
  if (isReservedPresetPath(path)) throw new PresetNotWritableError(presetId, `"${path}" is managed by the overview/editor`)
  const target = await safePresetPath(dir, path)
  switch (operation.kind) {
    case 'mkdir':
      await mkdir(target, { recursive: false, mode: 0o700 })
      return
    case 'write-text':
      if (Buffer.byteLength(operation.content, 'utf8') > PRESET_TEXT_FILE_LIMIT) throw new PresetNotWritableError(presetId, `"${path}" exceeds the text-file limit`)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, operation.content, { encoding: 'utf8', mode: 0o600 })
      return
    case 'write-base64': {
      const bytes = decodeBase64(operation.base64, presetId, path)
      if (bytes.length > PRESET_FILE_LIMIT) throw new PresetNotWritableError(presetId, `"${path}" exceeds the file limit`)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, bytes, { mode: operation.executable ? 0o700 : 0o600 })
      return
    }
    case 'rename': {
      const targetPath = normalizePresetRelativePath(operation.target)
      if (isReservedPresetPath(targetPath)) throw new PresetNotWritableError(presetId, `"${targetPath}" is managed by the overview/editor`)
      await assertNoReservedDescendants(target, path, presetId)
      const destination = await safePresetPath(dir, targetPath)
      try {
        await lstat(destination)
        throw new PresetNotWritableError(presetId, `"${targetPath}" already exists`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(target, destination)
      return
    }
    case 'delete': {
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new PresetNotWritableError(presetId, `"${path}" is a symbolic link`)
      await assertNoReservedDescendants(target, path, presetId)
      await rm(target, { recursive: info.isDirectory(), force: false })
      return
    }
  }
}

/** Decode an attachment once, rejecting encodings Node would otherwise normalize silently. */
function decodeBase64(base64: string, presetId: string, path: string): Buffer {
  if (base64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new PresetNotWritableError(presetId, `"${path}" is not valid Base64`)
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    throw new PresetNotWritableError(presetId, `"${path}" is not valid Base64`)
  }
  return bytes
}

async function assertNoReservedDescendants(target: string, relative: string, presetId: string): Promise<void> {
  if (isReservedPresetPath(relative)) throw new PresetNotWritableError(presetId, `"${relative}" is managed by the overview/editor`)
  const info = await lstat(target)
  if (!info.isDirectory()) return
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`
    if (isReservedPresetPath(child)) throw new PresetNotWritableError(presetId, `"${child}" is managed by the overview/editor`)
    if (entry.isSymbolicLink()) throw new PresetNotWritableError(presetId, `"${child}" is a symbolic link`)
    if (entry.isDirectory()) await assertNoReservedDescendants(join(target, entry.name), child, presetId)
  }
}

/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
export function writableRoot(roots: readonly PresetRoot[]): string {
  const root = roots.find(candidate => candidate.trust === 'user')
  if (root === undefined) {
    throw new PresetNotWritableError('', 'this deployment configures no user-writable preset root')
  }
  return resolve(expandHomePath(root.path))
}

/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
export async function readComposition(preset: AgentPreset): Promise<string> {
  return await readFile(preset.path, 'utf8')
}

/**
 * Hash a preset directory deterministically.
 *
 * The result is an optimistic-concurrency token, not a security signature.
 * Rejecting links keeps an editor request from traversing outside its preset
 * directory while it is calculating that token.
 * @param dir - the preset directory containing `agent.cordis.yml`.
 * @returns a SHA-256 revision for all regular files and directories below dir.
 */
export async function revisionForDirectory(dir: string): Promise<string> {
  const hash = createHash('sha256')
  let bytes = 0
  let entriesSeen = 0
  const visit = async (current: string, relative: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      entriesSeen += 1
      if (entriesSeen > PRESET_ENTRY_LIMIT) throw new PresetNotWritableError(relative, `version exceeds ${PRESET_ENTRY_LIMIT} entries`)
      const child = join(current, entry.name)
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isSymbolicLink()) {
        throw new PresetNotWritableError(relative, `"${childRelative}" is a symbolic link`)
      }
      if (entry.isDirectory()) {
        hash.update(`directory\0${childRelative}\0`)
        await visit(child, childRelative)
        continue
      }
      if (!entry.isFile()) {
        throw new PresetNotWritableError(relative, `"${childRelative}" is not a regular file`)
      }
      const info = await lstat(child)
      hash.update(`file\0${childRelative}\0${info.mode & 0o100}\0`)
      const content = await readFile(child)
      bytes += content.byteLength
      if (bytes > PRESET_VERSION_LIMIT) throw new PresetNotWritableError(relative, `version exceeds ${PRESET_VERSION_LIMIT} bytes`)
      hash.update(content)
    }
  }
  await visit(dir, '')
  return hash.digest('hex')
}

/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path: string): Promise<boolean> {
  let present = true
  try {
    await stat(path)
  } catch {
    // Every stat failure means the same thing here: nothing usable occupies
    // the path, so the copy may claim it.
    present = false
  }
  return present
}

/**
 * Re-tighten a copied tree to owner-only. A shipped preset is world-readable
 * in its install and `cp` preserves that; the copy carries the same weight as
 * the settings document beside it, so group/other access is stripped. A
 * file's owner-execute bit survives — a preset may ship runnable helpers.
 */
async function tightenModes(dir: string): Promise<void> {
  await chmod(dir, 0o700)
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

/**
 * Create a preset by copying an existing one's whole directory.
 *
 * The copy carries everything the source directory holds — composition,
 * metadata, skill directories, assets — because a preset is its directory,
 * not one file. Symlinks are dereferenced so the copy is self-contained
 * rather than a set of links back into the install it was copied from.
 *
 * The copied metadata is then rewritten: the source's description is kept
 * (the file is the author's to edit afterwards), but its name and roster
 * `order` are not — a copy presenting itself identically to its source, or
 * sorted into the shipped set's declared order, would make the roster stop
 * distinguishing them. With no name given and no description to keep, the
 * file is removed so the copy publishes nothing rather than a blank.
 * @param roots - the configured roots; the first `user` one receives the copy.
 * @param source - the resolved preset the copy starts from.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; omitted falls back to the id.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk, or the
 * deployment configures no writable root.
 */
export async function copyComposition(
  roots: readonly PresetRoot[],
  source: AgentPreset,
  id: string,
  name?: string,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(writableRoot(roots), id)
  // The roster check upstream only sees discovered presets; a directory with
  // no composition file still occupies the name and deserves a readable
  // refusal rather than a filesystem error code.
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 })
    await cp(dirname(source.path), dir, {
      recursive: true, dereference: true, force: false, errorOnExist: true,
    })
    await tightenModes(dir)
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...source.description === undefined ? {} : { description: source.description },
    })
    const metadataPath = join(dir, METADATA_FILE)
    if (rendered === undefined) {
      await rm(metadataPath, { force: true })
    } else {
      await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
    }
  } catch (error) {
    // A half-copied directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed copy leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  await revisionForPresetDirectory(id, dir, REVISION_LIMITS)
  return dir
}

/**
 * Create a blank, locally authored preset.
 * @param roots - roots containing the writable preset directory.
 * @param id - immutable directory id for the new preset.
 * @param name - initial display name; absent falls back to id.
 * @returns the absolute path of the created preset directory.
 */
export async function createComposition(
  roots: readonly PresetRoot[],
  id: string,
  name?: string,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(writableRoot(roots), id)
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 })
    await mkdir(dir, { mode: 0o700 })
    await writeFileAtomic(join(dir, 'agent.cordis.yml'), '[]\n', { mode: 0o600, dirMode: 0o700 })
    await writeFileAtomic(
      join(dir, METADATA_FILE),
      renderPresetMetadata({ name: name ?? id }) ?? '',
      { mode: 0o600, dirMode: 0o700 },
    )
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  await revisionForPresetDirectory(id, dir, REVISION_LIMITS)
  return dir
}

/**
 * Update the editable documents of one locally authored preset.
 *
 * The revision check makes browser saves fail closed when a second editor or a
 * native editor changed the directory after the draft was opened.
 * @param roots - configured discovery and authoring roots.
 * @param preset - resolved preset being updated.
 * @param expectedRevision - revision supplied by the editor when it opened.
 * @param draft - metadata and composition to persist.
 * @returns the revision after the write.
 */
export async function updateComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
  expectedRevision: string,
  draft: { composition: string; name?: string; description?: string },
  validate?: (directory: string) => Promise<void>,
): Promise<string> {
  return await saveComposition(roots, preset, expectedRevision, draft, validate)
}

/**
 * Create a custom preset from a Harness base and retain one SillyTavern source.
 * The source and report are data files; no macro, extension, or regular
 * expression is evaluated during this operation. The runtime adapter can
 * consume these files in a later composition edit without losing provenance.
 * @param roots - configured preset roots.
 * @param source - resolved Harness preset used as the base composition.
 * @param id - new immutable preset id.
 * @param name - display name for the imported preset.
 * @param json - original uploaded SillyTavern JSON.
 * @param preview - validated import report to persist beside the source.
 * @returns the created preset directory.
 */
export async function importComposition(
  roots: readonly PresetRoot[],
  source: AgentPreset,
  id: string,
  name: string | undefined,
  json: string,
  preview: SillyTavernImportPreview,
): Promise<string> {
  const dir = await copyComposition(roots, source, id, name ?? id)
  try {
    if (preview.prompts.length > 0 || preview.regexes.length > 0 || Object.keys(preview.sampling).length > 0) {
      const compositionPath = join(dir, 'agent.cordis.yml')
      const existing = await readFile(compositionPath, 'utf8')
      const rows: unknown[] = []
      if (preview.prompts.length > 0 && !existing.includes('id: prompt-program-import')) {
        rows.push({
          id: 'prompt-program-import',
          name: '@deepseek-ai/dsh-prompt-program',
          config: { entries: preview.prompts },
        })
      }
      if (preview.regexes.length > 0 && !existing.includes('id: regex-program-import')) {
        rows.push({
          id: 'regex-program-import',
          name: '@deepseek-ai/dsh-regex-program',
          config: { entries: preview.regexes },
        })
      }
      if (Object.keys(preview.sampling).length > 0 && !existing.includes('id: request-options-import')) {
        rows.push({
          id: 'request-options-import',
          name: '@deepseek-ai/dsh-request-options',
          config: preview.sampling,
        })
      }
      if (rows.length > 0) {
        const suffix = rows.map(row => dumpYaml(row, { noRefs: true, lineWidth: -1 }).trimEnd()).join('\n')
        await writeFile(compositionPath, `${existing.trimEnd()}\n${suffix}\n`, 'utf8')
      }
    }
    const importDir = join(dir, '.dsh', 'sillytavern')
    await mkdir(importDir, { recursive: true, mode: 0o700 })
    await writeFileAtomic(join(importDir, 'source.json'), json, { mode: 0o600, dirMode: 0o700 })
    await writeFileAtomic(join(importDir, 'report.json'), `${JSON.stringify(preview, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    await revisionForPresetDirectory(id, dir, REVISION_LIMITS)
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Delete a locally authored preset.
 *
 * A shipped preset is refused: it belongs to the deployment. A preset a live
 * session mounted is NOT refused — the composition was read at creation and is
 * never re-read, so that session keeps running exactly as it was.
 * @param roots - the configured roots.
 * @param preset - the resolved preset to remove.
 * @throws when the preset ships with the deployment or lies outside the writable root.
 */
export async function deleteComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
): Promise<void> {
  if (preset.trust !== 'user') {
    throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  }
  const dir = join(writableRoot(roots), preset.id)
  // Belt and braces over the id pattern: the resolved directory must still be
  // the one the writable root owns, whatever discovery reported.
  if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) {
    throw new PresetNotWritableError(preset.id, 'it does not live under the writable preset root')
  }
  await rm(dir, { recursive: true, force: true })
}
