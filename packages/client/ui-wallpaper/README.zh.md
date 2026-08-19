# @deepseek-ai/dsh-client-ui-wallpaper

[English](README.md) | 中文

Web UI 壁纸插件。它是一个纯呈现包，没有服务、配置或组件：导入它的 CSS module 会注入一张由本插件拥有的样式表，把随包打包的 `background.jpg` 画在应用框架与对话列之上。侧边栏与详情列保留各自的不透明填充，因此它们的内容在图片上方依然可读。

两条规则面向 slot 渲染锚点契约——应用框架是 `[data-slot='root'] > div`，对话列是 `[data-slot='conversation'] > [data-phase]`——并共享同一张 `background-attachment: fixed` 图片，于是这两个表面读起来像一张与视口对齐的连续壁纸。图片之下保留 `background-color: var(--dsw-alias-bg-base)`，让主题调色板继续是颜色权威。

图片以 data URI 形式内嵌在 CSS module 里，因为客户端模块宿主只对每个插件提供 `lib/client.js` 及其 source map——配套的图片文件没有 HTTP 路由。共享的 tsdown CSS-Modules 管线在物化时把样式表注入为 `<style data-plugin="@deepseek-ai/dsh-client-ui-wallpaper">` 标签，HMR 随 fiber 一起移除并重新注入它。

## 模型体验

无。壁纸只是浏览器侧的视觉样式；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **图片固定随包**：替换图片意味着更新 `src/client/background.jpg`、运行 `pnpm --filter @deepseek-ai/dsh-client-ui-wallpaper gen:css` 并重建 `lib/client.js`；样式表与源图片不一致时包测试会失败。
- **不支持按部署配置**：插件没有 Config，因此换图是一次包重建，而不是 profile 覆盖。
- **Bundle 体积代价**：JPEG 的 base64 载荷使 `lib/client.js` 增加约 322 KB（gzip 后约 240 KB）；提供配套资源路由可以去掉它，但需要改动 client-modules 的资源服务。
