# Agent Note: Plugin inventory lifecycle controls

Status: implemented

English | [中文](2026-08-15-plugin-inventory-lifecycle-controls.zh.md)

## Problem

Web Settings **Plugin list** projected the Loader tree but was strictly read-only: a person could see an entry's effective enablement and root Fiber phase, and nothing else. Diagnosing a pending or failed plugin meant reading logs or opening `cordis.yml`, and stopping, starting, or restarting a plugin meant editing configuration or restarting the process. The tab name suggested management, but the surface could only observe.

## Decision

`@deepseek-ai/dsh-host-plugin-inventory` now projects per-entry runtime diagnostics alongside the existing Loader facts: the root Fiber display name, declared `inject` dependencies, missing dependencies, and the service names the entry's Fiber subtree provides. Every `list` snapshot also reports `mutationsEnabled`.

The gateway publishes three lifecycle Remotes behind the `allowMutations` Config field, which defaults to `false`; the `dsh-web-app` bundle sets it to `true`, so read-only deployments keep the previous surface and the product Web Settings gains the controls. `enable` and `disable` call the Loader tree's public `update()`, so the persisted row follows the action. `restart` calls the entry's `_dispose()` and `init()` primitives — the same primitives Loader's own `update()` composes — which reloads an enabled entry without rewriting its persisted options. The service refuses to manage itself, group rows, and entries disabled by an owning group. Each mutation returns the refreshed full snapshot, so the browser never patches the list from a second source of truth.

`@deepseek-ai/dsh-client-ui-settings-plugin-inventory` renders the diagnostics and, when `mutationsEnabled` is true, offers **Enable** for disabled entries and **Disable**/**Restart** for enabled ones. Destructive actions use a two-click confirm step inside the expanded card. A failed action shows a local generic alert and reloads the inventory without exposing transport details.

## Alternatives considered

**Keep the list read-only.** Rejected because the requested capability is management, and the Loader tree already owns the lifecycle primitives that make management safe to expose to the trusted Web Settings client.

**Manage dynamic Cordis plugins through `dsh-client-ui-cordis` instead.** Rejected because that panel operates the separate `cordis_define` registry owned by `dynamicCordisRunner`; it does not see, stop, or restart entries from the configured Loader tree.

**Dispose and recreate arbitrary registry fibers directly.** Rejected because the Loader entry is the authoritative lifecycle owner: its `update()` handles persisted disabled state, ancestor groups, import errors, and rollback, while a bare `fiber.dispose()` cannot restart and bypasses that authority.

**Restart through two public `update()` calls (`disabled: true`, then `disabled: null`).** Rejected because it rewrites the persisted row twice and leaves an intermediate disabled state on disk; `_dispose()` + `init()` is the same code path without persistence side effects. The private-surface dependency is recorded in the package README as a known limitation.

**Expose mutations unconditionally.** Rejected because read-only compositions should not gain a write path by upgrading a dependency; the explicit `allowMutations` opt-in keeps deployment authority visible in `cordis.yml`.

## Consequences

The Web Settings **Plugin list** is now an operational surface: it diagnoses pending dependencies and provided services, and enables, disables, or restarts individual Loader entries from the browser. Actions are deployment-wide and destructive ones require a second click.

The Remote vocabulary grew from one method to four, and `PluginInventorySnapshot` now carries diagnostics plus `mutationsEnabled`. Client code consumes the enlarged vocabulary through the existing [`api-remotes`](../../../../packages/api/remotes/README.md) assembly, which re-exports the new payload types. The previous read-only behavior remains reachable by leaving `allowMutations` unset.

Restart depends on Loader lifecycle internals (`_dispose`/`init`) that are not a separately versioned public API; the package README states this limitation. A user can disable or restart a transport, gateway, or sandbox entry and interrupt the very client that requested the action, which the two-click confirmation and README warning make explicit.

## Testing

Host unit tests cover projection, default mutation denial, enable/disable persistence through the Loader, restart without config rewrite, and rejection of unknown, group, and ancestor-disabled entries. A real-composition test boots a test-only `cordis.yml` through the vendored Loader and observes the durable file writes and apply count across restart, disable, and re-enable. Browser component tests cover diagnostics rendering, opt-in controls, two-click confirmation, and generic failure handling.
