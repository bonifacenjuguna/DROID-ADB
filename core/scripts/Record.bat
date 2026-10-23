@rem Smoothness-first recording profile: H.264 video + AAC audio in Matroska container.
@echo off
setlocal
set "ROOT=%~dp0..\.."
set "TOOLKIT_ROOT=%ROOT%"
if not exist "%ROOT%\core\scrcpy\scrcpy.exe" (echo scrcpy.exe missing from core\scrcpy.& pause & exit /b 1)
if not exist "%ROOT%\Recordings" mkdir "%ROOT%\Recordings"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$r=$env:TOOLKIT_ROOT;$s=Get-Content -Raw (Join-Path $r 'Config\settings.json')|ConvertFrom-Json;$o=Join-Path $r ('Recordings\Phone-'+(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')+'.mkv');$a=@('--max-size=1024','--max-fps=30','--video-bit-rate=4M','--video-codec=h264','--audio-codec=opus','--audio-bit-rate=128K','--require-audio','--audio-dup','--window-title=ScrcpyToolkit','--record',('"'+$o+'"'));if(-not $s.audio){$a+='--no-audio'};Start-Process -FilePath (Join-Path $r 'core\scrcpy\scrcpy.exe') -ArgumentList $a -WorkingDirectory (Join-Path $r 'core\scrcpy')"
endlocal
