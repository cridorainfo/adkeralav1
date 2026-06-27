@echo off
:: One-time Administrator setup — permanent firewall rule for driver phone /control access.
setlocal EnableExtensions EnableDelayedExpansion
set "PORT=5174"
set "RULE=AdKerala Bus Display Port %PORT%"

netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% enable=yes profile=private,public,domain
if errorlevel 1 (
  echo Failed to add firewall rule.
  exit /b 1
)

if exist "%~dp0AdKeralaDisplay.exe" (
  set "APP=%~dp0AdKeralaDisplay.exe"
  netsh advfirewall firewall delete rule name="AdKerala Bus Display App" >nul 2>&1
  netsh advfirewall firewall add rule name="AdKerala Bus Display App" dir=in action=allow program="!APP!" enable=yes profile=private,public,domain
)

exit /b 0
