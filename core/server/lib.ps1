# DROID ADB shared library.
# Dot-sourced by server.ps1 (main thread and every worker runspace) and by core/scripts/launch.ps1.
# Keep this file ASCII only and compatible with Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Stop'
$ToolkitVersion = '4.7.0'
if (-not $global:StkRoot) { $global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$Root = $global:StkRoot
$OnWindows = ($env:OS -eq 'Windows_NT')
$ConfigDir = Join-Path $Root 'Config'
$LogDir = Join-Path $Root 'Logs'
$ConfigFile = Join-Path $ConfigDir 'settings.json'
$ProfilesFile = Join-Path $ConfigDir 'profiles.json'
$SessionsFile = Join-Path $LogDir 'sessions.json'
$StoreFile = Join-Path $ConfigDir 'store.json'
$BundledDir = Join-Path (Join-Path $Root 'core') 'scrcpy'
New-Item -ItemType Directory -Force -Path $ConfigDir, $LogDir | Out-Null
if (-not (Test-Path variable:Shared)) { $Shared = [hashtable]::Synchronized(@{}) }

function Fail {
    param([string]$Message)
    throw (New-Object System.InvalidOperationException $Message)
}

function Get-Prop {
    param($Object, [string]$Name, $Fallback)
    if ($null -eq $Object) { return $Fallback }
    if ($Object -is [hashtable]) { if ($Object.ContainsKey($Name) -and $null -ne $Object[$Name]) { return $Object[$Name] } else { return $Fallback } }
    $p = $Object.PSObject.Properties[$Name]
    if ($p -and $null -ne $p.Value) { return $p.Value }
    return $Fallback
}

function Get-UtcNow { return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function ConvertFrom-UtcString {
    param([string]$Text)
    try { return [datetime]::Parse($Text, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() } catch { return (Get-Date).ToUniversalTime() }
}

function Use-Lock {
    param([scriptblock]$Body)
    $lockObj = $Shared.SyncRoot
    [Threading.Monitor]::Enter($lockObj)
    try { & $Body } finally { [Threading.Monitor]::Exit($lockObj) }
}

function Write-TextAtomic {
    param([string]$Path, [string]$Text)
    $tmp = $Path + '.tmp'
    [IO.File]::WriteAllText($tmp, $Text, (New-Object Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $Path) { Move-Item -LiteralPath $tmp -Destination $Path -Force } else { Move-Item -LiteralPath $tmp -Destination $Path }
}

function ConvertTo-Hash {
    param($Obj)
    if ($null -eq $Obj) { return $null }
    if ($Obj -is [hashtable]) { return $Obj }
    if ($Obj -is [System.Management.Automation.PSCustomObject]) {
        $h = @{}
        foreach ($p in $Obj.PSObject.Properties) { $h[$p.Name] = ConvertTo-Hash $p.Value }
        return $h
    }
    if ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        $list = @()
        foreach ($i in $Obj) { $list += , (ConvertTo-Hash $i) }
        return , $list
    }
    return $Obj
}

# Parses a JSON array (or single object) into a flat list of hashtables. Works in both PowerShell versions.
function Get-JsonList {
    param([string]$Path)
    $list = @()
    try {
        $raw = [IO.File]::ReadAllText($Path)
        if ([string]::IsNullOrWhiteSpace($raw)) { return $list }
        $parsed = $raw | ConvertFrom-Json
        foreach ($x in @($parsed)) {
            if ($null -eq $x) { continue }
            if ($x -is [array]) { foreach ($y in $x) { if ($null -ne $y) { $list += , (ConvertTo-Hash $y) } } } else { $list += , (ConvertTo-Hash $x) }
        }
    } catch {}
    return $list
}

# ---------------------------------------------------------------------------
# Activity feed and events (shared across worker runspaces)
# ---------------------------------------------------------------------------
if (-not $Shared.activity) { $Shared.activity = New-Object System.Collections.ArrayList }
if (-not $Shared.events) { $Shared.events = New-Object System.Collections.ArrayList }
if (-not $Shared.info) { $Shared.info = [hashtable]::Synchronized(@{}) }
if ($null -eq $Shared.eventSeq) { $Shared.eventSeq = 0 }

function Add-Activity {
    param([string]$Kind, [string]$Text)
    $entry = @{ t = (Get-UtcNow); kind = $Kind; text = $Text }
    Use-Lock {
        [void]$Shared.activity.Insert(0, $entry)
        while ($Shared.activity.Count -gt 80) { $Shared.activity.RemoveAt($Shared.activity.Count - 1) }
    }
    try { Add-Content -LiteralPath (Join-Path $LogDir 'activity.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Kind + '  ' + $Text) } catch {}
}

function Add-Event {
    param([string]$Kind, [hashtable]$Data)
    Use-Lock {
        $Shared.eventSeq = [int]$Shared.eventSeq + 1
        $Data.id = $Shared.eventSeq
        $Data.kind = $Kind
        $Data.t = (Get-UtcNow)
        [void]$Shared.events.Add($Data)
        while ($Shared.events.Count -gt 40) { $Shared.events.RemoveAt(0) }
    }
}

function Write-BackendLog {
    param([string]$Text)
    try { Add-Content -LiteralPath (Join-Path $LogDir 'backend-error.log') -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Text) } catch {}
}

# ---------------------------------------------------------------------------
# Settings schema. This is the single source of truth: the dashboard renders its
# settings page from this list, and the backend validates saves against it.
# ---------------------------------------------------------------------------
function C { param($v, $l) return @{ v = $v; l = $l } }
function F {
    param([string]$Key, [string]$Group, [string]$Type, $Default, [string]$Label, [string]$Help = '', $Min = $null, $Max = $null, $Choices = $null, $Picks = $null, [string]$Unit = '', $Show = $null, [string]$Pattern = '', [bool]$Restart = $false, [string]$Placeholder = '', [bool]$Hidden = $false)
    return @{ key = $Key; group = $Group; type = $Type; default = $Default; label = $Label; help = $Help; min = $Min; max = $Max; choices = $Choices; picks = $Picks; unit = $Unit; show = $Show; pattern = $Pattern; restart = $Restart; placeholder = $Placeholder; hidden = $Hidden }
}

$SettingGroups = @(
    @{ id = 'video'; title = 'Video'; note = 'What scrcpy captures from the phone.' },
    @{ id = 'audio'; title = 'Audio'; note = 'Phone sound, recordings and streaming. Needs Android 11 or newer; the Copy modes need Android 13.' },
    @{ id = 'control'; title = 'Input and phone'; note = 'How the PC controls the phone while a window is open.' },
    @{ id = 'window'; title = 'Mirror window'; note = 'Look and behaviour of the scrcpy window.' },
    @{ id = 'recording'; title = 'Recording and screenshots'; note = 'File naming, format and limits.' },
    @{ id = 'files'; title = 'Folders and storage'; note = 'Leave a folder empty to use the default inside the toolkit.' },
    @{ id = 'toolkit'; title = 'Dashboard and backend'; note = 'Items marked restart apply the next time you run Launch.bat.' },
    @{ id = 'advanced'; title = 'Advanced'; note = 'Custom tools and raw scrcpy options.' }
)

$AudioSources = @((C 'output' 'Phone sound (output)'), (C 'playback' 'Playback capture'), (C 'mic' 'Microphone'), (C 'mic-unprocessed' 'Microphone (raw)'), (C 'mic-voice-communication' 'Microphone (voice call)'))
$ShapeSizes = @((C 'phone' 'Phone (its own shape)'), (C '1280x800' 'Tablet 16:10, 1280x800'), (C '1600x1200' 'Tablet 4:3, 1600x1200'), (C '1920x1200' 'Tablet 16:10, 1920x1200'), (C '2048x1536' 'Tablet 4:3, 2048x1536'), (C '1280x720' 'PC 16:9, 1280x720'), (C '1920x1080' 'PC 16:9, 1920x1080'), (C '2560x1440' 'PC 16:9, 2560x1440'), (C 'custom' 'Custom size'))
$AudioCodecs = @((C '' 'scrcpy default'), (C 'opus' 'Opus'), (C 'aac' 'AAC'), (C 'flac' 'FLAC'), (C 'raw' 'Raw'))
# Audio modes (4.1.0). The ids are stored in settings and checked against this list.
$AudioModeIds = @('video_only', 'record_only', 'copy_play', 'reroute')
$AudioModeChoices = @((C 'video_only' 'Video only'), (C 'record_only' 'Copy to recording'), (C 'copy_play' 'Copy and play on PC'), (C 'reroute' 'Reroute audio to PC'))
$AudioModes = @(
    @{ id = 'video_only'; label = 'Video only'; summary = 'Mirror and record the screen without phone sound. Nothing changes on the phone.'; phone = 'Plays normally'; pc = 'Silent'; recording = 'Video only'; needs = 'Any phone' },
    @{ id = 'record_only'; label = 'Copy to recording'; summary = 'The recording gets the phone sound. The PC stays silent, the phone keeps playing. Made for game recording.'; phone = 'Plays normally'; pc = 'Silent'; recording = 'Video and sound'; needs = 'Android 13 or newer' },
    @{ id = 'copy_play'; label = 'Copy and play on PC'; summary = 'The phone keeps playing, the PC plays the sound too, and the recording has it.'; phone = 'Plays normally'; pc = 'Plays the sound'; recording = 'Video and sound'; needs = 'Android 13 or newer' },
    @{ id = 'reroute'; label = 'Reroute audio to PC'; summary = 'The sound moves to the PC. The phone goes quiet for the sound that is rerouted. Whether a recording gets the sound depends on how you record, so it is checked and reported.'; phone = 'Silent'; pc = 'Plays the sound'; recording = 'Checked after each recording'; needs = 'Android 11 or newer' }
)
$StreamAudioIds = @('none', 'silent_pc', 'listen')
$StreamAudioChoices = @((C 'none' 'Stream without game sound'), (C 'silent_pc' 'Stream, PC speakers stay silent'), (C 'listen' 'Stream and listen on the PC'))
$InputModes = @((C '' 'Default'), (C 'sdk' 'Android SDK'), (C 'uhid' 'Simulated USB (uhid)'), (C 'aoa' 'USB accessory (aoa)'), (C 'disabled' 'Disabled'))
$Orientations = @((C '' 'Automatic'), (C '0' 'Natural'), (C '90' '90 degrees'), (C '180' '180 degrees'), (C '270' '270 degrees'), (C '@0' 'Lock natural'), (C '@90' 'Lock 90'), (C '@180' 'Lock 180'), (C '@270' 'Lock 270'))

$Schema = @(
    # video
    (F 'source' 'video' 'choice' 'display' 'Capture source' 'Mirror the screen, or stream the phone camera.' -Choices @((C 'display' 'Screen'), (C 'camera' 'Camera'))),
    (F 'maxSize' 'video' 'int' 1280 'Longest side' 'Pixels. 0 keeps the phone resolution.' -Min 0 -Max 8192 -Picks @(720, 1024, 1280, 1600, 1920, 0) -Unit 'px'),
    (F 'maxFps' 'video' 'int' 30 'Frame rate' 'Higher is smoother and uses more CPU.' -Min 1 -Max 240 -Picks @(15, 24, 30, 45, 60, 90, 120) -Unit 'fps'),
    (F 'bitrateMbps' 'video' 'int' 8 'Bitrate' 'Higher looks better and makes larger recordings.' -Min 1 -Max 200 -Picks @(2, 4, 8, 12, 16, 24) -Unit 'Mbps'),
    (F 'codec' 'video' 'choice' 'h264' 'Video codec' 'H.265 and AV1 make smaller files but need phone support.' -Choices @((C 'h264' 'H.264'), (C 'h265' 'H.265'), (C 'av1' 'AV1'))),
    (F 'shapeSize' 'video' 'choice' 'phone' 'Window shape' 'Phone keeps the window the shape of the phone. Tablet and PC make the mirror and record window that shape, with your normal phone screen scaled to fit inside. The phone itself is not changed. OBS, TikTok Live and other apps that capture the window get that shape. The recording file keeps the phone shape.' -Choices $ShapeSizes),
    (F 'shapeW' 'video' 'int' 1600 'Custom window width' 'Pixels.' -Min 320 -Max 7680 -Unit 'px' -Show @{ shapeSize = @('custom') }),
    (F 'shapeH' 'video' 'int' 1200 'Custom window height' 'Pixels.' -Min 320 -Max 7680 -Unit 'px' -Show @{ shapeSize = @('custom') }),
    (F 'videoEncoder' 'video' 'text' '' 'Video encoder' 'Optional. Exact encoder name, for example OMX.qcom.video.encoder.avc.' -Pattern '^[A-Za-z0-9._\-]{0,80}$' -Placeholder 'Automatic'),
    (F 'displayId' 'video' 'int' 0 'Display id' 'Mirror a secondary display. 0 is the main screen.' -Min 0 -Max 99 -Show @{ source = 'display' }),
    (F 'virtualDisplay' 'video' 'bool' $false 'Use a virtual display' 'Creates a separate display so apps can run without touching the phone screen.' -Show @{ source = 'display' }),
    (F 'virtualDisplaySize' 'video' 'text' '' 'Virtual display size' 'Examples: 1920x1080, 1920x1080/420 or /240 (dpi). Empty uses the main size.' -Pattern '^(\d{3,5}x\d{3,5}(/\d{2,4})?|/\d{2,4})?$' -Show @{ virtualDisplay = $true } -Placeholder '1920x1080/420'),
    (F 'crop' 'video' 'text' '' 'Crop' 'width:height:x:y in phone pixels.' -Pattern '^(\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5})?$' -Show @{ source = 'display' } -Placeholder '1080:1080:0:300'),
    (F 'captureOrientation' 'video' 'choice' '' 'Capture orientation' 'Rotate or lock the captured video.' -Choices $Orientations),
    (F 'cameraFacing' 'video' 'choice' '' 'Camera facing' 'Which camera to open.' -Choices @((C '' 'Default'), (C 'front' 'Front'), (C 'back' 'Back'), (C 'external' 'External')) -Show @{ source = 'camera' }),
    (F 'cameraId' 'video' 'text' '' 'Camera id' 'Overrides the facing choice. Use scrcpy --list-cameras to find ids.' -Pattern '^[0-9]{0,3}$' -Show @{ source = 'camera' } -Placeholder 'Automatic'),
    (F 'cameraSize' 'video' 'text' '' 'Camera size' 'Example 1920x1080.' -Pattern '^(\d{3,5}x\d{3,5})?$' -Show @{ source = 'camera' } -Placeholder 'Automatic'),
    (F 'videoBuffer' 'video' 'int' 0 'Video buffer' 'Adds delay to smooth playback. 0 gives the lowest latency.' -Min 0 -Max 5000 -Picks @(0, 50, 100, 200) -Unit 'ms'),
    # audio. The Audio mode controller (Resolve-AudioPlan) decides every audio option. The keys audio, audioSource
    # and audioDup are kept so older backups still import; audio and audioDup are no longer used.
    (F 'audioMode' 'audio' 'choice' 'video_only' 'Audio mode' 'Choose with the cards at the top of this section.' -Choices $AudioModeChoices -Hidden $true),
    (F 'streamAudio' 'audio' 'choice' 'none' 'Streaming audio plan' 'What you want OBS to hear. DROID ADB only checks it against the audio mode; it never changes OBS or the phone.' -Choices $StreamAudioChoices -Hidden $true),
    (F 'audio' 'audio' 'bool' $true 'Capture phone audio (old setting)' 'Replaced by Audio mode. Kept so old backups import.' -Hidden $true),
    (F 'audioRequire' 'audio' 'bool' $true 'Stop a recording if its sound cannot be captured' 'Stops DROID ADB from quietly saving a silent video. It then tells you why. Applies to Copy to recording, Copy and play, and Reroute.' -Show @{ audioMode = @('record_only', 'copy_play', 'reroute') }),
    (F 'audioSource' 'audio' 'choice' 'output' 'Audio source (Reroute only)' 'Phone sound (output) is the normal choice. A microphone source forwards your voice instead and the phone keeps its own sound.' -Choices $AudioSources -Show @{ audioMode = 'reroute' }),
    (F 'audioDup' 'audio' 'bool' $false 'Keep sound on the phone too (old setting)' 'Replaced by the two Copy modes.' -Hidden $true),
    (F 'audioCodec' 'audio' 'choice' '' 'Audio codec (mirror)' 'Codec used while only mirroring.' -Choices $AudioCodecs -Show @{ audioMode = @('copy_play', 'reroute') }),
    (F 'recordAudioCodec' 'audio' 'choice' 'aac' 'Audio codec (recording)' 'AAC is the safest choice for recordings.' -Choices $AudioCodecs -Show @{ audioMode = @('record_only', 'copy_play', 'reroute') }),
    (F 'audioBitrate' 'audio' 'int' 0 'Audio bitrate' '0 uses the scrcpy default.' -Min 0 -Max 512 -Picks @(0, 64, 128, 192, 256) -Unit 'kbps' -Show @{ audioMode = @('record_only', 'copy_play', 'reroute') }),
    (F 'audioBuffer' 'audio' 'int' 0 'Audio buffer' '0 uses the smooth default of 100 ms. Lower it for less delay, raise it if the sound crackles.' -Min 0 -Max 2000 -Picks @(0, 50, 100, 150, 200, 300) -Unit 'ms' -Show @{ audioMode = @('copy_play', 'reroute') }),
    (F 'audioOutputBuffer' 'audio' 'int' 0 'Audio output buffer' '0 uses the smooth default of 20 ms. Raise it if the sound crackles on the PC.' -Min 0 -Max 500 -Picks @(0, 10, 20, 40, 80) -Unit 'ms' -Show @{ audioMode = @('copy_play', 'reroute') }),
    # control
    (F 'viewOnly' 'control' 'bool' $false 'View only' 'Block mouse and keyboard control of the phone.'),
    (F 'keyboard' 'control' 'choice' '' 'Keyboard mode' 'uhid works in games and with any language. aoa needs USB.' -Choices $InputModes -Show @{ viewOnly = $false }),
    (F 'mouse' 'control' 'choice' '' 'Mouse mode' 'uhid shows a real pointer on the phone.' -Choices $InputModes -Show @{ viewOnly = $false }),
    (F 'noClipboardAutosync' 'control' 'bool' $false 'Disable clipboard sync' 'Stops copy and paste between PC and phone.' -Show @{ viewOnly = $false }),
    (F 'legacyPaste' 'control' 'bool' $false 'Legacy paste' 'Ctrl+V types the PC clipboard as keystrokes.' -Show @{ viewOnly = $false }),
    (F 'preferText' 'control' 'bool' $false 'Prefer text events' 'Sends letters as text instead of key events.' -Show @{ viewOnly = $false }),
    (F 'stayAwake' 'control' 'bool' $true 'Keep the phone awake' 'Stops the screen from sleeping while it is plugged in.'),
    (F 'turnScreenOff' 'control' 'bool' $false 'Turn the phone screen off' 'Mirror with the phone display dark.'),
    (F 'showTouches' 'control' 'bool' $false 'Show touches' 'Draws a dot where fingers touch. Good for demos.'),
    (F 'powerOffOnClose' 'control' 'bool' $false 'Lock phone on close' 'Turns the phone screen off when you close the window.'),
    (F 'noPowerOn' 'control' 'bool' $false 'Do not wake the phone on start' 'Leave the phone screen as it is when scrcpy starts.'),
    (F 'screenOffTimeout' 'control' 'int' 0 'Screen-off timeout' 'Temporarily change the phone timeout. 0 leaves it alone.' -Min 0 -Max 3600 -Picks @(0, 30, 60, 300) -Unit 'sec'),
    # window
    (F 'windowTitle' 'window' 'text' 'DROID ADB' 'Window title' 'Shown in the title bar and taskbar.' -Pattern '^[A-Za-z0-9 ._\-]{1,60}$'),
    (F 'alwaysOnTop' 'window' 'bool' $false 'Keep window on top' 'The mirror window stays above other apps.'),
    (F 'fullscreen' 'window' 'bool' $false 'Start in full screen' 'Open the mirror window full screen.'),
    (F 'borderless' 'window' 'bool' $false 'Borderless window' 'Hide the window title bar.'),
    (F 'windowWidth' 'window' 'int' 0 'Window width' '0 chooses automatically.' -Min 0 -Max 10000 -Unit 'px'),
    (F 'windowHeight' 'window' 'int' 0 'Window height' '0 chooses automatically.' -Min 0 -Max 10000 -Unit 'px'),
    (F 'disableScreensaver' 'window' 'bool' $false 'Block the PC screensaver' 'Keeps the PC awake while mirroring.'),
    (F 'noKeyRepeat' 'window' 'bool' $false 'Disable key repeat' 'Holding a key sends one press.'),
    (F 'printFps' 'window' 'bool' $false 'Log frame rate' 'Writes FPS into the session log.'),
    # recording
    (F 'recordFormat' 'recording' 'choice' 'mkv' 'Recording format' 'MKV survives crashes and forced stops. MP4 needs a clean stop.' -Choices @((C 'mkv' 'MKV'), (C 'mp4' 'MP4'))),
    (F 'recordTemplate' 'recording' 'text' 'DroidADB_{date}_{time}' 'Recording file name' 'Tokens: {date} {time} {serial} {model} {app}.' -Pattern '^[A-Za-z0-9 ._\-{}]{1,80}$'),
    (F 'recordTimeLimit' 'recording' 'int' 0 'Automatic stop' 'Stop recording after this many seconds. 0 means never.' -Min 0 -Max 86400 -Picks @(0, 60, 300, 600, 1800, 3600) -Unit 'sec'),
    (F 'recordWindowless' 'recording' 'bool' $false 'Record without a window' 'Records in the background. Use Stop in the dashboard to finish.'),
    (F 'recordOwnQuality' 'recording' 'bool' $true 'High quality for recordings' 'Recordings use the three values below, whatever the mirror uses. Turn off to use the Video settings for both.'),
    (F 'recordMaxSize' 'recording' 'int' 0 'Recording longest side' 'Pixels. 0 keeps the full phone resolution.' -Min 0 -Max 8192 -Picks @(0, 2560, 1920, 1280) -Unit 'px'),
    (F 'recordMaxFps' 'recording' 'int' 60 'Recording frame rate' 'Higher is smoother. 60 matches most phones.' -Min 1 -Max 240 -Picks @(30, 45, 60, 90, 120) -Unit 'fps'),
    (F 'recordBitrateMbps' 'recording' 'int' 40 'Recording bitrate' 'Higher keeps more detail and makes bigger files. 40 Mbps is about 18 GB an hour.' -Min 1 -Max 200 -Picks @(16, 24, 40, 60, 80, 120) -Unit 'Mbps'),
    (F 'recordWhileMirroring' 'recording' 'choice' 'companion' 'Record while mirroring' 'Companion starts a hidden second scrcpy recorder so the mirror window stays open. Block keeps one session per phone.' -Choices @((C 'companion' 'Hidden companion recorder'), (C 'block' 'Block (stop mirror first)'))),
    (F 'autoRecordWithMirror' 'recording' 'bool' $false 'Record whenever I mirror' 'Starts a background recording together with every mirror window. Stopping the mirror also stops that recording.'),
    (F 'showRecBadge' 'recording' 'bool' $true 'Show recording badge on the phone picture' 'Shows REC with a timer on the dashboard phone picture while recording.'),
    (F 'companionAudio' 'recording' 'bool' $true 'Sound in companion recordings (Reroute only)' 'With Reroute, a second capture of the rerouted sound can silence the mirror on some phones. Turn this off to record video only while mirroring. The two Copy modes always record their sound.' -Show @{ audioMode = 'reroute' }),
    (F 'recordCountdown' 'recording' 'int' 0 'Start countdown' 'Seconds to count down in the dashboard before recording begins.' -Min 0 -Max 10 -Picks @(0, 3, 5) -Unit 'sec'),
    (F 'nameByApp' 'recording' 'bool' $true 'Add the app name to file names' 'Adds the app that was in front on the phone, like DroidADB_2026-10-24_12-00-00_chrome. Skipped when the name template already has {app}.'),
    (F 'screenshotTemplate' 'recording' 'text' 'Shot-{date}_{time}' 'Screenshot file name' 'Tokens: {date} {time} {serial} {model} {app}.' -Pattern '^[A-Za-z0-9 ._\-{}]{1,80}$'),
    # files
    (F 'recordingsDir' 'files' 'path' '' 'Recordings folder' 'Full path. Empty uses Recordings inside the toolkit.' -Placeholder 'D:\Phone\Recordings'),
    (F 'screenshotsDir' 'files' 'path' '' 'Screenshots folder' 'Full path. Empty uses Screenshots inside the toolkit.' -Placeholder 'D:\Phone\Screenshots'),
    (F 'downloadsDir' 'files' 'path' '' 'Pulled files folder' 'Where files and APKs pulled from the phone are saved.' -Placeholder 'D:\Phone\Pulled'),
    (F 'remoteTmpDir' 'files' 'text' '/data/local/tmp' 'Phone temp folder' 'Used for screenshots and uploads on the phone.' -Pattern '^/[A-Za-z0-9._/\-]{1,100}$'),
    (F 'maxUploadMB' 'files' 'int' 2048 'Largest upload' 'Limit for APKs and files sent from the browser.' -Min 1 -Max 16384 -Unit 'MB'),
    (F 'logRetention' 'files' 'int' 20 'Session logs to keep' 'Older scrcpy session logs are deleted.' -Min 1 -Max 500),
    # toolkit
    (F 'port' 'toolkit' 'int' 47821 'Backend port' 'The dashboard address is http://127.0.0.1:PORT/.' -Min 1024 -Max 65535 -Restart $true),
    (F 'serverWorkers' 'toolkit' 'int' 8 'Backend workers' 'Requests handled at the same time. More helps slow phones.' -Min 2 -Max 32 -Restart $true),
    (F 'openBrowser' 'toolkit' 'bool' $true 'Open the dashboard on launch' 'Open your browser when Launch.bat finishes.' -Restart $true),
    (F 'pollSeconds' 'toolkit' 'int' 3 'Refresh interval' 'How often the dashboard checks the backend.' -Min 1 -Max 30 -Picks @(1, 2, 3, 5, 10) -Unit 'sec'),
    (F 'previewSeconds' 'toolkit' 'int' 3 'Live preview interval' 'How often the Console preview takes a new picture.' -Min 1 -Max 60 -Picks @(2, 3, 5, 10) -Unit 'sec'),
    (F 'liveSeconds' 'toolkit' 'int' 2 'Phone status refresh' 'How often battery, rotation and screen state are read while the dashboard is open.' -Min 1 -Max 30 -Picks @(1, 2, 3, 5, 10) -Unit 'sec'),
    (F 'previewTouch' 'toolkit' 'bool' $true 'Tap and swipe on the preview' 'Click the phone picture to tap it, drag to swipe, hold to long-press.'),
    (F 'previewPauseOnSession' 'toolkit' 'bool' $false 'Pause live preview during sessions' 'Stops automatic preview updates while a mirror or recording runs. Manual Update still works.'),
    (F 'previewOnRotate' 'toolkit' 'bool' $true 'Refresh preview after rotation' 'Takes one new picture when the phone rotates, even if live preview is off.'),
    (F 'layoutAnimation' 'toolkit' 'choice' 'auto' 'Layout animation' 'Auto follows your system reduced-motion setting.' -Choices @((C 'auto' 'Automatic'), (C 'on' 'Always animate'), (C 'off' 'Never animate'))),
    (F 'batteryAlertPct' 'toolkit' 'int' 15 'Low battery alert' 'Show an alert when the phone falls to this level and is not charging. 0 turns it off.' -Min 0 -Max 50 -Picks @(0, 10, 15, 20, 30) -Unit '%'),
    (F 'lowDiskGb' 'toolkit' 'int' 2 'Low disk alert' 'Warn when free space on the recordings drive falls below this. 0 turns it off.' -Min 0 -Max 500 -Picks @(0, 1, 2, 5, 10) -Unit 'GB'),
    (F 'appNames' 'toolkit' 'text' '' 'App display names' 'Friendly names for package names, like com.tencent.ig=PUBG Mobile;com.whatsapp=WhatsApp' -Pattern '^[A-Za-z0-9._=; \-]{0,240}$' -Placeholder 'com.tencent.ig=PUBG Mobile'),
    (F 'autoReconnect' 'toolkit' 'bool' $true 'Reconnect Wi-Fi phones' 'Reconnect saved Wi-Fi phones automatically when they drop off the network.'),
    (F 'notifyDesktop' 'toolkit' 'bool' $true 'Desktop notifications' 'Show a Windows notification when a recording is saved, a job finishes, the battery is low or the phone disconnects.'),
    (F 'accent' 'toolkit' 'choice' 'amber' 'Accent colour' 'Colour of buttons and highlights in the dashboard.' -Choices @((C 'amber' 'Amber'), (C 'blue' 'Blue'), (C 'violet' 'Violet'), (C 'teal' 'Teal'), (C 'green' 'Green'), (C 'orange' 'Orange'), (C 'rose' 'Rose'))),
    (F 'theme' 'toolkit' 'choice' 'auto' 'Theme' 'Auto follows Windows.' -Choices @((C 'auto' 'Auto'), (C 'dark' 'Dark'), (C 'light' 'Light'))),
    (F 'confirmDeletes' 'toolkit' 'bool' $true 'Ask before deleting' 'Confirm before removing files and apps.'),
    (F 'adbTimeoutSec' 'toolkit' 'int' 15 'ADB timeout' 'How long to wait for the phone before giving up.' -Min 3 -Max 300 -Picks @(8, 15, 30, 60) -Unit 'sec'),
    (F 'tcpPort' 'toolkit' 'int' 5555 'Wi-Fi debugging port' 'Port used when switching a USB phone to Wi-Fi.' -Min 1024 -Max 65535),
    (F 'stopGraceSeconds' 'toolkit' 'int' 4 'Stop grace period' 'Seconds to wait for scrcpy to close cleanly before forcing it.' -Min 1 -Max 30 -Unit 'sec'),
    # advanced
    (F 'ffmpegPath' 'advanced' 'path' '' 'ffmpeg executable' 'Optional. Needed for trimming, converting and making GIFs in the Library. The toolkit also looks in core\ffmpeg and on PATH.' -Placeholder 'C:\ffmpeg\bin\ffmpeg.exe'),
    (F 'adbPath' 'advanced' 'path' '' 'ADB executable' 'Use your own adb instead of the bundled one.' -Placeholder 'C:\platform-tools\adb.exe'),
    (F 'scrcpyPath' 'advanced' 'path' '' 'scrcpy executable' 'Use your own scrcpy instead of the bundled one.' -Placeholder 'C:\scrcpy\scrcpy.exe'),
    (F 'extraArgs' 'advanced' 'text' '' 'Extra scrcpy options' 'Raw options added to every command, for example --no-mouse-hover.' -Pattern '^(\s*--?[A-Za-z0-9][A-Za-z0-9\-]*(=[A-Za-z0-9._:/,+@\-]*)?)*\s*$' -Placeholder '--no-mouse-hover')
)
$SchemaByKey = @{}
foreach ($f in $Schema) { $SchemaByKey[$f.key] = $f }

$Presets = @(
    @{ id = 'battery'; name = 'Battery saver'; note = 'Light on phone and PC'; v = @{ maxSize = 1024; maxFps = 24; bitrateMbps = 4 } },
    @{ id = 'balanced'; name = 'Balanced'; note = 'Good for most phones'; v = @{ maxSize = 1280; maxFps = 30; bitrateMbps = 8 } },
    @{ id = 'quality'; name = 'Quality'; note = 'Sharper and smoother'; v = @{ maxSize = 1600; maxFps = 45; bitrateMbps = 12 } },
    @{ id = 'max'; name = 'Maximum'; note = 'Native size, needs a strong PC'; v = @{ maxSize = 0; maxFps = 60; bitrateMbps = 16 } },
    @{ id = 'latency'; name = 'Low latency'; note = 'Gaming and quick taps, video only'; v = @{ maxSize = 1024; maxFps = 60; bitrateMbps = 6; videoBuffer = 0; audioMode = 'video_only' } },
    @{ id = 'screencast'; name = 'Screen recorder'; note = 'Clean 1080p capture, sound in the recording'; v = @{ maxSize = 1920; maxFps = 30; bitrateMbps = 12; audioMode = 'record_only'; recordAudioCodec = 'aac' } }
)

function Get-Defaults {
    $d = @{}
    foreach ($f in $Schema) { $d[$f.key] = $f.default }
    return $d
}

function Test-Field {
    param($F, $Raw)
    switch ($F.type) {
        'bool' {
            if ($Raw -is [string]) { return ($Raw.ToLower() -in @('true', '1', 'yes', 'on')) }
            return [bool]$Raw
        }
        'int' {
            $n = 0
            if (-not [int]::TryParse(([string]$Raw), [ref]$n)) { Fail ($F.label + ' must be a whole number.') }
            if ($n -lt $F.min -or $n -gt $F.max) { Fail ($F.label + ' must be between ' + $F.min + ' and ' + $F.max + '.') }
            return $n
        }
        'choice' {
            $v = [string]$Raw
            foreach ($c in $F.choices) { if ([string]$c.v -eq $v) { return $v } }
            Fail ('Unsupported value for ' + $F.label + '.')
        }
        'text' {
            $v = ([string]$Raw).Trim()
            if ($v.Length -gt 240) { Fail ($F.label + ' is too long.') }
            if ($v -ne '' -and $F.pattern -ne '' -and ($v -notmatch $F.pattern)) { Fail ($F.label + ' contains characters or a format that is not allowed.') }
            return $v
        }
        'path' {
            $v = ([string]$Raw).Trim()
            if ($v -eq '') { return '' }
            if ($v.Length -gt 240 -or $v -match '["%&|<>^*?]') { Fail ($F.label + ' contains characters that are not allowed.') }
            if (-not [IO.Path]::IsPathRooted($v)) { Fail ($F.label + ' must be a full path, for example C:\Videos.') }
            return $v
        }
    }
    return $Raw
}

# Builds a validated settings hashtable. $Patch overrides $Base; missing keys fall back to defaults.
function ConvertTo-Settings {
    param($Patch, $Base)
    $s = @{}
    foreach ($f in $Schema) {
        $raw = $null
        $has = $false
        if ($Patch -is [hashtable]) { if ($Patch.ContainsKey($f.key)) { $raw = $Patch[$f.key]; $has = $true } }
        elseif ($null -ne $Patch) { $p = $Patch.PSObject.Properties[$f.key]; if ($p) { $raw = $p.Value; $has = $true } }
        if (-not $has -and $Base) { if ($Base.ContainsKey($f.key)) { $raw = $Base[$f.key]; $has = $true } }
        if (-not $has -or $null -eq $raw) { $raw = $f.default }
        $s[$f.key] = Test-Field $f $raw
    }
    return $s
}

function Get-Settings {
    $stamp = $null
    try { $stamp = (Get-Item -LiteralPath $ConfigFile -ErrorAction Stop).LastWriteTimeUtc.Ticks } catch {}
    $cached = $Shared.settings
    if ($cached -and $Shared.settingsStamp -eq $stamp) { return $cached.Clone() }
    $result = $null
    try {
        $raw = [IO.File]::ReadAllText($ConfigFile) | ConvertFrom-Json
        $legacy = @{}
        # Settings written by 2.0.x stored the bitrate as text such as 8M.
        if ($raw.PSObject.Properties['bitrate'] -and -not $raw.PSObject.Properties['bitrateMbps']) {
            if ([string]$raw.bitrate -match '^(\d+)M$') { $legacy['bitrateMbps'] = [int]$Matches[1] }
        }
        $base = ConvertTo-Settings $raw $null
        $result = ConvertTo-Settings $legacy $base
    } catch { $result = ConvertTo-Settings @{} $null }
    if ($result -and [string]$result.windowTitle -eq 'Scrcpy Toolkit') { $result.windowTitle = 'DROID ADB' }
    # 4.4.0: the old default recording name moves to the new one. A name you wrote yourself is left alone.
    if ($result -and [string]$result.recordTemplate -eq 'Phone-{date}_{time}') { $result.recordTemplate = 'DroidADB_{date}_{time}' }
    Use-Lock { $Shared.settings = $result.Clone(); $Shared.settingsStamp = $stamp }
    return $result
}

function Save-Settings {
    param([hashtable]$Settings)
    Use-Lock {
        Write-TextAtomic $ConfigFile ($Settings | ConvertTo-Json)
        $Shared.settings = $null
    }
}

# ---------------------------------------------------------------------------
# Profiles (named copies of settings)
# ---------------------------------------------------------------------------
function Get-Profiles {
    $list = @()
    foreach ($p in @(Get-JsonList $ProfilesFile)) { if ($p.name) { $list += , @{ name = [string]$p.name; values = $p.values } } }
    return $list
}
function Save-Profiles { param($List) Use-Lock { Write-TextAtomic $ProfilesFile (ConvertTo-Json -InputObject @($List) -Depth 5) } }

# ---------------------------------------------------------------------------
# Folders and tools
# ---------------------------------------------------------------------------
function Get-Dir {
    param([string]$Kind)
    $s = Get-Settings
    $map = @{ recordings = @('recordingsDir', 'Recordings'); screenshots = @('screenshotsDir', 'Screenshots'); downloads = @('downloadsDir', 'Pulled') }
    if (-not $map.ContainsKey($Kind)) { Fail 'Unknown folder.' }
    $custom = [string]$s[$map[$Kind][0]]
    if ($custom -ne '') { $dir = $custom } else { $dir = Join-Path $Root $map[$Kind][1] }
    if (-not (Test-Path -LiteralPath $dir)) { try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { Fail ('Cannot create the folder ' + $dir + '.') } }
    return $dir
}

function Get-AdbPath {
    $s = Get-Settings
    if ([string]$s.adbPath -ne '') { return [string]$s.adbPath }
    if ($OnWindows) { return (Join-Path $BundledDir 'adb.exe') }
    return 'adb'
}
function Get-ScrcpyPath {
    $s = Get-Settings
    if ([string]$s.scrcpyPath -ne '') { return [string]$s.scrcpyPath }
    if ($OnWindows) { return (Join-Path $BundledDir 'scrcpy.exe') }
    return 'scrcpy'
}
function Test-Tool { param([string]$Path) return (Test-Path -LiteralPath $Path -PathType Leaf) }

function Get-DiskInfo {
    param([string]$Path)
    try {
        if (-not $Path) { $Path = $Root }
        $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($Path))
        return @{ free = [long]$drive.AvailableFreeSpace; total = [long]$drive.TotalSize }
    } catch { return @{ free = [long]0; total = [long]0 } }
}

# ---------------------------------------------------------------------------
# Running ADB and other tools
# ---------------------------------------------------------------------------
function Test-Serial {
    param([string]$Serial)
    if ($Serial -and $Serial -notmatch '^[A-Za-z0-9._:\-]{1,64}$') { Fail 'That device id is not valid.' }
}
function Resolve-Target {
    param([string]$Serial)
    Test-Serial $Serial
    if ($Serial) { return ('-s ' + $Serial + ' ') }
    return ''
}

# Reads a text file even while another process (adb daemon, antivirus) still holds it open. Retries briefly.
function Read-SharedText {
    param([string]$Path)
    $last = $null
    for ($i = 0; $i -lt 12; $i++) {
        try {
            $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            try { $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8, $true); return [string]$sr.ReadToEnd() } finally { $fs.Dispose() }
        } catch { $last = $_; Start-Sleep -Milliseconds (60 + 40 * $i) }
    }
    throw $last
}

function Invoke-Native {
    param([string]$File, [string]$ArgLine, [int]$TimeoutSec = 15, [string]$WorkDir = '', [string]$Label = '')
    $tmp = [IO.Path]::GetTempPath()
    $stdoutFile = Join-Path $tmp ('stk-out-' + [guid]::NewGuid().ToString('N') + '.txt')
    $stderrFile = Join-Path $tmp ('stk-err-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        $splat = @{ FilePath = $File; ArgumentList = $ArgLine; NoNewWindow = $true; PassThru = $true; RedirectStandardOutput = $stdoutFile; RedirectStandardError = $stderrFile }
        if ($WorkDir) { $splat.WorkingDirectory = $WorkDir }
        $p = Start-Process @splat
        $null = $p.Handle
        if (-not $p.WaitForExit($TimeoutSec * 1000)) {
            try { $p.Kill() } catch {}
            if ($Label -ne '') { Fail ($Label + ' did not finish within ' + $TimeoutSec + ' seconds. The first start of a program can be slow while antivirus checks it. Try again.') }
            Fail 'The phone did not answer in time. Check the cable, unlock the phone and try again.'
        }
        $p.WaitForExit()
        $o = ''
        $e = ''
        if (Test-Path -LiteralPath $stdoutFile) { $o = Read-SharedText $stdoutFile }
        if (Test-Path -LiteralPath $stderrFile) { $e = Read-SharedText $stderrFile }
        return @{ code = [int]$p.ExitCode; out = $o; err = $e }
    } finally {
        foreach ($f in @($stdoutFile, $stderrFile)) { try { Remove-Item -LiteralPath $f -Force -ErrorAction Stop } catch { try { Start-Sleep -Milliseconds 150; Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } catch {} } }
    }
}

function Invoke-Adb {
    param([string]$ArgLine, [int]$TimeoutSec = 0)
    $adb = Get-AdbPath
    if ($OnWindows -and -not (Test-Tool $adb)) { Fail 'adb.exe was not found. Check the ADB executable setting or extract the full ZIP again.' }
    if ($TimeoutSec -le 0) { $TimeoutSec = [int](Get-Settings).adbTimeoutSec }
    $dir = ''
    if (Test-Path -LiteralPath $BundledDir) { $dir = $BundledDir }
    return (Invoke-Native $adb $ArgLine $TimeoutSec $dir)
}

# Runs a command in the phone shell. Quotes are escaped for the Windows command line.
function Invoke-DeviceShell {
    param([string]$Serial, [string]$Command, [int]$TimeoutSec = 0)
    $sel = Resolve-Target $Serial
    $q = $Command.Replace('"', '\"')
    return (Invoke-Adb ($sel + 'shell "' + $q + '"') $TimeoutSec)
}

function Get-DevicesRaw {
    $r = Invoke-Adb 'devices -l' 10
    $items = @()
    foreach ($line in (($r.out + "`n" + $r.err) -split "`r?`n")) {
        if ($line -match '^([^\s]+)\s+(device|unauthorized|offline|authorizing|no permissions)(?:\s+(.*))?$') {
            $id = $Matches[1]
            $items += , @{ id = $id; state = $Matches[2]; details = ([string]$Matches[3]).Trim(); transport = $(if ($id -match ':\d+$') { 'wifi' } else { 'usb' }) }
        }
    }
    return $items
}

function Update-DeviceCache {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $message = ''
    $list = @()
    $failed = $false
    try { $list = @(Get-DevicesRaw) } catch { $message = $_.Exception.Message; $failed = $true }
    $sw.Stop()
    $prev = @($Shared.devices | Where-Object { $null -ne $_ })
    $miss = [int]$Shared.devMiss
    # A slow or empty answer from adb must not make a connected phone vanish for a moment.
    $limit = $(if ($failed) { 4 } else { 2 })
    if ($list.Count -eq 0 -and $prev.Count -gt 0 -and $miss -lt $limit) {
        Use-Lock { $Shared.devMiss = $miss + 1; $Shared.adbLatencyMs = [int]$sw.ElapsedMilliseconds; if (-not $failed) { $Shared.devicesAt = (Get-Date) } }
        return
    }
    if ($message -eq '' -and $list.Count -eq 0) { $message = 'No device detected. Connect USB, enable USB debugging, and authorize this computer.' }
    Use-Lock {
        $Shared.devMiss = 0
        $Shared.devices = $list
        $Shared.deviceMessage = $message
        $Shared.devicesAt = (Get-Date)
        $Shared.adbLatencyMs = [int]$sw.ElapsedMilliseconds
    }
}

function Get-DeviceCache {
    $at = $Shared.devicesAt
    if (-not $at -or ((Get-Date) - $at).TotalSeconds -gt 12) { Update-DeviceCache }
    return @{ devices = @($Shared.devices | Where-Object { $null -ne $_ }); message = [string]$Shared.deviceMessage; ageSec = [int]((Get-Date) - $Shared.devicesAt).TotalSeconds; adbLatencyMs = [int]$Shared.adbLatencyMs }
}

function Get-DeviceModelHint {
    param([string]$Serial)
    $info = $Shared.info
    if ($info -and $Serial -and $info.ContainsKey($Serial)) { $m = [string]$info[$Serial].data.model; if ($m) { return $m } }
    return $Serial
}

# ---------------------------------------------------------------------------
# Audio modes (4.1.0)
# One controller decides every audio option of every scrcpy process. Nothing else builds audio flags.
#   Phone policy   : does the phone keep playing, or is its sound moved to the PC?   (the mode)
#   Mirror playback: does this scrcpy process play the sound on the PC?              (window or no window)
#   Recording audio: does the saved file get the sound?                              (record role)
#   Streaming audio: what OBS can hear. OBS is outside this program; see Get-StreamAudioPlan.
# Every plan reports what will really happen. A mode that cannot work is never shown as active.
# ---------------------------------------------------------------------------
function Get-AudioModeId {
    param($S)
    $id = [string]$S.audioMode
    if ($AudioModeIds -contains $id) { return $id }
    return 'video_only'
}

function Get-AudioModeInfo {
    param([string]$Id)
    foreach ($m in $AudioModes) { if ($m.id -eq $Id) { return $m } }
    return $AudioModes[0]
}

# Which audio options this scrcpy really has. Read from its own --help, cached, never assumed.
# Reads what a scrcpy build supports WITHOUT starting it: option names are stored as plain text inside scrcpy.exe.
# Starting scrcpy just to read its help can be very slow on a PC that scans new programs (antivirus), and a slow check
# used to stop recordings from starting at all. 4.2: the file is read first and scrcpy is only started as a fallback.
function Get-ScrcpyFileCaps {
    param([string]$Path)
    $r = @{ ok = $false; version = ''; flags = @{} }
    try {
        $full = $Path
        if ($full -and -not (Test-Path -LiteralPath $full -PathType Leaf)) {
            $cmd = Get-Command $full -ErrorAction SilentlyContinue
            if ($cmd -and $cmd.Source) { $full = [string]$cmd.Source } else { $full = '' }
        }
        if (-not $full -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { return $r }
        if ((Get-Item -LiteralPath $full).Length -gt 80MB) { return $r }
        $text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($full))
        if ($text -match 'scrcpy (\d+\.\d+(?:\.\d+)?)') { $r.version = $Matches[1] }
        $names = @{ '--audio-dup' = 'audio-dup'; '--audio-source' = 'audio-source'; '--audio-codec' = 'audio-codec'; '--no-audio' = 'no-audio'; '--no-audio-playback' = 'no-audio-playback'; '--no-playback' = 'no-playback'; '--require-audio' = 'require-audio' }
        foreach ($k in $names.Keys) { $r.flags[$k] = $text.Contains($names[$k]) }
        # A real scrcpy build always lists its core options. Then the audio flags above are trustworthy, true or false.
        $r.ok = ($text.Contains('record-format') -or $text.Contains('max-size'))
    } catch { $r.ok = $false }
    return $r
}

function Get-ScrcpyAudioCaps {
    param([bool]$Probe = $true)
    $scr = Get-ScrcpyPath
    $hit = $Shared.audioScrcpy
    if ($hit -and $hit.path -eq $scr) {
        $age = ((Get-Date) - $hit.at).TotalSeconds
        $ttl = $(if ($hit.ok) { 900 } else { 20 })
        if ($age -lt $ttl -or -not $Probe) { return $hit }
    }
    if (-not $Probe) { return @{ path = $scr; ok = $false; unknown = $true; version = ''; flags = @{}; error = 'Not checked yet.'; at = (Get-Date) } }
    $caps = @{ path = $scr; ok = $false; unknown = $false; version = ''; flags = @{}; error = ''; source = ''; at = (Get-Date) }
    $fc = Get-ScrcpyFileCaps $scr
    if ($fc.ok) {
        $caps.version = $fc.version; $caps.flags = $fc.flags; $caps.ok = $true; $caps.source = 'file'
    } else {
        try {
            $dir = ''
            if (Test-Path -LiteralPath $BundledDir) { $dir = $BundledDir }
            $v = Invoke-Native $scr '--version' 30 $dir 'scrcpy'
            if ((($v.out + "`n" + $v.err) -split "`r?`n")[0] -match 'scrcpy\s+([\d.]+)') { $caps.version = $Matches[1] }
            $h = Invoke-Native $scr '--help' 40 $dir 'scrcpy'
            $text = $h.out + "`n" + $h.err
            foreach ($f in @('--audio-dup', '--audio-source', '--audio-codec', '--no-audio', '--no-audio-playback', '--no-playback', '--require-audio')) {
                $caps.flags[$f] = [bool]([regex]::IsMatch($text, '(?m)(^|\s)' + [regex]::Escape($f) + '(\s|=|$)'))
            }
            $caps.ok = ($text.Length -gt 200)
            $caps.source = 'run'
            if (-not $caps.ok) { $caps.error = 'scrcpy did not print its option list.' }
        } catch { $caps.error = $_.Exception.Message }
        if (-not $caps.ok) { $caps.unknown = $true }
    }
    $Shared.audioScrcpy = $caps
    return $caps
}

function Get-DeviceAudioInfo {
    param([string]$Serial, [bool]$Probe = $true)
    if (-not $Shared.audioDev) { $Shared.audioDev = [hashtable]::Synchronized(@{}) }
    $key = $(if ($Serial) { $Serial } else { '_default' })
    $hit = $Shared.audioDev[$key]
    if ($hit) {
        $age = ((Get-Date) - $hit.at).TotalSeconds
        $ttl = $(if ($hit.ok) { 300 } else { 10 })
        if ($age -lt $ttl -or -not $Probe) { return $hit }
    }
    if (-not $Probe) { return @{ serial = $Serial; ok = $false; unknown = $true; sdk = 0; release = ''; model = ''; manufacturer = ''; error = 'Not read yet.'; at = (Get-Date) } }
    $info = @{ serial = $Serial; ok = $false; unknown = $false; sdk = 0; release = ''; model = ''; manufacturer = ''; error = ''; at = (Get-Date) }
    try {
        $r = Invoke-DeviceShell $Serial 'getprop ro.build.version.sdk; getprop ro.build.version.release; getprop ro.product.model; getprop ro.product.manufacturer' 8
        $lines = @(($r.out -split "`r?`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
        $n = 0
        if ($lines.Count -ge 1 -and [int]::TryParse($lines[0], [ref]$n) -and $n -gt 0) {
            $info.sdk = $n
            $info.ok = $true
            if ($lines.Count -ge 2) { $info.release = $lines[1] }
            if ($lines.Count -ge 3) { $info.model = $lines[2] }
            if ($lines.Count -ge 4) { $info.manufacturer = $lines[3] }
        } else { $info.error = 'The phone did not report its Android version.' }
    } catch { $info.error = $_.Exception.Message }
    $Shared.audioDev[$key] = $info
    return $info
}

function Resolve-AudioPlan {
    param($S, [string]$Mode, [string]$Serial, [bool]$Companion = $false, [bool]$Headless = $false, [bool]$Probe = $true)
    $req = Get-AudioModeId $S
    $isRec = ($Mode -eq 'record')
    $warn = New-Object System.Collections.ArrayList
    $argv = New-Object System.Collections.ArrayList
    $plan = @{ requested = $req; effective = $req; role = $Mode; companion = $Companion; headless = $Headless; capture = $false; playsOnPc = $false; recordsAudio = $false; phone = 'plays'; fallback = $false; reason = ''; note = ''; warnings = @(); argv = $argv; probed = $Probe }

    $want = $false
    $dup = $false
    switch ($req) {
        'record_only' { $want = $isRec; $dup = $true }
        'copy_play' { $want = $true; $dup = $true }
        'reroute' { $want = $true }
    }
    if ($req -eq 'record_only' -and -not $isRec) { $plan.note = 'This mirror has no sound. Recordings made in this mode carry the sound.' }

    # Is this phone and this scrcpy able to do it? Only checked when the plan will really be used.
    $problem = ''
    if ($want -and $req -eq 'reroute') {
        # 4.2.1: Reroute uses scrcpy's own default audio, exactly like 3.9.0, and nothing is checked before it starts.
        # The checks below ran a phone and scrcpy probe first, and any hiccup there turned Reroute into video only.
        # Only a phone already KNOWN (from the cache, no new adb call) to be older than Android 11 is refused.
        # Anything else is reported from scrcpy's own log once the session runs.
        $devQuick = Get-DeviceAudioInfo $Serial $false
        if ($devQuick.ok -and [int]$devQuick.sdk -gt 0 -and [int]$devQuick.sdk -lt 30) { $problem = 'The phone runs Android ' + $devQuick.release + '. Sending phone sound to the PC needs Android 11 or newer.' }
    }
    elseif ($want -and $Probe) {
        $caps = Get-ScrcpyAudioCaps $true
        $dev = Get-DeviceAudioInfo $Serial $true
        if (-not $caps.ok) {
            # The check itself failed. That is not proof that the mode cannot work, so it is tried anyway and the live
            # sound check reports the truth. (Before 4.2 this stopped every recording from starting.)
            [void]$warn.Add('The audio options of scrcpy could not be read (' + $caps.error + '), so this audio mode is being tried without a pre-check.')
        }
        elseif (-not $caps.flags['--audio-source']) { $problem = 'This scrcpy has no audio support.' }
        elseif ($dup -and -not $caps.flags['--audio-dup']) { $problem = 'This scrcpy cannot copy phone sound (--audio-dup). Use the bundled scrcpy.' }
        elseif ($req -eq 'record_only' -and $isRec -and -not $Headless -and -not $caps.flags['--no-audio-playback']) { $problem = 'This scrcpy cannot keep the PC silent while recording (--no-audio-playback).' }
        if ($problem -eq '') {
            if ($dev.ok -and $dev.sdk -lt 30) { $problem = 'The phone runs Android ' + $dev.release + '. Sending phone sound to the PC needs Android 11 or newer.' }
            elseif ($dev.ok -and $dup -and $dev.sdk -lt 33) { $problem = 'The phone runs Android ' + $dev.release + '. Copying phone sound while it keeps playing needs Android 13 or newer.' }
            elseif (-not $dev.ok) { [void]$warn.Add('The phone did not report its Android version (' + $dev.error + '), so support for this mode could not be checked.') }
        }
    }
    if ($problem -ne '') {
        $plan.effective = 'video_only'
        $plan.fallback = $true
        $plan.reason = $problem
        [void]$warn.Add($problem + ' This session has no phone sound.')
        $want = $false
    }

    if (-not $want) {
        [void]$argv.Add('--no-audio')
        $plan.warnings = @($warn)
        return $plan
    }

    $plan.capture = $true
    $viewer = -not $Headless
    if ($dup) {
        [void]$argv.Add('--audio-source=playback')
        [void]$argv.Add('--audio-dup')
        $plan.phone = 'plays'
        if ($req -eq 'record_only') {
            if ($viewer) { [void]$argv.Add('--no-audio-playback') }
            $plan.playsOnPc = $false
        } else { $plan.playsOnPc = $viewer }
    } else {
        $src = [string]$S.audioSource
        # 4.2.1: an empty or unknown saved value used to become '--audio-source=' and scrcpy refused to start. 3.9.0 never read this value.
        if (@($AudioSources | ForEach-Object { [string]$_.v }) -notcontains $src) { $src = 'output' }
        if ($src -eq 'playback') { [void]$warn.Add('Playback capture belongs to the two Copy modes. Reroute uses the phone sound output instead.'); $src = 'output' }
        if ($src -ne 'output') {
            [void]$argv.Add('--audio-source=' + $src)
            $plan.phone = 'plays'
            [void]$warn.Add('A microphone source is selected, so the phone keeps its own sound and nothing is rerouted.')
        } else { $plan.phone = 'silent' }
        $plan.playsOnPc = $viewer
        # The old rule, kept: a second capture of rerouted sound can silence the mirror on some phones.
        if ($Companion -and -not [bool]$S.companionAudio) {
            $argv.Clear()
            [void]$argv.Add('--no-audio')
            $plan.capture = $false
            $plan.phone = 'plays'
            $plan.playsOnPc = $false
            [void]$warn.Add('This recording has no sound: "Sound in companion recordings" is off, so the mirror keeps the sound.')
            $plan.warnings = @($warn)
            return $plan
        }
        if ($Companion) { [void]$warn.Add('The mirror and this recording both capture the rerouted sound. If the mirror goes quiet when recording starts, turn off "Sound in companion recordings".') }
    }

    $plan.recordsAudio = $isRec
    if ($isRec -and $Headless -and -not $Companion -and ($req -eq 'copy_play' -or $req -eq 'reroute')) {
        # Windowless background recording: there is no window to play the sound.
        [void]$warn.Add('Background recording has no window, so the sound is saved but not played on the PC.')
        if ($req -eq 'copy_play') { $plan.effective = 'record_only'; $plan.reason = 'Background recording has no window to play the sound on the PC.' }
        if ($req -eq 'reroute' -and $plan.phone -eq 'silent') { [void]$warn.Add('The phone is silent too, so nobody hears this sound while it records.') }
    }
    if ($isRec -and $Companion -and $req -eq 'copy_play') { $plan.note = 'The mirror window plays the sound on the PC. This recorder only saves it.' }

    if ($isRec -and $req -ne 'reroute' -and [bool]$S.audioRequire) {
        $c2 = Get-ScrcpyAudioCaps $Probe
        if ($c2.flags['--require-audio']) { [void]$argv.Add('--require-audio') }
        elseif ($Probe) { [void]$warn.Add('This scrcpy cannot stop a recording when sound capture fails (--require-audio).') }
    }
    $codec = [string]$S.audioCodec
    if ($isRec) { $codec = [string]$S.recordAudioCodec }
    if ($codec -ne '' -and (@($AudioCodecs | ForEach-Object { [string]$_.v }) -contains $codec)) { [void]$argv.Add('--audio-codec=' + $codec) }
    if ([int]$S.audioBitrate -gt 0) { [void]$argv.Add('--audio-bit-rate=' + $S.audioBitrate + 'K') }
    if ($plan.playsOnPc) {
        # 4.3.0: the sound is played on this PC, so give it a little more room than scrcpy's tight defaults (50 ms and 5 ms).
        # A bigger buffer only adds delay to the mirror's sound. It never lowers the quality of the sound.
        $abuf = [int]$S.audioBuffer
        if ($abuf -le 0) { $abuf = 100 }
        [void]$argv.Add('--audio-buffer=' + $abuf)
        $obuf = [int]$S.audioOutputBuffer
        if ($obuf -le 0) { $obuf = 20 }
        [void]$argv.Add('--audio-output-buffer=' + $obuf)
    }
    elseif ([int]$S.audioBuffer -gt 0) { [void]$argv.Add('--audio-buffer=' + $S.audioBuffer) }
    $plan.warnings = @($warn)
    return $plan
}

# A short, safe copy of a plan for the session file and the dashboard.
function ConvertTo-AudioView {
    param($Plan)
    return @{ requested = [string]$Plan.requested; effective = [string]$Plan.effective; capture = [bool]$Plan.capture; playsOnPc = [bool]$Plan.playsOnPc; recordsAudio = [bool]$Plan.recordsAudio; phone = [string]$Plan.phone; fallback = [bool]$Plan.fallback; reason = [string]$Plan.reason; note = [string]$Plan.note; warnings = @($Plan.warnings) }
}

# Looks for audio trouble in a scrcpy session log. Returns the offending line or an empty string.
function Get-AudioLogProblem {
    param([string]$LogPath)
    try {
        if (-not $LogPath -or -not (Test-Path -LiteralPath $LogPath)) { return '' }
        # One quick read, no retries: this runs on the dashboard status path and must never wait.
        $fs = New-Object IO.FileStream($LogPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try {
            if ($fs.Length -gt 60000) { $fs.Position = $fs.Length - 60000 }
            $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8, $true)
            $text = [string]$sr.ReadToEnd()
        } finally { $fs.Dispose() }
        foreach ($line in ($text -split "`r?`n")) {
            $t = $line.Trim()
            if ($t -eq '' -or $t -match 'No audio playback, no recording') { continue }
            if ($t -match '(?i)audio.{0,60}(fail|error|disabled|not supported|unsupported|cannot|could not|unavailable)' -or $t -match '(?i)(could not|cannot|failed to|unable to).{0,60}audio' -or $t -match "(?i)stream explicitly disabled") {
                return ($t -replace '^\s*(ERROR|WARN|INFO)\s*:\s*', '')
            }
        }
    } catch {}
    return ''
}

# State of the sound of a running session: off, starting, running (no error seen), failed.
# 'running' means scrcpy reported no audio error. It does not prove the sound is audible; Test-RecordingAudio does that.
function Get-SessionAudioState {
    param($S)
    $a = Get-Prop $S 'audio' $null
    if ($null -eq $a -or -not [bool](Get-Prop $a 'capture' $false)) { return @{ state = 'off'; detail = '' } }
    $problem = Get-AudioLogProblem ([string](Get-Prop $S 'log' ''))
    if ($problem -ne '') { return @{ state = 'failed'; detail = $problem } }
    $age = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long](Get-Prop $S 'startedMs' 0)) / 1000
    if ($age -lt 4) { return @{ state = 'starting'; detail = '' } }
    return @{ state = 'running'; detail = '' }
}

# Called for live sessions: reports an audio failure once, as soon as scrcpy logs it.
function Test-AudioSessionHealth {
    param($S)
    $a = Get-Prop $S 'audio' $null
    if ($null -eq $a -or -not [bool](Get-Prop $a 'capture' $false)) { return }
    if (-not $Shared.audioFlag) { $Shared.audioFlag = [hashtable]::Synchronized(@{}) }
    $id = [string]$S.id
    if ($Shared.audioFlag[$id]) { return }
    $age = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$S.startedMs) / 1000
    if ($age -gt 120) { return }
    $problem = Get-AudioLogProblem ([string]$S.log)
    if ($problem -eq '') { return }
    $Shared.audioFlag[$id] = $true
    $label = $(if ($S.mode -eq 'record') { 'Recording' } else { 'Mirror' })
    Add-Activity 'error' ($label + ' sound problem: ' + $problem)
    Add-Event 'audio' @{ session = $id; mode = [string]$S.mode; problem = $problem }
}

# ---------------------------------------------------------------------------
# Does a saved recording really contain sound? (container check, optional ffmpeg level check)
# ---------------------------------------------------------------------------
function Read-EbmlNumber {
    param([IO.Stream]$Fs, [bool]$KeepMarker)
    $b = $Fs.ReadByte()
    if ($b -lt 0) { return $null }
    $len = 1
    $mask = 0x80
    while ($len -le 8 -and (($b -band $mask) -eq 0)) { $len++; $mask = $mask -shr 1 }
    if ($len -gt 8) { return $null }
    $low = $b -band ($mask - 1)
    if ($KeepMarker) { $v = [long]$b } else { $v = [long]$low }
    $ones = ((-not $KeepMarker) -and ($low -eq ($mask - 1)))
    for ($i = 1; $i -lt $len; $i++) {
        $n = $Fs.ReadByte()
        if ($n -lt 0) { return $null }
        $v = ($v -shl 8) -bor $n
        if ($n -ne 255) { $ones = $false }
    }
    return @{ v = $v; len = $len; unknown = $ones }
}

function Read-BigEndian {
    param([IO.Stream]$Fs, [int]$Count)
    $v = [long]0
    for ($i = 0; $i -lt $Count; $i++) {
        $n = $Fs.ReadByte()
        if ($n -lt 0) { return -1 }
        $v = ($v -shl 8) -bor $n
    }
    return $v
}

# Matroska (.mkv). Walks the track list and counts the audio blocks (first part only when the file is long).
function Get-MkvAudioInfo {
    param([string]$Path, [int]$BudgetMs = 8000, [int]$MaxAudioBlocks = 6000)
    $info = @{ format = 'mkv'; ok = $false; videoTracks = 0; audioTracks = 0; audioCodec = ''; audioBlocks = 0; audioBytes = [long]0; scannedMs = [long]0; sampled = $false }
    $masters = @(0x18538067, 0x1F43B675, 0xA0, 0x1654AE6B, 0xAE)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete), 65536)
    try {
        $tracks = @{}
        $cur = $null
        $clusterTc = [long]0
        $lastMs = [long]0
        while ($true) {
            if ($sw.ElapsedMilliseconds -gt $BudgetMs -or $info.audioBlocks -ge $MaxAudioBlocks) { $info.sampled = $true; break }
            $idr = Read-EbmlNumber $fs $true
            if ($null -eq $idr -or $idr.len -gt 4) { break }
            $szr = Read-EbmlNumber $fs $false
            if ($null -eq $szr) { break }
            $id = $idr.v
            if ($masters -contains $id) {
                if ($id -eq 0xAE) { $cur = @{ num = 0; type = 0; codec = '' } }
                continue
            }
            if ($szr.unknown) { break }
            $sz = $szr.v
            $pos = $fs.Position
            if (($id -eq 0xD7 -or $id -eq 0x83 -or $id -eq 0xE7) -and $sz -ge 1 -and $sz -le 8) {
                $val = Read-BigEndian $fs ([int]$sz)
                if ($id -eq 0xE7) { $clusterTc = $val }
                elseif ($null -ne $cur) { if ($id -eq 0xD7) { $cur.num = [int]$val } else { $cur.type = [int]$val } }
            } elseif ($id -eq 0x86 -and $null -ne $cur -and $sz -le 64) {
                $buf = New-Object byte[] ([int]$sz)
                [void]$fs.Read($buf, 0, [int]$sz)
                $cur.codec = [Text.Encoding]::ASCII.GetString($buf)
            } elseif ($id -eq 0xA3 -or $id -eq 0xA1) {
                $tn = Read-EbmlNumber $fs $false
                if ($null -ne $tn) {
                    $t = $tracks[[int]$tn.v]
                    if ($t -and $t.type -eq 2) {
                        $hi = $fs.ReadByte()
                        $lo = $fs.ReadByte()
                        $rel = ($hi -shl 8) -bor $lo
                        if ($rel -ge 32768) { $rel -= 65536 }
                        $info.audioBlocks++
                        $info.audioBytes += $sz
                        $lastMs = $clusterTc + $rel
                    }
                }
            }
            if ($null -ne $cur -and $cur.num -gt 0 -and $cur.type -gt 0 -and -not $tracks.ContainsKey([int]$cur.num)) { $tracks[[int]$cur.num] = $cur }
            $fs.Position = $pos + $sz
        }
        foreach ($t in $tracks.Values) {
            if ($t.type -eq 1) { $info.videoTracks++ }
            if ($t.type -eq 2) { $info.audioTracks++; if ($info.audioCodec -eq '') { $info.audioCodec = [string]$t.codec } }
        }
        $info.scannedMs = $lastMs
        $info.ok = ($tracks.Count -gt 0)
    } finally { $fs.Dispose() }
    return $info
}

