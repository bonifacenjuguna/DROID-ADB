# Manual Regression Checklist

Use this checklist after dashboard, backend, launcher, or recording-related changes. Run it on Windows with a test Android device when available. Do not treat a syntax check as a replacement for these runtime checks.

## Launch and backend
- [ ] Extract the complete project folder and start it with `Launch.bat`.
- [ ] Confirm the dashboard opens and the local backend reports as connected.
- [ ] Confirm a missing backend or dashboard file produces a useful error instead of silently failing.
- [ ] Refresh the dashboard and confirm the status and device information reload.

## Device and mirroring
- [ ] Connect an Android device with USB debugging enabled and accept the debugging prompt.
- [ ] Confirm the device appears in Overview and Device diagnostics.
- [ ] Start mirroring and confirm the scrcpy window opens.
- [ ] Close the mirroring window normally and confirm the dashboard recovers its session state.
- [ ] Disconnect the device and confirm the UI reports the changed state without becoming stuck.

## Recording and recording library
- [ ] Start a recording and confirm a new MKV file appears in `Recordings/`.
- [ ] Stop recording normally and confirm the file is finalized and listed in the library.
- [ ] Confirm existing MP4 files remain visible and their open/reveal actions still work.
- [ ] Confirm file size and modified-time labels are sensible.
- [ ] Close a recording or mirroring window normally and confirm the app does not forcibly terminate the process before it can finalize the recording.

## Settings and persistence
- [ ] Change the supported size, FPS, bitrate, and audio settings.
- [ ] Reload the dashboard and confirm saved settings remain selected.
- [ ] Start a new session and confirm the selected settings are applied.
- [ ] Confirm invalid or unavailable values are handled with a visible error rather than breaking the dashboard.

## Diagnostics and cleanup
- [ ] Run the available ADB/device diagnostics and confirm the output is readable.
- [ ] Open the cleanup preview and inspect the proposed files before confirming.
- [ ] Cancel cleanup and confirm no files are deleted.
- [ ] Run cleanup only on disposable test files and confirm only eligible files are removed.
- [ ] Confirm the recordings and logs needed for active sessions are not removed unexpectedly.

## Before merging a cleanup-only PR
- [ ] Review the diff and confirm no recording flags, audio arguments, API routes, session handling, settings semantics, or cleanup eligibility rules changed unintentionally.
- [ ] Run JavaScript syntax checks and any repository tests that exist.
- [ ] Record which Windows/device checks were actually performed; mark unavailable checks as not tested.

