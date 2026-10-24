# Scrcpy Toolkit shared helpers. Dot-sourced by server.ps1 and core/scripts/launch.ps1.
$ToolkitVersion = '2.0.0'
$Root      = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Runtime   = Join-Path $Root 'core\scrcpy'
$RecordDir = Join-Path $Root 'Recordings'
$ShotDir   = Join-Path $Root 'Screenshots'
$ConfigDir = Join-Path $Root 'Config'
$LogDir    = Join-Path $Root 'Logs'
$ConfigFile = Join-Path $ConfigDir 'settings.json'
$Scrcpy    = Join-Path $Runtime 'scrcpy.exe'
$Adb       = Join-Path $Runtime 'adb.exe'
New-Item -ItemType Directory -Force -Path $RecordDir, $ShotDir, $ConfigDir, $LogDir | Out-Null

$SettingChoices = @{
    maxSize   = @(720, 1024, 1280, 1600, 1920, 0)
    maxFps    = @(15, 24, 30, 45, 60)
    bitrate   = @('2M', '4M', '8M', '12M', '16M')
    codec     = @('h264', 'h265')
    audioSource = @('output', 'mic')
    preset    = @('battery', 'balanced', 'quality', 'max', 'custom')
    pollInterval = @(4, 6, 10, 15)
}
$Default = @{
    maxSize = 1280; maxFps = 30; bitrate = '8M'; codec = 'h264'
    audio = $true; audioSource = 'output'
    stayAwake = $true; turnScreenOff = $false; showTouches = $false; alwaysOnTop = $false
    fullscreen = $false; borderless = $false; viewOnly = $false; powerOffOnClose = $false
    preset = 'balanced'; pollInterval = 10
}

function Get-Prop {
    param($Object, [string]$Name, $Fallback)
    if ($null -eq $Object) { return $Fallback }
    if ($Object -is [hashtable]) { if ($Object.ContainsKey($Name)) { return $Object[$Name] } else { return $Fallback } }
    $p = $Object.PSObject.Properties[$Name]
    if ($p -and $null -ne $p.Value) { return $p.Value }
    return $Fallback
}

# Validates a settings object (hashtable or parsed JSON). Missing keys use defaults; bad values throw.
function ConvertTo-Settings {
    param($Source)
    $s = @{}
    foreach ($key in $Default.Keys) { $s[$key] = Get-Prop $Source $key $Default[$key] }
    foreach ($key in @('maxSize', 'maxFps', 'pollInterval')) {
        $s[$key] = [int]$s[$key]
        if ($s[$key] -notin $SettingChoices[$key]) { throw "Unsupported value for $key." }
    }
    foreach ($key in @('bitrate', 'codec', 'audioSource', 'preset')) {
        $s[$key] = [string]$s[$key]
        if ($s[$key] -notin $SettingChoices[$key]) { throw "Unsupported value for $key." }
    }
    foreach ($key in @('audio', 'stayAwake', 'turnScreenOff', 'showTouches', 'alwaysOnTop', 'fullscreen', 'borderless', 'viewOnly', 'powerOffOnClose')) {
        $s[$key] = [bool]$s[$key]
    }
    return $s
}

function Get-Settings {
    try {
        $raw = Get-Content -Raw -LiteralPath $ConfigFile -ErrorAction Stop | ConvertFrom-Json
        return (ConvertTo-Settings $raw)
    } catch { return (ConvertTo-Settings @{}) }
}

function Test-Serial {
    param([string]$Serial)
    if ($Serial -and $Serial -notmatch '^[A-Za-z0-9._:\-]{1,64}$') { throw 'That device id is not valid.' }
}

# Builds the scrcpy command line from validated settings.
function New-ScrcpyArgs {
    param($S, [ValidateSet('mirror', 'record')][string]$Mode, [string]$Serial, [string]$OutFile)
    Test-Serial $Serial
    $a = @()
    if ($Serial) { $a += @('-s', $Serial) }
    $a += @("--max-size=$($S.maxSize)", "--max-fps=$($S.maxFps)", "--video-bit-rate=$($S.bitrate)", "--video-codec=$($S.codec)", '--window-title=ScrcpyToolkit')
    if ($S.stayAwake) { $a += '--stay-awake' }
    if ($S.turnScreenOff) { $a += '--turn-screen-off' }
    if ($S.showTouches) { $a += '--show-touches' }
    if ($S.alwaysOnTop) { $a += '--always-on-top' }
    if ($S.fullscreen) { $a += '--fullscreen' }
    if ($S.borderless) { $a += '--window-borderless' }
    if ($S.viewOnly) { $a += '--no-control' }
    if ($S.powerOffOnClose) { $a += '--power-off-on-close' }
    if (-not $S.audio) { $a += '--no-audio' }
    elseif ($S.audioSource -eq 'mic') { $a += '--audio-source=mic' }
    if ($Mode -eq 'record') {
        # Standard audio forwarding with AAC: scrcpy audio duplication fails on some Android 13 devices.
        if ($S.audio) { $a += '--audio-codec=aac' }
        $a += @('--record', ('"' + $OutFile + '"'))
    }
    return ($a -join ' ')
}

function New-RecordingPath {
    return (Join-Path $RecordDir ('Phone-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.mkv'))
}

# Starts scrcpy without a console window and keeps its output in Logs\scrcpy-last.log.
function Start-ToolkitScrcpy {
    param([ValidateSet('mirror', 'record')][string]$Mode, [string]$Serial)
    if (-not (Test-Path -LiteralPath $Scrcpy)) { throw 'scrcpy.exe is missing from core/scrcpy. Extract the complete ZIP again.' }
    $settings = Get-Settings
    $out = New-RecordingPath
    $argLine = New-ScrcpyArgs -S $settings -Mode $Mode -Serial $Serial -OutFile $out
    $log = Join-Path $LogDir 'scrcpy-last.log'
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = '/c ""' + $Scrcpy + '" ' + $argLine + ' > "' + $log + '" 2>&1"'
    $psi.WorkingDirectory = $Runtime
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    [void][Diagnostics.Process]::Start($psi)
    return @{ file = $(if ($Mode -eq 'record') { [IO.Path]::GetFileName($out) } else { '' }) }
}

# Runs adb with a timeout and returns exit code, stdout and stderr.
function Invoke-Adb {
    param([string]$ArgLine, [int]$TimeoutSec = 10)
    if (-not (Test-Path -LiteralPath $Adb)) { throw 'adb.exe is missing from core/scrcpy.' }
    $stdoutFile = Join-Path $env:TEMP ('stk-out-' + [guid]::NewGuid().ToString('N') + '.txt')
    $stderrFile = Join-Path $env:TEMP ('stk-err-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        $p = Start-Process -FilePath $Adb -ArgumentList $ArgLine -WorkingDirectory $Runtime -NoNewWindow -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        $null = $p.Handle
        if (-not $p.WaitForExit($TimeoutSec * 1000)) {
            try { $p.Kill() } catch {}
            throw 'ADB did not answer in time. Check the cable and unlock the phone.'
        }
        $p.WaitForExit()
        $o = ''; $e = ''
        if (Test-Path -LiteralPath $stdoutFile) { $o = [string](Get-Content -Raw -LiteralPath $stdoutFile -ErrorAction SilentlyContinue) }
        if (Test-Path -LiteralPath $stderrFile) { $e = [string](Get-Content -Raw -LiteralPath $stderrFile -ErrorAction SilentlyContinue) }
        return @{ code = [int]$p.ExitCode; out = $o; err = $e }
    } finally {
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}