# MP4. Reads the track list from the moov box (an MP4 that was not closed cleanly has none).
function Read-Mp4Boxes {
    param([IO.Stream]$Fs, [long]$Pos, [long]$Limit, $State, [int]$Depth)
    $containers = @('moov', 'trak', 'mdia', 'minf', 'stbl')
    while (($Pos + 8) -le $Limit -and $Depth -lt 8) {
        if ($State.sw.ElapsedMilliseconds -gt $State.budget) { $State.sampled = $true; return }
        $Fs.Position = $Pos
        $size = Read-BigEndian $Fs 4
        $tb = New-Object byte[] 4
        [void]$Fs.Read($tb, 0, 4)
        $type = [Text.Encoding]::ASCII.GetString($tb)
        $hdr = 8
        if ($size -eq 1) { $size = Read-BigEndian $Fs 8; $hdr = 16 }
        elseif ($size -eq 0) { $size = $Limit - $Pos }
        if ($size -lt $hdr) { return }
        $body = $Pos + $hdr
        $end = [math]::Min($Pos + $size, $Limit)
        if ($type -eq 'moov') { $State.moov = $true }
        if ($type -eq 'trak') { $State.cur = @{ handler = ''; timescale = 0; duration = [long]0; samples = [long]0; bytes = [long]0 }; $State.tracks += , $State.cur }
        if ($containers -contains $type) { Read-Mp4Boxes $Fs $body $end $State ($Depth + 1) }
        elseif ($type -eq 'hdlr' -and $null -ne $State.cur) {
            $Fs.Position = $body + 8
            $hb = New-Object byte[] 4
            [void]$Fs.Read($hb, 0, 4)
            $State.cur.handler = [Text.Encoding]::ASCII.GetString($hb)
        } elseif ($type -eq 'mdhd' -and $null -ne $State.cur) {
            $Fs.Position = $body
            $ver = $Fs.ReadByte()
            $Fs.Position = $body + 4
            if ($ver -eq 1) { $Fs.Position = $body + 20; $State.cur.timescale = [long](Read-BigEndian $Fs 4); $State.cur.duration = [long](Read-BigEndian $Fs 8) }
            else { $Fs.Position = $body + 12; $State.cur.timescale = [long](Read-BigEndian $Fs 4); $State.cur.duration = [long](Read-BigEndian $Fs 4) }
        } elseif ($type -eq 'stsz' -and $null -ne $State.cur) {
            $Fs.Position = $body + 4
            $each = Read-BigEndian $Fs 4
            $count = Read-BigEndian $Fs 4
            $State.cur.samples = $count
            if ($each -gt 0) { $State.cur.bytes = $each * $count }
            elseif ($State.cur.handler -eq 'soun') {
                $total = [long]0
                $left = $count
                while ($left -gt 0) {
                    $n = [int][math]::Min($left, 16384)
                    $buf = New-Object byte[] (4 * $n)
                    $got = $Fs.Read($buf, 0, $buf.Length)
                    if ($got -lt $buf.Length) { break }
                    for ($i = 0; $i -lt $n; $i++) { $o = 4 * $i; $total += ([long]$buf[$o] * 16777216) + ([long]$buf[$o + 1] * 65536) + ([long]$buf[$o + 2] * 256) + [long]$buf[$o + 3] }
                    $left -= $n
                }
                $State.cur.bytes = $total
            }
        }
        $Pos = $Pos + $size
    }
}

