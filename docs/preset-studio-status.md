# Preset Studio Reference

English | [中文](preset-studio-status.zh.md)

Preset Studio is the graphical editor for the existing `agent-presets` format. It creates a custom directory, edits its Cordis composition and companion files, and publishes an immutable revision for each successful create, import, or save. It does not replace the Cordis loader or create a second preset format.

## Create and edit a preset

Open **Settings → Agent Presets**, then choose a custom preset or open a system preset for read-only inspection. Create a blank preset for an empty composition, copy a preset to start from its full directory, or import one SillyTavern JSON file with a selected Harness base preset. A system preset must be copied before editing.

The studio page has a preset roster, an editor navigation column, and a fixed save bar. Overview edits the display name and description. Composition edits the plugin tree and keeps Source available for advanced YAML. Prompt and Regex use cards for ordinary entries; their enable switches preserve disabled entries. Files stages safe directory and file operations with the composition and metadata for one save.

## Versions and sessions

Every published directory becomes a SHA-256 revision. File blobs and manifests live under `$DSH_HOME/.agent-preset-revisions`; a mount is a private materialized copy, never the revision store itself. A session records `{ id, revision }`, so new sessions use the current revision while resumed, forked, and child sessions keep their exact revision. Removing a custom working directory does not delete its immutable revisions.

Saving requires the revision opened by the studio. A changed working directory produces a conflict instead of replacing another editor's work. The editor can reload the current revision or keep its local draft outside the save operation. The studio has no revision-history or rollback UI.

## Prompt, regex, and request options

Prompt entries are request-only System, User, or Assistant messages at `before-history`, `after-history`, or `depth` positions. They never rewrite the durable chat history. The request input is recorded as a `request/messages` snapshot when it differs from ordinary history, allowing replay to reconstruct the model-visible messages.

Regex entries run in an isolated Node worker. Request replacements affect only the request copy; response replacements run before the final assistant message is stored. Invalid expressions, timeouts, and byte-limit violations fail the affected turn with the entry id. The runtime does not run JavaScript, provide display-only rewrites, or mutate previous history.

`request-options` applies portable `temperature`, `maxTokens`, and `stop` values without choosing a provider or model. See the package references for [prompt programs](../packages/preset/prompt-program/README.md), [regex programs](../packages/preset/regex-program/README.md), and [request options](../packages/preset/request-options/README.md).

## SillyTavern import

The Host parses one JSON document without executing macros, templates, extensions, or scripts. It preserves the original JSON and a conversion report in the new preset. The report identifies exact conversion, approximation, preserved data, and rejected data.

| Source data | Result |
| --- | --- |
| Chat Completion prompts, order, role, enabled state, relative position, and depth | Prompt-program entries |
| Context and System Prompt strings | System prompt entries |
| Instruct static wrappers and stops | Role-filtered regex entries and request options |
| Independent regex files and replacement macros | Regex-program entries where fields have an equivalent |
| Temperature, max tokens, and stops | Request options |
| Provider, model, extension data, character/world-book/unknown macros | Retained source data and compatibility report |

An import always creates a new custom preset. It cannot merge into or overwrite an existing one, and it must select a Harness base preset.

## Safety limits

Authoring and content APIs are loopback-privileged. Paths are normalized preset-relative POSIX paths; links, junction-like links, special files, absolute paths, and traversal are rejected. Reserved composition, metadata, and `.dsh` paths are managed by their dedicated pages rather than generic file operations.

The default limits are 1 MiB for text, 16 MiB per binary attachment, 64 MiB per save payload, and 256 MiB or 10,000 entries per revision. File-size checks use UTF-8 byte length and decoded Base64 bytes.

## Known limitations

- The composition editor offers native pointer drag-and-drop and move controls; full touch and keyboard drag semantics require the dedicated accessibility implementation.
- Advanced YAML is available when a configuration cannot be represented by the ordinary controls; plugin `Config` inspection and generated Schemastery forms are not yet exposed through the Host API.
- The current file surface stages operations safely but does not yet provide the planned lazy directory tree or CodeMirror editor.
