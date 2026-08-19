/** Worker-isolated, non-destructive regular-expression transforms for presets. */

import { Buffer } from 'node:buffer'
import { Worker } from 'node:worker_threads'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, ContentBlock, Message } from '@deepseek-ai/dsh-llm'

/** Cordis row name. */
export const name = 'regex-program'

/** A message role selected by a regular-expression transform. */
export type RegexProgramRole = 'system' | 'user' | 'assistant' | 'tool'

/** A model-content block selected by a regular-expression transform. */
export type RegexProgramContentBlock = 'text' | 'reasoning'

/** One safe replacement script. */
export interface RegexProgramEntry {
  /** Stable id inside this program. */
  id: string
  /** Display label shown by the studio. */
  name: string
  /** JavaScript regular-expression source, never executed as a script. */
  find: string
  /** Replacement string with native `$1` capture expansion. */
  replace: string
  /** Regular-expression flags accepted by the runtime. */
  flags?: string
  /** Stable order among scripts in one stage. */
  order?: number
  /** Independent runtime switch. */
  disabled?: boolean
  /** Which model-visible phase receives the replacement. */
  target?: 'request' | 'response'
  /** Roles the script applies to; absent selects every role in the target phase. */
  roles?: RegexProgramRole[]
  /** Content blocks the script applies to; absent selects text and reasoning. */
  contentBlocks?: RegexProgramContentBlock[]
  /** Inclusive minimum history depth; zero is the last request message. */
  minDepth?: number
  /** Inclusive maximum history depth. */
  maxDepth?: number
  /** How an imported SillyTavern macro replacement is represented. */
  macroStrategy?: 'none' | 'raw' | 'escaped'
}

/** Worker and payload limits. */
export interface Limits {
  /** Maximum time allowed for one worker replacement. */
  perScriptMs?: number
  /** Maximum total time allowed for one request or response phase. */
  stageMs?: number
  /** Maximum number of enabled scripts in one phase. */
  maxScripts?: number
  /** Maximum UTF-8 input bytes accepted by a phase. */
  maxInputBytes?: number
  /** Maximum UTF-8 output bytes emitted by a phase. */
  maxOutputBytes?: number
}

/** Regex-program configuration. */
export interface Config {
  /** Ordered transforms. */
  entries?: RegexProgramEntry[]
  /** Resource limits for the isolated evaluator. */
  limits?: Limits
}

/** One Host-executed test result for the studio workbench. */
export interface RegexProgramTestResult {
  /** Input after the configured replacement. */
  output: string
  /** Capture groups from the first match before replacement. */
  captures: readonly string[]
  /** Worker execution elapsed time in milliseconds. */
  elapsedMs: number
}

/** Schemastery schema used by loader and editor inspection. */
export const Config: z<Config> = z.object({
  entries: z.array(z.object({
    id: z.string().required(), name: z.string().required(), find: z.string().required(),
    replace: z.string().required(), flags: z.string().default('g'), order: z.number().default(0),
    disabled: z.boolean().default(false), target: z.union(['request', 'response'] as const).default('request'),
    roles: z.array(z.union(['system', 'user', 'assistant', 'tool'] as const)).default([]),
    contentBlocks: z.array(z.union(['text', 'reasoning'] as const)).default([]),
    minDepth: z.number().default(0), maxDepth: z.number().default(Number.MAX_SAFE_INTEGER),
    macroStrategy: z.union(['none', 'raw', 'escaped'] as const).default('none'),
  })).default([]),
  limits: z.object({
    perScriptMs: z.number().default(100), stageMs: z.number().default(500),
    maxScripts: z.number().default(256), maxInputBytes: z.number().default(1024 * 1024),
    maxOutputBytes: z.number().default(2 * 1024 * 1024),
  }).default({
    perScriptMs: 100, stageMs: 500, maxScripts: 256,
    maxInputBytes: 1024 * 1024, maxOutputBytes: 2 * 1024 * 1024,
  }),
})

