#Requires -Version 5.1
<#
Windows background launcher for `pnpm dsh web`.

The script keeps the Web UI running for the lifetime of the watchdog process.
It restarts the child with exponential backoff after an early exit, and writes
its state and logs under %LOCALAPPDATA%\deepseek-harness\web-launcher so the
hidden launch path remains inspectable and stoppable.
#>
[CmdletBinding()]
param(
    [int]$MinBackoffSeconds = 2,
    [int]$MaxBackoffSeconds = 30,
    [int]$ResetAfterSeconds = 60,
    [int]$MaxLogBytes = 5242880,
    [string]$DshArgs = 'web'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
    Write-Error "The launcher must live in <repo>\scripts\windows-launcher. Missing package.json at $repoRoot."
    exit 1
}

$stateBase = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($stateBase)) {
    $stateBase = [Environment]::GetFolderPath('LocalApplicationData')
}
$stateDir = Join-Path $stateBase 'deepseek-harness\web-launcher'
$stateFile = Join-Path $stateDir 'watchdog.json'
$launcherLog = Join-Path $stateDir 'launcher.log'
$stdoutLog = Join-Path $stateDir 'web.out.log'
$stderrLog = Join-Path $stateDir 'web.err.log'
$scriptPath = $MyInvocation.MyCommand.Path

function Write-LauncherLog {
    param([Parameter(Mandatory)][string]$Message)

    try {
        Add-Content -LiteralPath $launcherLog -Value ("{0:o} {1}" -f (Get-Date), $Message) -Encoding UTF8
    } catch {
        # Logging is best effort; the watchdog must keep running when the log is unavailable.
    }
}

function Write-WatchdogState {
    param(
        [int]$ChildPid,
        [int]$LastExitCode,
        [int]$RestartCount,
        [int]$NextDelaySeconds
    )

    try {
        New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
        $tmp = "$stateFile.tmp"
        [pscustomobject]@{
            watchdogPid       = $PID
            childPid          = $ChildPid
            startedAt         = (Get-Date).ToString('o')
            restartCount      = $RestartCount
            lastExitCode      = $LastExitCode
            nextDelaySeconds  = $NextDelaySeconds
            scriptPath        = $scriptPath
            repoRoot          = $repoRoot
        } | ConvertTo-Json | Set-Content -LiteralPath $tmp -Encoding UTF8
        Move-Item -LiteralPath $tmp -Destination $stateFile -Force
    } catch {
        Write-LauncherLog "state write failed: $($_.Exception.Message)"
    }
}

function Rotate-Log {
    param([Parameter(Mandatory)][string]$Path)

    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).Length -ge $MaxLogBytes)) {
        Remove-Item -LiteralPath "$Path.1" -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $Path -Destination "$Path.1" -Force
    }
}

function Test-DshWebListening {
    $listeners = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
    return ($listeners.Count -gt 0)
}

$mutexName = 'Local\deepseek-harness-web-watchdog'
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(0, $false)
} catch {
    # An abandoned named mutex still transfers ownership to this process.
    $ownsMutex = $true
}
if (-not $ownsMutex) {
    exit 0
}

try {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Rotate-Log -Path $launcherLog
    Write-LauncherLog "watchdog started (pid=$PID, repo=$repoRoot, args=$DshArgs)"
} catch {
    Write-Error "Cannot create state directory $stateDir : $($_.Exception.Message)"
    exit 1
}

$cmdPath = (Get-Command cmd.exe).Source
$restartCount = 0
$delay = $MinBackoffSeconds
$lastExitCode = 0
$waitingOnExternal = $false

while ($true) {
    if (Test-DshWebListening) {
        if (-not $waitingOnExternal) {
            Write-LauncherLog 'port 3080 already has a listener; waiting for it to close'
            $waitingOnExternal = $true
        }
        Write-WatchdogState -ChildPid 0 -LastExitCode $lastExitCode -RestartCount $restartCount -NextDelaySeconds $delay
        Start-Sleep -Seconds 5
        continue
    }
    $waitingOnExternal = $false

    $startedAt = Get-Date
    $child = $null

    try {
        Rotate-Log -Path $stdoutLog
        Rotate-Log -Path $stderrLog

        $child = Start-Process -FilePath $cmdPath `
            -ArgumentList @('/d', '/s', '/c', "pnpm dsh $DshArgs") `
            -WorkingDirectory $repoRoot `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -NoNewWindow `
            -PassThru

        Write-LauncherLog "child started (pid=$($child.Id), restartCount=$restartCount)"
        Write-WatchdogState -ChildPid $child.Id -LastExitCode $lastExitCode -RestartCount $restartCount -NextDelaySeconds $delay

        $child.WaitForExit()
        $rawExitCode = $child.ExitCode
        $exitCode = if ($null -ne $rawExitCode) { [int]$rawExitCode } else { -1 }
    } catch {
        $exitCode = -1
        Write-LauncherLog "child start or wait failed: $($_.Exception.Message)"
    }

    $lastExitCode = $exitCode

    $uptimeSeconds = ((Get-Date) - $startedAt).TotalSeconds
    if ($uptimeSeconds -ge $ResetAfterSeconds) {
        $restartCount = 0
        $delay = $MinBackoffSeconds
    } else {
        $restartCount++
        $delay = [Math]::Max($MinBackoffSeconds, [Math]::Min($MaxBackoffSeconds, $delay * 2))
    }

    Write-LauncherLog "child exited (exitCode=$exitCode, uptimeSeconds=$([int]$uptimeSeconds), nextDelaySeconds=$delay)"
    Write-WatchdogState -ChildPid 0 -LastExitCode $exitCode -RestartCount $restartCount -NextDelaySeconds $delay

    Start-Sleep -Seconds $delay
}
