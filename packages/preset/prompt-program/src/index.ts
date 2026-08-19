/** Role-aware, request-only prompt entries contributed by an agent preset. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'

/** Cordis row name. */
export const name = 'prompt-program'

/** Where a prompt entry is positioned in the request message batch. */
export type PromptProgramPosition = 'before-history' | 'after-history' | 'depth'

/** A Harness value explicitly made available to a prompt-entry macro. */
export type PromptProgramVariable = 'session-id' | 'turn' | 'step'

/** One stable, UI-editable prompt entry. */
export interface PromptProgramEntry {
  /** Stable id inside this program. */
  id: string
  /** Display label shown by the studio. */
  name: string
  /** Exact model-facing text, retaining unmapped macros verbatim. */
  content: string
  /** Message role emitted to the model. */
  role: 'system' | 'user' | 'assistant'
  /** Relative or history-depth insertion point. */
  position: PromptProgramPosition
  /** History depth for `depth` entries; zero follows the final request message. */
  depth?: number
  /** Stable order among entries with the same insertion point. */
  order: number
  /** Independent runtime switch. */
  enabled?: boolean
  /** Explicit SillyTavern-style macro mappings that Harness can resolve. */
  variables?: Record<string, PromptProgramVariable>
}

/** Prompt-program configuration stored in `agent.cordis.yml`. */
export interface Config {
  /** Ordered prompt entries. */
  entries?: PromptProgramEntry[]
}

/** Schemastery schema used by the loader and the studio's plugin inspector. */
export const Config: z<Config> = z.object({
  entries: z.array(z.object({
    id: z.string().required(),
    name: z.string().required(),
    content: z.string().required(),
    role: z.union(['system', 'user', 'assistant'] as const).default('user'),
    position: z.union(['before-history', 'after-history', 'depth', 'relative'] as const).default('after-history'),
    depth: z.number().default(0),
    order: z.number().default(0),
    enabled: z.boolean().default(true),
    variables: z.dict(z.union(['session-id', 'turn', 'step'] as const)).default({}),
  })).default([]),
}) as unknown as z<Config>

interface ResolvedPromptEntry extends Omit<PromptProgramEntry, 'depth' | 'enabled' | 'variables'> {
  /** Non-negative insertion depth after config defaults. */
  readonly depth: number
  /** Explicit enable value after config defaults. */
  readonly enabled: boolean
  /** Detached variable map after config defaults. */
  readonly variables: Readonly<Record<string, PromptProgramVariable>>
}

/** Validate and detach entries before registering any effects. */
function resolveEntries(entries: readonly PromptProgramEntry[] | undefined): ResolvedPromptEntry[] {
  const ids = new Set<string>()
  const resolved = (entries ?? []).map((entry): ResolvedPromptEntry => ({
    ...entry,
    // `relative` was emitted by the first studio preview. It has the same
    // request-only meaning as the explicit after-history position.
    position: (entry.position as string) === 'relative' ? 'after-history' : entry.position,
    enabled: entry.enabled ?? true,
    depth: entry.depth ?? 0,
    variables: { ...entry.variables },
  }))
  for (const entry of resolved) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(entry.id)) {
      throw new Error(`prompt-program: entry id "${entry.id}" is invalid`)
    }
    if (ids.has(entry.id)) throw new Error(`prompt-program: duplicate entry id "${entry.id}"`)
    ids.add(entry.id)
    if (entry.name.length === 0) throw new Error(`prompt-program: entry "${entry.id}" needs a name`)
    if (!Number.isSafeInteger(entry.order)) throw new Error(`prompt-program: entry "${entry.id}" order must be an integer`)
    if (!Number.isSafeInteger(entry.depth) || entry.depth < 0) {
      throw new Error(`prompt-program: entry "${entry.id}" depth must be a non-negative integer`)
    }
    for (const [macro, variable] of Object.entries(entry.variables)) {
      if (!/^[a-z][a-z0-9_-]*$/i.test(macro)) {
        throw new Error(`prompt-program: entry "${entry.id}" has invalid macro "${macro}"`)
      }
      if (variable !== 'session-id' && variable !== 'turn' && variable !== 'step') {
        throw new Error(`prompt-program: entry "${entry.id}" maps "${macro}" to an unknown Harness variable`)
      }
    }
  }
  return resolved.toSorted(compareEntries)
}

/** Stable ordering for entries occupying one insertion slot. */
function compareEntries(left: PromptProgramEntry, right: PromptProgramEntry): number {
  return left.order - right.order || left.id.localeCompare(right.id)
}

/** Materialize only explicitly mapped variables; unknown macros remain literal text. */
function renderEntry(entry: ResolvedPromptEntry, values: { sessionId: string; turn: number; step: number }): string {
  let content = entry.content
  for (const [macro, variable] of Object.entries(entry.variables)) {
    const value = variable === 'session-id' ? values.sessionId : variable === 'turn' ? String(values.turn) : String(values.step)
    content = content.replaceAll(`{{${macro}}}`, value)
  }
  return content
}

/** Create one role-bearing request message that records its stable entry id in source.plugin. */
function messageFor(entry: ResolvedPromptEntry, values: { sessionId: string; turn: number; step: number }): Message {
  return createMessage({
    role: entry.role,
    content: [{ type: 'text', text: renderEntry(entry, values) }],
    source: { kind: 'plugin', plugin: `prompt-program:${entry.id}` },
  })
}

/** Insert enabled entries into an independently assembled request batch. */
function insertEntries(
  entries: readonly ResolvedPromptEntry[],
  content: readonly Message[],
  values: { sessionId: string; turn: number; step: number },
): Message[] {
  const active = entries.filter(entry => entry.enabled && entry.content.length > 0)
  if (active.length === 0) return [...content]
  const before = active.filter(entry => entry.position === 'before-history')
  const after = active.filter(entry => entry.position === 'after-history')
  const byIndex = new Map<number, ResolvedPromptEntry[]>()
  for (const entry of active.filter(candidate => candidate.position === 'depth')) {
    const index = Math.max(0, content.length - entry.depth)
    const atIndex = byIndex.get(index)
    if (atIndex === undefined) byIndex.set(index, [entry])
    else atIndex.push(entry)
  }
  const output = before.map(entry => messageFor(entry, values))
  for (let index = 0; index <= content.length; index += 1) {
    for (const entry of (byIndex.get(index) ?? []).toSorted(compareEntries)) {
      output.push(messageFor(entry, values))
    }
    if (index < content.length) output.push(content[index]!)
  }
  output.push(...after.map(entry => messageFor(entry, values)))
  return output
}

/**
 * Register request-only role-bearing prompt entries. They never enter the
 * surface or derived history, so repeated tool steps cannot accumulate them.
 * @param ctx - the agent-scoped Cordis context.
 * @param config - validated prompt program configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const entries = resolveEntries(config.entries)
  if (entries.length === 0) return
  ctx.on('agent/request-content', async ({ agent, turn, step }, next) => {
    const downstream = await next()
    return {
      ...downstream,
      messages: insertEntries(entries, downstream.messages, { sessionId: agent.id, turn, step }),
    }
  })
}
