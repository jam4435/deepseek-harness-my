# Creates a Desktop shortcut with the DeepSeek Harness icon for start-dsh-web.vbs.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcherDir = (Resolve-Path $PSScriptRoot).Path
$vbsPath = Join-Path $launcherDir 'start-dsh-web.vbs'
$iconPath = Join-Path $launcherDir 'dsh-web.ico'

if (-not (Test-Path -LiteralPath $vbsPath)) {
    Write-Error "Missing $vbsPath"
    exit 1
}
if (-not (Test-Path -LiteralPath $iconPath)) {
    Write-Error "Missing $iconPath"
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'DeepSeek Harness Web.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '"' + $vbsPath + '"'
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'DeepSeek Harness Web'
$shortcut.Save()
Write-Host "Created $shortcutPath"
