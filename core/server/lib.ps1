# Scrcpy Toolkit shared library.
# Dot-sourced by server.ps1 (main thread and every worker runspace) and by core/scripts/launch.ps1.
# Keep this file ASCII only and compatible with Windows PowerShell 5.1 and PowerShell 7.

$ErrorActionPreference = 'Stop'
$ToolkitVersion = '2.2.0'
if (-not $global:StkRoot) { $global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$Root = $global:StkRoot
$OnWindows = ($env:OS -eq 'Windows_NT')
$ConfigDir = Join-Path $Root 'Config'
$LogDir = Join-Path $Root 'Logs'
$ConfigFile = Join-Path $ConfigDir 'settings.json'
$ProfilesFile = Join-Path $ConfigDir 'profiles.json'
$SessionsFile = Join-Path $LogDir 'sessions.json'
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
    param([string]$Key, [string]$Group, [string]$Type, $Default, [string]$Label, [string]$Help = '', $Min = $null, $Max = $null, $Choices = $null, $Picks = $null, [string]$Unit = '', $Show = $null, [string]$Pattern = '', [bool]$Restart = $false, [string]$Placeholder = '')
    return @{ key = $Key; group = $Group; type = $Type; default = $Default; label = $Label; help = $Help; min = $Min; max = $Max; choices = $Choices; picks = $Picks; unit = $Unit; show = $Show; pattern = $Pattern; restart = $Restart; placeholder = $Placeholder }
}

$SettingGroups = @(
    @{ id = 'video'; title = 'Video'; note = 'What scrcpy captures from the phone.' },
    @{ id = 'audio'; title = 'Audio'; note = 'Sound forwarding needs Android 11 or newer.' },
    @{ id = 'control'; title = 'Input and phone'; note = 'How the PC controls the phone while a window is open.' },
    @{ id = 'window'; title = 'Mirror window'; note = 'Look and behaviour of the scrcpy window.' },
    @{ id = 'recording'; title = 'Recording and screenshots'; note = 'File naming, format and limits.' },
    @{ id = 'files'; title = 'Folders and storage'; note = 'Leave a folder empty to use the default inside the toolkit.' },
    @{ id = 'toolkit'; title = 'Dashboard and backend'; note = 'Items marked restart apply the next time you run Launch.bat.' },
    @{ id = 'advanced'; title = 'Advanced'; note = 'Custom tools and raw scrcpy options.' }
)

$AudioSources = @((C 'output' 'Phone sound (output)'), (C 'playback' 'Playback capture'), (C 'mic' 'Microphone'), (C 'mic-unprocessed' 'Microphone (raw)'), (C 'mic-voice-communication' 'Microphone (voice call)'))
$AudioCodecs = @((C '' 'scrcpy default'), (C 'opus' 'Opus'), (C 'aac' 'AAC'), (C 'flac' 'FLAC'), (C 'raw' 'Raw'))
$InputModes = @((C '' 'Default'), (C 'sdk' 'Android SDK'), (C 'uhid' 'Simulated USB (uhid)'), (C 'aoa' 'USB accessory (aoa)'), (C 'disabled' 'Disabled'))
$Orientations = @((C '' 'Automatic'), (C '0' 'Natural'), (C '90' '90 degrees'), (C '180' '180 degrees'), (C '270' '270 degrees'), (C '@0' 'Lock natural'), (C '@90' 'Lock 90'), (C '@180' 'Lock 180'), (C '@270' 'Lock 270'))

