# DROID ADB 3.0: phone-side routes (monitor, notifications, demo mode, gallery, inspector, intents, insights). ASCII only.

function ConvertFrom-DurationText {
    param([string]$Text)
    $t = $Text.Trim().Trim('"').TrimStart('+')
    if ($t -match '^\d+$') { return [long]$t }
    $ms = [long]0
    if ($t -match '(\d+)d') { $ms += [long]$Matches[1] * 86400000 }
    if ($t -match '(\d+)h') { $ms += [long]$Matches[1] * 3600000 }
    if ($t -match '(\d+)m(?!s)') { $ms += [long]$Matches[1] * 60000 }
    if ($t -match '(\d+)s') { $ms += [long]$Matches[1] * 1000 }
    if ($t -match '(\d+)ms') { $ms += [long]$Matches[1] }
    return $ms
}

# ---------------------------------------------------------------------------
# Monitor: CPU, memory, network and top apps (one sample per call; the page keeps the history)
# ---------------------------------------------------------------------------
if (-not $Shared.monPrev) { $Shared.monPrev = [hashtable]::Synchronized(@{}) }

$Routes['GET /api/monitor'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $script = 'head -n 1 /proc/stat; echo @@MEM; head -n 5 /proc/meminfo; echo @@NET; cat /proc/net/dev; echo @@TOP; top -b -n 1 -m 10 2>/dev/null | head -n 30; echo @@TH; for f in /sys/class/thermal/thermal_zone*/temp; do echo $(cat $f 2>/dev/null); done 2>/dev/null | head -n 16; echo @@BAT; dumpsys battery 2>/dev/null | grep -E ''level|temperature|status|powered'''
    $r = Invoke-DeviceShell $serial $script 20
    $sec = @{ P = ''; MEM = ''; NET = ''; TOP = ''; TH = ''; BAT = '' }
    $cur = 'P'
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^@@(MEM|NET|TOP|TH|BAT)\s*$') { $cur = $Matches[1]; continue }
        $sec[$cur] += $line + "`n"
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $out = @{ at = $now; cpu = $null; memPct = $null; memTotalMb = $null; memUsedMb = $null; rxBps = $null; txBps = $null; tempC = $null; battery = $null; batteryTempC = $null; charging = $false; top = @() }
    $prev = $Shared.monPrev[$serial]
    $cpuTotal = [long]0; $cpuIdle = [long]0
    if ($sec.P -match '(?m)^cpu\s+(.+)$') {
        $v = @($Matches[1].Trim() -split '\s+' | ForEach-Object { [long]$_ })
        foreach ($x in $v) { $cpuTotal += $x }
        if ($v.Count -ge 5) { $cpuIdle = $v[3] + $v[4] } elseif ($v.Count -ge 4) { $cpuIdle = $v[3] }
    }
    $rx = [long]0; $tx = [long]0
    foreach ($line in ($sec.NET -split "`n")) {
        if ($line -match '^\s*([A-Za-z0-9_.\-]+):\s*(.+)$' -and $Matches[1] -ne 'lo') {
            $f = @($Matches[2].Trim() -split '\s+')
            if ($f.Count -ge 9) { $rx += [long]$f[0]; $tx += [long]$f[8] }
        }
    }
    if ($prev -and $cpuTotal -gt 0 -and $cpuTotal -gt [long]$prev.cpuTotal) {
        $dt = $cpuTotal - [long]$prev.cpuTotal
        $di = $cpuIdle - [long]$prev.cpuIdle
        $out.cpu = [math]::Round([math]::Max(0, [math]::Min(100, 100 * (1 - $di / $dt))), 1)
    }
    if ($prev -and $now -gt [long]$prev.at) {
        $secs = ($now - [long]$prev.at) / 1000.0
        if ($rx -ge [long]$prev.rx) { $out.rxBps = [long]([long]($rx - [long]$prev.rx) / $secs) }
        if ($tx -ge [long]$prev.tx) { $out.txBps = [long]([long]($tx - [long]$prev.tx) / $secs) }
    }
    $Shared.monPrev[$serial] = @{ at = $now; cpuTotal = $cpuTotal; cpuIdle = $cpuIdle; rx = $rx; tx = $tx }
    $mt = 0; $ma = 0
    if ($sec.MEM -match 'MemTotal:\s+(\d+)') { $mt = [long]$Matches[1] }
    if ($sec.MEM -match 'MemAvailable:\s+(\d+)') { $ma = [long]$Matches[1] }
    if ($mt -gt 0) { $out.memTotalMb = [int]($mt / 1024); $out.memUsedMb = [int](($mt - $ma) / 1024); $out.memPct = [math]::Round(100 * ($mt - $ma) / $mt, 1) }
    $best = $null
    foreach ($line in ($sec.TH -split "`n")) {
        if ($line -match '^\s*(-?\d+)\s*$') {
            $d = [double]$Matches[1]
            if ($d -gt 1000) { $d = $d / 1000 }
            if ($d -ge 15 -and $d -le 110 -and ($null -eq $best -or $d -gt $best)) { $best = $d }
        }
    }
    if ($null -ne $best) { $out.tempC = [math]::Round($best, 1) }
    if ($sec.BAT -match '(?m)^\s*level:\s*(\d+)') { $out.battery = [int]$Matches[1] }
    if ($sec.BAT -match '(?m)^\s*temperature:\s*(\d+)') { $out.batteryTempC = [math]::Round([int]$Matches[1] / 10, 1) }
    if ($sec.BAT -match '(?m)^\s*status:\s*2') { $out.charging = $true }
    # top: find the header row, then read the CPU, RES and name columns
    $hdr = $null; $rows = @()
    foreach ($line in ($sec.TOP -split "`n")) {
        $tline = $line.Trim()
        if ($tline -eq '') { continue }
        if (-not $hdr -and $tline -match '^PID\s' -and $tline -match 'CPU') { $hdr = @($tline -split '\s+'); continue }
        if ($hdr -and $tline -match '^\d+\s') { $rows += $tline }
    }
    if ($hdr) {
        $ci = -1; $ri = -1; $ni = $hdr.Count - 1; $shift = 0
        for ($i = 0; $i -lt $hdr.Count; $i++) {
            if ($hdr[$i] -match '%CPU' -and $ci -lt 0) { $ci = $i; if ($hdr[$i] -match '^S\[') { $ci = $i + 0 } }
            if ($hdr[$i] -eq 'RES' -and $ri -lt 0) { $ri = $i }
            if ($hdr[$i] -in @('ARGS', 'NAME', 'COMMAND') ) { $ni = $i }
        }
        $merged = ($ci -ge 0 -and $hdr[$ci] -match '^S\[')
        if ($merged) { $ni = $ni + 1 }
        $top = @()
        foreach ($row in $rows) {
            $f = @($row -split '\s+')
            if ($f.Count -le $ni) { continue }
            $cpuIx = $ci; if ($merged) { $cpuIx = $ci + 1 }
            if ($cpuIx -lt 0 -or $cpuIx -ge $f.Count) { continue }
            $cv = 0.0
            if (-not [double]::TryParse(($f[$cpuIx] -replace '%', ''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$cv)) { continue }
            $nm = ($f[$ni..($f.Count - 1)] -join ' ')
            if ($nm -match '^top\b') { continue }
            $res = ''
            if ($ri -ge 0 -and $ri -lt $f.Count) { $res = $f[$ri] }
            $top += , @{ name = $nm; cpu = $cv; res = $res }
        }
        $out.top = @($top | Sort-Object { $_.cpu } -Descending | Select-Object -First 6)
    }
    Send-Json $Ctx $out
}

# ---------------------------------------------------------------------------
# Notifications: read-only list of what the phone is showing
# ---------------------------------------------------------------------------
function Get-NotifText {
    param([string]$Line)
    $v = $Line.Trim()
    $v = $v -replace '^(String|SpannableString|SpannableStringBuilder|CharSequence)\s*\((.*)\)\s*$', '$2'
    return $v
}

# Reads the message list a notification carries (chat messages, inbox lines). Returns @(@{ text; sender; time }).
function Get-NotifLines {
    param([string]$Block)
    $out = @()
    $keys = @('android.historicMessages', 'android.messages', 'android.textLines')
    foreach ($key in $keys) {
        $pat = '(?ms)^[ \t]*' + [regex]::Escape($key) + '=[^\n]*\((\d+)\)[^\n]*\n(.*?)(?=^[ \t]*android\.[A-Za-z0-9_.]+=|^[ \t]*\}|\z)'
        $m = [regex]::Match($Block, $pat)
        if (-not $m.Success) { continue }
        $entries = [regex]::Split($m.Groups[2].Value, '(?m)^[ \t]*\[\d+\][ \t]?')
        foreach ($e in $entries) {
            $e = $e.Trim()
            if ($e -eq '') { continue }
            $txt = ''
            $sender = ''
            $when = [long]0
            $bm = [regex]::Match($e, '(?s)^Bundle\[\{(.*)\}\]$')
            if ($bm.Success) {
                $inner = $bm.Groups[1].Value
                $stop = '(?=, (?:time|sender|sender_person|type|uri|extras|text)=|$)'
                $tm = [regex]::Match($inner, '(?s)(?:^|, )text=(.*?)' + $stop)
                if ($tm.Success) { $txt = (Get-NotifText $tm.Groups[1].Value) }
                $sm = [regex]::Match($inner, '(?s)(?:^|, )sender=(.*?)' + $stop)
                if ($sm.Success) { $sender = (Get-NotifText $sm.Groups[1].Value) }
                if ($sender -eq '' -or $sender -eq 'null') {
                    $pm = [regex]::Match($inner, 'name=([^,}]+)')
                    if ($pm.Success) { $sender = $pm.Groups[1].Value.Trim() }
                }
                $wm = [regex]::Match($inner, '(?:^|, )time=(\d{10,})')
                if ($wm.Success) { $when = [long]$wm.Groups[1].Value }
            } elseif ($e -notmatch '^(Bundle|Parcelable|Person)\b') {
                $txt = (Get-NotifText $e)
            }
            if ($txt -eq '' -or $txt -eq 'null') { continue }
            if ($sender -eq 'null') { $sender = '' }
            $out += , @{ text = $txt; sender = $sender; time = $when }
        }
    }
    $seen = @{}
    $uniq = @()
    foreach ($x in $out) { $k = [string]$x.time + '|' + $x.sender + '|' + $x.text; if (-not $seen.ContainsKey($k)) { $seen[$k] = $true; $uniq += , $x } }
    if ($uniq.Count -gt 30) { $uniq = @($uniq | Select-Object -Last 30) }
    return @($uniq)
}

$Routes['GET /api/notifications'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'dumpsys notification --noredact 2>/dev/null | head -n 8000' 30
    $text = ([string]$r.out) -replace "`r", ''
    $items = @()
    $parts = [regex]::Split($text, '(?m)^\s*NotificationRecord\(')
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $b = $parts[$i]
        $pkg = ''
        if ($b -match 'pkg=([A-Za-z0-9._]+)') { $pkg = $Matches[1] }
        if ($pkg -eq '') { continue }
        $title = ''; $body = ''; $big = ''; $when = 0; $ongoing = $false
        if ($b -match '(?m)android\.title=(.*)$') { $title = Get-NotifText $Matches[1] }
        if ($b -match '(?m)android\.text=(.*)$') { $body = Get-NotifText $Matches[1] }
        if ($b -match '(?m)android\.bigText=(.*)$') { $big = Get-NotifText $Matches[1] }
        if ($b -match '(?m)\bwhen=(\d{10,})') { $when = [long]$Matches[1] }
        if ($b -match 'flags=0x[0-9a-fA-F]*[2-9a-fA-F][0-9a-fA-F]?\b.*ONGOING|FLAG_ONGOING_EVENT|FOREGROUND_SERVICE') { $ongoing = $true }
        $key = ''
        if ($b -match 'key=([^\s)]+)') { $key = $Matches[1] }
        if ($title -eq '' -and $body -eq '' -and $big -eq '') { continue }
        $lines = @()
        $hint = ''
        try {
            $lines = @(Get-NotifLines $b)
            if ($lines.Count -eq 0) {
                $hm = [regex]::Matches($b, '(?m)^[ \t]*(android\.(?:messages|historicMessages|textLines))=([A-Za-z\[\]]+)[ \t]*\(?(\d*)')
                $bits = @()
                foreach ($h in $hm) { $bits += ($h.Groups[1].Value + ' ' + $h.Groups[3].Value) }
                if ($bits.Count -gt 0) { $hint = 'The phone listed ' + ($bits -join ', ') + ' but gave no readable text.' }
            }
        } catch { $lines = @() }
        $items += , @{ key = $key; package = $pkg; title = $title; text = $(if ($big -ne '' -and $big.Length -gt $body.Length) { $big } else { $body }); when = $when; ongoing = $ongoing; lines = @($lines); hint = $hint }
    }
    $seen = @{}
    $uniq = @()
    foreach ($it in $items) { $k = $it.package + '|' + $it.title + '|' + $it.text; if (-not $seen.ContainsKey($k)) { $seen[$k] = $true; $uniq += , $it } }
    Send-Json $Ctx @{ items = @($uniq | Select-Object -First 80); count = $uniq.Count; note = $(if ($uniq.Count -eq 0 -and $r.out.Length -lt 50) { 'The phone did not return a notification list.' } else { '' }) }
}

