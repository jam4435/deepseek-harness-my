# Agent Note: Immutable preset revisions and request-content transforms

Status: implemented

中文 | [English](2026-08-19-immutable-preset-revisions-and-request-content.md)

## Problem

Agent 运行期间，预设目录可能发生改变。若仅按 ID 再次解析目录，恢复会话、子代理或冷读取者就可能挂载与生成历史时不同的插件代码。提示词和正则适配器也需要改变模型请求，但不能把临时消息变成持久化聊天历史。

## Decision

`AgentPresetReference` 用不可变 ID 与 SHA-256 revision 标识预设。发布会在 `$DSH_HOME/.agent-preset-revisions` 下存放内容寻址 blob、清单和预设引用。会话头和选择事件存储完整引用。站立挂载把引用的文件物化到私有目录，以 `id@revision` 为键；Agent 和冷读取者持有 lease，最后一个 lease 释放后才销毁 Cordis 作用域和物化副本。删除自定义工作目录后，不可变 blob 与清单仍会保留。

普通 Agent Loop 会在调用 `agent/request-content` waterfall 前提交原始用户消息。提示词程序和请求阶段正则程序通过该 waterfall 返回修改后的请求副本。结果序列不同于普通派生历史时，Loop 写入 `request/messages`；`request/header` 继续记录最终 system 文本、工具和请求选项。回复阶段正则在持久化助手消息写入前运行。

## Durable records

`agent-preset/selected` 事件、会话头、恢复路径、分叉和子代理初始化均携带 `AgentPresetReference`，而不是 ID 字符串。旧字符串载荷不会被接受；会话格式保持版本零，因为产品在发布前不承诺兼容。

`request/messages` 是请求层快照，而不是聊天事件。历史投影会忽略它，回放会按 turn 和 step 找到它以重建模型请求。这使临时提示词条目和请求正则替换不会在后续回合累积。

## Alternatives considered

**把可编辑目录作为会话身份。** 未采用，因为外部编辑或删除会改变后续挂载看到的内容，使历史会话依赖可变文件系统状态。

**直接从 blob 仓库运行 revision。** 未采用，因为插件可能写入其已加载文件旁边。私有物化副本可保护不可变 revision 内容不受该类写入影响。

**把提示词条目追加为聊天事件。** 未采用，因为一次请求的提示词会进入历史、改变后续请求，并模糊用户输入与为单次请求合成消息之间的区别。

## Consequences

- 自定义预设保存时如 revision 已过期会失败，而不会合并或覆盖另一位编辑者的修改。
- 新会话使用最新发布 revision；已有会话、分叉、子代理和冷读取会保留精确 revision，直至其 lease 结束。
- 提示词和请求正则的改动可以影响单次请求的 token 使用和缓存前缀，而不会修改已存储的对话。
- 本版本永久保留 revision；不提供垃圾回收和版本历史界面。