$Schema = @(
    # video
    (F 'source' 'video' 'choice' 'display' 'Capture source' 'Mirror the screen, or stream the phone camera.' -Choices @((C 'display' 'Screen'), (C 'camera' 'Camera'))),
    (F 'maxSize' 'video' 'int' 1280 'Longest side' 'Pixels. 0 keeps the phone resolution.' -Min 0 -Max 8192 -Picks @(720, 1024, 1280, 1600, 1920, 0) -Unit 'px'),
    (F 'maxFps' 'video' 'int' 30 'Frame rate' 'Higher is smoother and uses more CPU.' -Min 1 -Max 240 -Picks @(15, 24, 30, 45, 60, 90, 120) -Unit 'fps'),
    (F 'bitrateMbps' 'video' 'int' 8 'Bitrate' 'Higher looks better and makes larger recordings.' -Min 1 -Max 200 -Picks @(2, 4, 8, 12, 16, 24) -Unit 'Mbps'),
    (F 'codec' 'video' 'choice' 'h264' 'Video codec' 'H.265 and AV1 make smaller files but need phone support.' -Choices @((C 'h264' 'H.264'), (C 'h265' 'H.265'), (C 'av1' 'AV1'))),
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
    # audio
    (F 'audio' 'audio' 'bool' $true 'Capture phone audio' 'Turn off if the phone is older than Android 11 or audio fails.'),
    (F 'audioSource' 'audio' 'choice' 'output' 'Audio source' 'Use a microphone source to record your voice.' -Choices $AudioSources -Show @{ audio = $true }),
    (F 'audioDup' 'audio' 'bool' $false 'Keep sound on the phone too' 'Only works with the playback source. Can fail on some Android 13 phones.' -Show @{ audio = $true }),
    (F 'audioCodec' 'audio' 'choice' '' 'Audio codec (mirror)' 'Codec used while only mirroring.' -Choices $AudioCodecs -Show @{ audio = $true }),
    (F 'recordAudioCodec' 'audio' 'choice' 'aac' 'Audio codec (recording)' 'AAC is the safest choice for recordings.' -Choices $AudioCodecs -Show @{ audio = $true }),
    (F 'audioBitrate' 'audio' 'int' 0 'Audio bitrate' '0 uses the scrcpy default.' -Min 0 -Max 512 -Picks @(0, 64, 128, 192, 256) -Unit 'kbps' -Show @{ audio = $true }),
    (F 'audioBuffer' 'audio' 'int' 0 'Audio buffer' '0 uses the scrcpy default.' -Min 0 -Max 2000 -Picks @(0, 50, 100, 200) -Unit 'ms' -Show @{ audio = $true }),
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
    (F 'windowTitle' 'window' 'text' 'Scrcpy Toolkit' 'Window title' 'Shown in the title bar and taskbar.' -Pattern '^[A-Za-z0-9 ._\-]{1,60}$'),
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
    (F 'recordTemplate' 'recording' 'text' 'Phone-{date}_{time}' 'Recording file name' 'Tokens: {date} {time} {serial} {model}.' -Pattern '^[A-Za-z0-9 ._\-{}]{1,80}$'),
    (F 'recordTimeLimit' 'recording' 'int' 0 'Automatic stop' 'Stop recording after this many seconds. 0 means never.' -Min 0 -Max 86400 -Picks @(0, 60, 300, 600, 1800, 3600) -Unit 'sec'),
    (F 'recordWindowless' 'recording' 'bool' $false 'Record without a window' 'Records in the background. Use Stop in the dashboard to finish.'),
    (F 'recordCountdown' 'recording' 'int' 0 'Start countdown' 'Seconds to count down in the dashboard before recording begins.' -Min 0 -Max 10 -Picks @(0, 3, 5) -Unit 'sec'),
    (F 'screenshotTemplate' 'recording' 'text' 'Shot-{date}_{time}' 'Screenshot file name' 'Tokens: {date} {time} {serial} {model}.' -Pattern '^[A-Za-z0-9 ._\-{}]{1,80}$'),
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
    (F 'theme' 'toolkit' 'choice' 'auto' 'Theme' 'Auto follows Windows.' -Choices @((C 'auto' 'Auto'), (C 'dark' 'Dark'), (C 'light' 'Light'))),
    (F 'confirmDeletes' 'toolkit' 'bool' $true 'Ask before deleting' 'Confirm before removing files and apps.'),
    (F 'adbTimeoutSec' 'toolkit' 'int' 15 'ADB timeout' 'How long to wait for the phone before giving up.' -Min 3 -Max 300 -Picks @(8, 15, 30, 60) -Unit 'sec'),
    (F 'tcpPort' 'toolkit' 'int' 5555 'Wi-Fi debugging port' 'Port used when switching a USB phone to Wi-Fi.' -Min 1024 -Max 65535),
    (F 'stopGraceSeconds' 'toolkit' 'int' 4 'Stop grace period' 'Seconds to wait for scrcpy to close cleanly before forcing it.' -Min 1 -Max 30 -Unit 'sec'),
    # advanced
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
    @{ id = 'latency'; name = 'Low latency'; note = 'Gaming and quick taps, no sound'; v = @{ maxSize = 1024; maxFps = 60; bitrateMbps = 6; videoBuffer = 0; audio = $false } },
    @{ id = 'screencast'; name = 'Screen recorder'; note = 'Clean 1080p capture with sound'; v = @{ maxSize = 1920; maxFps = 30; bitrateMbps = 12; audio = $true; recordAudioCodec = 'aac' } }
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

function Invoke-Native {
    param([string]$File, [string]$ArgLine, [int]$TimeoutSec = 15, [string]$WorkDir = '')
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
            Fail 'The phone did not answer in time. Check the cable, unlock the phone and try again.'
        }
        $p.WaitForExit()
        $o = ''
        $e = ''
        if (Test-Path -LiteralPath $stdoutFile) { $o = [string][IO.File]::ReadAllText($stdoutFile) }
        if (Test-Path -LiteralPath $stderrFile) { $e = [string][IO.File]::ReadAllText($stderrFile) }
        return @{ code = [int]$p.ExitCode; out = $o; err = $e }
    } finally {
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
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
    try { $list = @(Get-DevicesRaw) } catch { $message = $_.Exception.Message }
    $sw.Stop()
    if ($message -eq '' -and $list.Count -eq 0) { $message = 'No device detected. Connect USB, enable USB debugging, and authorize this computer.' }
    Use-Lock {
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
# Building the scrcpy command line
# ---------------------------------------------------------------------------
function New-ScrcpyArgs {
    param($S, [string]$Mode, [string]$Serial, [string]$OutFile, [hashtable]$Once)
    Test-Serial $Serial
    if (-not $Once) { $Once = @{} }
    $headless = ($Mode -eq 'record' -and [bool]$S.recordWindowless)
    $a = New-Object System.Collections.ArrayList
    if ($Serial) { [void]$a.Add('-s ' + $Serial) }
    # video
    if ($S.source -eq 'camera') {
        [void]$a.Add('--video-source=camera')
        if ($S.cameraId -ne '') { [void]$a.Add('--camera-id=' + $S.cameraId) } elseif ($S.cameraFacing -ne '') { [void]$a.Add('--camera-facing=' + $S.cameraFacing) }
        if ($S.cameraSize -ne '') { [void]$a.Add('--camera-size=' + $S.cameraSize) }
    } else {
        if ($S.virtualDisplay) {
            if ($S.virtualDisplaySize -ne '') { [void]$a.Add('--new-display=' + $S.virtualDisplaySize) } else { [void]$a.Add('--new-display') }
            if ($Once.startApp) { [void]$a.Add('--start-app=' + $Once.startApp) }
        } else {
            if ($S.displayId -gt 0) { [void]$a.Add('--display-id=' + $S.displayId) }
            if ($Once.startApp) { [void]$a.Add('--start-app=' + $Once.startApp) }
        }
        if ($S.crop -ne '') { [void]$a.Add('--crop=' + $S.crop) }
    }
    if ($S.maxSize -gt 0) { [void]$a.Add('--max-size=' + $S.maxSize) }
    [void]$a.Add('--max-fps=' + $S.maxFps)
    [void]$a.Add('--video-bit-rate=' + $S.bitrateMbps + 'M')
    [void]$a.Add('--video-codec=' + $S.codec)
    if ($S.videoEncoder -ne '') { [void]$a.Add('--video-encoder=' + $S.videoEncoder) }
    if ($S.captureOrientation -ne '') { [void]$a.Add('--capture-orientation=' + $S.captureOrientation) }
    if ($S.videoBuffer -gt 0) { [void]$a.Add('--video-buffer=' + $S.videoBuffer) }
    # audio
    if (-not $S.audio) { [void]$a.Add('--no-audio') } else {
        if ($S.audioSource -ne 'output') { [void]$a.Add('--audio-source=' + $S.audioSource) }
        if ($S.audioDup -and $S.audioSource -eq 'playback') { [void]$a.Add('--audio-dup') }
        $codec = $S.audioCodec
        if ($Mode -eq 'record') { $codec = $S.recordAudioCodec }
        if ($codec -ne '') { [void]$a.Add('--audio-codec=' + $codec) }
        if ($S.audioBitrate -gt 0) { [void]$a.Add('--audio-bit-rate=' + $S.audioBitrate + 'K') }
        if ($S.audioBuffer -gt 0) { [void]$a.Add('--audio-buffer=' + $S.audioBuffer) }
    }
    # control
    if ($S.viewOnly) { [void]$a.Add('--no-control') } else {
        if ($S.keyboard -ne '') { [void]$a.Add('--keyboard=' + $S.keyboard) }
        if ($S.mouse -ne '') { [void]$a.Add('--mouse=' + $S.mouse) }
        if ($S.noClipboardAutosync) { [void]$a.Add('--no-clipboard-autosync') }
        if ($S.legacyPaste) { [void]$a.Add('--legacy-paste') }
        if ($S.preferText) { [void]$a.Add('--prefer-text') }
    }
    if ($S.stayAwake) { [void]$a.Add('--stay-awake') }
    if ($S.turnScreenOff) { [void]$a.Add('--turn-screen-off') }
    if ($S.showTouches) { [void]$a.Add('--show-touches') }
    if ($S.powerOffOnClose) { [void]$a.Add('--power-off-on-close') }
    if ($S.noPowerOn) { [void]$a.Add('--no-power-on') }
    if ($S.screenOffTimeout -gt 0) { [void]$a.Add('--screen-off-timeout=' + $S.screenOffTimeout) }
    # window
    if ($headless) { [void]$a.Add('--no-playback') } else {
        $title = $S.windowTitle
        if ($title -eq '') { $title = 'Scrcpy Toolkit' }
        [void]$a.Add('--window-title="' + $title + '"')
        if ($S.alwaysOnTop) { [void]$a.Add('--always-on-top') }
        if ($S.fullscreen) { [void]$a.Add('--fullscreen') }
        if ($S.borderless) { [void]$a.Add('--window-borderless') }
        if ($S.windowWidth -gt 0) { [void]$a.Add('--window-width=' + $S.windowWidth) }
        if ($S.windowHeight -gt 0) { [void]$a.Add('--window-height=' + $S.windowHeight) }
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

function New-FileStem {
    param([string]$Template, [string]$Serial)
    $now = Get-Date
    $name = $Template.Replace('{date}', $now.ToString('yyyy-MM-dd')).Replace('{time}', $now.ToString('HH-mm-ss')).Replace('{serial}', $Serial).Replace('{model}', (Get-DeviceModelHint $Serial))
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
                        Add-Event 'ended' @{ mode = $d.mode; file = $d.fileName; size = $size; seconds = $secs; session = $d.id }
                    }
                }
            }
            return $live
        })
}

