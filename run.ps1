$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$appUrl = "http://127.0.0.1:5174/display?autofs=1"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AdKerala" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: npm was not found. Install Node.js from https://nodejs.org" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
  Write-Host ""
}

Write-Host "Starting dev server..."
if (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "Freeing port 5174 if already in use..."
  npx --yes kill-port 5174 2>$null | Out-Null
}
Start-Process cmd -ArgumentList '/k', "cd /d `"$PSScriptRoot`" && npm run dev" -WindowStyle Normal

Write-Host "Waiting for server at $appUrl ..."
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:5174/" -UseBasicParsing -TimeoutSec 2 | Out-Null
    $ready = $true
    break
  } catch {
    # keep waiting
  }
}

if (-not $ready) {
  Write-Host ""
  Write-Host "ERROR: Server did not start in time." -ForegroundColor Red
  Write-Host 'Check the "AdKerala Server" window for errors.'
  Write-Host ""
  Write-Host "Common fix: port 5174 in use — run: npx kill-port 5174"
  Read-Host "Press Enter to exit"
  exit 1
}

$chromePaths = @(
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) {
  Start-Process $chrome -ArgumentList @('--new-window', '--disable-infobars', $appUrl)
} else {
  Write-Host "WARNING: Chrome not found. Opening in default browser instead." -ForegroundColor Yellow
  Start-Process $appUrl
}

& "$PSScriptRoot\scripts\enter-fullscreen.ps1" | Out-Null

Write-Host ""
Write-Host "Chrome opened to Display screen: $appUrl" -ForegroundColor Green
Write-Host "Driver phone: open http://<bus-lan-ip>:5174/control on the same Wi-Fi"
Write-Host "Browser enters F11 fullscreen automatically. Esc = exit fullscreen · Alt+F4 = quit"
Write-Host ""
Write-Host "The dev server runs in the other window. Close it to stop the app."
Read-Host "Press Enter to exit"
