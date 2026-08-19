/**
 * Agent-preset management controller: the roster as a list, a copy dialog as
 * the only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text. A new preset is a host-side copy of
 * an existing one (`{ from, id, name? }` is all that crosses the wire), and
 * everything after creation happens in the preset's own files — which is why
 * the page's other job is getting the user TO those files: open the directory
 * where the host has a desktop, show its path where it does not.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy changes
 * more than the row it targeted.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetReference } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { beginRosterRead, messageOf, writeDefaultPreset } from './settings-store.ts'
import {
  addCompositionRow,
  deleteCompositionRow,
  moveCompositionRow,
  readCompositionRows,
  setCompositionDisabled,
  type CompositionPath,
  type CompositionRow,
} from './composition.ts'

/** Ids a preset directory may be named, mirroring the host's own rule. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One regex entry accepted by the Host test worker. */
export type RegexTestEntry = Parameters<IApiClient['agentPresets']['editorTestRegex']>[0]['entry']

/** Result returned by the Host test worker. */
export interface RegexTestResult {
  /** Replaced text. */
  readonly output: string
  /** Capture groups from the first match. */
  readonly captures: readonly string[]
  /** Host-worker duration in milliseconds. */
  readonly elapsedMs: number
}

/** One preset row the page renders. */
export interface PresetRow {
  /** Preset id and directory name; the display name falls back to it. */
  id: string
  /** Exact latest immutable revision returned by the roster. */
  reference: AgentPresetReference
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  isDefault: boolean
  /**
   * Why the preset cannot compose a session, absent when it can. A broken
   * row renders marked and unselectable — its directory still occupies the
   * id, so deleting it (or fixing the files) is the way out, and this page
   * is where both of those live.
   */
  broken?: string
}

/** The copy dialog: a new id and optional display name over a fixed source. */
export interface CopyDraft {
  /** The preset being copied. */
  from: AgentPresetReference | null
  /** Display name of the source, for the dialog title. */
  fromTitle: string
  /** New preset id being typed; the directory name, so it is required. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** Whether the copy is in flight. */
  saving: boolean
  /** The last copy failure, cleared by the next edit. */
  error: string | null
}

/** The read-only composition viewer over one shipped preset. */
export interface PresetView {
  /** The preset whose composition is shown. */
  id: string
  /** Display name, for the dialog title. */
  title: string
  /** Composition text exactly as stored. */
  content: string
}

/** One opened preset-studio draft. */
export interface PresetEditorDraft {
  /** Preset identity; this cannot be renamed. */
  id: string
  /** Immutable revision the editor opened and must save against. */
  reference: AgentPresetReference
  /** Shipped presets can be inspected but never saved. */
  trust: 'system' | 'user'
  /** Editable display name. */
  name: string
  /** Editable display description. */
  description: string
  /** Complete YAML composition, intentionally available as an exact source fallback. */
  composition: string
  /** Parsed rows used by the visual composition editor. */
  compositionRows: readonly CompositionRow[]
  /** Files currently visible in the preset directory. */
  files: readonly PresetFileDraft[]
  /** File operations queued until the atomic save. */
  fileOperations: readonly PresetFileOperation[]
  /** Selected file path in the file-tree editor. */
  selectedFile: string | null
  /** Text contents loaded for selected files. */
  fileContents: Readonly<Record<string, string>>
  /** Binary Base64 contents loaded for image previews/downloads. */
  fileBinaries: Readonly<Record<string, string>>
  /** Whether the draft has local changes. */
  dirty: boolean
  /** Whether a save is in progress. */
  saving: boolean
  /** Last editor operation failure. */
  error: string | null
}

/** One safe relative file-tree entry returned by the Host. */
export interface PresetFileDraft {
  path: string
  type: 'file' | 'directory'
  size: number
  executable: boolean
  reserved: boolean
}

/** File operation staged for the next atomic editor save. */
export type PresetFileOperation =
  | { kind: 'mkdir'; path: string }
  | { kind: 'write-text'; path: string; content: string }
  | { kind: 'write-base64'; path: string; base64: string; executable?: boolean }
  | { kind: 'rename'; path: string; target: string }
  | { kind: 'delete'; path: string }

