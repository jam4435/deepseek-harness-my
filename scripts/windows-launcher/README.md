# Windows Web launcher

English | [中文](README.zh.md)

This folder holds the Windows desktop launcher for `pnpm dsh web`: a hidden watchdog plus a Desktop shortcut with the DeepSeek Harness icon.

## Files

| File | Purpose |
|---|---|
| `start-dsh-web.vbs` | Double-click entry. Starts the watchdog when needed, waits for the Web UI, then opens the browser. |
| `dsh-web-watchdog.ps1` | Owns the child process: holds a named mutex, starts `pnpm dsh web`, restarts it, waits on a foreign port-3080 listener, and writes state and logs. |
| `stop-dsh-web.cmd` | Double-click stop. Runs the stop script and shows a console on failure. |
| `stop-dsh-web.ps1` | Stop implementation. Reads `watchdog.json` and falls back to process lookup. |
| `install-shortcut.cmd` | Creates the `DeepSeek Harness Web` Desktop shortcut with `dsh-web.ico`. |
| `install-shortcut.ps1` | Shortcut implementation. |
| `dsh-web.ico` | Multi-size icon generated from `apps/web/public/favicon.svg`. |

## Usage

1. Run `pnpm install` and `pnpm run build` once.
2. Run `install-shortcut.cmd` to put the icon on the Desktop.
3. Double-click `DeepSeek Harness Web` on the Desktop. A repeat double-click just opens the browser again.
4. The default browser opens `http://127.0.0.1:3080` as soon as the Web UI answers.
5. Double-click `stop-dsh-web.cmd` to stop the watchdog and the Web UI.

State, logs, and `watchdog.json` live in `%LOCALAPPDATA%\deepseek-harness\web-launcher`.

## Behavior

The watchdog restarts `pnpm dsh web` after every exit. Early exits back off 2, 4, 8, ... up to 30 seconds; 60 seconds of stable uptime resets the backoff. When another process already listens on port 3080, the watchdog waits instead of starting a competing child. Launcher and output logs rotate at 5 MiB. The launcher does not start at login and runs one instance per user session.
