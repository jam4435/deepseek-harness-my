# Agent Note: Tool-bash deployment description override

Status: implemented

English | [中文](2026-08-15-tool-bash-description-config.zh.md)

## Problem

`dsh-tool-bash` generates its model-facing tool description from composition facts it can observe (`enableRunInBackground` and the mounted executor's sandbox capability). A deployment that swaps the shell executor — for example Windows Git Bash through `dsh-bash-local` — cannot teach the model environment-specific selection rules at tool-choice time, where such guidance belongs. The sibling [`dsh-tool-bash-persistent`](2026-07-29-persistent-bash-str-replace-editor.md) already exposes a configurable `description`, so the one-shot tool's absence is an inconsistency, and the only workaround pushed deployment facts into personas against the [tool-guidance ownership note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md).

## Decision

[`dsh-tool-bash`](../../../../packages/shell/tool-bash/README.md) gains an optional `description` config field. An omitted value keeps the generated `bashDescription(backgroundEnabled, escalationModes)` text byte-for-byte; a provided value replaces the complete model-facing tool description verbatim. An empty or whitespace-only value fails at load with `tool-bash: description must be non-empty`. The schema declares `description: z.string()` without a default so an absent key stays absent, matching the existing optional-config pattern of `enableRunInBackground` and the persistent bash twin's defaulted field.

The override is a complete replacement, not an appended fragment. A deployment that configures it owns the whole model-visible text, including background-job and sandbox-escalation semantics when those surfaces are active. The default shipped description is unchanged, so generated tool catalogs and existing schema snapshots stay unchanged.

This machine's `anchored-standard` preset uses the field to describe its Windows Git Bash executor and to direct repository-wide searches to the dedicated `grep`/`glob` tools.

## Alternatives considered

**Put the Windows Git Bash guidance in the default `bashDescription`.** Rejected: one environment's rules would become every platform's default text, and the resulting snapshot/catalog refresh spans the whole corpus for guidance most deployments do not need.

**Keep the guidance in the deployment persona or a system-prompt section.** Rejected: per-tool selection guidance lives in tool descriptions; prompt sections carry cross-call habits. The [ownership note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) records that split.

**Add a suffix or fragment field instead of a full override.** Rejected: a suffix cannot know whether it duplicates or contradicts the generated background/sandbox paragraphs, and a full override mirrors the sibling persistent tool's existing contract, giving one owner for the complete model-visible text.

## Consequences

- Deployments can describe their shell environment exactly where the model chooses tools, without changing the shipped default or its token cost.
- The field is an all-or-nothing override: a deployment that omits run-in-background or sandbox semantics must restate them, and an empty value fails loudly instead of silently showing a misleading description.
- The local Windows Git Bash experiment can embed the "prefer `grep`/`glob`, never recursive bash `grep -R`" rule in the tool description, closing the node_modules-traversal timeout failure mode at the decision point.
