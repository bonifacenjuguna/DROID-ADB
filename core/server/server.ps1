$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$Port = 47821
$HostHeader = "127.0.0.1:$Port"
$OwnOrigin = "http://$HostHeader"
$Started = Get-Date
$Listener = New-Object Net.HttpListener
$Listener.Prefixes.Add("http://127.0.0.1:$Port/")
$script:Activity = New-Object System.Collections.ArrayList

function Add-Activity {
    param([string]$Kind, [string]$Text)
    $entry = @{ t = (Get-Date).ToString('o'); kind = $Kind; text = $Text }
    [void]$script:Activity.Insert(0, $entry)
    while ($script:Activity.Count -gt 60) { $script:Activity.RemoveAt($script:Activity.Count - 1) }
    try { Add-Content -LiteralPath (Join-Path $LogDir 'activity.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Kind + '  ' + $Text) } catch {}
}

function Send-Json {
    param($Context, $Data, [int]$Status = 200)
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Data -Depth 8 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.Headers['Cache-Control'] = 'no-store'
    if ($Context.Request.Headers['Origin'] -eq 'null') { $Context.Response.Headers['Access-Control-Allow-Origin'] = 'null' }
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

function Send-Bytes {
    param($Context, [byte[]]$Bytes, [string]$Type, [string]$Cache = 'no-store')
    $Context.Response.StatusCode = 200
    $Context.Response.ContentType = $Type
    $Context.Response.Headers['Cache-Control'] = $Cache
    $Context.Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Context.Response.ContentLength64 = $Bytes.Length
    $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Context.Response.Close()
}

$MimeTypes = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon' }

function Send-Static {
    param($Context, [string]$Relative)
    $rel = $Relative.TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root ($rel -replace '/', '\')))
    $assets = [IO.Path]::GetFullPath((Join-Path $Root 'assets')) + '\'
    $index = [IO.Path]::GetFullPath((Join-Path $Root 'index.html'))
    $ext = [IO.Path]::GetExtension($full).ToLower()
    if (-not (($full -eq $index) -or $full.StartsWith($assets, [StringComparison]::OrdinalIgnoreCase)) -or -not $MimeTypes.ContainsKey($ext) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Json $Context @{ error = 'Not found.' } 404
        return
    }
    Send-Bytes $Context ([IO.File]::ReadAllBytes($full)) $MimeTypes[$ext]
}

function Read-Body {
    param($Request)
    if ($Request.ContentLength64 -gt 16384) { throw 'Request is too large.' }
    $reader = New-Object IO.StreamReader($Request.InputStream, [Text.Encoding]::UTF8)
    try {
        $raw = $reader.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
        return ($raw | ConvertFrom-Json)
    } finally { $reader.Dispose() }
}

function Get-Devices {
    if (-not (Test-Path -LiteralPath $Adb)) { return @{ devices = @(); message = 'adb.exe is missing from core/scrcpy.' } }
    $r = Invoke-Adb 'devices -l' 15
    $items = @()
    foreach ($line in (($r.out + "`n" + $r.err) -split "`r?`n")) {
        if ($line -match '^([^\s]+)\s+(device|unauthorized|offline)(?:\s+(.*))?$') {
            $id = $Matches[1]
            $items += @{ id = $id; state = $Matches[2]; details = ([string]$Matches[3]).Trim(); transport = $(if ($id -match ':\d+$') { 'wifi' } else { 'usb' }) }
        }
    }
    $message = ''
    if ($items.Count -eq 0) { $message = 'No device detected. Connect USB, enable USB debugging, and authorize this computer.' }
    return @{ devices = @($items); message = $message }
}

function Get-DeviceInfo {
    param([string]$Serial)
    Test-Serial $Serial
    $cmd = 'echo model=$(getprop ro.product.model);echo maker=$(getprop ro.product.manufacturer);echo release=$(getprop ro.build.version.release);echo sdk=$(getprop ro.build.version.sdk);echo size=$(wm size | tail -n 1);echo density=$(wm density | tail -n 1);echo df=$(df -k /data | tail -n 1);dumpsys battery'
    $sel = ''
    if ($Serial) { $sel = "-s $Serial " }
    $r = Invoke-Adb ($sel + 'shell "' + $cmd + '"') 15
    $t = $r.out
    function Grab([string]$pattern) { if ($t -match $pattern) { return $Matches[1].Trim() } else { return '' } }
    $info = @{ id = $Serial }
    $info.model = Grab '(?m)^model=(.*)$'
    $info.manufacturer = Grab '(?m)^maker=(.*)$'
    $info.android = Grab '(?m)^release=(.*)$'
    $info.sdk = Grab '(?m)^sdk=(.*)$'
    $info.width = 0; $info.height = 0; $info.density = 0
    if ($t -match '(?m)^size=.*?(\d{3,5})x(\d{3,5})') { $info.width = [int]$Matches[1]; $info.height = [int]$Matches[2] }
    if ($t -match '(?m)^density=.*?(\d{2,4})\s*$') { $info.density = [int]$Matches[1] }
    $info.battery = -1; $info.charging = $false; $info.tempC = $null
    if ($t -match '(?m)^\s*level:\s*(\d+)') { $info.battery = [int]$Matches[1] }
    if ($t -match '(?m)^\s*status:\s*(\d+)') { $info.charging = ([int]$Matches[1] -eq 2) }
    if ($t -match '(?m)^\s*temperature:\s*(\d+)') { $info.tempC = [math]::Round([int]$Matches[1] / 10, 1) }
    $info.storageTotal = 0; $info.storageFree = 0
    if ($t -match '(?m)^df=.*?\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%') { $info.storageTotal = [long]$Matches[1] * 1024; $info.storageFree = [long]$Matches[3] * 1024 }
    return $info
}

function Get-ToolkitScrcpyProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -eq [IO.Path]::GetFullPath($Scrcpy)) })
}

