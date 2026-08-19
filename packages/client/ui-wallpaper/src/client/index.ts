/**
 * Web wallpaper plugin, browser half: a pure style contribution. Importing the
 * CSS module injects the plugin-owned stylesheet at factory execution; the
 * plugin declares no services and waits for nothing.
 */
import './background.module.css'

/** Required services: none. */
export const inject = []

/** Client plugin body — the module import above is the whole effect. */
export function apply(): void {}
