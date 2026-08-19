# `@deepseek-ai/dsh-regex-program`

English | [中文](README.zh.md)

`dsh-regex-program` runs preset-authored replacements in short-lived Node workers. Scripts are data (`find`, `replace`, and flags); they cannot execute arbitrary JavaScript. Request transforms receive only the copy sent to the model. Response transforms run after stream assembly and before `assistant/message` is committed, so replay sees the same transformed text.

The defaults are 100 ms per script, 500 ms per phase, 256 scripts, 1 MiB input, and 2 MiB output. Invalid expressions, timeouts, and limit violations fail the turn and identify the entry instead of being silently ignored.

```yaml
- id: regex-program
  name: '@deepseek-ai/dsh-regex-program'
  config:
    entries:
      - id: strip-marker
        name: Strip marker
        find: '\\[internal\\]'
        replace: ''
        flags: g
        target: request
        roles: [user]
        contentBlocks: [text]
        minDepth: 0
        macroStrategy: raw
        disabled: false
    limits:
      perScriptMs: 100
      stageMs: 500
```

`roles`, `contentBlocks`, `minDepth`, and `maxDepth` narrow which request or response data a script can change. `macroStrategy` is `none`, `raw`, or `escaped`; it controls replacement text only and does not evaluate a template. Only regular-expression replacement data is accepted. The worker never evaluates a script string or a macro. Display-only rewrites and in-place edits of earlier history are not provided. Set `disabled: true` to retain a script while bypassing it.

## Model Experience

### Enabled request replacements

#### What the model sees

The worker replaces matching content in the selected request-copy messages and system text. The durable chat history stays unchanged.

#### Token effect

Conditional. A replacement can add, remove, or preserve request tokens, bounded by the configured output-byte limit.

#### KV Cache effect

Replacing a request message changes the affected request suffix. The plugin does not alter an earlier cached history record.

### Enabled response replacements

#### What the model sees

Nothing from a response-stage replacement reaches the model for the turn that produced it. The transformed assistant text becomes durable history for later requests.

#### Token effect

Indirect. The replacement changes tokens in later model requests only when those requests include the transformed assistant message.

#### KV Cache effect

Later requests containing a transformed assistant message have a different history prefix from one containing the untransformed response.

## Known Limitations and Deferred Work

- **No display-only mode** — a response replacement changes the durable assistant message; the plugin does not provide a separate rendered-only transformation.
