# Changelog

## 4.2.2
Fixes a break I introduced in 4.2.0 and 4.2.1: choosing any sound mode other than Video only made Mirror and Record fail with "Unexpected backend error: The term 'Get-DeviceAudioInfo' is not recognized".

Fixed
- When the scrcpy check was rewritten in 4.2.0, the function that reads the phone's Android version (`Get-DeviceAudioInfo`) was removed by mistake. Video only never calls it, which is why the default still worked. It is restored exactly as it was in 4.1.0. Every function called by the server scripts was then checked against the functions that exist, and none are missing.
- The Reroute changes from 4.2.1 stay: no pre-check, no stop-if-no-sound flag on Reroute recordings, and stale audio source or codec values are ignored.

Not verified
- Still not run on a Windows PC or phone. Check Reroute first (docs/REGRESSION-CHECKLIST.md, section 4.2.1).

After updating, run Launch.bat again so the background service restarts with the new version.

## 4.2.1
Reroute audio works again, the way it did in 3.9.0.

Fixed
- Reroute audio to PC. 4.x checked the phone and scrcpy before starting a session, and any hiccup in those checks turned Reroute into video only. Reroute now uses scrcpy's own default audio with no pre-check, exactly as 3.9.0 did. Only a phone already known (from the cache) to be older than Android 11 is refused. Problems are reported from scrcpy's own log after the session starts.
- Recordings in Reroute no longer pass --require-audio. With it scrcpy aborted the whole recording when its sound capture hiccuped; the sound check after the recording still tells you if the file is silent.
- A saved Audio source or Audio codec that is empty or not on the list used to become an invalid option ("--audio-source=") and stop scrcpy from starting. Unknown values are now ignored and the defaults are used. 3.9.0 never read these values, which is why old settings did not matter there.
- Copy to recording and Copy and play on PC are unchanged and still need Android 13 or newer (the reason is shown in the audio status). They are the next ones to fix.

Not verified
- The PowerShell changes were checked by reading and a bracket check only. See docs/REGRESSION-CHECKLIST.md, section 4.2.1.

After updating, run Launch.bat again so the background service restarts with the new version.

## 4.2.0
Studio Plus: clickable analytics, per-core load, the Cool-down assistant, a Battery page, Watchdog alerts, installable app, motion, and the recording fix.

Fixed
- Recording could refuse to start with "Recording not started. Scrcpy did not list its audio options (...)". Cause: before every recording and mirror the service started `scrcpy.exe --version` and `--help` just to read which audio options exist. On a PC where that start is slow (antivirus checking the program) it timed out, and the check failing was treated as "this phone cannot do audio". Now the option list is read from scrcpy.exe as a file (instant, nothing is started). If scrcpy has to be started it gets 30 and 40 seconds, and if the check still cannot run the audio mode is tried anyway with a warning instead of refusing. A recording is only refused when a mode is known not to work (phone older than Android 11 or 13, option missing in scrcpy).
- A timeout of scrcpy used to say "The phone did not answer in time". It now says which program was slow.
- Error messages longer than 220 characters were replaced by "Something did not work as expected", which hid the real reason (this is why the recording message above was not readable). The limit is now 480 characters; technical messages are still summarised and kept in Settings, Error log.
- Each browser tab that was closed or refreshed while a page was loading wrote an "Unexpected backend error" to the log. These are now ignored.

New
- Clickable analytics cards. Every card on Overview (Processor, Memory, Temperature, Battery, and new Graphics, Power, Storage and Frame rate cards) and the hero numbers open a large graph: 5 minutes to 24 hours, hover read-out, drag to zoom, show or hide series, CSV export. History is kept for 24 hours per phone in the browser (downsampled).
- Processor cores card: load and clock speed for every core, grouped into efficiency, performance and prime cores. Click a core for its history. Needs the per-core load that `/api/perf` now reports (`cores[].pct`).
- Cool-down assistant (Thermals): animated ring, falling temperature, live steps, aurora and snow background, a forecast of when the phone gets hot, finish celebration, and Undo that puts every setting back. The hero card shimmers while cooling.
- Battery page: charge ring, power, current, voltage, health, capacity against new, time left or time to full, charge history, battery use by app. `/api/perf` now also reports `batt` (current, health, technology, charge counter, capacity).
- Watchdog: toasts (and desktop notifications when allowed) for overheating, throttling, low battery and nearly full memory. Optional background watching every 30 seconds while the tab is open. Settings are on the Battery page.
- Undo is saved, so it still works after reloading the page, and the profile result panel has an Undo button.
- Installable app (PWA): service worker, maskable icons, Install app button.
- Motion: pages and cards rise in one after another, buttons ripple and press, toasts and dialogs animate, theme changes fade, numbers tick when they change, small celebrations after a cool-down or a profile. `STK.fx.pop`, `shake` and `burst` can be used on any page. Everything switches off when the system asks for reduced motion.

