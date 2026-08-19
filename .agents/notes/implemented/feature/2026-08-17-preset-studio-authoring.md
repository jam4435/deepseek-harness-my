# Agent Note: Preset studio authoring

Status: implemented

English | [中文](2026-08-17-preset-studio-authoring.zh.md)

## Problem

Copying a preset provided a safe starting point, but required a native editor for ordinary metadata and composition changes. The settings page could not create an empty preset, expose a concurrent edit, or make the current composition inspectable and editable in one local workflow.

## Decision

The preset settings section provides a local Preset studio. It creates empty presets, copies existing presets, opens system presets read-only, and edits a custom preset's `preset.yml` metadata plus complete `agent.cordis.yml` source. The editor occupies the settings page with a preset roster, editor navigation, and fixed save bar. The composition panel exposes nested plugin groups, independent disabled switches, add/delete, move controls, and pointer drag across groups; Prompt and Regex provide ordinary entry cards; Source remains the fallback for advanced YAML. The file panel stages safe relative-path operations with the same atomic save. `editorOpen` and `editorSave` use an exact immutable preset reference and reject a stale revision. The editor is loopback-pinned with the other roster-authoring calls.

The revision traversal accepts only regular files and directories below the resolved custom root. It includes relative paths and owner-execute bits in the digest, and rejects links and special entries. System presets remain immutable. The current studio deliberately keeps `preset.yml` and `agent.cordis.yml` under their overview/composition editors; other files use normalized POSIX paths and cannot traverse links or leave the preset root.

The same authoring surface previews one SillyTavern JSON object or standalone regex array without executing macros, scripts, or extension data. Chat Completion prompt entries and regex scripts are converted into independently switchable runtime records; import creation appends the prompt, safe-regex, and portable request-options adapters to the copied base and stores the source and report under `.dsh/sillytavern/`. The prompt adapter changes a request-only message sequence that the agent loop snapshots as `request/messages`; the regex adapter evaluates only replacement data in short-lived workers with per-script, stage, input, output, and count limits.

## Alternatives considered

**Keep copy-only authoring.** It avoids browser-supplied composition text but makes basic preset maintenance depend on an external editor and cannot report concurrent changes before they are overwritten.

**Let the browser write an arbitrary path.** The browser supplies only a preset id; Host resolves the custom root. Accepting a path would turn the preset editor into a general filesystem write API.

## Consequences

- A custom editor shows a conflict rather than using last-write-wins semantics.
- A YAML source editor is the complete fallback for Cordis features and `!!js`; the browser never evaluates an expression.
- Binary files are represented as bounded Base64 for transport and download; the browser does not execute or preview arbitrary binary content.
- Imported provider/model-specific fields remain source-only compatibility data; only provider-neutral sampling and the supported prompt/regex records affect runtime requests.