/** The host's SillyTavern import preview, kept local to the client bundle. */
export interface ImportPreview {
  kind: 'chat-completion' | 'regex' | 'instruct' | 'context' | 'system-prompt' | 'reasoning' | 'text-completion' | 'unknown'
  prompts: readonly {
    id: string
    name: string
    content: string
    enabled: boolean
    role: 'system' | 'user' | 'assistant'
    position: 'relative' | 'depth'
    depth?: number
    order: number
  }[]
  regexes: readonly {
    id: string
    name: string
    find: string
    replace: string
    flags?: string
    target?: 'request' | 'response'
    disabled: boolean
  }[]
  sampling: { readonly temperature?: number; readonly maxTokens?: number; readonly stop?: readonly string[] }
  issues: readonly { disposition: 'converted' | 'approximated' | 'preserved' | 'rejected'; subject: string; message: string }[]
}

/** One uncommitted SillyTavern import. */
export interface ImportDraft {
  source: AgentPresetReference
  id: string
  name: string
  fileName: string
  content: string
  preview: ImportPreview | null
  /** Source hash returned by the Host preview. */
  sourceHash: string | null
  saving: boolean
  error: string | null
}

/** Page snapshot. */
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text; a copy failure stays on the dialog. */
  error: string | null
  /** Whether the deployment configures a root new presets can be written to. */
  authorable: boolean
  /** Whether the host can open a preset directory on a native desktop. */
  hasDocument: boolean
  /** Every preset the deployment currently supplies. */
  rows: readonly PresetRow[]
  /** The open copy dialog, or null. */
  copy: CopyDraft | null
  /** The open read-only viewer, or null. */
  view: PresetView | null
  /** Open visual preset editor, or null. */
  editor: PresetEditorDraft | null
  /** The open SillyTavern import wizard, or null. */
  importDraft: ImportDraft | null
  /** The preset awaiting delete confirmation. */
  pendingDelete: string | null
  /** Whether a delete is in flight. */
  deleting: boolean
  /**
   * Preset directories shown as text because the host has no desktop opener
   * — the answer `openDocument` gives instead of opening.
   */
  revealedPaths: Readonly<Record<string, string>>
}

