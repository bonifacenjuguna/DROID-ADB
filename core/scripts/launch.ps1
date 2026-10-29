param([Parameter(Mandatory)][ValidateSet('mirror', 'record')][string]$Mode, [string]$Serial = '')
$ErrorActionPreference = 'Stop'
$global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path (Join-Path (Join-Path $global:StkRoot 'core') 'server') 'lib.ps1')
try {
    if (-not $Serial) {
        # With exactly one ready phone, pick it so scrcpy does not complain about several devices.
        $ready = @(Get-DevicesRaw | Where-Object { $_.state -eq 'device' })
        if ($ready.Count -eq 1) { $Serial = $ready[0].id }
    }
    [void](Start-ToolkitScrcpy -Mode $Mode -Serial $Serial)
    # 5.0.0: a phone whose screen was resized for a Tablet or Window shape must be put back even when the dashboard
    # service is not running. This hidden launcher stays until the capture has ended and the phone is back to normal.
    $until = (Get-Date).AddHours(12)
    while ((Get-ShapeStateFor $Serial) -and (Get-Date) -lt $until) {
        Start-Sleep -Seconds 2
        try { [void](Sync-PhoneShape) } catch {}
    }
} catch { Write-BackendLog ('Launcher: ' + $_.Exception.Message); Write-Host $_.Exception.Message; exit 1 }
