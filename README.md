# Scrcpy Toolkit 3.0

A portable Windows control center for scrcpy: mirror, record, screenshot, remote-control and manage your Android phone from a local dashboard.

Helper project around scrcpy v5.0.1. The scrcpy binaries in `core/scrcpy/` are unmodified (Apache 2.0, see LICENSE.txt).

## Start
1. Extract the whole ZIP to a writable folder.
2. Double-click `Launch.bat`. It starts the backend under a supervisor and opens http://127.0.0.1:47821/ (port is a setting).
3. `Stop.bat` shuts everything down. No Node.js, Python or internet needed; it uses Windows PowerShell 5.1 and .NET.

Open the dashboard through the address above. Opening `index.html` directly from disk is not supported.

## What changed in 3.0
- Grouped navigation, new Studio, Automate, Monitor and Alerts pages, phone gallery and backups, macros and schedules, background jobs, inspector, insights, accent colours and more. See CHANGELOG.md.

## What changed in 2.5
- Bigger portrait phone, rebuilt charging animation, richer Media card (time, length, volume), balanced Console layout. See CHANGELOG.md.

## What changed in 2.4
- Real phone-body look, charging ring, animated rotate / pop-out transitions, coloured arrow cursor, Live indicator on the card. See CHANGELOG.md.

## What changed in 2.3
- **Phone card:** the preview is now a phone-shaped frame with battery, charging, temperature and connection details beside it. It follows the phone's real orientation and moves to the top when the phone is landscape.
- **Record while mirroring:** Mirror and Record are independent. A recording started during a mirror runs in the background (no second window).
- **Tap, swipe and drop on the picture;** battery trend, alerts, nicknames and shortcuts (U, L, C, ?). See CHANGELOG.md.

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
- `core/server/`: PowerShell backend (`server.ps1`, `supervisor.ps1`, `lib.ps1`, `handlers.ps1`, `routes-store.ps1`, `routes-phone.ps1`).
- `core/scripts/`: `start.ps1`, `launch.ps1` (used by `Mirror.bat` and `Record.bat`).
- `Config/`: settings and profiles. `Recordings/`, `Screenshots/`, `Logs/`: data.

## Testing status
Developed and tested with PowerShell 7 on Linux using fake adb and scrcpy programs and a real browser (backend load tests, toggle flows, reconnect after backend loss, mobile layout). These Windows-only parts could not be run and need a quick check on a real PC: stopping a background (windowless) recording with Ctrl+C, finding the scrcpy child process, and the Open folder / Show in folder actions. The 3.0 features that read real phone output (notifications, usage stats, battery stats, uiautomator, demo mode) were tested only against fake adb output and need a check on a real phone. See `docs/REGRESSION-CHECKLIST.md`.

## Safety
The backend binds to 127.0.0.1 only, validates the Host and Origin headers and requires a custom header on every change request. Phone file changes are limited to /sdcard.