Changed
- The Studio code stays in the 4.x files. New files: `xp-ui.js` (graph engine, history store), `xp.css`, `studio-plus.js`, `motion.js`, `motion.css`, `sw.js`, `pwa.js`.
- Versions: page and service report 4.2.0.

Not verified
- Written without a Windows PC or phone. The dashboard was tested in a headless browser against a simulated backend (no script errors, graphs, cores, cool-down, Battery page, Undo after reload, Watchdog toasts, service worker). The PowerShell changes were checked by reading and a bracket check only. Real-phone checks are in docs/REGRESSION-CHECKLIST.md, section 4.2.

After updating, run Launch.bat again so the background service restarts with the new version.

## 4.1.0
Audio modes, recording sound and OBS streaming guidance.

New
- Four audio modes in Settings, Audio, stored as `audioMode`: `video_only` (default), `record_only` (Copy to recording), `copy_play` (Copy and play on PC), `reroute` (Reroute audio to PC). One controller (`Resolve-AudioPlan` in lib.ps1) builds every audio option of every scrcpy process, and reports what each session really does.
- Options were checked against the bundled scrcpy 5.0.1: `--audio-source=playback --audio-dup` (copy, phone keeps playing), `--no-audio-playback` (PC silent while recording), `--audio-source=output` (reroute, scrcpy's default), `--require-audio`. The controller also reads `scrcpy --help` and the phone's Android version at start. Copy modes need Android 13, Reroute needs Android 11.
- Requested and active are shown separately. If the phone or scrcpy cannot do a mode, the session starts as video only and says so; a recording is refused instead when "Stop a recording if its sound cannot be captured" is on (default).
- Sound problems that scrcpy logs are reported as soon as they happen. After a recording ends its container is checked for a sound track; Library, More, Check sound also measures loudness when ffmpeg is present.
- Streaming audio (OBS): a plan selector (no game sound, listen on the PC, silent PC speakers) checked against the audio mode, with the OBS and Windows steps, and a read-only Windows audio check. DROID ADB does not configure OBS or install audio drivers. It never changes the phone, the mirror or a recording because of this choice.
- Routes: `GET /api/audio-status`, `POST /api/audio-mode`, `GET /api/audio-check`, `GET /api/audio-env`. `/api/schema` also lists the modes. Mirror and recording sessions carry an `audio` object and `audioState`.
- Docs: `docs/AUDIO.md` (modes, OBS setup, real-device test matrix) and `core/scripts/audio-selftest.ps1`.

Changed
- Default is Video only. Before 4.1 the saved `audio` setting was on by default, which sent sound to the PC and silenced the phone. If you relied on that, pick Reroute audio to PC once. The old `audio` and `audioDup` keys are kept so backups import, but they are no longer used.
- Presets: Low latency sets Video only, Screen recorder sets Copy to recording.
- With Reroute, "Sound in companion recordings" still controls whether a recorder started next to the mirror captures sound.

Not verified
- Written and statically checked without a Windows PC or phone. Audio on the TECNO KJ5, PUBG Mobile capture, two simultaneous captures, and OBS routing still need the manual tests in docs/AUDIO.md.

After updating, run Launch.bat again so the background service restarts with the new version.

## 4.0.0
Performance Studio: a new gaming and app performance center, plus the Game Mode fix.

Fixed
- Game Mode (performance) said the phone was not supported ("needs Android 12 or newer") on Android 13. The check was hard-coded and too strict. The service now reads the real Android version, tries the command forms used by Android 12, 13 and newer, and counts it as applied only when the phone accepts it. If the phone still refuses, the page shows the phone's own reply. Studio, Optimize, Compatibility check shows what your phone supports.

New
- Studio is now Performance Studio with six pages: Overview, Optimize, Thermals, Games, Network, Capture.
- Overview: health score, live CPU, memory, temperature, battery and refresh rate with history graphs, per-core clocks, smart suggestions, and one-tap profiles (Balanced, Gaming, Turbo, Cool, Battery saver, Record). Your earlier settings are saved and can be restored.
- Optimize: Boost, trim caches, refresh rate, animation speed, brightness, quick switches, Game Mode modes, fixed performance mode, compatibility check.
- Thermals: temperature gauge, zone readings, history with comfort bands, heat forecast, cool-down tracker, cooling techniques, custom warning limits.
- Games: library with per-game profile, automatic game mode on launch with a saved session report, live frame monitor (fps, jank, p50/p95).
- Network: Wi-Fi signal, ping, jitter and packet loss test with a plain verdict.
- Capture: quick capture, demo mode, capture presets.
- Command palette: Boost, Cool down, Gaming profile, Thermals, Network.
- Routes: `GET /api/perf` and `POST /api/perf-tools` (freemem, boost, trimcaches, perfmode, gamemode, compat, refresh, animscale, lowpower, resetstats, dexopt, forcestop, launch, netcheck). `POST /api/game-tools` still works.

Compatibility
- No settings keys, backup format or existing routes were removed. Backups from earlier versions import as before.

After updating, run Launch.bat again so the background service restarts with the new version.

## 3.6.0
Reliability, clearer messages, Studio gaming tools.

Fixed
- "Restart service now" and "Restart backend" sometimes needed many clicks. Shutting down could hang while a worker was still waiting on a slow adb call, so the supervisor never started a new backend. The backend now leaves on its own after a few seconds if the clean shutdown stalls, and the supervisor restarts it as before. The dashboard also waits until the new service really answers, ignores repeat clicks while a restart is running, and tells you to run Launch.bat only if it does not return within 60 seconds.
- Remote controls, Camera: the button only sent the hardware camera key, which most phones ignore. It now wakes the phone and opens the camera app (still-image intent, then image capture, then common camera apps), and only falls back to the old key if nothing else works.
- Settings: Command preview and Backup were shown side by side on medium-width windows. They are now always stacked, Command preview first.
- Settings: the About card is centered under the settings instead of sitting in the right column.

New
- Plain-language errors. Raw adb, scrcpy and backend messages are translated into a short explanation of what is happening and what to try. A "Details" button on error notices opens the log.
- Settings, Error log: the original technical text for each problem (this session), the backend error log, and the other log files, each with Copy and Clear. New backend routes `GET /api/logs` (list or read, whitelisted file names only) and `POST /api/logs-clear` (backend error log only).
- Studio, Gaming kit: live battery, temperature, foreground app and session time; one-tap switches for Do not disturb, Show touches, Stay awake, Animations, Auto-rotate and Auto brightness; Free memory; Performance mode on/off; Android Game Mode (performance); frame stats (janky frames, typical and slow frame time) with reset. New routes `POST /api/game-tools` and `GET /api/game-stats`.
- Studio, Game mode: each game can now also free memory and switch Android Game Mode to performance when it starts (and back to standard when you leave). Play time per game is tracked. Warnings appear when the phone gets hot (43 °C or more) or the battery is 15% or lower and not charging.

Compatibility
- No settings keys, backup format or existing API routes changed. Backups from earlier versions import as before.

After updating, run Launch.bat again so the background service restarts with the new version.

## 3.5.0
Branding polish. No feature changes.

Icons
- New favicon and sidebar mark: the Windows panes and the Android robot on a navy tile. The earlier one squeezed the whole monitor-and-phone scene into 16 pixels and looked blurry. The full scene logo is still used in the About panel and README.
- Fixed: the mirror window kept scrcpy's icon. scrcpy 5 reads its icons from a folder named by SCRCPY_ICON_DIR (files scrcpy.png and disconnected.png). DROID ADB now points that at `core/branding/`, which holds the DROID ADB icon and a DROID ADB "phone disconnected" picture. Files in `core/scrcpy/` are still untouched. Delete `core/branding/` to get scrcpy's icons back.
- Known limit: the icon inside scrcpy.exe itself (seen in Explorer or when pinning scrcpy.exe) is part of the program and is not changed.

New
- `Create-Desktop-Shortcut.bat` creates a "DROID ADB" shortcut with the logo on your Desktop. The icon file is `core/branding/droid-adb.ico`.
- The dashboard has a web app manifest (name, theme colour, 192 and 512 pixel icons), so Chrome and Edge can install it as an app with the DROID ADB icon. A theme-color tag and an apple-touch icon were added too.
- The backend now serves `.webmanifest` files.

Docs
- Version 3.5.0 everywhere. NOTICE, third-party list, README, guide and regression checklist updated.

After updating, run Launch.bat again so the background service restarts with the new version.

## 3.4.0
Rebrand to DROID ADB. No features were added or removed.

Branding
- New name everywhere: page title, tab title (including the recording indicator), the default mirror window title, launcher window, backend messages, docs and code comments.
- New logo in the sidebar, favicon and app icon from the DROID ADB logo set. The full logo set is in `branding/`.
- Mirror window icon: 3.4 tried to set it with a scrcpy option that scrcpy 5 does not have, so it kept the scrcpy icon. Fixed in 3.5.0.
- New About panel in Settings with the version, credits and licence summary.

Compatibility
- Backups are now named `droid-adb-backup.json`. Backups made by earlier versions (`scrcpy-toolkit`) still import.
- A window title saved by an older version (Scrcpy Toolkit) is shown as DROID ADB. Titles you changed yourself are kept.
- Internal names (settings keys, browser storage keys, request header, folders) are unchanged, so your saved data keeps working.
- scrcpy and adb are still called by their real names where the text describes the tools themselves.

Legal
- Added `NOTICE.md` and `THIRD-PARTY-LICENSES.md`. scrcpy's licence text and copyright lines are kept in `LICENSE.txt`.

After updating, run Launch.bat again so the background service restarts with the new version.


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
