# Windows Web 启动器

[English](README.md) | 中文

本目录存放 `pnpm dsh web` 的 Windows 桌面启动器：一个隐藏看门狗，加一个带 DeepSeek Harness 图标的桌面快捷方式。

## 文件

| 文件 | 作用 |
|---|---|
| `start-dsh-web.vbs` | 双击入口。需要时启动看门狗，等待 Web UI 就绪后打开浏览器。 |
| `dsh-web-watchdog.ps1` | 管理子进程：持有命名互斥体，启动 `pnpm dsh web`，在其退出后重启，遇到外部占用 3080 端口的监听方时等待，并写入状态与日志。 |
| `stop-dsh-web.cmd` | 双击停止。运行停止脚本，失败时显示控制台。 |
| `stop-dsh-web.ps1` | 停止实现。读取 `watchdog.json`，并回退到进程查找。 |
| `install-shortcut.cmd` | 用 `dsh-web.ico` 创建桌面快捷方式 `DeepSeek Harness Web`。 |
| `install-shortcut.ps1` | 快捷方式实现。 |
| `dsh-web.ico` | 由 `apps/web/public/favicon.svg` 生成的多尺寸图标。 |

## 用法

1. 先运行一次 `pnpm install` 和 `pnpm run build`。
2. 运行 `install-shortcut.cmd`，把图标放到桌面。
3. 双击桌面上的 `DeepSeek Harness Web`。再次双击只会再次打开浏览器。
4. Web UI 一响应，默认浏览器就打开 `http://127.0.0.1:3080`。
5. 双击 `stop-dsh-web.cmd` 停止看门狗与 Web UI。

状态、日志和 `watchdog.json` 位于 `%LOCALAPPDATA%\deepseek-harness\web-launcher`。

## 行为

看门狗在 `pnpm dsh web` 每次退出后重启它。过早退出按 2、4、8、…… 秒退避，上限 30 秒；稳定运行 60 秒后重置退避。当其他进程已经监听 3080 端口时，看门狗等待而不启动竞争子进程。启动器与输出日志在 5 MiB 时轮转。启动器不随登录启动，每个用户会话只运行一个实例。
