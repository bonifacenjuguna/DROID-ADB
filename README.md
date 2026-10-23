# Scrcpy Toolkit

A portable Windows control center for scrcpy: mirror, record, screenshot, remote-control and manage your Android phone.

This is a helper project around scrcpy v5.0.1. The original upstream binaries are unmodified. See LICENSE.txt for the upstream license.

## Start
1. Download the repository ZIP and extract it fully.
2. Double-click Launch.bat.
3. The launcher starts the local backend, checks its health, and opens the dashboard at http://127.0.0.1:47821/.
4. Keep the local backend running while using the dashboard.

No Node.js, Python, cloud account, or paid API is required. The backend uses Windows PowerShell and .NET components included with Windows.

## Features
- Console with a live device stage: model, Android version, battery, screen size and storage.
- One-click mirror, recording (MKV), and phone screenshots.
- Remote controls (Back, Home, Recents, volume, power, notifications) and a text sender.
- Wi-Fi pairing, multi-device picker, and ADB restart.
- Live session timers, activity feed, and readable errors when scrcpy closes early.
- Library for recordings and screenshots with filter, sort, delete, and age-based cleanup.
- Presets, codec and audio options, and a live command preview.
- Command palette (Ctrl+K), keyboard shortcuts, light and dark themes.
- Inline SVG icons only. Nothing is loaded from the internet, and the API listens on 127.0.0.1 only.

## Layout
- index.html and assets/ are the dashboard.
- Launch.bat starts the backend.
- core/server/ contains the local PowerShell API.
- core/scripts/ contains standalone Mirror and Record launchers.
- core/server/lib.ps1 holds shared settings and launch logic.
- Config/ contains settings.
- Recordings/, Screenshots/ and Logs/ are local data folders.

## Runtime files
The original scrcpy executables, server, and DLLs are kept together in core/scrcpy/. They have not been modified. Keep this folder in place because scrcpy loads its supporting files from beside the executable.

## Safety and license
The backend binds only to localhost and does not expose remote network access. Use this toolkit only from a folder you trust. scrcpy is distributed under Apache License 2.0; see LICENSE.txt.