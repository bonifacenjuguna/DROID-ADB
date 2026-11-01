# DROID ADB tray icon. Started hidden by start.ps1. A small icon near the Windows clock shows that the service is running
# and gives a menu: Open dashboard, Restart service, Start with Windows, Quit. It closes by itself when the service is gone.
$ErrorActionPreference = 'Continue'
$global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path (Join-Path (Join-Path $global:StkRoot 'core') 'server') 'lib.ps1')
if (-not $OnWindows) { exit 0 }

# one tray icon only
$script:mutex = New-Object System.Threading.Mutex($false, 'Local\DroidAdbTrayIcon')
if (-not $script:mutex.WaitOne(0)) { exit 0 }
try { Set-Content -LiteralPath (Join-Path $LogDir 'tray.pid') -Value $PID -Encoding ASCII } catch {}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$s = Get-Settings
$script:base = 'http://127.0.0.1:' + [int]$s.port + '/'

function Test-ServiceUp {
    try { return ((Invoke-WebRequest -UseBasicParsing -Uri ($script:base + 'api/ping') -TimeoutSec 2).StatusCode -eq 200) } catch { return $false }
}
function Send-Api {
    param([string]$Path, [string]$Json)
    try { [void](Invoke-WebRequest -UseBasicParsing -Uri ($script:base + $Path) -Method Post -ContentType 'application/json' -Body $Json -TimeoutSec 6); return $true } catch { return $false }
}
function Get-StartWithWindows {
    try { return [bool](((Invoke-WebRequest -UseBasicParsing -Uri ($script:base + 'api/settings') -TimeoutSec 4).Content | ConvertFrom-Json).settings.startWithWindows) } catch { return $false }
}

$icoPath = Join-Path (Join-Path (Join-Path $Root 'core') 'branding') 'droid-adb.ico'
$icon = [Drawing.SystemIcons]::Application
try { if (Test-Path -LiteralPath $icoPath) { $icon = New-Object Drawing.Icon($icoPath) } } catch {}

$script:ni = New-Object Windows.Forms.NotifyIcon
$script:ni.Icon = $icon
$script:ni.Text = 'DROID ADB (running)'
$menu = New-Object Windows.Forms.ContextMenuStrip

$miOpen = $menu.Items.Add('Open dashboard')
$miOpen.Font = New-Object Drawing.Font($miOpen.Font, [Drawing.FontStyle]::Bold)
$miOpen.add_Click({ Start-Process $script:base })

$miRestart = $menu.Items.Add('Restart service')
$miRestart.add_Click({ [void](Send-Api 'api/backend' '{"action":"restart"}') })

$miStartup = New-Object Windows.Forms.ToolStripMenuItem('Start with Windows')
$miStartup.CheckOnClick = $false
$miStartup.add_Click({
    $want = -not (Get-StartWithWindows)
    [void](Send-Api 'api/settings' ('{"patch":{"startWithWindows":' + $(if ($want) { 'true' } else { 'false' }) + '}}'))
})
[void]$menu.Items.Add($miStartup)
[void]$menu.Items.Add('-')

$miQuit = $menu.Items.Add('Quit DROID ADB')
$miQuit.add_Click({ [void](Send-Api 'api/backend' '{"action":"quit"}'); Stop-Tray })

$menu.add_Opening({ $miStartup.Checked = (Get-StartWithWindows) })
$script:ni.ContextMenuStrip = $menu
$script:ni.add_DoubleClick({ Start-Process $script:base })

function Stop-Tray {
    try { $script:timer.Stop() } catch {}
    try { $script:ni.Visible = $false; $script:ni.Dispose() } catch {}
    try { Remove-Item -LiteralPath (Join-Path $LogDir 'tray.pid') -Force -ErrorAction SilentlyContinue } catch {}
    [Windows.Forms.Application]::Exit()
}

# the icon goes away by itself when the service has been gone for about 40 seconds (a restart takes only a few)
$script:down = 0
$script:timer = New-Object Windows.Forms.Timer
$script:timer.Interval = 5000
$script:timer.add_Tick({
    if (Test-ServiceUp) { $script:down = 0 } else { $script:down++; if ($script:down -ge 8) { Stop-Tray } }
})
$script:timer.Start()
$script:ni.Visible = $true
[Windows.Forms.Application]::Run()
try { $script:mutex.ReleaseMutex() } catch {}
