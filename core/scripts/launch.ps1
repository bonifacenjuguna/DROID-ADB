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
} catch { Write-BackendLog ('Launcher: ' + $_.Exception.Message); Write-Host $_.Exception.Message; exit 1 }
