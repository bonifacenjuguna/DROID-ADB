# Changelog

## 2.1.0
Reliability rebuild plus a much larger feature set.

Fixed
- Dashboard no longer shows the backend as offline while mirroring or recording; the backend is multi-threaded with a fast lane and a supervisor, and the page tolerates failed checks.
- Buttons now show pressed, busy and result states; Mirror/Record are real toggles.
- Recording stop is graceful (close window, Ctrl+C, then force after a configurable grace time).

New
- Schema-driven Settings (about 68 options), profiles, import/export, per-field reset, live command preview.
- Phone page: quick settings, brightness/volume/timeout, app manager (launch, stop, clear, uninstall, disable, APK install and export, mirror one app), file browser, phone log, adb shell.
- Wireless pairing and discovery, power actions, screen preview, open URL on phone, gestures, media keys.
- Library: playback with seeking, rename, bulk select/delete, cleanup preview.
- Background recording, start countdown, time limit, system check, backend log, restart and quit.

Changed
- Port, folders, timeouts, tool paths and file name templates moved from code into settings.

## 2.0.0
Full redesign of the dashboard and a larger backend.

New
- Console with a live device stage: model, Android version, battery level, charging, screen size, phone storage.
- Screenshots from the phone, saved to `Screenshots/`, with a preview gallery.
- Remote controls: Back, Home, Recents, notification shade, volume, wake, power, and a text sender.
- Wireless connection: switch a USB phone to Wi-Fi, connect by address, disconnect, restart ADB.
- Multi-device support with a device picker.
- Live session cards with a running timer and growing recording size.
- Activity feed, and a readable reason when scrcpy closes right away (`Logs/scrcpy-last.log`).
- Library with recordings and screenshots tabs, filter, sort, per-file delete, and storage meter.
- Settings presets (Battery saver, Balanced, Quality, Maximum) plus codec, audio source, view-only, borderless, full screen, show touches, lock phone on close.
- Live command preview showing exactly what scrcpy will run.
- Command palette (Ctrl+K) and keyboard shortcuts: 1-4 views, M mirror, R record, S screenshot.
- Light and dark themes. All icons are inline SVG; nothing loads from the internet.

Changed
- The backend now serves the dashboard at http://127.0.0.1:47821/ (opening index.html directly still works).
- Mirror and record launch through one shared launcher, so `Mirror.bat`, `Record.bat` and the dashboard behave the same.
- The API rejects unexpected Host headers and foreign origins.
- `GUIDE.md` now correctly says recordings are MKV.

## 1.0.0
- Added local browser dashboard and PowerShell backend.
- Added mirror, recording, stop, and device-check actions.
- Added shared video settings.
- Added recording library, folder opening, and cleanup preview.
- Added quick-start and troubleshooting documentation.
