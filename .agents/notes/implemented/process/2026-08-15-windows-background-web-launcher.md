# Agent Note: Windows background Web launcher

Status: implemented

English | [中文](2026-08-15-windows-background-web-launcher.zh.md)

## Problem

`pnpm dsh web` is tied to the console that started it: closing the console stops the Web UI, and a crash leaves it down until someone reruns the command. A Windows user who wants the UI resident in the background needs a double-click entry, a watchdog that relaunches the command after exit, and a way to stop the hidden process.

## Decision

[`scripts/windows-launcher/`](../../../../scripts/windows-launcher/README.md) ships a Windows-only launcher for a source checkout. `start-dsh-web.vbs` is the double-click entry; it opens the browser at `http://127.0.0.1:3080` when the Web UI answers, and runs `dsh-web-watchdog.ps1` hidden when no listener is present. `install-shortcut.ps1` places a Desktop shortcut with the generated multi-size `dsh-web.ico`, so the double-click target is an icon like an ordinary app. The watchdog holds the named mutex `Local\deepseek-harness-web-watchdog`, so a second watchdog exits without starting another instance. It starts `pnpm dsh web` through `cmd.exe` with stdout and stderr redirected to `%LOCALAPPDATA%\deepseek-harness\web-launcher\web.out.log` and `web.err.log`. It restarts its own child after every exit: exits before 60 seconds of uptime back off 2, 4, 8, ... to 30 seconds, and a stable 60-second run resets the sequence. When another process already listens on port 3080, it waits instead of starting a competing child. It writes `watchdog.json` with the watchdog and child process ids, and rotates the launcher and output logs at 5 MiB each. `stop-dsh-web.cmd` runs `stop-dsh-web.ps1`, which kills the watchdog process tree first and then the recorded child id, and removes `watchdog.json`.

## Alternatives considered

**Batch-loop launcher.** A `:loop` / `timeout` batch file needs no PowerShell, but its hidden-window, single-instance, and stop semantics rely on window titles and `tasklist` parsing, and quoting `pnpm dsh web` across restarts is fragile.

**Node process manager dependency.** `pm2` or `nodemon` moves process-tree and log behavior outside the repository and requires a separate global install; this launcher is self-contained in the checkout.

**Task Scheduler registration.** A scheduled task covers login autostart, but importing one requires a separate elevated setup step, and the requested behavior is manual double-click start with crash restart. The double-click path still needs the same watchdog.

## Consequences

One hidden watchdog serves the Web UI per user session; while an external listener occupies port 3080 it waits, and it starts its own child after that listener exits. Crash and early-exit restart work without a console window, and the double-click path gives visible feedback by opening the default browser. The launcher does not start at login; adding that requires a separate scheduled task. State and logs accumulate under `%LOCALAPPDATA%\deepseek-harness\web-launcher` with the 5 MiB rotations. There is no automated test for the VBS and PowerShell files; Windows-only smoke runs verify them manually.