function Get-Mp4AudioInfo {
    param([string]$Path, [int]$BudgetMs = 8000)
    $info = @{ format = 'mp4'; ok = $false; videoTracks = 0; audioTracks = 0; audioCodec = ''; audioBlocks = 0; audioBytes = [long]0; scannedMs = [long]0; sampled = $false }
    $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete), 65536)
    try {
        $state = @{ moov = $false; cur = $null; tracks = @(); sw = [Diagnostics.Stopwatch]::StartNew(); budget = $BudgetMs; sampled = $false }
        Read-Mp4Boxes $fs 0 $fs.Length $state 0
        $info.ok = [bool]$state.moov
        $info.sampled = [bool]$state.sampled
        foreach ($t in $state.tracks) {
            if ($t.handler -eq 'vide') { $info.videoTracks++ }
            if ($t.handler -eq 'soun') {
                $info.audioTracks++
                $info.audioBlocks += $t.samples
                $info.audioBytes += $t.bytes
                if ($t.timescale -gt 0) { $info.scannedMs = [long](1000 * $t.duration / $t.timescale) }
            }
        }
    } finally { $fs.Dispose() }
    return $info
}

# Full report for one recording. $Deep also decodes the sound with ffmpeg, when ffmpeg is available.
#   state: no_audio   the file has no sound track
#          silent_hint a sound track exists but carries almost no data (likely silence)
#          present    a sound track with data exists (loudness not measured)
#          audible    ffmpeg measured sound above the silence floor
#          silent     ffmpeg measured only silence
#          unreadable the container could not be read (for example an MP4 that was not closed cleanly)
function Test-RecordingAudio {
    param([string]$Path, [bool]$Deep = $false)
    $name = [IO.Path]::GetFileName($Path)
    $rep = @{ file = $name; state = 'unreadable'; verified = $false; summary = ''; format = ''; audioTracks = 0; audioCodec = ''; audioBlocks = 0; audioKbps = 0; checkedSeconds = 0; sampled = $false; level = $null }
    $ext = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    $info = $null
    try {
        if ($ext -eq '.mkv') { $info = Get-MkvAudioInfo $Path }
        elseif ($ext -eq '.mp4') { $info = Get-Mp4AudioInfo $Path }
        else { $rep.summary = 'Only MKV and MP4 recordings can be checked.'; return $rep }
    } catch { $rep.summary = 'The file could not be read: ' + $_.Exception.Message; return $rep }
    $rep.format = $info.format
    if (-not $info.ok) {
        $rep.summary = $(if ($ext -eq '.mp4') { 'This MP4 has no track list. It was probably not closed cleanly, so it cannot be checked. MKV survives forced stops.' } else { 'The file has no readable track list.' })
        return $rep
    }
    $rep.audioTracks = [int]$info.audioTracks
    $rep.audioCodec = [string]$info.audioCodec
    $rep.audioBlocks = [long]$info.audioBlocks
    $rep.sampled = [bool]$info.sampled
    $secs = [double]$info.scannedMs / 1000
    $rep.checkedSeconds = [math]::Round($secs, 1)
    if ($secs -gt 0) { $rep.audioKbps = [math]::Round(([double]$info.audioBytes * 8 / $secs) / 1000, 1) }
    if ($info.audioTracks -eq 0) {
        $rep.state = 'no_audio'
        $rep.summary = 'This recording has no sound track.'
    } elseif ($info.audioBlocks -le 0) {
        $rep.state = 'no_audio'
        $rep.summary = 'The file declares a sound track but holds no sound data.'
    } else {
        $avg = [double]$info.audioBytes / [double]$info.audioBlocks
        if ($avg -lt 24) {
            $rep.state = 'silent_hint'
            $rep.summary = 'A sound track exists but carries almost no data, which usually means silence.'
        } else {
            $rep.state = 'present'
            $rep.summary = 'A sound track with data is saved in this recording. Loudness was not measured.'
        }
    }
    if ($Deep -and $rep.state -ne 'no_audio') {
        $ff = Get-FfmpegPath
        if ($ff -eq '') { $rep.summary += ' Install ffmpeg (core\ffmpeg) to measure the loudness.' }
        else {
            try {
                $r = Invoke-Native $ff ('-hide_banner -nostats -i "' + $Path + '" -vn -af volumedetect -f null -') 120
                $text = $r.out + "`n" + $r.err
                if ($text -match 'max_volume:\s*(-?[\d.]+)\s*dB') {
                    $mx = [double]$Matches[1]
                    $mean = $null
                    if ($text -match 'mean_volume:\s*(-?[\d.]+)\s*dB') { $mean = [double]$Matches[1] }
                    $rep.level = @{ maxDb = $mx; meanDb = $mean }
                    $rep.verified = $true
                    if ($mx -gt -60) { $rep.state = 'audible'; $rep.summary = 'Verified with ffmpeg: the recording has audible sound (peak ' + $mx + ' dB).' }
                    else { $rep.state = 'silent'; $rep.summary = 'Verified with ffmpeg: the sound track is silent (peak ' + $mx + ' dB). Audio capture produced no sound.' }
                } else { $rep.summary += ' ffmpeg could not decode the sound.' }
            } catch { $rep.summary += ' The ffmpeg check failed: ' + $_.Exception.Message }
        }
    }
    return $rep
}

