/**
 * agent-presets domain contract: the roster a browser offers when starting a
 * session, plus the authoring calls behind it.
 *
 * `list` is ordinary: it carries ids and trust, and every preset picker needs
 * it. The authoring calls are privileged and loopback-pinned — a composition
 * names the plugins a session runs, so reading one is reconnaissance, and
 * although authoring is copy-only (no caller supplies composition text or a
 * path), copying and deleting still rearrange what the deployment offers.
 */

import type { AgentPresetReference, SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AgentPresetEditorDocument, PresetFileContent, PresetFileEntry, PresetFileOperation,
  SillyTavernImportInspection,
} from '@deepseek-ai/dsh-agent-presets/types'
import type { RegexProgramEntry, RegexProgramTestResult } from '@deepseek-ai/dsh-regex-program'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One preset the deployment can compose a session's agent from. */
export interface AgentPresetEntry {
  /** Stable identifier, also the display name until presets carry metadata. */
  readonly id: string
  /** Latest immutable content revision available for new sessions. */
  readonly reference: AgentPresetReference
  /**
   * Whether the preset ships with the deployment or was authored locally.
   * A `user` preset is exactly as privileged as the plugins it names, so a
   * surface offering one should say so rather than present it as vetted.
   */
  readonly trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  readonly isDefault: boolean
  /**
   * Display name the preset published, absent when it published none. A
   * surface falls back to {@link id}; it is never a second identity, and it
   * never decides trust — a locally authored preset cannot name itself into
   * the shipped set.
   */
  readonly name?: string
  /** One sentence on what the preset is for, when it published one. */
  readonly description?: string
  /**
   * Why this preset cannot compose a session, absent when it can. A broken
   * preset stays listed — its directory still occupies the id, so a surface
   * must be able to show and delete it — but offering it for selection would
   * only defer this reason to a failed session start.
   */
  readonly broken?: string
}

/** agent-preset-domain unary methods (the map key agentPreset.* of RpcMethodMap). */
export interface AgentPresetsApi {
  /**
   * Lists every preset the deployment currently supplies, in root-precedence
   * order — the roots as configured, each root's own presets sorted by id,
   * and the first root to supply an id wins. The order is not globally
   * sorted: a user root's preset sits in that root's block, not among the
   * shipped ids.
   * An empty roster means the deployment composes no presets at all, and
   * every session shares the host composition. `authorable` reports whether
   * the deployment configures a root new presets can be written to, and
   * `hasDocument` whether `openDocument` can hand a preset directory to a
   * native opener — both deployment facts rather than per-preset ones, and
   * neither exposes a Host path.
   */
  list(request: RpcRequest<{}>):
  Promise<RpcResponse<{ presets: readonly AgentPresetEntry[]; authorable: boolean; hasDocument: boolean }>>

  /**
   * Recompose one session's agent from a different preset.
   *
   * Allowed only while the session is blank — no turn has run. Once a
   * conversation starts, its history was produced under that preset's tools,
   * and swapping them would leave logged tool calls the new composition cannot
   * make; the attempt answers `agent-preset-locked`.
   */
  select(request: RpcRequest<{ sessionId: SessionId; agentPreset: AgentPresetReference }>):
  Promise<RpcResponse<{ agentPreset: AgentPresetReference }>>

  /**
   * Read one preset's composition text, for the read-only viewer.
   *
   * Privileged: a composition names the plugins a session runs, so reading
   * one is reconnaissance.
   */
  read(request: RpcRequest<{ agentPreset: AgentPresetReference }>):
  Promise<RpcResponse<{
    agentPreset: AgentPresetReference
    trust: 'system' | 'user'
    content: string
    name?: string
    description?: string
  }>>

  /** Create a blank preset or copy one exact immutable source revision. */
  create(request: RpcRequest<{
    agentPreset: string
    source?: AgentPresetReference
    name?: string
  }>): Promise<RpcResponse<{ agentPreset: AgentPresetReference }>>

  /** Parse one SillyTavern JSON document without writing it or executing its contents. */
  importPreview(request: RpcRequest<{ content: string }>): Promise<RpcResponse<SillyTavernImportInspection>>

  /** Create a new custom preset from a Harness base and one previewed source document. */
  importCreate(request: RpcRequest<{
    source: AgentPresetReference
    agentPreset: string
    content: string
    expectedHash: string
    name?: string
  }>): Promise<RpcResponse<{ agentPreset: AgentPresetReference }>>

  /** Open one preset in the visual editor. Privileged because it reveals composition code. */
  editorOpen(request: RpcRequest<{ agentPreset: AgentPresetReference }>): Promise<RpcResponse<AgentPresetEditorDocument>>

  /**
   * Save metadata and complete composition text together.
   *
   * The expected revision prevents a browser from silently replacing native or
   * concurrent edits. Shipped presets are always refused.
   */
  editorSave(request: RpcRequest<{
    agentPreset: AgentPresetReference
    composition: string
    name?: string
    description?: string
    files?: readonly PresetFileOperation[]
  }>): Promise<RpcResponse<{ agentPreset: AgentPresetReference }>>

  /** List a bounded page of normalized files and directories under one preset. */
  editorListFiles(request: RpcRequest<{
    agentPreset: AgentPresetReference
    directory?: string
    cursor?: string
    limit?: number
  }>): Promise<RpcResponse<{ entries: readonly PresetFileEntry[]; nextCursor?: string }>>

  /** Read one bounded regular file as UTF-8 text or Base64 bytes. */
  editorReadFile(request: RpcRequest<{ agentPreset: AgentPresetReference; path: string }>): Promise<RpcResponse<PresetFileContent>>

  /** Run one regex entry in the Host worker against bounded sample text. */
  editorTestRegex(request: RpcRequest<{
    agentPreset: AgentPresetReference
    entry: RegexProgramEntry
    text: string
  }>): Promise<RpcResponse<RegexProgramTestResult>>

  /**
   * Hand one locally authored preset's DIRECTORY to the platform opener, for
   * editing the files that are now the only composition editor. The request
   * carries an id, never a path — the Host resolves it — so no browser
   * payload can select an arbitrary filesystem target. Where the deployment
   * has no native opener (`hasDocument: false` on `list`), the reply carries
   * the resolved directory for the surface to show as text instead. Shipped
   * presets are refused: their install is not the user's to manage.
   */
  openDocument(request: RpcRequest<{ agentPreset: AgentPresetReference }>, signal: AbortSignal):
  Promise<RpcResponse<{ opened: true } | { opened: false; path: string }>>

  /** Delete a locally authored preset. Shipped presets are refused. */
  remove(request: RpcRequest<{ agentPreset: AgentPresetReference }>): Promise<RpcResponse<{}>>
}
