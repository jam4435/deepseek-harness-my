# DeepSeek Harness 插件开发指南

> 本文从 `F:\deepseek-harness` 仓库（`docs/` 目录官方文档）中提取并整理：编写一个新的 Harness 插件前，你需要了解的全部内容。
>
> 适用读者：希望为 Harness 本身编写插件（由 `cordis.yml` 加载、在 Web UI 中驱动、可作为组合包安装）的开发者。
>
> 文档来源：`docs/cordis-primer.zh.md`、`docs/cordis-tutorial/01~07`、`docs/user/develop/basic|framework|practice`、`docs/cordis-api/context.zh.md`、`docs/capability-seams.zh.md`、`docs/architecture.zh.md`、`docs/cookbook/adding-a-tool.zh.md`、`docs/cookbook/extension-cookbook.zh.md`、`docs/glossary.zh.md`。

---

## 目录

1. [核心概念：Cordis 与插件模型](#1-核心概念cordis-与插件模型)
2. [第一个插件：最小可运行结构](#2-第一个插件最小可运行结构)
3. [插件的三种形态](#3-插件的三种形态)
4. [生命周期、Fiber 状态机与副作用](#4-生命周期fiber-状态机与副作用)
5. [服务：提供能力与声明依赖](#5-服务提供能力与声明依赖)
6. [事件：插件间的通信与分发模式](#6-事件插件间的通信与分发模式)
7. [配置：Schema 校验与默认值](#7-配置schema-校验与默认值)
8. [上下文 API（ctx）速查](#8-上下文-apictx速查)
9. [开发一个模型工具（defineTool）](#9-开发一个模型工具definetool)
10. [编写 LLM 适配器](#10-编写-llm-适配器)
11. [能力的三种角色设计（seam）](#11-能力的三种角色设计seam)
12. [Harness 内置服务与能力 seam 一览](#12-harness-内置服务与能力-seam-一览)
13. [扩展点速查：功能 → 机制](#13-扩展点速查功能--机制)
14. [事件域与轮次流程](#14-事件域与轮次流程)
15. [组合：cordis.yml、profile 与组合包](#15-组合cordisymlprofile-与组合包)
16. [加载与诊断（PENDING、HMR）](#16-加载与诊断pendinghmr)
17. [打包、安装与发布](#17-打包安装与发布)
18. [关键约束与常见错误](#18-关键约束与常见错误)
19. [权威参考索引](#19-权威参考索引)
20. [预设工作室与酒馆导入](#20-预设工作室与酒馆导入)

---

## 1. 核心概念：Cordis 与插件模型

Harness 的底层是一个以 vendor 方式引入的插件框架 **Cordis**。产品的每一部分都是插件：包括模型适配器、工具注册表、文件访问、会话日志，甚至 agent loop 本身。因此每一部分都可以通过配置替换，**不存在需要打补丁的特权内核**——扩展 dsh 的方式就是把插件挂载到其他插件旁边。

### 五个核心概念

1. **插件是实现 Service 的对象。** 它可以是一个带有可选 `inject` 和 `apply(ctx)` 字段的函数，也可以是一个 `Service` 子类；其生命周期由 Cordis 挂载到当前上下文。
2. **上下文是服务的容器。** 一个服务占据一个稳定的 `ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）；其他插件通过 key 查找服务，而非导入具体实现。
3. **通过 `inject` 声明服务依赖。** 插件声明所需服务后，会等待这些服务就绪才启动；加载顺序由服务依赖表达，而非手动编排启动序列。
4. **类型化事件用于通信。** 服务通过 TypeScript 声明合并注册事件名，再以 `emit`、`waterfall`、`parallel`、`serial` 或 `bail` 方式分发。
5. **注册是可逆的副作用。** 提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时会按预期撤销。

### 实践规则

- 将行为封装为插件：工具流水线事件属于 `ctx.tools`，模型流式输出属于 `ctx.llm`，实时 agent 协调属于 `ctx.agents`。
- 拦截和策略优先使用**事件**；直接能力调用优先使用**服务方法**。
- 每个注册都应有对应的 disposer（资源释放函数）：要么从 `ctx.effect()` 返回一个，要么使用 Cordis 提供的辅助方法自动处理。

---

## 2. 第一个插件：最小可运行结构

在 Harness 中，**插件是一个导出 `apply` 函数的 TypeScript 模块**。框架加载时调用 `apply`，传入 `ctx`（上下文对象），你通过 `ctx` 注册能力：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'   // 可选显示元数据，用于诊断

export function apply(ctx: Context) {
  console.log('[hello-plugin] plugin loaded!')
}
```

### 注册到 cordis.yml

在仓库根目录创建本地项目（`scratch-plugin/src/my-plugin.ts`），再创建一个 Web 覆盖层 `scratch-plugin/cordis.yml`：

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

插件路径**必须是绝对路径**（patch 文件只贡献配置，不改变 loader 解析模块路径时使用的 profile 目录）。用覆盖层启动：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

打开 `http://127.0.0.1:3080`，启动时终端会打印 `[hello-plugin] plugin loaded!`。

---

## 3. 插件的三种形态

| 形态 | 写法 | 适用场景 |
|---|---|---|
| **函数** | `export function apply(ctx){}` | 最常见，大多数情况足够 |
| **对象** | `export default { name, inject, apply(ctx){} }` | 需要装进一个对象时 |
| **类** | `export default class X extends Service { constructor(ctx){ super(ctx,'key') } }` | 需要向其他插件**提供服务**时 |

函数形态示例（含 `inject`）：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* ... */)
}
```

类形态（提供服务）：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['llm']   // 服务也可以依赖其它服务

  constructor(ctx: Context) {
    super(ctx, 'myService')  // 服务名
    // 同步初始化写在构造函数里
  }
}
```

---

## 4. 生命周期、Fiber 状态机与副作用

### Fiber 状态机

每个被加载的插件都拥有一个 **Fiber** 作用域：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

| 状态 | 含义 |
|---|---|
| PENDING | 已声明，但所需依赖未就绪（`inject` 的服务还没出现） |
| LOADING | 依赖就绪，正在执行 `apply` |
| ACTIVE | 插件运行中 |
| FAILED | `apply` 或配置校验抛出异常 |
| UNLOADING / DISPOSED | disposer 正在运行 / 已完全拆除 |

### 自动清理机制

通过 `ctx` 注册的任何东西，在插件卸载时都会**自动撤销**，无需手动 `removeListener` 或 `clearInterval`：

- `ctx.on(event, handler)` — 事件监听
- `ctx.tools.register(tool)` — 工具注册
- `ctx.llm.registerAdapter(names, adapter)` — LLM 适配器注册
- `ctx.plugin(child)` — 子插件随父插件一起 dispose
- `ctx.effect(() => cleanup)` — 自定义资源

### 包装自定义资源

对于 Cordis 不管理的资源（网络连接、第三方监听等），用 `ctx.effect()` 包装并返回 disposer：

```ts
export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => console.log('heartbeat'), 5000)
    return () => clearInterval(timer)   // 插件卸载时运行
  })
}
```

> **顺序注意事项**：disposer 按注册顺序的**逆序**启动，但多个**异步** disposer 会并发运行，不保证逐个完成。存在顺序依赖的清理步骤必须放进同一个 `ctx.effect()` 返回的 disposer 里，由它串行等待。

### dispose 语义

```ts
const fiber = ctx.plugin(myPlugin)
await fiber.dispose()
```

`dispose()` 保证：① 该插件的所有注册被移除；② 子插件被递归卸载；③ 返回的 Promise 在所有异步清理完成后兑现。

### 依赖驱动的加载

声明了 `inject` 的插件会等待所有必需服务就绪。若依赖的服务在运行期间消失（例如提供方被替换），插件会被自动卸载（ACTIVE → DISPOSED），待服务恢复后重新加载。

---

## 5. 服务：提供能力与声明依赖

**服务**是一个插件提供、其他插件通过 `ctx` 消费的具名能力。在 Harness 中，`ctx.tools`、`ctx.llm`、`ctx.agents` 都是服务。消费方只指定 `'tools'` 之类的键，不导入其提供方，因此配置可以替换提供方而无需改动消费方。

### 提供服务（类形态）

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService      // 声明合并，让 ctx.metrics 有类型
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')        // 注册为 'metrics' 服务
  }
  record(event: string, value: number) { /* ... */ }
}

export function apply(ctx: Context) {
  ctx.plugin(MetricsService)
}
```

运行时 `super(ctx, 'metrics')` 注册实例；编译时 `declare module` 让 `ctx.metrics` 通过类型检查。**声明合并不生成任何运行时接线**——插件必须另行提供服务。

### 消费服务：必需依赖与可选依赖

```ts
// 必需：服务缺失时插件不加载（保持 PENDING）
export const inject = ['tools']

// 可选：省略 inject，在用点探测
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)   // undefined 时插件仍运行
}
```

> **命名**：每个应用中的服务名称共用一个扁平命名空间。请为自有服务加有辨识度的前缀或命名空间（Harness 已占用 `tools`、`llm` 等普通名称）。

### 服务隔离（isolate）

`cordis.yml` 支持服务隔离——同一个服务有多个实例，不同插件组看到不同实例：

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config: { timeoutMs: 5000 }
    - name: './src/plugin-a.ts'
```

---

## 6. 事件：插件间的通信与分发模式

服务支持直接调用；**事件**让插件无需知道有哪些监听者就能发出通知。Harness 大量使用事件处理工具结果、模型请求、审批决定等。

### 分发模式

| 模式 | 调用 | 语义 |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同步广播；不等待、不收集返回值 |
| parallel | `await ctx.parallel(name, ...args)` | 所有监听器并发运行，一同等待 |
| serial | `await ctx.serial(name, ...args)` | 监听器顺序运行并等待；第一个非 `null`/`false`/`undefined` 返回值胜出并停止 |
| bail | `ctx.bail(name, ...args)` | serial 的同步版本 |
| waterfall | `ctx.waterfall(name, ...args, next)` | 环绕中间件，见下文 |

### waterfall：转换或短路

waterfall 是实现**拦截**的模式。每个监听器收到参数和一个 `next()` continuation：可以转换 `next()` 的返回值，也可以不调用 `next()` 直接返回以**短路**链条（Cordis 称为"否决"）。

```ts
ctx.on('demo/transform', async (input, next) => {
  const downstream = await next()
  return downstream.toUpperCase()          // 包装下游结果
})

ctx.on('demo/transform', async (input, next) => {
  if (input.includes('blocked')) return '** blocked **'  // 短路
  return next()
})
```

> **纪律**：只负责观察或标注的 waterfall 监听器**必须调用 `next()`**；不调用即代表有意短路。日志监听器忘记 `next()` 会静默吞掉所有下游默认行为。

Harness 用 waterfall 处理协作插件可包装或回答的决策：`agent/request` 允许替换模型调用配置，`approval/request` 允许策略代替用户作答。

### 类型安全的事件（声明合并）

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

Harness 事件遵循 `namespace/action` 命名（如 `agent/step`、`tools/result`、`session/event`）。

> **重要区分**：`turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*` 是**持久化的会话事件类型**（`session/event` 事件流里 `event.type` 的取值），**不是**同名 Cordis 事件。观察它们要监听 `session/event` 并检查 `event.type`。

---

## 7. 配置：Schema 校验与默认值

`cordis.yml` 中每个配置项可携带 `config` 块，插件声明一个 schema，在 `apply` 前验证。错误配置会导致加载失败并给出准确错误。

```ts
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)   // 用户值或 schema 默认值
}
```

要点：

- 导出的 `Config` 既是 TypeScript 接口，也是同名运行时 schema（消费方得到类型，Cordis 得到验证器）。
- 必须用 [Schemastery](https://github.com/shigma/schemastery) 定义 schema（Cordis 接受任意 [Standard Schema](https://standardschema.dev/) 验证器）。**不要导出普通对象作为 `Config`**。
- 对严格校验用 `.required()`、`Schema.union([...])` 等。
- **无硬编码可调参数**：凡是不同部署可能取不同值的参数，都必须定义为配置字段。
- **配置错误要响亮**：在 schema 中表达自身完备的约束，使无效配置在加载时失败。
- 配置变更会触发 HMR（卸载旧实例、加载新实例）。

### 计算得到的配置值（`!!js`）

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js` 仅在 `config` 与条目 `disabled` 字段内有效；`disabled: !!js ...` 在每次挂载决策时求值，可用平台或环境门控一行。

---

## 8. 上下文 API（ctx）速查

上下文是 Cordis 核心对象，所有服务、事件、生命周期 API 都通过 `ctx` 访问。它是一个代理：普通属性读取走服务解析器；`extend()`、`isolate()`、`intercept()` 会创建有作用域的子上下文。

### 生命周期与作用域

| API | 说明 |
|---|---|
| `ctx.effect(fn)` | 挂载一个副作用，`fn` 返回的 disposer 在卸载时运行 |
| `ctx.plugin(child)` | 挂载子插件，返回 fiber（可 `dispose()`） |
| `ctx.on(ev, cb)` | 注册事件监听（自动清理） |
| `ctx.extend(meta?)` | 创建携带额外元数据的子上下文（原型继承，不改父级） |
| `ctx.isolate(name, label?)` | 为服务 `name` 创建独立作用域的子上下文 |
| `ctx.intercept(name, config)` | 为下游插件添加服务专属拦截配置 |
| `ctx.root` | 应用根上下文（@experimental） |

### 服务读写（反射层）

| API | 说明 |
|---|---|
| `ctx.get(name, strict?)` | 读服务，无需 inject；未提供返回 `undefined` |
| `ctx.set(name, value)` | 覆盖已提供服务（仅提供方 fiber 可设置） |
| `ctx.provide(name, value)` | 注册归当前 fiber 所有的服务实现，返回 disposer |
| `ctx.accessor(name, {get,set})` | 由 get/set 钩子支持的计算属性 |
| `ctx.mixin(name, mixins)` | 在 ctx 上直接公开服务的指定成员 |

### 内置成员

`ctx.events`（事件总线）、`ctx.logger(name)`（具名日志）、`ctx.reflect`（反射层）、`ctx.registry`（插件注册表）、`ctx.baseUrl`。

---

## 9. 开发一个模型工具（defineTool）

在文件系统、网络等能力之上提供模型可调用的工具。完整约定以 `docs/cookbook/adding-a-tool.md` 为准。

### 最小形态

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',         // 模型看到的内容
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                    // 默认可选
    },
    output: {
      schema: { type: 'string' },                   // 规范值 schema
      render: (_args, value) => [{ type: 'text', text: value }],  // 面向模型的内容
    },
    async execute(args, exec) {
      // args 从 schema 推导并校验；exec 携带不可变身份 + token，signal 是可操作字段
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

`defineTool` 将 `parameters` 规约转为面向模型展示的 JSON Schema，推导 `args` 类型，并在 `execute` 前校验参数；`execute` 返回 `output.schema` 声明的规范值；`output.render` 是 Native renderer，把值转为可持久化的结果内容。schema 自动流入系统提示词组装。

### execute() 约定的关键规则

- **参数已校验**：`defineTool` 会在 `execute` 前根据统一 `ParameterSchemaSpec` 校验模型参数（类型、必填键、字面量约束、联合恰好匹配一个分支、嵌套值）。无法用 schema DSL 表达的约束（如非空字符串、正数、跨字段规则）仍需手动检查。
- **执行身份受保护**：注册表将 `arguments` 物化为分离的无损 JSON 并冻结；`callId`、`name`、`arguments`、`token`、必填且由调用方持有的 `signal` 在整个分发过程不可变。把 `args` 当只读输入；只有 around-dispatch 包装器能替换 `exec.signal`。
- **声明并返回规范 JSON 值**：`output.schema` 根可以是对象、数组、标量或 null。工具主体不要返回内容块，也不要迫使调用方从自然语言解析 id。
- **抛异常或返回无效值 = `isError`**：基础设施故障抛异常；成功的领域结果（即使表示不理想状态，如进程非零退出）应写入规范值并在 render 中解释。
- **遵守 `exec.signal`**：信号触发时取消进行中的工作。
- **`output.presentationMeta(args, value)`（可选）**：从同一规范值派生可回放的 JSON，供 UI 卡片持久化。
- **`exec.agent.inject(...)` 发送异步通知**：追加持久化上下文，下一次模型请求会看到它（不是唤醒）。

### 长时间运行的工作（后台任务）

通过 producer 配置控制 `run_in_background`，用 `ctx.jobs.start({ kind, label, owner: exec.agent, run })` 注册。成功后台分支返回类型化规范句柄 `{ kind: 'background', jobId }`。任务发布 id 后，用任务自有取消信号而非 `exec.signal`（取消外层调用只停止等待，不终止已发布工作；该生命周期归 `job_kill`、owner dispose 和服务 teardown）。

### Code Mode

每个可见注册工具都可通过 `await tools.<name>(args)` 调用，无需额外集成。成功调用解析为策略处理后的规范 JSON 值（非渲染内容）；失败以 `ToolCallError` reject。把 `output.schema` 设计为实用的程序化 API。

### UI 卡片渲染

`presentCall(args)` 返回 PENDING 卡片（`generic`/`terminal`/`diff`）；`presentResult(args, {content, isError, meta?})` 返回完成卡片（`generic`/`terminal`/`diff`/`search`/`web`）。硬性规则：

- **纯函数**：这些方法在实时流和日志回放时都会运行，必须是无 I/O、不读会话状态、不用时钟/随机数的纯函数。
- **UI 格式不进入模型结果**：diff、相对化路径等不应仅为服务 UI 而进入规范值。

### 工具执行策略与观测扩展点

| 扩展点 | 用途 |
|---|---|
| `tools/pre-execute` | 可扩展的允许/拒绝/询问策略（type 化决策） |
| `ctx.tools.guard()` | 最终单调拒绝（后续监听器无法撤销） |
| `tools/execute` | 加截止时间、重试、指标 |
| `tools/post-execute` | 替换展示内容/返回值、阻止结果、附加上下文 |
| `tools/result` | 观测不可变的归一化结果（不改变它） |

---

## 10. 编写 LLM 适配器

LLM 适配器是继承 `LlmAdapter` 并实现 `stream()` 的类：把 Harness 提供方无关请求转为具体提供方 API 调用，把响应转回 Harness 分片。

```ts
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. options.messages → 提供方格式
    // 2. 调用流式 API
    // 3. 响应 → StreamChunk
  }
}

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(config.providers, new MyAdapter(config.apiKey))
}
```

### StreamChunk 协议要点

- 每个 `block-start` 必须有对应 `block-end`；`index` 从 0 递增。
- 文本：`block-start`(blockType 'text') → `text-delta`×N → `block-end`(完整 block)。
- 工具调用：`block-start`(blockType 'tool-call') → `tool-call-delta`(含 `argumentsDelta` 原始 JSON 增量) → `block-end`(完整 tool-call block)。
- `usage` 必须在 `finish` 之前；`finish` 必须是最后一个分片，`reason` 为 `{kind:'stop'}` 或 `{kind:'tool-calls'}`。

### 其它约定

- 不支持某字段时抛带稳定 code 的 `LlmError`，**不得静默丢弃**。
- 覆写 `resolveModel(provider, model, signal?)` 返回确切身份与可选 reasoning 元数据。
- 每个提供方 HTTP 请求必须合并 `attributionHeaders()` 并传递 `options.signal`。
- 可选覆写 `listModels()` 公布模型选项。
- 参考实现：`packages/llm/llm-deepseek/`（OpenAI 兼容）、`packages/llm/llm-pi-ai/`。

---

## 11. 能力的三种角色设计（seam）

当一项能力足够通用、需要支持可替换提供方时（如 Bash 执行），Harness 区分三种角色：

- **Service Definition**（拥有 `ctx.<key>` 与词汇类型的 Cordis `Service`，可以是抽象类或具体注册表，绝不是 TS `interface`）
- **Service Provider**（实现能力，可多个、可替换）
- **Consumer**（通常是面向模型的工具，注入该服务）

以 Bash 为例：`dsh-shell`（定义）→ `dsh-bash-local`/`dsh-bash-sandbox`（提供方）→ `dsh-tool-bash`（消费方）。

拆除的三点好处：提供方可替换、独立演进、依赖解耦（Provider 依赖 Definition，Consumer 依赖 Definition，二者互不依赖）。

> **设计要点**：不要预防性拆分（只有角色需要独立演进时才用不同包）；Service Definition 拥有 Request/Result 类型；显式优于隐式（实现用显式 `resolve(request): Spec` 处理默认值，而不用 `?? default` 隐藏）。

---

## 12. Harness 内置服务与能力 seam 一览

服务名、公开方法和源码位置由仓库自动生成到各服务的子系统页面（`docs/subsystems/*.md` 的 `cordis-surface` 区块）。下表是 `capability-seams.md` 的核心清单（角色：`core`=核心主干 / `seam`=可替换能力 / `bundle`=组合点）。

| ctx 键 | 角色 | 说明 |
|---|---|---|
| `ctx.attachments` | seam | 持久二进制附件存储 |
| `ctx.llm` | seam | LLM 适配器注册表（`registerAdapter`） |
| `ctx.tokenMeter` | core | 回放 token 测量 |
| `ctx.toolResultPruner` | core | 无模型工具结果裁剪 |
| `ctx.sessions` | core | 内存会话存储，发出持久会话事件流 |
| `ctx.invariants` | core | 包拥有的不变量注册表 |
| `ctx.typert` / `ctx.typertGateway` | core | 运行时类型注册表 / Typert Host 调用网关 |
| `ctx.sessionPersistence` | seam | 持久会话持久化 seam（jsonl/sqlite） |
| `ctx.settings` | seam | 用户设置 seam（插件注册 namespace schema） |
| `ctx.credentials` | seam | 凭据 seam |
| `ctx.sessionTelemetry` | seam | 会话遥测 seam |
| `ctx.storage` / `ctx.storageDomain` | seam/core | 非会话存储枢纽 / 领域数据设施 |
| `ctx.messageFeedback` | core | 生命周期绑定消息反馈 |
| `ctx.workspaceRegistry` | core | 工作区实体注册表 |
| `ctx.sessionQuery` | seam | 会话读取/追踪/过滤/搜索 |
| `ctx.sessionReferenceResolver` | core | 跨会话快照准备 |
| `ctx.sessionTitle` | seam | 日志支持的会话标题 |
| `ctx.systemPrompt` | core | 系统提示词组装注册表（`.section()`） |
| `ctx.tools` | core | 工具注册表 + 受守卫的执行流水线 |
| `ctx.userQuestions` | seam | 人提问/回答 seam |
| `ctx.planMode` | core | 计划协作状态 |
| `ctx.agentPresets` | core | 按会话 agent 组合 |
| `ctx.commands` | core | 人命令注册表 |
| `ctx.sessionProjections` / `ctx.sessionProjectionCache` | core | 会话投影单元 / 持久投影缓存 |
| `ctx.skills` | seam | skill 提供方注册表 |
| `ctx.agents` | core | Agent 服务（实时句柄、创建/恢复工厂） |
| `ctx.agentDefaultModel` | core | 默认 Agent 模型选择 |
| `ctx.agentLoop` | bundle | 唯一具体循环插件 |
| `ctx.goals` | core | 同会话目标领域 |
| `ctx.e2b` | core | E2B 沙箱生命周期所有者 |
| `ctx.subprocess` | seam | 子进程 seam（`spawn`、进程树/会话生命周期） |
| `ctx.shell` | seam | Bash 执行器 seam（`bash-local`/`bash-sandbox`/`pwsh-local`） |
| `ctx.shellEnv` | core | 受管 bash 环境注册表（DSH_* 事实） |
| `ctx.terminals` | seam | 持久 PTY 会话注册表 |
| `ctx.sandbox` | seam | 进程沙箱 seam（wrap argv） |
| `ctx.sandboxPolicy` | core | 沙箱策略主页（部署默认模式 + 工作区根） |
| `ctx.approval` | seam | 审批 seam（`approval/request` waterfall） |
| `ctx.permissionPresets` | core | 权限预设表（workspace-write / danger-full-access） |
| `ctx.codeRuntime` | seam | 代码执行 seam（运行模型编写的程序） |
| `ctx.fs` | seam | 文件系统提供方 seam（`fs-local`/`fs-sandbox`/`fs-e2b`） |
| `ctx.compaction` | seam | 压缩 seam |
| `ctx.subagents` | seam | subagent 提供方与延续服务 |
| `ctx.jobs` | seam | 后台任务注册表 |
| `ctx.web` | seam | Web 访问提供方注册表（搜索/抓取） |
| `ctx.spillStore` | seam | 溢出存储 seam |
| `ctx.directoryPicker` | seam | 工作区目录选择 seam |
| `ctx.webServer` | core | HTTP 路由注册 |
| `ctx.clientModules` | core | Client 插件图宿主 |
| `ctx.workflowEngine` | seam | 工作流脚本引擎 |
| `ctx.lsp` | seam | 语言服务器导航 seam |
| `ctx.apiProxy` | core | 与传输无关的 Host 网关接口 |
| `ctx.dynamicCordisRunner` / `ctx.cordisInspect` | core | 动态 Cordis 包宿主运行器 / inspect 注册表 |

---

## 13. 扩展点速查：功能 → 机制

（完整映射见 `docs/architecture.zh.md` 与 `docs/cookbook/extension-cookbook.zh.md`）

| 目标 | 机制 |
|---|---|
| 添加模型提供方 | 在 `ctx.llm` 上注册适配器 |
| 添加面向模型能力 | 在 `ctx.tools` 上注册，schema 加入提示词组装 |
| 会话拥有不同能力集合 | 组装 agent preset；服务行需要 `isolate` realm |
| 添加 shell 执行 | 注册 `ctx.shell` 后端；本地后端用 `ctx.subprocess` spawn |
| 添加持久终端 | 注册 `ctx.terminals` 后端 + `dsh-tool-terminal` |
| 添加用户命令 | 在 `ctx.commands` 注册（无需模型轮次即分派） |
| 添加后台工作 | 在 `ctx.jobs` 注册 |
| 添加文件系统访问/策略 | 注册 `ctx.fs` 提供方，或监听 `fs/*` 事件 |
| 限制启动的进程 | 使用 `ctx.sandbox` 后端 |
| 拦截请求/工具/轮次 | 用相应 `agent/*` 或 `tools/*` 事件 |
| 添加模型可见上下文 | 调用 `agent.inject()`（落到下一次获准请求） |
| 添加 UI/编辑器集成 | 驱动 `ctx.agents` 并从 `session/event` 渲染 |
| 添加 Web Chat 业务节点 | 注册 `ConversationNodeDefinition` + `conversation.chat.node` keyed renderer |
| 添加持久会话状态 | 扩展 `SessionEventMap`，从日志渲染和回放 |
| 生成会话标题 | 注册唯一 `ctx.sessionTitle` 提供方 |
| 管理同会话目标 | 使用 `ctx.goals`，通过 `agent/*` 续跑 |
| fork 活跃会话 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 将注册限定到单个 agent | 使用该 agent 的 `agent.ctx` |

### 钩子插件示例（权限门禁）

"原生钩子"是在拦截点上运行的普通 Cordis 插件，不需要外部协议：

```ts
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

---

## 14. 事件域与轮次流程

选对事件域是大多数改动的第一个决定：

- **会话事件**：追加到日志并通过 `session/event` 广播的**持久事实**。当事实必须在重载后仍存在时使用。
- **Agent 事件**（`agent/*`）：携带活跃 Agent（inbox、步骤、状态、请求、验证、续跑）。观察或拦截进行中工作时使用。
- **能力事件**：无需导入循环即可向某 seam 附加策略和适配器（`fs/*`、`tools/*`、`telemetry/*`）。

### 轮次（turn）流程

```
turn/start
  claim next-step input + 一条队列消息
  assemble prompt sections + tool schemas
  -> agent/pre-step                reject | enter(messages)
     step/start
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools 欠另一次请求或新输入到达 -> claim -> 下一步
  -> agent/turn-stopping
turn/end
```

- `agent/pre-step`、`agent/request`、`llm/stream` 和三个 `tools/*` 事件是 **waterfall**（监听器必须调 `next()`）。
- `agent/turn-stopping` 是 **serial** 事件，没有 `next()`。
- `turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*` 是持久会话事件；其余是实时扩展点。

> **"模型可见即已记录"**：抵达模型请求的一切都必须能从日志重建（运行时不变式断言）。新增模型可见输入就要新增一个会话事件：扩展 `SessionEventMap` 并从日志渲染。

---

## 15. 组合：cordis.yml、profile 与组合包

运行中的 `dsh` 是一棵插件树，由启动时按序叠加的各层组合而成。

### 配置文件

`cordis.yml` 是 Cordis 配置项列表。配置项除 `name`、`config` 还接受：

```yaml
- id: greeter       # 稳定标识（写显式 id，否则每次读取生成新 id，重新挂载）
  name: './greeter.ts'
  config: { ... }
- id: consumer
  name: './consumer.ts'
  disabled: true    # 保留条目，跳过挂载
```

- 配置项会**并发启动**，列表中位置不保证加载先后；顺序由服务依赖（`inject`）决定。
- 组可以嵌套子列表，作为一个单元加载/卸载；`isolate` 为组提供某服务名的独立实例。

### profile 与组合包

- **组合包（bundle）**：附带一个配置层的 npm 包，manifest 声明 `dsh.bundle`，回答"这个包贡献什么？"——一个插入/覆盖插件行的 patch 文件。
- **profile**：位于 `$DSH_HOME/profiles/<name>` 下、描述可启动组合的目录，manifest 声明 `dsh.profile`，回答"这套配置由哪些组合包按什么顺序组成？"。
- 组合包是你编写分发的东西；profile 是用户用 `dsh --profile <name>` 启动的东西。没有东西同时是两者。

### 加载顺序（层组合）

```
1. profile 的 dsh.profile.bundles 列表中各组合包 patch（按顺序，先 @deepseek-ai/dsh-base）
2. profile 自己的 cordis.patch.yml
3. home 级 $DSH_HOME/cordis.patch.yml（各 profile 共享）
4. 每个 --patch <path> overlay（按 argv 顺序）
```

- 后应用的层按行胜出；patch 会替换目标行的**整个 `config` 值**（不是深度合并），所以覆盖时**必须重述该行的每一个键**，而不是只写改动的那一个。
- 可用 `dsh --profile web --dump-config` 查看实际启动的配置树。

---

## 16. 加载与诊断（PENDING、HMR）

### HMR（热模块替换）

通过 `cordis.yml` 加载 `@deepseek-ai/cordis-plugin-hmr` 后，修改插件源文件会：卸载旧插件（清理所有注册）→ 重新加载新代码 → 执行新 `apply`。因为注册自动清理，热替换不会保留旧实例的注册。HMR 依赖 `logger` 服务（没有 console 导出器时看不到消息）并 `inject` `timer` 服务（去抖）。

### 诊断"为什么插件没输出"

依赖驱动加载的另一面：若插件 `inject` 的服务无人提供，它会永久 PENDING，不输出任何内容（合法状态，提供方可能稍后才挂载）。枚举 registry 检查 fiber 状态：

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.state === FiberState.PENDING) {
        console.log(`${fiber.name} is PENDING — a required service is missing`)
      }
    }
  }
}
```

- 若插件既不执行也不报错，先检查 fiber 状态（多半是 PENDING）。
- 插件 `apply` 抛异常会让进程终止（明确报错，不静默跳过）；但模块**无法解析**（路径/包名拼错）时，Cordis 通过 logger 报告错误而不使进程崩溃——启动早期该报告可能丢失。新增配置项看似无效时，先检查拼写。

---

## 17. 打包、安装与发布

### 组合包目录结构

```
hello-plugin/
├── package.json       # 声明 dsh.bundle
├── cordis.patch.yml   # 应用该层的 patch 文件
└── index.js           # 插件模块（patch 行引用它）
```

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
# cordis.patch.yml —— 用包名而非相对路径引用（否则 Node 找不到已安装代码）
- insert:
    - id: hello
      name: dsh-hello-plugin
```

没有 `dsh.bundle` 声明的包仍可安装，但只作普通依赖（`dsh plugin` 会警告，不激活任何层）。

### 安装进 profile

```sh
dsh plugin --profile demo add ./hello-plugin      # 首次初始化 profile，追加 dsh.bundle 到 bundles
dsh --profile demo --dump-config                  # 验证图层（"# == dsh-hello-plugin"）
dsh --profile demo                                # 启动
dsh plugin --profile demo remove dsh-hello-plugin # 移除依赖和图层
```

### 从 GitHub 安装：构建脚本这道坎

git 安装拉取的是**源码不是构建产物**（不运行 `build` 脚本），TypeScript 包没有 `lib/` 会加载失败。两边各做一件事：

- **作者**提供自包含的 `prepare` 脚本，从源码构建发布入口（不能假设 monorepo checkout 在旁边）。
- **用户**为构建授权：pnpm ≥10 首次 `add` 失败，`dsh` 提示把包键复制进 profile 的 `pnpm-workspace.yaml`：
  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```
  **如实看待：该授权允许包在安装时于你的机器上执行，且不在 agent 沙箱内**。只对源码可信的包授权，并锁定 commit（`github:you/hello-plugin#<sha>`）。

无需授权的方式：发布到 npm（`pnpm publish` 时构建好 `lib/`），或交付 tarball（`pnpm pack` 后 `dsh plugin add ./xxx.tgz`）。

---

## 18. 关键约束与常见错误

### 硬性约束

- **不要用 `import`/`require`、TS `as`/装饰器、JSX**（在动态 Cordis 插件/客户端代码中），不要猜用未确认的全局（`window`/`document`/`process`/`Buffer`/`fetch`/原生定时器）。
- **每个副作用必须可逆**：Services、Events、Tools、handlers、timer、Slot、样式、主题覆盖都必须属于当前 Fiber，用 `ctx.effect()`/`ctx.on()` 或官方 API 返回的 disposer 管理。
- **不要序列化实时数据**：Service 实例、Event payload、Slot props、Session、Conversation Snapshot 等内部实时对象，不要 `JSON.stringify`/`structuredClone`/递归枚举/整体展示。只读需要的叶子字段，构造最小自有对象。
- **`apply()` 不能返回 React 元素**（这属于动态 Client Slot 的语境）；UI 必须注册进查到的 Slot。
- **model 可见即已记录**：新增模型可见内容必须能在日志中重建。

### 常见错误速查

| 症状 | 首先检查 |
|---|---|
| `service "x" is not declared` | 是否用 `ctx.x` 但没声明 `inject: ['x']`；改用 `ctx.get('x')` + 缺失检查，或声明真正的硬依赖 |
| `cannot get property "timer" without inject` | 查询 timer 服务并声明 `inject: ['timer']` |
| 插件既无输出也不报错 | 检查 fiber 状态（多半 PENDING，缺服务） |
| waterfall 静默吞掉下游 | 观察/标注型监听器忘记调 `next()` |
| 配置无效 | 未导出 Schemastery schema（导出普通对象 `Config` 无效） |
| patch 覆盖行后其它键丢失 | patch 替换整个 config，需重述目标行每一个键 |
| git 安装的 TS 包加载失败 | 缺 `prepare` 脚本构建 `lib/` |

---

## 19. 权威参考索引

本指南整理自 `F:\deepseek-harness` 官方文档，以下为权威来源（文中小节均可回源核对）：

| 主题 | 来源文件（`docs/` 下，均有 `.zh.md` 中文版） |
|---|---|
| Cordis 核心概念 / 分发模式 / waterfall 语义 / loader 配置 | `cordis-primer.md` |
| 插件框架动手教程（7 章） | `cordis-tutorial/01~07` + `index.md` |
| **第一个 Harness 插件（最小结构、注册 cordis.yml）** | `user/develop/basic/index.md` |
| 插件配置（Schema） | `user/develop/basic/config.md` |
| 开发工具（defineTool 快速入门） | `user/develop/basic/tool.md` |
| 打包与安装（组合包/profile/发布） | `user/develop/basic/publish.md` |
| 插件与生命周期（Fiber 状态机） | `user/develop/framework/index.md` |
| 服务与依赖（Service 基类/隔离） | `user/develop/framework/service.md` |
| 事件系统（五种分发模式） | `user/develop/framework/events.md` |
| 能力三种角色设计（seam） | `user/develop/practice/index.md` |
| LLM 适配器 | `user/develop/practice/llm-adapter.md` |
| 上下文 API（ctx 完整签名） | `cordis-api/context.md` |
| 能力 seam 与核心服务清单 | `capability-seams.md` |
| 架构 / 事件域 / 轮次流程 / 归属位置映射 | `architecture.md` |
| 工具编写完整参考（execute 约定/UI 卡片/Code Mode） | `cookbook/adding-a-tool.md` |
| 扩展插件形态（钩子/UI/协议驱动/功能→机制） | `cookbook/extension-cookbook.md` |
| LLM 适配器编写参考 | `cookbook/adding-an-llm-adapter.md` |
| 术语表（seam/scope/turn/step 等） | `glossary.md` |
| 各服务完整签名（`cordis-surface` 区块） | `subsystems/*.md`（如 `core.md`、`approval.md`） |

> 提示：各服务的公开方法、事件模式、源码位置由仓库自动生成在各子系统页面，**应以生成区块和服务的 TypeScript 接口为准**，不要维护另一份静态清单。

---

## 20. 预设工作室与酒馆导入

预设工作室位于 Web 设置页的 Agent 预设分区。它把预设分成“系统预设”和“自定义预设”：系统预设可以查看和复制，但不能直接改写；自定义预设可以保存名称、描述和 `agent.cordis.yml`。预设 id 同时是目录名，创建后不可修改，只接受小写字母、数字和连字符，并且不会覆盖已有目录。

### 创建与保存

创建入口有三种：复制一个 Harness 预设、创建空白预设、导入一个酒馆 JSON。空白预设的 `agent.cordis.yml` 是顶层空列表，表示它不带工具。复制会保留整个目录及文件权限，但会为新目录生成自己的元数据和版本摘要。编辑器打开时记录 revision；保存时必须携带同一个 revision，若本机文件或另一个页面已经保存，Host 返回冲突而不是静默覆盖。

### 酒馆导入流程

浏览器只上传原始 JSON，Host 通过 `agentPreset.importPreview` 做解析和兼容性预览，再通过 `agentPreset.importCreate` 以所选 Harness 底座创建新的自定义预设。预览不会执行宏、JavaScript、Handlebars、扩展代码或正则脚本。

Chat Completion 文件的 `prompts` 和 `prompt_order` 会转换为带 id、名称、内容、角色、顺序、深度和启用状态的条目；`regex_scripts` 或 `replacement_macros.regex_scripts` 会转换为查找表达式、替换文本和禁用状态。仅映射通用模型参数 `temperature`、最大 token 数和 `stop`。Instruct、Context、System Prompt、Reasoning、Text Completion、Kobold、Novel 和无法识别的字段会保留在原始文件，并在报告中标记为 `converted`、`approximated`、`preserved` 或 `rejected`。

创建前可以在导入弹窗中逐条开关提示词和正则条目。导入生成的预设目录包含 `.dsh/sillytavern/source.json` 和 `.dsh/sillytavern/report.json`，所以不能转换的内容不会丢失，也不会与已有预设合并。

### Host API 与权限

`agentPreset.importPreview` 和 `agentPreset.importCreate` 的上传上限为 16 MiB，创建、预览、编辑、读取和删除均限制为 loopback 特权客户端；普通远程客户端仍只能列出和选择预设。Host 在创建边界重新解析文件并核对预览，防止浏览器提交与预览不一致的内容。

当前版本把酒馆条目作为可检查的导入数据和兼容报告保存。真正把提示词插入模型请求、把正则运行在请求/回复阶段的运行时插件仍需单独加入所选底座；在运行时插件加入前，导入开关不会改变模型实际看到的消息。
