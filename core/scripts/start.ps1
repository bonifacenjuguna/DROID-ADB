# Starts (or stops) the DROID ADB backend. Used by Launch.vbs / Launch.bat and Stop.vbs / Stop.bat.
#   -NoBrowser    do not open the dashboard (used at Windows start-up)
#   -KeepRunning  if this version is already running, leave it alone and only open the dashboard (used by the Start button and Windows start-up)
param([switch]$Stop, [switch]$NoBrowser, [switch]$KeepRunning)
$ErrorActionPreference = 'Continue'
$global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path (Join-Path (Join-Path $global:StkRoot 'core') 'server') 'lib.ps1')
$ServerDir = Join-Path (Join-Path $Root 'core') 'server'
$Supervisor = Join-Path $ServerDir 'supervisor.ps1'

# 4.10.0: the tray icon (small icon near the clock). One copy only; it ends by itself when the service is gone.
function Start-Tray {
    if (-not $OnWindows) { return }
    $tray = Join-Path $PSScriptRoot 'tray.ps1'
    if (-not (Test-Path -LiteralPath $tray)) { return }
    $pidFile = Join-Path $LogDir 'tray.pid'
    if (Test-Path -LiteralPath $pidFile) {
        try { $tp = [int](Get-Content -LiteralPath $pidFile -ErrorAction Stop | Select-Object -First 1); if (Get-Process -Id $tp -ErrorAction SilentlyContinue) { return } } catch {}
    }
    try { Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', ('"' + $tray + '"')) -WindowStyle Hidden } catch {}
}

function Stop-Previous {
    # Stop the supervisor first so it does not restart the backend, then the backend.
    foreach ($name in @('tray.pid', 'supervisor.pid', 'backend.pid')) {
        $f = Join-Path $LogDir $name
        if (Test-Path -LiteralPath $f) {
            try { $id = [int](Get-Content -LiteralPath $f -ErrorAction Stop | Select-Object -First 1); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {}
            Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
        }
    }
    # Also stop older instances started from another folder or by an older version.
    if ($OnWindows) {
        try {
            Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)core[\\/]server[\\/](server|supervisor)\.ps1' } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
    Start-Sleep -Milliseconds 800
}

if ($Stop) {
    Stop-Previous
    Write-Host 'DROID ADB backend stopped.'
    exit 0
}

$s = Get-Settings
$port = [int]$s.port
$url = 'http://127.0.0.1:' + $port + '/'

if ($KeepRunning) {
    # already running with this version? then leave it alone and just open the dashboard
    try {
        $pr = Invoke-WebRequest -UseBasicParsing -Uri ($url + 'api/ping') -TimeoutSec 2
        if ($pr.StatusCode -eq 200 -and (($pr.Content | ConvertFrom-Json).version -eq $ToolkitVersion)) {
            if ($s.trayIcon) { Start-Tray }
            if ($s.openBrowser -and -not $NoBrowser) { Start-Process $url }
            exit 0
        }
    } catch {}
}

Write-Host '[1/3] Stopping any previous backend...'
Stop-Previous

Write-Host '[2/3] Starting the backend...'
$exe = (Get-Process -Id $PID).Path
$argList = @('-NoProfile')
if ($OnWindows) { $argList += @('-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden') }
$argList += @('-File', ('"' + $Supervisor + '"'))
$splat = @{ FilePath = $exe; ArgumentList = $argList }
if ($OnWindows) { $splat.WindowStyle = 'Hidden' }
Start-Process @splat

$ok = $false
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 600
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ($url + 'api/ping') -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
}
if (-not $ok) {
    Write-Host ''
    Write-Host 'The backend did not answer its health check.' -ForegroundColor Red
    $log = Join-Path $LogDir 'backend-error.log'
    if (Test-Path -LiteralPath $log) { Write-Host 'Last lines of Logs\backend-error.log:'; Get-Content -LiteralPath $log -Tail 6 }
    Write-Host ('Expected address: ' + $url + 'api/ping')
    try {
        $why = 'The service did not answer its health check at ' + $url + 'api/ping.'
        if (Test-Path -LiteralPath $log) { $why += "`r`n" + ((Get-Content -LiteralPath $log -Tail 4) -join "`r`n") }
        Set-Content -LiteralPath (Join-Path $LogDir 'launch-error.txt') -Value $why -Encoding ASCII
    } catch {}
    exit 1
}
Write-Host ('[3/3] Backend is running at ' + $url)
if ($s.trayIcon) { Start-Tray }
if ($s.openBrowser -and -not $NoBrowser) { Start-Process $url }
exit 0
