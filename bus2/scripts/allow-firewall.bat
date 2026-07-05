@echo off
:: One-time Administrator setup — opens Windows Firewall for driver phones.
setlocal EnableExtensions EnableDelayedExpansion

if not defined PORT set "PORT=5174"
set /a HTTPS_PORT=%PORT%+1
set "RULE_HTTP=AdKerala Bus Port %PORT%"
set "RULE_HTTPS=AdKerala Bus Port %HTTPS_PORT%"

netsh advfirewall firewall delete rule name="%RULE_HTTP%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_HTTP%" dir=in action=allow protocol=TCP localport=%PORT% localip=any remoteip=any enable=yes profile=private,public,domain
if errorlevel 1 (
  echo netsh failed — trying PowerShell...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "New-NetFirewallRule -DisplayName '%RULE_HTTP%' -Direction Inbound -Protocol TCP -LocalPort %PORT% -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null"
)

netsh advfirewall firewall delete rule name="%RULE_HTTPS%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE_HTTPS%" dir=in action=allow protocol=TCP localport=%HTTPS_PORT% localip=any remoteip=any enable=yes profile=private,public,domain

if exist "%~dp0AdKeralaDisplay.exe" (
  set "APP=%~dp0AdKeralaDisplay.exe"
  netsh advfirewall firewall delete rule name="AdKerala Bus Display App" >nul 2>&1
  netsh advfirewall firewall add rule name="AdKerala Bus Display App" dir=in action=allow program="!APP!" enable=yes profile=private,public,domain
)

echo.
echo Firewall rules added for ports %PORT% and %HTTPS_PORT%.
echo.
echo Listening on port %PORT%:
netstat -an | findstr ":%PORT% "
echo.
echo Test on THIS PC (replace IP with your Wi-Fi address from the bus screen):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "IP=%%a"
  set "IP=!IP:~1!"
  echo   http://!IP!:%PORT%/control
)
echo.
echo If phone still fails: phone must be on the SAME Wi-Fi as this PC (internet on/off does not matter).
exit /b 0