const INITIAL: AgentPresetSectionState = {
  status: 'idle',
  error: null,
  authorable: false,
  hasDocument: false,
  rows: [],
  copy: null,
  view: null,
  editor: null,
  importDraft: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

function findCompositionRow(rows: readonly CompositionRow[], path: readonly CompositionPath[]): CompositionRow | undefined {
  for (const row of rows) {
    if (row.path.length === path.length && row.path.every((part, index) => part === path[index])) return row
    const nested = findCompositionRow(row.children, path)
    if (nested !== undefined) return nested
  }
  return undefined
}

function replaceFileOperation(
  operations: readonly PresetFileOperation[],
  operation: PresetFileOperation,
): readonly PresetFileOperation[] {
  const index = operations.findIndex((candidate) => {
    if (candidate.kind !== 'write-text' || operation.kind !== 'write-text') return false
    return candidate.path === operation.path
  })
  if (index < 0) return [...operations, operation]
  return operations.map((candidate, candidateIndex) => candidateIndex === index ? operation : candidate)
}

/**
 * Why this copy cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id and its answer is what
 * the dialog reports on failure.
 * @param draft - the open copy dialog.
 * @param rows - the roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function draftBlocker(
  draft: CopyDraft,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  // A copy never overwrites: landing on a name already in use would replace
  // something the user did not open.
  if (rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets' | 'settings'>,
    /**
     * Called after this page changes the roster DIRECTORY, so the other
     * surfaces reading the same roster re-read it. A settings field moving is
     * already announced by the host through the forwarded
     * `settings/document-updated`; a directory copied or deleted here is not,
     * and the new-session chip has no other way to learn a preset it should
     * offer now exists.
     */
    private readonly rosterChanged: () => void = () => {},
  ) {}

  private set(patch: Partial<AgentPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private patchCopy(patch: Partial<CopyDraft>): void {
    const { copy } = this.store.getSnapshot()
    if (copy === null) return
    this.set({ copy: { ...copy, ...patch } })
  }

  private async loadFileEntries(reference: AgentPresetReference): Promise<readonly PresetFileDraft[]> {
    const entries: PresetFileDraft[] = []
    let cursor: string | undefined
    do {
      const response = await this.api.agentPresets.editorListFiles({ agentPreset: reference, limit: 1000, ...(cursor === undefined ? {} : { cursor }) })
      if (!response.result.ok) throw new Error(response.result.error.message)
      entries.push(...(response.result.value.entries as readonly Omit<PresetFileDraft, 'reserved'>[]).map(entry => ({
        ...entry,
        reserved: entry.path === 'agent.cordis.yml' || entry.path === 'preset.yml' || entry.path === '.dsh' || entry.path.startsWith('.dsh/'),
      })))
      cursor = response.result.value.nextCursor
      if (entries.length > 10_000) throw new Error('preset file tree exceeds 10,000 entries')
    } while (cursor !== undefined)
    return entries
  }

  /**
   * Open the import wizard over a selected Harness base preset.
   * @param source - optional Harness base preset id.
   */
  beginImport(source?: string): void {
    const rows = this.store.getSnapshot().rows
    const base = source === undefined
      ? rows.find(row => row.isDefault && row.broken === undefined)?.reference ?? rows.find(row => row.broken === undefined)?.reference
      : rows.find(row => row.id === source)?.reference
    if (base === undefined) return
    this.set({ importDraft: { source: base, id: 'imported-preset', name: '', fileName: '', content: '', preview: null, sourceHash: null, saving: false, error: null } })
  }

  /**
   * Parse an uploaded JSON document through the Host preview endpoint.
   * @param fileName - browser-provided file name for the draft.
   * @param content - UTF-8 JSON content selected by the user.
   */
  async previewImport(fileName: string, content: string): Promise<void> {
    const draft = this.store.getSnapshot().importDraft
    if (draft === null) return
    this.set({ importDraft: { ...draft, fileName, content, preview: null, sourceHash: null, error: null } })
    const response = await this.api.agentPresets.importPreview({ content })
    if (!response.result.ok) {
      this.set({ importDraft: { ...this.store.getSnapshot().importDraft!, error: response.result.error.message, preview: null } })
      return
    }
    this.set({ importDraft: { ...this.store.getSnapshot().importDraft!, preview: response.result.value.preview as ImportPreview, sourceHash: response.result.value.sourceHash } })
  }

  /**
   * Update import identity fields.
   * @param patch - changed id or display name.
   */
  patchImport(patch: { id?: string; name?: string; source?: string }): void {
    const draft = this.store.getSnapshot().importDraft
    if (draft === null) return
    const source = patch.source === undefined
      ? draft.source
      : this.store.getSnapshot().rows.find(row => row.id === patch.source)?.reference ?? draft.source
    this.set({ importDraft: { ...draft, ...patch, source, error: null } })
  }

  /**
   * Toggle one converted prompt before the import is committed.
   * @param id - stable prompt identifier.
   */
  toggleImportPrompt(id: string): void {
    const draft = this.store.getSnapshot().importDraft
    if (draft === null || draft.preview === null) return
    this.set({ importDraft: {
      ...draft,
      preview: {
        ...draft.preview,
        prompts: draft.preview.prompts.map(prompt => prompt.id === id ? { ...prompt, enabled: !prompt.enabled } : prompt),
      },
    } })
  }

  /**
   * Toggle one converted regex before the import is committed.
   * @param id - stable regex identifier.
   */
  toggleImportRegex(id: string): void {
    const draft = this.store.getSnapshot().importDraft
    if (draft === null || draft.preview === null) return
    this.set({ importDraft: {
      ...draft,
      preview: {
        ...draft.preview,
        regexes: draft.preview.regexes.map(regex => regex.id === id ? { ...regex, disabled: !regex.disabled } : regex),
      },
    } })
  }

  /** Close the import wizard without touching the preset directory. */
  cancelImport(): void { this.set({ importDraft: null }) }

  /** Commit the validated source as a new custom preset. */
  async confirmImport(): Promise<void> {
    const draft = this.store.getSnapshot().importDraft
    if (draft === null || draft.preview === null || draft.sourceHash === null || draft.id === '') return
    this.set({ importDraft: { ...draft, saving: true, error: null } })
    const response = await this.api.agentPresets.importCreate({
      source: draft.source, agentPreset: draft.id, content: draft.content, expectedHash: draft.sourceHash,
      ...(draft.name === '' ? {} : { name: draft.name }),
    })
    if (!response.result.ok) {
      this.set({ importDraft: { ...this.store.getSnapshot().importDraft!, saving: false, error: response.result.error.message } })
      return
    }
    this.set({ importDraft: null })
    this.rosterChanged()
    await this.load()
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the section
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const roster = await beginRosterRead(this.api, this.store)
    if (roster === undefined) return
    const { presets, authorable, hasDocument } = roster
    if (presets.length === 0) {
      // Nothing to manage leaves nothing to keep a dialog open over.
      this.set({ status: 'unavailable', rows: [], authorable, hasDocument, copy: null, view: null })
      return
    }
    // A reveal outlives a reload but not its preset: a path for a row the
    // roster no longer lists would be a claim about a directory that is gone.
    const revealed = this.store.getSnapshot().revealedPaths
    const kept = Object.fromEntries(
      Object.entries(revealed).filter(([id]) => presets.some(preset => preset.id === id)))
    this.set({
      status: 'ready',
      error: null,
      authorable,
      hasDocument,
      rows: presets.map(preset => ({ ...preset })),
      revealedPaths: kept,
    })
  }

  /**
   * Open one shipped preset's composition in the read-only viewer.
   * @param id - the preset to view.
   * @returns once the composition loaded or the failure is on the page.
   */
  async view(id: string): Promise<void> {
    this.set({ error: null })
    try {
      const reference = this.store.getSnapshot().rows.find(row => row.id === id)?.reference
      if (reference === undefined) return
      const response = await this.api.agentPresets.read({ agentPreset: reference })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const { name, content } = response.result.value
      this.set({ view: { id, title: name ?? id, content } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close the read-only viewer. */
  closeView(): void {
    this.set({ view: null })
  }

  /**
   * Open a system or custom preset in the studio.
   * @param id - preset id to open.
   */
  async openEditor(id: string): Promise<void> {
    this.set({ error: null })
    try {
      const reference = this.store.getSnapshot().rows.find(row => row.id === id)?.reference
      if (reference === undefined) return
      const response = await this.api.agentPresets.editorOpen({ agentPreset: reference })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      const document = response.result.value
      let compositionRows: readonly CompositionRow[] = []
      try {
        compositionRows = readCompositionRows(document.composition)
      } catch {
        // The source editor remains available for malformed or advanced YAML.
      }
      let files: readonly PresetFileDraft[] = []
      try {
        files = await this.loadFileEntries(document.agentPreset)
      } catch {
        // Older hosts can still open the metadata editor without file-tree data.
      }
      this.set({
        editor: {
          id: document.agentPreset.id as string,
          reference: document.agentPreset,
          trust: document.trust,
          name: document.name ?? document.agentPreset.id as string,
          description: document.description ?? '',
          composition: document.composition,
          compositionRows,
          files,
          fileOperations: [],
          selectedFile: null,
          fileContents: {},
          fileBinaries: {},
          dirty: false,
          saving: false,
          error: null,
        },
      })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /** Close an editor draft without persisting it. */
  closeEditor(): void {
    this.set({ editor: null })
  }

  /**
   * Apply one local editor change.
   * @param patch - changed editor fields.
   */
  patchEditor(patch: Partial<Pick<PresetEditorDraft, 'name' | 'description' | 'composition'>>): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.saving || editor.trust !== 'user') return
    const composition = patch.composition ?? editor.composition
    let compositionRows = editor.compositionRows
    try {
      compositionRows = readCompositionRows(composition)
    } catch {
      compositionRows = []
    }
    this.set({ editor: { ...editor, ...patch, composition, compositionRows, dirty: true, error: null } })
  }

  /**
   * Toggle a plugin row in the visual composition tree.
   * @param path - YAML row path.
   */
  toggleCompositionRow(path: readonly CompositionPath[]): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    const row = findCompositionRow(editor.compositionRows, path)
    if (row === undefined) return
    this.patchEditor({ composition: setCompositionDisabled(editor.composition, path, !row.disabled) })
  }

  /**
   * Move a plugin row within or across groups.
   * @param path - source path.
   * @param toIndex - destination index.
   * @param targetParent - destination sequence path.
   */
  moveCompositionRow(path: readonly CompositionPath[], toIndex: number, targetParent?: readonly CompositionPath[]): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    this.patchEditor({ composition: moveCompositionRow(editor.composition, path, toIndex, targetParent) })
  }

  /**
   * Add a plugin or group row to a selected group.
   * @param row - new row identity.
   * @param parent - group row path.
   */
  addCompositionRow(row: { id: string; name: string; group?: boolean }, parent: readonly CompositionPath[] = []): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    try {
      const target = parent.length === 0 ? parent : [...parent, 'config']
      this.patchEditor({ composition: addCompositionRow(editor.composition, row, target) })
    } catch (error) {
      this.set({ editor: { ...editor, error: messageOf(error) } })
    }
  }

  /**
   * Delete a plugin or group row from the composition.
   * @param path - YAML row path.
   */
  deleteCompositionRow(path: readonly CompositionPath[]): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    this.patchEditor({ composition: deleteCompositionRow(editor.composition, path) })
  }

  /**
   * Select a file and load its bounded text representation when needed.
   * @param path - relative file path.
   */
  async selectFile(path: string): Promise<void> {
    const editor = this.store.getSnapshot().editor
    if (editor === null) return
    this.set({ editor: { ...editor, selectedFile: path, error: null } })
    const file = editor.files.find(candidate => candidate.path === path)
    if (file?.type !== 'file' || editor.fileContents[path] !== undefined) return
    try {
      const response = await this.api.agentPresets.editorReadFile({ agentPreset: editor.reference, path })
      if (!response.result.ok) {
        this.set({ editor: { ...this.store.getSnapshot().editor!, error: response.result.error.message } })
        return
      }
      const value = response.result.value
      if (value.kind === 'text') {
        this.set({ editor: { ...this.store.getSnapshot().editor!, fileContents: { ...this.store.getSnapshot().editor!.fileContents, [path]: value.content } } })
      } else {
        this.set({ editor: { ...this.store.getSnapshot().editor!, fileBinaries: { ...this.store.getSnapshot().editor!.fileBinaries, [path]: value.base64 } } })
      }
    } catch (error) {
      this.set({ editor: { ...this.store.getSnapshot().editor!, error: messageOf(error) } })
    }
  }

  /**
   * Edit a loaded UTF-8 file and queue a write operation.
   * @param path - relative file path.
   * @param content - new UTF-8 text.
   */
  patchFileText(path: string, content: string): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    const operations = replaceFileOperation(editor.fileOperations, { kind: 'write-text', path, content })
    this.set({ editor: { ...editor, fileContents: { ...editor.fileContents, [path]: content }, fileOperations: operations, dirty: true, error: null } })
  }

  /**
   * Create a file or directory in the file tree.
   * @param path - relative path.
   * @param directory - create a directory when true.
   */
  createFile(path: string, directory = false): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    const operation: PresetFileOperation = directory ? { kind: 'mkdir', path } : { kind: 'write-text', path, content: '' }
    this.set({ editor: { ...editor, fileOperations: [...editor.fileOperations, operation], dirty: true, error: null } })
  }

  /**
   * Queue a browser upload as a bounded Base64 file operation.
   * @param path - target relative path.
   * @param file - browser file.
   */
  async uploadFile(path: string, file: File): Promise<void> {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > 16 * 1024 * 1024) {
      this.set({ editor: { ...editor, error: 'Uploaded files are limited to 16 MiB.' } })
      return
    }
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const base64 = btoa(binary)
    this.set({ editor: { ...editor, fileOperations: [...editor.fileOperations, { kind: 'write-base64', path, base64 }], dirty: true, error: null } })
  }

  /**
   * Download one bounded file through the browser without executing it.
   * @param path - relative file path.
   */
  async downloadFile(path: string): Promise<void> {
    const editor = this.store.getSnapshot().editor
    if (editor === null) return
    const response = await this.api.agentPresets.editorReadFile({ agentPreset: editor.reference, path })
    if (!response.result.ok) {
      this.set({ editor: { ...editor, error: response.result.error.message } })
      return
    }
    const value = response.result.value
    const href = value.kind === 'text'
      ? URL.createObjectURL(new Blob([value.content], { type: 'text/plain;charset=utf-8' }))
      : `data:application/octet-stream;base64,${value.base64}`
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = path.split('/').pop() ?? 'download'
    anchor.click()
    if (value.kind === 'text') URL.revokeObjectURL(href)
  }

  /**
   * Rename a non-reserved file or directory.
   * @param from - existing relative path.
   * @param to - destination relative path.
   */
  renameFile(from: string, to: string): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    if (editor.files.find(file => file.path === from)?.reserved === true) return
    this.set({ editor: { ...editor, fileOperations: [...editor.fileOperations, { kind: 'rename', path: from, target: to }], selectedFile: editor.selectedFile === from ? to : editor.selectedFile, dirty: true, error: null } })
  }

  /**
   * Delete a non-reserved file or directory.
   * @param path - relative path.
   */
  deleteFile(path: string): void {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.trust !== 'user' || editor.saving) return
    if (editor.files.find(file => file.path === path)?.reserved === true) return
    this.set({ editor: { ...editor, fileOperations: [...editor.fileOperations, { kind: 'delete', path }], selectedFile: editor.selectedFile === path ? null : editor.selectedFile, dirty: true, error: null } })
  }

  /** Run one draft regex through the loopback Host worker. */
  async testRegex(entry: RegexTestEntry, text: string): Promise<RegexTestResult> {
    const editor = this.store.getSnapshot().editor
    if (editor === null) throw new Error('no preset editor is open')
    const response = await this.api.agentPresets.editorTestRegex({ agentPreset: editor.reference, entry, text })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value
  }

  /** Save the opened custom preset with its opening revision as the lock token. */
  async saveEditor(): Promise<void> {
    const editor = this.store.getSnapshot().editor
    if (editor === null || editor.saving || editor.trust !== 'user') return
    this.set({ editor: { ...editor, saving: true, error: null } })
    try {
      const response = await this.api.agentPresets.editorSave({
        agentPreset: editor.reference,
        composition: editor.composition,
        name: editor.name.trim(),
        description: editor.description.trim(),
        files: editor.fileOperations,
      })
      if (!response.result.ok) {
        this.set({ editor: { ...editor, saving: false, error: response.result.error.message } })
        return
      }
      let files = editor.files
      try {
        files = await this.loadFileEntries(response.result.value.agentPreset)
      } catch {
        // Keep the previous tree when a legacy host has no file endpoint.
      }
      this.set({ editor: { ...editor, reference: response.result.value.agentPreset, saving: false, error: null, fileOperations: [], files, dirty: false } })
      await this.load()
      this.rosterChanged()
    } catch (error) {
      this.set({ editor: { ...editor, saving: false, error: messageOf(error) } })
    }
  }

  /**
   * Open the copy dialog over one preset.
   * @param from - the preset the copy will start from.
   */
  beginCopy(from: string): void {
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === from)
    this.set({
      error: null,
      copy: { from: row?.reference ?? null, fromTitle: row?.name ?? from, id: '', name: '', saving: false, error: null },
    })
  }

  /** Open the creation dialog for an empty preset. */
  beginBlank(): void {
    this.set({
      error: null,
      copy: { from: null, fromTitle: '', id: '', name: '', saving: false, error: null },
    })
  }

  /** Close the copy dialog, discarding whatever was typed. */
  cancelCopy(): void {
    this.set({ copy: null })
  }

  /**
   * Name the preset the copy creates.
   * @param id - the id typed into the dialog.
   */
  setCopyId(id: string): void {
    this.patchCopy({ id, error: null })
  }

  /**
   * Name the copy's display name.
   * @param name - the display name typed into the dialog.
   */
  setCopyName(name: string): void {
    this.patchCopy({ name, error: null })
  }

  /**
   * Submit the copy, re-read the roster, then take the user to the new
   * preset's files — the directory opens where the host has a desktop, and
   * its path appears on the new row where it does not.
   * @returns once the copy settled and the page reflects it.
   */
  async confirmCopy(): Promise<void> {
    const draft = this.store.getSnapshot().copy
    if (draft === null || draft.saving) return
    if (draftBlocker(draft, this.store.getSnapshot().rows) !== undefined) return
    this.patchCopy({ saving: true, error: null })
    try {
      const name = draft.name.trim()
      const response = draft.from === null
        ? await this.api.agentPresets.create({ agentPreset: draft.id, ...name === '' ? {} : { name } })
        : await this.api.agentPresets.create({
          source: draft.from,
          agentPreset: draft.id,
          ...name === '' ? {} : { name },
        })
      if (!response.result.ok) {
        this.patchCopy({ saving: false, error: response.result.error.message })
        return
      }
      this.set({ copy: null })
      await this.load()
      this.rosterChanged()
      // A preset is its files from here on (the dialog collected nothing
      // else), so landing in them is the completion, not a follow-up.
      await this.openLocation(draft.id)
    } catch (error) {
      this.patchCopy({ saving: false, error: messageOf(error) })
    }
  }

  /**
   * Open one preset's directory on the host desktop, or reveal its path on
   * the row where the deployment has no opener to hand it to.
   * @param id - the preset whose files the user wants.
   * @returns once the host answered and the page reflects it.
   */
  async openLocation(id: string): Promise<void> {
    try {
      const reference = this.store.getSnapshot().rows.find(row => row.id === id)?.reference
      if (reference === undefined) return
      const response = await this.api.agentPresets.openDocument({ agentPreset: reference })
      if (!response.result.ok) {
        this.set({ error: response.result.error.message })
        return
      }
      if (response.result.value.opened) return
      const { path } = response.result.value
      this.set({ revealedPaths: { ...this.store.getSnapshot().revealedPaths, [id]: path } })
    } catch (error) {
      this.set({ error: messageOf(error) })
    }
  }

  /**
   * Ask for confirmation before deleting one preset.
   * @param id - the preset to delete, or null to dismiss the confirmation.
   */
  confirmDelete(id: string | null): void {
    if (this.store.getSnapshot().deleting) return
    this.set({ pendingDelete: id })
  }

  /**
   * Delete the preset awaiting confirmation, then re-read the roster.
   *
   * A session already composed from it keeps running: its composition was
   * mounted at creation and nothing re-reads the file.
   * @returns once the delete settled and the page reflects it.
   */
  async remove(): Promise<void> {
    const { pendingDelete, deleting } = this.store.getSnapshot()
    if (pendingDelete === null || deleting) return
    this.set({ deleting: true, error: null })
    try {
      const reference = this.store.getSnapshot().rows.find(row => row.id === pendingDelete)?.reference
      if (reference === undefined) return
      const response = await this.api.agentPresets.remove({ agentPreset: reference })
      if (!response.result.ok) {
        this.set({ deleting: false, pendingDelete: null, error: response.result.error.message })
        return
      }
      this.set({ deleting: false, pendingDelete: null })
      await this.load()
      this.rosterChanged()
    } catch (error) {
      this.set({ deleting: false, pendingDelete: null, error: messageOf(error) })
    }
  }

  /**
   * Make one preset the default for sessions created later. Running sessions
   * keep the composition they began with, so this never disturbs work.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async makeDefault(id: string): Promise<void> {
    const failure = await writeDefaultPreset(this.api, id)
    if (failure !== undefined) {
      this.set({ error: failure })
      return
    }
    await this.load()
  }
}
