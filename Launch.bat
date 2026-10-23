@echo off
setlocal
cd /d "%~dp0"
title Scrcpy Toolkit Launcher
set "SERVER=%~dp0core\server\server.ps1"
set "RESTART=%~dp0core\server\restart-backend.ps1"
set "DASHBOARD=%~dp0index.html"
if not exist "%SERVER%" (echo Backend file missing. Re-download the complete ZIP.& pause & exit /b 1)
if not exist "%RESTART%" (echo Backend restart script is missing. Re-download the complete ZIP.& pause & exit /b 1)
if not exist "%DASHBOARD%" (echo index.html is missing. Re-download the complete ZIP.& pause & exit /b 1)
echo [1/3] Stopping any previous Scrcpy Toolkit backend...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RESTART%" >nul 2>&1
echo [2/3] Starting a fresh local backend...
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SERVER%"
for /l %%i in (1,1,15) do (
 powershell.exe -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47821/api/status -TimeoutSec 1;if($r.StatusCode -eq 200){exit 0}else{exit 1}} catch {exit 1}" >nul 2>&1
 if not errorlevel 1 goto ready
 timeout /t 1 >nul
)
echo.
echo Backend did not pass its health check.
echo Check Logs\backend-error.log and try opening this URL:
echo http://127.0.0.1:47821/api/status
echo.
pause
exit /b 1
:ready
echo [3/3] Backend health check passed. Opening dashboard...
start "" "%DASHBOARD%"
endlocal
