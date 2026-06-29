# Copy bustestsss to USB without "path too long" errors.
# Usage:
#   .\scripts\copy-bustestsss-to-usb.ps1 -UsbDrive E:
#   .\scripts\copy-bustestsss-to-usb.ps1 -Destination "E:\AdKerala"
param(
  [string]$Source = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\bustestsss'),
  [string]$UsbDrive = '',
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$Source = [System.IO.Path]::GetFullPath($Source)

if (-not (Test-Path (Join-Path $Source 'AdKeralaDisplay.exe'))) {
  throw "Source not found: $Source — run prepare-bustestsss.ps1 first"
}

if ($Destination) {
  $dest = [System.IO.Path]::GetFullPath($Destination)
} elseif ($UsbDrive) {
  $drive = $UsbDrive.TrimEnd('\')
  if ($drive -notmatch ':$') { $drive = "${drive}:" }
  $dest = Join-Path $drive 'AdKerala'
} else {
  throw 'Pass -UsbDrive E: or -Destination "E:\AdKerala"'
}

Write-Host "Packing AdKerala for USB..." -ForegroundColor Cyan
Write-Host "  From: $Source"
Write-Host "  To:   $dest"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# robocopy skips deep junk; /FFT tolerates USB timing
robocopy $Source $dest /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NC /NS /NP `
  /XD db certs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "Copied to USB (db/ and certs/ skipped — keep those on the bus PC)." -ForegroundColor Green
Write-Host "On the bus PC: copy app files only; keep existing db/, adkerala.device.json, certs/." -ForegroundColor Yellow
Write-Host ""
