# Creates a "DROID ADB" shortcut on the Desktop that starts Launch.vbs (no window) and uses the DROID ADB icon.
# Run through Create-Desktop-Shortcut.bat. If you move this folder, run that file again.
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $target = Join-Path $root 'Launch.vbs'
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $icon = Join-Path (Join-Path (Join-Path $root 'core') 'branding') 'droid-adb.ico'
    if (-not (Test-Path -LiteralPath $target)) { throw 'Launch.vbs was not found next to this folder.' }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $desktop 'DROID ADB.lnk'))
    $link.TargetPath = $wscript
    $link.Arguments = '"' + $target + '"'
    $link.WindowStyle = 7
    $link.WorkingDirectory = $root
    $link.Description = 'DROID ADB'
    if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon + ',0' }
    $link.Save()
    Write-Host ('Shortcut created: ' + (Join-Path $desktop 'DROID ADB.lnk'))
} catch {
    Write-Host ('Could not create the shortcut: ' + $_.Exception.Message)
    exit 1
}
