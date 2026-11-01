@echo off
rem Stops the DROID ADB service and the tray icon.
start "" wscript.exe //nologo "%~dp0Stop.vbs"
exit /b 0
