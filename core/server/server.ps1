# DROID ADB backend.
#
# Design notes (why the dashboard no longer goes "offline" while recording):
#  - The main thread only accepts connections and answers /api/ping and static files instantly.
#  - Every other request goes to a pool of worker runspaces, so one slow adb call can never block
#    the health check or other requests.
#  - Device lists are refreshed by a background ticker; the dashboard polls cached data.
#  - supervisor.ps1 restarts this process if it ever exits unexpectedly.
$ErrorActionPreference = 'Stop'
$global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$Shared = [hashtable]::Synchronized(@{})
$Shared.activity = New-Object System.Collections.ArrayList
$Shared.events = New-Object System.Collections.ArrayList
$Shared.info = [hashtable]::Synchronized(@{})
$Shared.live = [hashtable]::Synchronized(@{})
$Shared.frames = [hashtable]::Synchronized(@{})
$Shared.appsCache = $null
$Shared.frameBusy = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string,long]'
$Shared.lastClientMs = [long]0
$Shared.eventSeq = 0
$Shared.inflight = 0
$Shared.stop = $false
$Shared.exitCode = 0
$Shared.started = Get-Date
$Shared.versions = @{ adb = ''; scrcpy = '' }
$Shared.queue = New-Object 'System.Collections.Concurrent.BlockingCollection[object]' 500
$Shared.fastQueue = New-Object 'System.Collections.Concurrent.BlockingCollection[object]' 500
$Shared.mediaQueue = New-Object 'System.Collections.Concurrent.BlockingCollection[object]' 200
$Shared.jobQueue = New-Object 'System.Collections.Concurrent.BlockingCollection[string]' 100
$Shared.jobs = [hashtable]::Synchronized(@{})

. (Join-Path $PSScriptRoot 'lib.ps1')
. (Join-Path $PSScriptRoot 'handlers.ps1')
. (Join-Path $PSScriptRoot 'routes-store.ps1')
. (Join-Path $PSScriptRoot 'routes-phone.ps1')

$Settings = Get-Settings
$Port = [int]$Settings.port
$WorkerCount = [int]$Settings.serverWorkers
$Shared.port = $Port
$Shared.workerCount = $WorkerCount
$HostHeader = '127.0.0.1:' + $Port
$OwnOrigin = 'http://' + $HostHeader
$PidFile = Join-Path $LogDir 'backend.pid'

$Listener = New-Object Net.HttpListener
$Listener.Prefixes.Add('http://127.0.0.1:' + $Port + '/')
$Shared.listener = $Listener

$InitText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'lib.ps1')) + "`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'handlers.ps1')) + "`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'routes-store.ps1')) + "`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'routes-phone.ps1'))

$WorkerLoop = @'

while (-not $Shared.stop) {
    $item = $null
    if (-not $Shared.queue.TryTake([ref]$item, 1000)) { continue }
    Handle-Request $item
}
'@

# Fast workers only serve routes that never talk to the phone, so the dashboard stays responsive
# even when every normal worker is waiting on a slow adb command.
$FastLoop = @'

while (-not $Shared.stop) {
    $item = $null
    if (-not $Shared.fastQueue.TryTake([ref]$item, 1000)) { continue }
    Handle-Request $item
}
'@

# 4.3.0: videos and pictures are streamed by their own workers. A playing video keeps a worker busy for as long
# as the browser keeps reading, and with only 3 shared fast workers it could starve the dashboard (and itself).
$MediaLoop = @'

while (-not $Shared.stop) {
    $item = $null
    if (-not $Shared.mediaQueue.TryTake([ref]$item, 1000)) { continue }
    Handle-Request $item
}
'@

$TickerLoop = @'

$Shared.versions = Get-ServerVersions
$n = 0
while (-not $Shared.stop) {
    try {
        Update-DeviceCache
        [void](Get-LiveSessions)
        try { Invoke-AutoReconnect } catch {}
        $n++
        if ($n % 60 -eq 0) { $Shared.versions = Get-ServerVersions }
    } catch { Write-BackendLog ('Ticker: ' + $_.Exception.Message) }
    for ($i = 0; $i -lt 20 -and -not $Shared.stop; $i++) { Start-Sleep -Milliseconds 100 }
}
'@

# Reads rotation, screen state, battery and foreground app while a dashboard tab is watching.
$LiveLoop = @'

$cycle = 0
while (-not $Shared.stop) {
    $wait = 2000
    try {
        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $s = Get-Settings
        $wait = [int]$s.liveSeconds * 1000
        if (($nowMs - [long]$Shared.lastClientMs) -lt 15000) {
            $cycle++
            foreach ($d in @($Shared.devices | Where-Object { $null -ne $_ -and $_.state -eq 'device' })) {
                try { Update-LiveTelemetry ([string]$d.id) (($cycle % 3) -eq 1) } catch { Write-BackendLog ('Live: ' + $_.Exception.Message) }
            }
        } else { $wait = 1000 }
    } catch { Write-BackendLog ('Live loop: ' + $_.Exception.Message) }
    $slept = 0
    while ($slept -lt $wait -and -not $Shared.stop) { Start-Sleep -Milliseconds 100; $slept += 100 }
}
'@

