/**
 * Agent-presets settings section: the roster as cards, a copy dialog as the
 * only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text — a shipped preset opens read-only to
 * be READ (it is the known-good composition a copy starts from), and a custom
 * preset is edited in its own files, which is what the location action leads
 * to. Deleting a preset leaves running sessions alone: a composition is
 * mounted once at session creation and nothing re-reads the file.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftBlocker, type AgentPresetSectionState, type PresetEditorDraft, type RegexTestEntry, type RegexTestResult } from './section-store.ts'
import {
  addProgramEntry, deleteProgramEntry, moveProgramEntry, readProgramRows, setProgramEntryBoolean, setProgramEntryValue,
  type CompositionPath, type CompositionRow,
} from './composition.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Registration-side business face for the management section. */
export interface AgentPresetSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentPresetSection. */
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  /** Open one shipped preset's composition in the read-only viewer. */
  view: (id: string) => Promise<void>
  /** Close the read-only viewer. */
  closeView: () => void
  /** Open the visual editor for one preset. */
  openEditor: (id: string) => Promise<void>
  /** Close the current visual editor without saving. */
  closeEditor: () => void
  /** Update one local visual-editor field. */
  patchEditor: (patch: { name?: string; description?: string; composition?: string }) => void
  /** Toggle, move, add, or remove a row in the composition tree. */
  toggleCompositionRow: (path: readonly CompositionPath[]) => void
  moveCompositionRow: (path: readonly CompositionPath[], toIndex: number, targetParent?: readonly CompositionPath[]) => void
  addCompositionRow: (row: { id: string; name: string; group?: boolean }, parent?: readonly CompositionPath[]) => void
  deleteCompositionRow: (path: readonly CompositionPath[]) => void
  /** Select and edit files in the preset directory. */
  selectFile: (path: string) => Promise<void>
  patchFileText: (path: string, content: string) => void
  uploadFile: (path: string, file: File) => Promise<void>
  downloadFile: (path: string) => Promise<void>
  createFile: (path: string, directory?: boolean) => void
  renameFile: (from: string, to: string) => void
  deleteFile: (path: string) => void
  /** Run a draft regex through the Host worker. */
  testRegex: (entry: RegexTestEntry, text: string) => Promise<RegexTestResult>
  /** Save the current custom preset draft. */
  saveEditor: () => Promise<void>
  /** Open the copy dialog over one preset. */
  beginCopy: (from: string) => void
  /** Open the creation dialog for an empty preset. */
  beginBlank: () => void
  /** Close the copy dialog, discarding the draft. */
  cancelCopy: () => void
  /** Name the preset the copy creates. */
  setCopyId: (id: string) => void
  /** Name the copy's display name. */
  setCopyName: (name: string) => void
  /** Submit the copy. */
  confirmCopy: () => Promise<void>
  /** Open the SillyTavern import wizard. */
  beginImport: (source?: string) => void
  /** Preview one selected JSON file through the host. */
  previewImport: (fileName: string, content: string) => Promise<void>
  /** Close the import wizard. */
  cancelImport: () => void
  /** Edit import identity fields. */
  patchImport: (patch: { id?: string; name?: string; source?: string }) => void
  /** Toggle a converted prompt item before import. */
  toggleImportPrompt: (id: string) => void
  /** Toggle a converted regex item before import. */
  toggleImportRegex: (id: string) => void
  /** Create the imported custom preset. */
  confirmImport: () => Promise<void>
  /** Open one preset's directory, or reveal its path where there is no desktop. */
  openLocation: (id: string) => Promise<void>
  /**
   * Stage the self-referential preset and start a new session on it — the
   * guided way to author a preset, beside copying. Absent when the surface
   * is composed without the conversation flow to land the session in.
   */
  startCreatorDraft?: () => void
  /** Ask for delete confirmation, or dismiss it with null. */
  confirmDelete: (id: string | null) => void
  /** Delete the preset awaiting confirmation. */
  remove: () => Promise<void>
  /** Make one preset the default for sessions created later. */
  makeDefault: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSectionInjected>

/** Copy-dialog sub-view props: the draft plus the actions that mutate it. */
interface CopyDialogProps {
  state: AgentPresetSectionState
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected,
    'cancelCopy' | 'confirmCopy' | 'setCopyId' | 'setCopyName'>
}