# ---------------------------------------------------------------------------
# Streaming (OBS). DROID ADB cannot configure OBS. It reports what the chosen audio mode allows OBS to hear
# and what must be set up in OBS and Windows. The plan never changes the phone, the mirror or a recording.
# ---------------------------------------------------------------------------
function Get-StreamAudioPlan {
    param($S)
    $mode = Get-AudioModeId $S
    $plan = [string]$S.streamAudio
    if ($StreamAudioIds -notcontains $plan) { $plan = 'none' }
    $pcPlays = ($mode -eq 'copy_play' -or $mode -eq 'reroute')
    $r = @{ plan = $plan; mode = $mode; status = 'ok'; headline = ''; steps = @(); notes = @() }
    switch ($plan) {
        'none' {
            $r.headline = 'OBS takes the mirror video only. No game sound in the stream.'
            $r.steps = @(('In OBS, add the mirror window as a Window Capture source (the window titled "' + [string]$S.windowTitle + '").'), 'Do not add an audio source for the game.')
            if ($pcPlays) {
                $r.status = 'check'
                $r.notes = @('This audio mode plays the game on the PC. If OBS has Desktop Audio switched on, the game will be in the stream. Mute Desktop Audio in OBS, or choose Video only or Copy to recording.')
            }
        }
        'listen' {
            if ($pcPlays) {
                $r.headline = 'You hear the game on the PC and OBS can capture it.'
                $r.steps = @('In OBS, add ONE audio source: Application Audio Capture (BETA) set to the scrcpy window, or Desktop Audio. Not both, or the stream has the game twice.', 'Keep Audio Monitoring off for that source if you already hear the game through Windows.')
            } else {
                $r.status = 'conflict'
                $r.headline = 'This audio mode does not play the game on the PC, so you cannot listen and OBS cannot capture it.'
                $r.notes = @('Switch to Copy and play on PC (the phone also keeps playing and the recording gets the sound) or Reroute audio to PC.')
            }
        }
        'silent_pc' {
            if ($pcPlays) {
                $r.status = 'setup'
                $r.headline = 'OBS can capture the game while the PC speakers stay quiet, but this needs a Windows audio setup.'
                $r.steps = @('Windows can only be silent and still pass sound to OBS if the sound goes to an output you are not listening to. Open Settings, System, Sound, Volume mixer (App volume and device preferences) and send scrcpy.exe to a different output: a virtual audio cable you already use, or headphones you are not wearing.', 'In OBS, capture that output with Audio Output Capture. Or add Application Audio Capture (BETA) for the scrcpy window.', 'Check the OBS meter while the game plays. If the meter stays flat, this route does not work on your PC.')
                $r.notes = @('DROID ADB cannot silence your speakers by itself and does not install any audio driver. Muting scrcpy in the Volume mixer may also silence OBS capture; test it before going live.')
            } else {
                $r.status = 'conflict'
                $r.headline = 'This audio mode keeps the PC silent because the mirror plays no sound, so OBS has nothing to capture.'
                $r.notes = @('For a silent PC with sound in OBS, use Copy and play on PC and send scrcpy.exe to an output you are not listening to (see the steps for this plan). That also keeps the sound in your recording.')
            }
        }
    }
    return $r
}

