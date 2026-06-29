# AdKerala portable one-click install (desktop shortcut + firewall + launch).
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Exe = Join-Path $Root 'AdKeralaDisplay.exe'
$FirewallBat = Join-Path $Root 'allow-firewall.bat'

if (-not (Test-Path $Exe)) {
  Write-Host 'AdKeralaDisplay.exe not found in this folder.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

# Desktop shortcut
$Wsh = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$Shortcut = $Wsh.CreateShortcut((Join-Path $Desktop 'AdKerala Display.lnk'))
$Shortcut.TargetPath = $Exe
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = 'AdKerala bus route display'
$Shortcut.Save()

# Firewall (required for driver phones on Wi-Fi)
$firewallOk = $false
if (Test-Path $FirewallBat) {
  try {
    $proc = Start-Process -FilePath $FirewallBat -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop
    $firewallOk = ($proc.ExitCode -eq 0)
  } catch {
    $firewallOk = $false
  }
}

Write-Host ''
Write-Host 'AdKerala installed.' -ForegroundColor Green
Write-Host '  Desktop shortcut: AdKerala Display'
Write-Host '  Claim bus at: https://adkeralav1-production.up.railway.app/admin/claim'
if (-not $firewallOk) {
  Write-Host ''
  Write-Host '  WARNING: Firewall setup may have failed.' -ForegroundColor Yellow
  Write-Host '  Driver phones will NOT connect until you right-click allow-firewall.bat'
  Write-Host '  in this folder and choose Run as administrator.'
}
Write-Host ''

Start-Process -FilePath $Exe
exit 0
