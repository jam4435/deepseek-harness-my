# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection of the current Cordis Loader tree with opt-in lifecycle controls. `PluginInventoryGateway` registers the `pluginInventory` service and publishes four generated direct Remotes: `pluginInventory/list`, `pluginInventory/enable`, `pluginInventory/disable`, and `pluginInventory/restart`.

Every `list` call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order. Each entry carries its Loader entry id, module specifier, effective enablement, root Fiber phase, root Fiber display name, declared `inject` dependencies, currently missing dependencies, and the service names the entry's Fiber subtree provides. The snapshot also reports `mutationsEnabled`; lifecycle Remotes reject calls when it is false.

Lifecycle controls are disabled by default and enabled through the `allowMutations` Config field (the Web app bundle sets it to `true`). `disable` and `enable` go through the Loader tree's own `update()` so persisted configuration follows the action. `restart` calls the entry's `_dispose()` and `init()` primitives directly, which reloads an enabled entry without rewriting its persisted options. The service refuses to manage itself, group rows, and entries disabled by an owning group.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation. Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **Restart depends on Loader lifecycle internals** — `_dispose()` and `init()` are the same primitives Loader's `update()` composes, but they are not a separately versioned public API.
- **No provenance or entry editing** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add, remove, or move entries.
- **Mutations are powerful** — disabling or restarting a transport, gateway, or sandbox entry can interrupt the very client that requested it; the browser UI confirms destructive actions, but the Remote trusts any client the deployment authorized.
