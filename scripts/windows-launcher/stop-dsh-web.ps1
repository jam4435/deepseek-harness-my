# Stops the watchdog started by start-dsh-web.vbs and its child process tree.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stateBase = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($stateBase)) {
    $stateBase = [Environment]::GetFolderPath('LocalApplicationData')
}
$stateDir = Join-Path $stateBase 'deepseek-harness\web-launcher'
$stateFile = Join-Path $stateDir 'watchdog.json'
$ids = @()

if (Test-Path -LiteralPath $stateFile) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        foreach ($candidate in @($state.watchdogPid, $state.childPid)) {
            if ($null -ne $candidate) {
                $ids += [int]$candidate
            }
        }
    } catch {
        Write-Host "Ignoring unreadable state file $stateFile : $($_.Exception.Message)"
    }
}

# Fallback for a watchdog whose state file was removed before it stopped.
$fallback = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*dsh-web-watchdog.ps1*' }
foreach ($process in $fallback) {
    $ids += $process.ProcessId
}

$ids = @($ids | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
if ($ids.Count -eq 0) {
    Write-Host 'DeepSeek Harness Web launcher is not running.'
    exit 0
}

foreach ($id in $ids) {
    & taskkill.exe /PID $id /T /F 2>$null | Out-Null
    Write-Host "Stopped process tree $id."
}

Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
Write-Host 'DeepSeek Harness Web launcher stopped.'
