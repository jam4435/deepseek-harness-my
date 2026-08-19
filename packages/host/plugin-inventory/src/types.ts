import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** Lifecycle mutation a trusted client may request for one plugin entry. */
export type PluginInventoryAction = 'enable' | 'disable' | 'restart'

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /** Display name of the entry's root Fiber, or null when it has none. */
  readonly fiberName: string | null
  /** Services the root Fiber declared in `inject`. */
  readonly dependencies: readonly string[]
  /** Declared services that are still unavailable, in declaration order. */
  readonly waitingFor: readonly string[]
  /** Services provided by the entry's root Fiber subtree. */
  readonly providedServices: readonly string[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  /** Whether this deployment enabled `enable`, `disable`, and `restart` Remotes. */
  readonly mutationsEnabled: boolean
  readonly entries: readonly PluginInventoryEntry[]
}