# ---------------------------------------------------------------------------
# Demo mode (clean status bar for screenshots and presentations)
# ---------------------------------------------------------------------------
if (-not $Shared.demo) { $Shared.demo = [hashtable]::Synchronized(@{}) }
function Invoke-DemoBroadcast { param([string]$Serial, [string]$Extra) return (Invoke-DeviceShell $Serial ('am broadcast -a com.android.systemui.demo ' + $Extra) 12) }

$Routes['POST /api/demo'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $on = [bool](Get-Prop $body 'on' $true)
    $key = $(if ($serial) { $serial } else { 'default' })
    if ($on) {
        $hhmm = [string](Get-Prop $body 'clock' '1200'); if ($hhmm -notmatch '^\d{4}$') { $hhmm = '1200' }
        $bat = [int](Get-Prop $body 'battery' 100); if ($bat -lt 1 -or $bat -gt 100) { $bat = 100 }
        $r = Invoke-DeviceShell $serial 'settings put global sysui_demo_allowed 1' 12
        if ($r.code -ne 0) { Fail ('The phone refused demo mode: ' + ($r.err + $r.out).Trim()) }
        [void](Invoke-DemoBroadcast $serial '-e command enter')
        [void](Invoke-DemoBroadcast $serial ('-e command clock -e hhmm ' + $hhmm))
        [void](Invoke-DemoBroadcast $serial ('-e command battery -e level ' + $bat + ' -e plugged false'))
        [void](Invoke-DemoBroadcast $serial '-e command network -e wifi show -e level 4 -e fully true')
        [void](Invoke-DemoBroadcast $serial '-e command network -e mobile show -e datatype none -e level 4 -e fully true -e roam false')
        if ([bool](Get-Prop $body 'hideNotifications' $true)) { [void](Invoke-DemoBroadcast $serial '-e command notifications -e visible false') }
        if ([bool](Get-Prop $body 'dnd' $false)) { [void](Invoke-DeviceShell $serial 'cmd notification set_dnd priority' 12) }
        if ([bool](Get-Prop $body 'touches' $false)) { [void](Invoke-DeviceShell $serial 'settings put system show_touches 1' 12) }
        $Shared.demo[$key] = $true
        Add-Activity 'system' 'Demo mode turned on.'
        Send-Json $Ctx @{ ok = $true; on = $true; message = 'Demo mode is on. The status bar is clean.' }
    } else {
        [void](Invoke-DemoBroadcast $serial '-e command exit')
        [void](Invoke-DeviceShell $serial 'settings put global sysui_demo_allowed 0' 12)
        if ([bool](Get-Prop $body 'touches' $false)) { [void](Invoke-DeviceShell $serial 'settings put system show_touches 0' 12) }
        if ([bool](Get-Prop $body 'dnd' $false)) { [void](Invoke-DeviceShell $serial 'cmd notification set_dnd off' 12) }
        [void]$Shared.demo.Remove($key)
        Add-Activity 'system' 'Demo mode turned off.'
        Send-Json $Ctx @{ ok = $true; on = $false; message = 'Demo mode is off.' }
    }
}
$Routes['GET /api/demo'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $key = $(if ($serial) { $serial } else { 'default' })
    Send-Json $Ctx @{ on = [bool]$Shared.demo.ContainsKey($key) }
}

# ---------------------------------------------------------------------------
# Gallery (photos and videos on the phone)
# ---------------------------------------------------------------------------
$GalleryDirs = @{
    all         = @('/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Movies')
    camera      = @('/sdcard/DCIM/Camera')
    screenshots = @('/sdcard/Pictures/Screenshots', '/sdcard/DCIM/Screenshots', '/sdcard/Pictures/Screenshot')
    downloads   = @('/sdcard/Download')
    whatsapp    = @('/sdcard/Android/media/com.whatsapp/WhatsApp/Media', '/sdcard/WhatsApp/Media')
}
$GalleryImage = '(?i)\.(jpe?g|png|gif|webp|bmp)$'
$GalleryVideo = '(?i)\.(mp4|mkv|3gp|webm|mov)$'

