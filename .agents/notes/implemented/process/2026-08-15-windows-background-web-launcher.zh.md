# Agent Note: Windows 后台 Web 启动器

Status: implemented

[English](2026-08-15-windows-background-web-launcher.md) | 中文

## Problem

`pnpm dsh web` 绑定在启动它的控制台上：关闭控制台会停掉 Web UI，崩溃后也要等到有人重新运行命令才能恢复。希望 UI 常驻后台的 Windows 用户需要双击入口、在命令退出后重新拉起的看门狗，以及停止这个隐藏进程的办法。

## Decision

[`scripts/windows-launcher/`](../../../../scripts/windows-launcher/README.md) 为源码检出仓库提供 Windows 专用启动器。`start-dsh-web.vbs` 是双击入口；Web UI 一响应就在浏览器打开 `http://127.0.0.1:3080`，没有监听方时以隐藏方式运行 `dsh-web-watchdog.ps1`。`install-shortcut.ps1` 用生成的多尺寸 `dsh-web.ico` 放置桌面快捷方式，使双击目标像普通应用一样带图标。看门狗持有命名互斥体 `Local\deepseek-harness-web-watchdog`，因此第二个看门狗会直接退出，不会另起实例。它通过 `cmd.exe` 启动 `pnpm dsh web`，把 stdout 与 stderr 重定向到 `%LOCALAPPDATA%\deepseek-harness\web-launcher\web.out.log` 与 `web.err.log`。它会在自己的子进程每次退出后重启：运行不足 60 秒就退出时按 2、4、8、…… 秒退避至 30 秒上限，稳定运行 60 秒后重置序列。当其他进程已经监听 3080 端口时，它等待而不启动竞争子进程。它写入包含看门狗与子进程 id 的 `watchdog.json`，并在 5 MiB 时分别轮转启动器与输出日志。`stop-dsh-web.cmd` 运行 `stop-dsh-web.ps1`，后者先结束看门狗进程树，再结束记录的子进程 id，并删除 `watchdog.json`。

## Alternatives considered

**批处理循环启动器。** `:loop` / `timeout` 批处理文件不需要 PowerShell，但其隐藏窗口、单实例与停止语义依赖窗口标题和 `tasklist` 解析，跨重启引用 `pnpm dsh web` 也很脆弱。

**Node 进程管理器依赖。** `pm2` 或 `nodemon` 把进程树与日志行为移到仓库之外，还需要单独全局安装；本启动器在检出仓库内自包含。

**任务计划程序注册。** 计划任务能覆盖登录自启，但导入它需要单独的高权限设置步骤，而需求是手动双击启动加崩溃重启。双击路径仍需要同一个看门狗。

## Consequences

每个用户会话由一个隐藏看门狗服务 Web UI；外部监听方占用 3080 端口期间它等待，该监听方退出后再启动自己的子进程。崩溃与过早退出会在没有控制台窗口的情况下重启，双击路径通过打开默认浏览器给出可见反馈。启动器不随登录启动，需要另行添加计划任务。状态与日志累积在 `%LOCALAPPDATA%\deepseek-harness\web-launcher`，带 5 MiB 轮转。VBS 与 PowerShell 文件没有自动化测试，由 Windows 专用冒烟运行人工验证。
