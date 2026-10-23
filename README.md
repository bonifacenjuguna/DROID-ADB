# Scrcpy Toolkit

A portable Windows dashboard for scrcpy, recording management, and Android Debug Bridge diagnostics.

This is a helper project around scrcpy v5.0.1. The original upstream binaries are unmodified. See LICENSE.txt for the upstream license.

## Start
1. Download the repository ZIP and extract it fully.
2. Double-click Launch.bat and wait for the backend-ready message.
3. Double-click index.html.
4. Keep the local backend running while using the dashboard.

No Node.js, Python, cloud account, or paid API is required. The backend uses Windows PowerShell and .NET components included with Windows.

## V1 features
- Mirror and record phone screen.
- Shared settings for size, FPS, bitrate, and audio.
- ADB device diagnostics.
- Recording library and folder shortcut.
- Age-based cleanup with preview and confirmation.
- API bound to 127.0.0.1 only.

## Layout
- index.html and assets/ are the dashboard.
- Launch.bat starts the backend.
- core/server/ contains the local PowerShell API.
- core/scripts/ contains standalone Mirror and Record launchers.
- Config/ contains settings.
- Recordings/ and Logs/ are local data folders.

## V1 packaging note
For V1, keep the original scrcpy executables and DLLs in the repository root beside Launch.bat. They have not been changed. Moving binaries into core/scrcpy is a follow-up packaging task; do not move them manually yet.

## Safety and license
The backend binds only to localhost and does not expose remote network access. Use this toolkit only from a folder you trust. scrcpy is distributed under Apache License 2.0; see LICENSE.txt.