# Read-only look at the Windows audio setup, for the streaming section. Nothing is changed.
function Get-AudioEnvironment {
    $e = @{ windows = $OnWindows; build = 0; appAudioCapture = $false; obsRunning = $false; obsProcesses = @(); devices = @(); virtualHints = @(); scrcpyWindows = @(); notes = @() }
    if (-not $OnWindows) { $e.notes = @('The Windows audio check only runs on Windows.'); return $e }
    try { $e.build = [int][Environment]::OSVersion.Version.Build } catch {}
    $e.appAudioCapture = ($e.build -ge 19041)
    try {
        $obs = @(Get-Process -Name 'obs64', 'obs32', 'obs' -ErrorAction SilentlyContinue)
        if ($obs.Count -gt 0) { $e.obsRunning = $true; $e.obsProcesses = @($obs | ForEach-Object { $_.ProcessName + ' (' + $_.Id + ')' }) }
    } catch {}
    try {
        $devs = @(Get-CimInstance Win32_SoundDevice -ErrorAction Stop | ForEach-Object { [string]$_.Name } | Where-Object { $_ })
        $e.devices = @($devs)
        $e.virtualHints = @($devs | Where-Object { $_ -match '(?i)virtual|cable|vb-audio|voicemeeter|stereo mix|loopback' })
    } catch {}
    try {
        $e.scrcpyWindows = @(Get-Process -Name 'scrcpy' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { @{ pid = $_.Id; title = [string]$_.MainWindowTitle } })
    } catch {}
    if (-not $e.appAudioCapture) { $e.notes += 'Application Audio Capture in OBS needs Windows 10 version 2004 or newer. Use Audio Output Capture instead.' }
    return $e
}

