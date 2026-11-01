@echo off
rem DROID ADB launcher. Starts the service silently (no terminal window stays open).
start "" wscript.exe //nologo "%~dp0Launch.vbs" %*
exit /b 0
