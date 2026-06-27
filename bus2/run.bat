@echo off

setlocal EnableExtensions

cd /d "%~dp0"



set "APP_URL=http://127.0.0.1:5174/display?autofs=1"



echo ========================================

echo   AdKerala

echo ========================================

echo.



where npm >nul 2>&1

if errorlevel 1 (

  echo ERROR: npm was not found. Install Node.js from https://nodejs.org

  echo.

  pause

  exit /b 1

)



if not exist "node_modules\" (

  echo Installing dependencies...

  call npm install

  if errorlevel 1 (

    echo.

    echo ERROR: npm install failed.

    pause

    exit /b 1

  )

  echo.

)



echo Starting dev server...

where npx >nul 2>&1
if not errorlevel 1 (
  echo Freeing port 5174 if already in use...
  call npx --yes kill-port 5174 >nul 2>&1
)

start "AdKerala Server" cmd /k "cd /d "%~dp0" && npm run dev"



echo Waiting for server at %APP_URL% ...

set /a ATTEMPTS=0



:wait_loop

timeout /t 1 /nobreak >nul

set /a ATTEMPTS+=1

powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (

  if %ATTEMPTS% GEQ 45 (

    echo.

    echo ERROR: Server did not start in time.

    echo Check the "AdKerala Server" window for errors.

    echo.

    echo Common fix: port 5174 in use — run: npx kill-port 5174

    echo.

    pause

    exit /b 1

  )

  goto wait_loop

)



call :OpenChrome "%APP_URL%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enter-fullscreen.ps1" >nul 2>&1



echo.

echo Chrome opened: %APP_URL%

echo Browser enters F11 fullscreen automatically. Esc = exit fullscreen · Alt+F4 = quit

echo.

echo The dev server runs in the other window. Close it to stop the app.

echo.

pause

exit /b 0



:OpenChrome

set "TARGET_URL=%~1"

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (

  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --new-window --disable-infobars "%TARGET_URL%"

  goto :eof

)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (

  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --new-window --disable-infobars "%TARGET_URL%"

  goto :eof

)

if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (

  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --new-window --disable-infobars "%TARGET_URL%"

  goto :eof

)

echo WARNING: Chrome not found. Opening in default browser instead.

start "" "%TARGET_URL%"

goto :eof

