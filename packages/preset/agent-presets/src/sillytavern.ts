/** Parse SillyTavern JSON into inert, editor-neutral preset program records. */

import type {
  SillyTavernImportIssue, SillyTavernImportKind, SillyTavernImportPreview,
  SillyTavernPromptEntry, SillyTavernRegexEntry,
} from './editor-types.ts'
export type {
  SillyTavernImportIssue, SillyTavernImportKind, SillyTavernImportPreview,
  SillyTavernPromptEntry, SillyTavernRegexEntry,
} from './editor-types.ts'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function kindOf(source: JsonRecord): SillyTavernImportKind {
  if (typeof source.chat_completion_source === 'string' || Array.isArray(source.prompts) || Array.isArray(source.prompt_order)) return 'chat-completion'
  if (Array.isArray(source.regex_scripts) || record(source.replacement_macros)?.regex_scripts !== undefined) return 'regex'
  if (source.input_sequence !== undefined || source.output_sequence !== undefined) return 'instruct'
  if (source.story_string !== undefined || source.context_template !== undefined) return 'context'
  if (source.system_prompt !== undefined || source.jailbreak_prompt !== undefined) return 'system-prompt'
  if (source.reasoning_prefix !== undefined || source.reasoning_suffix !== undefined) return 'reasoning'
  if (source.temperature !== undefined || source.rep_pen !== undefined || source.max_length !== undefined) return 'text-completion'
  return 'unknown'
}

interface PromptOrder {
  readonly enabled: boolean
  readonly order: number
}

/** Read the selected Chat Completion order list without relying on a character card. */
function promptOrder(source: JsonRecord): Map<string, PromptOrder> {
  const lists = source.prompt_order
  if (!Array.isArray(lists)) return new Map()
  const selected = lists.find((item) => {
    const characterId = record(item)?.character_id
    return characterId === 100001 || characterId === '100001'
  }) ?? lists[0]
  const rows = record(selected)?.order
  if (!Array.isArray(rows)) return new Map()
  return new Map(rows.flatMap((item, order) => {
    const row = record(item)
    return typeof row?.identifier === 'string'
      ? [[row.identifier, { enabled: row.enabled !== false, order }] as const]
      : []
  }))
}

/** Map a Chat Completion injection position to a request-only Harness position. */
function promptPosition(item: JsonRecord): 'before-history' | 'after-history' | 'depth' {
  if (number(item.injection_depth) !== undefined || item.injection_position === 1 || item.injection_position === 'in-chat') return 'depth'
  return item.injection_position === 'before' ? 'before-history' : 'after-history'
}

/** Parse the regular-expression literal syntax SillyTavern writes in export files. */
function regexSource(value: string): { find: string; flags?: string } {
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(value)
  return literal === null ? { find: value } : { find: literal[1]!, ...literal[2] === '' ? {} : { flags: literal[2] } }
}

/** Preserve macros which have no safe Harness value source instead of executing them. */
function reportUnknownMacros(content: string, subject: string, issues: SillyTavernImportIssue[]): void {
  const macros = [...content.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1]!).filter(Boolean)
  if (macros.length === 0) return
  issues.push({
    disposition: 'preserved',
    subject: `${subject}.macros`,
    message: `Unmapped macros remain literal: ${[...new Set(macros)].join(', ')}.`,
  })
}

