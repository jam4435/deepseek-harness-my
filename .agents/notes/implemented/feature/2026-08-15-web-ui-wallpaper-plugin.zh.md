# Agent Note: Web UI wallpaper plugin

Status: implemented

[English](2026-08-15-web-ui-wallpaper-plugin.md) | 中文

## Problem

Web UI 没有背景图表面。放在仓库根目录的 JPEG（`.bgimg/background.jpg`）从未被任何插件、样式表或清单引用，因此任何浏览器都无法显示它。壁纸属于客户端插件图——浏览器插件的样式只能经它的 `lib/client.js` bundle 到达——而该 bundle 没有配套资源路由：客户端模块宿主只提供 `client.js` 与 `client.js.map`。

## Decision

发布 [`@deepseek-ai/dsh-client-ui-wallpaper`](../../../../packages/client/ui-wallpaper/README.md)，作为一个纯呈现插件：`inject = []`、空的 `apply`，以及一个有副作用的 `background.module.css` 导入。Web bundle 把它挂为 `ui-wallpaper` 花名册行，客户端聚合项目引用该包，bundle 声明该 workspace 依赖。

样式表通过 slot 渲染锚点契约，把随包图片画在两个占满视口的底表面上：应用框架是 `[data-slot='root'] > div`，对话列是 `[data-slot='conversation'] > [data-phase]`。两条规则共享 `background-attachment: fixed`、`background-size: cover` 与 `background-position: center`，于是这两个表面读起来像一张与视口对齐的壁纸；底层保留 `background-color: var(--dsw-alias-bg-base)`，让主题调色板继续是颜色权威。侧边栏与详情列保留各自的不透明填充，因此它们的文案在图片上方依然可读。

JPEG 位于 `packages/client/ui-wallpaper/src/client/background.jpg`，`packages/client/ui-wallpaper/scripts/gen-background-css.mjs` 重新生成把图片内嵌为 data URI 的样式表。必须内嵌，因为模块宿主没有插件自有资源文件的路由；共享的 CSS-Modules 管线在物化时把生成后的规则注入为 `<style data-plugin>` 标签，HMR 随 fiber 移除并重新注入它（[加载模型](../architecture/2026-07-23-client-plugin-loading-model.md)）。`tests/background-image.client.spec.ts` 用源图片钉住样式表里的 data URI，因此替换后的图片不可能与生成的 CSS 悄悄分叉。

## Alternatives considered

**从 `apps/web/public` 提供图片并引用 `/background.jpg`。**这能让 bundle 保持小巧，但资源被移到 app 自有的静态目录，已发布的插件包无法声明它；而且文件缺失时会表现为悄无声息的“没有背景图”，而不是构建期测试失败。

**扩展 ui-theme 或壳的 base 样式表。**主题包拥有共享 token 与全局样式表；把某个人的壁纸放进共享样式表，会让它携带图片资源，并失去插件提供的花名册开关与 HMR 生命周期。

**把框架与对话表面改透明并绘制 `body`。**这需要跨包覆盖每一层不透明的壳表面，并让深色模式对比度依赖图片；在两个底表面上绘制同一张固定图片可以保留现有调色板，并让侧边栏与详情保持不变。

**用 Config 字段指定图片。**可配置的 URL 或路径仍然需要资源提供路由和设置表面；在只有一张随包图片时这些是投机性的，而生成器加钉住测试已把换图变成一次有意的重建。

## Consequences

随包壁纸出现在应用框架与对话列之上，不出现在侧边栏或详情列之上。data URI 在浏览器加载路径上给 `lib/client.js` 增加约 322 KB（gzip 后约 240 KB）。换图是一次包重建（`gen:css`，然后 `bundle`），而不是 profile 覆盖。在本包加入花名册之前启动的服务器仍提供旧图——插件集合变化在重启时生效——因此运行中的进程必须重启一次，壁纸行才会出现。
