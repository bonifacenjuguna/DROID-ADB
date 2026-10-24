# Manual Regression Checklist

Use this checklist after dashboard, backend, launcher, or recording-related changes. Run it on Windows with a test Android device when available. Do not treat a syntax check as a replacement for these runtime checks.

## Launch and backend
- [ ] Extract the complete project folder and start it with `Launch.bat`.
- [ ] Confirm the dashboard opens and the local backend reports as connected.
- [ ] Confirm a missing backend or dashboard file produces a useful error instead of silently failing.
- [ ] Refresh the dashboard and confirm the status and device information reload.

## Console live preview
- [ ] With an authorized phone connected, select Update and confirm its screen appears inside the phone frame, clipped to the rounded display.
- [ ] Confirm the image does not cover the bezel/notch or the device details and controls.
- [ ] Enable live preview, confirm it refreshes at the configured interval, then disable it and confirm polling stops.
- [ ] Disconnect the phone or trigger a preview error and confirm the last good image remains visible with a readable status message.
- [ ] Switch between USB and Wi-Fi devices and confirm the preview follows the selected phone.

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
