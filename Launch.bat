@echo off
setlocal
cd /d "%~dp0"
title Scrcpy Toolkit Launcher
echo Scrcpy Toolkit 2.1
if not exist "core\server\server.ps1" (echo Backend files are missing. Re-download the complete ZIP.& pause & exit /b 1)
if not exist "core\scripts\start.ps1" (echo Launcher script is missing. Re-download the complete ZIP.& pause & exit /b 1)
if not exist "index.html" (echo index.html is missing. Re-download the complete ZIP.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "core\scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed. See Logs\backend-error.log for details.
  pause
  exit /b 1
)
endlocal
