# Build a fresh portable AdKerala folder and copy it to bustestsss (or another path).
# Usage: .\scripts\prepare-bustestsss.ps1
#        .\scripts\prepare-bustestsss.ps1 -Target "D:\AdKeralaPortable"
param(
  [string]$Target = (Join-Path (Split-Path $PSScriptRoot -Parent) '..\bustestsss')
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$ReleaseDir = Join-Path $Root 'release\win-unpacked'
$Target = [System.IO.Path]::GetFullPath($Target)

Write-Host "Building portable app..." -ForegroundColor Cyan
Push-Location $Root
try {
  npm run build:kiosk:dir
  if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $ReleaseDir 'AdKeralaDisplay.exe'))) {
  throw "Build output not found at $ReleaseDir"
}

Write-Host "Stopping AdKerala if running..." -ForegroundColor Cyan
Get-Process -Name 'AdKeralaDisplay' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Preparing target: $Target" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Target | Out-Null

# Remove runtime/user data from an existing copy (safe to delete on fresh deploy)
$wipe = @(
  'db',
  'certs',
  'adkerala.device.json',
  '.adkerala-driver-sessions.json',
  '.adkerala-firewall-v1'
)
foreach ($item in $wipe) {
  $path = Join-Path $Target $item
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Copying build files..." -ForegroundColor Cyan
robocopy $ReleaseDir $Target /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }

# Ensure no leftover user data beside the exe (fresh = unclaimed, empty db)
foreach ($item in $wipe) {
  $path = Join-Path $Target $item
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Fresh portable app ready:" -ForegroundColor Green
Write-Host "  $Target"
Write-Host "  Run Install-AdKerala.bat on the target PC for shortcut + firewall."
Write-Host ""
