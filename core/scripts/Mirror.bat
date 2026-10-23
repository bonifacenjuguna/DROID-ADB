@echo off
setlocal
set "ROOT=%~dp0..\.."
set "TOOLKIT_ROOT=%ROOT%"
if not exist "%ROOT%\core\scrcpy\scrcpy.exe" (echo scrcpy.exe missing from core\scrcpy.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$r=$env:TOOLKIT_ROOT;$s=Get-Content -Raw (Join-Path $r 'Config\settings.json')|ConvertFrom-Json;$a=@('--max-size='+$s.maxSize,'--max-fps='+$s.maxFps,'--video-bit-rate='+$s.bitrate,'--window-title=ScrcpyToolkit');if($s.stayAwake -ne $false){$a+='--stay-awake'};if($s.turnScreenOff -eq $true){$a+='--turn-screen-off'};if($s.showTouches -eq $true){$a+='--show-touches'};if($s.alwaysOnTop -eq $true){$a+='--always-on-top'};if(-not $s.audio){$a+='--no-audio'};Start-Process -FilePath (Join-Path $r 'core\scrcpy\scrcpy.exe') -ArgumentList $a -WorkingDirectory (Join-Path $r 'core\scrcpy')"
endlocal