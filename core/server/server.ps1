$ErrorActionPreference = 'Stop'
$Port = 47821
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Runtime = Join-Path $Root 'core\scrcpy'
$RecordDir = Join-Path $Root 'Recordings'
$ConfigDir = Join-Path $Root 'Config'
$ConfigFile = Join-Path $ConfigDir 'settings.json'
$Scrcpy = Join-Path $Runtime 'scrcpy.exe'
$Adb = Join-Path $Runtime 'adb.exe'
$Listener = New-Object Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
New-Item -ItemType Directory -Force -Path $RecordDir, $ConfigDir | Out-Null
$Default = @{ maxSize = 1280; maxFps = 30; bitrate = '8M'; audio = $true }
if (-not (Test-Path $ConfigFile)) { $Default | ConvertTo-Json | Set-Content -Encoding UTF8 $ConfigFile }

function Get-Settings {
    try {
        $s = Get-Content -Raw $ConfigFile | ConvertFrom-Json
        if ([int]$s.maxSize -notin @(720,1024,1280,1600,1920,0)) { throw 'Invalid size' }
        if ([int]$s.maxFps -notin @(15,24,30,45,60)) { throw 'Invalid FPS' }
        if ([string]$s.bitrate -notin @('2M','4M','8M','12M','16M')) { throw 'Invalid bitrate' }
        return @{ maxSize=[int]$s.maxSize; maxFps=[int]$s.maxFps; bitrate=[string]$s.bitrate; audio=[bool]$s.audio }
    } catch { return $Default }
}
function Send-Json {
    param($Context, $Data, [int]$Status = 200)
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 8 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.Headers['Cache-Control'] = 'no-store'
    $origin = $Context.Request.Headers['Origin']
    if ([string]::IsNullOrEmpty($origin) -or $origin -eq 'null') {
        $Context.Response.Headers['Access-Control-Allow-Origin'] = 'null'
    }
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}
function Read-Body {
    param($Request)
    if ($Request.ContentLength64 -gt 8192) { throw 'Request is too large.' }
    $reader = New-Object IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    try {
        $raw = $reader.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
        return ($raw | ConvertFrom-Json)
    } finally { $reader.Dispose() }
}
function Get-Devices {
    if (-not (Test-Path $Adb)) { return @{ devices=@(); message='adb.exe is missing from core/scrcpy.' } }
    # Capture native stdout/stderr to files. In Windows PowerShell 5.1,
    # native stderr can become a terminating NativeCommandError when the
    # script-wide ErrorActionPreference is Stop.
    $stdoutFile = Join-Path $env:TEMP ('scrcpy-adb-out-' + [guid]::NewGuid().ToString('N') + '.txt')
    $stderrFile = Join-Path $env:TEMP ('scrcpy-adb-err-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        $proc = Start-Process -FilePath $Adb -ArgumentList 'devices -l' -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        $lines = @()
        if (Test-Path $stdoutFile) { $lines += @(Get-Content -LiteralPath $stdoutFile -ErrorAction SilentlyContinue) }
        if (Test-Path $stderrFile) { $lines += @(Get-Content -LiteralPath $stderrFile -ErrorAction SilentlyContinue) }
    } finally {
        Remove-Item -LiteralPath $stdoutFile,$stderrFile -Force -ErrorAction SilentlyContinue
    }
    $items = @()
    foreach ($line in $lines) {
        if ($line -match '^([^\s]+)\s+(device|unauthorized|offline)(?:\s+(.*))?$') {
            $items += @{ id=$Matches[1]; state=$Matches[2]; details=([string]$Matches[3]).Trim() }
        }
    }
    $message = if ($items.Count -eq 0) { 'No device detected. Connect USB, enable USB debugging, and authorize this computer.' } else { '' }
    return @{ devices=@($items); message=$message }
}
function Get-ToolkitSessions {
    $sessions = @()
    Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($Scrcpy)) } |
        ForEach-Object {
            $isRecording = ([string]$_.CommandLine -match '(?i)--record(?:\s|=)')
            $started = $null
            try { if ($_.CreationDate) { $started = ([datetime]$_.CreationDate).ToString('o') } } catch {}
            $sessions += @{
                pid = [int]$_.ProcessId
                recording = [bool]$isRecording
                type = $(if ($isRecording) { 'Recording' } else { 'Mirroring' })
                started = $started
            }
        }
    return @{ sessions=@($sessions); count=$sessions.Count; recordingCount=@($sessions | Where-Object { $_.recording }).Count }
}
function Get-SafeRecordingPath {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name) -or [IO.Path]::GetFileName($Name) -ne $Name -or $Name -notmatch '(?i)\.(mp4|mkv)$') {
        throw 'Choose a valid MP4 or MKV recording from the library.'
    }
    $path = [IO.Path]::GetFullPath((Join-Path $RecordDir $Name))
    $base = [IO.Path]::GetFullPath($RecordDir).TrimEnd('\') + '\'
    if (-not $path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid recording path.' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'That recording no longer exists.' }
    return $path
}
function Get-Recordings {
    $files = @(Get-ChildItem -LiteralPath $RecordDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.mp4','.mkv') } | Sort-Object LastWriteTime -Descending | ForEach-Object {
        @{ name=$_.Name; size=[long]$_.Length; modified=$_.LastWriteTime.ToString('o') }
    })
    $total = [long]0
    foreach ($file in $files) { $total += [long]$file.size }
    return @{ files=@($files); totalSize=$total }
}
function Start-Scrcpy {
    param([ValidateSet('mirror','record')][string]$Mode)
    if (-not (Test-Path $Scrcpy)) { throw 'scrcpy.exe is missing from core/scrcpy. Re-extract the complete ZIP.' }
    # A second scrcpy instance can create a second video/audio stream on the phone.
    # Prevent duplicate toolkit sessions so recording does not silently double the workload.
    $active = @(Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($Scrcpy)) })
    if ($active.Count -gt 0) {
        if ($Mode -eq 'record') {
            throw 'A toolkit scrcpy window is already open. Close it first, then click Start recording. The recording window also mirrors your phone, so you only need one window.'
        }
        throw 'A toolkit scrcpy window is already open. Close it before starting another session to avoid extra device workload.'
    }
    $scriptName = if ($Mode -eq 'record') { 'Record.bat' } else { 'Mirror.bat' }
    $scriptPath = Join-Path $Root ('core\scripts\' + $scriptName)
    if (-not (Test-Path $scriptPath)) { throw ($scriptName + ' is missing from core/scripts.') }
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', ('"' + $scriptPath + '"')) -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
}
try {
    try {
        $Listener.Start()
    } catch {
        $log = Join-Path $Root 'Logs\backend-error.log'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
        ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] Listener startup failed: ' + $_.Exception.ToString()) | Add-Content -LiteralPath $log
        throw
    }
    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        try {
            $Request = $Context.Request
            $Path = $Request.Url.AbsolutePath.TrimEnd('/')
            $Origin = $Request.Headers['Origin']
            if (-not [string]::IsNullOrEmpty($Origin) -and $Origin -ne 'null') {
                Send-Json $Context @{ error='This local API only accepts the local dashboard.' } 403
                continue
            }
            if ($Request.HttpMethod -eq 'OPTIONS') {
                $Context.Response.StatusCode = 204
                $Context.Response.Headers['Access-Control-Allow-Origin'] = 'null'
                $Context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
                $Context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
                $Context.Response.Close()
                continue
            }
            if ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/status') {
                # Health check must not invoke ADB; it should report whether the API itself is alive.
                Send-Json $Context @{ ok=$true; version='1.0.0' }
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/devices') {
                Send-Json $Context (Get-Devices)
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/session') {
                Send-Json $Context (Get-ToolkitSessions)
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/recordings') {
                Send-Json $Context (Get-Recordings)
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/settings') {
                Send-Json $Context @{ settings=(Get-Settings) }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/settings') {
                $body = Read-Body $Request
                if ([int]$body.maxSize -notin @(720,1024,1280,1600,1920,0)) { throw 'Choose a supported maximum size.' }
                if ([int]$body.maxFps -notin @(15,24,30,45,60)) { throw 'Choose a supported frame rate.' }
                if ([string]$body.bitrate -notin @('2M','4M','8M','12M','16M')) { throw 'Choose a supported bitrate.' }
                $saved = @{ maxSize=[int]$body.maxSize; maxFps=[int]$body.maxFps; bitrate=[string]$body.bitrate; audio=[bool]$body.audio }
                $saved | ConvertTo-Json | Set-Content -Encoding UTF8 $ConfigFile
                Send-Json $Context @{ ok=$true; settings=$saved }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/action') {
                $body = Read-Body $Request
                switch ([string]$body.action) {
                    'mirror' { Start-Scrcpy 'mirror'; Send-Json $Context @{ ok=$true; message='Mirror window launched.' } }
                    'record' { Start-Scrcpy 'record'; Send-Json $Context @{ ok=$true; message='Recording started. Close its scrcpy window normally to finalize the MKV.' } }
                    'stop' {
                        $targets = @(Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue |
                            Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($Scrcpy)) })
                        $requested = 0
                        foreach ($item in $targets) {
                            $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
                            if ($p -and $p.MainWindowHandle -ne 0 -and $p.CloseMainWindow()) { $requested++ }
                        }
                        # Give scrcpy time to finalize its recording after a normal window close.
                        $deadline = (Get-Date).AddSeconds(3)
                        do {
                            Start-Sleep -Milliseconds 250
                            $remaining = @($targets | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
                        } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
                        $forced = 0
                        foreach ($item in $remaining) {
                            # The user explicitly requested Stop; only force-close processes that ignored the graceful close.
                            $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
                            if ($p) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue; $forced++ }
                        }
                        $message = if ($forced -gt 0) {
                            "Requested graceful close for $requested session(s); force-closed $forced unresponsive session(s). A force-closed recording may not finalize correctly."
                        } else {
                            "Closed $requested toolkit scrcpy session(s) gracefully."
                        }
                        Send-Json $Context @{ ok=$true; message=$message; requested=$requested; forced=$forced }
                    }
                    'check' { Send-Json $Context (Get-Devices) }
                    default { Send-Json $Context @{ error='Unknown action.' } 400 }
                }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/open-recordings') {
                Start-Process explorer.exe -ArgumentList @($RecordDir)
                Send-Json $Context @{ ok=$true }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/open-recording') {
                $body = Read-Body $Request
                $filePath = Get-SafeRecordingPath ([string]$body.name)
                Start-Process -FilePath $filePath
                Send-Json $Context @{ ok=$true }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/reveal-recording') {
                $body = Read-Body $Request
                $filePath = Get-SafeRecordingPath ([string]$body.name)
                Start-Process -FilePath explorer.exe -ArgumentList ('/select,"' + $filePath + '"')
                Send-Json $Context @{ ok=$true }
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/cleanup-preview') {
                $days = 30
                if ($Request.QueryString['days'] -match '^\d+$') { $days = [int]$Request.QueryString['days'] }
                if ($days -notin @(30,60,90,180)) { throw 'Choose 30, 60, 90, or 180 days.' }
                $cutoff = (Get-Date).AddDays(-$days)
                $files = @(Get-ChildItem -LiteralPath $RecordDir -File | Where-Object { $_.Extension -in @('.mp4','.mkv') -and $_.LastWriteTime -lt $cutoff } | ForEach-Object { @{ name=$_.Name; size=[long]$_.Length } })
                Send-Json $Context @{ files=@($files); days=$days }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/cleanup') {
                $body = Read-Body $Request
                $days = [int]$body.days
                if ($days -notin @(30,60,90,180) -or -not [bool]$body.confirm) { throw 'Cleanup was not confirmed or the age selection is invalid.' }
                $cutoff = (Get-Date).AddDays(-$days)
                $deleted = 0
                $freed = [long]0
                $files = @(Get-ChildItem -LiteralPath $RecordDir -File | Where-Object { $_.Extension -in @('.mp4','.mkv') -and $_.LastWriteTime -lt $cutoff })
                foreach ($file in $files) {
                    $freed += [long]$file.Length
                    Remove-Item -LiteralPath $file.FullName -Force
                    $deleted++
                }
                Send-Json $Context @{ ok=$true; deleted=$deleted; freed=$freed }
            } else {
                Send-Json $Context @{ error='Endpoint not found.' } 404
            }
        } catch {
            try { Send-Json $Context @{ error=$_.Exception.Message } 400 } catch { try { $Context.Response.Close() } catch {} }
        }
    }
} finally {
    try { if ($Listener.IsListening) { $Listener.Stop() } } catch {}
    try { $Listener.Close() } catch {}
}