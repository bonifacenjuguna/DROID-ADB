# DROID ADB HTTP helpers and API routes. ASCII only.
# Dot-sourced after lib.ps1 by the main thread (for static files) and by every worker runspace (for the API).

$MimeTypes = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.webmanifest' = 'application/manifest+json'; '.json' = 'application/json; charset=utf-8'; '.mkv' = 'video/x-matroska'; '.mp4' = 'video/mp4'; '.gif' = 'image/gif' }
$CspValue = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

function Set-CommonHeaders {
    param($Ctx)
    $h = $Ctx.Response.Headers
    $h['X-Content-Type-Options'] = 'nosniff'
    $h['Referrer-Policy'] = 'no-referrer'
    $h['X-Frame-Options'] = 'DENY'
    $h['Content-Security-Policy'] = $CspValue
}

function Send-Bytes {
    param($Ctx, [byte[]]$Bytes, [string]$Type, [int]$Status = 200, [string]$Cache = 'no-store', $Extra = $null)
    $res = $Ctx.Response
    try {
        $res.StatusCode = $Status
        $res.ContentType = $Type
        $res.Headers['Cache-Control'] = $Cache
        if ($Extra) { foreach ($k in $Extra.Keys) { $res.Headers[[string]$k] = [string]$Extra[$k] } }
        Set-CommonHeaders $Ctx
        $res.ContentLength64 = $Bytes.Length
        if ($Ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($Bytes, 0, $Bytes.Length) }
    } finally { try { $res.Close() } catch {} }
}

function Send-Json {
    param($Ctx, $Data, [int]$Status = 200)
    $json = ConvertTo-Json -InputObject $Data -Depth 8 -Compress
    Send-Bytes $Ctx ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $Status
}

function Send-Static {
    param($Ctx, [string]$Relative)
    $rel = $Relative.TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
    $assets = [IO.Path]::GetFullPath((Join-Path $Root 'assets')) + [IO.Path]::DirectorySeparatorChar
    $index = [IO.Path]::GetFullPath((Join-Path $Root 'index.html'))
    $ext = [IO.Path]::GetExtension($full).ToLower()
    if (-not (($full -eq $index) -or $full.StartsWith($assets, [StringComparison]::OrdinalIgnoreCase)) -or -not $MimeTypes.ContainsKey($ext) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Json $Ctx @{ error = 'Not found.' } 404
        return
    }
    Send-Bytes $Ctx ([IO.File]::ReadAllBytes($full)) $MimeTypes[$ext]
}

# Streams a file with HTTP range support so videos can seek and play while still growing.
function Send-File {
    param($Ctx, [string]$Path, [string]$Type, [string]$DownloadName = '', [string]$CacheControl = 'no-store')
    $res = $Ctx.Response
    $fs = $null
    try {
        $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        $len = [long]$fs.Length
        $start = [long]0
        $end = $len - 1
        $status = 200
        $range = [string]$Ctx.Request.Headers['Range']
        if ($range -match '^bytes=(\d*)-(\d*)$' -and $len -gt 0) {
            if ($Matches[1] -ne '') {
                $start = [long]$Matches[1]
                if ($Matches[2] -ne '') { $end = [long]$Matches[2] }
            } elseif ($Matches[2] -ne '') {
                $start = [math]::Max(0, $len - [long]$Matches[2])
            }
            if ($end -ge $len) { $end = $len - 1 }
            if ($start -gt $end) { $res.StatusCode = 416; $res.Headers['Content-Range'] = 'bytes */' + $len; $res.Close(); return }
            $status = 206
        }
        $count = [long]0
        if ($len -gt 0) { $count = $end - $start + 1 }
        $res.StatusCode = $status
        $res.ContentType = $Type
        $res.Headers['Accept-Ranges'] = 'bytes'
        $res.Headers['Cache-Control'] = $CacheControl
        Set-CommonHeaders $Ctx
        if ($status -eq 206) { $res.Headers['Content-Range'] = 'bytes ' + $start + '-' + $end + '/' + $len }
        if ($DownloadName) { $res.Headers['Content-Disposition'] = 'attachment; filename="' + $DownloadName + '"' }
        $res.ContentLength64 = $count
        if ($Ctx.Request.HttpMethod -ne 'HEAD' -and $count -gt 0) {
            [void]$fs.Seek($start, [IO.SeekOrigin]::Begin)
            $buf = New-Object byte[] 262144
            $left = $count
            while ($left -gt 0) {
                $n = $fs.Read($buf, 0, [int][math]::Min($buf.Length, $left))
                if ($n -le 0) { break }
                $res.OutputStream.Write($buf, 0, $n)
                $left -= $n
            }
        }
    } catch {
        # The browser closed the connection (for example while seeking in a video). Nothing to report.
    } finally {
        if ($fs) { $fs.Dispose() }
        try { $res.Close() } catch {}
    }
}

function Get-Query {
    param($Ctx, [string]$Name)
    return [string]$Ctx.Request.QueryString[$Name]
}

function Read-JsonBody {
    param($Ctx, [int]$MaxBytes = 262144)
    $req = $Ctx.Request
    if ($req.ContentLength64 -gt $MaxBytes) { Fail 'Request is too large.' }
    # Read in pieces so a body sent without a length cannot grow past the limit.
    $ms = New-Object IO.MemoryStream
    try {
        $buf = New-Object byte[] 16384
        $inp = $req.InputStream
        while (($n = $inp.Read($buf, 0, $buf.Length)) -gt 0) {
            $ms.Write($buf, 0, $n)
            if ($ms.Length -gt $MaxBytes) { Fail 'Request is too large.' }
        }
        $raw = [Text.Encoding]::UTF8.GetString($ms.ToArray()).TrimStart([char]0xFEFF)
    } finally { $ms.Dispose() }
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    try { $obj = $raw | ConvertFrom-Json } catch { Fail 'The request was not valid JSON.' }
    $h = ConvertTo-Hash $obj
    if ($h -isnot [hashtable]) { return @{} }
    return $h
}

# Saves an uploaded body to a file. Returns the byte count.
function Save-Upload {
    param($Ctx, [string]$Path)
    $maxBytes = [long]((Get-Settings).maxUploadMB) * 1MB
    if ($Ctx.Request.ContentLength64 -gt $maxBytes) { Fail ('That file is larger than the upload limit of ' + (Get-Settings).maxUploadMB + ' MB. Raise it in Settings.') }
    $out = [IO.File]::Create($Path)
    try {
        $buf = New-Object byte[] 262144
        $total = [long]0
        $inp = $Ctx.Request.InputStream
        while (($n = $inp.Read($buf, 0, $buf.Length)) -gt 0) {
            $total += $n
            if ($total -gt $maxBytes) { Fail 'The upload is larger than the limit set in Settings.' }
            $out.Write($buf, 0, $n)
        }
        return $total
    } finally { $out.Dispose() }
}

function Open-OnPc {
    param([string]$Target, [switch]$Reveal)
    if (-not $OnWindows) { Fail 'Opening files and folders needs Windows.' }
    if ($Reveal) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('/select,"' + $Target + '"') } else { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $Target + '"') }
}

# ---------------------------------------------------------------------------
# Phone helpers
# ---------------------------------------------------------------------------
function ConvertFrom-KeyLines {
    param([string]$Text)
    $h = @{}
    foreach ($line in ($Text -split "`r?`n")) { if ($line -match '^([A-Za-z0-9_]+)=(.*)$') { $h[$Matches[1]] = $Matches[2].Trim() } }
    return $h
}

function Test-PackageName {
    param([string]$Name)
    if ($Name.Length -gt 150 -or $Name -notmatch '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$') { Fail 'That is not a valid app package name.' }
}

function Test-PhonePath {
    param([string]$Path)
    if ($Path.Length -gt 400 -or $Path -notmatch '^/[A-Za-z0-9 ._\-/()+@,=#~]*$' -or $Path -match '(^|/)\.\.(/|$)') { Fail 'That phone path is not allowed.' }
}

function Get-DeviceInfo {
    param([string]$Serial, [bool]$Fresh = $false)
    Test-Serial $Serial
    $key = $Serial
    if (-not $key) { $key = '_default' }
    $cached = $Shared.info[$key]
    if (-not $Fresh -and $cached -and ((Get-Date) - $cached.at).TotalSeconds -lt 20) { return $cached.data }
    $cmd = @(
        'echo model=$(getprop ro.product.model)', 'echo maker=$(getprop ro.product.manufacturer)', 'echo release=$(getprop ro.build.version.release)',
        'echo sdk=$(getprop ro.build.version.sdk)', 'echo patch=$(getprop ro.build.version.security_patch)', 'echo build=$(getprop ro.build.display.id)',
        'echo abi=$(getprop ro.product.cpu.abi)', 'echo size=$(wm size | tail -n 1)', 'echo density=$(wm density | tail -n 1)',
        'echo df=$(df -k /data | tail -n 1)', 'echo memtotal=$(grep MemTotal /proc/meminfo)', 'echo memavail=$(grep MemAvailable /proc/meminfo)',
        'echo uptime=$(cut -d'' '' -f1 /proc/uptime)', 'echo ip=$(ip -f inet addr show wlan0 2>/dev/null | grep -o ''inet [0-9.]*'' | head -n 1)', 'dumpsys battery'
    ) -join ';'
    $r = Invoke-DeviceShell $Serial $cmd 20
    $t = $r.out
    $kv = ConvertFrom-KeyLines $t
    $info = @{ id = $Serial }
    $info.model = [string]$kv.model
    $info.manufacturer = [string]$kv.maker
    $info.android = [string]$kv.release
    $info.sdk = [string]$kv.sdk
    $info.patch = [string]$kv.patch
    $info.build = [string]$kv.build
    $info.abi = [string]$kv.abi
    $info.width = 0; $info.height = 0; $info.density = 0
    if ($kv.size -match '(\d{3,5})x(\d{3,5})') { $info.width = [int]$Matches[1]; $info.height = [int]$Matches[2] }
    if ($kv.density -match '(\d{2,4})\s*$') { $info.density = [int]$Matches[1] }
    $info.battery = -1; $info.charging = $false; $info.tempC = $null; $info.voltage = $null; $info.power = ''
    if ($t -match '(?m)^\s*level:\s*(\d+)') { $info.battery = [int]$Matches[1] }
    if ($t -match '(?m)^\s*status:\s*(\d+)') { $info.charging = ([int]$Matches[1] -eq 2) }
    if ($t -match '(?m)^\s*temperature:\s*(\d+)') { $info.tempC = [math]::Round([int]$Matches[1] / 10, 1) }
    if ($t -match '(?m)^\s*voltage:\s*(\d+)') { $info.voltage = [int]$Matches[1] }
    if ($t -match '(?m)^\s*AC powered:\s*true') { $info.power = 'AC' } elseif ($t -match '(?m)^\s*USB powered:\s*true') { $info.power = 'USB' } elseif ($t -match '(?m)^\s*Wireless powered:\s*true') { $info.power = 'Wireless' }
    $info.storageTotal = [long]0; $info.storageFree = [long]0
    if ($kv.df -match '\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%') { $info.storageTotal = [long]$Matches[1] * 1024; $info.storageFree = [long]$Matches[3] * 1024 }
    $info.ramTotal = [long]0; $info.ramFree = [long]0
    if ($kv.memtotal -match '(\d+)') { $info.ramTotal = [long]$Matches[1] * 1024 }
    if ($kv.memavail -match '(\d+)') { $info.ramFree = [long]$Matches[1] * 1024 }
    $info.uptimeSec = 0
    if ($kv.uptime -match '^(\d+)') { $info.uptimeSec = [int]$Matches[1] }
    $info.ip = ''
    if ($kv.ip -match 'inet (\d+\.\d+\.\d+\.\d+)') { $info.ip = $Matches[1] }
    $Shared.info[$key] = @{ at = (Get-Date); data = $info }
    return $info
}

