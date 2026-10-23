@echo off
setlocal
cd /d "%~dp0"
title Scrcpy Toolkit Launcher
set "SERVER=%~dp0core\server\server.ps1"
if not exist "%SERVER%" (echo Backend file missing. Re-download the complete ZIP.& pause & exit /b 1)
powershell.exe -NoProfile -Command "try {$c=New-Object Net.Sockets.TcpClient('127.0.0.1',47821);$c.Close();exit 0} catch {exit 1}"
if not errorlevel 1 (echo Backend already running. Open index.html.& timeout /t 2 >nul & exit /b 0)
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SERVER%"
echo Starting local backend...
for /l %%i in (1,1,15) do (
 powershell.exe -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47821/api/status -TimeoutSec 1;exit 0} catch {exit 1}" >nul 2>&1
 if not errorlevel 1 goto ready
 timeout /t 1 >nul
)
echo Backend did not start. Check the PowerShell script and port 47821.
pause
exit /b 1
:ready
echo Backend ready. Now open index.html.
timeout /t 2 >nul
endlocal