function Get-ToolkitSessions {
    $sessions = @()
    foreach ($proc in (Get-ToolkitScrcpyProcesses)) {
        $cmdLine = [string]$proc.CommandLine
        $isRecording = ($cmdLine -match '(?i)--record(?:\s|=)')
        $started = $null
        try { if ($proc.CreationDate) { $started = ([datetime]$proc.CreationDate).ToString('o') } } catch {}
        $file = ''; $fileSize = [long]0
        if ($isRecording -and $cmdLine -match '(?i)--record\s+"([^"]+)"') {
            $file = [IO.Path]::GetFileName($Matches[1])
            $p = Join-Path $RecordDir $file
            if (Test-Path -LiteralPath $p) { $fileSize = [long](Get-Item -LiteralPath $p).Length }
        }
        $serial = ''
        if ($cmdLine -match '\s-s\s+([A-Za-z0-9._:\-]+)') { $serial = $Matches[1] }
        $sessions += @{ pid = [int]$proc.ProcessId; recording = [bool]$isRecording; type = $(if ($isRecording) { 'Recording' } else { 'Mirroring' }); started = $started; file = $file; fileSize = $fileSize; serial = $serial }
    }
    return @{ sessions = @($sessions); count = $sessions.Count; recordingCount = @($sessions | Where-Object { $_.recording }).Count }
}

function Get-DiskInfo {
    try {
        $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($Root))
        return @{ free = [long]$drive.AvailableFreeSpace; total = [long]$drive.TotalSize }
    } catch { return @{ free = 0; total = 0 } }
}

function Get-SafeFile {
    param([string]$Dir, [string]$Name, [string]$Pattern)
    if ([string]::IsNullOrWhiteSpace($Name) -or [IO.Path]::GetFileName($Name) -ne $Name -or $Name -notmatch $Pattern) { throw 'Choose a file from the library.' }
    $path = [IO.Path]::GetFullPath((Join-Path $Dir $Name))
    $base = [IO.Path]::GetFullPath($Dir).TrimEnd('\') + '\'
    if (-not $path.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid file path.' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'That file no longer exists.' }
    return $path
}
$VideoPattern = '(?i)\.(mp4|mkv)$'
$ImagePattern = '(?i)\.png$'

function Get-Library {
    param([string]$Kind)
    $dir = $RecordDir; $ext = @('.mp4', '.mkv')
    if ($Kind -eq 'screenshots') { $dir = $ShotDir; $ext = @('.png') }
    $files = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension.ToLower() -in $ext } | Sort-Object LastWriteTime -Descending | ForEach-Object {
        @{ name = $_.Name; size = [long]$_.Length; modified = $_.LastWriteTime.ToString('o') }
    })
    $total = [long]0
    foreach ($f in $files) { $total += [long]$f.size }
    return @{ files = @($files); totalSize = $total; disk = (Get-DiskInfo) }
}

