# Scrcpy Toolkit 2.3

A portable Windows control center for scrcpy: mirror, record, screenshot, remote-control and manage your Android phone from a local dashboard.

Helper project around scrcpy v5.0.1. The scrcpy binaries in `core/scrcpy/` are unmodified (Apache 2.0, see LICENSE.txt).

## Start
1. Extract the whole ZIP to a writable folder.
2. Double-click `Launch.bat`. It starts the backend under a supervisor and opens http://127.0.0.1:47821/ (port is a setting).
3. `Stop.bat` shuts everything down. No Node.js, Python or internet needed; it uses Windows PowerShell 5.1 and .NET.

Open the dashboard through the address above. Opening `index.html` directly from disk is not supported.

## What changed in 2.3
- **The phone is the centrepiece.** The Console now shows your phone as a framed, phone-shaped display with its real screen picture inside. The old Screen preview panel is gone; Update and Live live under the phone. The frame always matches the phone's real screen ratio, so the picture is never stretched or cropped.
- **Battery and status in one place.** Battery level (ring and percentage), charging state and source, temperature, voltage, USB or Wi-Fi, and readiness sit beside the phone and refresh every few seconds while the Console is open.
- **Follows rotation.** When the phone turns to landscape (for example in a game), the frame turns with it, the card widens to the top of the dashboard and the panels below glide into place. Turning back reverses it. The orientation comes from Android itself, so it works even with Live off. Reduced-motion settings are respected.
- **Calmer preview.** One request at a time, no flicker or stale flashes, paused while the page is hidden or the phone card is off screen, automatic back-off after errors. Clear states for loading, updating, screen off, unavailable, disconnected and failed.
- **Safer screenshots.** The preview is read straight from the phone in one adb call, no temporary file is left behind, and overlapping requests share one capture.
- New settings: *Show the phone screen automatically* and *Phone status interval*. New keys: **U** updates the picture, **L** toggles Live.

## What changed in 2.2
- **Running apps:** new Phone > Running tab lists apps with live processes, which one is in front, recent-apps order and memory use, with Open, Stop and Mirror app. Auto-refreshes.
- **Remote controls light up:** Shade, Quick, Screen and Mute are real toggles that show their state (Screen and Mute read the phone); every key gives press feedback.
- **App list rebuilt:** one phone call with a fallback, friendly names, and the phone's own error message if it refuses.

## What changed in 2.1
- **No more "offline" while recording.** The backend is now multi-threaded with a dedicated lane for status calls, so slow adb calls can no longer block the page. A supervisor restarts the backend if it ever dies. The page only reports a problem after three failed checks and never disables its buttons because of it.
- **Buttons show what happened.** Mirror and Record are real toggle buttons (pressed, busy spinner, live timer). Every action shows a busy state and a success or failure flash.
- **Nothing hardcoded.** About 68 settings in 8 groups: port, workers, folders, adb/scrcpy paths, timeouts, file name templates, refresh rates, stop grace time, extra scrcpy arguments and more. Settings, presets, named profiles, import/export and reset are all in the Settings page, which is built from the backend schema.
- **Much more to do.** Quick phone settings, app manager, phone file browser, phone log, adb shell, screen preview, wireless pairing and discovery, power actions, background recording, countdown, mirror a single app, library playback, rename and bulk delete, system check.

## Layout
- `index.html`, `assets/`: dashboard.
- `core/server/`: PowerShell backend (`server.ps1`, `supervisor.ps1`, `lib.ps1`, `handlers.ps1`).
- `core/scripts/`: `start.ps1`, `launch.ps1` (used by `Mirror.bat` and `Record.bat`).
- `Config/`: settings and profiles. `Recordings/`, `Screenshots/`, `Logs/`: data.

## Testing status
Developed and tested with PowerShell 7 on Linux using fake adb and scrcpy programs and a real browser (backend load tests, toggle flows, reconnect after backend loss, mobile layout). These Windows-only parts could not be run and need a quick check on a real PC: stopping a background (windowless) recording with Ctrl+C, finding the scrcpy child process, and the Open folder / Show in folder actions. See `docs/REGRESSION-CHECKLIST.md`.

## Safety
The backend binds to 127.0.0.1 only, validates the Host and Origin headers and requires a custom header on every change request. Phone file changes are limited to /sdcard.
