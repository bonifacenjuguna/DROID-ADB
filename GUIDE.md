# Quick Guide

## First run
1. Extract the complete ZIP to a writable folder.
2. Run Launch.bat.
3. When the backend-ready message appears, open index.html.
4. If the dashboard says backend offline, run Launch.bat again and refresh.

## Connect Android
- Enable Developer options and USB debugging.
- Connect using a USB data cable.
- Unlock the phone and accept the USB debugging authorization prompt.
- Open Device check in the dashboard.

## Mirror and record
Mirror phone opens an interactive scrcpy window. Start recording saves an MP4 in Recordings. Close the scrcpy window normally to finish the video. Stop scrcpy force-closes scrcpy processes launched from this toolkit folder.

Audio depends on Android support and app restrictions.

## Settings and cleanup
Save preferences in Settings; they are stored in Config/settings.json. Cleanup shows files matching the chosen age before asking for confirmation. Deleted files cannot be restored.

## Troubleshooting
- Backend offline: run Launch.bat.
- No device: check cable, USB debugging, phone unlock, and authorization.
- Port busy: close another instance or change port 47821 in core/server/server.ps1 and assets/app.js.
- Missing scrcpy: re-extract the full ZIP and make sure core/scrcpy/ remains intact.

Keep the full folder together. Settings and recordings stay in that extracted copy. A fresh ZIP download is a clean snapshot, so back up recordings before replacing the folder.