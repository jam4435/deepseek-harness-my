# `@deepseek-ai/dsh-regex-program`

中文 | [English](README.md)

`dsh-regex-program` 在短生命周期 Node Worker 中运行预设定义的替换脚本。脚本只是 `find`、`replace` 和 flags 数据，不会执行任意 JavaScript。请求阶段只处理发送给模型的副本；回复阶段在流组装完成、写入 `assistant/message` 之前执行，因此恢复时看到的仍是同一份转换文本。

默认限制为单脚本 100 毫秒、单阶段 500 毫秒、256 条脚本、输入 1 MiB、输出 2 MiB。非法表达式、超时和限制超出都会让本轮失败并指出具体条目，不会静默跳过。

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

`roles`、`contentBlocks`、`minDepth` 和 `maxDepth` 可以缩小脚本能改变的请求或回复数据范围。`macroStrategy` 可为 `none`、`raw` 或 `escaped`；它只控制替换文本，不会执行模板。插件只接受正则替换数据，不执行脚本字符串或宏。它不提供仅改变显示的重写，也不会原地修改历史。设置 `disabled: true` 可以保留脚本但暂时停用。

## Model Experience

### 已启用的请求替换

#### What the model sees

Worker 会替换选中请求副本消息和系统文本中的匹配内容。持久化聊天历史保持不变。

#### Token effect

条件性影响。替换可以增加、删除或保留请求 token，并受配置的输出字节限制约束。

#### KV Cache effect

替换请求消息会改变受影响的请求后缀。插件不会修改较早的缓存历史记录。

### 已启用的回复替换

#### What the model sees

回复阶段替换不会在产生该回复的本轮到达模型。转换后的助手文本会成为后续请求的持久化历史。

#### Token effect

间接影响。只有后续模型请求包含转换后的助手消息时，替换才会改变这些请求的 token。

#### KV Cache effect

包含转换后助手消息的后续请求，与包含未转换回复的请求具有不同的历史前缀。

## Known Limitations and Deferred Work

- **没有仅显示模式** — 回复替换会改变持久化助手消息；插件不提供独立的仅渲染转换。
