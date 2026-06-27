# Focus the AdKerala Chrome window and send F11 (browser fullscreen).
param(
  [string[]]$TitleHints = @('AdKerala', '127.0.0.1:5174'),
  [int]$TimeoutSec = 12
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)

while ((Get-Date) -lt $deadline) {
  $chrome = Get-Process -Name chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Where-Object {
      $title = $_.MainWindowTitle
      foreach ($hint in $TitleHints) {
        if ($title -like "*$hint*") { return $true }
      }
      return $false
    } |
    Select-Object -First 1

  if ($chrome) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AdKeralaWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@ -ErrorAction SilentlyContinue

    [AdKeralaWin32]::SetForegroundWindow($chrome.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 350

    $shell = New-Object -ComObject WScript.Shell
    $shell.SendKeys('{F11}')
    exit 0
  }

  Start-Sleep -Milliseconds 400
}

exit 1