## Added in 2.0.0 (run on Windows with a real device; mark anything untested)
- [ ] Console shows model, Android version, battery and charging state; values refresh after about 30 seconds.
- [ ] Screenshot saves a PNG in `Screenshots/` and appears in Recent captures and the Library.
- [ ] Back, Home, Recents, shade, volume, wake and power keys reach the phone; text sender rejects unsupported characters.
- [ ] Switch to Wi-Fi works, the cable can be unplugged, and Disconnect all removes the device.
- [ ] With two devices attached, the picker changes which phone mirrors, records and gets keys.
- [ ] Starting scrcpy with no authorized device shows the error from `Logs/scrcpy-last.log`.
- [ ] Deleting a file in progress is refused; deleting a finished file asks first.
- [ ] Command preview matches the real scrcpy command line for Mirror and Record.
- [ ] `Mirror.bat` and `Record.bat` run the same command as the dashboard.
- [ ] Opening `index.html` directly (file://) shows the "open through the toolkit" message instead of a broken page.

## Added in 2.1.0 (Windows, real device; mark anything untested)
- [ ] Mirror, then close the window: the toggle returns to "Mirror" within a few seconds. Backend chip stays "Backend online" the whole time.
- [ ] Record with a window, stop from the dashboard: the file finalizes and plays in the Library.
- [ ] Settings, "Record without a window": start, wait, press Stop. Confirm the file is playable (this exercises the Ctrl+C path; untested outside Windows).
- [ ] Kill the backend process in Task Manager: the banner appears, the supervisor restarts it, the page reconnects, running scrcpy windows are still listed.
- [ ] Phone page: toggles (Wi-Fi, Bluetooth, dark mode), brightness, apps (open, stop, info, APK install), files (browse, copy, upload, mkdir), log, shell.
- [ ] Devices: pairing, Find phones, power actions ask for confirmation, System check is readable.
- [ ] Change the port in Settings, restart the backend, confirm Launch.bat opens the new port.
- [ ] Library: rename, bulk delete, cleanup preview, Show in folder.

## Added in 2.2.0 (Windows, real device; mark anything untested)
- [ ] Phone > Apps lists installed apps; "System" and "All" work; a locked or unauthorized phone shows a readable error.
- [ ] Phone > Running shows the app in front, recent order and memory; Stop closes an app; Include system adds system apps.
- [ ] Console keys: Shade, Quick, Screen and Mute highlight and match the phone; Screen reflects the real screen state after a few seconds.

## Added in 2.3.0 (Windows, real device; the fake-adb tests do NOT cover these)
- [ ] Mirror, then Record: no second window; both timers run; stop Record leaves the mirror open; stop Mirror leaves the recording running; the saved file plays.
- [ ] Stopping a hidden (companion) recording: file is finalised and playable (headless Ctrl+C path is untested on Windows). Check Logs/ for the scrcpy output.
- [ ] Two scrcpy encoders on one phone: confirm your phone allows it. If the recorder fails right away, set Record while mirroring to "Close the mirror first".
- [ ] Companion audio on Android 11/12 (audio capture may conflict); turn off Companion audio if it does.
- [ ] Rotation: open a landscape game, rotate. Card should move to the top within ~1 s; back to portrait the same way. Check `dumpsys input` gives SurfaceOrientation on your Android version.
- [ ] Preview of apps that block screenshots (banking, DRM) shows black: expected, not a fault.
- [ ] exec-out screenshot is a valid PNG on Windows (binary-safe path); Update gives a sharp picture.
- [ ] Tap, swipe and long-press on the picture land where expected, in portrait and landscape.
- [ ] Battery %, charging source and temperature match the phone; low-battery alert fires once.
- [ ] Drop an APK and a normal file on the phone picture.

## Added in 2.3.1 (real device)
- [ ] Media card shows the right title/artist for Spotify, YouTube Music and a video app (dumpsys media_session format differs by Android version). Album art is not available over adb.
- [ ] Apps list shows apps on Installed, System and All. If it is empty, the message says what the phone returned.
- [ ] Unplug and replug the cable: the picture keeps the last frame for a few seconds, then shows "No phone connected".
- [ ] Pop-out view in landscape game and portrait; Esc closes it.

## Added in 2.4.0 (real device, Chrome/Edge)
- [ ] Rotate a landscape game: the card turns and morphs; rotating the other way (rotation 3) puts the camera hole on the right.
- [ ] Charging ring animates only while charging; low battery turns it red.
- [ ] Pop-out in and out is smooth. Browsers without View Transitions switch instantly (no error).
- [ ] The coloured arrow cursor appears over the phone picture.

## Added in 2.5.0 (real device)
- [ ] Media card: elapsed time follows the song. Total length only appears if the app reports it to Android (many do not, then the bar shows "live").
- [ ] Charging ring runs smoothly for several minutes without restarting its animation.

## Added in 3.0.0 (real device, Windows)
- [ ] Monitor: CPU, memory, network and top apps look right on the TECNO (toybox top format varies).
- [ ] Alerts: notification titles and text match the phone; Copy code works; Windows desktop alert appears when enabled.
- [ ] Demo mode on and off restores the real status bar (SystemUI demo broadcasts; some phones ignore them).
- [ ] Game mode applies and restores settings when the game opens and closes.
- [ ] Phone gallery thumbnails appear (needs System.Drawing on Windows); Pull and Delete work.
- [ ] Backups copy a folder, skip files already copied, Cancel stops it.
- [ ] Macros: record, replay on the phone, schedule a daily one; schedule survives backend restart.
- [ ] Inspect overlay boxes line up with the screen; Launch intents open the right screen.
- [ ] Insights: screen time and battery per app roughly match Android settings.
- [ ] ffmpeg trim, shrink and GIF work with ffmpeg in core\ffmpeg.
- [ ] Auto reconnect: switch a phone to Wi-Fi, unplug, it comes back by itself.
- [ ] Mobile layout (narrow window): bottom bar, More sheet, Library rows.

## Added in 3.1.0 (real PC, Windows)
- [ ] Start the toolkit, add a macro, close and reopen: it is still there. Open Config\store.json.bak after the second save.
- [ ] Damage Config\store.json on purpose (add junk text), restart, try saving a pin: you get a clear message and the file is not replaced; the data from store.json.bak still shows.
- [ ] Record a macro with a 20 second Wait, press Stop in Background jobs: it stops within about a second.
- [ ] Schedule a daily task for 2 minutes ahead with the phone unplugged, plug it in within 10 minutes: it runs once.
- [ ] Press Enter in Add a snippet, Name this macro and a Confirm dialog: each one saves/confirms.
- [ ] Unplug the phone in use while a second phone is connected: Monitor, Phone tools and the gallery switch to the other phone.
- [ ] Gallery thumbnails still show; a file in Config\..\Logs\thumbs has a 32 character name.

## Added in 3.2.0 (real PC, Windows, real phone)
- [ ] Monitor > Usage: open it five times in a row; no "being used by another process" error. Screen time and battery use list apps, or say plainly that the phone does not share them.
- [ ] Monitor > Live: click each card; the big graph opens. Wait a few minutes, switch between 5 min and 24 hours, reload the page: history is still there.
- [ ] Over the big graph: red dotted guide lines follow the mouse and the values on the axes match the tooltip. Esc closes.
- [ ] Alerts: with an app that has more than two notifications, "Show N earlier" opens and closes the older ones.
- [ ] Console: the phone preview starts near the top of its card, beside the details; the tap cursor looks small.
- [ ] Battery ring: no white flashing while charging; at 15% or less it is red; at 100% it is green; bubbles rise inside the fill only.

## Added in 3.3.0 (real PC, Windows, real phone)
- [ ] Copy 3.3 over an older folder and only refresh the browser: a banner offers "Restart service now" (or the service restarts by itself) and the banner disappears afterwards. Rail shows v3.3.
- [ ] Monitor > Usage: open it ten times quickly; no "being used by another process" error; Screen time lists apps for today.
- [ ] Alerts: a chat with several unread messages shows "Show N earlier messages"; opening it lists them with sender and time.
- [ ] A notification the phone gives no text for shows the grey explanation line.

## 3.4 rebrand
- [ ] Browser tab, sidebar logo and favicon show DROID ADB.
- [ ] Mirror window title says DROID ADB (or your own title if you set one) and shows the DROID ADB icon. If the icon is still scrcpy's, that is cosmetic only.
- [ ] While recording, the tab title shows the red REC marker followed by DROID ADB.
- [ ] Settings > About shows the logo, version v3.4.0 and the credits.
- [ ] Export gives `droid-adb-backup.json`; importing it works. Importing an older `scrcpy-toolkit-backup.json` also works.
- [ ] Banner does not claim the service is outdated after Launch.bat (page and service both 3.4.0).
- [ ] Launch.bat window title reads DROID ADB Launcher.

## 3.5 branding polish
- [ ] Browser tab shows the new favicon (blue panes and green robot). Hard-refresh (Ctrl+F5) if the old one is cached.
- [ ] Mirror window title bar and taskbar show the DROID ADB icon, not scrcpy's. Start a mirror and look.
- [ ] Unplug the phone while mirroring: the window shows the grey DROID ADB "disconnected" picture.
- [ ] Double-click Create-Desktop-Shortcut.bat: a "DROID ADB" shortcut with the logo appears on the Desktop and starts the app.
- [ ] Chrome or Edge offers "Install DROID ADB"; the installed app opens the dashboard with the DROID ADB icon.
- [ ] Delete `core/branding/`: mirroring still works (scrcpy falls back to its own icon).
- [ ] Banner does not claim the service is outdated after Launch.bat (page and service both 3.5.0).

## 3.6 reliability and Studio gaming kit
- [ ] Run an older service, open the 3.6 page: the "still the old version" banner appears. One click on Restart service now: the button shows Restarting..., a "service is back" notice appears, and the banner is gone. Repeat clicks during the restart do nothing harmful.
- [ ] Devices, Restart backend: confirm, then the dashboard reconnects without further clicks. Start a slow action (for example a large file pull) first and restart during it: the service still returns within about 10 seconds.
- [ ] Remote controls, Camera: the phone wakes and the camera app opens. Try on a phone with a locked screen and on one with no camera app (a clear message appears).
- [ ] Trigger an error (unplug the phone, then press a key): a short sentence appears, with a Details button. Settings, Error log lists the original text. Copy all and Clear work.
- [ ] Settings, Error log, Backend log and Log files tabs load, a session file opens, and Clear on the backend log asks first.
- [ ] Settings at 1500, 1300 and 900 px wide: Command preview is above Backup every time, never beside it. About is centered.
- [ ] Studio, Gaming kit: HUD shows battery, temperature, app in front. Each switch toggles on the phone and the label updates. Free memory, Performance mode on/off, Game Mode and frame stats give a result or a clear "not supported" message.
- [ ] Game mode: add a game with Free memory and Game Mode ticked, open it on the phone, confirm they run, leave the game and confirm settings return and play time is added.
- [ ] Banner does not claim the service is outdated after Launch.bat (page and service both 3.6.0).

## 4.0 Performance Studio
- [ ] Studio opens on Overview with health score and live graphs; all six tabs load without errors.
- [ ] Optimize, Compatibility check on an Android 13 phone lists Game Mode as supported; setting performance mode shows success or the phone's real reply (never "needs Android 12").
- [ ] Apply Gaming profile, then Restore my settings: refresh rate, animations, brightness and switches return to the earlier values.
- [ ] Games: launching a saved game applies its profile; leaving restores it and adds a session row.
- [ ] Thermals: gauge, history and cool-down tracker update; threshold sliders persist.
- [ ] Network test shows ping, jitter, loss and a verdict.
- [ ] Banner does not claim the service is outdated after Launch.bat (page and service both 4.0.0).

## 4.1 Audio modes (real device)
Full steps are in docs/AUDIO.md.
- [ ] Settings, Audio shows four cards; Video only is selected on a fresh settings file; the choice survives restarting the service.
- [ ] Video only: mirror and recording behave as in 4.0; the recording has no sound track.
- [ ] Copy to recording: phone plays, PC silent, Library, More, Check sound reports a sound track (and audible if ffmpeg is present).
- [ ] Copy and play on PC: phone and PC both play; the recording has exactly one sound track.
- [ ] Reroute: phone silent, PC plays; recording result is what Check sound reports.
- [ ] Unplug during a session, replug, start again: the selected mode is applied; the status shows the mode that is really active.
- [ ] Android 12 or older phone (if available): a Copy mode shows a warning and starts as Video only, or refuses the recording.
- [ ] Streaming audio plans show the correct status for each mode; starting or stopping OBS does not stop the mirror or a recording.
- [ ] Banner does not claim the service is outdated after Launch.bat (page and service both 4.3.0).


## 4.2 Studio Plus and recording fix (real device)
- [ ] Settings, Audio: choose Copy to recording, press Record. It starts without "Scrcpy did not list its audio options". Repeat on a PC with antivirus active, right after unzipping.
- [ ] Record while the audio mode is Reroute and a mirror window is open (companion). The recording starts and the file has a sound track (Library, More, Check sound).
- [ ] Phone older than Android 13 with a Copy mode: recording is refused with the Android version in the message and the message is fully readable (not "Something did not work as expected").
- [ ] Studio, Overview: every live card opens a graph; after 10 minutes the 5 min and 15 min graphs show a line, after a day the 24 hours graph is filled.
- [ ] Processor cores: each core shows a load percentage that changes while the phone is used; sleeping cores show "asleep"; clicking a core shows that core in the graph.
- [ ] Thermals: Start cool-down shows the five steps, the ring fills as the temperature falls, the finish state appears with the celebration, Undo restores brightness, refresh rate, battery saver and Do Not Disturb.
- [ ] Apply a profile, reload the page: Undo (Restore) is still offered and works.
- [ ] Battery page: power and current have plausible values while charging and while using the phone; capacity against new is shown only if the phone reports it.
- [ ] Watchdog: with the warning limit lowered below the current temperature a toast appears once, not every few seconds.
- [ ] Install app: the button appears in Edge or Chrome, installing opens the dashboard in its own window.
- [ ] With "Reduce motion" on in Windows the page has no animations.

## 4.2.1 Reroute (real phone)
- [ ] Settings, Audio: choose Reroute audio to PC, open the mirror. Phone sound plays on the PC and the phone itself is quiet.
- [ ] Press Record in Reroute with no mirror open. The recording starts and the file has sound (Library, More, Check sound).
- [ ] Console, command preview in Reroute shows no --audio-source and no --no-audio flag.
- [ ] Copy to recording and Copy and play on PC still show their reason (Android 13 needed) instead of failing silently.

## 4.3.0 smooth preview, recording quality, steadier sound (real phone)
- [ ] Library: play a recording of 5 minutes or more in the preview. It plays without stalls; seeking does not freeze it; Studio and the dashboard still update (slowly) in the background.
- [ ] While the preview plays, open the Console page in another tab. The dashboard stays responsive.
- [ ] Settings, Recording: High quality for recordings is on. A new recording is the phone's full size at 60 fps. Check the file with Properties or a media player.
- [ ] A 1-minute recording at 40 Mbps is about 300 MB. If the phone cannot do it, scrcpy exits with an encoder error: lower Recording bitrate or frame rate.
- [ ] Reroute mirror for 10 minutes: no crackle. If there is crackle, raise Audio buffer to 150 or 200.
- [ ] Mirror quality did not change (Settings, Video).

## 4.4.0 (real phone)
- [ ] Tools, Apps and Running: Open, Stop and the three-dot button work when clicked at the very edge of the button.
- [ ] Reload on Studio, Library and Settings: the loader shows, then your page. The Console page never flashes.
- [ ] A new recording is named DroidADB_YYYY-MM-DD_HH-MM-SS_appname.mkv (app part lowercase). With the home screen in front there is no app part.
- [ ] Library opens on Recordings. Phone asks Photos or Videos first; Back returns.
- [ ] Studio: Boost shows the rocket and the freed memory. Apply Gaming: the panel ticks steps off and shows Undo.
- [ ] Studio, Apps: Stop on one app works; a starred app cannot be stopped by Stop all others.
- [ ] Games: add a game, open Details, switch on Game Priority, press Play. Background apps are stopped, the game opens, and apps that wake up are stopped again while you play. After you leave, the guard stops.
- [ ] Unplug and replug the phone: a Phone connected message shows on any page.

## 4.5.0 saved apps (real phone)
- [ ] Tools, Apps, three-dot menu, Save app to this PC on an app with split APKs (for example TikTok or YouTube): one .apks file appears in Downloads/AppBackups. On a simple app one .apk appears.
- [ ] Library, Backups, Saved apps: press Install on phone for that file. The app installs and keeps its data.
- [ ] Tools, Apps, Install app: choose the .apks file. It installs. Choose a base .apk plus its split_config .apk files together: they install as one set.
- [ ] Install an .xapk from the web. It installs; an .obb note appears if the game has data files.

## 4.7.0 window shape (real PC)
- [ ] Console, Window shape: Tablet 1600x1200. Press Mirror. The window opens 4:3 (or the biggest 4:3 that fits your screen) with the phone screen inside and dark bars at the sides. Touch and clicking still work.
- [ ] With the mirror open, click PC, then Phone, then Tablet. The open window changes shape each time, with no restart and no wait.
- [ ] Press Record with Tablet chosen. The record window has the same shape; the saved file is the normal phone shape.
- [ ] OBS: add a Window Capture of the mirror window. The source is tablet shaped.
- [ ] The phone screen is never resized. If an older version left it resized, it is put back by itself.

## 4.7.1 (real phone)
- [ ] Open PUBG Mobile with the dashboard connected and Studio open. The game does not crash. Watch for 2 minutes.
- [ ] Add PUBG to the Games library. Open it from the phone: nothing is changed on the phone for about 40 seconds, then its profile is applied. The game does not crash.
- [ ] Game Priority is off by default in a game's Details. Switch it on, press Play: other apps are stopped, the game opens.
- [ ] Reroute mirror: sound delay feels like before (no extra delay).
- [ ] Window shape: Tablet, press Mirror. The window takes the shape within a few seconds. If not, press Apply to the open window and tell me what it says.
