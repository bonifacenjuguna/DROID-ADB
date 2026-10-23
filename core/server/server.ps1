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
    # ADB writes normal daemon startup messages to stderr. With Stop as the
    # global error preference, Windows PowerShell 5.1 can treat that text as a
    # terminating error and return it as the API response instead of device data.
    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $Adb devices -l 2>&1 | ForEach-Object { [string]$_ })
        $adbExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorPreference
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
function Get-Recordings {
    $files = @(Get-ChildItem -LiteralPath $RecordDir -File -Filter '*.mp4' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object {
        @{ name=$_.Name; size=[long]$_.Length; modified=$_.LastWriteTime.ToString('o') }
    })
    $total = [long]0
    foreach ($file in $files) { $total += [long]$file.size }
    return @{ files=@($files); totalSize=$total }
}
function Start-Scrcpy {
    param([ValidateSet('mirror','record')][string]$Mode)
    if (-not (Test-Path $Scrcpy)) { throw 'scrcpy.exe is missing from core/scrcpy. Re-extract the complete ZIP.' }
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
                $devices = Get-Devices
                Send-Json $Context @{ ok=$true; version='1.0.0'; deviceCount=@($devices.devices | Where-Object { $_.state -eq 'device' }).Count }
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/devices') {
                Send-Json $Context (Get-Devices)
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
                    'record' { Start-Scrcpy 'record'; Send-Json $Context @{ ok=$true; message='Recording started. Close its scrcpy window to finish the MP4.' } }
                    'stop' {
                        $count = 0
                        Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue |
                            Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($Scrcpy)) } |
                            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $count++ }
                        Send-Json $Context @{ ok=$true; message="Closed $count toolkit scrcpy process(es)." }
                    }
                    'check' { Send-Json $Context (Get-Devices) }
                    default { Send-Json $Context @{ error='Unknown action.' } 400 }
                }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/open-recordings') {
                Start-Process explorer.exe -ArgumentList @($RecordDir)
                Send-Json $Context @{ ok=$true }
            } elseif ($Request.HttpMethod -eq 'GET' -and $Path -eq '/api/cleanup-preview') {
                $days = 30
                if ($Request.QueryString['days'] -match '^\d+$') { $days = [int]$Request.QueryString['days'] }
                if ($days -notin @(30,60,90,180)) { throw 'Choose 30, 60, 90, or 180 days.' }
                $cutoff = (Get-Date).AddDays(-$days)
                $files = @(Get-ChildItem -LiteralPath $RecordDir -File -Filter '*.mp4' | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object { @{ name=$_.Name; size=[long]$_.Length } })
                Send-Json $Context @{ files=@($files); days=$days }
            } elseif ($Request.HttpMethod -eq 'POST' -and $Path -eq '/api/cleanup') {
                $body = Read-Body $Request
                $days = [int]$body.days
                if ($days -notin @(30,60,90,180) -or -not [bool]$body.confirm) { throw 'Cleanup was not confirmed or the age selection is invalid.' }
                $cutoff = (Get-Date).AddDays(-$days)
                $deleted = 0
                $freed = [long]0
                Get-ChildItem -LiteralPath $RecordDir -File -Filter '*.mp4' | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
                    $freed += $_.Length
                    Remove-Item -LiteralPath $_.FullName -Force
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