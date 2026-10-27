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

## New in 3.6
- **Restart service / Restart backend** now waits for the new service and works on the first click. If it does not return in 60 seconds, run `Launch.bat`.
- **Error messages** are short sentences. For the original technical text open **Settings, Error log** (or press **Details** on an error notice).
- **Camera** (Remote controls) wakes the phone and opens its camera app.
- **Studio, Gaming kit**: live battery and temperature, quick switches, Free memory, Performance mode, Android Game Mode and frame stats. Games in Game mode can also free memory and use Game Mode automatically.

## New in 3.9: Audio modes
- **Studio, Capture, Audio**: pick Video only, Copy to recording (PUBG recording with a silent PC), Copy and play on PC, or Reroute audio to PC. The change applies the next time you start a mirror or recording.
- Under each card you see what the phone, the PC and the saved file do. The "Running now" box shows what each session really uses, and warns if it differs from your choice.
- **Game sound for OBS**: turn on, restart the mirror, then in OBS add Window Capture for video and Application Audio Capture for scrcpy.exe. Off means OBS gets no game sound.
- **Check a recording** tells you if the last file has sound.
- If a game blocks capture the file stays silent: use Reroute, or record with the phone's own screen recorder.

## New in 3.8: Studio rebuilt
- Seven tabs: **Overview, Performance, Optimize, Cooling, Battery, Games, Capture**. The LIVE pill shows when data last arrived; pick the refresh rate or pause it (key `P`). `[` and `]` change tab.
- **Click any card** to open a big graph. Pick a period (5 min to 24 h), hover to read values, drag to zoom, double-click to reset, click a series name to hide it, **CSV** exports the data.
- **Optimize** profiles show each step as it runs and **Undo** restores your previous settings. Save your current settings as a custom profile.
- **Performance** has per-core load, busiest apps (stop button), frame stats with a histogram, and a recorder whose runs appear in Games, Session history.
- **Install as an app**: in Chrome use the Install button in the address bar (or the Install button in the dashboard).

## New in 3.7: Performance Studio
- **Overview** shows how ready the phone is, live gauges and suggestions. **Turbo boost** sets up a gaming environment in one tap and **Undo** restores it.
- **Cooling** shows temperatures and runs the cool-down assistant. Set your own warning limit.
- **Optimize** has quick switches, memory, performance mode, Game Mode, frame stats and a network check.
- **Games** holds game profiles, a Play button and session history. **Capture** has demo mode and capture presets.
- If the phone declines Game Mode or performance mode, the message shows what it answered. The technical reply is in Settings, Error log.
