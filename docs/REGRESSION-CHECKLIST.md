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

## Added in 3.2.0 (real PC and phone, Windows)
- [ ] Monitor > Usage: Screen time today lists apps with times and no "being used by another process" error. Press Reload a few times.
- [ ] Usage: Battery use by app shows mAh after the phone has been unplugged for a while; while it sits at 100% on the charger it shows the explanation and a labelled estimate.
- [ ] Monitor > Live: click each card. The big graph opens, range buttons work, moving over it shows red dotted guides with tags, Esc closes it.
- [ ] Leave the dashboard on Console for 5 minutes, then open a big graph with 10 min: there are points from the time you were away.
- [ ] Notifications: a chat app with several messages from one person shows one row, an "N earlier" button and an "N new" badge.
- [ ] Console: the phone preview is at the top, details below. The pointer over the preview is small.
- [ ] Battery ring: no white flashing while charging; colour is green when high and red when low (unplug the phone below 20%).
