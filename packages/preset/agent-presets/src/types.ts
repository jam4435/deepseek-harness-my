/** Client-safe event declarations owned by the agent-preset domain. */
import type { AgentPresetReference, SessionId } from '@deepseek-ai/dsh-session/types'

/** Client-safe exact preset identity re-exported by the owning preset package. */
export type { AgentPresetId, AgentPresetReference, AgentPresetRevision } from '@deepseek-ai/dsh-session/types'
export type {
  AgentPresetEditorDocument, PresetFileContent, PresetFileEntry, PresetFileOperation,
  SillyTavernImportInspection, SillyTavernImportIssue, SillyTavernImportKind,
  SillyTavernImportPreview, SillyTavernPromptEntry, SillyTavernRegexEntry,
} from './editor-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the immutable preset revision recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: AgentPresetReference): void
  }
}

export {}