function Resolve-Target {
    param([string]$Serial)
    Test-Serial $Serial
    if ($Serial) { return "-s $Serial " }
    return ''
}

function Save-Screenshot {
    param([string]$Serial)
    $sel = Resolve-Target $Serial
    $remote = '/data/local/tmp/stk-shot.png'
    $name = 'Shot-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.png'
    $dest = Join-Path $ShotDir $name
    $a = Invoke-Adb ($sel + 'shell screencap -p ' + $remote) 20
    if ($a.code -ne 0) { throw ('Screenshot failed: ' + ($a.err + $a.out).Trim()) }
    $b = Invoke-Adb ($sel + 'pull ' + $remote + ' "' + $dest + '"') 30
    [void](Invoke-Adb ($sel + 'shell rm ' + $remote) 8)
    if (-not (Test-Path -LiteralPath $dest)) { throw ('Could not copy the screenshot: ' + ($b.err + $b.out).Trim()) }
    return $name
}

$KeyCodes = @{ back = 4; home = 3; recents = 187; power = 26; volup = 24; voldown = 25; mute = 164; wake = 224; sleep = 223; menu = 82 }

function Invoke-Key {
    param([string]$Serial, [string]$Key)
    $sel = Resolve-Target $Serial
    if ($Key -eq 'notifications') { $r = Invoke-Adb ($sel + 'shell cmd statusbar expand-notifications') 8 }
    elseif ($KeyCodes.ContainsKey($Key)) { $r = Invoke-Adb ($sel + 'shell input keyevent ' + $KeyCodes[$Key]) 8 }
    else { throw 'Unknown key.' }
    if ($r.code -ne 0) { throw ('The phone did not accept the key: ' + ($r.err + $r.out).Trim()) }
}

function Send-PhoneText {
    param([string]$Serial, [string]$Text)
    if ($Text -notmatch '^[A-Za-z0-9 .,@_:/+=\-]{1,120}$') { throw 'Use letters, numbers, spaces and . , @ _ : / + = - only (up to 120 characters).' }
    $sel = Resolve-Target $Serial
    $r = Invoke-Adb ($sel + 'shell input text ' + ($Text -replace ' ', '%s')) 10
    if ($r.code -ne 0) { throw ('The phone did not accept the text: ' + ($r.err + $r.out).Trim()) }
}

function Invoke-Wifi {
    param([string]$Action, [string]$Serial, [string]$Address)
    switch ($Action) {
        'enable' {
            if (-not $Serial) { throw 'Connect the phone with USB first, then switch to Wi-Fi.' }
            Test-Serial $Serial
            $ipOut = Invoke-Adb ('-s ' + $Serial + ' shell ip -f inet addr show wlan0') 10
            if ($ipOut.out -notmatch 'inet\s+(\d+\.\d+\.\d+\.\d+)') { throw 'Could not read the phone Wi-Fi address. Connect the phone to Wi-Fi and try again.' }
            $ip = $Matches[1]
            [void](Invoke-Adb ('-s ' + $Serial + ' tcpip 5555') 10)
            Start-Sleep -Seconds 2
            $c = Invoke-Adb ('connect ' + $ip + ':5555') 12
            if (($c.out + $c.err) -notmatch 'connected to') { throw ('Wi-Fi connection failed: ' + ($c.out + $c.err).Trim()) }
            return @{ message = 'Connected over Wi-Fi at ' + $ip + ':5555. You can unplug the cable.'; address = ($ip + ':5555') }
        }
        'connect' {
            if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$') { throw 'Enter an address like 192.168.1.20 or 192.168.1.20:5555.' }
            $target = $Address
            if ($target -notmatch ':') { $target += ':5555' }
            $c = Invoke-Adb ('connect ' + $target) 12
            if (($c.out + $c.err) -notmatch 'connected to') { throw ('Could not connect: ' + ($c.out + $c.err).Trim()) }
            return @{ message = 'Connected to ' + $target + '.'; address = $target }
        }
        'disconnect' {
            if ($Address) {
                if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$') { throw 'That address is not valid.' }
                [void](Invoke-Adb ('disconnect ' + $Address) 8)
            } else { [void](Invoke-Adb 'disconnect' 8) }
            return @{ message = 'Wi-Fi device disconnected.' }
        }
        'restart' {
            [void](Invoke-Adb 'kill-server' 8)
            [void](Invoke-Adb 'start-server' 15)
            return @{ message = 'ADB was restarted.' }
        }
        default { throw 'Unknown Wi-Fi action.' }
    }
}

