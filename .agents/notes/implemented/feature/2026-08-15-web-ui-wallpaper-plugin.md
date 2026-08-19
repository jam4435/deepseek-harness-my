# Agent Note: Web UI wallpaper plugin

Status: implemented

English | [中文](2026-08-15-web-ui-wallpaper-plugin.zh.md)

## Problem

The web UI had no background-image surface. A JPEG placed at the repository root (`.bgimg/background.jpg`) was never referenced by any plugin, stylesheet, or manifest, so no browser could display it. A wallpaper belongs to the client plugin graph — a browser plugin's styles can only arrive through its `lib/client.js` bundle — and that bundle has no companion asset route: the client module host serves only `client.js` and `client.js.map`.

## Decision

Ship [`@deepseek-ai/dsh-client-ui-wallpaper`](../../../../packages/client/ui-wallpaper/README.md) as a pure presentation plugin: `inject = []`, an empty `apply`, and a side-effect `background.module.css` import. The web bundle mounts it as the `ui-wallpaper` roster row, the client aggregate references the package, and the bundle declares the workspace dependency.

The stylesheet paints the bundled image on the two viewport-wide base surfaces through the slot-render anchor contract: `[data-slot='root'] > div` for the app frame and `[data-slot='conversation'] > [data-phase]` for the conversation column. Both rules share `background-attachment: fixed`, `background-size: cover`, and `background-position: center`, so the two surfaces read as one viewport-aligned wallpaper; `background-color: var(--dsw-alias-bg-base)` stays underneath and keeps the theme palette the color authority. The sidebar and details columns keep their opaque fills, so their copy stays readable over the image.

The JPEG lives at `packages/client/ui-wallpaper/src/client/background.jpg`, and `packages/client/ui-wallpaper/scripts/gen-background-css.mjs` regenerates the stylesheet with the image embedded as a data URI. Embedding is required because the module host has no route for a plugin-owned asset file; the shared CSS-Modules pipeline injects the generated rule as a `<style data-plugin>` tag at materialization, and HMR removes and re-injects it with the fiber ([loading model](../architecture/2026-07-23-client-plugin-loading-model.md)). `tests/background-image.client.spec.ts` pins the stylesheet's data URI against the source image, so a replaced image cannot silently diverge from the generated CSS.

## Alternatives considered

**Serve the image from `apps/web/public` and reference `/background.jpg`.** This keeps the bundle small, but it moves the asset into an app-owned static directory that a published plugin package cannot declare, and a missing file fails as a silent no-image background instead of a build-time test.

**Extend ui-theme or the shell's base stylesheet.** The theme package owns shared tokens and global sheets; putting one person's wallpaper there makes the shared sheet carry an image asset and removes the roster switch and HMR lifecycle a plugin provides.

**Make the frame and conversation surfaces transparent and paint `body`.** This needs cross-package overrides of each opaque shell surface and makes dark-mode contrast depend on the image; painting the same fixed image on the two base surfaces keeps the existing palette and leaves the sidebar and details untouched.

**A Config field for the image.** A configurable URL or path still needs an asset-serving route and a settings surface; with one shipped image those are speculative, and the generator plus pin test make the asset swap a deliberate rebuild.

## Consequences

The shipped wallpaper appears over the app frame and conversation column, not over the sidebar or details columns. The data URI adds roughly 322 KB to `lib/client.js` (about 240 KB gzipped) on the browser load path. Changing the image is a package rebuild (`gen:css`, then `bundle`), not a profile override. A server that started before this package joined the roster keeps serving its old graph — plugin-set changes take effect on restart — so the running process must restart once for the wallpaper row to appear.