$KeyCodes = @{ back = 4; home = 3; recents = 187; power = 26; volup = 24; voldown = 25; mute = 164; wake = 224; sleep = 223; menu = 82; assistant = 231; camera = 27; playpause = 85; next = 87; prev = 88; brightup = 221; brightdown = 220; enter = 66; tab = 61; del = 67; up = 19; down = 20; left = 21; right = 22; search = 84 }

function Invoke-Key {
    param([string]$Serial, [string]$Key)
    if ($Key -eq 'camera') { Open-PhoneCamera $Serial; return }
    if ($Key -eq 'notifications') { $r = Invoke-DeviceShell $Serial 'cmd statusbar expand-notifications' 10 }
    elseif ($Key -eq 'quicksettings') { $r = Invoke-DeviceShell $Serial 'cmd statusbar expand-settings' 10 }
    elseif ($Key -eq 'collapse') { $r = Invoke-DeviceShell $Serial 'cmd statusbar collapse' 10 }
    elseif ($KeyCodes.ContainsKey($Key)) { $r = Invoke-DeviceShell $Serial ('input keyevent ' + $KeyCodes[$Key]) 10 }
    else { Fail 'Unknown key.' }
    if ($r.code -ne 0) { Fail ('The phone did not accept the key: ' + ($r.err + $r.out).Trim()) }
}

# Opens the phone's camera app. The old camera "key" only sent KEYCODE_CAMERA, which most phones ignore,
# so the button looked dead. Launching the camera intent works on stock Android and on the common skins.
function Open-PhoneCamera {
    param([string]$Serial)
    [void](Invoke-DeviceShell $Serial 'input keyevent 224' 8)   # wake the screen first
    $tries = @(
        'am start -a android.media.action.STILL_IMAGE_CAMERA',
        'am start -a android.media.action.IMAGE_CAPTURE',
        'am start -a android.media.action.STILL_IMAGE_CAMERA_SECURE',
        'monkey -p com.android.camera -c android.intent.category.LAUNCHER 1',
        'monkey -p com.google.android.GoogleCamera -c android.intent.category.LAUNCHER 1',
        'monkey -p com.sec.android.app.camera -c android.intent.category.LAUNCHER 1'
    )
    $last = ''
    foreach ($t in $tries) {
        $r = Invoke-DeviceShell $Serial $t 12
        $txt = ($r.out + ' ' + $r.err)
        $last = $txt.Trim()
        if ($r.code -eq 0 -and $txt -notmatch '(?i)error|exception|unable to resolve|no activities found|monkey aborted|No activities') { return }
    }
    # Last resort: the hardware camera key.
    $r = Invoke-DeviceShell $Serial 'input keyevent 27' 8
    if ($r.code -ne 0) { Fail ('The phone has no camera app that could be opened. ' + $last) }
}

$ToggleDefs = @{
    wifi           = @{ on = 'svc wifi enable'; off = 'svc wifi disable' }
    data           = @{ on = 'svc data enable'; off = 'svc data disable' }
    bluetooth      = @{ on = 'svc bluetooth enable'; off = 'svc bluetooth disable' }
    airplane       = @{ on = 'cmd connectivity airplane-mode enable'; off = 'cmd connectivity airplane-mode disable' }
    rotation       = @{ on = 'settings put system accelerometer_rotation 1'; off = 'settings put system accelerometer_rotation 0' }
    touches        = @{ on = 'settings put system show_touches 1'; off = 'settings put system show_touches 0' }
    pointer        = @{ on = 'settings put system pointer_location 1'; off = 'settings put system pointer_location 0' }
    stayawake      = @{ on = 'settings put global stay_on_while_plugged_in 7'; off = 'settings put global stay_on_while_plugged_in 0' }
    dark           = @{ on = 'cmd uimode night yes'; off = 'cmd uimode night no' }
    animations     = @{ on = 'settings put global window_animation_scale 1.0;settings put global transition_animation_scale 1.0;settings put global animator_duration_scale 1.0'; off = 'settings put global window_animation_scale 0;settings put global transition_animation_scale 0;settings put global animator_duration_scale 0' }
    autobrightness = @{ on = 'settings put system screen_brightness_mode 1'; off = 'settings put system screen_brightness_mode 0' }
    dnd            = @{ on = 'cmd notification set_dnd priority'; off = 'cmd notification set_dnd off' }
}

function Get-Toggles {
    param([string]$Serial)
    $cmd = @(
        'echo wifi=$(settings get global wifi_on)', 'echo data=$(settings get global mobile_data)', 'echo bluetooth=$(settings get global bluetooth_on)',
        'echo airplane=$(settings get global airplane_mode_on)', 'echo rotation=$(settings get system accelerometer_rotation)', 'echo touches=$(settings get system show_touches)',
        'echo pointer=$(settings get system pointer_location)', 'echo stayawake=$(settings get global stay_on_while_plugged_in)', 'echo dark=$(cmd uimode night | tail -n 1)',
        'echo animations=$(settings get global animator_duration_scale)', 'echo autobrightness=$(settings get system screen_brightness_mode)', 'echo dnd=$(settings get global zen_mode)',
        'echo brightness=$(settings get system screen_brightness)', 'echo timeout=$(settings get system screen_off_timeout)', 'echo volume=$(cmd media_session volume --get --stream 3 2>/dev/null | tail -n 1)'
    ) -join ';'
    $r = Invoke-DeviceShell $Serial $cmd 20
    $kv = ConvertFrom-KeyLines $r.out
    $on = @{}
    $on.wifi = ($kv.wifi -in @('1', '2'))
    $on.data = ($kv.data -eq '1')
    $on.bluetooth = ($kv.bluetooth -in @('1', '2'))
    $on.airplane = ($kv.airplane -eq '1')
    $on.rotation = ($kv.rotation -eq '1')
    $on.touches = ($kv.touches -eq '1')
    $on.pointer = ($kv.pointer -eq '1')
    $on.stayawake = ($kv.stayawake -match '^[1-9]')
    $on.dark = ($kv.dark -match 'yes')
    $on.animations = ($kv.animations -ne '0' -and $kv.animations -ne '0.0')
    $on.autobrightness = ($kv.autobrightness -eq '1')
    $on.dnd = ($kv.dnd -match '^[1-9]')
    $out = @{ toggles = $on; brightness = -1; timeout = 0; volume = $null; volumeMax = $null }
    if ($kv.brightness -match '^\d+$') { $out.brightness = [int]$kv.brightness }
    if ($kv.timeout -match '^\d+$') { $out.timeout = [int]$kv.timeout }
    if ($kv.volume -match 'volume is (\d+) in range \[(\d+)\.\.(\d+)\]') { $out.volume = [int]$Matches[1]; $out.volumeMax = [int]$Matches[3] }
    return $out
}

function Invoke-Wifi {
    param([string]$Action, [string]$Serial, [string]$Address, [string]$Code)
    $s = Get-Settings
    $port = [int]$s.tcpPort
    switch ($Action) {
        'enable' {
            if (-not $Serial) { Fail 'Connect the phone with USB first, then switch to Wi-Fi.' }
            Test-Serial $Serial
            $ip = ''
            $ipOut = Invoke-Adb ('-s ' + $Serial + ' shell ip -f inet addr show wlan0') 12
            if ($ipOut.out -match 'inet\s+(\d+\.\d+\.\d+\.\d+)') { $ip = $Matches[1] }
            else {
                $all = Invoke-Adb ('-s ' + $Serial + ' shell ip -f inet addr show') 12
                foreach ($m in [regex]::Matches($all.out, 'inet\s+((?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))[\d.]+)')) { $ip = $m.Groups[1].Value; break }
            }
            if ($ip -eq '') { Fail 'Could not read the phone Wi-Fi address. Connect the phone to Wi-Fi and try again.' }
            [void](Invoke-Adb ('-s ' + $Serial + ' tcpip ' + $port) 12)
            Start-Sleep -Seconds 2
            $c = Invoke-Adb ('connect ' + $ip + ':' + $port) 15
            if (($c.out + $c.err) -notmatch 'connected to') { Fail ('Wi-Fi connection failed: ' + ($c.out + $c.err).Trim()) }
            Add-WifiHost ($ip + ':' + $port)
            return @{ message = 'Connected over Wi-Fi at ' + $ip + ':' + $port + '. You can unplug the cable.'; address = ($ip + ':' + $port) }
        }
        'connect' {
            if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$') { Fail 'Enter an address like 192.168.1.20 or 192.168.1.20:5555.' }
            $target = $Address
            if ($target -notmatch ':') { $target += ':' + $port }
            $c = Invoke-Adb ('connect ' + $target) 15
            if (($c.out + $c.err) -notmatch 'connected to') { Fail ('Could not connect: ' + ($c.out + $c.err).Trim()) }
            Add-WifiHost $target
            return @{ message = 'Connected to ' + $target + '.'; address = $target }
        }
        'pair' {
            if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$') { Fail 'Enter the pairing address shown on the phone, like 192.168.1.20:37099.' }
            if ($Code -notmatch '^\d{6}$') { Fail 'The pairing code is six digits.' }
            $c = Invoke-Adb ('pair ' + $Address + ' ' + $Code) 25
            if (($c.out + $c.err) -notmatch 'Successfully paired') { Fail ('Pairing failed: ' + ($c.out + $c.err).Trim()) }
            return @{ message = 'Paired. Now connect using the main address shown on the Wireless debugging screen.' }
        }
        'discover' {
            $c = Invoke-Adb 'mdns services' 12
            $found = @()
            foreach ($line in ($c.out -split "`r?`n")) {
                if ($line -match '^(\S+)\s+(_adb[\w\-\._]*)\s+(\d+\.\d+\.\d+\.\d+:\d+)') { $found += , @{ name = $Matches[1]; type = $Matches[2]; address = $Matches[3]; pairing = ($Matches[2] -like '*pairing*') } }
            }
            return @{ message = $(if ($found.Count) { 'Found ' + $found.Count + ' wireless debugging service(s).' } else { 'No wireless debugging services found. Turn on Wireless debugging on the phone.' }); found = @($found) }
        }
        'disconnect' {
            if ($Address) {
                if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$') { Fail 'That address is not valid.' }
                [void](Invoke-Adb ('disconnect ' + $Address) 10)
            } else { [void](Invoke-Adb 'disconnect' 10) }
            return @{ message = 'Wi-Fi device disconnected.' }
        }
        'restart' {
            [void](Invoke-Adb 'kill-server' 10)
            [void](Invoke-Adb 'start-server' 20)
            return @{ message = 'ADB was restarted.' }
        }
        default { Fail 'Unknown Wi-Fi action.' }
    }
}

