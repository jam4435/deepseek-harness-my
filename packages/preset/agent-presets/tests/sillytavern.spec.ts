import { describe, expect, it } from 'vitest'
import { inspectSillyTavernPreset } from '@deepseek-ai/dsh-agent-presets'

describe('SillyTavern import preview', () => {
  it('converts prompt ordering, roles, sampling, and embedded regex scripts without executing them', () => {
    const preview = inspectSillyTavernPreset(JSON.stringify({
      temperature: 0.7,
      openai_max_tokens: 800,
      model: 'tavern-model',
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: 'Stay in character as {{char}}.' },
        { identifier: 'late', name: 'Late', role: 'user', content: 'Answer briefly.', injection_depth: 1, injection_order: 3 },
        { identifier: 'history', name: 'History', marker: true },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'late', enabled: false }] }],
      replacement_macros: { regex_scripts: [{ id: 'strip', scriptName: 'Strip tag', findRegex: '/\\[tag\\]/g', replaceString: '', disabled: false }] },
    }))

    expect(preview.kind).toBe('chat-completion')
    expect(preview.prompts).toEqual([
      expect.objectContaining({ id: 'main', role: 'system', enabled: true, position: 'after-history', order: 0 }),
      expect.objectContaining({ id: 'late', role: 'user', enabled: false, position: 'depth', depth: 1, order: 1 }),
    ])
    expect(preview.regexes).toEqual([expect.objectContaining({ id: 'strip', find: '\\[tag\\]', flags: 'g' })])
    expect(preview.sampling).toEqual({ temperature: 0.7, maxTokens: 800 })
    expect(preview.issues).toContainEqual(expect.objectContaining({ disposition: 'preserved', subject: 'prompts.history' }))
    expect(preview.issues).toContainEqual(expect.objectContaining({ subject: 'model', disposition: 'preserved' }))
    expect(preview.issues).toContainEqual(expect.objectContaining({ subject: 'prompts.main.macros', disposition: 'preserved' }))
  })

  it('converts static Instruct framing while retaining template limits in the report', () => {
    const preview = inspectSillyTavernPreset(JSON.stringify({ input_sequence: '<|user|>', output_sequence: '<|assistant|>' }))

    expect(preview.kind).toBe('instruct')
    expect(preview.regexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sillytavern-input_sequence', roles: ['user'], target: 'request' }),
      expect.objectContaining({ id: 'sillytavern-output_sequence', roles: ['assistant'], target: 'request' }),
    ]))
  })

  it('accepts a standalone regex script array', () => {
    const preview = inspectSillyTavernPreset(JSON.stringify([
      { scriptName: 'Strip tag', findRegex: '/tag/g', replaceString: '', disabled: true },
    ]))

    expect(preview.kind).toBe('regex')
    expect(preview.regexes).toEqual([expect.objectContaining({ name: 'Strip tag', disabled: true })])
  })

  it('rejects an unrelated non-object JSON value', () => {
    expect(() => inspectSillyTavernPreset('[]')).toThrow('one JSON object or regex script array')
  })
})
