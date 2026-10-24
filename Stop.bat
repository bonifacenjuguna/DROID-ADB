@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "core\scripts\start.ps1" -Stop
timeout /t 2 >nul
endlocal
