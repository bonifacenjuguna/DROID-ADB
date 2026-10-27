# DROID ADB - Quick Guide

## First run
1. Extract the full ZIP, run `Launch.bat`. The dashboard opens at http://127.0.0.1:47821/.
2. If the banner says the backend is not answering, wait a few seconds (it restarts itself) or run `Launch.bat` again.

## Shortcut and app install
- Double-click `Create-Desktop-Shortcut.bat` to put a DROID ADB shortcut with the logo on your Desktop (run it again if you move the folder).
- In Chrome or Edge you can also install the dashboard as an app from the address bar.

## Connect Android
Turn on Developer options and USB debugging, use a data cable, unlock the phone and accept the prompt.

## Everyday use
- **Mirror** and **Record** are toggles: click once to start, again to stop. Record is disabled while a mirror window is open (and the reverse) because the phone allows one capture at a time.
- Turn on "Record without a window" in Settings to record in the background; stop it from the dashboard.
- **Screenshot** saves a PNG. **Screen preview** shows the phone screen in the page.
- **Remote controls:** Shade, Quick, Screen and Mute stay highlighted while on; click again to turn off. Other keys flash when pressed.
- **Phone** page: quick settings (Wi-Fi, Bluetooth, brightness, volume...), apps, running apps (what is open and in front, Stop to close), files, log and shell.
- **Library**: play, rename, delete, bulk delete and clean up by age.
- **Studio:** Demo mode cleans the status bar; Game mode switches settings when a chosen game is in front.
- **Automate:** press Record a macro, tap on the phone picture on the Console, press Stop, then Run it or schedule it.
- **Monitor** and **Alerts** show live phone load and notifications.
- **Library** also has Phone gallery and Backups; trim and GIF need ffmpeg (core\ffmpeg or Settings).
- Background jobs: header button, shows progress and Cancel.
- Shortcuts: `Ctrl+K` palette, `1`-`9` pages, `M` mirror, `R` record, `S` screenshot, `K` marker, `J` jobs, `?` help.

## Wi-Fi
Devices page: "Switch this phone to Wi-Fi" with the cable plugged in, or pair with the code from Wireless debugging (Android 11+) and use "Find phones".

## Settings
Everything is configurable: quality presets, saved profiles, folders, file name templates ({date}, {time}, {model}), ports and timeouts. Items marked "restart" apply after a backend restart. The command preview shows the exact scrcpy command.

## Troubleshooting
- No device: check cable, USB debugging, authorization; use Restart ADB on Devices, or run the system check.
- scrcpy closes immediately: the toast shows the reason; full output is in `Logs/session-<id>.log`.
- Port busy: change the port in Settings (restart needed) or close the other instance.

## New in 4.2
- Click any card on Studio, Overview (or a core, or a temperature sensor) to open a large graph. Drag across it to zoom, double-click to reset, CSV saves the numbers.
- Studio, Thermals, Cool-down assistant: Start cool-down, watch the ring, and use Undo to put the settings back. Undo still works after you reload the page.
- Studio, Battery: charge, power, health, battery use by app, and the Watchdog switches.
- Install app (top bar) puts the dashboard on your PC like a normal program.
- If a recording says "Recording not started", the message now tells you the real reason. Video only in Settings, Audio always works.

## New in 4.1
Open Settings, Audio and pick a mode. Video only: no phone sound. Copy to recording: the file gets the game sound, the PC stays silent, the phone keeps playing (Android 13). Copy and play on PC: the same, and the PC plays it too. Reroute: the sound moves to the PC and the phone goes quiet. Library, More, Check sound tells you whether a recording really has sound. For OBS, use the Streaming audio section.

## New in 4.0
Open Studio (the rocket icon) for the Performance Studio. Pick a profile on Overview, use Boost before a game, watch Thermals while you play, and add games on the Games page so the right profile starts automatically.

## New in 3.6
- **Restart service / Restart backend** now waits for the new service and works on the first click. If it does not return in 60 seconds, run `Launch.bat`.
- **Error messages** are short sentences. For the original technical text open **Settings, Error log** (or press **Details** on an error notice).
- **Camera** (Remote controls) wakes the phone and opens its camera app.
- **Studio, Gaming kit**: live battery and temperature, quick switches, Free memory, Performance mode, Android Game Mode and frame stats. Games in Game mode can also free memory and use Game Mode automatically.