function Save-Screenshot {
    param([string]$Serial, [string]$Dest = '')
    $sel = Resolve-Target $Serial
    $s = Get-Settings
    $remote = ([string]$s.remoteTmpDir).TrimEnd('/') + '/stk-shot.png'
    if ($Dest -eq '') { $Dest = New-UniquePath (Get-Dir 'screenshots') (New-FileStem $s.screenshotTemplate $Serial) 'png' }
    $a = Invoke-Adb ($sel + 'shell screencap -p ' + $remote) 25
    if ($a.code -ne 0) { Fail ('Screenshot failed: ' + ($a.err + $a.out).Trim()) }
    $b = Invoke-Adb ($sel + 'pull ' + $remote + ' "' + $Dest + '"') 40
    [void](Invoke-Adb ($sel + 'shell rm ' + $remote) 10)
    if (-not (Test-Path -LiteralPath $Dest)) { Fail ('Could not copy the screenshot: ' + ($b.err + $b.out).Trim()) }
    return $Dest
}

function Get-FileSizeLabel { param([long]$n) if ($n -ge 1GB) { return ('{0:N2} GB' -f ($n / 1GB)) } if ($n -ge 1MB) { return ('{0:N1} MB' -f ($n / 1MB)) } return ('{0:N0} KB' -f ($n / 1KB)) }

