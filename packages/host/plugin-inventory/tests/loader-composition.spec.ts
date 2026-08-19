/**
 * REAL-composition coverage: a test-only cordis.yml booted through the real
 * Loader mounts the inventory gateway beside a fixture plugin file, and the
 * assertions observe the durable outcomes — the projected runtime diagnostics,
 * a restart that does not rewrite the fixture row, and disable/enable writes
 * that do.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import PluginInventoryGateway from '../src/index.ts'

declare global {
  var __dshPluginInventoryFixtureApplies: number | undefined
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
  globalThis.__dshPluginInventoryFixtureApplies = undefined
})

async function bootComposition(): Promise<{ ctx: Context; configPath: string; fixtureId: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(join(root, 'fixture.mjs'), [
    "export const name = 'fixture-plugin'",
    'export function apply(ctx) {',
    '  globalThis.__dshPluginInventoryFixtureApplies = (globalThis.__dshPluginInventoryFixtureApplies ?? 0) + 1',
    "  ctx.provide('fixture-marker', {})",
    '}',
    '',
  ].join('\n'))
  await writeFile(configPath, [
    '- id: fixture',
    "  name: './fixture.mjs'",
    '- id: inventory',
    "  name: '@deepseek-ai/dsh-host-plugin-inventory'",
    '  config:',
    '    allowMutations: true',
    '',
  ].join('\n'))

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string): Promise<unknown> {
      if (specifier === '@deepseek-ai/dsh-host-plugin-inventory') return PluginInventoryGateway
      if (specifier.startsWith('.')) {
        const baseUrl = ctx.baseUrl
        if (baseUrl === undefined) throw new Error('Loader composition requires a baseUrl')
        return import(new URL(specifier, baseUrl).href)
      }
      throw new Error(`unexpected Loader import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  context = ctx
  const fixtureId = [...ctx.loader.entries()].find(entry => entry.options.name === './fixture.mjs')!.id
  return { ctx, configPath, fixtureId }
}

describe('real Loader composition', () => {
  it('projects, restarts, disables, and re-enables a file-backed entry', { timeout: 60_000 }, async () => {
    const { ctx, configPath, fixtureId } = await bootComposition()
    expect(globalThis.__dshPluginInventoryFixtureApplies).toBe(1)

    const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
    const initial = inventory.list()
    expect(initial.mutationsEnabled).toBe(true)
    expect(initial.entries.find(entry => entry.entryId === fixtureId)).toMatchObject({
      moduleName: './fixture.mjs',
      enabled: true,
      fiberPhase: 'active',
      fiberName: 'fixture-plugin',
      dependencies: [],
      waitingFor: [],
      providedServices: ['fixture-marker'],
    })

    const restarted = await inventory.restart(fixtureId)
    expect(globalThis.__dshPluginInventoryFixtureApplies).toBe(2)
    expect(restarted.entries.find(entry => entry.entryId === fixtureId)?.fiberPhase).toBe('active')
    expect(await readFile(configPath, 'utf8')).not.toContain('disabled')

    const disabled = await inventory.disable(fixtureId)
    expect(disabled.entries.find(entry => entry.entryId === fixtureId)).toMatchObject({
      enabled: false,
      fiberPhase: null,
    })
    await expect.poll(async () => await readFile(configPath, 'utf8')).toContain('disabled: true')

    const enabled = await inventory.enable(fixtureId)
    expect(globalThis.__dshPluginInventoryFixtureApplies).toBe(3)
    expect(enabled.entries.find(entry => entry.entryId === fixtureId)).toMatchObject({
      enabled: true,
      fiberPhase: 'active',
      providedServices: ['fixture-marker'],
    })
    await expect.poll(async () => await readFile(configPath, 'utf8')).not.toContain('disabled')
  })
})