# ---------------------------------------------------------------------------
# Building the scrcpy command line
# ---------------------------------------------------------------------------
# ---------- 4.7.0: window shape (tablet and PC view) ----------
# The mirror and record window is made tablet or PC shaped. The phone is not touched and no second screen is made.
$ShapeFile = Join-Path $ConfigDir 'shape-restore.json'
function Get-ShapeSpec {
    param($S)
    $size = [string]$S.shapeSize
    if ($size -eq '' -or $size -eq 'phone') { return $null }
    $w = 0
    $h = 0
    if ($size -eq 'custom') { $w = [int]$S.shapeW; $h = [int]$S.shapeH }
    elseif ($size -match '^(\d{3,4})x(\d{3,4})$') { $w = [int]$Matches[1]; $h = [int]$Matches[2] }
    if ($w -lt 320 -or $h -lt 320 -or $w -gt 7680 -or $h -gt 7680) { return $null }
    return @{ w = $w; h = $h }
}
function Initialize-WindowApi {
    if ('DroidWin' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DroidWin {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    public static bool SetClient(IntPtr h, int cw, int ch, out int rw, out int rh) {
        rw = 0; rh = 0;
        if (IsIconic(h) || IsZoomed(h)) ShowWindow(h, 9);
        RECT w, c;
        if (!GetWindowRect(h, out w) || !GetClientRect(h, out c)) return false;
        int dw = (w.R - w.L) - (c.R - c.L), dh = (w.B - w.T) - (c.B - c.T);
        MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        IntPtr m = MonitorFromWindow(h, 2);
        int availW = 100000, availH = 100000, wl = 0, wt = 0, wr = 100000, wb = 100000;
        if (m != IntPtr.Zero && GetMonitorInfo(m, ref mi)) { wl = mi.rcWork.L; wt = mi.rcWork.T; wr = mi.rcWork.R; wb = mi.rcWork.B; availW = wr - wl; availH = wb - wt; }
        double s = Math.Min(1.0, Math.Min((availW - dw) / (double)cw, (availH - dh) / (double)ch));
        if (s <= 0) s = 1.0;
        rw = (int)Math.Floor(cw * s); rh = (int)Math.Floor(ch * s);
        int ow = rw + dw, oh = rh + dh;
        int x = Math.Max(wl, Math.Min(w.L, wr - ow)), y = Math.Max(wt, Math.Min(w.T, wb - oh));
        return SetWindowPos(h, IntPtr.Zero, x, y, ow, oh, 0x0004 | 0x0010);
    }
}
'@
}
function Get-WorkArea {
    if ($Shared.workArea) { return $Shared.workArea }
    $wa = @{ w = 1600; h = 900 }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $r = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $wa = @{ w = [int]$r.Width; h = [int]$r.Height }
    } catch { }
    $Shared.workArea = $wa
    return $wa
}
# size the window will open at: the chosen shape, scaled down (same shape) so it fits on the screen of this PC
function Get-ShapeWindowSize {
    param($Spec)
    $wa = Get-WorkArea
    $sc = [math]::Min(1.0, [math]::Min(($wa.w - 24) / [double]$Spec.w, ($wa.h - 64) / [double]$Spec.h))
    if ($sc -le 0) { $sc = 1.0 }
    return @{ w = [int][math]::Floor($Spec.w * $sc); h = [int][math]::Floor($Spec.h * $sc) }
}
# change the shape of mirror or record windows that are already open (no restart, no change to the phone)
function Set-MirrorWindowShape {
    param([string]$Serial, [int]$W, [int]$H)
    Initialize-WindowApi
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue)
    $n = 0
    $last = ''
    foreach ($cp in $procs) {
        if ($Serial -and $procs.Count -gt 1 -and $cp.CommandLine -and ($cp.CommandLine -notmatch [regex]::Escape($Serial))) { continue }
        $pr = Get-Process -Id ([int]$cp.ProcessId) -ErrorAction SilentlyContinue
        if (-not $pr -or $pr.MainWindowHandle -eq [IntPtr]::Zero) { continue }
        $rw = 0
        $rh = 0
        if ([DroidWin]::SetClient($pr.MainWindowHandle, $W, $H, [ref]$rw, [ref]$rh)) { $n++; $last = $rw.ToString() + 'x' + $rh.ToString() }
    }
    return @{ windows = $n; size = $last }
}

