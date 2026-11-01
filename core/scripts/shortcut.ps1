# Creates a "DROID ADB" shortcut on the Desktop that starts the silent launcher (Launch.vbs) and uses the DROID ADB icon.
# Run through Create-Desktop-Shortcut.bat. If you move this folder, run that file again.
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $target = Join-Path $root 'Launch.vbs'
    $icon = Join-Path (Join-Path (Join-Path $root 'core') 'branding') 'droid-adb.ico'
    if (-not (Test-Path -LiteralPath $target)) { throw 'Launch.vbs was not found next to this folder.' }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $desktop 'DROID ADB.lnk'))
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $link.Arguments = '//nologo "' + $target + '"'
    $link.WorkingDirectory = $root
    $link.Description = 'DROID ADB'
    if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon + ',0' }
    $link.Save()
    Write-Host ('Shortcut created: ' + (Join-Path $desktop 'DROID ADB.lnk'))
} catch {
    Write-Host ('Could not create the shortcut: ' + $_.Exception.Message)
    exit 1
}
