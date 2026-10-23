@echo off
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\scrcpy.exe" (echo scrcpy.exe missing from toolkit root.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$r='%ROOT%';$s=Get-Content -Raw (Join-Path $r 'Config\settings.json')|ConvertFrom-Json;$a=@('--max-size='+$s.maxSize,'--max-fps='+$s.maxFps,'--video-bit-rate='+$s.bitrate,'--window-title=Scrcpy Toolkit');if(-not $s.audio){$a+='--no-audio'};Start-Process -FilePath (Join-Path $r 'scrcpy.exe') -ArgumentList $a -WorkingDirectory $r"
endlocal