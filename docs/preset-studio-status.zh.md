# 预设工作室参考

[English](preset-studio-status.md) | 中文

预设工作室是现有 `agent-presets` 格式的图形编辑器。它创建自定义目录、编辑其中的 Cordis 组合和附属文件，并在每次成功创建、导入或保存时发布一个不可变 revision。它不会替换 Cordis Loader，也不会创建第二套预设格式。

## 创建和编辑预设

打开**设置 → Agent Presets**，选择一个自定义预设，或以只读方式打开系统预设。可以创建空白预设、复制一个预设的完整目录，或选择 Harness 底座预设后导入一个酒馆 JSON 文件。系统预设必须先复制，才能编辑。

工作室页面包含预设列表、编辑导航列和固定保存栏。概览编辑显示名称与描述；组合编辑插件树，源码作为高级 YAML 入口保留；提示词和正则使用卡片处理普通条目，开关会保留被关闭的条目；文件将安全的目录和文件操作与组合及元数据暂存到同一次保存中。

## 版本和会话

每个发布的目录都会成为 SHA-256 revision。文件 blob 与清单存放在 `$DSH_HOME/.agent-preset-revisions`；挂载使用私有的物化副本，而不是直接运行 revision 仓库。会话记录 `{ id, revision }`，因此新会话使用当前 revision，恢复、分叉和子代理会保持精确 revision。删除自定义工作目录不会删除不可变 revision。

保存需要带上工作室打开时的 revision。工作目录已发生变化时会产生冲突，而不是替换另一位编辑者的修改。编辑器可以重新加载当前 revision，或在保存操作之外保留本地草稿。工作室不提供版本历史或回滚 UI。

## 提示词、正则与请求选项

提示词条目是只作用于请求的 System、User 或 Assistant 消息，位置可为 `before-history`、`after-history` 或 `depth`。它们不会改写持久化聊天历史。当请求输入不同于普通历史时，会记录 `request/messages` 快照，使回放能重建模型实际看到的消息。

正则条目在隔离的 Node Worker 内执行。请求替换只影响请求副本；回复替换在最终助手消息保存之前执行。非法表达式、超时和字节限制超出都会使受影响的回合以条目 ID 失败。运行时不执行 JavaScript、不提供仅显示替换，也不修改旧历史。

`request-options` 在不选择 provider 或 model 的前提下应用可移植的 `temperature`、`maxTokens` 和 `stop`。详见 [提示词程序](../packages/preset/prompt-program/README.md)、[正则程序](../packages/preset/regex-program/README.md) 和 [请求选项](../packages/preset/request-options/README.md)。

## 酒馆导入

Host 会解析一个 JSON 文档，但不会执行宏、模板、扩展或脚本。原始 JSON 与转换报告会保存在新预设中。报告区分精确转换、近似转换、保留数据和拒绝数据。

| 源数据 | 结果 |
| --- | --- |
| Chat Completion prompts、顺序、角色、启用状态、相对位置和深度 | 提示词程序条目 |
| Context 和 System Prompt 字符串 | System 提示词条目 |
| Instruct 静态包装与停止序列 | 角色过滤的正则条目和请求选项 |
| 独立正则文件与 replacement macros | 存在等价字段时转为正则程序条目 |
| Temperature、max tokens 和 stops | 请求选项 |
| Provider、model、扩展数据、角色/世界书/未知宏 | 保留源数据和兼容报告 |

导入总是创建新的自定义预设，不能合并到或覆盖已有预设，并且必须选择 Harness 底座预设。

## 安全限制

作者和内容 API 仅授予 loopback 特权客户端。路径必须是规范化的预设相对 POSIX 路径；链接、类似 junction 的链接、特殊文件、绝对路径和目录穿越都会被拒绝。保留的组合、元数据和 `.dsh` 路径由对应页面管理，不能通过通用文件操作改写。

默认限制为：文本 1 MiB，单个二进制附件 16 MiB，单次保存载荷 64 MiB，单个 revision 256 MiB 或 10,000 个目录项。文件大小使用 UTF-8 字节数和 Base64 解码后的真实字节数检查。

## 已知限制

- 组合编辑器提供原生指针拖放和移动控制；完整触屏及键盘拖拽语义仍需要专门的无障碍实现。
- 高级 YAML 用于普通控件无法表示的配置；插件 `Config` 检查和自动生成的 Schemastery 表单尚未通过 Host API 提供。
- 当前文件界面会安全暂存操作，但尚未提供计划中的懒加载目录树或 CodeMirror 编辑器。
