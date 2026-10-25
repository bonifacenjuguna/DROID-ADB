# Changelog

## 2.3.1
Fixed
- The phone picture no longer flashes "loading" or "no phone". A slow or empty answer from adb used to wipe the device list for a moment; the backend now keeps the last list for a few cycles and the page ignores short dips.
- Apps list: fixed with the same root cause, plus separate fallbacks (pm, cmd package, --user 0), one automatic retry, the last good list on failure, and a clear message with Try again when the phone returns nothing.
- Phone sizes: only two views now, Normal and a pop-out big screen (fills the window, nothing on top of it, Esc or Close to leave). The cropped small view is gone.

New
- Fingertip cursor on the phone picture (glowing touch dot that shrinks on press, grows on long-press) instead of the crosshair.
- Media card: now playing (title, artist, app) with an animated equalizer, previous / play-pause / next and volume. The media keys left the gestures row.
- Record whenever I mirror (setting): the background recording starts and stops with the mirror. REC badge with timer and size on the phone picture, Stop all button when two sessions run.

## 2.3.0
New
- **Phone card:** the Screen Preview panel is now a phone-shaped frame at the top of the Console, sized to the phone's real screen shape. Battery %, charging, power source, temperature, voltage, USB/Wi-Fi, the app in front, Update and Live sit beside it.
- **Orientation-aware layout:** the backend reads the phone's real rotation, so the card moves to the top and widens when the phone goes landscape (for example in a game) and returns smoothly in portrait. Uses the browser's view transitions where available; respects reduced motion.
- **Record while mirroring:** Record and Mirror are independent. Recording during a mirror runs as a hidden second scrcpy process: no extra window, the mirror stays open, stop either one on its own.
- **Touch on the picture:** click to tap, drag to swipe, hold to long-press. Drop an APK or file on the phone to install or send it.
- Battery history sparkline with a rough time estimate, low battery and low disk alerts, phone nicknames, copy picture, phone size (S/M/L), keyboard shortcuts U / L / C / ? and a shortcuts dialog.
- Settings: record while mirroring, companion audio, status refresh, preview touch, pause preview during sessions, refresh preview after rotation, layout animation, battery and disk alert levels, app display names.

Improved
- Preview engine: one request at a time, ETag/304 so unchanged screens cost nothing, picture decoded before it replaces the old one, object URLs released, backoff on errors, pauses when the tab is hidden or the screen is off.
- Status polling is skipped while the dashboard tab is hidden.

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