# older versions could leave a phone screen resized. This puts such a phone back once, and is then idle.
function Get-ShapeApplied {
    try {
        if (Test-Path -LiteralPath $ShapeFile) {
            $j = Get-Content -LiteralPath $ShapeFile -Raw | ConvertFrom-Json
            return @($j.serials | Where-Object { $_ } | ForEach-Object { [string]$_ })
        }
    } catch { }
    return @()
}
function Save-ShapeApplied {
    param([string[]]$Serials)
    try {
        if (@($Serials).Count -eq 0) { if (Test-Path -LiteralPath $ShapeFile) { Remove-Item -LiteralPath $ShapeFile -Force } }
        else { (@{ serials = @($Serials) } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $ShapeFile -Encoding ASCII }
    } catch { }
}
function Restore-PhoneShape {
    param([string]$Serial)
    try { [void](Invoke-DeviceShell $Serial 'wm size reset; wm density reset' 20) } catch { Write-BackendLog ('Could not put the screen size back: ' + $_.Exception.Message); return $false }
    Save-ShapeApplied @(Get-ShapeApplied | Where-Object { $_ -ne $Serial })
    Add-Activity 'system' 'The phone screen size was put back to normal.'
    return $true
}
function Invoke-ShapeRestore {
    $applied = @(Get-ShapeApplied)
    if ($applied.Count -eq 0) { return }
    $ready = @((Get-DeviceCache).devices | Where-Object { $_.state -eq 'device' } | ForEach-Object { [string]$_.id })
    foreach ($serial in $applied) {
        if ($ready -notcontains $serial) { continue }
        [void](Restore-PhoneShape $serial)
    }
}

function New-ScrcpyArgs {
    param($S, [string]$Mode, [string]$Serial, [string]$OutFile, [hashtable]$Once, [hashtable]$PlanSink = $null, [bool]$Probe = $true)
    Test-Serial $Serial
    if (-not $Once) { $Once = @{} }
    $companion = [bool]$Once.companion
    $headless = ($Mode -eq 'record' -and ([bool]$S.recordWindowless -or $companion))
    $a = New-Object System.Collections.ArrayList
    if ($Serial) { [void]$a.Add('-s ' + $Serial) }
    # video
    if ($S.source -eq 'camera') {
        [void]$a.Add('--video-source=camera')
        if ($S.cameraId -ne '') { [void]$a.Add('--camera-id=' + $S.cameraId) } elseif ($S.cameraFacing -ne '') { [void]$a.Add('--camera-facing=' + $S.cameraFacing) }
        if ($S.cameraSize -ne '') { [void]$a.Add('--camera-size=' + $S.cameraSize) }
    } else {
        if ($S.virtualDisplay -and -not $companion) {
            if ($S.virtualDisplaySize -ne '') { [void]$a.Add('--new-display=' + $S.virtualDisplaySize) } else { [void]$a.Add('--new-display') }
            if ($Once.startApp) { [void]$a.Add('--start-app=' + $Once.startApp) }
        } else {
            if ($S.displayId -gt 0) { [void]$a.Add('--display-id=' + $S.displayId) }
            if ($Once.startApp -and -not $companion) { [void]$a.Add('--start-app=' + $Once.startApp) }
        }
        if ($S.crop -ne '') { [void]$a.Add('--crop=' + $S.crop) }
    }
    # 4.3.0: recordings have their own quality (high by default). The mirror keeps the Video settings.
    $qSize = [int]$S.maxSize
    $qFps = [int]$S.maxFps
    $qMbps = [int]$S.bitrateMbps
    if ($Mode -eq 'record' -and [bool]$S.recordOwnQuality) {
        $qSize = [int]$S.recordMaxSize
        $qFps = [int]$S.recordMaxFps
        $qMbps = [int]$S.recordBitrateMbps
    }
    if ($qSize -gt 0) { [void]$a.Add('--max-size=' + $qSize) }
    [void]$a.Add('--max-fps=' + $qFps)
    [void]$a.Add('--video-bit-rate=' + $qMbps + 'M')
    [void]$a.Add('--video-codec=' + $S.codec)
    if ($S.videoEncoder -ne '') { [void]$a.Add('--video-encoder=' + $S.videoEncoder) }
    if ($S.captureOrientation -ne '') { [void]$a.Add('--capture-orientation=' + $S.captureOrientation) }
    if ($S.videoBuffer -gt 0) { [void]$a.Add('--video-buffer=' + $S.videoBuffer) }
    # audio: the Audio mode controller decides every audio option (see Resolve-AudioPlan)
    $plan = Resolve-AudioPlan -S $S -Mode $Mode -Serial $Serial -Companion $companion -Headless $headless -Probe $Probe
    foreach ($x in $plan.argv) { [void]$a.Add([string]$x) }
    if ($null -ne $PlanSink) { $PlanSink.plan = $plan }
    # control
    if ($S.viewOnly -or $companion) { [void]$a.Add('--no-control') } else {
        if ($S.keyboard -ne '') { [void]$a.Add('--keyboard=' + $S.keyboard) }
        if ($S.mouse -ne '') { [void]$a.Add('--mouse=' + $S.mouse) }
        if ($S.noClipboardAutosync) { [void]$a.Add('--no-clipboard-autosync') }
        if ($S.legacyPaste) { [void]$a.Add('--legacy-paste') }
        if ($S.preferText) { [void]$a.Add('--prefer-text') }
    }
    if (-not $companion) {
        if ($S.stayAwake) { [void]$a.Add('--stay-awake') }
        if ($S.turnScreenOff) { [void]$a.Add('--turn-screen-off') }
        if ($S.showTouches) { [void]$a.Add('--show-touches') }
        if ($S.powerOffOnClose) { [void]$a.Add('--power-off-on-close') }
        if ($S.noPowerOn) { [void]$a.Add('--no-power-on') }
        if ($S.screenOffTimeout -gt 0) { [void]$a.Add('--screen-off-timeout=' + $S.screenOffTimeout) }
    }
    # window
    if ($headless) { [void]$a.Add('--no-playback') } else {
        $title = $S.windowTitle
        if ($title -eq '') { $title = 'DROID ADB' }
        [void]$a.Add('--window-title="' + $title + '"')
        if ($S.alwaysOnTop) { [void]$a.Add('--always-on-top') }
        if ($S.fullscreen) { [void]$a.Add('--fullscreen') }
        if ($S.borderless) { [void]$a.Add('--window-borderless') }
        $shapeSpec = Get-ShapeSpec $S
        if ($shapeSpec) {
            $ws = Get-ShapeWindowSize $shapeSpec
            [void]$a.Add('--window-width=' + $ws.w)
            [void]$a.Add('--window-height=' + $ws.h)
        } else {
            if ($S.windowWidth -gt 0) { [void]$a.Add('--window-width=' + $S.windowWidth) }
            if ($S.windowHeight -gt 0) { [void]$a.Add('--window-height=' + $S.windowHeight) }
        }
        if ($S.disableScreensaver) { [void]$a.Add('--disable-screensaver') }
        if ($S.noKeyRepeat) { [void]$a.Add('--no-key-repeat') }
        if ($S.printFps) { [void]$a.Add('--print-fps') }
    }
    if ($Mode -eq 'record') {
        [void]$a.Add('--record "' + $OutFile + '"')
        if ($S.recordTimeLimit -gt 0) { [void]$a.Add('--time-limit=' + $S.recordTimeLimit) }
    }
    if ($S.extraArgs.Trim() -ne '') { [void]$a.Add($S.extraArgs.Trim()) }
    return ($a -join ' ')
}

# Friendly name of the app in front on the phone (from the live readings), or an empty string.
function Get-AppLabel {
    param([string]$Package)
    if (-not $Package) { return '' }
    foreach ($pair in (([string](Get-Settings).appNames) -split ';')) {
        $kv = $pair.Split('=', 2)
        if ($kv.Count -eq 2 -and $kv[0].Trim() -eq $Package -and $kv[1].Trim() -ne '') { return $kv[1].Trim() }
    }
    $last = ($Package -split '\.')[-1]
    if ($last -in @('android', 'app', 'mobile', 'main')) { $parts = $Package -split '\.'; if ($parts.Count -ge 2) { $last = $parts[-2] } }
    return $last
}
# 4.4.0: short lowercase app name for file names (tiktok, instagram, pubgmobile). Names you set in Settings win,
# then a built-in list, then the last meaningful word of the package name.
function Get-CleanAppName {
    param([string]$Package)
    if (-not $Package) { return '' }
    $clean = { param($x) (([string]$x).ToLowerInvariant() -replace '[^a-z0-9]', '') }
    foreach ($pair in (([string](Get-Settings).appNames) -split ';')) {
        $kv = $pair.Split('=', 2)
        if ($kv.Count -eq 2 -and $kv[0].Trim() -eq $Package -and $kv[1].Trim() -ne '') { $c = & $clean $kv[1]; if ($c -ne '') { return $c } }
    }
    $known = @{
        'com.tencent.ig' = 'pubgmobile'; 'com.zhiliaoapp.musically' = 'tiktok'; 'com.ss.android.ugc.trill' = 'tiktok'; 'com.instagram.android' = 'instagram'
        'com.openai.chatgpt' = 'chatgpt'; 'com.whatsapp' = 'whatsapp'; 'com.google.android.youtube' = 'youtube'; 'com.facebook.katana' = 'facebook'
        'com.facebook.orca' = 'messenger'; 'org.telegram.messenger' = 'telegram'; 'com.snapchat.android' = 'snapchat'; 'com.spotify.music' = 'spotify'
        'com.netflix.mediaclient' = 'netflix'; 'com.android.chrome' = 'chrome'; 'com.twitter.android' = 'x'; 'com.reddit.frontpage' = 'reddit'
        'com.discord' = 'discord'; 'com.pinterest' = 'pinterest'; 'com.linkedin.android' = 'linkedin'; 'com.google.android.gm' = 'gmail'
        'com.google.android.apps.maps' = 'maps'; 'com.google.android.apps.photos' = 'photos'; 'com.android.vending' = 'playstore'
        'com.supercell.clashofclans' = 'clashofclans'; 'com.supercell.clashroyale' = 'clashroyale'; 'com.supercell.brawlstars' = 'brawlstars'
        'com.activision.callofduty.shooter' = 'codmobile'; 'com.garena.game.codm' = 'codmobile'; 'com.dts.freefireth' = 'freefire'; 'com.dts.freefiremax' = 'freefiremax'
        'com.mojang.minecraftpe' = 'minecraft'; 'com.roblox.client' = 'roblox'; 'com.kiloo.subwaysurf' = 'subwaysurfers'; 'com.miHoYo.GenshinImpact' = 'genshinimpact'
        'com.twitch.android.app' = 'twitch'; 'com.capcut.android' = 'capcut'; 'com.lemon.lvoverseas' = 'capcut'; 'com.android.settings' = 'settings'
        'com.android.camera' = 'camera'; 'com.google.android.dialer' = 'phone'; 'com.google.android.apps.messaging' = 'messages'
    }
    if ($known.ContainsKey($Package)) { return [string]$known[$Package] }
    $skip = @('com', 'org', 'net', 'android', 'google', 'app', 'apps', 'mobile', 'www', 'main', 'client')
    $parts = @($Package -split '\.' | Where-Object { $_ -ne '' -and $skip -notcontains $_ })
    if ($parts.Count -eq 0) { $parts = @($Package -split '\.') }
    $c = & $clean $parts[$parts.Count - 1]
    return $c
}
function Get-ForegroundLabel {
    param([string]$Serial)
    try {
        $l = $Shared.live
        if (-not $l) { return '' }
        $d = $null
        if ($Serial -and $l.ContainsKey($Serial)) { $d = $l[$Serial] }
        if (-not $d) { return '' }
        $pkg = [string]$d.fgPackage
        if ($pkg -match '^com\.android\.(launcher|systemui)|launcher|^com\.(miui|sec)\.[a-z.]*home$|^com\.transsion\.[a-z.]*launcher') { return '' }
        return (Get-CleanAppName $pkg)
    } catch { return '' }
}

function New-FileStem {
    param([string]$Template, [string]$Serial)
    $now = Get-Date
    $app = Get-ForegroundLabel $Serial
    $name = $Template.Replace('{date}', $now.ToString('yyyy-MM-dd')).Replace('{time}', $now.ToString('HH-mm-ss')).Replace('{serial}', $Serial).Replace('{model}', (Get-DeviceModelHint $Serial)).Replace('{app}', $app)
    if ($app -ne '' -and $Template.IndexOf('{app}') -lt 0 -and (Get-Settings).nameByApp) { $name = $name + '_' + $app }
    $name = ($name -replace '[^A-Za-z0-9._ \-]', '_').Trim()
    if ($name -eq '') { $name = 'Capture-' + $now.ToString('yyyyMMdd-HHmmss') }
    return $name
}

function New-UniquePath {
    param([string]$Dir, [string]$Stem, [string]$Ext)
    $path = Join-Path $Dir ($Stem + '.' + $Ext)
    $n = 2
    while (Test-Path -LiteralPath $path) { $path = Join-Path $Dir ($Stem + '-' + $n + '.' + $Ext); $n++ }
    return $path
}

# ---------------------------------------------------------------------------
# Sessions: scrcpy processes started by the toolkit. Tracked in Logs\sessions.json
# and checked by process id, so listing them never needs a slow system scan.
# ---------------------------------------------------------------------------
function Use-SessionFile {
    param([scriptblock]$Body)
    $mutex = New-Object Threading.Mutex($false, 'StkSessionsFile')
    $got = $false
    try {
        try { $got = $mutex.WaitOne(4000) } catch [Threading.AbandonedMutexException] { $got = $true }
        return (& $Body)
    } finally { if ($got) { try { $mutex.ReleaseMutex() } catch {} }; $mutex.Dispose() }
}

function Read-Sessions {
    return @(Get-JsonList $SessionsFile)
}
function Write-Sessions { param($List) Write-TextAtomic $SessionsFile (ConvertTo-Json -InputObject @($List) -Depth 4) }

function Test-ProcAlive {
    param([int]$ProcId, [long]$StartTicks)
    try {
        $p = [Diagnostics.Process]::GetProcessById($ProcId)
        if ($p.HasExited) { return $false }
        if ($StartTicks -gt 0) {
            try { if ([math]::Abs($p.StartTime.ToUniversalTime().Ticks - $StartTicks) -gt 100000000) { return $false } } catch {}
        }
        return $true
    } catch { return $false }
}

function Get-LogReason {
    param([string]$LogPath)
    try {
        $text = [IO.File]::ReadAllText($LogPath)
        if ($text.Length -gt 6000) { $text = $text.Substring($text.Length - 6000) }
        $lines = @($text -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
        $err = @($lines | Where-Object { $_ -match 'ERROR|error:|Could not|unauthorized|not found|failed' })
        if ($err.Count -gt 0) { return (($err[$err.Count - 1]) -replace '^\s*(ERROR|WARN|INFO)\s*:\s*', '').Trim() }
        if ($lines.Count -gt 0) { return $lines[$lines.Count - 1].Trim() }
    } catch {}
    return ''
}

# Returns sessions whose process is still running. Finished ones are removed and reported as events.
function Get-LiveSessions {
    return (Use-SessionFile {
            $all = @(Read-Sessions)
            $live = @()
            $dead = @()
            foreach ($s in $all) { if (Test-ProcAlive ([int]$s.pid) ([long]$s.procStart)) { $live += , $s } else { $dead += , $s } }
            if ($dead.Count -gt 0) {
                Write-Sessions $live
                foreach ($d in $dead) {
                    $secs = [int](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$d.startedMs) / 1000)
                    $size = [long]0
                    if ($d.path -and (Test-Path -LiteralPath $d.path)) { $size = [long](Get-Item -LiteralPath $d.path).Length }
                    $reason = Get-LogReason $d.log
                    $label = $(if ($d.mode -eq 'record') { 'Recording' } else { 'Mirror' })
                    if ($secs -lt 8 -and ($reason -ne '' -or $size -eq 0)) {
                        Add-Activity 'error' ($label + ' closed right away. ' + $reason)
                        Add-Event 'failed' @{ mode = $d.mode; reason = $reason; session = $d.id }
                    } else {
                        $txt = $label + ' ended after ' + [timespan]::FromSeconds($secs).ToString('hh\:mm\:ss')
                        if ($d.mode -eq 'record' -and $d.fileName) { $txt = 'Recording saved: ' + $d.fileName }
                        Add-Activity 'stop' $txt
                        $da = Get-Prop $d 'audio' $null
                        $expect = $false
                        $dmode = ''
                        if ($null -ne $da) { $expect = [bool](Get-Prop $da 'recordsAudio' $false); $dmode = [string](Get-Prop $da 'effective' '') }
                        $dprob = $(if ($expect) { Get-AudioLogProblem $d.log } else { '' })
                        if ($dprob -ne '' -and -not ($Shared.audioFlag -and $Shared.audioFlag[[string]$d.id])) { Add-Activity 'error' ('Recording sound problem: ' + $dprob) }
                        Add-Event 'ended' @{ mode = $d.mode; file = $d.fileName; size = $size; seconds = $secs; session = $d.id; audioExpected = $expect; audioMode = $dmode; audioProblem = $dprob }
                    }
                }
            }
            foreach ($l in $live) { try { Test-AudioSessionHealth $l } catch {} }
            return $live
        })
}

function Get-SessionView {
    param($S)
    $size = [long]0
    if ($S.mode -eq 'record' -and $S.path -and (Test-Path -LiteralPath $S.path)) { try { $size = [long](Get-Item -LiteralPath $S.path).Length } catch {} }
    return @{ id = $S.id; pid = [int]$S.pid; mode = $S.mode; recording = ($S.mode -eq 'record'); type = $(if ($S.mode -eq 'record') { 'Recording' } else { 'Mirroring' }); serial = [string]$S.serial; started = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$S.startedMs).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')); file = [string]$S.fileName; fileSize = $size; headless = [bool]$S.headless; companion = [bool]$S.companion; app = [string]$S.app; audio = (Get-Prop $S 'audio' $null); audioState = (Get-SessionAudioState $S) }
}

function Get-ChildPid {
    param([int]$ParentId)
    if ($OnWindows) {
        try {
            $kids = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $ParentId) -ErrorAction Stop)
            foreach ($k in $kids) { if ($k.Name -like 'scrcpy*') { return [int]$k.ProcessId } }
            if ($kids.Count -gt 0) { return [int]$kids[0].ProcessId }
        } catch {}
    }
    return $ParentId
}