/** Convert one exported regular-expression entry without evaluating it. */
function convertRegex(item: JsonRecord, index: number, issues: SillyTavernImportIssue[]): SillyTavernRegexEntry | undefined {
  if (typeof item.findRegex !== 'string') {
    issues.push({ disposition: 'rejected', subject: `regex_scripts[${String(index)}]`, message: 'A regex script needs a findRegex string.' })
    return undefined
  }
  const source = regexSource(item.findRegex)
  const placement = item.placement
  const target = placement === 2 || placement === 'response' || placement === 'assistant' ? 'response' : 'request'
  const roles = item.markdownOnly === true ? ['assistant'] as const : undefined
  const minDepth = number(item.min_depth)
  const maxDepth = number(item.max_depth)
  const entry: SillyTavernRegexEntry = {
    id: typeof item.id === 'string' ? item.id : `regex-${String(index + 1)}`,
    name: typeof item.scriptName === 'string' ? item.scriptName : `Regex ${String(index + 1)}`,
    find: source.find,
    replace: typeof item.replaceString === 'string' ? item.replaceString : '',
    ...source.flags === undefined ? { flags: 'g' } : { flags: source.flags },
    order: number(item.order) ?? index,
    target,
    disabled: item.disabled === true,
    ...roles === undefined ? {} : { roles },
    ...minDepth === undefined ? {} : { minDepth },
    ...maxDepth === undefined ? {} : { maxDepth },
    macroStrategy: typeof item.replaceString === 'string' && item.replaceString.includes('{{') ? 'raw' : 'none',
  }
  reportUnknownMacros(entry.replace, `regex_scripts.${entry.id}`, issues)
  return entry
}

/** Add generic Context/System Prompt fields as ordinary system prompt entries. */
function convertContext(source: JsonRecord, prompts: SillyTavernPromptEntry[], issues: SillyTavernImportIssue[]): void {
  const fields: readonly [key: string, label: string][] = [
    ['story_string', 'Story string'], ['context_template', 'Context template'],
    ['system_prompt', 'System prompt'], ['jailbreak_prompt', 'Jailbreak prompt'],
  ]
  for (const [key, label] of fields) {
    const content = source[key]
    if (typeof content !== 'string' || content.length === 0) continue
    prompts.push({ id: `sillytavern-${key}`, name: label, content, enabled: true, role: 'system', position: 'before-history', order: prompts.length })
    reportUnknownMacros(content, key, issues)
    issues.push({ disposition: 'converted', subject: key, message: 'Static context was converted to a system prompt entry.' })
  }
}

/** Add conservative Instruct and Reasoning transforms only where text rewriting is exact. */
function convertFormatting(source: JsonRecord, regexes: SillyTavernRegexEntry[], issues: SillyTavernImportIssue[]): void {
  const framing: readonly [key: 'input_sequence' | 'output_sequence', role: 'user' | 'assistant'][] = [
    ['input_sequence', 'user'], ['output_sequence', 'assistant'],
  ]
  for (const [key, role] of framing) {
    const content = source[key]
    if (typeof content !== 'string' || content.length === 0) continue
    regexes.push({
      id: `sillytavern-${key}`, name: key === 'input_sequence' ? 'Instruct input prefix' : 'Instruct output prefix',
      find: '^', replace: content, flags: '', order: regexes.length, target: 'request', disabled: false, roles: [role], macroStrategy: 'raw',
    })
    reportUnknownMacros(content, key, issues)
    issues.push({ disposition: 'approximated', subject: key, message: 'Static message prefix was converted to a role-filtered request regex.' })
  }
  for (const [key, suffix] of [['reasoning_prefix', false], ['reasoning_suffix', true]] as const) {
    const content = source[key]
    if (typeof content !== 'string' || content.length === 0) continue
    regexes.push({
      id: `sillytavern-${key}`, name: key, find: suffix ? '$' : '^', replace: content, flags: '', order: regexes.length,
      target: 'response', disabled: false, roles: ['assistant'], contentBlocks: ['reasoning'], macroStrategy: 'raw',
    })
    reportUnknownMacros(content, key, issues)
    issues.push({ disposition: 'converted', subject: key, message: 'Reasoning decoration was converted to a reasoning-only response regex.' })
  }
}

/**
 * Parse one uploaded JSON document without executing its macros, regexes, or
 * extension payloads.
 * @param content - UTF-8 JSON selected by the user.
 * @returns a structured preview suitable for a confirmation screen.
 * @throws when the upload is not one JSON object.
 */
