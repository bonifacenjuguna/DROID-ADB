DROID ADB mirror-window icons
-----------------------------
scrcpy looks for two image files in the folder named by SCRCPY_ICON_DIR, and DROID ADB points that variable at this folder when it starts a mirror or recording.

scrcpy.png        The window icon. The file name is the one scrcpy expects; the picture is the DROID ADB icon.
disconnected.png  Shown in the window if the phone disconnects (DROID ADB version).
droid-adb.ico     Icon used by the desktop shortcut (Create-Desktop-Shortcut.bat).

The original scrcpy files in core/scrcpy/ are not changed. Delete this folder to get scrcpy's own icons back.
