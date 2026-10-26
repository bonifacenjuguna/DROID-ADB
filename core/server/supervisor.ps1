# Keeps the DROID ADB backend alive. Exit codes from server.ps1:
#   0  quit on request       10 restart on request       20 port busy       anything else: crash, restart
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogDir = Join-Path $Root 'Logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$server = Join-Path $PSScriptRoot 'server.ps1'
$onWindows = ($env:OS -eq 'Windows_NT')
Set-Content -LiteralPath (Join-Path $LogDir 'supervisor.pid') -Value $PID

function Write-Log([string]$t) { try { Add-Content -LiteralPath (Join-Path $LogDir 'backend-error.log') -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] supervisor: ' + $t) } catch {} }

$exe = (Get-Process -Id $PID).Path
$fast = 0
$busy = 0
try {
    while ($true) {
        $began = Get-Date
        $argList = @('-NoProfile')
        if ($onWindows) { $argList += @('-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden') }
        $argList += @('-File', ('"' + $server + '"'))
        $splat = @{ FilePath = $exe; ArgumentList = $argList; PassThru = $true }
        if ($onWindows) { $splat.WindowStyle = 'Hidden' }
        $p = Start-Process @splat
        $null = $p.Handle
        $p.WaitForExit()
        $code = $p.ExitCode
        if ($code -eq 0) { Write-Log 'Backend quit on request.'; break }
        if ($code -eq 10) { Write-Log 'Backend restarting on request.'; $fast = 0; $busy = 0; continue }
        if ($code -eq 20) {
            $busy++
            if ($busy -ge 6) { Write-Log 'The port is still busy. Giving up.'; break }
            Start-Sleep -Seconds 3
            continue
        }
        $busy = 0
        Write-Log ('Backend exited unexpectedly with code ' + $code + '. Restarting.')
        if (((Get-Date) - $began).TotalSeconds -lt 6) { $fast++ } else { $fast = 0 }
        if ($fast -ge 5) { Write-Log 'The backend keeps crashing right away. Giving up.'; break }
        Start-Sleep -Seconds 1
    }
} finally {
    Remove-Item -LiteralPath (Join-Path $LogDir 'supervisor.pid') -Force -ErrorAction SilentlyContinue
}
