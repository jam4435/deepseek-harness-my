# `@deepseek-ai/dsh-prompt-program`

中文 | [English](README.md)

`dsh-prompt-program` 为单个模型请求加入可排序、带角色的消息，不会改写会话中的聊天历史。条目可为 System、User 或 Assistant 消息，并放在历史前、历史后或非负的历史深度。相同位置的条目按 `order`、再按稳定的 `id` 排序。`enabled: false` 会保留条目但不发送。

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

同一插件行内的 `id` 必须唯一，只能使用字母、数字、连字符和下划线。重复 ID、不支持的角色或位置、负深度及非整数顺序都会使预设加载失败。可选 `variables` 映射只会替换显式映射的 Harness 值（`session-id`、`turn`、`step`）；未映射的酒馆式宏会保持原样。

插件运行在 `agent/request-content` 上。它接收普通历史和当前用户输入，生成仅供本次请求使用的消息序列，不会写入合成的聊天消息。当该序列不同于普通历史时，Agent Loop 会为相应 turn 和 step 记录 `request/messages` 快照，供恢复和回放重建模型输入。

## Model Experience

### 已启用的请求条目

#### What the model sees

每个已启用条目都会以其配置的角色和 UTF-8 内容，在配置的位置作为一条请求消息提供给模型。禁用条目和未知宏不会产生转换后的数据。

#### Token effect

条件性影响。每个已启用条目都会为当前模型请求增加消息 token；条目不会累积到后续聊天历史中。

#### KV Cache effect

取决于位置。稳定的 `before-history` 条目可以保留在可复用的请求前缀中；修改条目或在历史后插入条目会改变受影响的请求后缀。

## Known Limitations and Deferred Work

- **仅支持映射变量** — 程序不会取得角色卡、世界书或任意模板值；未映射的宏会作为可见文本保留。
