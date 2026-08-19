# `@deepseek-ai/dsh-request-options`

English | [中文](README.zh.md)

`dsh-request-options` applies portable sampling values owned by a preset. It accepts only `temperature`, `maxTokens`, and `stop`; it never chooses a provider or model. This lets a SillyTavern import carry settings that have the same meaning across Harness model providers without replacing the session's provider selection.

```yaml
- id: request-options
  name: '@deepseek-ai/dsh-request-options'
  config:
    temperature: 0.7
    maxTokens: 1024
    stop: ['<END>']
```

The plugin changes only fields explicitly present in its config. `temperature` must be non-negative, `maxTokens` must be a positive safe integer, and each stop sequence must be non-empty. The final request header is recorded by the agent loop.

## Model Experience

### Completion options

#### What the model sees

The selected provider receives the configured sampling options when it supports them. Provider and model selection remain outside this plugin.

#### Token effect

`maxTokens` caps generated completion tokens. `temperature` and `stop` do not add prompt tokens, but can change the generated completion and its stopping point.

#### KV Cache effect

Independent of the prompt prefix. Sampling options do not rewrite request messages, although provider cache behavior remains provider-owned.

## Known Limitations and Deferred Work

- **Portable fields only** — provider-specific samplers, provider names, and model ids remain preserved import data rather than executable preset configuration.