const WORKER_SOURCE = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', ({ find, replace, flags, text }) => {
    try {
      const probe = new RegExp(find, flags);
      const first = probe.exec(text);
      const output = text.replace(new RegExp(find, flags), replace);
      parentPort.postMessage({ ok: true, text: output, captures: first === null ? [] : first.slice(1).map(value => value ?? '') });
    } catch (error) {
      parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
`

/** Error raised when a script violates parsing, timing, or size limits. */
export class RegexProgramError extends Error {
  constructor(readonly entryId: string, message: string) {
    super(`regex-program: ${entryId}: ${message}`)
  }
}

interface ResolvedRegexEntry extends Omit<RegexProgramEntry, 'flags' | 'order' | 'disabled' | 'target' | 'roles' | 'contentBlocks' | 'minDepth' | 'maxDepth' | 'macroStrategy'> {
  readonly flags: string
  readonly order: number
  readonly disabled: boolean
  readonly target: 'request' | 'response'
  readonly roles: readonly RegexProgramRole[]
  readonly contentBlocks: readonly RegexProgramContentBlock[]
  readonly minDepth: number
  readonly maxDepth: number
  readonly macroStrategy: 'none' | 'raw' | 'escaped'
}

/** Sort scripts deterministically even when authored by different tools. */
function compareEntries(left: Pick<RegexProgramEntry, 'id' | 'order'>, right: Pick<RegexProgramEntry, 'id' | 'order'>): number {
  return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
}

function resolveEntries(entries: readonly RegexProgramEntry[] | undefined): ResolvedRegexEntry[] {
  const ids = new Set<string>()
  const resolved = (entries ?? []).map((entry): ResolvedRegexEntry => ({
    ...entry,
    flags: entry.flags ?? 'g', order: entry.order ?? 0, disabled: entry.disabled ?? false,
    target: entry.target ?? 'request', roles: [...(entry.roles ?? [])],
    contentBlocks: [...(entry.contentBlocks ?? [])], minDepth: entry.minDepth ?? 0,
    maxDepth: entry.maxDepth ?? Number.MAX_SAFE_INTEGER, macroStrategy: entry.macroStrategy ?? 'none',
  }))
  for (const entry of resolved) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(entry.id)) throw new Error(`regex-program: invalid entry id "${entry.id}"`)
    if (ids.has(entry.id)) throw new Error(`regex-program: duplicate entry id "${entry.id}"`)
    ids.add(entry.id)
    if (entry.name.length === 0) throw new Error(`regex-program: entry "${entry.id}" needs a name`)
    if (!Number.isSafeInteger(entry.order)
      || !Number.isSafeInteger(entry.minDepth) || !Number.isSafeInteger(entry.maxDepth)
      || entry.minDepth < 0 || entry.maxDepth < entry.minDepth) {
      throw new RegexProgramError(entry.id, 'order and depth bounds must be non-negative integers with minDepth <= maxDepth')
    }
    if (entry.roles.some(role => role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool')) {
      throw new RegexProgramError(entry.id, 'roles contains an unknown role')
    }
    if (entry.contentBlocks.some(block => block !== 'text' && block !== 'reasoning')) {
      throw new RegexProgramError(entry.id, 'contentBlocks contains an unknown block type')
    }
    try { void new RegExp(entry.find, entry.flags) } catch (error) {
      throw new RegexProgramError(entry.id, error instanceof Error ? error.message : String(error))
    }
  }
  return resolved.toSorted(compareEntries)
}

function resolveLimits(limits: Limits | undefined): Required<Limits> {
  const resolved: Required<Limits> = {
    perScriptMs: limits?.perScriptMs ?? 100,
    stageMs: limits?.stageMs ?? 500,
    maxScripts: limits?.maxScripts ?? 256,
    maxInputBytes: limits?.maxInputBytes ?? 1024 * 1024,
    maxOutputBytes: limits?.maxOutputBytes ?? 2 * 1024 * 1024,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`regex-program: limits.${key} must be a positive integer`)
  }
  return resolved
}

/** Run one replacement in a fresh worker and await quiescent termination. */
async function runInWorker(entry: Pick<ResolvedRegexEntry, 'find' | 'replace' | 'flags'>, text: string, limitMs: number): Promise<RegexProgramTestResult> {
  const worker = new Worker(WORKER_SOURCE, { eval: true })
  let started = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<RegexProgramTestResult>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        if (startupTimer !== undefined) clearTimeout(startupTimer)
        callback()
      }
      worker.once('message', (value: { ok: boolean; text?: string; captures?: string[]; error?: string }) => {
        finish(() => value.ok
          ? resolve({ output: value.text ?? '', captures: value.captures ?? [], elapsedMs: performance.now() - started })
          : reject(new Error(value.error ?? 'worker replacement failed')))
      })
      worker.once('error', error => finish(() => reject(error)))
      worker.once('online', () => {
        started = performance.now()
        timer = setTimeout(() => finish(() => reject(new Error(`timed out after ${limitMs}ms`))), limitMs)
        worker.postMessage({ find: entry.find, replace: entry.replace, flags: entry.flags, text })
      })
      startupTimer = setTimeout(() => finish(() => reject(new Error('worker did not start within 5 seconds'))), 5_000)
    })
  } finally {
    await worker.terminate()
  }
}

/** Run the same isolated evaluator the request path uses for the studio test bench. */
export async function testRegex(entry: RegexProgramEntry, text: string, limits?: Limits): Promise<RegexProgramTestResult> {
  const [resolved] = resolveEntries([entry])
  if (resolved === undefined) throw new Error('regex-program: test entry is missing')
  const configured = resolveLimits(limits)
  if (utf8Bytes(text) > configured.maxInputBytes) {
    throw new RegexProgramError(resolved.id, `input exceeds ${configured.maxInputBytes} UTF-8 bytes`)
  }
  try {
    const result = await runInWorker(resolved, text, Math.min(configured.perScriptMs, configured.stageMs))
    if (utf8Bytes(result.output) > configured.maxOutputBytes) {
      throw new RegexProgramError(resolved.id, `output exceeds ${configured.maxOutputBytes} UTF-8 bytes`)
    }
    return result
  } catch (error) {
    if (error instanceof RegexProgramError) throw error
    throw new RegexProgramError(resolved.id, error instanceof Error ? error.message : String(error))
  }
}

/** One phase-level budget shared across every eligible block and message. */
interface Stage {
  readonly entries: readonly ResolvedRegexEntry[]
  readonly target: 'request' | 'response'
  readonly limits: Required<Limits>
  readonly started: number
  inputBytes: number
  outputBytes: number
}

/** Start one bounded request or response phase. */
function beginStage(entries: readonly ResolvedRegexEntry[], target: 'request' | 'response', limits: Required<Limits>): Stage {
  const selected = entries.filter(entry => entry.target === target && !entry.disabled)
  if (selected.length > limits.maxScripts) {
    throw new RegexProgramError(selected[limits.maxScripts]?.id ?? 'program', `script count exceeds ${limits.maxScripts}`)
  }
  return { entries: selected, target, limits, started: performance.now(), inputBytes: 0, outputBytes: 0 }
}

/** Number of encoded bytes, never JavaScript code units. */
function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Whether one script applies to this message field. */
function applies(entry: ResolvedRegexEntry, role: RegexProgramRole, block: RegexProgramContentBlock, depth: number): boolean {
  return (entry.roles.length === 0 || entry.roles.includes(role))
    && (entry.contentBlocks.length === 0 || entry.contentBlocks.includes(block))
    && depth >= entry.minDepth && depth <= entry.maxDepth
}

/** Transform one selected text field under the phase-wide worker budget. */
async function transformText(stage: Stage, role: RegexProgramRole, block: RegexProgramContentBlock, depth: number, text: string): Promise<string> {
  stage.inputBytes += utf8Bytes(text)
  if (stage.inputBytes > stage.limits.maxInputBytes) {
    throw new RegexProgramError(stage.entries[0]?.id ?? 'program', `input exceeds ${stage.limits.maxInputBytes} UTF-8 bytes`)
  }
  let output = text
  for (const entry of stage.entries) {
    if (!applies(entry, role, block, depth)) continue
    const elapsed = performance.now() - stage.started
    if (elapsed >= stage.limits.stageMs) throw new RegexProgramError(entry.id, `stage timed out after ${stage.limits.stageMs}ms`)
    try {
      output = (await runInWorker(entry, output, Math.min(stage.limits.perScriptMs, stage.limits.stageMs - elapsed))).output
    } catch (error) {
      throw new RegexProgramError(entry.id, error instanceof Error ? error.message : String(error))
    }
  }
  stage.outputBytes += utf8Bytes(output)
  if (stage.outputBytes > stage.limits.maxOutputBytes) {
    throw new RegexProgramError(stage.entries[0]?.id ?? 'program', `output exceeds ${stage.limits.maxOutputBytes} UTF-8 bytes`)
  }
  return output
}

/** Transform selected text/reasoning blocks without mutating durable messages. */
async function transformMessage(stage: Stage, message: Message, depth: number): Promise<Message> {
  let changed = false
  const content: ContentBlock[] = []
  for (const block of message.content) {
    if (block.type !== 'text' && block.type !== 'reasoning') {
      content.push(block)
      continue
    }
    const text = await transformText(stage, message.role, block.type, depth, block.text)
    changed ||= text !== block.text
    content.push({ ...block, text })
  }
  return changed ? freezeMessage({ ...message, content }) : message
}

/**
 * Register request and response transforms. Request transforms receive a
 * request-only content copy; response transforms finish before the durable
 * assistant message commits.
 * @param ctx - the agent-scoped Cordis context.
 * @param config - validated regex program configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const entries = resolveEntries(config.entries)
  const limits = resolveLimits(config.limits)
  if (entries.length === 0) return
  ctx.on('agent/request-content', async (_payload, next) => {
    const downstream = await next()
    const stage = beginStage(entries, 'request', limits)
    const system = downstream.system === undefined
      ? undefined
      : await transformText(stage, 'system', 'text', 0, downstream.system)
    const messages: Message[] = []
    for (const [index, message] of downstream.messages.entries()) {
      messages.push(await transformMessage(stage, message, downstream.messages.length - index - 1))
    }
    const changed = system !== downstream.system || messages.some((message, index) => message !== downstream.messages[index])
    return !changed ? downstream : {
      messages,
      ...system === undefined ? {} : { system },
    }
  })
  ctx.on('agent/response', async (_payload, next): Promise<AssistantMessage> => {
    const downstream = await next()
    const stage = beginStage(entries, 'response', limits)
    return await transformMessage(stage, downstream, 0) as AssistantMessage
  })
}
