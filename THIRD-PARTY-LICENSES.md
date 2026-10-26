# Third-party licences

DROID ADB ships these programs unmodified in `core/scrcpy/`. Each keeps its own licence. This list was written from the files in the package; please confirm against the sources before a public release.

| Component | Files | Licence | Source |
|---|---|---|---|
| scrcpy 5.0.1 | scrcpy.exe, scrcpy-server, scrcpy.png, disconnected.png, scrcpy-noconsole.vbs, open_a_terminal_here.bat | Apache License 2.0 (text in `LICENSE.txt`) | https://github.com/Genymobile/scrcpy |
| Android Debug Bridge (adb) | adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll | Apache License 2.0, from Android SDK Platform-Tools (Google). Platform-Tools are also offered under the Android SDK terms. | https://developer.android.com/tools/releases/platform-tools |
| FFmpeg libraries | avcodec-63.dll, avformat-63.dll, avutil-61.dll, swresample-7.dll | LGPL version 2.1 or later (the DLLs report this themselves) | https://ffmpeg.org |
| SDL 3 | SDL3.dll | zlib licence | https://libsdl.org |
| libusb 1.0 | libusb-1.0.dll | LGPL version 2.1 or later | https://libusb.info |

## What the LGPL parts mean for you

FFmpeg and libusb are used as separate DLL files, so you can replace them with your own builds of the same version. Keep them as separate files, do not merge them into another program, and keep this notice. You may request or download their source from the project sites above. These DLLs came with the scrcpy release. If you swap in a different FFmpeg build that was compiled with GPL options, different terms apply.

## Licence texts

- Apache License 2.0: `LICENSE.txt` (also at https://www.apache.org/licenses/LICENSE-2.0)
- LGPL 2.1: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
- zlib licence: https://www.zlib.net/zlib_license.html
