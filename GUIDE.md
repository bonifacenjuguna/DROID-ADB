# Quick Guide

## First run
1. Extract the complete ZIP to a writable folder.
2. Run `Launch.bat`. The dashboard opens at http://127.0.0.1:47821/.
3. If the page says the backend is offline, run `Launch.bat` again and reload.

## Connect Android
- Turn on Developer options and USB debugging.
- Use a USB data cable, unlock the phone, and accept the debugging prompt.
- The Console shows the phone with its battery level once it is ready.

## Everyday use
- **Mirror** opens an interactive scrcpy window.
- **Record** opens one window that mirrors and records to `Recordings/` as MKV. Close the window normally to finish the file.
- **Screenshot** saves a PNG to `Screenshots/`.
- **Remote controls** send Back, Home, Recents, volume, power and text to the phone.
- Press `Ctrl+K` for the command palette. Keys: `1`-`4` switch pages, `M` mirror, `R` record or stop, `S` screenshot.

## Wi-Fi
Plug the phone in once, open Devices, choose "Switch this phone to Wi-Fi", then unplug. Both devices must share a network. You can also connect to an address like 192.168.1.20:5555.

## Settings
Pick a preset or tune each value. Changes save to `Config/settings.json` and apply to the next session. The command preview shows exactly what scrcpy will run.

## Troubleshooting
- No device: check the cable, USB debugging, unlock, and authorization, then use Restart ADB on Devices.
- scrcpy closes immediately: a toast shows the last error. Full output is in `Logs/scrcpy-last.log`.
- Port busy: close another instance, or change 47821 in `core/server/server.ps1`, `Launch.bat` and `assets/app.js`.
- Missing scrcpy: extract the full ZIP again and keep `core/scrcpy/` intact.
