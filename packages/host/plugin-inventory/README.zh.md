# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

当前 Cordis Loader 树的 Host 投影，并提供可开关的生命周期操作。`PluginInventoryGateway` 注册 `pluginInventory` 服务，并发布四个由 Typert 生成的直接 Remote：`pluginInventory/list`、`pluginInventory/enable`、`pluginInventory/disable` 与 `pluginInventory/restart`。

每次 `list` 调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，再按 Loader 顺序返回其余条目。每个条目包含 Loader 条目 id、模块标识、有效启用状态、根 Fiber 阶段、根 Fiber 显示名、声明的 `inject` 依赖、当前缺失的依赖，以及该条目 Fiber 子树提供的服务名。快照同时报告 `mutationsEnabled`；当它为 false 时，生命周期 Remote 会拒绝调用。

生命周期操作默认关闭，通过 `allowMutations` 配置开启（Web App 组合包将其设为 `true`）。`disable` 与 `enable` 走 Loader 树自身的 `update()`，因此持久化配置会跟随操作变化。`restart` 直接调用条目的 `_dispose()` 与 `init()` 原语，在不重写持久化配置的前提下重载已启用条目。服务拒绝管理自身、group 行以及被所属分组停用的条目。

该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.md) 组合消费它，而不导入 Host 实现。公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

## 模型体验

无，因为这个仅限 Host 的清单投影不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **仅表示调用当下** —— 结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **重启依赖 Loader 生命周期内部原语** —— `_dispose()` 与 `init()` 正是 Loader 自己的 `update()` 所组合的原语，但它们并不是另行版本化的公开 API。
- **无来源与条目编辑能力** —— 服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加、移除或移动条目。
- **变更能力强大** —— 停用或重启 transport、gateway、sandbox 等条目可能中断正在发起请求的 Client；浏览器 UI 会二次确认破坏性操作，但 Remote 本身信任部署已授权的任何 Client。