function Get-SessionView {
    param($S)
    $size = [long]0
    if ($S.mode -eq 'record' -and $S.path -and (Test-Path -LiteralPath $S.path)) { try { $size = [long](Get-Item -LiteralPath $S.path).Length } catch {} }
    return @{ id = $S.id; pid = [int]$S.pid; mode = $S.mode; recording = ($S.mode -eq 'record'); type = $(if ($S.mode -eq 'record') { 'Recording' } else { 'Mirroring' }); serial = [string]$S.serial; started = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$S.startedMs).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')); file = [string]$S.fileName; fileSize = $size; headless = [bool]$S.headless; app = [string]$S.app }
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
    foreach ($s in (Get-LiveSessions)) {
        if (-not $Serial -or -not $s.serial -or $s.serial -eq $Serial) { Fail ('A scrcpy window is already open for this phone (' + $(if ($s.mode -eq 'record') { 'recording' } else { 'mirroring' }) + '). Stop it first.') }
    }
    $id = [guid]::NewGuid().ToString('N').Substring(0, 8)
    $out = ''
    $fileName = ''
    if ($Mode -eq 'record') {
        $out = New-UniquePath (Get-Dir 'recordings') (New-FileStem $settings.recordTemplate $Serial) $settings.recordFormat
        $fileName = [IO.Path]::GetFileName($out)
    }
    $argLine = New-ScrcpyArgs -S $settings -Mode $Mode -Serial $Serial -OutFile $out -Once $Once
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
    $proc = [Diagnostics.Process]::Start($psi)
    $startTicks = [long]0
    try { $startTicks = $proc.StartTime.ToUniversalTime().Ticks } catch {}
    $session = @{ id = $id; pid = [int]$proc.Id; procStart = $startTicks; mode = $Mode; serial = $Serial; startedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); path = $out; fileName = $fileName; headless = ($Mode -eq 'record' -and [bool]$settings.recordWindowless); log = $log; app = [string]$Once.startApp }
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
$VideoPattern = '(?i)\.(mp4|mkv)$'
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
    if ($Kind -eq 'screenshots') { $dir = Get-Dir 'screenshots'; $ext = @('.png') } else { $Kind = 'recordings'; $dir = Get-Dir 'recordings'; $ext = @('.mp4', '.mkv') }
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
    if ($Kind -eq 'screenshots') { $dir = Get-Dir 'screenshots'; $ext = @('.png') } else { $dir = Get-Dir 'recordings'; $ext = @('.mp4', '.mkv') }
    return @(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Extension.ToLower() -in $ext -and $_.LastWriteTime -lt $cutoff -and -not (Test-InProgress $_.Name) })
}
