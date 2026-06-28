# AdKerala portable one-click install (desktop shortcut + firewall + launch).
# No environment variables — the app configures production cloud on first run.
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Exe = Join-Path $Root 'AdKeralaDisplay.exe'
$FirewallBat = Join-Path $Root 'allow-firewall.bat'

if (-not (Test-Path $Exe)) {
  Write-Host 'AdKeralaDisplay.exe not found in this folder.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

# Desktop shortcut (no env vars — exe is self-contained)
$Wsh = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shortcut = $Wsh.CreateShortcut((Join-Path $Desktop 'AdKerala Display.lnk'))
$Shortcut.TargetPath = $Exe
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = 'AdKerala bus route display'
$Shortcut.Save()

# Firewall (one-time, may prompt for Administrator)
if (Test-Path $FirewallBat) {
  try {
    Start-Process -FilePath $FirewallBat -Verb RunAs -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
  } catch {
  }
}

Write-Host ''
Write-Host 'AdKerala installed.' -ForegroundColor Green
Write-Host '  Desktop shortcut: AdKerala Display'
Write-Host '  Claim bus at: https://adkeralav1-production.up.railway.app/admin/claim'
Write-Host ''

Start-Process -FilePath $Exe
exit 0