export function inspectSillyTavernPreset(content: string): SillyTavernImportPreview {
  const parsed: unknown = JSON.parse(content)
  const standaloneRegex = Array.isArray(parsed)
    && parsed.length > 0
    && parsed.every(item => typeof record(item)?.findRegex === 'string')
  const source = standaloneRegex ? { regex_scripts: parsed } : record(parsed)
  if (source === undefined) throw new Error('SillyTavern import must be one JSON object or regex script array')
  const kind = kindOf(source)
  const issues: SillyTavernImportIssue[] = []
  const order = promptOrder(source)
  const prompts: SillyTavernPromptEntry[] = []
  if (Array.isArray(source.prompts)) {
    for (const [index, raw] of source.prompts.entries()) {
      const item = record(raw)
      if (item === undefined || typeof item.identifier !== 'string') {
        issues.push({ disposition: 'rejected', subject: `prompts[${String(index)}]`, message: 'A prompt without an identifier cannot be ordered.' })
        continue
      }
      if (item.marker === true) {
        issues.push({ disposition: 'preserved', subject: `prompts.${item.identifier}`, message: 'This SillyTavern marker has no standalone Harness content.' })
        continue
      }
      if (typeof item.content !== 'string') {
        issues.push({ disposition: 'preserved', subject: `prompts.${item.identifier}`, message: 'This prompt has no text content and remains in the source JSON.' })
        continue
      }
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : 'system'
      const depth = number(item.injection_depth)
      const selected = order.get(item.identifier)
      prompts.push({
        id: item.identifier,
        name: typeof item.name === 'string' ? item.name : item.identifier,
        content: item.content,
        enabled: selected?.enabled ?? true,
        role,
        position: promptPosition(item),
        ...depth === undefined ? {} : { depth },
        order: selected?.order ?? number(item.injection_order) ?? index,
      })
      reportUnknownMacros(item.content, `prompts.${item.identifier}`, issues)
    }
    issues.push({ disposition: 'converted', subject: 'prompts', message: 'Chat Completion entries, order, roles, depth, and enabled state were converted.' })
  }
  convertContext(source, prompts, issues)
  const rawRegexes = Array.isArray(source.regex_scripts)
    ? source.regex_scripts
    : record(source.replacement_macros)?.regex_scripts
  const regexes: SillyTavernRegexEntry[] = []
  if (Array.isArray(rawRegexes)) {
    for (const [index, raw] of rawRegexes.entries()) {
      const item = record(raw)
      if (item !== undefined) {
        const converted = convertRegex(item, index, issues)
        if (converted !== undefined) regexes.push(converted)
      } else {
        issues.push({ disposition: 'rejected', subject: `regex_scripts[${String(index)}]`, message: 'A regex script must be an object.' })
      }
    }
    issues.push({ disposition: 'approximated', subject: 'regex_scripts', message: 'Executable request/response transforms were converted; display-only behavior remains preserved in the source.' })
  }
  convertFormatting(source, regexes, issues)
  const stop = strings(source.stop) ?? strings(source.custom_stopping_strings)
  const sampling = {
    ...typeof source.temperature === 'number' ? { temperature: source.temperature } : {},
    ...typeof source.openai_max_tokens === 'number'
      ? { maxTokens: source.openai_max_tokens }
      : typeof source.max_length === 'number' ? { maxTokens: source.max_length } : {},
    ...stop === undefined ? {} : { stop },
  }
  if (Object.keys(sampling).length > 0) {
    issues.push({ disposition: 'converted', subject: 'sampling', message: 'Only provider-neutral temperature, max tokens, and stop values were selected.' })
  }
  if (kind === 'text-completion') {
    issues.push({ disposition: 'preserved', subject: kind, message: 'Provider-specific Text Completion, Kobold, and Novel fields remain in the original JSON.' })
  }
  if (kind === 'unknown') {
    issues.push({ disposition: 'rejected', subject: 'document', message: 'No supported SillyTavern preset signature was found.' })
  }
  for (const key of ['provider', 'model', 'api_url', 'chat_completion_source']) {
    if (source[key] !== undefined) {
      issues.push({ disposition: 'preserved', subject: key, message: 'Provider-specific selection is retained in the source; Harness model selection is not guessed.' })
    }
  }
  return { kind, prompts, regexes, sampling, issues }
}
