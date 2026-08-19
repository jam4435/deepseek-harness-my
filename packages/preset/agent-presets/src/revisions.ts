/** Immutable content-addressed storage for agent-preset directory revisions. */
import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { AgentPresetId, AgentPresetRevision, type AgentPresetReference } from '@deepseek-ai/dsh-session/types'

/** Immutable-tree limits applied while publishing a revision. */
export interface PresetRevisionLimits {
  /** Maximum total byte size of regular files. */
  readonly versionBytes: number
  /** Maximum number of files and directories. */
  readonly entries: number
}

/** Default permanent repository location below the resolved DSH home. */
export function defaultPresetRevisionRoot(): string {
  return dshHomePath('.agent-preset-revisions')
}

interface DirectoryEntry {
  readonly path: string
  readonly type: 'directory'
}

interface FileEntry {
  readonly path: string
  readonly type: 'file'
  readonly blob: string
  readonly executable: boolean
}

type RevisionEntry = DirectoryEntry | FileEntry

interface RevisionManifest {
  readonly version: 1
  readonly entries: readonly RevisionEntry[]
}

/** Name of the durable marker that ties a content tree to a stable preset id. */
function referencePath(root: string, id: string, revision: string): string {
  return join(root, 'references', id, revision)
}

function hashBytes(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function manifestBytes(manifest: RevisionManifest): string {
  return `${JSON.stringify(manifest)}\n`
}

async function writeOnce(path: string, content: string | Uint8Array, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(path, content, { flag: 'wx', mode })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(path)
    const expected = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
    if (!existing.equals(expected)) throw new Error(`agent-presets: immutable repository collision at ${path}`)
  }
}

/**
 * Build a normalized manifest and publish every source file to its blob path.
 * @param root - immutable-repository root.
 * @param presetId - stable id to bind to the published revision.
 * @param source - directory whose complete contents become the revision.
 * @param limits - maximum source tree size and entries.
 * @returns exact reference to the published revision.
 */
export async function publishPresetRevision(
  root: string,
  presetId: string,
  source: string,
  limits: PresetRevisionLimits,
): Promise<AgentPresetReference> {
  const entries: RevisionEntry[] = []
  let bytes = 0
  let count = 0
  const scan = async (directory: string, relative: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const path = relative === '' ? child.name : `${relative}/${child.name}`
      const target = join(directory, child.name)
      const info = await lstat(target)
      count += 1
      if (count > limits.entries) throw new Error(`agent-presets: revision exceeds ${limits.entries} entries`)
      if (info.isSymbolicLink()) throw new Error(`agent-presets: revision rejects symbolic link "${path}"`)
      if (info.isDirectory()) {
        entries.push({ path, type: 'directory' })
        await scan(target, path)
        continue
      }
      if (!info.isFile()) throw new Error(`agent-presets: revision rejects non-regular entry "${path}"`)
      const content = await readFile(target)
      bytes += content.byteLength
      if (bytes > limits.versionBytes) throw new Error(`agent-presets: revision exceeds ${limits.versionBytes} bytes`)
      const blob = hashBytes(content)
      await writeOnce(join(root, 'blobs', blob), content, 0o600)
      entries.push({ path, type: 'file', blob, executable: (info.mode & 0o100) !== 0 })
    }
  }
  await scan(resolve(source), '')
  const manifest: RevisionManifest = { version: 1, entries }
  const revision = hashBytes(manifestBytes(manifest))
  await writeOnce(join(root, 'manifests', `${revision}.json`), manifestBytes(manifest), 0o600)
  await writeOnce(referencePath(root, presetId, revision), '', 0o600)
  return { id: AgentPresetId(presetId), revision: AgentPresetRevision(revision) }
}

async function readManifest(root: string, reference: AgentPresetReference): Promise<RevisionManifest> {
  const id = reference.id as string
  const revision = reference.revision as string
  try {
    await lstat(referencePath(root, id, revision))
  } catch {
    throw new Error(`agent-presets: revision ${revision} is not retained for preset "${id}"`)
  }
  const content = await readFile(join(root, 'manifests', `${revision}.json`), 'utf8')
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1
    || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    throw new Error(`agent-presets: revision ${revision} has an invalid manifest`)
  }
  return parsed as RevisionManifest
}

/**
 * Materialize an immutable revision into a private writable directory.
 * @param root - immutable repository root.
 * @param reference - exact revision to materialize.
 * @param destination - empty destination directory on the same filesystem.
 */
export async function materializePresetRevision(
  root: string,
  reference: AgentPresetReference,
  destination: string,
): Promise<void> {
  const manifest = await readManifest(root, reference)
  await mkdir(destination, { recursive: false, mode: 0o700 })
  try {
    for (const entry of manifest.entries) {
      const target = join(destination, ...entry.path.split('/'))
      if (entry.type === 'directory') {
        await mkdir(target, { recursive: false, mode: 0o700 })
        continue
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await copyFile(join(root, 'blobs', entry.blob), target)
      await chmod(target, entry.executable ? 0o700 : 0o600)
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

/**
 * Publish a working directory under its preset id and return the exact revision.
 * @param presetId - stable preset id.
 * @param source - complete working directory.
 * @param limits - size limits for this published revision.
 * @param root - optional explicit repository root for deployments and tests.
 */
export async function revisionForPresetDirectory(
  presetId: string,
  source: string,
  limits: PresetRevisionLimits,
  root: string = defaultPresetRevisionRoot(),
): Promise<AgentPresetReference> {
  return await publishPresetRevision(root, presetId, source, limits)
}

/**
 * Remove an incomplete private materialization after its mount scope disposes.
 * @param destination - private materialized mount directory.
 */
export async function disposeMaterializedPreset(destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true })
}
