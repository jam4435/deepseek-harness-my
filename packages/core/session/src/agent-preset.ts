/** Client-safe durable identity of one immutable agent-preset revision. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Immutable directory id of an agent preset. */
export type AgentPresetId = Branded<'AgentPresetId'>

/** SHA-256 identity of an immutable preset tree. */
export type AgentPresetRevision = Branded<'AgentPresetRevision'>

/** Exact preset content a session was composed from. */
export interface AgentPresetReference {
  /** The user-visible, stable preset id. */
  readonly id: AgentPresetId
  /** The immutable content revision selected for this session. */
  readonly revision: AgentPresetRevision
}

/** Brand a validated directory id at the owning parser boundary. */
export function AgentPresetId(value: string): AgentPresetId {
  return value as AgentPresetId
}

/** Brand a validated SHA-256 preset revision at the owning repository boundary. */
export function AgentPresetRevision(value: string): AgentPresetRevision {
  return value as AgentPresetRevision
}
