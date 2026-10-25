# Changelog

## 2.3.0
New
- Console: the phone is now a phone-shaped frame showing the real screen picture, with battery ring, charging state and source, temperature, voltage, connection type and readiness beside it. Update and Live moved under the phone; the separate Screen preview panel is removed.
- Orientation-aware layout: the frame, card and surrounding panels animate between portrait and landscape. Orientation is read from Android (new /api/device-live: rotation, current screen size and battery in one light call) and from each picture's real size, so it follows rotation even with Live off.
- Preview states: loading, updating, screen off, phone not ready, disconnected, backend offline and failed, each without disturbing the rest of the page.
- Settings: "Show the phone screen automatically" (one picture on connect or rotate) and "Phone status interval". Shortcuts: U (update picture), L (toggle Live) and matching command palette entries.

Improved
- Preview requests: strictly one at a time, decoded before display and cross-faded, object URLs always released, paused when the tab is hidden, the Console is closed, the card is scrolled out of view or the screen is off; exponential back-off, Live turns itself off after repeated errors.
- Backend preview: a single exec-out screencap call (no phone temp file; the old fixed file is no longer left on the phone), concurrent requests for one phone share a capture, PNG is validated, with a fallback to the old method.
- Battery and charging details are shared by one parser; charging state now distinguishes charging, full, not charging and on battery.

## 2.2.0
New
- Phone > Running: apps with live processes, the app in front, recent-apps order, memory per app, auto refresh, Open / Stop / Mirror app / more.
- Remote controls: Shade, Quick, Screen and Mute are highlighted toggles (Screen and Mute read the real phone state); all keys show press and result feedback. New Assistant key.
- Apps: friendly names, copy package name, remembers the last Phone tab.

Fixed
- App list is more robust: one adb call with a fallback command, and an error that shows what the phone actually said, with a Try again button.

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
