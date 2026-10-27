# Audio modes, recording and OBS (DROID ADB 4.1)

Tested options come from the bundled scrcpy 5.0.1 help. Nothing here has been run on a phone by the developer of this release; the real-device tests below are yours to run.

## The four modes (Settings, Audio)

| Mode | Phone | PC | Recording | scrcpy options |
|---|---|---|---|---|
| Video only (default) | plays | silent | video only | `--no-audio` |
| Copy to recording | plays | silent | video + sound | `--audio-source=playback --audio-dup --no-audio-playback` (recorder only) |
| Copy and play on PC | plays | plays | video + sound | `--audio-source=playback --audio-dup` |
| Reroute audio to PC | silent | plays | checked after each recording | `--audio-source=output` (scrcpy default) |

Rules the controller follows:
- A mirror-only window in Copy to recording has no sound capture at all (nothing to record). The recorder, including the hidden companion recorder, captures the sound.
- In Copy and play with a mirror open, the mirror captures for playback and the companion recorder captures for the file. Each sound goes to one place, so the recording holds it once. Two captures at once is the main thing to verify on your phone.
- Copy modes need Android 13 (scrcpy's playback capture). Reroute needs Android 11. If the phone or scrcpy cannot do it, the session starts as video only and says so. A recording is refused when "Stop a recording if its sound cannot be captured" is on.
- Recordings add `--require-audio` (when scrcpy has it) so a failed capture stops the recording instead of saving a silent file.
- Copy modes only capture what apps allow. scrcpy's own help says apps can opt out. A game that opts out records silence; use Check sound.
- Windowless background recording has no window, so Copy and play cannot play on the PC. The panel shows it as active in the Copy to recording form.
- Reroute plus a companion recorder captures the same rerouted sound twice, which silences the mirror on some phones. Turn off "Sound in companion recordings" if that happens; that recording then has no sound, and the panel says so.

## Checking a recording
Library, More, Check sound. Without ffmpeg it reads the file: no sound track, almost-empty track (likely silence), or track with data. That proves a track exists, not that it is loud. With ffmpeg (core\ffmpeg\ffmpeg.exe, optional) it also measures the peak: above -60 dB is audible. After a recording ends the dashboard runs the file check automatically. An MP4 that was not closed cleanly cannot be read; MKV survives forced stops.

## Streaming with OBS (TikTok LIVE)
DROID ADB cannot control OBS. What OBS hears depends on what the mirror window plays on the PC, so it follows the audio mode but is chosen separately (Settings, Audio, Streaming audio).

- **No game sound**: OBS Window Capture on the mirror window; no audio source for the game. If the mode plays sound on the PC (Copy and play, Reroute), mute OBS Desktop Audio.
- **Listen on the PC**: needs Copy and play or Reroute. Add one source in OBS: Application Audio Capture (BETA, OBS 28+, Windows 10 2004+) set to the scrcpy window, or Desktop Audio. Not both.
- **PC speakers silent, OBS hears it**: needs Copy and play or Reroute so scrcpy plays something. Then, in Windows Volume mixer, send scrcpy.exe to an output you are not listening to (a virtual cable you already have, or unused headphones) and capture that output in OBS with Audio Output Capture. Muting scrcpy in the mixer may silence the capture too. Verify on the OBS meter before going live.
- Copy to recording keeps the PC silent, so OBS cannot hear the game from the mirror. Use Copy and play for sound in both the file and the stream.
- No driver or paid tool is required. A virtual audio cable is only needed for the silent-speakers route, and only if you want it.
- The stream choice never changes the phone, the mirror or a recording, and OBS starting or stopping does not touch DROID ADB sessions.

## Real-device test matrix (TECNO KJ5, Android 13)
For each mode: select it, then run these. Record pass or fail.
1. Mirror only: phone audio on phone? PC audio? Window smooth? Status shows the mode as active only while running.
2. Record 60 s of PUBG Mobile with sound (a lobby with music is fine). Stop. File is in Recordings and plays.
3. Check sound on the file: expect no sound track (Video only), audible (Copy modes, with ffmpeg), result reported honestly (Reroute).
4. Record while the mirror is open (companion). Same file checks. Does the mirror keep its sound?
5. Switch modes with a mirror open: the panel says the old mode is still active; Restart mirror applies the new one.
6. Unplug the cable mid-session, replug, start again: selected mode applied, status accurate.
7. Stop all: no scrcpy.exe left in Task Manager; Logs/sessions.json empty.
8. OBS: for each stream plan, play the game and watch the OBS meter; confirm with the plan text. Starting and stopping the OBS stream must not close the mirror or a recording.
9. Fresh settings (delete Config\settings.json): default is Video only.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File core\scripts\audio-selftest.ps1` first. It checks the option mapping without a phone.
