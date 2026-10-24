# Quick Guide

## First run
1. Extract the full ZIP, run `Launch.bat`. The dashboard opens at http://127.0.0.1:47821/.
2. If the banner says the backend is not answering, wait a few seconds (it restarts itself) or run `Launch.bat` again.

## Connect Android
Turn on Developer options and USB debugging, use a data cable, unlock the phone and accept the prompt.

## Everyday use
- **Mirror** and **Record** are toggles: click once to start, again to stop. Record is disabled while a mirror window is open (and the reverse) because the phone allows one capture at a time.
- Turn on "Record without a window" in Settings to record in the background; stop it from the dashboard.
- **Screenshot** saves a PNG. **Screen preview** shows the phone screen in the page.
- **Phone** page: quick settings (Wi-Fi, Bluetooth, brightness, volume...), apps, files, log and shell.
- **Library**: play, rename, delete, bulk delete and clean up by age.
- Shortcuts: `Ctrl+K` palette, `1`-`5` pages, `M` mirror, `R` record, `S` screenshot.

## Wi-Fi
Devices page: "Switch this phone to Wi-Fi" with the cable plugged in, or pair with the code from Wireless debugging (Android 11+) and use "Find phones".

## Settings
Everything is configurable: quality presets, saved profiles, folders, file name templates ({date}, {time}, {model}), ports and timeouts. Items marked "restart" apply after a backend restart. The command preview shows the exact scrcpy command.

## Troubleshooting
- No device: check cable, USB debugging, authorization; use Restart ADB on Devices, or run the system check.
- scrcpy closes immediately: the toast shows the reason; full output is in `Logs/session-<id>.log`.
- Port busy: change the port in Settings (restart needed) or close the other instance.
