# Changelog

## 3.2.0
Usage fixes, a calmer battery ring, grouped notifications and big live graphs.

Monitor > Usage
- Fixed the "The process cannot access the file ... stk-out-....txt because it is being used by another process" error that blanked Screen time. The backend now reads adb output with shared access and retries for a few seconds (antivirus or the adb helper can still hold the file for a moment).
- Screen time now reads the newest day only, not the largest value from any day, so it really is "today".
- Battery use by app: the phone's own search command used a pattern that Android's grep does not understand; it is fixed. When Android has no numbers (it erases them while the phone sits at 100% on the charger) the card now says so and shows a clearly labelled estimate from screen time. Unplug for a while and press Reload to get measured mAh.
- Each card has its own Reload button. If a phone sends something the page cannot read, the message now says how many lines came back.

Monitor > Live
- Click Processor, Memory, Network or Temperature to open a big graph, the same way the phone preview opens big. Choose 2 min, 10 min, 1 hour, 4 hours or All.
- Move or drag over the big graph for red dotted guide lines (a vertical one that snaps to the nearest reading and a horizontal one that follows the pointer) with value and time tags, like a trading chart. The exact values are shown above the graph.
- Samples are now kept with their time (up to about 7 hours; older ones are thinned out). While another page is open the dashboard takes one slow sample every 30 s so the long graphs have no big gap. History is kept only while the dashboard page stays open.
- The "phone is hot" warning also works when you are on another page.

Console
- The phone preview sits at the top of the card with the name, battery, details and buttons below it.
- The pointer over the preview is about half the old size.
- Battery ring: no more white flashing. The white streak, white bubbles and pulsing glow are gone; white is only the empty part of the ring. The colour follows the charge: green when full, through lime and amber to red when low, with a soft two-tone gradient that changes smoothly. The header battery uses the same colours.

Notifications
- Each app lists one line per chat (sender). Only the newest message shows; a button such as "3 earlier" opens the rest. The phone's own "5 new messages" line becomes a "5 new" badge. After three chats an app shows "N more chats".

Known limits
- The Usage and notification changes read real phone output and were tested against fake adb output only. See docs/REGRESSION-CHECKLIST.md.

## 3.1.0
Fixes from an independent review of 3.0.0. No new pages.

Saved data
- The saved-data file (Config\store.json) can no longer be wiped by a bad read. If it cannot be read, nothing is written; the last good copy is kept in store.json.bak and is used automatically.
- Saving a macro is now one step (two quick saves can no longer overwrite each other).
- The page refuses to save lists (macros, pins, tags, snippets, games, nicknames) until your saved data has really loaded, so a short list can no longer replace the real one. Edits still waiting are sent when you switch tabs or close the page.
- The store stays under 1.5 MB, because Windows PowerShell 5.1 cannot read a bigger JSON text back. Import/export checks use the same limit.
- Import skips lists that are not lists and reports how many items were skipped.

Macros and schedules
- Stop now works in the middle of a macro, including long waits, not only between repeats. Progress counts correctly across repeats.
- A daily task is only counted as done once it was really queued, so a phone that is unplugged at 08:00 no longer loses the whole day.
- A scheduled task does not start again while its previous run is still waiting or running.
- Removed tasks are forgotten by the scheduler.

Dialogs and pages
- Pressing Enter in a form, prompt or confirm dialog now saves instead of cancelling.
- When the phone in use changes by itself (unplugged, another phone takes over), every page clears what it kept for the old phone.

Gallery and requests
- Gallery picture cache names use SHA-256 (no mixed-up pictures), pictures are written under a temporary name first, and pictures not seen for a week are removed.
- Gallery delete checks the phone id and takes at most 200 files per request.
- Request bodies are read with a hard size limit even when the browser sends no length.

Known limits (unchanged)
- Stop on an ffmpeg conversion or a GIF capture only takes effect when that step ends.

## 3.0.0
A big update: the dashboard is regrouped and many new tools were added.

Organised
- Navigation is grouped: Control (Console, Studio, Automate), Phone (Tools, Monitor, Alerts), Capture (Library), System (Devices, Settings). Keys 1-9 jump to pages; K drops a marker while recording; J opens background jobs. On small screens the bottom bar has a More sheet.
- Background jobs panel (header button) shows backups, pulls, conversions, macros and scheduled shots with progress and Cancel.
- Accent colours (Settings), settings export / import, phone nicknames now saved by the backend.

New pages
- **Studio:** Demo mode (clean status bar for screenshots), Game mode (per-game profile applied when the game comes to the front), capture presets, presentation view.
- **Automate:** record and replay macros (taps, swipes, keys, waits), edit steps, text snippets, scheduled screenshots and macros (every N minutes or daily).
- **Monitor:** live CPU, memory, network, temperature and top apps with trend lines.
- **Alerts:** phone notifications on the PC, copy one-time codes, optional Windows desktop alerts.

Library
- Phone gallery (thumbnails, pull or delete), Backups of phone folders, favourites, tags, search, recording markers.
- Trim, shrink and convert to GIF with ffmpeg (optional; put ffmpeg in core\ffmpeg or set its path). GIF capture from the Console.
- File names can include the foreground app ({app}).

Phone tools
- Inspect (tap the screen picture to see UI elements), Launch (send an intent), Insights (screen time, battery per app, accessibility and device-admin apps, permissions).
- Pin apps to the Console, paste text from the PC, live keyboard typing, annotate screenshots.

Devices
- Auto reconnect to known Wi-Fi phones, live wall of all connected phones.

## 2.5.0
Changed
- Portrait phone is bigger: it fills the card height and leaves room at the top.
- The loading sweep on top of the phone is gone. "Updating" now shows as a small spinner next to the picture info line.
- Charging animation rebuilt: a round-capped ring, a light that travels along the filled arc, a liquid fill that rises to the battery level with gentle waves, rising bubbles and a pulsing bolt. The ring is updated in place, so animations no longer restart every refresh. The battery trend line only shows once the level has actually changed.
- Media card: elapsed time ticks live, total length when the phone reports it, progress bar, album, number of players and volume.
- Console cards are balanced left and right: phone and Live sessions, Media beside Activity, Recent captures full width.

## 2.4.0
Changed
- Live indicator moved off the screen to the top corner of the phone card.
- Real transforms: the phone grows into the pop-out, shrinks back, and turns when the phone rotates (the card rotates and morphs to the new shape while the page reflows). Respects reduced motion and the layout animation setting.
- Cursor on the phone picture is now the normal arrow in colour (amber, orange while pressed).
- Phone body redrawn to look like a real device: metal frame with highlights, thin bezel, corner radius that follows the screen size, camera hole (left in landscape, right when turned the other way), side buttons that move to the top in landscape, antenna lines and a glass reflection.
- Battery percentage is now a ring. While charging the ring glows and a light sweeps around it, with a pulsing bolt.

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
