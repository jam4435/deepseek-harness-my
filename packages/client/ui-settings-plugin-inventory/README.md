# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

**Plugin list** tab for Web Settings with lifecycle controls. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. It performs no Remote read during plugin activation. Selecting the tab for the first time mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

The tab renders a searchable two-column catalog of compact disclosure cards. Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id without a redundant field label, the effective configuration, Cordis status, root Fiber display name, declared dependencies, missing dependencies, and provided services. Search covers module specifier, entry id, Fiber name, dependency names, and provided services.

When the Host enables mutations, expanded cards offer `enable` for disabled entries and `disable`/`restart` for enabled ones. Destructive actions use a two-click confirm step inside the card, and every action accepts the refreshed Host snapshot so the visible state comes from the same Loader read. Action failures show a local generic alert and reload the inventory without exposing transport details. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and failure states stay local to the mounted component. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes and mutates a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount, action, or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.
- **No provenance or entry editing** — local search does not add provenance, current-browser activation diagnosis, or controls to add, move, or reconfigure entries.
- **Actions are deployment-wide** — a confirmation click stops or restarts the entry for every browser and session, not only the viewer's tab.