function Get-OldFiles {
    param([string]$Dir, [string[]]$Ext, [int]$Days, [bool]$Delete)
    $cutoff = (Get-Date).AddDays(-$Days)
    return @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension.ToLower() -in $Ext -and $_.LastWriteTime -lt $cutoff })
}

try {
    try { $Listener.Start() } catch {
        ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] Listener startup failed: ' + $_.Exception.ToString()) | Add-Content -LiteralPath (Join-Path $LogDir 'backend-error.log')
        throw
    }
    Add-Activity 'system' 'Backend started.'
    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        try {
            $Request = $Context.Request
            $Path = $Request.Url.AbsolutePath.TrimEnd('/')
            $Method = $Request.HttpMethod
            $Origin = $Request.Headers['Origin']
            if ($Request.Headers['Host'] -ne $HostHeader) { Send-Json $Context @{ error = 'Unexpected host.' } 403; continue }
            if (-not [string]::IsNullOrEmpty($Origin) -and $Origin -ne 'null' -and $Origin -ne $OwnOrigin) {
                Send-Json $Context @{ error = 'This local API only accepts the local dashboard.' } 403; continue
            }
            if ($Method -eq 'OPTIONS') {
                $Context.Response.StatusCode = 204
                $Context.Response.Headers['Access-Control-Allow-Origin'] = 'null'
                $Context.Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
                $Context.Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
                $Context.Response.Close(); continue
            }
            if ($Method -eq 'GET' -and ($Path -eq '' -or $Path -eq '/index.html' -or $Path.StartsWith('/assets/'))) { Send-Static $Context $Path; continue }

            if ($Method -eq 'GET' -and $Path -eq '/api/status') {
                $disk = Get-DiskInfo
                Send-Json $Context @{ ok = $true; version = $ToolkitVersion; uptime = [int]((Get-Date) - $Started).TotalSeconds; scrcpy = (Test-Path -LiteralPath $Scrcpy); adb = (Test-Path -LiteralPath $Adb); port = $Port; root = $Root; disk = $disk }
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/devices') {
                Send-Json $Context (Get-Devices)
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/device-info') {
                Send-Json $Context @{ info = (Get-DeviceInfo ([string]$Request.QueryString['id'])) }
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/session') {
                Send-Json $Context (Get-ToolkitSessions)
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/recordings') {
                Send-Json $Context (Get-Library 'recordings')
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/screenshots') {
                Send-Json $Context (Get-Library 'screenshots')
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/activity') {
                Send-Json $Context @{ items = @($script:Activity) }
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/log') {
                $logPath = Join-Path $LogDir 'scrcpy-last.log'
                $text = ''
                if (Test-Path -LiteralPath $logPath) { $text = [string](Get-Content -Raw -LiteralPath $logPath -ErrorAction SilentlyContinue) }
                if ($text.Length -gt 4000) { $text = $text.Substring($text.Length - 4000) }
                Send-Json $Context @{ log = $text }
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/file') {
                $file = Get-SafeFile $ShotDir ([string]$Request.QueryString['name']) $ImagePattern
                Send-Bytes $Context ([IO.File]::ReadAllBytes($file)) 'image/png' 'private, max-age=3600'
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/settings') {
                Send-Json $Context @{ settings = (Get-Settings) }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/settings') {
                $saved = ConvertTo-Settings (Read-Body $Request)
                $saved | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $ConfigFile
                Send-Json $Context @{ ok = $true; settings = $saved }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/preview') {
                $body = Read-Body $Request
                $mode = [string](Get-Prop $body 'mode' 'mirror')
                if ($mode -notin @('mirror', 'record')) { throw 'Unknown mode.' }
                $s = ConvertTo-Settings (Get-Prop $body 'settings' @{})
                $cmd = New-ScrcpyArgs -S $s -Mode $mode -Serial ([string](Get-Prop $body 'serial' '')) -OutFile (Join-Path $RecordDir 'Phone-<time>.mkv')
                Send-Json $Context @{ command = ('scrcpy.exe ' + $cmd) }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/action') {
                $body = Read-Body $Request
                $serial = [string](Get-Prop $body 'serial' '')
                switch ([string]$body.action) {
                    { $_ -in @('mirror', 'record') } {
                        $mode = [string]$body.action
                        if ((Get-ToolkitScrcpyProcesses).Count -gt 0) { throw 'A toolkit scrcpy window is already open. Close it first; one window mirrors and records at the same time.' }
                        $started = Start-ToolkitScrcpy -Mode $mode -Serial $serial
                        if ($mode -eq 'record') { Add-Activity 'record' ('Recording started: ' + $started.file); $msg = 'Recording to ' + $started.file + '. Close the scrcpy window to finish the file.' }
                        else { Add-Activity 'mirror' 'Mirror window opened.'; $msg = 'Mirror window opening.' }
                        Send-Json $Context @{ ok = $true; message = $msg; file = $started.file }
                    }
                    'screenshot' {
                        $name = Save-Screenshot $serial
                        Add-Activity 'screenshot' ('Screenshot saved: ' + $name)
                        Send-Json $Context @{ ok = $true; message = 'Screenshot saved.'; name = $name }
                    }
                    'stop' {
                        $targets = @(Get-ToolkitScrcpyProcesses)
                        $requested = 0
                        foreach ($item in $targets) {
                            $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
                            if ($p -and $p.MainWindowHandle -ne 0 -and $p.CloseMainWindow()) { $requested++ }
                        }
                        $deadline = (Get-Date).AddSeconds(3)
                        do {
                            Start-Sleep -Milliseconds 250
                            $remaining = @($targets | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
                        } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
                        $forced = 0
                        foreach ($item in $remaining) {
                            if (Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue; $forced++ }
                        }
                        if ($targets.Count -eq 0) { $message = 'No toolkit window was open.' }
                        elseif ($forced -gt 0) { $message = "Closed $requested window(s) gracefully and force-closed $forced. A force-closed recording may not finish correctly." }
                        else { $message = "Closed $requested window(s) gracefully." }
                        if ($targets.Count -gt 0) { Add-Activity 'stop' $message }
                        Send-Json $Context @{ ok = $true; message = $message; requested = $requested; forced = $forced }
                    }
                    'check' { Send-Json $Context (Get-Devices) }
                    default { Send-Json $Context @{ error = 'Unknown action.' } 400 }
                }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/key') {
                $body = Read-Body $Request
                Invoke-Key ([string](Get-Prop $body 'serial' '')) ([string](Get-Prop $body 'key' ''))
                Send-Json $Context @{ ok = $true }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/text') {
                $body = Read-Body $Request
                Send-PhoneText ([string](Get-Prop $body 'serial' '')) ([string](Get-Prop $body 'text' ''))
                Send-Json $Context @{ ok = $true; message = 'Text sent to the phone.' }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/wifi') {
                $body = Read-Body $Request
                $result = Invoke-Wifi ([string](Get-Prop $body 'action' '')) ([string](Get-Prop $body 'serial' '')) ([string](Get-Prop $body 'address' ''))
                Add-Activity 'wifi' $result.message
                Send-Json $Context (@{ ok = $true } + $result)
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/open-folder') {
                $body = Read-Body $Request
                $dir = $RecordDir
                if ([string](Get-Prop $body 'kind' 'recordings') -eq 'screenshots') { $dir = $ShotDir }
                Start-Process explorer.exe -ArgumentList @($dir)
                Send-Json $Context @{ ok = $true }
            } elseif ($Method -eq 'POST' -and $Path -in @('/api/open-recording', '/api/reveal-recording', '/api/open-file', '/api/reveal-file')) {
                $body = Read-Body $Request
                $kind = [string](Get-Prop $body 'kind' 'recordings')
                if ($kind -eq 'screenshots') { $filePath = Get-SafeFile $ShotDir ([string]$body.name) $ImagePattern }
                else { $filePath = Get-SafeFile $RecordDir ([string]$body.name) $VideoPattern }
                if ($Path -like '*reveal*') { Start-Process -FilePath explorer.exe -ArgumentList ('/select,"' + $filePath + '"') }
                else { Start-Process -FilePath $filePath }
                Send-Json $Context @{ ok = $true }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/delete-file') {
                $body = Read-Body $Request
                $kind = [string](Get-Prop $body 'kind' 'recordings')
                if ($kind -eq 'screenshots') { $filePath = Get-SafeFile $ShotDir ([string]$body.name) $ImagePattern }
                else {
                    $filePath = Get-SafeFile $RecordDir ([string]$body.name) $VideoPattern
                    foreach ($s in (Get-ToolkitSessions).sessions) { if ($s.file -eq [string]$body.name) { throw 'This recording is still in progress. Close its scrcpy window first.' } }
                }
                Remove-Item -LiteralPath $filePath -Force
                Add-Activity 'delete' ('Deleted ' + [IO.Path]::GetFileName($filePath))
                Send-Json $Context @{ ok = $true }
            } elseif ($Method -eq 'GET' -and $Path -eq '/api/cleanup-preview') {
                $days = 30
                if ($Request.QueryString['days'] -match '^\d+$') { $days = [int]$Request.QueryString['days'] }
                if ($days -notin @(30, 60, 90, 180)) { throw 'Choose 30, 60, 90, or 180 days.' }
                $kind = [string]$Request.QueryString['kind']
                if ($kind -eq 'screenshots') { $old = Get-OldFiles $ShotDir @('.png') $days $false } else { $old = Get-OldFiles $RecordDir @('.mp4', '.mkv') $days $false }
                Send-Json $Context @{ files = @($old | ForEach-Object { @{ name = $_.Name; size = [long]$_.Length } }); days = $days }
            } elseif ($Method -eq 'POST' -and $Path -eq '/api/cleanup') {
                $body = Read-Body $Request
                $days = [int]$body.days
                if ($days -notin @(30, 60, 90, 180) -or -not [bool]$body.confirm) { throw 'Cleanup was not confirmed or the age selection is invalid.' }
                if ([string](Get-Prop $body 'kind' 'recordings') -eq 'screenshots') { $old = Get-OldFiles $ShotDir @('.png') $days $true } else { $old = Get-OldFiles $RecordDir @('.mp4', '.mkv') $days $true }
                $deleted = 0; $freed = [long]0
                foreach ($file in $old) { $freed += [long]$file.Length; Remove-Item -LiteralPath $file.FullName -Force; $deleted++ }
                if ($deleted -gt 0) { Add-Activity 'delete' ("Cleanup removed $deleted file(s).") }
                Send-Json $Context @{ ok = $true; deleted = $deleted; freed = $freed }
            } else {
                Send-Json $Context @{ error = 'Endpoint not found.' } 404
            }
        } catch {
            try { Send-Json $Context @{ error = $_.Exception.Message } 400 } catch { try { $Context.Response.Close() } catch {} }
        }
    }
} finally {
    try { if ($Listener.IsListening) { $Listener.Stop() } } catch {}
    try { $Listener.Close() } catch {}
}