function Test-WritableDir {
    param([string]$Dir)
    try {
        if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Force -Path $Dir | Out-Null }
        $probe = Join-Path $Dir ('.stk-probe-' + [guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($probe, 'x')
        Remove-Item -LiteralPath $probe -Force
        return $true
    } catch { return $false }
}

function Get-ServerVersions {
    $v = @{ adb = ''; scrcpy = '' }
    try {
        $r = Invoke-Native (Get-AdbPath) 'version' 8
        if (($r.out -split "`r?`n")[0] -match 'version\s+([\d.]+)') { $v.adb = $Matches[1] }
    } catch {}
    try {
        $r = Invoke-Native (Get-ScrcpyPath) '--version' 8
        if (($r.out -split "`r?`n")[0] -match 'scrcpy\s+([\d.]+)') { $v.scrcpy = $Matches[1] }
    } catch {}
    return $v
}

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
$Routes = @{}
# Routes that only read local state (no adb calls). They get their own worker lane.
$FastRoutes = @{}
foreach ($k in @('GET /api/state', 'GET /api/status', 'GET /api/schema', 'GET /api/settings', 'POST /api/settings', 'POST /api/settings/reset', 'GET /api/profiles', 'POST /api/profiles', 'POST /api/profiles/apply', 'POST /api/profiles/delete', 'POST /api/preview', 'GET /api/sessions', 'GET /api/library', 'GET /api/file', 'POST /api/file-op', 'POST /api/delete-files', 'POST /api/open-folder', 'GET /api/cleanup-preview', 'POST /api/cleanup', 'GET /api/activity', 'GET /api/log', 'GET /api/backend-log', 'POST /api/backend', 'GET /api/logs', 'POST /api/logs-clear')) { $FastRoutes[$k] = $true }

$Routes['GET /api/ping'] = { param($Ctx) Send-Json $Ctx @{ ok = $true; version = $ToolkitVersion } }

$Routes['GET /api/state'] = { param($Ctx)
    $since = 0
    [void][int]::TryParse((Get-Query $Ctx 'since'), [ref]$since)
    $sessions = @(Get-LiveSessions | ForEach-Object { Get-SessionView $_ })
    if ((Get-Query $Ctx 'hidden') -ne '1') { $Shared.lastClientMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    $liveOut = @{}
    foreach ($dv in @($Shared.devices | Where-Object { $null -ne $_ -and $_.state -eq 'device' })) { $lv = $Shared.live[[string]$dv.id]; if ($lv) { $liveOut[[string]$dv.id] = $lv } }
    $evCopy = Use-Lock { $Shared.events.ToArray() }
    $events = @($evCopy | Where-Object { [int]$_.id -gt $since })
    $activity = @((Use-Lock { $Shared.activity.ToArray() }) | Select-Object -First 40)
    $at = $Shared.devicesAt
    $age = -1
    if ($at) { $age = [int]((Get-Date) - $at).TotalSeconds }
    $s = Get-Settings
    Send-Json $Ctx @{
        ok = $true; t = (Get-UtcNow); version = $ToolkitVersion; uptime = [int]((Get-Date) - $Shared.started).TotalSeconds
        sessions = $sessions; devices = @($Shared.devices | Where-Object { $null -ne $_ }); deviceMessage = [string]$Shared.deviceMessage; devicesAge = $age; adbLatencyMs = [int]$Shared.adbLatencyMs
        live = $liveOut; events = @($events); eventSeq = [int]$Shared.eventSeq; activity = $activity
        disk = (Get-DiskInfo (Get-Dir 'recordings')); pollSeconds = [int]$s.pollSeconds
    }
}

$Routes['GET /api/status'] = { param($Ctx)
    $s = Get-Settings
    Send-Json $Ctx @{
        ok = $true; version = $ToolkitVersion; uptime = [int]((Get-Date) - $Shared.started).TotalSeconds; port = [int]$Shared.port; workers = [int]$Shared.workerCount
        inflight = [int]$Shared.inflight; platform = $(if ($OnWindows) { 'Windows' } else { 'Other' }); root = $Root; backendPid = $PID
        adbPath = (Get-AdbPath); scrcpyPath = (Get-ScrcpyPath); adbFound = [bool]((Test-Tool (Get-AdbPath)) -or -not $OnWindows); scrcpyFound = [bool]((Test-Tool (Get-ScrcpyPath)) -or -not $OnWindows)
        versions = $Shared.versions
        dirs = @{ recordings = (Get-Dir 'recordings'); screenshots = (Get-Dir 'screenshots'); downloads = (Get-Dir 'downloads'); logs = $LogDir }
        restartRequired = [bool](([int]$s.port -ne [int]$Shared.port) -or ([int]$s.serverWorkers -ne [int]$Shared.workerCount))
    }
}

$Routes['GET /api/schema'] = { param($Ctx)
    Send-Json $Ctx @{ groups = $SettingGroups; fields = $Schema; presets = $Presets; defaults = (Get-Defaults); audioModes = $AudioModes; streamModes = $StreamAudioChoices }
}

$Routes['GET /api/settings'] = { param($Ctx)
    Send-Json $Ctx @{ settings = (Get-Settings); profiles = @(Get-Profiles | ForEach-Object { @{ name = $_.name } }) }
}

function Save-SettingsPatch {
    param([hashtable]$Patch)
    $current = Get-Settings
    $new = ConvertTo-Settings $Patch $current
    foreach ($f in $Schema) {
        if ($f.type -eq 'path' -and $new[$f.key] -ne '' -and $new[$f.key] -ne $current[$f.key]) {
            if ($f.key -like '*Path') { if (-not (Test-Path -LiteralPath $new[$f.key] -PathType Leaf)) { Fail ($f.label + ': that file was not found.') } }
            elseif (-not (Test-WritableDir $new[$f.key])) { Fail ($f.label + ': that folder cannot be created or written to.') }
        }
    }
    if (-not $new.windowTitle) { $new.windowTitle = 'DROID ADB' }
    Save-Settings $new
    return @{ settings = $new; restartRequired = [bool](([int]$new.port -ne [int]$Shared.port) -or ([int]$new.serverWorkers -ne [int]$Shared.workerCount)) }
}

$Routes['POST /api/settings'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $patch = Get-Prop $body 'patch' $body
    if ($patch -isnot [hashtable]) { Fail 'Nothing to save.' }
    $r = Save-SettingsPatch $patch
    Send-Json $Ctx (@{ ok = $true } + $r)
}

$Routes['POST /api/settings/reset'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $keys = @(Get-Prop $body 'keys' @())
    $defaults = Get-Defaults
    $patch = @{}
    if ($keys.Count -eq 0) { foreach ($k in $defaults.Keys) { $patch[$k] = $defaults[$k] } }
    else { foreach ($k in $keys) { if ($defaults.ContainsKey([string]$k)) { $patch[[string]$k] = $defaults[[string]$k] } } }
    $r = Save-SettingsPatch $patch
    Add-Activity 'system' 'Settings reset to defaults.'
    Send-Json $Ctx (@{ ok = $true } + $r)
}

$ProfileGroups = @('video', 'audio', 'control', 'window', 'recording')
$Routes['GET /api/profiles'] = { param($Ctx) Send-Json $Ctx @{ profiles = @(Get-Profiles | ForEach-Object { @{ name = $_.name; values = $_.values } }) } }
$Routes['POST /api/profiles'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = ([string](Get-Prop $body 'name' '')).Trim()
    if ($name -notmatch '^[A-Za-z0-9 ._\-]{1,40}$') { Fail 'Profile names can use letters, numbers, spaces, dots, dashes and underscores (up to 40).' }
    $s = Get-Settings
    $values = @{}
    foreach ($f in $Schema) { if ($f.group -in $ProfileGroups) { $values[$f.key] = $s[$f.key] } }
    $list = @(Get-Profiles | Where-Object { $_.name -ne $name })
    $list += , @{ name = $name; values = $values }
    if ($list.Count -gt 40) { Fail 'You can keep up to 40 profiles.' }
    Save-Profiles $list
    Add-Activity 'system' ('Saved profile ' + $name + '.')
    Send-Json $Ctx @{ ok = $true; message = 'Saved profile ' + $name + '.'; profiles = @($list | ForEach-Object { @{ name = $_.name; values = $_.values } }) }
}
$Routes['POST /api/profiles/apply'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = [string](Get-Prop $body 'name' '')
    $p = @(Get-Profiles | Where-Object { $_.name -eq $name })
    if ($p.Count -eq 0) { Fail 'That profile no longer exists.' }
    $r = Save-SettingsPatch $p[0].values
    Add-Activity 'system' ('Applied profile ' + $name + '.')
    Send-Json $Ctx (@{ ok = $true; message = 'Applied profile ' + $name + '.' } + $r)
}
$Routes['POST /api/profiles/delete'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = [string](Get-Prop $body 'name' '')
    $list = @(Get-Profiles | Where-Object { $_.name -ne $name })
    Save-Profiles $list
    Send-Json $Ctx @{ ok = $true; profiles = @($list | ForEach-Object { @{ name = $_.name; values = $_.values } }) }
}

$Routes['POST /api/preview'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $mode = [string](Get-Prop $body 'mode' 'mirror')
    if ($mode -notin @('mirror', 'record')) { Fail 'Unknown mode.' }
    $over = Get-Prop $body 'settings' @{}
    $s = ConvertTo-Settings $over (Get-Settings)
    $cmd = New-ScrcpyArgs -S $s -Mode $mode -Serial ([string](Get-Prop $body 'serial' '')) -OutFile (Join-Path (Get-Dir 'recordings') ('Phone-<time>.' + $s.recordFormat)) -Once @{} -Probe $false
    Send-Json $Ctx @{ command = ('scrcpy ' + $cmd) }
}

$Routes['GET /api/devices'] = { param($Ctx)
    if ((Get-Query $Ctx 'fresh') -eq '1') { Update-DeviceCache }
    $d = Get-DeviceCache
    Send-Json $Ctx @{ devices = $d.devices; message = $d.message; ageSec = $d.ageSec }
}

$Routes['GET /api/device-info'] = { param($Ctx)
    Send-Json $Ctx @{ info = (Get-DeviceInfo (Get-Query $Ctx 'id') ((Get-Query $Ctx 'fresh') -eq '1')) }
}

$Routes['GET /api/sessions'] = { param($Ctx) Send-Json $Ctx @{ sessions = @(Get-LiveSessions | ForEach-Object { Get-SessionView $_ }) } }

$Routes['POST /api/action'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $action = [string](Get-Prop $body 'action' '')
    switch ($action) {
        { $_ -in @('mirror', 'record') } {
            $once = @{}
            $app = [string](Get-Prop $body 'app' '')
            if ($app -ne '') { Test-PackageName $app; $once.startApp = $app }
            $started = Start-ToolkitScrcpy -Mode $action -Serial $serial -Once $once
            Start-Sleep -Milliseconds 1200
            $live = @(Get-LiveSessions)
            $alive = @($live | Where-Object { $_.id -eq $started.id }).Count -gt 0
            $au = $started.audio
            if ($au -and $au.fallback) { Add-Activity 'error' ('Audio: ' + [string]$au.reason + ' Requested ' + [string]$au.requested + ', active video_only.') }
            if ($alive) {
                if ($action -eq 'record') { Add-Activity 'record' ('Recording started: ' + $started.fileName + $(if ($started.companion) { ' (alongside the mirror window)' } else { '' })); $msg = 'Recording to ' + $started.fileName + '.' } else { Add-Activity 'mirror' 'Mirror window opened.'; $msg = 'Mirror window opened.' }
            } else { $msg = ''; $reason = Get-LogReason $started.log }
            Send-Json $Ctx @{ ok = $true; started = $alive; companion = [bool]$started.companion; message = $msg; reason = [string]$reason; session = $started.id; file = $started.fileName; audio = $au; sessions = @($live | ForEach-Object { Get-SessionView $_ }) }
        }
        'screenshot' {
            $path = Save-Screenshot $serial
            $name = [IO.Path]::GetFileName($path)
            Add-Activity 'screenshot' ('Screenshot saved: ' + $name)
            Send-Json $Ctx @{ ok = $true; message = 'Screenshot saved.'; name = $name }
        }
        'stop' {
            $id = [string](Get-Prop $body 'session' '')
            $grace = [int](Get-Settings).stopGraceSeconds
            $targets = @(Get-LiveSessions)
            if ($id -ne '') { $targets = @($targets | Where-Object { $_.id -eq $id }) }
            $forced = 0
            foreach ($t in $targets) { if ((Stop-ToolkitSession $t $grace) -eq 'forced') { $forced++ } }
            $left = @(Get-LiveSessions)
            if ($targets.Count -eq 0) { $message = 'Nothing was running.' }
            elseif ($forced -gt 0) { $message = 'Stopped. ' + $forced + ' session(s) had to be force-closed; a recording may be cut short.' }
            else { $message = 'Stopped cleanly.' }
            Send-Json $Ctx @{ ok = $true; message = $message; forced = $forced; sessions = @($left | ForEach-Object { Get-SessionView $_ }) }
        }
        'check' { Update-DeviceCache; $d = Get-DeviceCache; Send-Json $Ctx @{ devices = $d.devices; message = $d.message } }
        default { Send-Json $Ctx @{ error = 'Unknown action.' } 400 }
    }
}

$Routes['POST /api/key'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    Invoke-Key ([string](Get-Prop $body 'serial' '')) ([string](Get-Prop $body 'key' ''))
    Send-Json $Ctx @{ ok = $true }
}

$Routes['POST /api/gesture'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $kind = [string](Get-Prop $body 'kind' '')
    $info = Get-DeviceInfo $serial
    $w = [int]$info.width
    $h = [int]$info.height
    if ($w -lt 100 -or $h -lt 100) { Fail 'The screen size of the phone is not known yet.' }
    $cx = [int]($w / 2); $cy = [int]($h / 2)
    switch ($kind) {
        'up' { $c = "input swipe $cx $([int]($h * 0.75)) $cx $([int]($h * 0.25)) 280" }
        'down' { $c = "input swipe $cx $([int]($h * 0.25)) $cx $([int]($h * 0.75)) 280" }
        'left' { $c = "input swipe $([int]($w * 0.8)) $cy $([int]($w * 0.2)) $cy 250" }
        'right' { $c = "input swipe $([int]($w * 0.2)) $cy $([int]($w * 0.8)) $cy 250" }
        'tap' { $c = "input tap $cx $cy" }
        default { Fail 'Unknown gesture.' }
    }
    $r = Invoke-DeviceShell $serial $c 10
    if ($r.code -ne 0) { Fail ('The phone did not accept the gesture: ' + ($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true }
}

$Routes['POST /api/text'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $text = [string](Get-Prop $body 'text' '')
    if ($text -notmatch '^[A-Za-z0-9 .,@_:/+=\-]{1,200}$') { Fail 'Use letters, numbers, spaces and . , @ _ : / + = - only (up to 200 characters).' }
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) ('input text ' + ($text -replace ' ', '%s')) 12
    if ($r.code -ne 0) { Fail ('The phone did not accept the text: ' + ($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true; message = 'Text sent to the phone.' }
}

$Routes['POST /api/open-url'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $url = [string](Get-Prop $body 'url' '')
    if ($url -notmatch '^https?://[A-Za-z0-9._~:/?#@=&%+\-]{1,300}$') { Fail 'Enter a web address starting with http:// or https://.' }
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) ('am start -a android.intent.action.VIEW -d ''' + $url + '''') 15
    if ($r.code -ne 0 -or $r.out -match 'Error') { Fail ('The phone could not open that link: ' + ($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true; message = 'Link opened on the phone.' }
}

$Routes['GET /api/toggles'] = { param($Ctx) Send-Json $Ctx (Get-Toggles (Get-Query $Ctx 'id')) }
$Routes['POST /api/toggle'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $key = [string](Get-Prop $body 'key' '')
    if ($key -eq 'brightness') {
        $v = [int](Get-Prop $body 'value' 128)
        if ($v -lt 1 -or $v -gt 255) { Fail 'Brightness is between 1 and 255.' }
        $r = Invoke-DeviceShell $serial ('settings put system screen_brightness_mode 0;settings put system screen_brightness ' + $v) 12
    } elseif ($key -eq 'timeout') {
        $v = [int](Get-Prop $body 'value' 60000)
        if ($v -notin @(15000, 30000, 60000, 120000, 300000, 600000, 1800000)) { Fail 'Unsupported screen timeout.' }
        $r = Invoke-DeviceShell $serial ('settings put system screen_off_timeout ' + $v) 12
    } elseif ($key -eq 'volume') {
        $v = [int](Get-Prop $body 'value' 5)
        if ($v -lt 0 -or $v -gt 30) { Fail 'Unsupported volume.' }
        $r = Invoke-DeviceShell $serial ('cmd media_session volume --show --stream 3 --set ' + $v) 12
    } elseif ($ToggleDefs.ContainsKey($key)) {
        $want = [bool](Get-Prop $body 'value' $false)
        $cmd = $(if ($want) { $ToggleDefs[$key].on } else { $ToggleDefs[$key].off })
        $r = Invoke-DeviceShell $serial $cmd 15
    } else { Fail 'Unknown setting.' }
    if ($r.code -ne 0 -or ($r.out + $r.err) -match 'Exception|Permission|not allowed|Unknown command') {
        $why = ($r.err + $r.out).Trim()
        if ($why.Length -gt 220) { $why = $why.Substring(0, 220) }
        Fail ('The phone refused that change. ' + $why)
    }
    Send-Json $Ctx (@{ ok = $true } + (Get-Toggles $serial))
}

function Get-PackageLines {
    param([string]$Text)
    $names = @()
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match '^package:(?:.*=)?([A-Za-z0-9._]+)\s*$') { $names += $Matches[1] }
    }
    return $names
}

$Routes['GET /api/apps'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $scope = Get-Query $Ctx 'scope'
    $flag = '-3'
    if ($scope -eq 'system') { $flag = '-s' } elseif ($scope -eq 'all') { $flag = '' }
    $names = @(); $dis = @{}; $why = ''
    $tries = @(('pm list packages ' + $flag + ' 2>&1'), ('cmd package list packages ' + $flag + ' 2>&1'), ('pm list packages --user 0 ' + $flag + ' 2>&1'))
    foreach ($cmd in $tries) {
        for ($attempt = 0; $attempt -lt 2 -and $names.Count -eq 0; $attempt++) {
            try {
                $r = Invoke-DeviceShell $serial $cmd 40
                $names = @(Get-PackageLines ($r.out + "`n" + $r.err))
                if ($names.Count -eq 0) { $why = (($r.out + ' ' + $r.err) -replace '\s+', ' ').Trim() }
            } catch { $why = $_.Exception.Message; Start-Sleep -Milliseconds 400 }
        }
        if ($names.Count -gt 0) { break }
    }
    if ($names.Count -gt 0) {
        try { $r3 = Invoke-DeviceShell $serial 'pm list packages -d 2>&1' 25; foreach ($n in (Get-PackageLines $r3.out)) { $dis[$n] = $true } } catch {}
        $cache = @($names | Sort-Object -Unique)
        $Shared.appsCache = @{ serial = $serial; scope = [string]$scope; names = $cache; at = (Get-Date) }
    } else {
        $c = $Shared.appsCache
        if ($c -and $c.serial -eq $serial -and $c.scope -eq [string]$scope) {
            $apps = @(); foreach ($n in $c.names) { $apps += , @{ package = $n; disabled = $false } }
            Send-Json $Ctx @{ apps = @($apps); note = 'The phone did not answer, so this is the last list that worked.' }; return
        }
        if ($why.Length -gt 240) { $why = $why.Substring(0, 240) }
        if ($why -eq '') { $why = 'The phone returned an empty list.' }
        Fail ('Could not list apps. The phone said: ' + $why)
    }
    $apps = @()
    foreach ($n in ($names | Sort-Object -Unique)) { $apps += , @{ package = $n; disabled = [bool]$dis.ContainsKey($n) } }
    Send-Json $Ctx @{ apps = @($apps) }
}

# What is playing on the phone (media sessions).
function Get-MediaInfo {
    param([string]$Text, [long]$UptimeMs = 0)
    $recs = @(); $cur = $null
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match '^\s*package=([A-Za-z0-9._]+)\s*$') { if ($cur) { $recs += , $cur }; $cur = @{ package = $Matches[1]; state = 0; title = ''; artist = ''; album = ''; position = [long]0; updated = [long]0; speed = 1.0; duration = [long]0 }; continue }
        if (-not $cur) { continue }
        if ($line -match 'state=PlaybackState\s*\{state=(\d+)') {
            $cur.state = [int]$Matches[1]
            if ($line -match 'position=(\d+)') { $cur.position = [long]$Matches[1] }
            if ($line -match 'updated=(\d+)') { $cur.updated = [long]$Matches[1] }
            if ($line -match 'speed=([0-9.]+)') { $cur.speed = [double]$Matches[1] }
        }
        elseif ($line -match 'metadata:\s*size=\d+,\s*description=(.*)$') {
            $parts = @($Matches[1].Trim() -split ',\s+' | ForEach-Object { if ($_ -eq 'null') { '' } else { $_ } })
            if ($parts.Count -ge 1) { $cur.title = [string]$parts[0] }
            if ($parts.Count -ge 2) { $cur.artist = [string]$parts[1] }
            if ($parts.Count -ge 3) { $cur.album = (($parts[2..($parts.Count - 1)]) -join ', ') }
        }
        elseif ($line -match '(?i)\bduration\W{1,3}(\d{4,9})\b') { $cur.duration = [long]$Matches[1] }
    }
    if ($cur) { $recs += , $cur }
    $pick = $recs | Where-Object { $_.state -eq 3 } | Select-Object -First 1
    if (-not $pick) { $pick = $recs | Where-Object { $_.state -eq 2 } | Select-Object -First 1 }
    if (-not $pick) { $pick = $recs | Where-Object { $_.title } | Select-Object -First 1 }
    if (-not $pick) { return @{ active = $false; playing = $false; sessions = $recs.Count } }
    $pos = [long]$pick.position
    if ($pick.state -eq 3 -and $UptimeMs -gt 0 -and $pick.updated -gt 0) {
        $delta = $UptimeMs - $pick.updated
        if ($delta -gt 0 -and $delta -lt 21600000) { $pos = [long]($pos + $delta * $pick.speed) }
    }
    if ($pick.duration -gt 0 -and $pos -gt $pick.duration) { $pos = $pick.duration }
    return @{ active = $true; playing = ($pick.state -eq 3); state = $pick.state; package = $pick.package; title = $pick.title; artist = $pick.artist; album = $pick.album; position = $pos; duration = $pick.duration; speed = $pick.speed; sessions = $recs.Count }
}
$Routes['GET /api/media'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'dumpsys media_session 2>/dev/null | head -n 700; echo @@UP; cat /proc/uptime' 15
    $parts = ($r.out -split '@@UP', 2)
    $up = [long]0
    if ($parts.Count -gt 1 -and $parts[1] -match '(\d+)\.(\d+)') { $up = [long]$Matches[1] * 1000 + [long]($Matches[2].PadRight(3, '0').Substring(0, 3)) }
    Send-Json $Ctx (Get-MediaInfo $parts[0] $up)
}

# Apps with live processes, which one is in front, and the recent-apps order.
$Routes['GET /api/running'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $scope = Get-Query $Ctx 'scope'
    $script = 'echo @@FG; dumpsys activity activities 2>/dev/null | grep -E ''ResumedActivity'' | head -n 3; echo @@REC; dumpsys activity recents 2>/dev/null | grep -E ''realActivity='' | head -n 40; echo @@PS; ps -A -o USER,PID,RSS,NAME 2>&1'
    $r = Invoke-DeviceShell $serial $script 40
    $sections = @{ FG = ''; REC = ''; PS = '' }
    $cur = ''
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^@@(FG|REC|PS)\s*$') { $cur = $Matches[1]; continue }
        if ($cur) { $sections[$cur] += $line + "`n" }
    }
    $fg = @{ package = ''; activity = '' }
    foreach ($line in ($sections.FG -split "`n")) {
        if ($line -match '([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/(\.?[A-Za-z0-9_.$]+)') { $fg.package = $Matches[1]; $fg.activity = $Matches[2]; break }
    }
    $recent = @()
    foreach ($line in ($sections.REC -split "`n")) {
        if ($line -match 'realActivity=([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/') { if ($recent -notcontains $Matches[1]) { $recent += $Matches[1] } }
    }
    $map = @{}
    $seenPs = $false
    foreach ($line in ($sections.PS -split "`n")) {
        if ($line -match '^\s*(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$') {
            $seenPs = $true
            $user = $Matches[1]; $procId = [int]$Matches[2]; $rss = [long]$Matches[3]; $name = $Matches[4]
            if ($name -notmatch '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+(:[A-Za-z0-9_.]+)?$') { continue }
            $isUser = ($user -match '^u\d+_a\d+$')
            if ($scope -ne 'all' -and -not $isUser) { continue }
            $base = ($name -split ':')[0]
            if (-not $map.ContainsKey($base)) { $map[$base] = @{ package = $base; pid = $procId; rssKb = [long]0; procs = 0; user = $isUser } }
            $map[$base].rssKb += $rss
            $map[$base].procs += 1
            if ($name -eq $base) { $map[$base].pid = $procId }
        }
    }
    if (-not $seenPs) { Fail ('The phone did not return a process list. It said: ' + (($r.out + ' ' + $r.err) -replace '\s+', ' ').Trim()) }
    $list = @()
    foreach ($k in $map.Keys) {
        $a = $map[$k]
        $a.foreground = ($k -eq $fg.package)
        $idx = [array]::IndexOf($recent, $k)
        $a.recent = $idx
        $list += , $a
    }
    $list = @($list | Sort-Object @{ Expression = { -not $_.foreground } }, @{ Expression = { if ($_.recent -lt 0) { 999 } else { $_.recent } } }, @{ Expression = { -$_.rssKb } })
    Send-Json $Ctx @{ foreground = $fg; apps = @($list); total = $list.Count }
}

# Light state read for remote-control highlights (screen on or off, media volume).
$Routes['GET /api/keystate'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'echo screen=$(dumpsys power 2>/dev/null | grep -m1 -oE ''mWakefulness=[A-Za-z]+''); echo vol=$(cmd media_session volume --get --stream 3 2>/dev/null | tail -n 1)' 15
    $kv = ConvertFrom-KeyLines $r.out
    $out = @{ screenOn = $null; volume = $null; volumeMax = $null }
    if ($kv.screen -match 'mWakefulness=(\w+)') { $out.screenOn = ($Matches[1] -eq 'Awake') }
    if ($kv.vol -match 'volume is (\d+) in range \[(\d+)\.\.(\d+)\]') { $out.volume = [int]$Matches[1]; $out.volumeMax = [int]$Matches[3] }
    Send-Json $Ctx $out
}

$Routes['POST /api/app'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $action = [string](Get-Prop $body 'action' '')
    $pkg = [string](Get-Prop $body 'package' '')
    Test-PackageName $pkg
    $out = @{ ok = $true }
    switch ($action) {
        'launch' { $r = Invoke-DeviceShell $serial ('monkey -p ' + $pkg + ' -c android.intent.category.LAUNCHER 1') 20; if ($r.out -match 'No activities found|Error') { Fail 'That app has no launchable screen.' }; $out.message = 'Opened ' + $pkg + '.' }
        'stop' { $r = Invoke-DeviceShell $serial ('am force-stop ' + $pkg) 15; $out.message = 'Stopped ' + $pkg + '.' }
        'clear' { $r = Invoke-DeviceShell $serial ('pm clear ' + $pkg) 20; if ($r.out -notmatch 'Success') { Fail ('Could not clear data: ' + ($r.out + $r.err).Trim()) }; $out.message = 'Cleared data for ' + $pkg + '.'; Add-Activity 'app' ('Cleared data: ' + $pkg) }
        'uninstall' { $r = Invoke-DeviceShell $serial ('pm uninstall ' + $pkg) 30; if ($r.out -notmatch 'Success') { Fail ('Could not uninstall: ' + ($r.out + $r.err).Trim()) }; $out.message = 'Uninstalled ' + $pkg + '.'; Add-Activity 'app' ('Uninstalled: ' + $pkg) }
        'disable' { $r = Invoke-DeviceShell $serial ('pm disable-user --user 0 ' + $pkg) 20; if ($r.out -notmatch 'disabled') { Fail ('Could not disable: ' + ($r.out + $r.err).Trim()) }; $out.message = 'Disabled ' + $pkg + '.'; Add-Activity 'app' ('Disabled: ' + $pkg) }
        'enable' { $r = Invoke-DeviceShell $serial ('pm enable ' + $pkg) 20; if ($r.out -notmatch 'enabled') { Fail ('Could not enable: ' + ($r.out + $r.err).Trim()) }; $out.message = 'Enabled ' + $pkg + '.' }
        'settings' { $r = Invoke-DeviceShell $serial ('am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:' + $pkg) 15; $out.message = 'Opened app settings on the phone.' }
        'info' {
            $r = Invoke-DeviceShell $serial ('dumpsys package ' + $pkg + ' | grep -E ''versionName|versionCode|firstInstallTime|lastUpdateTime|targetSdk|installerPackageName'' | head -n 12') 20
            $info = @{}
            foreach ($line in ($r.out -split "`r?`n")) { if ($line -match '^\s*(\w+)=(.*)$') { $info[$Matches[1]] = $Matches[2].Trim() } }
            $out.info = $info
        }
        'pullapk' {
            $r = Invoke-DeviceShell $serial ('pm path ' + $pkg) 15
            $paths = @()
            foreach ($line in ($r.out -split "`r?`n")) { if ($line -match '^package:(/[A-Za-z0-9._/=\-~]+\.apk)\s*$') { $paths += $Matches[1] } }
            if ($paths.Count -eq 0) { Fail 'Could not find that app on the phone.' }
            $dir = Join-Path (Get-Dir 'downloads') $pkg
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            $sel = Resolve-Target $serial
            foreach ($p in $paths) {
                $pull = Invoke-Adb ($sel + 'pull ' + $p + ' "' + $dir + '"') 120
                if ($pull.code -ne 0) { Fail ('Could not copy the APK: ' + ($pull.err + $pull.out).Trim()) }
            }
            Add-Activity 'app' ('Saved APK of ' + $pkg)
            $out.message = 'Saved ' + $paths.Count + ' APK file(s) to ' + $dir; $out.folder = $dir
        }
        default { Fail 'Unknown app action.' }
    }
    Send-Json $Ctx $out
}

$Routes['POST /api/install'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $name = Get-Query $Ctx 'name'
    if ($name -notmatch '^[A-Za-z0-9._ \-()]{1,100}\.apk$') { Fail 'Choose an .apk file.' }
    $sel = Resolve-Target $serial
    $dir = Join-Path $LogDir ('upload-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    try {
        $file = Join-Path $dir $name
        [void](Save-Upload $Ctx $file)
        $r = Invoke-Adb ($sel + 'install -r -d "' + $file + '"') 600
        $text = ($r.out + $r.err).Trim()
        if ($text -notmatch 'Success') { Fail ('Install failed: ' + $text) }
        Add-Activity 'app' ('Installed ' + $name)
        Send-Json $Ctx @{ ok = $true; message = 'Installed ' + $name + '.' }
    } finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

$Routes['GET /api/files'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $path = Get-Query $Ctx 'path'
    if ($path -eq '') { $path = '/sdcard/' }
    if (-not $path.EndsWith('/')) { $path += '/' }
    Test-PhonePath $path
    $r = Invoke-DeviceShell $serial ('ls -lA ''' + $path + '''') 25
    if ($r.out -eq '' -and $r.err -ne '') { Fail ($r.err.Trim()) }
    $entries = @()
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^([-dlbcps])[rwxsStT\-]{9}[.+]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$') {
            $name = $Matches[5]
            $link = ''
            if ($name -match '^(.+?) -> (.+)$') { $name = $Matches[1]; $link = $Matches[2] }
            $entries += , @{ name = $name; dir = ($Matches[1] -eq 'd' -or ($Matches[1] -eq 'l' -and $link -ne '')); size = [long]$Matches[2]; modified = ($Matches[3] + ' ' + $Matches[4]); link = $link }
        }
    }
    $entries = @($entries | Sort-Object @{ Expression = { -not $_.dir } }, @{ Expression = { $_.name.ToLower() } })
    $parent = ''
    if ($path -ne '/') { $parent = ($path.TrimEnd('/') -replace '/[^/]*$', '/') }
    Send-Json $Ctx @{ path = $path; parent = $parent; entries = $entries }
}

$Routes['POST /api/files/pull'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $path = [string](Get-Prop $body 'path' '')
    Test-PhonePath $path
    $dir = Get-Dir 'downloads'
    $r = Invoke-Adb ((Resolve-Target ([string](Get-Prop $body 'serial' ''))) + 'pull "' + $path + '" "' + $dir + '"') 600
    if ($r.code -ne 0) { Fail ('Copy failed: ' + ($r.err + $r.out).Trim()) }
    Add-Activity 'files' ('Copied from phone: ' + $path)
    Send-Json $Ctx @{ ok = $true; message = 'Saved to ' + $dir; folder = $dir }
}

$Routes['POST /api/files/push'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $name = Get-Query $Ctx 'name'
    $dest = Get-Query $Ctx 'dest'
    if ($name -notmatch '^[A-Za-z0-9._ \-()]{1,120}$') { Fail 'That file name has characters the phone path cannot use.' }
    if ($dest -eq '') { $dest = '/sdcard/Download/' }
    if (-not $dest.EndsWith('/')) { $dest += '/' }
    Test-PhonePath $dest
    $dir = Join-Path $LogDir ('upload-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    try {
        $file = Join-Path $dir $name
        $size = Save-Upload $Ctx $file
        $r = Invoke-Adb ((Resolve-Target $serial) + 'push "' + $file + '" "' + $dest + $name + '"') 900
        if ($r.code -ne 0) { Fail ('Upload failed: ' + ($r.err + $r.out).Trim()) }
        Add-Activity 'files' ('Sent to phone: ' + $name + ' (' + (Get-FileSizeLabel $size) + ')')
        Send-Json $Ctx @{ ok = $true; message = 'Sent ' + $name + ' to ' + $dest }
    } finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

$Routes['POST /api/files/op'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $op = [string](Get-Prop $body 'op' '')
    $path = [string](Get-Prop $body 'path' '')
    Test-PhonePath $path
    $path = $path.TrimEnd('/')
    if ($path -notmatch '^/(sdcard|storage/emulated/0)/.+') { Fail 'Changes are only allowed inside the shared storage folder (/sdcard).' }
    switch ($op) {
        'mkdir' { $r = Invoke-DeviceShell $serial ('mkdir -p ''' + $path + ''''); $msg = 'Folder created.' }
        'delete' { $r = Invoke-DeviceShell $serial ('rm -rf ''' + $path + ''''); $msg = 'Deleted.'; Add-Activity 'files' ('Deleted on phone: ' + $path) }
        'rename' {
            $to = [string](Get-Prop $body 'to' '')
            if ($to -notmatch '^[A-Za-z0-9._ \-()]{1,120}$') { Fail 'That name has characters the phone path cannot use.' }
            $parent = ($path -replace '/[^/]*$', '')
            $r = Invoke-DeviceShell $serial ('mv ''' + $path + ''' ''' + $parent + '/' + $to + ''''); $msg = 'Renamed.'
        }
        default { Fail 'Unknown file action.' }
    }
    if ($r.code -ne 0) { Fail (($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true; message = $msg }
}

$Routes['GET /api/logcat'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $lines = 400
    [void][int]::TryParse((Get-Query $Ctx 'lines'), [ref]$lines)
    if ($lines -lt 10) { $lines = 10 }
    if ($lines -gt 5000) { $lines = 5000 }
    $level = (Get-Query $Ctx 'level').ToUpper()
    if ($level -notin @('V', 'D', 'I', 'W', 'E')) { $level = 'V' }
    $r = Invoke-DeviceShell $serial ('logcat -d -v time -t ' + $lines + ' *:' + $level) 30
    $filter = (Get-Query $Ctx 'filter').Trim()
    $all = @($r.out -split "`r?`n" | Where-Object { $_ -ne '' })
    if ($filter -ne '') { $all = @($all | Where-Object { $_.IndexOf($filter, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
    Send-Json $Ctx @{ lines = @($all); count = $all.Count }
}
$Routes['POST /api/logcat/clear'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    [void](Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) 'logcat -c' 15)
    Send-Json $Ctx @{ ok = $true; message = 'Phone log cleared.' }
}

$Routes['POST /api/shell'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $cmd = ([string](Get-Prop $body 'command' '')).Trim()
    if ($cmd -eq '' -or $cmd.Length -gt 1000 -or $cmd -match "[\r\n]") { Fail 'Enter a single command (up to 1000 characters).' }
    $timeout = [int](Get-Prop $body 'timeout' 30)
    if ($timeout -lt 3) { $timeout = 3 }
    if ($timeout -gt 300) { $timeout = 300 }
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) $cmd $timeout
    $o = $r.out
    if ($o.Length -gt 120000) { $o = $o.Substring(0, 120000) + "`n[output truncated]" }
    Add-Activity 'shell' ('Ran on phone: ' + $(if ($cmd.Length -gt 60) { $cmd.Substring(0, 60) + '...' } else { $cmd }))
    Send-Json $Ctx @{ ok = $true; code = $r.code; out = $o; err = $r.err }
}

$Routes['POST /api/wifi'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $result = Invoke-Wifi ([string](Get-Prop $body 'action' '')) ([string](Get-Prop $body 'serial' '')) ([string](Get-Prop $body 'address' '')) ([string](Get-Prop $body 'code' ''))
    if ([string](Get-Prop $body 'action' '') -ne 'discover') { Add-Activity 'wifi' $result.message }
    Update-DeviceCache
    Send-Json $Ctx (@{ ok = $true } + $result)
}

$Routes['POST /api/power'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    if (-not [bool](Get-Prop $body 'confirm' $false)) { Fail 'Please confirm this action.' }
    $serial = [string](Get-Prop $body 'serial' '')
    $sel = Resolve-Target $serial
    switch ([string](Get-Prop $body 'action' '')) {
        'reboot' { $r = Invoke-Adb ($sel + 'reboot') 20; $msg = 'The phone is restarting.' }
        'recovery' { $r = Invoke-Adb ($sel + 'reboot recovery') 20; $msg = 'The phone is restarting into recovery.' }
        'bootloader' { $r = Invoke-Adb ($sel + 'reboot bootloader') 20; $msg = 'The phone is restarting into the bootloader.' }
        'poweroff' { $r = Invoke-DeviceShell $serial 'reboot -p' 20; $msg = 'The phone is shutting down.' }
        default { Fail 'Unknown power action.' }
    }
    Add-Activity 'system' $msg
    Update-DeviceCache
    Send-Json $Ctx @{ ok = $true; message = $msg }
}

function Get-PngSize {
    param([byte[]]$B)
    if ($B.Length -lt 24 -or $B[0] -ne 137 -or $B[1] -ne 80 -or $B[2] -ne 78 -or $B[3] -ne 71) { return $null }
    $w = ([int]$B[16] * 16777216) + ([int]$B[17] * 65536) + ([int]$B[18] * 256) + [int]$B[19]
    $h = ([int]$B[20] * 16777216) + ([int]$B[21] * 65536) + ([int]$B[22] * 256) + [int]$B[23]
    if ($w -lt 1 -or $h -lt 1 -or $w -gt 20000 -or $h -gt 20000) { return $null }
    return @{ w = $w; h = $h }
}

# One screenshot at a time per phone. Concurrent callers share the newest frame.
function Get-ScreenFrame {
    param([string]$Serial, [int]$MaxAgeMs)
    $key = $(if ($Serial) { $Serial } else { '_' })
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $fr = $Shared.frames[$key]
    if ($fr -and $MaxAgeMs -gt 0 -and ($nowMs - [long]$fr.at) -lt $MaxAgeMs) { return $fr }
    if (-not $Shared.frameBusy.TryAdd($key, $nowMs)) {
        $waited = 0
        $slot = [long]0
        while ($Shared.frameBusy.TryGetValue($key, [ref]$slot) -and $waited -lt 25000) { Start-Sleep -Milliseconds 100; $waited += 100 }
        $fr = $Shared.frames[$key]
        if ($fr) { return $fr }
        Fail 'The phone screenshot did not finish in time.'
    }
    $tmp = Join-Path $LogDir ('frame-' + [guid]::NewGuid().ToString('N') + '.png')
    try {
        $sel = Resolve-Target $Serial
        $bytes = $null
        $size = $null
        $why = ''
        try {
            $r = Invoke-AdbBytes ($sel + 'exec-out screencap -p') 20
            $bytes = $r.bytes
            $size = Get-PngSize $bytes
            if (-not $size) { $why = ($r.err).Trim() }
        } catch { if ($_.Exception -is [InvalidOperationException]) { throw }; $why = $_.Exception.Message }
        if (-not $size) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            $remote = ([string](Get-Settings).remoteTmpDir).TrimEnd('/') + '/stk-preview.png'
            $a = Invoke-Adb ($sel + 'shell screencap -p ' + $remote) 20
            if ($a.code -ne 0) { Fail ('Preview failed: ' + ($a.err + $a.out + ' ' + $why).Trim()) }
            $b = Invoke-Adb ($sel + 'pull ' + $remote + ' "' + $tmp + '"') 30
            if (-not (Test-Path -LiteralPath $tmp)) { Fail ('Preview failed: ' + ($b.err + $b.out).Trim()) }
            $bytes = [IO.File]::ReadAllBytes($tmp)
            $size = Get-PngSize $bytes
            if (-not $size) { Fail 'The phone returned a picture that could not be read. It may be blocking screenshots.' }
        }
        $sha = [Security.Cryptography.SHA1]::Create()
        $etag = '"' + (([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').Substring(0, 16).ToLower()) + '"'
        $fr = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); bytes = $bytes; etag = $etag; w = [int]$size.w; h = [int]$size.h }
        $Shared.frames[$key] = $fr
        return $fr
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        $gone = [long]0
        [void]$Shared.frameBusy.TryRemove($key, [ref]$gone)
    }
}

$Routes['GET /api/preview-image'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $maxAge = 0
    [void][int]::TryParse((Get-Query $Ctx 'maxAge'), [ref]$maxAge)
    $fr = Get-ScreenFrame $serial $maxAge
    $inm = [string]$Ctx.Request.Headers['If-None-Match']
    $extra = @{ 'ETag' = $fr.etag; 'X-Frame-W' = [string]$fr.w; 'X-Frame-H' = [string]$fr.h; 'X-Frame-At' = [string]$fr.at }
    if ($inm -ne '' -and $inm -eq $fr.etag) { Send-Bytes $Ctx ([byte[]]@()) 'image/png' 304 'no-store' $extra }
    else { Send-Bytes $Ctx $fr.bytes 'image/png' 200 'no-store' $extra }
}

function Test-ScreenPoint {
    param($Value, [string]$Name)
    $n = 0
    if (-not [int]::TryParse(([string]$Value), [ref]$n) -or $n -lt 0 -or $n -gt 20000) { Fail ($Name + ' is not a valid screen position.') }
    return $n
}
$Routes['POST /api/tap'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $x = Test-ScreenPoint (Get-Prop $body 'x' -1) 'x'
    $y = Test-ScreenPoint (Get-Prop $body 'y' -1) 'y'
    $hold = [int](Get-Prop $body 'holdMs' 0)
    if ($hold -gt 0) { if ($hold -lt 300) { $hold = 300 }; if ($hold -gt 3000) { $hold = 3000 }; $c = "input swipe $x $y $x $y $hold" } else { $c = "input tap $x $y" }
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) $c 10
    if ($r.code -ne 0) { Fail ('The phone did not accept the tap: ' + ($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true }
}
$Routes['POST /api/swipe'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $x1 = Test-ScreenPoint (Get-Prop $body 'x1' -1) 'x1'
    $y1 = Test-ScreenPoint (Get-Prop $body 'y1' -1) 'y1'
    $x2 = Test-ScreenPoint (Get-Prop $body 'x2' -1) 'x2'
    $y2 = Test-ScreenPoint (Get-Prop $body 'y2' -1) 'y2'
    $ms = [int](Get-Prop $body 'ms' 250)
    if ($ms -lt 50) { $ms = 50 }; if ($ms -gt 3000) { $ms = 3000 }
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) "input swipe $x1 $y1 $x2 $y2 $ms" 10
    if ($r.code -ne 0) { Fail ('The phone did not accept the swipe: ' + ($r.err + $r.out).Trim()) }
    Send-Json $Ctx @{ ok = $true }
}

# ---- library ----
$Routes['GET /api/library'] = { param($Ctx) Send-Json $Ctx (Get-Library (Get-Query $Ctx 'kind')) }

$Routes['GET /api/file'] = { param($Ctx)
    $kind = Get-Query $Ctx 'kind'
    if ($kind -eq '') { $kind = 'screenshots' }
    $path = Get-SafeFile $kind (Get-Query $Ctx 'name')
    $type = $MimeTypes[[IO.Path]::GetExtension($path).ToLower()]
    $dl = ''
    if ((Get-Query $Ctx 'download') -eq '1') { $dl = [IO.Path]::GetFileName($path) }
    Send-File $Ctx $path $type $dl
}

$Routes['POST /api/file-op'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $kind = [string](Get-Prop $body 'kind' 'recordings')
    $name = [string](Get-Prop $body 'name' '')
    $path = Get-SafeFile $kind $name
    switch ([string](Get-Prop $body 'op' '')) {
        'open' { Open-OnPc $path; Send-Json $Ctx @{ ok = $true } }
        'reveal' { Open-OnPc $path -Reveal; Send-Json $Ctx @{ ok = $true } }
        'delete' {
            if (Test-InProgress $name) { Fail 'This recording is still in progress. Stop it first.' }
            Remove-Item -LiteralPath $path -Force
            Add-Activity 'delete' ('Deleted ' + $name)
            Send-Json $Ctx @{ ok = $true }
        }
        'rename' {
            if (Test-InProgress $name) { Fail 'This recording is still in progress. Stop it first.' }
            $new = ([string](Get-Prop $body 'newName' '')).Trim()
            $ext = [IO.Path]::GetExtension($name)
            if ($new -notmatch ('(?i)' + [regex]::Escape($ext) + '$')) { $new += $ext }
            if ($new -notmatch '^[A-Za-z0-9._ \-()]{1,100}$') { Fail 'Names can use letters, numbers, spaces and . _ - ( ).' }
            $target = Join-Path ([IO.Path]::GetDirectoryName($path)) $new
            if (Test-Path -LiteralPath $target) { Fail 'A file with that name already exists.' }
            Move-Item -LiteralPath $path -Destination $target
            Add-Activity 'rename' ('Renamed ' + $name + ' to ' + $new)
            Send-Json $Ctx @{ ok = $true; name = $new }
        }
        default { Fail 'Unknown file action.' }
    }
}

$Routes['POST /api/delete-files'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $kind = [string](Get-Prop $body 'kind' 'recordings')
    $deleted = 0
    $skipped = 0
    foreach ($n in @(Get-Prop $body 'names' @())) {
        try {
            $p = Get-SafeFile $kind ([string]$n)
            if (Test-InProgress ([string]$n)) { $skipped++; continue }
            Remove-Item -LiteralPath $p -Force
            $deleted++
        } catch { $skipped++ }
    }
    if ($deleted -gt 0) { Add-Activity 'delete' ('Deleted ' + $deleted + ' file(s).') }
    Send-Json $Ctx @{ ok = $true; deleted = $deleted; skipped = $skipped }
}

$Routes['POST /api/open-folder'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $kind = [string](Get-Prop $body 'kind' 'recordings')
    switch ($kind) {
        'recordings' { $dir = Get-Dir 'recordings' }
        'screenshots' { $dir = Get-Dir 'screenshots' }
        'downloads' { $dir = Get-Dir 'downloads' }
        'backups' { $dir = Join-Path (Get-Dir 'downloads') 'Backups'; New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        'logs' { $dir = $LogDir }
        'root' { $dir = $Root }
        default { Fail 'Unknown folder.' }
    }
    Open-OnPc $dir
    Send-Json $Ctx @{ ok = $true }
}

$Routes['GET /api/cleanup-preview'] = { param($Ctx)
    $days = 0
    if (-not [int]::TryParse((Get-Query $Ctx 'days'), [ref]$days) -or $days -lt 1 -or $days -gt 3650) { Fail 'Enter a number of days between 1 and 3650.' }
    $old = Get-OldFiles (Get-Query $Ctx 'kind') $days
    Send-Json $Ctx @{ files = @($old | ForEach-Object { @{ name = $_.Name; size = [long]$_.Length } }); days = $days }
}
$Routes['POST /api/cleanup'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $days = [int](Get-Prop $body 'days' 0)
    if ($days -lt 1 -or $days -gt 3650 -or -not [bool](Get-Prop $body 'confirm' $false)) { Fail 'Cleanup was not confirmed or the age is invalid.' }
    $old = Get-OldFiles ([string](Get-Prop $body 'kind' 'recordings')) $days
    $deleted = 0
    $freed = [long]0
    foreach ($file in $old) { $freed += [long]$file.Length; Remove-Item -LiteralPath $file.FullName -Force; $deleted++ }
    if ($deleted -gt 0) { Add-Activity 'delete' ('Cleanup removed ' + $deleted + ' file(s).') }
    Send-Json $Ctx @{ ok = $true; deleted = $deleted; freed = $freed }
}

# ---- audio modes (4.1.0) ----
# What the audio mode will do right now, what is running, and what OBS can hear. Reads the phone's Android version
# through adb, so it runs in the normal lane, never the fast one.
$Routes['GET /api/audio-status'] = { param($Ctx)
    $s = Get-Settings
    $serial = Get-Query $Ctx 'serial'
    Test-Serial $serial
    if ($serial -eq '') {
        $ready = @($Shared.devices | Where-Object { $null -ne $_ -and $_.state -eq 'device' })
        if ($ready.Count -ge 1) { $serial = [string]$ready[0].id }
    }
    $caps = Get-ScrcpyAudioCaps $true
    $dev = $null
    if ($serial -ne '') { $dev = Get-DeviceAudioInfo $serial $true }
    $plans = @{}
    foreach ($def in @(@('mirror', 'mirror', $false, $false), @('record', 'record', $false, $false), @('companion', 'record', $true, $true))) {
        $p = Resolve-AudioPlan -S $s -Mode $def[1] -Serial $serial -Companion $def[2] -Headless $def[3] -Probe $true
        $v = ConvertTo-AudioView $p
        $v.argv = ($p.argv -join ' ')
        $plans[$def[0]] = $v
    }
    $req = Get-AudioModeId $s
    $live = @(Get-LiveSessions | ForEach-Object { Get-SessionView $_ })
    $pending = @($live | Where-Object { $_.audio -and [string]$_.audio.requested -ne $req }).Count
    $warn = @()
    foreach ($k in @('mirror', 'record')) { foreach ($w in @($plans[$k].warnings)) { if ($w -and ($warn -notcontains $w)) { $warn += $w } } }
    Send-Json $Ctx @{
        ok = $true; requested = $req; label = (Get-AudioModeInfo $req).label
        scrcpy = @{ version = $caps.version; ok = [bool]$caps.ok; error = [string]$caps.error; flags = $caps.flags }
        device = $(if ($dev) { @{ serial = $serial; ok = [bool]$dev.ok; sdk = [int]$dev.sdk; release = [string]$dev.release; model = [string]$dev.model; manufacturer = [string]$dev.manufacturer; error = [string]$dev.error } } else { $null })
        plans = $plans; sessions = $live; pending = $pending; warnings = @($warn)
        stream = (Get-StreamAudioPlan $s)
    }
}

$Routes['POST /api/audio-mode'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $mode = [string](Get-Prop $body 'mode' '')
    if ($AudioModeIds -notcontains $mode) { Fail 'That audio mode does not exist.' }
    $r = Save-SettingsPatch @{ audioMode = $mode }
    $info = Get-AudioModeInfo $mode
    Add-Activity 'system' ('Audio mode set to ' + $info.label + '.')
    $restarted = 0
    $restartError = ''
    $keptRecordings = 0
    if ([bool](Get-Prop $body 'apply' $false)) {
        $grace = [int](Get-Settings).stopGraceSeconds
        foreach ($t in @(Get-LiveSessions | Where-Object { $_.mode -eq 'mirror' })) {
            $au = Get-Prop $t 'audio' $null
            if ($au -and [string](Get-Prop $au 'requested' '') -eq $mode) { continue }
            $serial = [string]$t.serial
            [void](Stop-ToolkitSession $t $grace)
            try { [void](Start-ToolkitScrcpy -Mode 'mirror' -Serial $serial -Once @{}); $restarted++ } catch { $restartError = $_.Exception.Message }
        }
    }
    foreach ($t in @(Get-LiveSessions | Where-Object { $_.mode -eq 'record' })) {
        $au = Get-Prop $t 'audio' $null
        if ($au -and [string](Get-Prop $au 'requested' '') -ne $mode) { $keptRecordings++ }
    }
    Send-Json $Ctx @{ ok = $true; settings = $r.settings; mode = $mode; label = $info.label; restartedMirrors = $restarted; restartError = $restartError; recordingsKeepOldMode = $keptRecordings; sessions = @(Get-LiveSessions | ForEach-Object { Get-SessionView $_ }) }
}

# Does a saved recording really have sound? Container check always; ?deep=1 also measures loudness when ffmpeg exists.
$Routes['GET /api/audio-check'] = { param($Ctx)
    $name = Get-Query $Ctx 'name'
    $path = Get-SafeFile 'recordings' $name
    if (Test-InProgress $name) { Send-Json $Ctx @{ ok = $true; report = @{ file = $name; state = 'in_progress'; verified = $false; summary = 'This recording is still running. Stop it, then check it.' } }; return }
    $deep = ((Get-Query $Ctx 'deep') -eq '1')
    Send-Json $Ctx @{ ok = $true; report = (Test-RecordingAudio $path $deep); ffmpeg = ((Get-FfmpegPath) -ne '') }
}

# Read-only Windows audio and OBS facts for the streaming section.
$Routes['GET /api/audio-env'] = { param($Ctx)
    Send-Json $Ctx @{ ok = $true; env = (Get-AudioEnvironment); stream = (Get-StreamAudioPlan (Get-Settings)) }
}

# ---- diagnostics and logs ----
$Routes['GET /api/activity'] = { param($Ctx) Send-Json $Ctx @{ items = @(Use-Lock { $Shared.activity.ToArray() }) } }

$Routes['GET /api/log'] = { param($Ctx)
    $id = Get-Query $Ctx 'id'
    $path = ''
    if ($id -match '^[a-f0-9]{8}$') { $path = Join-Path $LogDir ('session-' + $id + '.log') }
    else {
        $latest = @(Get-ChildItem -LiteralPath $LogDir -Filter 'session-*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
        if ($latest.Count -gt 0) { $path = $latest[0].FullName }
    }
    $text = ''
    $name = ''
    if ($path -ne '' -and (Test-Path -LiteralPath $path)) {
        $name = [IO.Path]::GetFileName($path)
        try {
            $fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try { $sr = New-Object IO.StreamReader($fs); $text = $sr.ReadToEnd() } finally { $fs.Dispose() }
        } catch {}
        if ($text.Length -gt 12000) { $text = $text.Substring($text.Length - 12000) }
    }
    Send-Json $Ctx @{ log = $text; name = $name }
}

$Routes['GET /api/backend-log'] = { param($Ctx)
    $p = Join-Path $LogDir 'backend-error.log'
    $text = ''
    if (Test-Path -LiteralPath $p) { $text = [IO.File]::ReadAllText($p); if ($text.Length -gt 8000) { $text = $text.Substring($text.Length - 8000) } }
    Send-Json $Ctx @{ log = $text }
}

# Raw logs live here so the dashboard can show plain-language messages everywhere else.
function Test-LogName([string]$Name) {
    return ($Name -match '^(backend-error|scrcpy-last|supervisor)\.log$' -or $Name -match '^session-[a-f0-9]{8}\.log$')
}
$Routes['GET /api/logs'] = { param($Ctx)
    $name = Get-Query $Ctx 'name'
    if ($name -eq '') {
        $items = @()
        foreach ($f in @(Get-ChildItem -LiteralPath $LogDir -Filter '*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            if (Test-LogName $f.Name) { $items += , @{ name = $f.Name; size = [long]$f.Length; modified = $f.LastWriteTime.ToString('o') } }
            if ($items.Count -ge 25) { break }
        }
        Send-Json $Ctx @{ logs = $items }
        return
    }
    if (-not (Test-LogName $name)) { Fail 'Unknown log file.' }
    $path = Join-Path $LogDir $name
    $text = ''
    if (Test-Path -LiteralPath $path) {
        try {
            $fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try { $sr = New-Object IO.StreamReader($fs); $text = $sr.ReadToEnd() } finally { $fs.Dispose() }
        } catch {}
        if ($text.Length -gt 20000) { $text = $text.Substring($text.Length - 20000) }
    }
    Send-Json $Ctx @{ name = $name; log = $text }
}
$Routes['POST /api/logs-clear'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = [string](Get-Prop $body 'name' '')
    if ($name -ne 'backend-error.log') { Fail 'Only the backend error log can be cleared here.' }
    try { Set-Content -LiteralPath (Join-Path $LogDir $name) -Value '' -ErrorAction Stop } catch { Fail 'The log file is in use. Try again in a moment.' }
    Send-Json $Ctx @{ ok = $true }
}

$Routes['GET /api/diagnostics'] = { param($Ctx)
    $checks = @()
    $adb = Get-AdbPath
    $scr = Get-ScrcpyPath
    $checks += , @{ name = 'ADB'; ok = [bool]((Test-Tool $adb) -or -not $OnWindows); detail = $(if ($Shared.versions.adb) { 'Version ' + $Shared.versions.adb + ' at ' + $adb } else { $adb }) }
    $checks += , @{ name = 'scrcpy'; ok = [bool]((Test-Tool $scr) -or -not $OnWindows); detail = $(if ($Shared.versions.scrcpy) { 'Version ' + $Shared.versions.scrcpy + ' at ' + $scr } else { $scr }) }
    $am = Get-AudioModeInfo (Get-AudioModeId (Get-Settings))
    $checks += , @{ name = 'Audio mode'; ok = $true; detail = ($am.label + ' (phone: ' + $am.phone + ', PC: ' + $am.pc + ', recording: ' + $am.recording + ')') }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $devs = @()
    try { $devs = @(Get-DevicesRaw) } catch { $checks += , @{ name = 'ADB server'; ok = $false; detail = $_.Exception.Message } }
    $sw.Stop()
    if ($sw.ElapsedMilliseconds -lt 3000) { $checks += , @{ name = 'ADB response'; ok = $true; detail = ([string]$sw.ElapsedMilliseconds + ' ms') } }
    else { $checks += , @{ name = 'ADB response'; ok = $false; detail = ('Slow: ' + $sw.ElapsedMilliseconds + ' ms. Try Restart ADB on the Devices page.') } }
    $ready = @($devs | Where-Object { $_.state -eq 'device' }).Count
    $bad = @($devs | Where-Object { $_.state -ne 'device' })
    $checks += , @{ name = 'Phones'; ok = ($ready -gt 0); detail = $(if ($devs.Count -eq 0) { 'None detected' } else { [string]$ready + ' ready' + $(if ($bad.Count) { ', ' + $bad.Count + ' needing attention (' + (($bad | ForEach-Object { $_.state }) -join ', ') + ')' } else { '' }) }) }
    foreach ($k in @('recordings', 'screenshots', 'downloads')) {
        $d = Get-Dir $k
        $free = (Get-DiskInfo $d).free
        $w = Test-WritableDir $d
        $checks += , @{ name = ($k.Substring(0, 1).ToUpper() + $k.Substring(1) + ' folder'); ok = ($w -and $free -gt 1GB); detail = $(if (-not $w) { 'Cannot write to ' + $d } else { $d + ' - ' + (Get-FileSizeLabel $free) + ' free' }) }
    }
    $checks += , @{ name = 'Backend'; ok = $true; detail = ('Port ' + $Shared.port + ', ' + $Shared.workerCount + ' workers, up ' + [int]((Get-Date) - $Shared.started).TotalMinutes + ' min') }
    Send-Json $Ctx @{ checks = $checks }
}

$Routes['POST /api/backend'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $action = [string](Get-Prop $body 'action' '')
    if ($action -notin @('restart', 'quit')) { Fail 'Unknown backend action.' }
    # A second click while the first restart is already under way is answered, not repeated.
    if ($Shared.stop) { Send-Json $Ctx @{ ok = $true; message = 'The backend is already restarting.' }; return }
    Send-Json $Ctx @{ ok = $true; message = $(if ($action -eq 'restart') { 'Restarting the backend...' } else { 'The backend is shutting down.' }); version = $ToolkitVersion }
    Add-Activity 'system' ('Backend ' + $action + ' requested.')
    $code = $(if ($action -eq 'restart') { 10 } else { 0 })
    Start-Sleep -Milliseconds 300
    $Shared.exitCode = $code
    $Shared.stop = $true
    try { $Shared.listener.Stop() } catch {}
    # Normal shutdown stops every worker and then exits. A worker stuck inside a slow adb call can make that
    # hang, which left the dashboard dead until Launch.bat was run again (the old "click many times" bug).
    # If the clean exit has not happened after a few seconds, leave the process right here. The supervisor
    # sees the same exit code and starts a fresh backend either way.
    Start-Sleep -Milliseconds 3500
    try { Remove-Item -LiteralPath (Join-Path $LogDir 'backend.pid') -Force -ErrorAction SilentlyContinue } catch {}
    [Environment]::Exit($code)
}

# Dispatches one request. Never throws.
function Handle-Request {
    param($Ctx)
    Use-Lock { $Shared.inflight = [int]$Shared.inflight + 1 }
    try {
        $req = $Ctx.Request
        $path = $req.Url.AbsolutePath.TrimEnd('/')
        $method = $req.HttpMethod
        if ($method -eq 'POST' -and $req.Headers['X-STK'] -ne '1') { Send-Json $Ctx @{ error = 'Missing request header.' } 403; return }
        $route = $Routes[$method + ' ' + $path]
        if (-not $route) { Send-Json $Ctx @{ error = 'Endpoint not found.' } 404; return }
        & $route $Ctx
    } catch {
        $ex = $_.Exception
        if ($ex -is [System.InvalidOperationException]) { $status = 400; $msg = $ex.Message }
        else { $status = 500; $msg = 'Unexpected backend error: ' + $ex.Message; Write-BackendLog ($ex.ToString() + ' @ ' + $_.InvocationInfo.PositionMessage) }
        try { Send-Json $Ctx @{ error = $msg } $status } catch { try { $Ctx.Response.Abort() } catch {} }
    } finally {
        Use-Lock { $Shared.inflight = [int]$Shared.inflight - 1 }
    }
}
