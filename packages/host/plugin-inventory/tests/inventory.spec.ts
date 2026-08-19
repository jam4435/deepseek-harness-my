import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = (ctx) => {
  ctx.provide('marker', {})
}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(allowMutations = false): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  ctx.loader.builtins.group = Group
  await ctx.plugin(PluginInventoryGateway, { allowMutations })
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct Remote per inventory operation under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual(expect.arrayContaining([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'enable', invocation: { kind: 'direct' } },
      { method: 'disable', invocation: { kind: 'direct' } },
      { method: 'restart', invocation: { kind: 'direct' } },
    ]))
  })

  it('projects current non-group Loader entries with runtime diagnostics without a second cache', async () => {
    const { ctx, inventory } = await harness(true)
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:group', group: true, config: [] })

    const snapshot = inventory.list()
    expect(snapshot.mutationsEnabled).toBe(true)
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
        fiberName: 'activePlugin',
        dependencies: [],
        waitingFor: [],
        providedServices: ['marker'],
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
        fiberName: 'Loader',
        dependencies: ['neverReady'],
        waitingFor: ['neverReady'],
        providedServices: [],
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
        fiberName: null,
        dependencies: [],
        waitingFor: [],
        providedServices: [],
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    const disabled = inventory.list().entries.find(entry => entry.entryId === activeId)
    expect(disabled).toMatchObject({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
      fiberName: null,
      dependencies: [],
      waitingFor: [],
      providedServices: [],
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('reports mutations disabled and rejects lifecycle Remotes by default', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    expect(inventory.list().mutationsEnabled).toBe(false)
    await expect(inventory.disable(activeId)).rejects.toThrow('plugin lifecycle mutations are disabled by this deployment')
    await expect(inventory.enable(activeId)).rejects.toThrow('plugin lifecycle mutations are disabled by this deployment')
    await expect(inventory.restart(activeId)).rejects.toThrow('plugin lifecycle mutations are disabled by this deployment')
  })

  it('disables and re-enables one entry through the Loader', async () => {
    const { ctx, inventory } = await harness(true)
    const activeId = await ctx.loader.create({ name: 'cordis:active' })

    const disabled = await inventory.disable(activeId)
    expect(disabled.entries.find(entry => entry.entryId === activeId)).toMatchObject({
      enabled: false,
      fiberPhase: null,
      providedServices: [],
    })

    const enabled = await inventory.enable(activeId)
    expect(enabled.entries.find(entry => entry.entryId === activeId)).toMatchObject({
      enabled: true,
      fiberPhase: 'active',
      providedServices: ['marker'],
    })
  })

  it('restarts one enabled entry in place', async () => {
    const { ctx, inventory } = await harness(true)
    let applies = 0
    const countingPlugin: Plugin.Object = {
      name: 'counting-plugin',
      apply() { applies += 1 },
    }
    ctx.loader.builtins.counting = countingPlugin
    const countingId = await ctx.loader.create({ name: 'cordis:counting' })
    expect(applies).toBe(1)

    const restarted = await inventory.restart(countingId)
    expect(applies).toBe(2)
    expect(restarted.entries.find(entry => entry.entryId === countingId)).toMatchObject({
      enabled: true,
      fiberPhase: 'active',
      fiberName: 'counting-plugin',
    })
  })

  it('rejects unknown, group, and ancestor-disabled entries with actionable errors', async () => {
    const { ctx, inventory } = await harness(true)
    const groupId = await ctx.loader.create({ name: 'cordis:group', group: true, config: [] })
    const nestedId = await ctx.loader.create({ name: 'cordis:active' }, groupId)
    const disabledGroupId = await ctx.loader.create({
      name: 'cordis:group',
      group: true,
      config: [],
      disabled: true,
    })
    const ancestorId = await ctx.loader.create({ name: 'cordis:active' }, disabledGroupId)

    await expect(inventory.disable('missing')).rejects.toThrow('unknown plugin entry "missing"')
    await expect(inventory.disable(groupId)).rejects.toThrow('is a group and has no direct lifecycle')
    await expect(inventory.disable(nestedId)).resolves.toBeDefined()
    await expect(inventory.enable(ancestorId)).rejects.toThrow('is disabled by an owning group')
  })
})
