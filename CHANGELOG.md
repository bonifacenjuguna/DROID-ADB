# Changelog

## 3.3.0
Fixes after testing 3.2 on a real phone.

Why 3.2 looked unchanged
- The page files (HTML, JS, CSS) update as soon as you refresh, but the background service (PowerShell) keeps running the old code until it is restarted. After copying a new version over the old one without running Launch.bat again, Usage kept showing the old "process cannot access the file" error and notifications could not show new data. The page now compares its own version with the service. If they differ it shows a banner with "Restart service now", and when no mirror or recording is running it restarts the service once by itself. Launch.bat also always replaces the old service.

Monitor
- Usage: the lock fix (shared read with retries) is now in the version that gets loaded. Screen time is now worked out from today's foreground/background events (more reliable on Android 13 phones such as TECNO); the older summary is used only as a fallback. Battery use by app gets a second source (the checkin report) when the first is empty.

Notifications
- Messages inside a notification are now read from the phone (the list behind "10 new messages" and inbox style lines). Under the conversation you get "Show N earlier messages"; they open as small message cards with sender and time. The latest message that is already on screen is not repeated.
- These messages are remembered on this PC (last 20 per conversation, kept 3 days) so they stay readable after the phone replaces them.
- If a phone lists messages but gives no readable text, a short grey note says so instead of silently showing nothing.

Known limits
- Some phone makers hide message text from adb. In that case only the summary can be shown.

## 3.2.0
Fixes and polish from real-phone testing. No new pages.

Monitor
- Fixed: Usage ("Screen time today", "Battery use by app") showed "The process cannot access the file ...stk-out-....txt because it is being used by another process". adb can keep its temporary output file open for a moment, and the backend now reads it in shared mode and retries briefly instead of failing. This also protects every other page that talks to the phone.
- Click or press Enter on any card (Processor, Memory, Network, Temperature) to open a large graph that pops up like the phone preview. Choose 5 min, 30 min, 1 hour, 6 hours or 24 hours.
- Longer history: samples are kept for 24 hours (older than 1 hour are averaged into 30 second steps) and are saved in this browser, so the graph survives a page reload.
- Trading-style guide: moving over the big graph draws red dotted horizontal and vertical lines, snaps to the nearest sample, and shows the exact value and time on the axes and in a small tooltip. Works with touch too. Esc closes.
- Min / average / max are shown under each big graph.

Notifications
- When one app has more than two notifications, the two newest show and the rest fold under "Show N earlier". The count is shown next to the app name.
- Earlier notifications are remembered on this PC (up to 40 per app, kept 3 days) so ones the phone has replaced with a summary such as "5 new messages" can still be read. They are marked "no longer on the phone".

Console
- The phone preview now sits higher: top spacing of the card is reduced and the preview and the details beside it are aligned to the top.
- The tap cursor over the preview is about 40% smaller.
- Battery ring: removed the white flashing travelling dash and the pulsing glow. White now only shows in the unfilled part of the ring. The colour follows the level smoothly (green when healthy, through amber, to red when low) with a soft gradient on the ring and the liquid, more bubbles that rise only inside the filled part, and calmer waves. The small battery in the header uses the same colour.

Known limits
- Screen time depends on what the phone shares through adb (dumpsys usagestats). If the phone hides it, the card says so instead of showing an error.
- Notification history starts from the moment the Alerts page or "Mirror new ones" is first running; the phone does not give a past list.

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