$Runners = New-Object System.Collections.ArrayList
function Start-Runner {
    param([string]$Name, [string]$LoopText)
    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'MTA'
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('Shared', $Shared)
    $rs.SessionStateProxy.SetVariable('StkRoot', $global:StkRoot)
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($InitText + "`n" + $LoopText)
    $handle = $ps.BeginInvoke()
    return @{ name = $Name; ps = $ps; rs = $rs; handle = $handle; loop = $LoopText; restarts = 0 }
}

function Invoke-Housekeeping {
    for ($i = 0; $i -lt $Runners.Count; $i++) {
        $r = $Runners[$i]
        if ($r.handle.IsCompleted -and -not $Shared.stop) {
            $why = ''
            try { [void]$r.ps.EndInvoke($r.handle) } catch { $why = $_.Exception.Message }
            foreach ($e in $r.ps.Streams.Error) { $why += ' ' + $e.ToString() }
            Write-BackendLog ('Runner ' + $r.name + ' stopped. ' + $why)
            try { $r.ps.Dispose(); $r.rs.Dispose() } catch {}
            if ($r.restarts -lt 20) {
                Start-Sleep -Milliseconds 500
                $new = Start-Runner $r.name $r.loop
                $new.restarts = $r.restarts + 1
                $Runners[$i] = $new
            }
        }
    }
}

try {
    try { $Listener.Start() } catch {
        Write-BackendLog ('Could not listen on port ' + $Port + ': ' + $_.Exception.Message + ' Another program may be using it. Change the port in Settings or close the other program.')
        exit 20
    }
    Set-Content -LiteralPath $PidFile -Value $PID
    Add-Activity 'system' ('Backend started on port ' + $Port + '.')
    [void]$Runners.Add((Start-Runner 'ticker' $TickerLoop))
    [void]$Runners.Add((Start-Runner 'live' $LiveLoop))
    [void]$Runners.Add((Start-Runner 'jobs-1' $JobLoop))
    [void]$Runners.Add((Start-Runner 'jobs-2' $JobLoop))
    [void]$Runners.Add((Start-Runner 'sched' $SchedLoop))
    for ($i = 1; $i -le $WorkerCount; $i++) { [void]$Runners.Add((Start-Runner ('worker-' + $i) $WorkerLoop)) }
    for ($i = 1; $i -le 3; $i++) { [void]$Runners.Add((Start-Runner ('fast-' + $i) $FastLoop)) }
    for ($i = 1; $i -le 4; $i++) { [void]$Runners.Add((Start-Runner ('media-' + $i) $MediaLoop)) }

    $task = $null
    while ($Listener.IsListening -and -not $Shared.stop) {
        if (-not $task) { $task = $Listener.GetContextAsync() }
        if (-not $task.Wait(3000)) { Invoke-Housekeeping; continue }
        $Ctx = $null
        try { $Ctx = $task.Result } catch {
            $task = $null
            if ($Shared.stop) { break }
            Start-Sleep -Milliseconds 100
            continue
        }
        $task = $null
        try {
            $req = $Ctx.Request
            $path = $req.Url.AbsolutePath.TrimEnd('/')
            $method = $req.HttpMethod
            $origin = $req.Headers['Origin']
            if ($req.Headers['Host'] -ne $HostHeader) { Send-Json $Ctx @{ error = 'Unexpected host.' } 403; continue }
            if (-not [string]::IsNullOrEmpty($origin) -and $origin -ne $OwnOrigin) { Send-Json $Ctx @{ error = 'This local API only accepts the local dashboard.' } 403; continue }
            if ($method -eq 'OPTIONS') { $Ctx.Response.StatusCode = 204; $Ctx.Response.Close(); continue }
            if ($method -eq 'GET' -and $path -eq '/api/ping') {
                Send-Json $Ctx @{ ok = $true; version = $ToolkitVersion; uptime = [int]((Get-Date) - $Shared.started).TotalSeconds; inflight = [int]$Shared.inflight }
                continue
            }
            if ($method -in @('GET', 'HEAD') -and ($path -eq '' -or $path -eq '/index.html' -or $path -eq '/sw.js' -or $path -eq '/manifest.webmanifest' -or $path.StartsWith('/assets/'))) { Send-Static $Ctx $path; continue }
            if ($method -eq 'GET' -and $path -eq '/favicon.ico') { $Ctx.Response.StatusCode = 204; $Ctx.Response.Close(); continue }
            $lane = $Shared.queue
            if ($FastRoutes.ContainsKey($method + ' ' + $path)) { $lane = $Shared.fastQueue }
            if ($method -eq 'GET' -and $path -eq '/api/file') { $lane = $Shared.mediaQueue }
            if (-not $lane.TryAdd($Ctx)) { Send-Json $Ctx @{ error = 'The backend is busy. Try again in a moment.' } 503 }
        } catch {
            Write-BackendLog ('Accept loop: ' + $_.Exception.Message)
            try { $Ctx.Response.Abort() } catch {}
        }
    }
} finally {
    $Shared.stop = $true
    try { if ($Listener.IsListening) { $Listener.Stop() } } catch {}
    try { $Listener.Close() } catch {}
    foreach ($r in $Runners) { try { $r.ps.Stop() } catch {}; try { $r.rs.Dispose() } catch {} }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}
exit ([int]$Shared.exitCode)
