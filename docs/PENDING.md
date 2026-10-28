# Pending

Things we agreed to come back to. Nothing here is lost; none of it is switched on yet.

## Copy modes (Copy to recording, Copy and play on PC)
- On the test phone both fail with "[server] ERROR: Could not capture audio playback". It fails for every app (TikTok, music, games), so the phone itself blocks Android's playback capture. scrcpy has no way around that.
- Idea 1: when a Copy mode is chosen and the phone refuses, record with Reroute's capture instead of failing, and say once: "This phone cannot copy sound while it plays, so the sound was rerouted into the recording and the phone stayed quiet." Remember it for that phone.
- Idea 2: show a plain message for that error ("This phone does not allow copying its sound") with a Switch to Reroute button.
- Both modes stay in the list.

## Recording
- A smoothness check for finished recordings (gaps in audio and video timing) in case lag is ever seen in the file itself.
- Recording and mirroring in one scrcpy instead of a hidden second recorder, to save the phone one video encoder.
- A smooth MP4 copy for the preview. Needs ffmpeg, which is not bundled.

## Backup (needs a decision)
- Waiting for an answer: should one backup be a single file (one zip) instead of copying many loose files and folders, and what exactly "installing app" should do with it (restore the apps from the backup, or the Install app button at the top).
