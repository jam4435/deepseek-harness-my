/**
 * agent-presets domain zod schemas (names derived from map keys:
 * agentPresetListRequestSchema / agentPresetListValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { agentPresetReferenceSchema } from './agent-preset-reference.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { AgentPresetEntry } from './agent-presets.ts'
import type { AgentPresetEditorDocument } from '@deepseek-ai/dsh-agent-presets/types'
import type { SillyTavernImportInspection } from '@deepseek-ai/dsh-agent-presets/types'

/** AgentPresetEntry row of agentPreset.list. */
export const agentPresetEntrySchema = z.object({
  id: z.string().min(1),
  reference: agentPresetReferenceSchema,
  trust: z.union([z.literal('system'), z.literal('user')]),
  isDefault: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  broken: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<AgentPresetEntry>>

/** agentPreset.list request payload. */
export const agentPresetListRequestSchema = z.object({
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.list'>>>

/** agentPreset.list response value. */
export const agentPresetListValueSchema = z.object({
  presets: z.array(agentPresetEntrySchema),
  authorable: z.boolean(),
  hasDocument: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.list'>>>

/** agentPreset.select request payload. */
export const agentPresetSelectRequestSchema = z.object({
  sessionId: sessionIdSchema,
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.select'>>>

/** agentPreset.select response value. */
export const agentPresetSelectValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.select'>>>

/** agentPreset.read request payload. */
export const agentPresetReadRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.read'>>>

/** agentPreset.read response value. */
export const agentPresetReadValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
  trust: z.union([z.literal('system'), z.literal('user')]),
  content: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.read'>>>

/** agentPreset.create request payload. */
export const agentPresetCreateRequestSchema = z.object({
  agentPreset: z.string().min(1),
  source: agentPresetReferenceSchema.optional(),
  name: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.create'>>>

/** agentPreset.create response value. */
export const agentPresetCreateValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.create'>>>

/** agentPreset.importPreview request payload. */
export const agentPresetImportPreviewRequestSchema = z.object({
  content: z.string().max(16 * 1024 * 1024),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.importPreview'>>>

/** agentPreset.importPreview response value. */
const sillyTavernImportPreviewSchema = z.object({
  kind: z.union([
    z.literal('chat-completion'), z.literal('regex'), z.literal('instruct'), z.literal('context'),
    z.literal('system-prompt'), z.literal('reasoning'), z.literal('text-completion'), z.literal('unknown'),
  ]),
  prompts: z.array(z.object({
    id: z.string(), name: z.string(), content: z.string(), enabled: z.boolean(),
    role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant')]),
    position: z.union([z.literal('before-history'), z.literal('after-history'), z.literal('depth')]),
    depth: z.number().optional(), order: z.number(),
    variables: z.record(z.string(), z.union([z.literal('session-id'), z.literal('turn'), z.literal('step')])).optional(),
  })),
  regexes: z.array(z.object({
    id: z.string(), name: z.string(), find: z.string(), replace: z.string(), flags: z.string().optional(), order: z.number(),
    target: z.union([z.literal('request'), z.literal('response')]).optional(), disabled: z.boolean(),
    roles: z.array(z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool')])).optional(),
    contentBlocks: z.array(z.union([z.literal('text'), z.literal('reasoning')])).optional(),
    minDepth: z.number().optional(), maxDepth: z.number().optional(),
    macroStrategy: z.union([z.literal('none'), z.literal('raw'), z.literal('escaped')]).optional(),
  })),
  sampling: z.object({ temperature: z.number().optional(), maxTokens: z.number().optional(), stop: z.array(z.string()).optional() }),
  issues: z.array(z.object({
    disposition: z.union([z.literal('converted'), z.literal('approximated'), z.literal('preserved'), z.literal('rejected')]),
    subject: z.string(), message: z.string(),
  })),
})

/** agentPreset.importPreview response value. */
export const agentPresetImportPreviewValueSchema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  preview: sillyTavernImportPreviewSchema,
}) satisfies z.ZodType<Wire<SillyTavernImportInspection>>

/** agentPreset.importCreate request payload. */
export const agentPresetImportCreateRequestSchema = z.object({
  source: agentPresetReferenceSchema, agentPreset: z.string().min(1), content: z.string().max(16 * 1024 * 1024),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.importCreate'>>>

/** agentPreset.importCreate response value. */
export const agentPresetImportCreateValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.importCreate'>>>

/** agentPreset.editorOpen request payload. */
export const agentPresetEditorOpenRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.editorOpen'>>>

/** agentPreset.editorOpen response value. */
export const agentPresetEditorOpenValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
  trust: z.union([z.literal('system'), z.literal('user')]),
  composition: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<Wire<AgentPresetEditorDocument>>

/** agentPreset.editorSave request payload. */
export const agentPresetEditorSaveRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
  composition: z.string().max(1024 * 1024),
  name: z.string().optional(),
  description: z.string().optional(),
  files: z.array(z.union([
    z.object({ kind: z.literal('mkdir'), path: z.string().min(1) }),
    z.object({ kind: z.literal('write-text'), path: z.string().min(1), content: z.string().max(1024 * 1024) }),
    z.object({ kind: z.literal('write-base64'), path: z.string().min(1), base64: z.string().max(22 * 1024 * 1024), executable: z.boolean().optional() }),
    z.object({ kind: z.literal('rename'), path: z.string().min(1), target: z.string().min(1) }),
    z.object({ kind: z.literal('delete'), path: z.string().min(1) }),
  ])).max(1000).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.editorSave'>>>

/** agentPreset.editorSave response value. */
export const agentPresetEditorSaveValueSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.editorSave'>>>

/** agentPreset.editorListFiles request payload. */
export const agentPresetEditorListFilesRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema, directory: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(1000).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.editorListFiles'>>>

/** agentPreset.editorListFiles response value. */
export const agentPresetEditorListFilesValueSchema = z.object({
  entries: z.array(z.object({ path: z.string(), type: z.union([z.literal('directory'), z.literal('file')]), size: z.number().int().nonnegative(), executable: z.boolean() })),
  nextCursor: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.editorListFiles'>>>

/** agentPreset.editorReadFile request payload. */
export const agentPresetEditorReadFileRequestSchema = z.object({ agentPreset: agentPresetReferenceSchema, path: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.editorReadFile'>>>

/** agentPreset.editorReadFile response value. */
export const agentPresetEditorReadFileValueSchema = z.union([
  z.object({ kind: z.literal('text'), path: z.string(), size: z.number().int().nonnegative(), content: z.string() }),
  z.object({ kind: z.literal('binary'), path: z.string(), size: z.number().int().nonnegative(), base64: z.string().max(22 * 1024 * 1024) }),
]) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.editorReadFile'>>>

/** agentPreset.editorTestRegex request payload. */
export const agentPresetEditorTestRegexRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
  entry: z.object({
    id: z.string().min(1), name: z.string().min(1), find: z.string(), replace: z.string(), flags: z.string().optional(),
    order: z.number().int().optional(), disabled: z.boolean().optional(), target: z.union([z.literal('request'), z.literal('response')]).optional(),
    roles: z.array(z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool')])).optional(),
    contentBlocks: z.array(z.union([z.literal('text'), z.literal('reasoning')])).optional(),
    minDepth: z.number().int().nonnegative().optional(), maxDepth: z.number().int().nonnegative().optional(),
    macroStrategy: z.union([z.literal('none'), z.literal('raw'), z.literal('escaped')]).optional(),
  }),
  text: z.string().max(1024 * 1024),
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.editorTestRegex'>>>

/** agentPreset.editorTestRegex response value. */
export const agentPresetEditorTestRegexValueSchema = z.object({
  output: z.string(), captures: z.array(z.string()), elapsedMs: z.number().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.editorTestRegex'>>>

/** agentPreset.openDocument request payload. */
export const agentPresetOpenDocumentRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.openDocument'>>>

/** agentPreset.openDocument response value. */
export const agentPresetOpenDocumentValueSchema = z.union([
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), path: z.string() }),
]) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.openDocument'>>>

/** agentPreset.remove request payload. */
export const agentPresetRemoveRequestSchema = z.object({
  agentPreset: agentPresetReferenceSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'agentPreset.remove'>>>

/** agentPreset.remove response value. */
export const agentPresetRemoveValueSchema = z.object({
}) satisfies z.ZodType<Wire<ResponseValue<'agentPreset.remove'>>>
