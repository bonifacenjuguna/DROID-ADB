@rem Compatibility-first recording profile: use standard audio forwarding because scrcpy 5.0.1 audio duplication fails on some Android 13 devices.
@echo off
setlocal
set "ROOT=%~dp0..\.."
set "TOOLKIT_ROOT=%ROOT%"
if not exist "%ROOT%\core\scrcpy\scrcpy.exe" (echo scrcpy.exe missing from core\scrcpy.& pause & exit /b 1)
if not exist "%ROOT%\Recordings" mkdir "%ROOT%\Recordings"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$r=$env:TOOLKIT_ROOT;$s=Get-Content -Raw (Join-Path $r 'Config\settings.json')|ConvertFrom-Json;$o=Join-Path $r ('Recordings\Phone-'+(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')+'.mkv');$a=@('--max-size='+$s.maxSize,'--max-fps='+$s.maxFps,'--video-bit-rate='+$s.bitrate,'--video-codec=h264','--audio-codec=aac','--window-title=ScrcpyToolkit','--record',('"'+$o+'"'));if($s.stayAwake -ne $false){$a+='--stay-awake'};if($s.turnScreenOff -eq $true){$a+='--turn-screen-off'};if($s.showTouches -eq $true){$a+='--show-touches'};if($s.alwaysOnTop -eq $true){$a+='--always-on-top'};if(-not $s.audio){$a+='--no-audio'};Start-Process -FilePath (Join-Path $r 'core\scrcpy\scrcpy.exe') -ArgumentList $a -WorkingDirectory (Join-Path $r 'core\scrcpy')"
endlocal
