# `@deepseek-ai/dsh-prompt-program`

English | [中文](README.zh.md)

`dsh-prompt-program` adds ordered, role-aware messages to a single model request without rewriting the session's chat history. An entry is a System, User, or Assistant message placed before history, after history, or at a non-negative history depth. Entries at the same position sort by `order` and then by their stable `id`. `enabled: false` retains an entry without sending it.

```yaml
- id: prompt-program
  name: '@deepseek-ai/dsh-prompt-program'
  config:
    entries:
      - id: safety
        name: Safety reminder
        role: system
        position: before-history
        order: 10
        content: Follow the workspace safety policy.
        enabled: true
      - id: format
        name: Response format
        role: user
        position: depth
        depth: 0
        order: 20
        content: Answer with a short checklist.
```

`id` values are unique within one plugin row and use letters, digits, hyphens, or underscores. Duplicate ids, unsupported roles or positions, negative depth, and non-integer order fail preset loading. The optional `variables` map only replaces explicitly mapped Harness values (`session-id`, `turn`, and `step`); an unmapped SillyTavern-style macro remains literal text.

The plugin runs on `agent/request-content`. It receives the ordinary history and current user input, produces a request-only message sequence, and never appends a synthetic chat message. When that sequence differs from the ordinary history, the agent loop records a `request/messages` snapshot for the turn and step so replay can reproduce the model input.

## Model Experience

### Enabled request entries

#### What the model sees

Each enabled entry becomes one request message with its configured role and UTF-8 content at its configured position. Disabled entries and unknown macros contribute no transformed data.

#### Token effect

Conditional. Each enabled entry adds its message tokens to the current model request; entries do not accumulate into later chat history.

#### KV Cache effect

Position-dependent. A stable `before-history` entry can remain in a reusable request prefix, while changes to an entry or inserting it after history changes the affected request suffix.

## Known Limitations and Deferred Work

- **Mapped variables only** — the program does not obtain character cards, world books, or arbitrary template values; unmapped macros remain visible literal text.