function Test-GalleryPath {
    param([string]$Path)
    Test-PhonePath $Path
    if ($Path -notmatch '^/(sdcard|storage/emulated/0)/.+') { Fail 'The gallery only reads the shared storage folder.' }
}

$Routes['GET /api/gallery'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $set = Get-Query $Ctx 'set'
    if (-not $GalleryDirs.ContainsKey($set)) { $set = 'all' }
    $dirs = ($GalleryDirs[$set] | ForEach-Object { '''' + $_ + '''' }) -join ' '
    $r = Invoke-DeviceShell $serial ('find ' + $dirs + ' -type f -exec stat -c ''%s %Y %n'' {} + 2>/dev/null') 90
    $items = @()
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^(\d+) (\d+) (/.+)$') {
            $fsize = [long]$Matches[1]; $fmtime = [long]$Matches[2]; $path = $Matches[3]
            if ($path -match '/\.(thumbnails|trashed|pending|nomedia)' -or $path -match '/\.[^/]*$') { continue }
            $kind = ''
            if ($path -match $GalleryImage) { $kind = 'image' } elseif ($path -match $GalleryVideo) { $kind = 'video' } else { continue }
            $items += , @{ path = $path; name = ($path -replace '^.*/', ''); size = $fsize; mtime = $fmtime; kind = $kind }
        }
    }
    $sorted = @($items | Sort-Object { $_.mtime } -Descending)
    Send-Json $Ctx @{ set = $set; total = $sorted.Count; items = @($sorted | Select-Object -First 400) }
}

# Resizes a picture to a small JPEG with System.Drawing. Only called on Windows.
function Convert-ToThumb {
    param([byte[]]$Bytes, [string]$File, [bool]$Large)
    Add-Type -AssemblyName System.Drawing
    $ms = New-Object IO.MemoryStream (, $Bytes)
    $img = [Drawing.Image]::FromStream($ms)
    try {
        $max = $(if ($Large) { 1920 } else { 360 })
        $scale = [math]::Min(1.0, $max / [double][math]::Max($img.Width, $img.Height))
        $w = [math]::Max(1, [int]($img.Width * $scale)); $h = [math]::Max(1, [int]($img.Height * $scale))
        $bmp = New-Object Drawing.Bitmap $w, $h
        $g = [Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, 0, 0, $w, $h)
        $g.Dispose()
        $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $ep = New-Object Drawing.Imaging.EncoderParameters 1
        $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 82L
        $bmp.Save($File, $codec, $ep)
        $bmp.Dispose()
        return $true
    } finally { $img.Dispose(); $ms.Dispose() }
}

# Names a cached picture. SHA-256, so two different pictures can never end up with the same name.
function Get-ShortHash {
    param([string]$Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $b = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) } finally { $sha.Dispose() }
    $sb = New-Object Text.StringBuilder
    for ($i = 0; $i -lt 16; $i++) { [void]$sb.Append($b[$i].ToString('x2')) }
    return $sb.ToString()
}

$Routes['GET /api/gallery/thumb'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $path = Get-Query $Ctx 'path'
    Test-GalleryPath $path
    $full = ((Get-Query $Ctx 'full') -eq '1')
    if ($path -notmatch $GalleryImage) { Fail 'No picture preview for that file.' }
    $size = [long]0
    [void][long]::TryParse((Get-Query $Ctx 'size'), [ref]$size)
    if ($size -gt 40MB) { Fail 'That picture is too large to preview here.' }
    $dir = Join-Path $LogDir 'thumbs'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $hash = Get-ShortHash ($serial + '|' + $path + '|' + $size + '|' + $(if ($full) { 'f' } else { 't' }))
    $file = Join-Path $dir ($hash + '.jpg')
    if (-not (Test-Path -LiteralPath $file)) {
        # Forget pictures that were not looked at for a week, so the cache cannot grow forever.
        if ((Get-Random -Maximum 25) -eq 0) { try { Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue } catch {} }
        $part = $file + '.part'
        $got = Invoke-AdbBytes ((Resolve-Target $serial) + 'exec-out cat "' + $path + '"') 60
        $bytes = $got.bytes
        if ($got.code -ne 0 -or -not $bytes -or $bytes.Length -lt 16) { Fail 'The phone did not send that picture.' }
        $done = $false
        if ($OnWindows) { try { $done = Convert-ToThumb $bytes $part $full } catch { $done = $false } }
        if (-not $done) { [IO.File]::WriteAllBytes($part, $bytes) }
        # Write under a temporary name, then rename, so a half-written picture is never served from the cache.
        Move-Item -LiteralPath $part -Destination $file -Force
    }
    $type = 'image/jpeg'
    $head = New-Object byte[] 4
    $fs = [IO.File]::OpenRead($file); try { [void]$fs.Read($head, 0, 4) } finally { $fs.Dispose() }
    if ($head[0] -eq 0x89 -and $head[1] -eq 0x50) { $type = 'image/png' } elseif ($head[0] -eq 0x47 -and $head[1] -eq 0x49) { $type = 'image/gif' } elseif ($head[0] -eq 0x52 -and $head[1] -eq 0x49) { $type = 'image/webp' } elseif ($head[0] -eq 0x42 -and $head[1] -eq 0x4D) { $type = 'image/bmp' }
    Send-File $Ctx $file $type '' 'private, max-age=3600'
}

$Routes['POST /api/gallery/pull'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $paths = @()
    foreach ($p in @(Get-Prop $body 'paths' @())) { Test-GalleryPath ([string]$p); $paths += [string]$p }
    if ($paths.Count -eq 0) { Fail 'Choose at least one photo or video.' }
    if ($paths.Count -gt 500) { Fail 'Choose up to 500 files at a time.' }
    $id = New-Job 'pull' ('Copy ' + $paths.Count + ' file(s) to the PC') @{ serial = $serial; paths = $paths }
    Send-Json $Ctx @{ ok = $true; job = $id }
}

