@echo off
:: One-time Administrator setup — permanent firewall rules for driver phone (HTTP + HTTPS).
setlocal EnableExtensions EnableDelayedExpansion

set "RULE_HTTP=AdKerala Bus Port 5174"
set "RULE_HTTPS=AdKerala Bus Port 5175"

netsh advfirewall firewall delete rule name="%RULE_HTTP%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_HTTP%" dir=in action=allow protocol=TCP localport=5174 enable=yes profile=private,public,domain
if errorlevel 1 (
  echo Failed to add firewall rule for port 5174.
  exit /b 1
)

netsh advfirewall firewall delete rule name="%RULE_HTTPS%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_HTTPS%" dir=in action=allow protocol=TCP localport=5175 enable=yes profile=private,public,domain
if errorlevel 1 (
  echo Failed to add firewall rule for port 5175.
  exit /b 1
)

if exist "%~dp0AdKeralaDisplay.exe" (
  set "APP=%~dp0AdKeralaDisplay.exe"
  netsh advfirewall firewall delete rule name="AdKerala Bus Display App" >nul 2>&1
  netsh advfirewall firewall add rule name="AdKerala Bus Display App" dir=in action=allow program="!APP!" enable=yes profile=private,public,domain
)

echo Firewall opened for ports 5174 (display) and 5175 (driver HTTPS).
exit /b 0
