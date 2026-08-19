/** Projection and lifecycle controls for the current Cordis Loader plugin entries. */

import type { Context, Fiber, FiberState } from '@deepseek-ai/cordis'
import { isJsExpr } from '@deepseek-ai/cordis-plugin-loader'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Gateway configuration. */
export interface Config {
  /** Enable the `enable`, `disable`, and `restart` Remotes. */
  allowMutations?: boolean
}

type ResolvedConfig = Required<Config>

/**
 * Whether a fiber is `root` itself or mounted anywhere inside `root`'s subtree.
 * @param fiber - the fiber to locate.
 * @param root - the subtree root to test against.
 * @returns true when `fiber` belongs to that subtree.
 */
function withinFiber(fiber: Fiber, root: Fiber): boolean {
  let current = fiber
  while (true) {
    if (current === root) return true
    const parent = current.parent.fiber
    if (parent === current) return false
    current = parent
  }
}

/**
 * Service names provided by one mount's fiber subtree.
 * @param ctx - the runtime whose service registrations are inspected.
 * @param root - the root of the mounted fiber subtree.
 * @returns the provided service names in lexical order.
 */
function providedServices(ctx: Context, root: Fiber): string[] {
  const store = ctx.reflect.store
  return Object.getOwnPropertySymbols(store)
    .map(key => store[key])
    .filter((impl): impl is NonNullable<typeof impl> => impl !== undefined && withinFiber(impl.fiber, root))
    .map(impl => impl.name)
    .sort()
}

/** Whether an entry's own disabled option currently evaluates to true. */
function locallyDisabled(entry: Entry): boolean {
  const raw = entry.options.disabled
  if (raw === true) return true
  return isJsExpr(raw) && Boolean(entry.evaluate(raw.__jsExpr))
}

/** Whether an entry is disabled only because an owning group is disabled. */
function ancestorDisabled(entry: Entry): boolean {
  return entry.disabled && !locallyDisabled(entry)
}

/**
 * Project one non-group Loader entry into its wire form. Reads Loader-owned
 * fiber state directly so no second lifecycle cache can fall out of sync.
 * @param ctx - the runtime whose service store annotates the fiber.
 * @param entry - the Loader entry to project.
 * @returns the serializable entry snapshot.
 */
function projectEntry(ctx: Context, entry: Entry): PluginInventoryEntry {
  const fiber = entry.fiber
  const dependencies = fiber === undefined ? [] : Object.keys(fiber.inject)
  const waitingFor = fiber === undefined
    ? []
    : dependencies.filter(service => ctx.get(service) === undefined)
  // `entry.fiber` is Cordis's PromiseLike wrapper around the raw Fiber, while
  // `impl.fiber` records the raw Fiber, so compare against `ctx.fiber`.
  const services = fiber === undefined ? [] : providedServices(ctx, fiber.ctx.fiber)
  return {
    entryId: pluginEntryId(entry.id),
    moduleName: entry.options.name,
    enabled: !entry.disabled,
    fiberPhase: fiber === undefined ? null : FIBER_PHASE[fiber.state],
    fiberName: fiber?.name ?? null,
    dependencies,
    waitingFor,
    providedServices: services,
  }
}

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  static Config: Schema<Config> = Schema.object({
    allowMutations: Schema.boolean().default(false),
  })

  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginInventory')
    this.resolved = config as ResolvedConfig
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push(projectEntry(this.ctx, entry))
    }
    return { mutationsEnabled: this.resolved.allowMutations, entries }
  }

  /**
   * Enable one previously disabled plugin entry.
   * @param entryId - exact Loader-tree entry id.
   * @returns the refreshed inventory snapshot after the entry started.
   */
  @Remote('enable')
  async enable(entryId: string): Promise<PluginInventorySnapshot> {
    this.requireMutations()
    const entry = this.requireEntry(entryId)
    if (!entry.disabled) return this.list()
    if (ancestorDisabled(entry)) {
      throw new Error(`plugin entry "${entry.id}" is disabled by an owning group; enable that group first`)
    }
    await this.ctx.loader.update(entry.id, { disabled: null })
    return this.list()
  }

  /**
   * Disable one plugin entry while keeping its configuration.
   * @param entryId - exact Loader-tree entry id.
   * @returns the refreshed inventory snapshot after the entry stopped.
   */
  @Remote('disable')
  async disable(entryId: string): Promise<PluginInventorySnapshot> {
    this.requireMutations()
    const entry = this.requireEntry(entryId)
    this.requireManageable(entry)
    if (entry.disabled) return this.list()
    await this.ctx.loader.update(entry.id, { disabled: true })
    return this.list()
  }

  /**
   * Restart one enabled plugin entry in place. `_dispose()` and `init()` are
   * the entry lifecycle primitives Loader's own `update()` composes; using
   * them directly restarts without rewriting the entry's persisted options.
   * @param entryId - exact Loader-tree entry id.
   * @returns the refreshed inventory snapshot after the entry reloaded.
   */
  @Remote('restart')
  async restart(entryId: string): Promise<PluginInventorySnapshot> {
    this.requireMutations()
    const entry = this.requireEntry(entryId)
    this.requireManageable(entry)
    if (entry.disabled) throw new Error(`plugin entry "${entry.id}" is disabled; enable it before restarting`)
    if (entry.fiber === undefined) {
      await entry.init()
    } else {
      await entry._dispose()
      await entry.init()
    }
    return this.list()
  }

  private requireMutations(): void {
    if (this.resolved.allowMutations) return
    throw new Error('plugin lifecycle mutations are disabled by this deployment')
  }

  private requireEntry(entryId: string): Entry {
    let entry: Entry
    try {
      entry = this.ctx.loader.resolve(entryId)
    } catch (cause) {
      throw new Error(`unknown plugin entry "${entryId}"`, { cause })
    }
    if (entry.options.group) {
      throw new Error(`plugin entry "${entryId}" is a group and has no direct lifecycle`)
    }
    return entry
  }

  private requireManageable(entry: Entry): void {
    if (entry.fiber === this.ctx.fiber) {
      throw new Error(`plugin entry "${entry.id}" is the plugin inventory service and cannot manage itself`)
    }
  }
}

export default PluginInventoryGateway