$Routes['POST /api/gallery/delete'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $n = 0
    $todo = @(Get-Prop $body 'paths' @())
    if ($todo.Count -gt 200) { Fail 'Delete up to 200 files at a time.' }
    foreach ($p in $todo) {
        Test-GalleryPath ([string]$p)
        $r = Invoke-DeviceShell $serial ('rm -f ''' + $p + '''') 15
        if ($r.code -eq 0) { $n++ }
    }
    Add-Activity 'files' ('Deleted ' + $n + ' file(s) from the phone gallery.')
    Send-Json $Ctx @{ ok = $true; deleted = $n }
}

# ---------------------------------------------------------------------------
# Inspector: UI tree of the current screen
# ---------------------------------------------------------------------------
function Add-UiNodes {
    param($Node, [int]$Parent, [int]$Depth, [System.Collections.ArrayList]$List)
    foreach ($c in $Node.ChildNodes) {
        if ($c.NodeType -ne 'Element' -or $c.Name -ne 'node') { continue }
        if ($List.Count -ge 900) { return }
        $b = [string]$c.GetAttribute('bounds')
        $idx = -1
        if ($b -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') {
            $l = [int]$Matches[1]; $t = [int]$Matches[2]; $rr = [int]$Matches[3]; $bb = [int]$Matches[4]
            if (($rr - $l) -gt 0 -and ($bb - $t) -gt 0) {
                $idx = $List.Count
                $cls = ([string]$c.GetAttribute('class')) -replace '^.*\.', ''
                [void]$List.Add(@{ i = $idx; p = $Parent; d = $Depth; cls = $cls; id = (([string]$c.GetAttribute('resource-id')) -replace '^[^:]*:id/', ''); pkg = [string]$c.GetAttribute('package'); text = [string]$c.GetAttribute('text'); desc = [string]$c.GetAttribute('content-desc'); b = @($l, $t, $rr, $bb); click = ([string]$c.GetAttribute('clickable') -eq 'true'); scroll = ([string]$c.GetAttribute('scrollable') -eq 'true'); edit = ([string]$c.GetAttribute('class') -match 'EditText') })
            }
        }
        $next = $(if ($idx -ge 0) { $idx } else { $Parent })
        Add-UiNodes $c $next ($Depth + 1) $List
    }
}

$Routes['GET /api/inspect'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'uiautomator dump /sdcard/stk-ui.xml >/dev/null 2>&1; cat /sdcard/stk-ui.xml; rm -f /sdcard/stk-ui.xml' 40
    $xmlText = $r.out
    $i = $xmlText.IndexOf('<?xml')
    if ($i -lt 0) { $i = $xmlText.IndexOf('<hierarchy') }
    if ($i -lt 0) { Fail 'The phone could not read the screen layout. Unlock the phone and leave an app open, then try again. Some screens (banking, secure apps) block it.' }
    $xmlText = $xmlText.Substring($i)
    try { $doc = New-Object Xml.XmlDocument; $doc.LoadXml($xmlText) } catch { Fail 'The screen layout from the phone could not be read.' }
    $list = New-Object System.Collections.ArrayList
    Add-UiNodes $doc.DocumentElement -1 0 $list
    $w = 0; $h = 0
    foreach ($n in $list) { if ($n.b[2] -gt $w) { $w = $n.b[2] }; if ($n.b[3] -gt $h) { $h = $n.b[3] } }
    Send-Json $Ctx @{ nodes = @($list); width = $w; height = $h; count = $list.Count }
}

# ---------------------------------------------------------------------------
# Intent launcher
# ---------------------------------------------------------------------------
$Routes['POST /api/intent'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $parts = @('am start')
    $action = ([string](Get-Prop $body 'action' '')).Trim()
    $data = ([string](Get-Prop $body 'data' '')).Trim()
    $comp = ([string](Get-Prop $body 'component' '')).Trim()
    $pkg = ([string](Get-Prop $body 'package' '')).Trim()
    $cat = ([string](Get-Prop $body 'category' '')).Trim()
    if ($action -ne '') { if ($action -notmatch '^[A-Za-z0-9._]{1,120}$') { Fail 'The action can use letters, numbers, dots and underscores.' }; $parts += '-a ' + $action }
    if ($data -ne '') { if ($data -notmatch '^[A-Za-z0-9._~:/?#@=&%+,;\-]{1,300}$') { Fail 'The data address has characters that are not allowed.' }; $parts += '-d ''' + $data + '''' }
    if ($comp -ne '') { if ($comp -notmatch '^[A-Za-z0-9._]+/[A-Za-z0-9._$]+$') { Fail 'The component looks like com.example.app/.MainActivity.' }; $parts += '-n ''' + $comp + '''' }
    if ($pkg -ne '') { Test-PackageName $pkg; $parts += '-p ' + $pkg }
    if ($cat -ne '') { if ($cat -notmatch '^[A-Za-z0-9._]{1,120}$') { Fail 'The category can use letters, numbers, dots and underscores.' }; $parts += '-c ' + $cat }
    foreach ($e in @(Get-Prop $body 'extras' @())) {
        $t = [string](Get-Prop $e 'type' 'es'); $k = [string](Get-Prop $e 'key' ''); $v = [string](Get-Prop $e 'value' '')
        if ($t -notin @('es', 'ei', 'ez')) { Fail 'Unknown extra type.' }
        if ($k -notmatch '^[A-Za-z0-9._]{1,60}$') { Fail 'Extra names can use letters, numbers, dots and underscores.' }
        if ($t -eq 'ei' -and $v -notmatch '^-?\d{1,12}$') { Fail 'A number extra needs a whole number.' }
        if ($t -eq 'ez' -and $v -notin @('true', 'false')) { Fail 'A yes/no extra must be true or false.' }
        if ($t -eq 'es' -and $v -notmatch '^[A-Za-z0-9 ._~:/?#@=&%+,;\-]{0,200}$') { Fail 'That extra text has characters that are not allowed.' }
        $parts += ('--' + $t + ' ' + $k + ' ''' + $v + '''')
    }
    if ($parts.Count -eq 1) { Fail 'Fill in at least an action, a link or a component.' }
    $r = Invoke-DeviceShell $serial ($parts -join ' ') 20
    $o = ($r.out + $r.err)
    if ($r.code -ne 0 -or $o -match 'Error|Exception|unable to resolve|No activity found') { Fail ('The phone could not open that: ' + $o.Trim()) }
    Send-Json $Ctx @{ ok = $true; message = 'Sent to the phone.'; command = ($parts -join ' ') }
}

# ---------------------------------------------------------------------------
# Insights: usage, battery by app, system access and permissions
# ---------------------------------------------------------------------------
function Add-UsageMs {
    param([hashtable]$Totals, [string]$Pkg, [double]$Ms)
    if ($Pkg -ne '' -and $Ms -gt 0 -and $Ms -lt 21600000) {
        if ($Totals.ContainsKey($Pkg)) { $Totals[$Pkg] = [double]$Totals[$Pkg] + $Ms } else { $Totals[$Pkg] = [double]$Ms }
    }
}

# Screen time from the foreground/background events the phone logged today.
function Get-UsageFromEvents {
    param([string]$Serial)
    $totals = @{}
    $r = Invoke-DeviceShell $Serial 'dumpsys usagestats 2>/dev/null | grep -E ''type=(ACTIVITY_RESUMED|ACTIVITY_PAUSED|ACTIVITY_STOPPED|MOVE_TO_FOREGROUND|MOVE_TO_BACKGROUND|SCREEN_NON_INTERACTIVE)'' | tail -n 5000' 45
    $ev = @()
    foreach ($line in (([string]$r.out) -split "`n")) {
        $m = [regex]::Match($line, 'time="?([0-9][0-9:\-\. T]*?)"?\s+type=([A-Z_]+)(?:\s+package=([A-Za-z0-9._]+))?')
        if (-not $m.Success) { continue }
        $ts = $m.Groups[1].Value.Trim()
        $ms = [double]0
        $tod = [double]-1
        if ($ts -match '^\d{10,}$') { $ms = [double]$ts }
        else {
            $dt = [datetime]::MinValue
            if ([datetime]::TryParse($ts, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$dt)) { $ms = [double]($dt.Ticks / 10000.0); $tod = [double]$dt.TimeOfDay.TotalMilliseconds } else { continue }
        }
        $ev += , @{ ms = $ms; tod = $tod; type = $m.Groups[2].Value; pkg = [string]$m.Groups[3].Value }
    }
    if ($ev.Count -eq 0) { return $totals }
    $ev = @($ev | Sort-Object { $_.ms })
    $last = $ev[$ev.Count - 1]
    $span = [double]86400000
    if ($last.tod -ge 0) { $span = [double]$last.tod }
    $cut = [double]$last.ms - $span
    $cur = ''
    $start = [double]0
    foreach ($e in $ev) {
        if ($e.ms -lt $cut) { continue }
        $t = [string]$e.type
        if ($t -eq 'ACTIVITY_RESUMED' -or $t -eq 'MOVE_TO_FOREGROUND') {
            if ($cur -ne '' -and $cur -ne $e.pkg) { Add-UsageMs $totals $cur ($e.ms - $start) }
            if ($cur -ne $e.pkg) { $cur = [string]$e.pkg; $start = [double]$e.ms }
        }
        elseif ($t -eq 'ACTIVITY_PAUSED' -or $t -eq 'ACTIVITY_STOPPED' -or $t -eq 'MOVE_TO_BACKGROUND') {
            if ($cur -ne '' -and $cur -eq $e.pkg) { Add-UsageMs $totals $cur ($e.ms - $start); $cur = '' }
        }
        elseif ($t -eq 'SCREEN_NON_INTERACTIVE') {
            if ($cur -ne '') { Add-UsageMs $totals $cur ($e.ms - $start); $cur = '' }
        }
    }
    return $totals
}

$Routes['GET /api/insights/usage'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $totals = @{}
    $source = ''
    try { $totals = Get-UsageFromEvents $serial; $source = 'events' } catch { $totals = @{} }
    $big = 0
    foreach ($k in @($totals.Keys)) { if ([double]$totals[$k] -lt 1000) { $totals.Remove($k) } }
    if ($totals.Count -eq 0) {
        $source = 'summary'
        $r = Invoke-DeviceShell $serial 'dumpsys usagestats 2>/dev/null | sed -n ''/daily stats/,/weekly stats/p'' | grep -E ''package=.*(totalTimeUsed|totalTimeInForeground)'' | head -n 400' 40
        foreach ($line in (([string]$r.out) -split "`n")) {
            if ($line -match 'package=([A-Za-z0-9._]+)' ) {
                $pkg = $Matches[1]
                $ms = [long]0
                if ($line -match 'totalTimeUsed="?([^"]*?)"?(?:\s+lastTime|\s+appLaunchCount|$)') { $ms = ConvertFrom-DurationText $Matches[1] }
                elseif ($line -match 'totalTimeInForeground="?([^"\s]+)') { $ms = ConvertFrom-DurationText $Matches[1] }
                if ($ms -gt 0) { if (-not $totals.ContainsKey($pkg) -or $totals[$pkg] -lt $ms) { $totals[$pkg] = $ms } }
            }
        }
    }
    $apps = @($totals.Keys | ForEach-Object { @{ package = $_; ms = [long]$totals[$_] } } | Sort-Object { $_.ms } -Descending | Select-Object -First 25)
    Send-Json $Ctx @{ apps = $apps; source = $source; note = $(if ($apps.Count -eq 0) { 'This phone did not share usage times. Some makers hide them from adb.' } else { '' }) }
}

$Routes['GET /api/insights/battery'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'dumpsys batterystats 2>/dev/null | grep -E ''^\s+Uid [a-z0-9]+: [0-9.]+'' | head -n 60; echo @@UID; pm list packages -U 2>/dev/null' 40
    $uidMap = @{}
    $inUid = $false
    $raw = @()
    foreach ($line in ($r.out -split "`r?`n")) {
        if ($line -match '^@@UID') { $inUid = $true; continue }
        if ($inUid) { if ($line -match 'package:([A-Za-z0-9._]+)\s+uid:(\d+)') { $uidMap[$Matches[2]] = $Matches[1] }; continue }
        if ($line -match '^\s+Uid ([a-z0-9]+): ([0-9.]+)') {
            $raw += , @($Matches[1], $Matches[2])
        }
    }
    $rows = @()
    foreach ($pair in $raw) {
        $u = $pair[0]
        if ($true) {
            $mah = [double]::Parse($pair[1], [Globalization.CultureInfo]::InvariantCulture)
            $uidNum = ''
            if ($u -match '^u0a(\d+)$') { $uidNum = [string](10000 + [int]$Matches[1]) } elseif ($u -match '^\d+$') { $uidNum = $u }
            $name = $u
            if ($uidNum -ne '' -and $uidMap.ContainsKey($uidNum)) { $name = $uidMap[$uidNum] } elseif ($u -eq '1000') { $name = 'Android system' }
            $rows += , @{ uid = $u; package = $name; mah = [math]::Round($mah, 1) }
        }
    }
    if ($rows.Count -eq 0) {
        # Second source: the machine readable battery report (lines like 9,10123,l,pwi,uid,12.5,...).
        $c = Invoke-DeviceShell $serial 'dumpsys batterystats --checkin 2>/dev/null | grep -E '',pwi,uid,'' | head -n 120' 40
        foreach ($line in (([string]$c.out) -split "`n")) {
            $cm = [regex]::Match($line, '^\s*\d+,(\d+),[a-z],pwi,uid,([0-9.]+)')
            if (-not $cm.Success) { continue }
            $uidNum = $cm.Groups[1].Value
            $mah = [double]::Parse($cm.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)
            if ($mah -le 0) { continue }
            $name = $uidNum
            if ($uidMap.ContainsKey($uidNum)) { $name = $uidMap[$uidNum] } elseif ($uidNum -eq '1000') { $name = 'Android system' }
            $rows += , @{ uid = $uidNum; package = $name; mah = [math]::Round($mah, 1) }
        }
    }
    $rows = @($rows | Sort-Object { $_.mah } -Descending | Select-Object -First 15)
    $sum = 0.0
    foreach ($x in $rows) { $sum += $x.mah }
    Send-Json $Ctx @{ apps = $rows; totalMah = [math]::Round($sum, 1); note = $(if ($rows.Count -eq 0) { 'This phone did not share battery use by app.' } else { '' }) }
}

$Routes['GET /api/insights/access'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $r = Invoke-DeviceShell $serial 'echo A=$(settings get secure enabled_accessibility_services); echo N=$(settings get secure enabled_notification_listeners); echo I=$(settings get secure default_input_method); echo @@DA; dumpsys device_policy 2>/dev/null | grep -E ''admin=|Admin|ComponentInfo'' | head -n 10' 25
    $kv = ConvertFrom-KeyLines (($r.out -split '@@DA')[0])
    $split = { param($v) @(([string]$v -split ':') | Where-Object { $_ -and $_ -ne 'null' } | ForEach-Object { $_.Trim() }) }
    $admins = @()
    if ($r.out -match '@@DA') { foreach ($l in (($r.out -split '@@DA')[1] -split "`r?`n")) { if ($l -match '([A-Za-z0-9._]+/[A-Za-z0-9._$]+)') { $admins += $Matches[1] } } }
    Send-Json $Ctx @{ accessibility = @(& $split $kv.A); listeners = @(& $split $kv.N); keyboard = [string]$kv.I; admins = @($admins | Select-Object -Unique) }
}

$RuntimePerms = @('CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'READ_CONTACTS', 'WRITE_CONTACTS', 'READ_SMS', 'SEND_SMS', 'RECEIVE_SMS', 'READ_CALL_LOG', 'CALL_PHONE', 'READ_PHONE_STATE', 'READ_CALENDAR', 'WRITE_CALENDAR', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'POST_NOTIFICATIONS', 'BODY_SENSORS', 'ACTIVITY_RECOGNITION', 'BLUETOOTH_CONNECT', 'BLUETOOTH_SCAN', 'NEARBY_WIFI_DEVICES')
$Routes['GET /api/perms'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $pkg = Get-Query $Ctx 'package'
    Test-PackageName $pkg
    $r = Invoke-DeviceShell $serial ('dumpsys package ' + $pkg + ' 2>/dev/null | sed -n ''/runtime permissions:/,$p'' | grep -E ''granted='' | head -n 80') 25
    $out = @()
    $seen = @{}
    foreach ($l in ($r.out -split "`r?`n")) {
        if ($l -match '^\s*([A-Za-z0-9_.]+):\s*granted=(true|false)') {
            $name = $Matches[1]
            if ($seen.ContainsKey($name)) { continue }
            $seen[$name] = $true
            $short = $name -replace '^.*\.', ''
            $out += , @{ name = $name; short = $short; granted = ($Matches[2] -eq 'true'); changeable = ($RuntimePerms -contains $short) }
        }
    }
    Send-Json $Ctx @{ package = $pkg; perms = $out }
}
$Routes['POST /api/perms'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $pkg = [string](Get-Prop $body 'package' '')
    Test-PackageName $pkg
    $perm = [string](Get-Prop $body 'permission' '')
    if ($perm -notmatch '^[A-Za-z0-9_.]{3,120}$' -or ($RuntimePerms -notcontains ($perm -replace '^.*\.', ''))) { Fail 'That permission cannot be changed from here.' }
    $verb = $(if ([bool](Get-Prop $body 'grant' $false)) { 'grant' } else { 'revoke' })
    $r = Invoke-DeviceShell ([string](Get-Prop $body 'serial' '')) ('pm ' + $verb + ' ' + $pkg + ' ' + $perm) 20
    if ($r.code -ne 0 -or ($r.out + $r.err) -match 'Exception|Error|Unknown') { Fail ('The phone refused: ' + (($r.out + $r.err).Trim() -split "`n" | Select-Object -First 1)) }
    Send-Json $Ctx @{ ok = $true }
}

# ---------------------------------------------------------------------------
# Typing text from the PC (more characters than the quick text box)
# ---------------------------------------------------------------------------
$Routes['POST /api/type'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $text = [string](Get-Prop $body 'text' '')
    if ($text.Length -gt 600) { Fail 'Paste up to 600 characters at a time.' }
    if ($text -match '[^\x20-\x7E\r\n\t]') { Fail 'The phone can only type plain English letters, numbers and symbols this way.' }
    if ($text -match '[''\\`]') { Fail 'Apostrophes, backslashes and back-ticks cannot be typed this way. Remove them or type them on the phone.' }
    $lines = @($text -split "`r?`n")
    $n = 0
    foreach ($line in $lines) {
        $line = $line -replace "`t", ' '
        if ($line -ne '') {
            $enc = ($line -replace '%', '%%' -replace ' ', '%s')
            $r = Invoke-DeviceShell $serial ('input text ''' + $enc + '''') 15
            if ($r.code -ne 0) { Fail ('The phone did not accept the text: ' + ($r.err + $r.out).Trim()) }
        }
        $n++
        if ($n -lt $lines.Count) { [void](Invoke-DeviceShell $serial 'input keyevent 66' 10) }
    }
    Send-Json $Ctx @{ ok = $true; message = 'Typed on the phone.' }
}

# ---------------------------------------------------------------------------
# Automatic Wi-Fi reconnect for phones used before
# ---------------------------------------------------------------------------
function Invoke-AutoReconnect {
    if (-not (Get-Settings).autoReconnect) { return }
    $hosts = @(Get-StoreValue 'wifihosts' @())
    if ($hosts.Count -eq 0) { return }
    $ids = @($Shared.devices | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_.id })
    foreach ($h in $hosts) {
        $h = [string]$h
        if ($h -notmatch '^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$') { continue }
        if ($ids -contains $h) { continue }
        $last = $Shared.reconnectAt[$h]
        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($last -and ($nowMs - [long]$last) -lt 30000) { continue }
        $Shared.reconnectAt[$h] = $nowMs
        try { [void](Invoke-Adb ('connect ' + $h) 5) } catch {}
    }
}
if (-not $Shared.reconnectAt) { $Shared.reconnectAt = [hashtable]::Synchronized(@{}) }

$Routes['POST /api/wifi-hosts'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $list = @()
    foreach ($h in @(Get-Prop $body 'hosts' @())) { if (([string]$h) -match '^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$') { $list += [string]$h } }
    Set-StoreValue 'wifihosts' @($list | Select-Object -First 12)
    Send-Json $Ctx @{ ok = $true }
}

function Add-WifiHost {
    param([string]$Address)
    try {
        $list = @(Get-StoreValue 'wifihosts' @())
        if ($list -notcontains $Address) { Set-StoreValue 'wifihosts' @(@($Address) + $list | Select-Object -First 12) }
    } catch {}
}

# ---------------------------------------------------------------------------
# 3.7 Performance Studio backend: Game Mode (fixed), performance mode, refresh rate, boost tools,
# live performance snapshot, ping test and frame stats. Everything is reversible and uses standard
# Android shell commands. Failures report the phone's real answer instead of a guess.
#
# NOTE: this file must not define its own Test-PackageName. handlers.ps1 owns that name and other
# routes rely on it throwing for a bad package. The yes/no check here is called Test-PackageOk.
# ---------------------------------------------------------------------------
function Test-PackageOk([string]$Pkg) { return [bool]($Pkg.Length -le 150 -and $Pkg -match '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$') }

function Get-ShellText($r) { return ((([string]$r.out) + ' ' + ([string]$r.err)) -replace '\s+', ' ').Trim() }
function Limit-Text([string]$t, [int]$n = 220) { $t = ($t -replace '\s+', ' ').Trim(); if ($t.Length -gt $n) { return $t.Substring(0, $n) + '...' } return $t }
# Words that mean a shell command really failed. Plain "error" is NOT in this list on purpose: it showed up in
# harmless output and made working phones look unsupported.
$ShellFailPattern = '(?i)exception|unknown command|can''t find service|service .* not found|permission denial|not allowed|inaccessible|usage:|aborted|no such file|invalid|not valid'

function Get-DeviceVersion([string]$Serial) {
    $r = Invoke-DeviceShell $Serial 'echo sdk=$(getprop ro.build.version.sdk); echo rel=$(getprop ro.build.version.release); echo maker=$(getprop ro.product.manufacturer)' 12
    $kv = ConvertFrom-KeyLines $r.out
    $sdk = 0; [void][int]::TryParse(([string]$kv.sdk).Trim(), [ref]$sdk)
    return @{ sdk = $sdk; release = ([string]$kv.rel).Trim(); maker = ([string]$kv.maker).Trim() }
}

function Test-ShellService([string]$Serial, [string]$Name) {
    $r = Invoke-DeviceShell $Serial 'cmd -l 2>/dev/null' 12
    foreach ($line in (([string]$r.out) -split "`r?`n")) { if ($line.Trim() -eq $Name) { return $true } }
    return $false
}

$Routes['POST /api/game-tools'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    $action = [string](Get-Prop $body 'action' '')
    $pkg = [string](Get-Prop $body 'pkg' '')
    $on = [bool](Get-Prop $body 'on' $true)
    switch ($action) {
        'freemem' {
            $r = Invoke-DeviceShell $serial 'am kill-all' 20
            if ($r.code -ne 0) { Fail ('The phone refused to free memory: ' + (Limit-Text (Get-ShellText $r))) }
            Add-Activity 'system' 'Freed background memory on the phone.'
            Send-Json $Ctx @{ ok = $true; message = 'Background apps were closed to free memory.' }
        }
        'forcestop' {
            $keep = [string](Get-Prop $body 'keep' '')
            $protect = '^(android|com\.android\.(systemui|phone|settings|bluetooth|nfc|server\.telecom|providers\..*|inputmethod\..*)|com\.google\.android\.(gms|gsf|inputmethod\..*|apps\.nexuslauncher)|com\.sec\.android\.app\.launcher|com\.miui\.home|com\.android\.launcher\d*)$'
            $done = 0; $cmds = @()
            foreach ($p in @(Get-Prop $body 'packages' @())) {
                $p = [string]$p
                if (-not (Test-PackageOk $p) -or $p -eq $keep -or $p -match $protect) { continue }
                $cmds += ('am force-stop ' + $p)
                if ($cmds.Count -ge 40) { break }
            }
            if ($cmds.Count -eq 0) { Send-Json $Ctx @{ ok = $true; stopped = 0; message = 'Nothing to stop.' }; return }
            $r = Invoke-DeviceShell $serial ($cmds -join ';') 40
            if ($r.code -ne 0) { Fail ('The phone refused to stop those apps: ' + (Limit-Text (Get-ShellText $r))) }
            Add-Activity 'system' ('Stopped ' + $cmds.Count + ' background apps.')
            Send-Json $Ctx @{ ok = $true; stopped = $cmds.Count; message = ('Stopped ' + $cmds.Count + ' background apps.') }
        }
        'trimcache' {
            $r = Invoke-DeviceShell $serial 'pm trim-caches 4096G' 40
            $txt = Get-ShellText $r
            if ($r.code -ne 0 -or $txt -match $ShellFailPattern) { Fail ('The phone would not clear app caches. It said: ' + (Limit-Text $txt)) }
            Send-Json $Ctx @{ ok = $true; message = 'App caches were cleared.' }
        }
        'perfmode' {
            $v = Get-DeviceVersion $serial
            if ($v.sdk -gt 0 -and $v.sdk -lt 31) { Fail ('Fixed performance mode needs Android 12 or newer. This phone runs Android ' + $v.release + '.') }
            $r = Invoke-DeviceShell $serial ('cmd power set-fixed-performance-mode-enabled ' + $(if ($on) { 'true' } else { 'false' })) 15
            $txt = Get-ShellText $r
            if ($r.code -ne 0 -or $txt -match $ShellFailPattern) {
                Fail ('This phone does not offer fixed performance mode (Android ' + $v.release + ' is new enough, so the phone hardware or maker firmware is what blocks it). The phone said: ' + $(if ($txt) { Limit-Text $txt } else { 'nothing' }))
            }
            Send-Json $Ctx @{ ok = $true; on = $on; message = $(if ($on) { 'Performance mode is on. The phone may run warmer.' } else { 'Performance mode is off.' }) }
        }
        'gameinfo' {
            $v = Get-DeviceVersion $serial
            $svc = Test-ShellService $serial 'game'
            $modes = ''
            if ($svc -and (Test-PackageOk $pkg)) { $m = Invoke-DeviceShell $serial ('cmd game list-modes ' + $pkg) 15; $modes = Limit-Text (Get-ShellText $m) 300 }
            Send-Json $Ctx @{ ok = $true; sdk = $v.sdk; release = $v.release; maker = $v.maker; service = $svc; modes = $modes; supported = ($v.sdk -ge 31 -and $svc) }
        }
        'gamemode' {
            if (-not (Test-PackageOk $pkg)) { Fail 'Pick a valid game first.' }
            $mode = [string](Get-Prop $body 'mode' 'performance')
            if ($mode -notin @('performance', 'battery', 'standard')) { Fail 'Unknown game mode.' }
            $v = Get-DeviceVersion $serial
            if ($v.sdk -gt 0 -and $v.sdk -lt 31) { Fail ('Android Game Mode needs Android 12 or newer. This phone runs Android ' + $v.release + '.') }
            # 'cmd game mode <mode> <package>' is the documented form (Android 12 and later). The others are fallbacks for builds that differ.
            $tries = @(
                ('cmd game mode ' + $mode + ' ' + $pkg),
                ('cmd game mode --user 0 ' + $mode + ' ' + $pkg),
                ('cmd game set --mode ' + $mode + ' ' + $pkg),
                ('cmd game set --mode ' + $mode + ' --user 0 ' + $pkg)
            )
            $last = ''; $good = $false
            foreach ($t in $tries) {
                $r = Invoke-DeviceShell $serial $t 15
                $txt = Get-ShellText $r
                $last = $txt
                if ($r.code -eq 0 -and $txt -notmatch $ShellFailPattern) { $good = $true; break }
            }
            if (-not $good) {
                if (-not (Test-ShellService $serial 'game')) {
                    Fail ('This phone (Android ' + $v.release + ', ' + $v.maker + ') has no Android Game Mode service. The maker removed it and uses its own game booster instead (for example Game Booster, Game Turbo or Game Space). Open that app on the phone.')
                }
                if ($last -match '(?i)not a game|category|not support|unsupported|not available') {
                    Fail ('Android only allows Game Mode on apps that are marked as games or that declare support for it. That app is not, so the phone ignored the request. The phone said: ' + (Limit-Text $last))
                }
                Fail ('Game Mode exists on this phone (Android ' + $v.release + ') but it would not accept the change. The phone said: ' + $(if ($last) { Limit-Text $last } else { 'nothing' }))
            }
            $m = Invoke-DeviceShell $serial ('cmd game list-modes ' + $pkg) 15
            Send-Json $Ctx @{ ok = $true; mode = $mode; modes = (Limit-Text (Get-ShellText $m) 300); message = ('Game Mode set to ' + $mode + '.') }
        }
        'refresh' {
            $min = [string](Get-Prop $body 'min' ''); $peak = [string](Get-Prop $body 'peak' '')
            $hz = [int](Get-Prop $body 'hz' -1)
            if ($hz -ge 0) {
                if ($hz -eq 0) { $min = 'null'; $peak = 'null' }
                elseif ($hz -lt 30 -or $hz -gt 240) { Fail 'That refresh rate is not supported.' }
                else { $min = [string]$hz; $peak = [string]$hz }
            }
            foreach ($x in @($min, $peak)) { if ($x -notmatch '^(null|\d{1,3}(\.\d{1,2})?)$') { Fail 'That refresh rate is not supported.' } }
            $cmds = @()
            foreach ($pair in @(@('min_refresh_rate', $min), @('peak_refresh_rate', $peak))) {
                if ($pair[1] -eq 'null') { $cmds += ('settings delete system ' + $pair[0]) } else { $cmds += ('settings put system ' + $pair[0] + ' ' + $pair[1]) }
            }
            $r = Invoke-DeviceShell $serial ($cmds -join ';') 15
            $txt = Get-ShellText $r
            if ($r.code -ne 0 -or $txt -match '(?i)exception|permission denial|not allowed') { Fail ('The phone refused the refresh rate change. ' + (Limit-Text $txt)) }
            Send-Json $Ctx @{ ok = $true; message = $(if ($peak -eq 'null') { 'Refresh rate is back to automatic.' } else { 'Refresh rate set to ' + $peak + ' Hz.' }) }
        }
        'batterysaver' {
            $r = Invoke-DeviceShell $serial ('settings put global low_power ' + $(if ($on) { '1' } else { '0' })) 12
            $txt = Get-ShellText $r
            if ($r.code -ne 0 -or $txt -match '(?i)exception|permission denial|not allowed') { Fail ('The phone refused to change battery saver. ' + (Limit-Text $txt)) }
            Send-Json $Ctx @{ ok = $true; message = $(if ($on) { 'Battery saver is on.' } else { 'Battery saver is off, so the phone is free to run at full speed.' }) }
        }
        'resetstats' {
            if (-not (Test-PackageOk $pkg)) { Fail 'Pick an app first.' }
            $r = Invoke-DeviceShell $serial ('dumpsys gfxinfo ' + $pkg + ' reset') 15
            Send-Json $Ctx @{ ok = $true; message = 'Frame counters were reset.' }
        }
        'ping' {
            $hostName = [string](Get-Prop $body 'host' '8.8.8.8')
            if ($hostName -notmatch '^[A-Za-z0-9][A-Za-z0-9.\-]{0,98}$') { Fail 'Use an address like 8.8.8.8 or a host name like example.com.' }
            $r = Invoke-DeviceShell $serial ('ping -c 8 -W 2 ' + $hostName) 40
            $t = [string]$r.out
            $times = @()
            foreach ($m in [regex]::Matches($t, 'time[=<]([\d.]+)\s*ms')) { $times += [double]::Parse($m.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture) }
            $o = @{ ok = $true; host = $hostName; sent = 0; received = $times.Count; lossPct = 100; min = $null; avg = $null; max = $null; jitter = $null; times = @($times) }
            if ($t -match '(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets )?received') { $o.sent = [int]$Matches[1]; $o.received = [int]$Matches[2] }
            if ($t -match '([\d.]+)%\s+packet loss') { $o.lossPct = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture) } elseif ($o.sent -gt 0) { $o.lossPct = [math]::Round(100 * (1 - $o.received / $o.sent), 1) }
            if ($times.Count -gt 0) {
                $o.min = [math]::Round(($times | Measure-Object -Minimum).Minimum, 1)
                $o.max = [math]::Round(($times | Measure-Object -Maximum).Maximum, 1)
                $o.avg = [math]::Round(($times | Measure-Object -Average).Average, 1)
                if ($times.Count -gt 1) { $d = 0.0; for ($i = 1; $i -lt $times.Count; $i++) { $d += [math]::Abs($times[$i] - $times[$i - 1]) }; $o.jitter = [math]::Round($d / ($times.Count - 1), 1) }
            } elseif ((Get-ShellText $r) -match '(?i)unknown host|bad address|network is unreachable') {
                Fail 'The phone could not reach that address. Check that it is online.'
            }
            Send-Json $Ctx $o
        }
        default { Fail 'Unknown gaming tool.' }
    }
}

$Routes['GET /api/game-stats'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $pkg = Get-Query $Ctx 'pkg'
    if (-not (Test-PackageOk $pkg)) { Fail 'Pick an app first.' }
    $r = Invoke-DeviceShell $serial ('dumpsys gfxinfo ' + $pkg) 20
    $t = [string]$r.out
    $o = @{ ok = $true; pkg = $pkg; frames = 0; janky = 0; jankyPct = 0.0; p50 = $null; p90 = $null; p95 = $null; p99 = $null; running = $false }
    if ($t -match 'Total frames rendered:\s*(\d+)') { $o.frames = [int]$Matches[1]; $o.running = $true }
    if ($t -match 'Janky frames:\s*(\d+)\s*\(([\d.]+)%\)') { $o.janky = [int]$Matches[1]; $o.jankyPct = [double]::Parse($Matches[2], [Globalization.CultureInfo]::InvariantCulture) }
    if ($t -match '50th percentile:\s*(\d+)ms') { $o.p50 = [int]$Matches[1] }
    if ($t -match '90th percentile:\s*(\d+)ms') { $o.p90 = [int]$Matches[1] }
    if ($t -match '95th percentile:\s*(\d+)ms') { $o.p95 = [int]$Matches[1] }
    if ($t -match '99th percentile:\s*(\d+)ms') { $o.p99 = [int]$Matches[1] }
    Send-Json $Ctx $o
}

# One call that reads everything the Performance Studio shows: CPU load and per-core speed, temperatures,
# thermal status, memory, GPU where the phone exposes it, battery, display and Wi-Fi.
if (-not $Shared.perfPrev) { $Shared.perfPrev = [hashtable]::Synchronized(@{}) }

$Routes['GET /api/perf-snapshot'] = { param($Ctx)
    $serial = Get-Query $Ctx 'id'
    $script = @(
        'echo @@STAT; head -n 1 /proc/stat',
        'echo @@CPU; for c in /sys/devices/system/cpu/cpu[0-9]*; do echo ${c##*/} $(cat $c/cpufreq/scaling_cur_freq 2>/dev/null) $(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null); done',
        'echo @@GOV; cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null',
        'echo @@TZ; for z in /sys/class/thermal/thermal_zone*; do echo $(cat $z/type 2>/dev/null)=$(cat $z/temp 2>/dev/null); done 2>/dev/null | head -n 70',
        'echo @@TS; dumpsys thermalservice 2>/dev/null | grep -E ''Thermal Status|mValue='' | head -n 16',
        'echo @@BAT; dumpsys battery 2>/dev/null; echo cur=$(cat /sys/class/power_supply/battery/current_now 2>/dev/null)',
        'echo @@MEM; head -n 25 /proc/meminfo',
        'echo @@LOAD; cat /proc/loadavg 2>/dev/null',
        'echo @@GPU; for f in /sys/class/kgsl/kgsl-3d0/gpuclk /sys/class/kgsl/kgsl-3d0/devfreq/cur_freq /sys/kernel/gpu/gpu_clock /sys/class/devfreq/*gpu*/cur_freq /sys/class/devfreq/*mali*/cur_freq; do [ -r $f ] && echo freq=$(cat $f 2>/dev/null); done; echo busy=$(cat /sys/class/kgsl/kgsl-3d0/gpu_busy_percentage 2>/dev/null)',
        'echo @@DISP; echo peak=$(settings get system peak_refresh_rate); echo min=$(settings get system min_refresh_rate); echo bright=$(settings get system screen_brightness); echo lowpower=$(settings get global low_power); echo anim=$(settings get global animator_duration_scale); echo hz=$(dumpsys display 2>/dev/null | grep -m1 -oE ''renderFrameRate [0-9.]+|mRefreshRate=[0-9.]+'')',
        'echo @@WIFI; dumpsys wifi 2>/dev/null | grep -m1 mWifiInfo'
    ) -join ';'
    $r = Invoke-DeviceShell $serial $script 25
    $sec = @{}
    $cur = ''
    foreach ($line in (([string]$r.out) -split "`r?`n")) {
        if ($line -match '^@@([A-Z]+)\s*$') { $cur = $Matches[1]; $sec[$cur] = ''; continue }
        if ($cur) { $sec[$cur] += $line + "`n" }
    }
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $o = @{ ok = $true; at = $now; cpu = $null; cores = @(); governor = ''; zones = @(); hal = @(); thermalStatus = $null; battery = -1; charging = $false; batteryTempC = $null; voltage = $null; currentMa = $null
            memTotalMb = $null; memUsedMb = $null; memPct = $null; swapUsedMb = $null; swapTotalMb = $null; load1 = $null; gpuMhz = $null; gpuBusy = $null
            refreshPeak = $null; refreshMin = $null; renderHz = $null; brightness = $null; batterySaver = $false; animations = $null; wifi = $null }
    # CPU load from two /proc/stat samples
    if ($sec.STAT -match '(?m)^cpu\s+(.+)$') {
        $v = @($Matches[1].Trim() -split '\s+' | ForEach-Object { [long]$_ })
        $tot = [long]0; foreach ($x in $v) { $tot += $x }
        $idle = [long]0; if ($v.Count -ge 5) { $idle = $v[3] + $v[4] } elseif ($v.Count -ge 4) { $idle = $v[3] }
        $prev = $Shared.perfPrev[$serial]
        if ($prev -and $tot -gt [long]$prev.tot) { $o.cpu = [math]::Round([math]::Max(0, [math]::Min(100, 100 * (1 - ($idle - [long]$prev.idle) / ($tot - [long]$prev.tot)))), 1) }
        $Shared.perfPrev[$serial] = @{ tot = $tot; idle = $idle }
    }
    $cores = @()
    foreach ($line in (([string]$sec.CPU) -split "`n")) {
        if ($line -match '^cpu(\d+)\s*(\d*)\s*(\d*)\s*$') { $cores += , @{ id = [int]$Matches[1]; mhz = $(if ($Matches[2]) { [int]([long]$Matches[2] / 1000) } else { $null }); maxMhz = $(if ($Matches[3]) { [int]([long]$Matches[3] / 1000) } else { $null }) } }
    }
    $o.cores = @($cores)
    $o.governor = ([string]$sec.GOV).Trim()
    $zones = @{}
    foreach ($line in (([string]$sec.TZ) -split "`n")) {
        if ($line -match '^([A-Za-z0-9_\-\.]+)=(-?\d+)\s*$') {
            $d = [double]$Matches[2]; if ([math]::Abs($d) -gt 1000) { $d = $d / 1000 }
            if ($d -ge 15 -and $d -le 120) { $nm = $Matches[1]; if (-not $zones.ContainsKey($nm) -or $zones[$nm] -lt $d) { $zones[$nm] = [math]::Round($d, 1) } }
        }
    }
    $zl = @(); foreach ($k in $zones.Keys) { $zl += , @{ name = $k; c = $zones[$k] } }
    $o.zones = @($zl | Sort-Object { $_.c } -Descending | Select-Object -First 16)
    if ($sec.TS -match 'Thermal Status:\s*(\d+)') { $o.thermalStatus = [int]$Matches[1] }
    $hal = @(); $seen = @{}
    foreach ($m in [regex]::Matches([string]$sec.TS, 'mValue=(-?[\d.]+),\s*mType=(\d+),\s*mName=([^,}]+)')) {
        $nm = $m.Groups[3].Value.Trim(); $val = [double]::Parse($m.Groups[1].Value, $inv)
        if ($val -gt 0 -and $val -lt 130 -and -not $seen.ContainsKey($nm)) { $seen[$nm] = 1; $hal += , @{ name = $nm; c = [math]::Round($val, 1); type = [int]$m.Groups[2].Value } }
    }
    $o.hal = @($hal)
    $b = [string]$sec.BAT
    if ($b -match '(?m)^\s*level:\s*(\d+)') { $o.battery = [int]$Matches[1] }
    if ($b -match '(?m)^\s*status:\s*2') { $o.charging = $true }
    if ($b -match '(?m)^\s*temperature:\s*(\d+)') { $o.batteryTempC = [math]::Round([int]$Matches[1] / 10, 1) }
    if ($b -match '(?m)^\s*voltage:\s*(\d+)') { $o.voltage = [int]$Matches[1] }
    if ($b -match '(?m)^cur=(-?\d+)') { $c = [math]::Abs([long]$Matches[1]); $o.currentMa = $(if ($c -gt 20000) { [int]($c / 1000) } else { [int]$c }) }
    $mem = [string]$sec.MEM
    $mt = 0; $ma = 0; $st = 0; $sf = 0
    if ($mem -match 'MemTotal:\s+(\d+)') { $mt = [long]$Matches[1] }
    if ($mem -match 'MemAvailable:\s+(\d+)') { $ma = [long]$Matches[1] }
    if ($mem -match 'SwapTotal:\s+(\d+)') { $st = [long]$Matches[1] }
    if ($mem -match 'SwapFree:\s+(\d+)') { $sf = [long]$Matches[1] }
    if ($mt -gt 0) { $o.memTotalMb = [int]($mt / 1024); $o.memUsedMb = [int](($mt - $ma) / 1024); $o.memPct = [math]::Round(100 * ($mt - $ma) / $mt, 1) }
    if ($st -gt 0) { $o.swapTotalMb = [int]($st / 1024); $o.swapUsedMb = [int](($st - $sf) / 1024) }
    if (([string]$sec.LOAD) -match '^([\d.]+)') { $o.load1 = [double]::Parse($Matches[1], $inv) }
    $g = ConvertFrom-KeyLines ([string]$sec.GPU)
    if ($g.freq -match '^(\d+)') { $f = [long]$Matches[1]; if ($f -gt 100000000) { $f = $f / 1000000 } elseif ($f -gt 100000) { $f = $f / 1000 }; $o.gpuMhz = [int]$f }
    if ($g.busy -match '(\d+)') { $o.gpuBusy = [int]$Matches[1] }
    $d = ConvertFrom-KeyLines ([string]$sec.DISP)
    if ($d.peak -match '^[\d.]+$') { $o.refreshPeak = [double]::Parse($d.peak, $inv) }
    if ($d.min -match '^[\d.]+$') { $o.refreshMin = [double]::Parse($d.min, $inv) }
    if ($d.hz -match '([\d.]+)') { $o.renderHz = [math]::Round([double]::Parse($Matches[1], $inv)) }
    if ($d.bright -match '^\d+$') { $o.brightness = [int]$d.bright }
    $o.batterySaver = ($d.lowpower -eq '1')
    if ($d.anim -match '^[\d.]+$') { $o.animations = [double]::Parse($d.anim, $inv) }
    $w = [string]$sec.WIFI
    if ($w) {
        $wf = @{ rssi = $null; linkMbps = $null; mhz = $null }
        if ($w -match 'RSSI:\s*(-?\d+)') { $wf.rssi = [int]$Matches[1] }
        if ($w -match 'Link speed:\s*(\d+)') { $wf.linkMbps = [int]$Matches[1] }
        if ($w -match 'Frequency:\s*(\d+)') { $wf.mhz = [int]$Matches[1] }
        if ($null -ne $wf.rssi) { $o.wifi = $wf }
    }
    Send-Json $Ctx $o
}
