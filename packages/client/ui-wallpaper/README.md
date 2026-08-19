# @deepseek-ai/dsh-client-ui-wallpaper

English | [中文](README.zh.md)

The web UI wallpaper plugin. It is a pure presentation package with no services, config, or components: importing its CSS module injects one plugin-owned stylesheet that paints the bundled `background.jpg` over the app frame and the conversation column. The sidebar and details columns keep their own opaque fills, so their content stays readable over the image.

The two rules target the slot-render anchor contract — `[data-slot='root'] > div` for the app frame and `[data-slot='conversation'] > [data-phase]` for the conversation column — and share one `background-attachment: fixed` image, so the two surfaces read as a single viewport-aligned wallpaper. `background-color: var(--dsw-alias-bg-base)` stays behind the image and keeps the theme palette the color authority.

The image is embedded as a data URI inside the CSS module because the client module host serves only `lib/client.js` and its source map for each plugin — a companion asset file would have no HTTP route. The shared tsdown CSS-Modules pipeline injects the stylesheet as a `<style data-plugin="@deepseek-ai/dsh-client-ui-wallpaper">` tag at materialization, and HMR removes and re-injects it with the fiber.

## Model Experience

None, as the wallpaper is a browser-only visual style; no content here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Fixed bundled image** — replacing the image means updating `src/client/background.jpg`, running `pnpm --filter @deepseek-ai/dsh-client-ui-wallpaper gen:css`, and rebuilding `lib/client.js`; the package test fails while the stylesheet and source image drift.
- **Not configurable per deployment** — the plugin carries no Config, so changing the image is a package rebuild, not a profile override.
- **Bundle size cost** — the JPEG's base64 payload adds roughly 322 KB to `lib/client.js` (about 240 KB gzipped); a companion asset route would remove it but needs a client-modules serving change.