function CopyDialog({ state, t, actions }: CopyDialogProps): ReactNode {
  const draft = state.copy
  const blocker = draft === null ? undefined : draftBlocker(draft, state.rows)
  const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker))
  const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from?.id)
  const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name
  return (
    <Modal
      open={draft !== null}
      onClose={() => { actions.cancelCopy() }}
      title={draft === null ? t('copyTitle') : draft.from === null ? t('newBlank') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`}
      closeLabel={t('close')}
      description={t('copyIntro')}
      className={css.dialog as string}
      footer={(
        <>
          <Button
            variant="outline"
            disabled={draft?.saving === true}
            onClick={() => { actions.cancelCopy() }}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={draft === null || draft.saving || blocker !== undefined}
            onClick={() => { void actions.confirmCopy() }}
          >
            {draft?.saving === true ? t('creating') : t('create')}
          </Button>
        </>
      )}
    >
      {draft === null
        ? null
        : (
          <div className={css.dialogFields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('presetId')}</span>
              <input
                className={css.input}
                value={draft.id}
                autoFocus
                spellCheck={false}
                placeholder={t('presetIdPlaceholder')}
                onChange={(event) => { actions.setCopyId(event.target.value) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('displayName')}</span>
              <input
                className={css.input}
                value={draft.name}
                spellCheck={false}
                placeholder={t('displayNamePlaceholder')}
                onChange={(event) => { actions.setCopyName(event.target.value) }}
              />
            </label>
            {message === null ? null : <p className={css.error} role="alert">{message}</p>}
          </div>
        )}
    </Modal>
  )
}

/** Import-dialog sub-view props. */
interface ImportDialogProps {
  state: AgentPresetSectionState
  t: (key: AgentPresetSettingsKey) => string
  rows: AgentPresetSectionState['rows']
  actions: Pick<AgentPresetSectionInjected,
    'cancelImport' | 'confirmImport' | 'previewImport' | 'patchImport' | 'toggleImportPrompt' | 'toggleImportRegex'>
}

function ImportDialog({ state, t, rows, actions }: ImportDialogProps): ReactNode {
  const draft = state.importDraft
  const idError = draft === null || draft.id === ''
    ? draft === null ? null : t('idRequired')
    : !/^[a-z0-9][a-z0-9-]*$/.test(draft.id)
      ? t('idInvalid')
      : rows.some(row => row.id === draft.id) ? t('idTaken') : null
  const canSubmit = draft !== null && draft.preview !== null && idError === null && !draft.saving
  return (
    <Modal
      open={draft !== null}
      onClose={() => { actions.cancelImport() }}
      title={t('importTitle')}
      closeLabel={t('close')}
      description={t('importIntro')}
      className={css.dialog as string}
      footer={(
        <>
          <Button variant="outline" disabled={draft?.saving === true} onClick={() => { actions.cancelImport() }}>
            {t('cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => { void actions.confirmImport() }}>
            {draft?.saving === true ? t('creating') : t('importNow')}
          </Button>
        </>
      )}
    >
      {draft === null ? null : (
        <div className={css.dialogFields}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('presetId')}</span>
            <input
              className={css.input}
              value={draft.id}
              autoFocus
              spellCheck={false}
              onChange={(event) => { actions.patchImport({ id: event.target.value }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('importBase')}</span>
            <select
              className={css.input}
              value={draft.source.id}
              disabled={draft.saving}
              onChange={(event) => { actions.patchImport({ source: event.target.value }) }}
            >
              {rows.filter(row => row.broken === undefined).map(row => (
                <option key={row.id} value={row.id}>{row.name ?? row.id}</option>
              ))}
            </select>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('displayName')}</span>
            <input
              className={css.input}
              value={draft.name}
              disabled={draft.saving}
              onChange={(event) => { actions.patchImport({ name: event.target.value }) }}
            />
          </label>
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('chooseFile')}</span>
            <input
              className={css.input}
              type="file"
              accept="application/json,.json"
              disabled={draft.saving}
              aria-label={t('chooseFile')}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file === undefined) return
                void file.text()
                  .then(content => actions.previewImport(file.name, content))
                  .catch(() => actions.previewImport(file.name, ''))
              }}
            />
            {draft.fileName === '' ? null : <code className={css.cardId}>{draft.fileName}</code>}
          </div>
          {idError === null ? null : <p className={css.error} role="alert">{idError}</p>}
          {draft.error === null ? null : <p className={css.error} role="alert">{draft.error}</p>}
          <p className={css.intro}>{t('importRuntimeNote')}</p>
          {draft.preview === null
            ? <p className={css.intro}>{t('importNeedsFile')}</p>
            : (
              <div className={css.dialogFields}>
                <p className={css.editorIdentity}>
                  <strong>{draft.preview.kind}</strong> · {draft.preview.prompts.length} prompts · {draft.preview.regexes.length} regexes
                </p>
                {draft.preview.prompts.length === 0 ? null : (
                  <div>
                    <h3 className={css.fieldLabel}>{t('promptEntries')}</h3>
                    <ul className={css.cards}>
                      {draft.preview.prompts.map(prompt => (
                        <li key={prompt.id} className={css.card}>
                          <label className={css.cardMain}>
                            <span className={css.cardHead}>
                              <input
                                type="checkbox"
                                checked={prompt.enabled}
                                onChange={() => { actions.toggleImportPrompt(prompt.id) }}
                              />
                              <strong>{prompt.name}</strong>
                              <code>{prompt.role}</code>
                            </span>
                            <span className={css.cardDesc}>{prompt.content}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {draft.preview.regexes.length === 0 ? null : (
                  <div>
                    <h3 className={css.fieldLabel}>{t('regexEntries')}</h3>
                    <ul className={css.cards}>
                      {draft.preview.regexes.map(regex => (
                        <li key={regex.id} className={css.card}>
                          <label className={css.cardMain}>
                            <span className={css.cardHead}>
                              <input
                                type="checkbox"
                                checked={!regex.disabled}
                                onChange={() => { actions.toggleImportRegex(regex.id) }}
                              />
                              <strong>{regex.name}</strong>
                            </span>
                            <span className={css.cardDesc}>{regex.find} → {regex.replace}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <h3 className={css.fieldLabel}>{t('importReport')}</h3>
                  {draft.preview.issues.length === 0
                    ? <p className={css.intro}>{t('saved')}</p>
                    : <ul className={css.cards}>
                      {draft.preview.issues.map((issue, index) => (
                        <li key={`${issue.subject}-${String(index)}`} className={css.card}>
                          <div className={css.cardMain}>
                            <span className={css.cardHead}><strong>{issue.disposition}</strong><code>{issue.subject}</code></span>
                            <span className={css.cardDesc}>{issue.message}</span>
                          </div>
                        </li>
                      ))}
                    </ul>}
                </div>
              </div>
            )}
        </div>
      )}
    </Modal>
  )
}

/**
 * Render one card's description, clamped by CSS and offered in full on hover.
 * The tooltip is attached only while the text is actually cut off, so a short
 * description does not answer a hover with a bubble repeating the card.
 * @param props.text - the description as rendered, already localized.
 * @returns the description element, tooltip-anchored while it overflows.
 */
function CardDescription({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (el === null) return
    const measure = () => { setTruncated(el.scrollHeight > el.clientHeight) }
    measure()
    // Card width follows the settings pane, which resizes with the window.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [text])
  return (
    // Capped near the card's own width: the default half-viewport bubble would
    // spill a description out of the settings dialog and across the app behind it.
    <Tooltip label={text} side="bottom" delayMs={400} disabled={!truncated} maxWidth={360}>
      {/* The empty title stops the card body's native tooltip from climbing to
        this span: a cut-off description answers with one bubble, not two. */}
      <span ref={ref} className={css.cardDesc} title="">{text}</span>
    </Tooltip>
  )
}

interface CompositionEditorProps {
  rows: readonly CompositionRow[]
  readOnly: boolean
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected, 'toggleCompositionRow' | 'moveCompositionRow' | 'addCompositionRow' | 'deleteCompositionRow'>
}

function CompositionEditor({ rows, readOnly, t, actions }: CompositionEditorProps): ReactNode {
  const renderRows = (items: typeof rows, depth = 0): ReactNode => (
    <ul className={css.cards} style={{ marginLeft: depth * 16 }}>
      {items.map((row, index) => (
        <li key={row.path.join('.')} className={css.card}>
          <div
            className={css.cardMain}
            draggable={!readOnly}
            onDragStart={(event) => { event.dataTransfer.setData('application/x-dsh-composition-path', JSON.stringify(row.path)) }}
            onDragOver={(event) => { event.preventDefault() }}
            onDrop={(event) => {
              event.preventDefault()
              try {
                const raw = event.dataTransfer.getData('application/x-dsh-composition-path')
                const from = JSON.parse(raw) as CompositionPath[]
                actions.moveCompositionRow(from, index, row.path.slice(0, -1))
              } catch {
                // Ignore drops that were not created by this tree.
              }
            }}
          >
            <span className={css.cardHead}>
              <input
                type="checkbox"
                checked={!row.disabled}
                disabled={readOnly || row.conditionalDisabled}
                aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.name || row.id}`}
                onChange={() => { actions.toggleCompositionRow(row.path) }}
              />
              <strong>{row.id || row.name || '(unnamed)'}</strong>
              <code>{row.name}</code>
              {row.group ? <span className={css.badge}>{t('compositionTree')}</span> : null}
              {row.disabled ? <span className={css.brokenBadge}>disabled</span> : null}
              {row.conditionalDisabled ? <span className={css.badge}>conditional</span> : null}
            </span>
          </div>
          <div className={css.cardFoot}>
            <button type="button" className={css.iconButton} disabled={readOnly || index === 0} onClick={() => { actions.moveCompositionRow(row.path, index - 1) }} aria-label={t('up')}>{t('up')}</button>
            <button type="button" className={css.iconButton} disabled={readOnly || index === items.length - 1} onClick={() => { actions.moveCompositionRow(row.path, index + 1) }} aria-label={t('down')}>{t('down')}</button>
            {row.group
              ? <button type="button" className={css.iconButton} disabled={readOnly} onClick={() => {
                const id = window.prompt('Plugin id', 'new-plugin')
                const name = id === null ? null : window.prompt('Module name', id)
                if (id !== null && name !== null && id.trim() !== '' && name.trim() !== '') actions.addCompositionRow({ id: id.trim(), name: name.trim() }, row.path)
              }}>{t('addPlugin')}</button>
              : null}
            <button type="button" className={`${css.iconButton} ${css.iconDanger}`} disabled={readOnly} onClick={() => { actions.deleteCompositionRow(row.path) }}>{t('delete')}</button>
          </div>
          {row.children.length === 0 ? null : renderRows(row.children, depth + 1)}
        </li>
      ))}
    </ul>
  )
  return (
    <section className={css.editorPanel}>
      <div className={css.cardFoot}>
        <strong>{t('compositionTree')}</strong>
        <span>
          <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={() => {
            const id = window.prompt('Plugin id', 'new-plugin')
            const name = id === null ? null : window.prompt('Module name', id)
            if (id !== null && name !== null && id.trim() !== '' && name.trim() !== '') actions.addCompositionRow({ id: id.trim(), name: name.trim() })
          }}>{t('addPlugin')}</button>
          <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={() => {
            const id = window.prompt('Group id', 'group')
            const name = id === null ? null : window.prompt('Group module', 'cordis:group')
            if (id !== null && name !== null && id.trim() !== '' && name.trim() !== '') actions.addCompositionRow({ id: id.trim(), name: name.trim(), group: true })
          }}>{t('addGroup')}</button>
        </span>
      </div>
      {rows.length === 0 ? <p className={css.intro}>{t('composition')}</p> : renderRows(rows)}
    </section>
  )
}

