$ErrorActionPreference = 'Continue'
$serverPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.ps1'))
try {
    $matches = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($serverPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    foreach ($proc in $matches) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 700
} catch {
    # A clean restart is best-effort; Launch.bat will report if the port remains occupied.
}
