# `@deepseek-ai/dsh-request-options`

中文 | [English](README.md)

`dsh-request-options` 应用由预设拥有的可移植采样值。它只接受 `temperature`、`maxTokens` 和 `stop`，不会选择 provider 或 model。这使酒馆导入可以携带在 Harness 模型 provider 间具有相同含义的设置，同时不替换会话的 provider 选择。

```yaml
- id: request-options
  name: '@deepseek-ai/dsh-request-options'
  config:
    temperature: 0.7
    maxTokens: 1024
    stop: ['<END>']
```

插件只改变配置中明确出现的字段。`temperature` 必须为非负数，`maxTokens` 必须是正安全整数，每个停止序列均不能为空。最终请求头由 Agent Loop 记录。

## Model Experience

### 补全选项

#### What the model sees

所选 provider 会在支持时收到配置的采样选项。Provider 和 model 选择不属于本插件。

#### Token effect

`maxTokens` 限制生成的补全 token。`temperature` 和 `stop` 不增加提示 token，但会影响生成内容及停止位置。

#### KV Cache effect

独立于提示词前缀。采样选项不会改写请求消息，但 provider 缓存行为仍由 provider 自身决定。

## Known Limitations and Deferred Work

- **仅限可移植字段** — provider 专用采样器、provider 名称和 model ID 会作为保留的导入数据，而不是可执行的预设配置。
