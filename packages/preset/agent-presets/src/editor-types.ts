/** Client-safe editor and SillyTavern import vocabulary. */
import type { AgentPresetReference } from '@deepseek-ai/dsh-session/types'

/** One file or directory returned by the preset editor. */
export interface PresetFileEntry {
  /** Normalized POSIX path relative to the preset root. */
  path: string
  /** Directory or regular file. */
  type: 'directory' | 'file'
  /** File byte length; directories report zero. */
  size: number
  /** Owner-execute bit retained for runnable helper files. */
  executable: boolean
}

/** Bounded content returned from one safe editor file read. */
export type PresetFileContent =
  | { kind: 'text'; path: string; size: number; content: string }
  | { kind: 'binary'; path: string; size: number; base64: string }

/** One staged filesystem mutation in an editor save. */
export type PresetFileOperation =
  | { kind: 'mkdir'; path: string }
  | { kind: 'write-text'; path: string; content: string }
  | { kind: 'write-base64'; path: string; base64: string; executable?: boolean }
  | { kind: 'rename'; path: string; target: string }
  | { kind: 'delete'; path: string }

/** A SillyTavern document family recognised by the import wizard. */
export type SillyTavernImportKind =
  | 'chat-completion'
  | 'regex'
  | 'instruct'
  | 'context'
  | 'system-prompt'
  | 'reasoning'
  | 'text-completion'
  | 'unknown'

/** One classified result of a SillyTavern import. */
export interface SillyTavernImportIssue {
  readonly disposition: 'converted' | 'approximated' | 'preserved' | 'rejected'
  readonly subject: string
  readonly message: string
}

/** Prompt entry represented independently of a specific preset file. */
export interface SillyTavernPromptEntry {
  readonly id: string
  readonly name: string
  readonly content: string
  readonly enabled: boolean
  readonly role: 'system' | 'user' | 'assistant'
  readonly position: 'before-history' | 'after-history' | 'depth'
  readonly depth?: number
  readonly order: number
  /** Explicit mappings for macros Harness can resolve; all other macros remain literal. */
  readonly variables?: Readonly<Record<string, 'session-id' | 'turn' | 'step'>>
}

/** Safe regular-expression entry represented independently of a preset file. */
export interface SillyTavernRegexEntry {
  readonly id: string
  readonly name: string
  readonly find: string
  readonly replace: string
  readonly flags?: string
  readonly order: number
  readonly target?: 'request' | 'response'
  readonly disabled: boolean
  readonly roles?: readonly ('system' | 'user' | 'assistant' | 'tool')[]
  readonly contentBlocks?: readonly ('text' | 'reasoning')[]
  readonly minDepth?: number
  readonly maxDepth?: number
  readonly macroStrategy?: 'none' | 'raw' | 'escaped'
}

/** Host-generated preview of a SillyTavern import. */
export interface SillyTavernImportPreview {
  readonly kind: SillyTavernImportKind
  readonly prompts: readonly SillyTavernPromptEntry[]
  readonly regexes: readonly SillyTavernRegexEntry[]
  readonly sampling: { readonly temperature?: number; readonly maxTokens?: number; readonly stop?: readonly string[] }
  readonly issues: readonly SillyTavernImportIssue[]
}

/** Preview plus the exact source hash that an import-create request must echo. */
export interface SillyTavernImportInspection {
  readonly sourceHash: string
  readonly preview: SillyTavernImportPreview
}

/** Exact preset document returned to the visual editor. */
export interface AgentPresetEditorDocument {
  readonly agentPreset: AgentPresetReference
  readonly trust: 'system' | 'user'
  readonly composition: string
  readonly name?: string
  readonly description?: string
}
