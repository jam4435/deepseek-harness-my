# Agent Note: Plugin inventory lifecycle controls

Status: implemented

[English](2026-08-15-plugin-inventory-lifecycle-controls.md) | 中文

## Problem

Web 设置的**插件列表**投射了 Loader 树，但严格只读：用户只能看到条目的有效启用状态与根 Fiber 阶段，其余一概没有。要诊断 pending 或 failed 的插件，只能翻日志或打开 `cordis.yml`；要停用、启用或重启插件，只能改配置或重启进程。标签页名为列表，实际却只能观察。

## Decision

`@deepseek-ai/dsh-host-plugin-inventory` 现在在原有 Loader 事实之外，按条目投射运行时诊断：根 Fiber 显示名、声明的 `inject` 依赖、缺失依赖，以及该条目 Fiber 子树提供的服务名。每次 `list` 快照同时报告 `mutationsEnabled`。

网关在 `allowMutations` 配置之后发布三个生命周期 Remote，该配置默认 `false`；`dsh-web-app` 组合包将其设为 `true`。因此只读部署保持原有界面，而产品的 Web 设置获得操作能力。`enable` 与 `disable` 调用 Loader 树的公开 `update()`，持久化配置随操作变化。`restart` 调用条目的 `_dispose()` 与 `init()` 原语——正是 Loader 自己的 `update()` 所组合的原语——在不重写持久化配置的前提下重载已启用条目。服务拒绝管理自身、group 行以及被所属分组停用的条目。每次变更都返回刷新后的完整快照，浏览器不会从第二个事实来源拼接列表。

`@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 渲染这些诊断，并在 `mutationsEnabled` 为 true 时为已停用条目提供**启用**，为已启用条目提供**停用**/**重启**。破坏性操作需要在展开卡片内二次点击确认。操作失败时显示局部通用错误并重新读取清单，不暴露传输细节。

## Alternatives considered

**保持列表只读。** 否决，因为需求是管理，而且 Loader 树已经拥有把管理安全暴露给可信 Web 设置 Client 所需的生命周期原语。

**改为通过 `dsh-client-ui-cordis` 管理动态 Cordis 插件。** 否决，因为该面板操作的是 `dynamicCordisRunner` 拥有的独立 `cordis_define` 注册表；它看不到、也不能停用或重启配置 Loader 树中的条目。

**直接 dispose 并重建任意 registry fiber。** 否决，因为 Loader 条目才是权威生命周期所有者：它的 `update()` 处理持久化 disabled 状态、祖先分组、import 错误与回滚；裸 `fiber.dispose()` 无法重启，也绕过了这一权威。

**通过两次公开 `update()` 调用重启（先 `disabled: true`，再 `disabled: null`）。** 否决，因为会两次重写持久化行，并在磁盘上留下中间 disabled 状态；`_dispose()` + `init()` 是同一代码路径，却没有持久化副作用。对私有接口的依赖已作为已知限制写入包 README。

**无条件暴露变更能力。** 否决，因为只读组合不应仅仅因为升级依赖就获得写路径；显式的 `allowMutations` opt-in 让部署授权在 `cordis.yml` 中可见。

## Consequences

Web 设置的**插件列表**现在是操作界面：它能诊断缺失依赖与已提供服务，并可从浏览器启用、停用或重启单个 Loader 条目。操作作用于整个部署，破坏性操作需要二次点击。

Remote 词汇从 1 个方法增加到 4 个，`PluginInventorySnapshot` 现在携带诊断与 `mutationsEnabled`。Client 代码通过现有 [`api-remotes`](../../../../packages/api/remotes/README.md) 组合消费扩展后的词汇，该组合重新导出新的 payload 类型。保留 `allowMutations` 不设置即可维持旧的只读行为。

重启依赖 Loader 生命周期内部原语（`_dispose`/`init`），它们不是另行版本化的公开 API；包 README 已声明这一限制。用户可能停用或重启 transport、gateway、sandbox 等条目，从而中断正在发起请求的 Client；二次点击确认与 README 警告将这一点显式化。

## Testing

Host 单元测试覆盖投射、默认拒绝变更、通过 Loader 持久化 enable/disable、不重写配置的 restart，以及 unknown、group、ancestor-disabled 条目的拒绝。真实组合测试启动仅用于测试的 `cordis.yml`，穿过 vendored Loader 观察 restart、disable、re-enable 过程中的持久化文件写入与 apply 次数。浏览器组件测试覆盖诊断渲染、opt-in 控件、二次确认与通用失败处理。
