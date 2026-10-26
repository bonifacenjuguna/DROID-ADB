@echo off
setlocal
cd /d "%~dp0"
title DROID ADB Shortcut
if not exist "core\scripts\shortcut.ps1" (echo core\scripts\shortcut.ps1 is missing. Re-download the complete ZIP.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "core\scripts\shortcut.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 3 >nul
endlocal
