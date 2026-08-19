/** Schema for the immutable identity of an agent-preset revision. */
import { z } from 'zod'
import { AgentPresetId, AgentPresetRevision } from '@deepseek-ai/dsh-session/types'

/** Validates the opaque preset id and its SHA-256 manifest revision. */
export const agentPresetReferenceSchema = z.object({
  id: z.string().min(1).transform(AgentPresetId),
  revision: z.string().regex(/^[a-f0-9]{64}$/).transform(AgentPresetRevision),
})
