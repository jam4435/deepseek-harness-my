# Agent Note: Immutable preset revisions and request-content transforms

Status: implemented

English | [中文](2026-08-19-immutable-preset-revisions-and-request-content.zh.md)

## Problem

A preset directory can change while an agent is running. Resolving the directory again by id would mount different plugin code for a resumed session, child agent, or cold transcript reader than the code that produced its history. Prompt and regular-expression adapters also need to alter a model request without turning temporary messages into durable chat history.

## Decision

`AgentPresetReference` identifies a preset by its immutable id and SHA-256 revision. Publication stores content-addressed blobs, a manifest, and a preset reference under `$DSH_HOME/.agent-preset-revisions`. A session header and selection event store that complete reference. A standing mount materializes the referenced files into a private directory and is keyed by `id@revision`; agents and cold readers hold a lease, and the Cordis scope plus materialization are disposed after the final lease releases. Immutable blobs and manifests remain after a custom working directory is removed.

The ordinary agent loop commits the raw user message before it invokes the `agent/request-content` waterfall. Prompt programs and request-stage regex programs return an altered request copy through that waterfall. The loop writes `request/messages` when the resulting sequence differs from ordinary derived history, while `request/header` continues to record the final system text, tools, and request options. Response-stage regex programs run before the durable assistant message is appended.

## Durable records

The `agent-preset/selected` event, session header, restoration path, fork, and child-agent setup carry `AgentPresetReference`, not an id string. Old string payloads are not accepted; the session format stays at version zero because the product has no compatibility promise before release.

`request/messages` is a request-layer snapshot rather than a chat event. History projection ignores it, and replay identifies it by turn and step when reconstructing a model request. This keeps temporary prompt entries and request replacements from accumulating through later turns.

## Alternatives considered

**Use the editable directory as the session identity.** Rejected because an external edit or deletion changes what a later mount sees and makes a historical session dependent on mutable filesystem state.

**Run a revision directly from the blob store.** Rejected because a plugin can write beside its loaded files. A private materialization protects immutable revision content from that mutation.

**Append prompt entries as chat events.** Rejected because a one-request prompt then becomes history, changes later requests, and obscures whether a message was entered by the user or synthesized for one request.

## Consequences

- A custom preset save fails on a stale revision instead of merging or overwriting another editor's changes.
- New sessions use the latest published revision, while existing sessions, forks, children, and cold reads retain their exact revision until their lease ends.
- Prompt and request-regex changes can alter token usage and cache prefixes for one request without modifying the stored conversation.
- Revision retention is permanent in this release; there is no garbage collector or version-history interface.
