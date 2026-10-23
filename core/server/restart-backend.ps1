$ErrorActionPreference = 'Continue'

# Stop any previous instance launched from this toolkit, including one started
# from an older extracted ZIP folder. Match the distinctive relative script path.
try {
    $matches = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and
            ($_.CommandLine -match '(?i)core[\\/]server[\\/]server\.ps1')
        })
    foreach ($proc in $matches) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 1000
} catch {
    # Launch.bat's health check will report if the port is still occupied.
}
