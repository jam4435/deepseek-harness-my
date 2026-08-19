/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-wallpaper`.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-wallpaper'

/** Cordis companion plugin name. */
export const name = 'client-ui-wallpaper-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the wallpaper is a pure presentation contribution
 * whose only effect is its injected stylesheet; that stylesheet's asset is
 * pinned by this package's client test, and removal is owned by the module
 * loader's plugin-style cleanup.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
