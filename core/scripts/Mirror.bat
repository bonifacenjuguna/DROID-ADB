@echo off
setlocal
if not exist "%~dp0..\scrcpy\scrcpy.exe" (echo scrcpy.exe missing from core\scrcpy.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch.ps1" -Mode mirror
endlocal