interface FileEditorProps {
  editor: NonNullable<AgentPresetSectionState['editor']>
  readOnly: boolean
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected, 'selectFile' | 'patchFileText' | 'uploadFile' | 'downloadFile' | 'createFile' | 'renameFile' | 'deleteFile'>
}

function FileEditor({ editor, readOnly, t, actions }: FileEditorProps): ReactNode {
  const selected = editor.selectedFile === null ? undefined : editor.files.find(file => file.path === editor.selectedFile)
  const content = editor.selectedFile === null ? '' : editor.fileContents[editor.selectedFile] ?? ''
  const binary = editor.selectedFile === null ? undefined : editor.fileBinaries[editor.selectedFile]
  const imageType = editor.selectedFile === null ? undefined : imageMime(editor.selectedFile)
  return (
    <section className={css.editorPanel}>
      <div className={css.cardFoot}>
        <strong>{t('files')}</strong>
        <span>
          <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={() => {
            const path = window.prompt('File path', 'notes.txt')
            if (path !== null && path.trim() !== '') actions.createFile(path.trim())
          }}>{t('newFile')}</button>
          <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={() => {
            const path = window.prompt('Directory path', 'assets')
            if (path !== null && path.trim() !== '') actions.createFile(path.trim(), true)
          }}>{t('newDirectory')}</button>
          <label className={css.secondaryButton}>
            {t('importFile')}
            <input type="file" hidden disabled={readOnly} onChange={(event) => {
              const file = event.target.files?.[0]
              if (file === undefined) return
              const path = window.prompt('Upload path', file.name)
              if (path !== null && path.trim() !== '') void actions.uploadFile(path.trim(), file)
            }} />
          </label>
        </span>
      </div>
      <ul className={css.fileTree}>
        {editor.files.map(file => (
          <li key={file.path} className={file.path === editor.selectedFile ? css.fileSelected : undefined}>
            <button type="button" className={css.fileButton} onClick={() => { void actions.selectFile(file.path) }}>
              <span>{file.type === 'directory' ? '📁' : '📄'} {file.path}</span>
              <small>{file.type === 'file' ? `${file.size} B` : ''}</small>
            </button>
            {file.type === 'file' ? <button type="button" className={css.iconButton} disabled={readOnly} onClick={() => { void actions.downloadFile(file.path) }}>{t('view')}</button> : null}
            {file.reserved ? <span className={css.cardId} title={t('reservedFile')}>🔒</span> : (
              <span className={css.fileActions}>
                <button type="button" className={css.iconButton} disabled={readOnly} onClick={() => {
                  const next = window.prompt(t('rename'), file.path)
                  if (next !== null && next.trim() !== '') actions.renameFile(file.path, next.trim())
                }}>{t('rename')}</button>
                <button type="button" className={`${css.iconButton} ${css.iconDanger}`} disabled={readOnly} onClick={() => { actions.deleteFile(file.path) }}>{t('delete')}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {selected?.type !== 'file' || editor.selectedFile === null ? null : (
        binary !== undefined
          ? imageType !== undefined
            ? <img className={css.filePreview} src={`data:${imageType};base64,${binary}`} alt={editor.selectedFile} />
            : <p className={css.intro}>Binary file · {selected.size} bytes</p>
          : <label className={css.field}>
            <span className={css.fieldLabel}>{editor.selectedFile}</span>
            <textarea className={css.editorCode} spellCheck={false} value={content} disabled={readOnly} onChange={(event) => { actions.patchFileText(editor.selectedFile!, event.target.value) }} />
          </label>
      )}
    </section>
  )
}

function imageMime(path: string): string | undefined {
  const extension = path.toLowerCase().split('.').pop()
  return extension === 'png' ? 'image/png'
    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
      : extension === 'gif' ? 'image/gif'
        : extension === 'webp' ? 'image/webp'
          : extension === 'svg' ? 'image/svg+xml'
            : undefined
}

/** Edit prompt- or regex-program entries without asking users to write YAML. */
function ProgramEditor({
  source,
  moduleName,
  pluginId,
  kind,
  readOnly,
  onChange,
  testRegex,
}: {
  source: string
  moduleName: string
  pluginId: string
  kind: 'prompt' | 'regex'
  readOnly: boolean
  onChange: (source: string) => void
  testRegex?: (entry: RegexTestEntry, text: string) => Promise<RegexTestResult>
}): ReactNode {
  const [sample, setSample] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  let rows = [] as ReturnType<typeof readProgramRows>
  try {
    rows = readProgramRows(source, moduleName)
  } catch {
    return <p className={css.error} role="alert">The YAML source must parse before this editor can display entries.</p>
  }
  const entries = rows.flatMap(row => row.entries)
  const add = (): void => {
    const id = `${kind}-${String(entries.length + 1)}`
    const entry = kind === 'prompt'
      ? { id, name: 'New prompt', content: '', role: 'system', position: 'after-history', order: entries.length, enabled: true }
      : { id, name: 'New regex', find: '', replace: '', flags: 'g', order: entries.length, target: 'request', disabled: false }
    onChange(addProgramEntry(source, moduleName, pluginId, entry))
  }
  return (
    <section className={css.editorPanel} aria-label={kind === 'prompt' ? 'Prompt program' : 'Regex program'}>
      <div className={css.studioPanelHead}>
        <div>
          <strong>{kind === 'prompt' ? 'Prompt entries' : 'Regex transforms'}</strong>
          <p>{kind === 'prompt'
            ? 'Entries are added only to the current model request. They never alter the chat transcript.'
            : 'Transforms run in the Host worker. They do not rewrite existing conversation history.'}</p>
        </div>
        <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={add}>Add entry</button>
      </div>
      {rows.length === 0 ? <p className={css.intro}>No program row yet. Add an entry to create one automatically.</p> : null}
      {rows.map(row => (
        <div key={row.path.join('.')} className={css.programGroup}>
          <span className={css.programLabel}>{row.id || pluginId}</span>
          {row.entries.map((entry, index) => {
            const active = kind === 'prompt' ? entry.enabled !== false : entry.disabled !== true
            const set = (field: string, value: string | number): void => onChange(setProgramEntryValue(source, row.path, index, field, value))
            return (
              <article key={`${row.path.join('.')}-${String(index)}`} className={css.programCard}>
                <header>
                  <label className={css.programToggle}>
                    <input
                      type="checkbox"
                      checked={active}
                      disabled={readOnly}
                      onChange={() => onChange(setProgramEntryBoolean(source, row.path, index, kind === 'prompt' ? 'enabled' : 'disabled', kind === 'prompt' ? !active : active))}
                    />
                    {active ? 'Enabled' : 'Disabled'}
                  </label>
                  <div className={css.programActions}>
                    <button type="button" className={css.iconButton} disabled={readOnly || index === 0} onClick={() => onChange(moveProgramEntry(source, row.path, index, index - 1))}>↑</button>
                    <button type="button" className={css.iconButton} disabled={readOnly || index === row.entries.length - 1} onClick={() => onChange(moveProgramEntry(source, row.path, index, index + 1))}>↓</button>
                    <button type="button" className={`${css.iconButton} ${css.iconDanger}`} disabled={readOnly} onClick={() => onChange(deleteProgramEntry(source, row.path, index))}>×</button>
                  </div>
                </header>
                <label className={css.field}>
                  <span className={css.fieldLabel}>Name</span>
                  <input className={css.input} disabled={readOnly} value={String(entry.name ?? '')} onChange={event => set('name', event.target.value)} />
                </label>
                {kind === 'prompt'
                  ? <>
                    <div className={css.programGrid}>
                      <label className={css.field}><span className={css.fieldLabel}>Role</span><select className={css.input} disabled={readOnly} value={String(entry.role ?? 'system')} onChange={event => set('role', event.target.value)}><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                      <label className={css.field}><span className={css.fieldLabel}>Position</span><select className={css.input} disabled={readOnly} value={String(entry.position ?? 'after-history')} onChange={event => set('position', event.target.value)}><option value="before-history">Before history</option><option value="after-history">After history</option><option value="depth">At depth</option></select></label>
                    </div>
                    <label className={css.field}><span className={css.fieldLabel}>Content</span><textarea className={css.editorDescription} disabled={readOnly} value={String(entry.content ?? '')} onChange={event => set('content', event.target.value)} /></label>
                  </>
                  : <>
                    <div className={css.programGrid}>
                      <label className={css.field}><span className={css.fieldLabel}>Find</span><input className={css.input} disabled={readOnly} value={String(entry.find ?? '')} onChange={event => set('find', event.target.value)} /></label>
                      <label className={css.field}><span className={css.fieldLabel}>Flags</span><input className={css.input} disabled={readOnly} value={String(entry.flags ?? 'g')} onChange={event => set('flags', event.target.value)} /></label>
                    </div>
                    <label className={css.field}><span className={css.fieldLabel}>Replace</span><input className={css.input} disabled={readOnly} value={String(entry.replace ?? '')} onChange={event => set('replace', event.target.value)} /></label>
                    {testRegex === undefined ? null : <div className={css.regexTest}>
                      <label className={css.field}><span className={css.fieldLabel}>Test text</span><textarea className={css.editorDescription} value={sample} disabled={readOnly} onChange={event => setSample(event.target.value)} /></label>
                      <button type="button" className={css.secondaryButton} disabled={readOnly} onClick={() => {
                        void testRegex(entry as unknown as RegexTestEntry, sample).then((result) => {
                          setTestResult(`${result.output}\nCaptures: ${result.captures.join(', ') || '(none)'} · ${result.elapsedMs.toFixed(1)} ms`)
                        }).catch((error) => { setTestResult(error instanceof Error ? error.message : String(error)) })
                      }}>Test in Host</button>
                      {testResult === null ? null : <pre className={css.regexResult}>{testResult}</pre>}
                    </div>}
                  </>}
              </article>
            )
          })}
        </div>
      ))}
    </section>
  )
}

/** Full-page preset studio that keeps the roster, navigation, and save state visible. */
function PresetStudio({
  state,
  editor,
  t,
  actions,
}: {
  state: AgentPresetSectionState
  editor: PresetEditorDraft
  t: (key: AgentPresetSettingsKey) => string
  actions: Pick<AgentPresetSectionInjected, 'closeEditor' | 'openEditor' | 'patchEditor' | 'saveEditor' | 'beginCopy' | 'toggleCompositionRow' | 'moveCompositionRow' | 'addCompositionRow' | 'deleteCompositionRow' | 'selectFile' | 'patchFileText' | 'uploadFile' | 'downloadFile' | 'createFile' | 'renameFile' | 'deleteFile' | 'testRegex'>
}): ReactNode {
  const [tab, setTab] = useState<'overview' | 'composition' | 'prompts' | 'regexes' | 'files' | 'source'>('overview')
  useEffect(() => { setTab('overview') }, [editor.reference.revision])
  const readOnly = editor.trust !== 'user' || editor.saving
  const patchComposition = (composition: string): void => { actions.patchEditor({ composition }) }
  const tabs: readonly [typeof tab, string][] = [
    ['overview', 'Overview'], ['composition', t('compositionTree')], ['prompts', 'Prompts'],
    ['regexes', 'Regex'], ['files', t('files')], ['source', t('advancedSource')],
  ]
  return (
    <div className={css.studio}>
      <aside className={css.studioRoster} aria-label="Preset list">
        <div className={css.studioBrand}><button type="button" className={css.secondaryButton} onClick={actions.closeEditor}>← {t('nav')}</button><strong>{t('editorTitle')}</strong></div>
        <div className={css.studioRosterActions}><button type="button" className={css.secondaryButton} onClick={() => actions.beginCopy(editor.id)}>Copy</button></div>
        {state.rows.map(row => <button key={row.id} type="button" className={`${css.studioPreset} ${row.reference.id === editor.reference.id ? css.studioPresetActive : ''}`} onClick={() => { void actions.openEditor(row.id) }}><strong>{row.name ?? row.id}</strong><span>{row.trust === 'system' ? t('builtIn') : t('userTrust')}</span></button>)}
      </aside>
      <nav className={css.studioNav} aria-label="Studio sections">
        {tabs.map(([value, label]) => <button key={value} type="button" className={tab === value ? css.studioNavActive : css.studioNavItem} onClick={() => setTab(value)}>{label}</button>)}
      </nav>
      <main className={css.studioMain}>
        {tab === 'overview' ? <div className={css.editorFields}>
          <p className={css.editorIdentity}><code>{editor.id}</code> · {t('revisionLabel')}: <code>{editor.reference.revision.slice(0, 12)}</code></p>
          {editor.trust === 'system' ? <p className={css.intro}>{t('readOnlyPreset')}</p> : null}
          <label className={css.field}><span className={css.fieldLabel}>{t('displayName')}</span><input className={css.input} value={editor.name} disabled={readOnly} onChange={event => actions.patchEditor({ name: event.target.value })} /></label>
          <label className={css.field}><span className={css.fieldLabel}>{t('descriptionLabel')}</span><textarea className={css.editorDescription} value={editor.description} disabled={readOnly} onChange={event => actions.patchEditor({ description: event.target.value })} /></label>
        </div> : null}
        {tab === 'composition' ? <CompositionEditor rows={editor.compositionRows} readOnly={readOnly} t={t} actions={{ toggleCompositionRow: actions.toggleCompositionRow, moveCompositionRow: actions.moveCompositionRow, addCompositionRow: actions.addCompositionRow, deleteCompositionRow: actions.deleteCompositionRow }} /> : null}
        {tab === 'prompts' ? <ProgramEditor source={editor.composition} moduleName="@deepseek-ai/dsh-prompt-program" pluginId="prompt-program" kind="prompt" readOnly={readOnly} onChange={patchComposition} /> : null}
        {tab === 'regexes' ? <ProgramEditor source={editor.composition} moduleName="@deepseek-ai/dsh-regex-program" pluginId="regex-program" kind="regex" readOnly={readOnly} onChange={patchComposition} testRegex={actions.testRegex} /> : null}
        {tab === 'files' ? <FileEditor editor={editor} readOnly={readOnly} t={t} actions={{ selectFile: actions.selectFile, patchFileText: actions.patchFileText, uploadFile: actions.uploadFile, downloadFile: actions.downloadFile, createFile: actions.createFile, renameFile: actions.renameFile, deleteFile: actions.deleteFile }} /> : null}
        {tab === 'source' ? <textarea className={css.studioSource} spellCheck={false} value={editor.composition} disabled={readOnly} onChange={event => patchComposition(event.target.value)} /> : null}
        {editor.error === null ? null : <p className={css.error} role="alert">{editor.error}</p>}
      </main>
      <footer className={css.studioFooter}>
        <span>{editor.dirty ? t('dirty') : t('saved')} · <code>{editor.reference.revision.slice(0, 12)}</code></span>
        <div><Button variant="outline" disabled={editor.saving} onClick={actions.closeEditor}>{editor.trust === 'user' ? t('discard') : t('close')}</Button>{editor.trust === 'user' ? <Button disabled={editor.saving || !editor.dirty} onClick={() => { void actions.saveEditor() }}>{editor.saving ? t('saving') : t('save')}</Button> : null}</div>
      </footer>
    </div>
  )
}

/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section, or null when the deployment composes no presets.
 */
export function AgentPresetSection(props: AgentPresetSectionProps): ReactNode {
  const { useAgentPresetSection, t, load } = props
  const state = useAgentPresetSection(snapshot => snapshot)
  const viewedId = state.view?.id
  const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId)
  const viewedTitle = state.view === null
    ? ''
    : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name
  // Older snapshots supplied by extensions/tests predate the studio field.
  // Treat their missing value as closed rather than making the settings page
  // depend on a synchronized renderer deployment.
  const editor = state.editor ?? null

  useEffect(() => {
    void load()
  }, [load])

  // A deployment that composes no presets has nothing to manage: every
  // session shares the host composition and the page would be an empty list.
  if (state.status === 'unavailable') return null
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const detail = state.error ?? ''
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${detail}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  if (editor !== null) {
    return (
      <>
        <PresetStudio
          state={state}
          editor={editor}
          t={t}
          actions={{
            closeEditor: props.closeEditor,
            openEditor: props.openEditor,
            patchEditor: props.patchEditor,
            saveEditor: props.saveEditor,
            beginCopy: props.beginCopy,
            toggleCompositionRow: props.toggleCompositionRow,
            moveCompositionRow: props.moveCompositionRow,
            addCompositionRow: props.addCompositionRow,
            deleteCompositionRow: props.deleteCompositionRow,
            selectFile: props.selectFile,
            patchFileText: props.patchFileText,
            uploadFile: props.uploadFile,
            downloadFile: props.downloadFile,
            createFile: props.createFile,
            renameFile: props.renameFile,
            deleteFile: props.deleteFile,
            testRegex: props.testRegex,
          }}
        />
        <CopyDialog
          state={state}
          t={t}
          actions={{
            cancelCopy: props.cancelCopy,
            confirmCopy: props.confirmCopy,
            setCopyId: props.setCopyId,
            setCopyName: props.setCopyName,
          }}
        />
      </>
    )
  }

  /* The guided alternative to copying: the self-referential preset can
     read this very composition and author a new one in conversation.
     Offered only where that preset is actually on the roster and a
     session can be landed; without a writable root the draft could
     never be discovered, so the reason rides the disabled button. */
  const creatorButton = props.startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis')
    ? (
      <button
        type="button"
        className={css.creatorButton}
        disabled={!state.authorable}
        title={state.authorable ? undefined : t('duplicateUnavailable')}
        onClick={() => {
          props.startCreatorDraft?.()
          props.close()
        }}
      >
        {/* Same glyph as the Models page's add affordances. */}
        <IconPlusOutline16 size={14} />
        {t('creatorDraft')}
      </button>
    )
    : null
  const blankButton = state.authorable && props.beginBlank !== undefined
    ? (
      <button type="button" className={css.creatorButton} onClick={() => { props.beginBlank() }}>
        <IconPlusOutline16 size={14} />
        {t('newBlank')}
      </button>
    )
    : null
  const importButton = state.authorable && props.beginImport !== undefined
    ? (
      <button type="button" className={css.creatorButton} onClick={() => { props.beginImport() }}>
        <IconBrowseOutline16 size={14} />
        {t('import')}
      </button>
    )
    : null

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('sectionIntro')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
      {([['system', t('builtInGroup')], ['user', t('customGroup')]] as const).map(([trust, heading]) => {
        const group = state.rows
          .filter(row => row.trust === trust)
          .map(row => ({ row, text: presetDisplayText(row, t) }))
        // The custom group is where a preset of one's own will appear, so it
        // stays on screen even while empty: heading plus the creator entry.
        const tail = trust !== 'user' || (blankButton === null && importButton === null && creatorButton === null)
          ? null
          : <>{blankButton}{importButton}{creatorButton}</>
        if (group.length === 0 && tail === null) return null
        return (
          <section key={trust} className={css.group}>
            <h3 className={css.groupHead}>{heading}</h3>
            {group.length === 0 ? null : (
              <ul className={css.cards}>
                {group.map(({ row, text }) => (
                  <li
                    key={row.id}
                    className={row.broken !== undefined
                      ? `${css.card} ${css.cardBroken}`
                      : row.isDefault ? `${css.card} ${css.cardActive}` : css.card}
                  >
                    {/* The card body IS the control: picking a preset is the
                      common act, so it should not hide behind a small button.
                      The action row sits outside it — nesting buttons is
                      invalid, and these act on the card rather than select it.
                      A broken preset cannot compose a session, so its body is
                      disabled and the card says why instead of offering it. */}
                    <button
                      type="button"
                      className={css.cardMain}
                      aria-pressed={row.isDefault}
                      disabled={row.isDefault || row.broken !== undefined}
                      // Without this the name is the whole card read aloud —
                      // title, badge, description, id.
                      aria-label={`${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`}
                      title={row.broken ?? (row.isDefault ? t('inUse') : t('setDefault'))}
                      onClick={() => { void props.makeDefault(row.id) }}
                    >
                      <span className={css.cardHead}>
                        <span className={css.cardName}>{text.name}</span>
                        {row.broken !== undefined
                          ? <span className={css.brokenBadge}>{t('brokenBadge')}</span>
                          : null}
                        <span className={css.badge}>
                          {row.trust === 'user' ? t('userTrust') : t('builtIn')}
                        </span>
                        {row.isDefault ? <span className={css.inUse}>{t('inUse')}</span> : null}
                      </span>
                      <CardDescription text={text.description ?? t('noDescription')} />
                      {row.broken === undefined
                        ? null
                        : <span className={css.cardBrokenReason} role="alert">{row.broken}</span>}
                      <code className={css.cardId}>{row.id}</code>
                    </button>
                    <div className={css.cardFoot}>
                      {/* Shipped presets are the compositions a copy starts
                        from, so READING one is the point; a custom preset is
                        edited in its files instead, which the location action
                        leads to. A broken shipped preset has no readable
                        composition to offer, so its viewer is withheld; a
                        broken custom one keeps the location action — the
                        files are where it gets fixed. */}
                      {row.trust === 'system'
                        ? row.broken === undefined
                          ? (
                            <button
                              type="button"
                              className={css.iconButton}
                              data-tip={t('view')}
                              aria-label={`${t('view')}: ${text.name}`}
                              onClick={() => { void props.view(row.id) }}
                            >
                              <IconBrowseOutline16 />
                            </button>
                          )
                          : null
                        : (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={state.hasDocument ? t('openLocation') : t('showLocation')}
                            aria-label={`${state.hasDocument ? t('openLocation') : t('showLocation')}: ${text.name}`}
                            onClick={() => { void props.openLocation(row.id) }}
                          >
                            <IconFolderOpenOutline16 />
                          </button>
                        )}
                      <button
                        type="button"
                        className={css.iconButton}
                        disabled={!state.authorable || row.broken !== undefined}
                        data-tip={row.broken !== undefined
                          ? t('brokenNoCopy')
                          : state.authorable ? t('duplicate') : t('duplicateUnavailable')}
                        aria-label={`${t('duplicate')}: ${text.name}`}
                        onClick={() => { props.beginCopy(row.id) }}
                      >
                        <IconCopyOutline16 />
                      </button>
                      {row.trust === 'user'
                        ? (
                          <button
                            type="button"
                            className={`${css.iconButton} ${css.iconDanger}`}
                            data-tip={t('delete')}
                            aria-label={`${t('delete')}: ${text.name}`}
                            onClick={() => { props.confirmDelete(row.id) }}
                          >
                            <IconTrashOutline16 />
                          </button>
                        )
                        : null}
                      {props.openEditor === undefined
                        ? null
                        : (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={t('edit')}
                            aria-label={`${t('edit')}: ${text.name}`}
                            onClick={() => { void props.openEditor(row.id) }}
                          >
                            <IconBrowseOutline16 />
                          </button>
                        )}
                    </div>
                    {state.revealedPaths[row.id] === undefined
                      ? null
                      : (
                        <p className={css.revealedPath}>
                          <span className={css.revealedPathLabel}>{t('revealedPathLabel')}</span>
                          <code>{state.revealedPaths[row.id]}</code>
                        </p>
                      )}
                  </li>
                ))}
              </ul>
            )}
            {tail}
          </section>
        )
      })}
      <CopyDialog
        state={state}
        t={t}
        actions={{
          cancelCopy: props.cancelCopy,
          confirmCopy: props.confirmCopy,
          setCopyId: props.setCopyId,
          setCopyName: props.setCopyName,
        }}
      />
      <ImportDialog
        state={state}
        rows={state.rows}
        t={t}
        actions={{
          cancelImport: props.cancelImport,
          confirmImport: props.confirmImport,
          patchImport: props.patchImport,
          previewImport: props.previewImport,
          toggleImportPrompt: props.toggleImportPrompt,
          toggleImportRegex: props.toggleImportRegex,
        }}
      />
      <Modal
        open={state.view !== null}
        onClose={() => { props.closeView() }}
        title={state.view === null ? '' : `${t('view')} · ${viewedTitle}`}
        closeLabel={t('close')}
        description={t('composition')}
        className={css.dialog as string}
        footer={(
          <Button variant="outline" autoFocus onClick={() => { props.closeView() }}>
            {t('close')}
          </Button>
        )}
      >
        {state.view === null
          ? null
          : <pre className={css.viewerCode}>{state.view.content}</pre>}
      </Modal>
      <Modal
        open={state.pendingDelete !== null}
        onClose={() => { props.confirmDelete(null) }}
        title={t('deleteTitle')}
        closeLabel={t('close')}
        description={t('deleteDescription')}
        className={css.deleteDialog as string}
        footer={(
          <>
            <Button
              variant="outline"
              autoFocus
              disabled={state.deleting}
              onClick={() => { props.confirmDelete(null) }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.deleteConfirm}
              disabled={state.deleting}
              onClick={() => { void props.remove() }}
            >
              {state.deleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
