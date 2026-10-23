# Scrcpy Toolkit

A portable Windows dashboard for scrcpy, recording management, and Android Debug Bridge diagnostics.

This is a helper project around scrcpy v5.0.1. The original upstream binaries are unmodified. See LICENSE.txt for the upstream license.

## Start
1. Download the repository ZIP and extract it fully.
2. Double-click Launch.bat.
3. The launcher starts the local backend, checks its health, and opens index.html automatically.
4. Keep the local backend running while using the dashboard.

No Node.js, Python, cloud account, or paid API is required. The backend uses Windows PowerShell and .NET components included with Windows.

## Features
- Redesigned responsive dashboard with live device, storage, and session metrics.
- One-click phone mirroring and screen recording.
- Automatic settings persistence for size, FPS, bitrate, and audio.
- Automatic MP4 output in `Recordings/` whenever a recording is deliberately started.
- Live session monitor for toolkit mirroring and recording processes.
- Recording library with file size, modified time, open-video, and reveal-in-folder actions.
- ADB device diagnostics and practical connection troubleshooting.
- Age-based cleanup with preview and explicit confirmation.
- Graceful window-close requests to help scrcpy finalize recordings instead of force-killing it.
- API bound to `127.0.0.1` only; no cloud account or paid API required.

## Layout
- index.html and assets/ are the dashboard.
- Launch.bat starts the backend.
- core/server/ contains the local PowerShell API.
- core/scripts/ contains standalone Mirror and Record launchers.
- Config/ contains settings.
- Recordings/ and Logs/ are local data folders.

## Runtime files
The original scrcpy executables, server, and DLLs are kept together in core/scrcpy/. They have not been modified. Keep this folder in place because scrcpy loads its supporting files from beside the executable.

## Safety and license
The backend binds only to localhost and does not expose remote network access. Use this toolkit only from a folder you trust. scrcpy is distributed under Apache License 2.0; see LICENSE.txt.