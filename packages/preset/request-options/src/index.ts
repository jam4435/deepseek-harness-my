/** Apply portable preset request options without choosing a provider or model. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'

/** Cordis row name. */
export const name = 'request-options'

/** Generic sampling fields safe to import independently of a model provider. */
export interface Config {
  /** Sampling temperature when the selected adapter supports it. */
  temperature?: number
  /** Maximum tokens requested for one completion. */
  maxTokens?: number
  /** Sequences that stop the current completion. */
  stop?: string[]
}

/** Schema shared by Cordis loading and preset-plugin inspection. */
export const Config: z<Config> = z.object({
  temperature: z.number().min(0),
  maxTokens: z.number().min(1),
  stop: z.array(z.string().min(1)),
})

/**
 * Apply only explicitly configured portable options. Provider and model remain
 * selected by the running session, never by an imported preset.
 * @param ctx - the agent-scoped Cordis context.
 * @param config - options supplied by the preset composition.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.maxTokens !== undefined && !Number.isSafeInteger(config.maxTokens)) {
    throw new Error('request-options: maxTokens must be an integer')
  }
  const stop = config.stop === undefined ? undefined : [...config.stop]
  ctx.on('agent/request', async (_payload, next) => {
    const current = await next()
    return {
      ...current,
      ...config.temperature === undefined ? {} : { temperature: config.temperature },
      ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
      ...stop === undefined ? {} : { stop },
    }
  })
}
