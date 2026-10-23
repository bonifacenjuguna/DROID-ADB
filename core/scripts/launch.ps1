param([Parameter(Mandatory)][ValidateSet('mirror', 'record')][string]$Mode, [string]$Serial = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\server\lib.ps1')
try { [void](Start-ToolkitScrcpy -Mode $Mode -Serial $Serial) }
catch { Add-Content -LiteralPath (Join-Path $LogDir 'backend-error.log') -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $_.Exception.Message); exit 1 }