function Send-CtrlC {
    param([int]$TargetPid)
    if (-not $OnWindows) { return }
    $code = 'Add-Type -Namespace K -Name N -MemberDefinition ''[DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p); [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool a); [DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g);''; [K.N]::FreeConsole() | Out-Null; if ([K.N]::AttachConsole(' + $TargetPid + ')) { [K.N]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null; [K.N]::GenerateConsoleCtrlEvent(0, 0) | Out-Null; Start-Sleep -Milliseconds 1500 }'
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    try { Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', $enc) -WindowStyle Hidden -Wait | Out-Null } catch {}
}

function Stop-ToolkitSession {
    param($Session, [int]$GraceSec = 4)
    $wrapper = [int]$Session.pid
    $child = Get-ChildPid $wrapper
    $how = 'graceful'
    if ($OnWindows) {
        $asked = $false
        try {
            $p = Get-Process -Id $child -ErrorAction Stop
            if ($p.MainWindowHandle -ne 0) { $asked = $p.CloseMainWindow() }
        } catch {}
        if (-not $asked) { Send-CtrlC $child }
    } else {
        try { & /bin/kill -TERM $child 2>$null } catch {}
    }
    $deadline = (Get-Date).AddSeconds($GraceSec)
    do { Start-Sleep -Milliseconds 200 } while ((Test-ProcAlive $wrapper ([long]$Session.procStart)) -and (Get-Date) -lt $deadline)
    if (Test-ProcAlive $wrapper ([long]$Session.procStart)) {
        $how = 'forced'
        if ($OnWindows) { try { & taskkill.exe /PID $wrapper /T /F 2>&1 | Out-Null } catch {} } else { try { & /bin/kill -KILL $child 2>$null; & /bin/kill -KILL $wrapper 2>$null } catch {} }
        Start-Sleep -Milliseconds 300
    }
    return $how
}

# Starts scrcpy detached, with output captured to a per-session log.
function Start-ToolkitScrcpy {
    param([string]$Mode, [string]$Serial, [hashtable]$Once)
    if ($Mode -notin @('mirror', 'record')) { Fail 'Unknown mode.' }
    if (-not $Once) { $Once = @{} }
    $scr = Get-ScrcpyPath
    if ($OnWindows -and -not (Test-Tool $scr)) { Fail 'scrcpy.exe was not found. Check the scrcpy executable setting or extract the full ZIP again.' }
    $settings = Get-Settings
    $companion = $false
    $mine = @(Get-LiveSessions | Where-Object { (-not $Serial) -or (-not $_.serial) -or ($_.serial -eq $Serial) })
    $viewer = @($mine | Where-Object { -not $_.headless })
    $recorder = @($mine | Where-Object { $_.mode -eq 'record' })
    if ($Mode -eq 'record') {
        if ($recorder.Count -gt 0) { Fail 'This phone is already being recorded. Stop that recording first.' }
        if ($viewer.Count -gt 0) {
            if ([string]$settings.recordWhileMirroring -eq 'block') { Fail 'A mirror window is open. Close it first, or set Record while mirroring to companion in Settings.' }
            $companion = $true
            $Once.companion = $true
        }
    } else {
        if ($viewer.Count -gt 0) { Fail 'A scrcpy window is already open for this phone. Stop it first.' }
    }
    $id = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $out = ''
    $fileName = ''
    if ($Mode -eq 'record') {
        $out = New-UniquePath (Get-Dir 'recordings') (New-FileStem $settings.recordTemplate $Serial) $settings.recordFormat
        $fileName = [IO.Path]::GetFileName($out)
    }
    $sink = @{}
    $argLine = New-ScrcpyArgs -S $settings -Mode $Mode -Serial $Serial -OutFile $out -Once $Once -PlanSink $sink
    $plan = $sink.plan
    if ($Mode -eq 'record' -and $plan.fallback -and [bool]$settings.audioRequire) {
        Fail ('Recording not started. ' + $plan.reason + ' Pick Video only in Settings, Audio, or switch off "Stop a recording if its sound cannot be captured".')
    }
    $log = Join-Path $LogDir ('session-' + $id + '.log')
    $psi = New-Object Diagnostics.ProcessStartInfo
    if ($OnWindows) {
        $psi.FileName = $env:ComSpec
        $psi.Arguments = '/d /c ""' + $scr + '" ' + $argLine + ' > "' + $log + '" 2>&1"'
    } else {
        $psi.FileName = '/bin/sh'
        [void]$psi.ArgumentList.Add('-c')
        [void]$psi.ArgumentList.Add('exec "' + $scr + '" ' + $argLine + ' > "' + $log + '" 2>&1')
    }
    if (Test-Path -LiteralPath $BundledDir) { $psi.WorkingDirectory = $BundledDir }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    if ([string]$settings.adbPath -ne '') { $psi.EnvironmentVariables['ADB'] = [string]$settings.adbPath }
    $brandDir = Join-Path (Join-Path $Root 'core') 'branding'
    if ((Test-Path -LiteralPath (Join-Path $brandDir 'scrcpy.png')) -and (Test-Path -LiteralPath (Join-Path $brandDir 'disconnected.png'))) { $psi.EnvironmentVariables['SCRCPY_ICON_DIR'] = $brandDir }
    $proc = [Diagnostics.Process]::Start($psi)
    $startTicks = [long]0
    try { $startTicks = $proc.StartTime.ToUniversalTime().Ticks } catch {}
    $session = @{ id = $id; pid = [int]$proc.Id; procStart = $startTicks; mode = $Mode; serial = $Serial; startedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); path = $out; fileName = $fileName; headless = ($Mode -eq 'record' -and ([bool]$settings.recordWindowless -or $companion)); companion = $companion; log = $log; app = [string]$Once.startApp; audio = (ConvertTo-AudioView $plan) }
    Use-SessionFile { $list = @(Read-Sessions); $list += , $session; Write-Sessions $list }
    # keep only the newest session logs
    try {
        $old = @(Get-ChildItem -LiteralPath $LogDir -Filter 'session-*.log' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip ([int]$settings.logRetention))
        foreach ($o in $old) { Remove-Item -LiteralPath $o.FullName -Force -ErrorAction SilentlyContinue }
    } catch {}
    return $session
}

# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------
$VideoPattern = '(?i)\.(mp4|mkv|gif)$'
$ImagePattern = '(?i)\.png$'

function Get-SafeFile {
    param([string]$Kind, [string]$Name)
    if ($Kind -eq 'screenshots') { $dir = Get-Dir 'screenshots'; $pattern = $ImagePattern }
    elseif ($Kind -eq 'recordings') { $dir = Get-Dir 'recordings'; $pattern = $VideoPattern }
    else { Fail 'Unknown library.' }
    if ([string]::IsNullOrWhiteSpace($Name) -or [IO.Path]::GetFileName($Name) -ne $Name -or $Name -notmatch $pattern) { Fail 'Choose a file from the library.' }
    $path = [IO.Path]::GetFullPath((Join-Path $dir $Name))
    $base = [IO.Path]::GetFullPath($dir).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { Fail 'Invalid file path.' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail 'That file no longer exists.' }
    return $path
}

function Test-InProgress {
    param([string]$FileName)
    foreach ($s in (Get-LiveSessions)) { if ($s.mode -eq 'record' -and $s.fileName -eq $FileName) { return $true } }
    return $false
}

function Get-Library {
    param([string]$Kind)
    if ($Kind -eq 'screenshots') { $dir = Get-Dir 'screenshots'; $ext = @('.png') } else { $Kind = 'recordings'; $dir = Get-Dir 'recordings'; $ext = @('.mp4', '.mkv', '.gif') }
    $live = @{}
    foreach ($s in (Get-LiveSessions)) { if ($s.fileName) { $live[$s.fileName] = $true } }
    $files = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension.ToLower() -in $ext } | Sort-Object LastWriteTime -Descending | ForEach-Object {
            @{ name = $_.Name; size = [long]$_.Length; modified = $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); live = [bool]$live.ContainsKey($_.Name) }
        })
    $total = [long]0
    foreach ($f in $files) { $total += [long]$f.size }
    return @{ kind = $Kind; dir = $dir; files = @($files); totalSize = $total; disk = (Get-DiskInfo $dir) }
}

function Get-OldFiles {
    param([string]$Kind, [int]$Days)
    $cutoff = (Get-Date).AddDays(-$Days)
    if ($Kind -eq 'screenshots') { $dir = Get-Dir 'screenshots'; $ext = @('.png') } else { $dir = Get-Dir 'recordings'; $ext = @('.mp4', '.mkv', '.gif') }
    return @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension.ToLower() -in $ext -and $_.LastWriteTime -lt $cutoff -and -not (Test-InProgress $_.Name) })
}


# ---------------------------------------------------------------------------
# Live phone readings (rotation, screen, battery, foreground app)
# ---------------------------------------------------------------------------
function Update-LiveTelemetry {
    param([string]$Serial, [bool]$WithForeground)
    $script = 'o=$(dumpsys input 2>/dev/null | grep -m3 -E ''SurfaceOrientation|orientation=''); echo @@R; echo $o; if [ -z "$o" ]; then echo @@D; dumpsys window displays 2>/dev/null | grep -m2 -oE ''mCurrentRotation=[A-Z_0-9]+|rotation=[0-9]''; fi; echo @@W; dumpsys power 2>/dev/null | grep -m1 -oE ''mWakefulness=[A-Za-z]+''; echo @@B; dumpsys battery 2>/dev/null'
    if ($WithForeground) { $script += '; echo @@F; dumpsys activity activities 2>/dev/null | grep -m2 -E ''ResumedActivity''' }
    $r = Invoke-DeviceShell $Serial $script 12
    $sections = @{ R = ''; D = ''; W = ''; B = ''; F = '' }
    $cur = ''
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^@@([RDWBF])\s*$') { $cur = $Matches[1]; continue }
        if ($cur) { $sections[$cur] += $line + "`n" }
    }
    $prev = $Shared.live[$Serial]
    $d = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rotation = -1; screenOn = $null; battery = -1; charging = $false; full = $false; tempC = $null; voltage = $null; power = ''; fgPackage = ''; fgActivity = '' }
    if ($prev) { $d.fgPackage = [string]$prev.fgPackage; $d.fgActivity = [string]$prev.fgActivity; if ([int]$prev.rotation -ge 0) { $d.rotation = [int]$prev.rotation } }
    if ($sections.R -match 'SurfaceOrientation:\s*(\d)') { $d.rotation = [int]$Matches[1] }
    elseif ($sections.R -match 'orientation=(\d)') { $d.rotation = [int]$Matches[1] }
    elseif ($sections.D -match 'mCurrentRotation=ROTATION_(\d+)') { $d.rotation = [int]([int]$Matches[1] / 90) }
    elseif ($sections.D -match 'rotation=(\d)') { $d.rotation = [int]$Matches[1] }
    if ($sections.W -match 'mWakefulness=(\w+)') { $d.screenOn = ($Matches[1] -eq 'Awake') }
    $t = $sections.B
    if ($t -match '(?m)^\s*level:\s*(\d+)') { $d.battery = [int]$Matches[1] }
    if ($t -match '(?m)^\s*status:\s*(\d+)') { $st = [int]$Matches[1]; $d.charging = ($st -eq 2); $d.full = ($st -eq 5) }
    if ($t -match '(?m)^\s*temperature:\s*(\d+)') { $d.tempC = [math]::Round([int]$Matches[1] / 10, 1) }
    if ($t -match '(?m)^\s*voltage:\s*(\d+)') { $d.voltage = [int]$Matches[1] }
    if ($t -match '(?m)^\s*AC powered:\s*true') { $d.power = 'AC' } elseif ($t -match '(?m)^\s*USB powered:\s*true') { $d.power = 'USB' } elseif ($t -match '(?m)^\s*Wireless powered:\s*true') { $d.power = 'Wireless' }
    if ($WithForeground) {
        $d.fgPackage = ''; $d.fgActivity = ''
        foreach ($line in ($sections.F -split "`n")) {
            if ($line -match '([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/(\.?[A-Za-z0-9_.$]+)') { $d.fgPackage = $Matches[1]; $d.fgActivity = $Matches[2]; break }
        }
    }
    $Shared.live[$Serial] = $d
}

# Runs adb and returns its raw standard output bytes (binary safe, no temp file).
function Invoke-AdbBytes {
    param([string]$ArgLine, [int]$TimeoutSec = 20)
    $adb = Get-AdbPath
    if ($OnWindows -and -not (Test-Tool $adb)) { Fail 'adb.exe was not found. Check the ADB executable setting or extract the full ZIP again.' }
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $adb
    $psi.Arguments = $ArgLine
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if (Test-Path -LiteralPath $BundledDir) { $psi.WorkingDirectory = $BundledDir }
    $p = [Diagnostics.Process]::Start($psi)
    $ms = New-Object IO.MemoryStream
    $copy = $p.StandardOutput.BaseStream.CopyToAsync($ms)
    $errTask = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch {}; Fail 'The phone did not answer in time. Check the cable, unlock the phone and try again.' }
    [void]$copy.Wait(8000)
    $e = ''
    try { if ($errTask.Wait(2000)) { $e = [string]$errTask.Result } } catch {}
    return @{ code = [int]$p.ExitCode; bytes = $ms.ToArray(); err = $e }
}
