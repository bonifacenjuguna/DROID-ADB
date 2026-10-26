# Scrcpy Toolkit 3.0: shared store, background jobs, scheduler, ffmpeg tools, export and import. ASCII only.
# Dot-sourced after handlers.ps1 (main thread, every worker and every runner).

# ---------------------------------------------------------------------------
# Store: small named JSON values kept in Config\store.json (nicknames, pins, tags, macros, ...)
# ---------------------------------------------------------------------------
# Reads one store file. Returns $null when it exists but cannot be understood.
function Read-StoreFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @{} }
    $raw = [IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    try { $h = ConvertTo-Hash ($raw | ConvertFrom-Json) } catch { return $null }
    if ($h -isnot [hashtable]) { return $null }
    return $h
}

# For reading. A damaged file falls back to the last good copy (store.json.bak), or to nothing.
function Get-StoreAll {
    $h = $null
    try { $h = Read-StoreFile $StoreFile } catch {}
    if ($null -eq $h) { try { $h = Read-StoreFile ($StoreFile + '.bak') } catch {} }
    if ($null -eq $h) { $h = @{} }
    return $h
}

function Test-StoreKey {
    param([string]$Key)
    if ($Key -notmatch '^[a-z][a-z0-9_]{0,30}$') { Fail 'That store name is not valid.' }
}

# Larger values are refused: Windows PowerShell 5.1 cannot read a JSON text over 2 MB back in.
$StoreMaxChars = 1500000

function Set-StoreValue {
    param([string]$Key, $Value)
    Test-StoreKey $Key
    Use-Lock {
        # Never write on top of a file we could not read, or the saved data would be wiped.
        $all = $null
        try { $all = Read-StoreFile $StoreFile } catch { $all = $null }
        $good = $true
        if ($null -eq $all) {
            $good = $false
            try { $all = Read-StoreFile ($StoreFile + '.bak') } catch { $all = $null }
            if ($null -eq $all) { Fail 'The saved data file could not be read, so nothing was changed. Close the toolkit and check Config\store.json (a copy may be in store.json.bak).' }
            try { Copy-Item -LiteralPath $StoreFile -Destination ($StoreFile + '.damaged') -Force } catch {}
        }
        if ($null -eq $Value) { [void]$all.Remove($Key) } else {
            $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
            if ($json.Length -gt 400000) { Fail 'That is too much data to keep in one place.' }
            $all[$Key] = $Value
        }
        $text = ConvertTo-Json -InputObject $all -Depth 9
        if ($text.Length -gt $StoreMaxChars) { Fail 'The toolkit store is full. Remove some saved items.' }
        if ($good -and (Test-Path -LiteralPath $StoreFile)) { try { Copy-Item -LiteralPath $StoreFile -Destination ($StoreFile + '.bak') -Force } catch {} }
        Write-TextAtomic $StoreFile $text
    }
}

function Get-StoreValue {
    param([string]$Key, $Fallback = $null)
    $all = Get-StoreAll
    if ($all.ContainsKey($Key) -and $null -ne $all[$Key]) { return $all[$Key] }
    return $Fallback
}

$Routes['GET /api/store'] = { param($Ctx)
    $key = Get-Query $Ctx 'key'
    $all = Get-StoreAll
    if ($key -eq '') { Send-Json $Ctx @{ store = $all }; return }
    Test-StoreKey $key
    $v = $null
    if ($all.ContainsKey($key)) { $v = $all[$key] }
    Send-Json $Ctx @{ key = $key; value = $v }
}
$Routes['POST /api/store'] = { param($Ctx)
    $body = Read-JsonBody $Ctx 524288
    $key = [string](Get-Prop $body 'key' '')
    $value = $null
    if ($body.ContainsKey('value')) { $value = $body['value'] }
    Set-StoreValue $key $value
    Send-Json $Ctx @{ ok = $true }
}

# ---------------------------------------------------------------------------
# Jobs: long work (backups, pulls, ffmpeg, macros) that runs in background runners
# ---------------------------------------------------------------------------
if (-not $Shared.jobs) { $Shared.jobs = [hashtable]::Synchronized(@{}) }

function New-Job {
    param([string]$Kind, [string]$Title, [hashtable]$Params)
    if (-not $Shared.jobQueue) { Fail 'Background jobs are not available. Restart the toolkit.' }
    $id = 'j' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $job = @{ id = $id; kind = $Kind; title = $Title; state = 'queued'; done = 0; total = 0; message = 'Waiting'; started = (Get-UtcNow); finished = ''; result = @{}; cancel = $false; params = $Params; serial = [string](Get-Prop $Params 'serial' '') }
    Use-Lock {
        $Shared.jobs[$id] = $job
        $finished = @($Shared.jobs.Values | Where-Object { $_.state -in @('done', 'failed', 'cancelled') } | Sort-Object { $_.finished })
        for ($i = 0; $i -lt ($finished.Count - 25); $i++) { [void]$Shared.jobs.Remove($finished[$i].id) }
    }
    if (-not $Shared.jobQueue.TryAdd($id)) { [void]$Shared.jobs.Remove($id); Fail 'Too many jobs are waiting. Try again in a moment.' }
    return $id
}

function Set-Job {
    param([string]$Id, [hashtable]$Patch)
    Use-Lock { $j = $Shared.jobs[$Id]; if ($j) { foreach ($k in $Patch.Keys) { $j[$k] = $Patch[$k] } } }
}
function Get-JobParams { param([string]$Id) return (Use-Lock { $Shared.jobs[$Id].params }) }
function Test-JobCancel { param([string]$Id) return [bool](Use-Lock { $Shared.jobs[$Id].cancel }) }
function Get-JobViews {
    return @(Use-Lock {
            $Shared.jobs.Values | Sort-Object { $_.started } -Descending | ForEach-Object {
                @{ id = $_.id; kind = $_.kind; title = $_.title; state = $_.state; done = [long]$_.done; total = [long]$_.total; message = [string]$_.message; started = $_.started; finished = $_.finished; result = $_.result; serial = $_.serial }
            }
        })
}

$Routes['GET /api/jobs'] = { param($Ctx) Send-Json $Ctx @{ jobs = @(Get-JobViews) } }
$Routes['POST /api/jobs/cancel'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $id = [string](Get-Prop $body 'id' '')
    Use-Lock { $j = $Shared.jobs[$id]; if ($j -and $j.state -in @('queued', 'running')) { $j.cancel = $true; if ($j.state -eq 'queued') { $j.state = 'cancelled'; $j.message = 'Cancelled'; $j.finished = (Get-UtcNow) } } }
    Send-Json $Ctx @{ ok = $true }
}
$Routes['POST /api/jobs/clear'] = { param($Ctx)
    Use-Lock { foreach ($j in @($Shared.jobs.Values)) { if ($j.state -in @('done', 'failed', 'cancelled')) { [void]$Shared.jobs.Remove($j.id) } } }
    Send-Json $Ctx @{ ok = $true }
}

function ConvertTo-LocalName {
    param([string]$Rel)
    $parts = @()
    foreach ($seg in ($Rel -split '/')) { if ($seg -ne '' -and $seg -ne '.' -and $seg -ne '..') { $parts += (($seg -replace '[<>:"|?*\\]', '_').Trim().TrimEnd('.')) } }
    return ($parts -join [IO.Path]::DirectorySeparatorChar)
}

# Copies a list of phone files to the PC, skipping files that already exist with the same size.
function Invoke-PullList {
    param([string]$Id, [string]$Serial, $Items, [string]$DestRoot)
    $sel = Resolve-Target $Serial
    $total = [long]0
    foreach ($it in $Items) { $total += [long]$it.size }
    Set-Job $Id @{ state = 'running'; total = [long]$Items.Count; message = 'Starting' }
    $copied = 0; $skipped = 0; $failed = 0; $bytes = [long]0; $n = 0; $lastErr = ''
    foreach ($it in $Items) {
        if (Test-JobCancel $Id) { Set-Job $Id @{ state = 'cancelled'; message = ('Stopped after ' + $copied + ' file(s)'); finished = (Get-UtcNow); result = @{ copied = $copied; skipped = $skipped; failed = $failed; bytes = $bytes; dest = $DestRoot } }; return }
        $n++
        $local = Join-Path $DestRoot $it.rel
        $exists = $false
        try { if (Test-Path -LiteralPath $local -PathType Leaf) { $exists = (([IO.FileInfo]$local).Length -eq [long]$it.size) } } catch {}
        if ($exists) { $skipped++ } else {
            try {
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($local)) | Out-Null
                $r = Invoke-Adb ($sel + 'pull "' + $it.path + '" "' + $local + '"') 600
                if ($r.code -ne 0 -or -not (Test-Path -LiteralPath $local)) { $failed++; $lastErr = ($r.err + $r.out).Trim() } else { $copied++; $bytes += [long]$it.size }
            } catch { $failed++; $lastErr = $_.Exception.Message }
        }
        Set-Job $Id @{ done = [long]$n; message = (([string]$copied) + ' copied, ' + $skipped + ' already there' + $(if ($failed) { ', ' + $failed + ' failed' } else { '' })) }
    }
    $msg = $copied.ToString() + ' copied, ' + $skipped + ' already there'
    if ($failed) { $msg += ', ' + $failed + ' failed' }
    Set-Job $Id @{ state = $(if ($failed -gt 0 -and $copied -eq 0 -and $skipped -eq 0) { 'failed' } else { 'done' }); done = [long]$Items.Count; message = $msg; finished = (Get-UtcNow); result = @{ copied = $copied; skipped = $skipped; failed = $failed; bytes = $bytes; dest = $DestRoot; error = $lastErr } }
    Add-Activity 'files' ('Backup/copy finished: ' + $msg + ' -> ' + $DestRoot)
}

function Get-RemoteRel {
    param([string]$Path)
    $rel = $Path -replace '^/storage/emulated/0/', '' -replace '^/sdcard/', ''
    return (ConvertTo-LocalName $rel)
}

function Invoke-BackupJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    $serial = [string]$p.serial
    $dirs = @($p.paths)
    $items = @()
    Set-Job $Id @{ state = 'running'; message = 'Scanning the phone' }
    foreach ($dir in $dirs) {
        $dir = ([string]$dir).TrimEnd('/')
        Test-PhonePath $dir
        $r = Invoke-DeviceShell $serial ('find ''' + $dir + ''' -type f -exec stat -c ''%s %Y %n'' {} + 2>/dev/null') 180
        foreach ($line in ($r.out -split "`r?`n")) {
            if ($line -match '^(\d+) (\d+) (/.+)$') {
                $path = $Matches[3]
                if ($path -match '/\.(thumbnails|trashed|pending)') { continue }
                $items += , @{ size = [long]$Matches[1]; path = $path; rel = (Get-RemoteRel $path) }
            }
        }
        if (Test-JobCancel $Id) { Set-Job $Id @{ state = 'cancelled'; message = 'Stopped'; finished = (Get-UtcNow) }; return }
    }
    if ($items.Count -eq 0) { Set-Job $Id @{ state = 'done'; message = 'No files found in those folders.'; finished = (Get-UtcNow); result = @{ copied = 0; skipped = 0; failed = 0; bytes = 0 } }; return }
    $name = (Get-DeviceModelHint $serial) -replace '[^A-Za-z0-9._\-]', '_'
    $dest = Join-Path (Join-Path (Get-Dir 'downloads') 'Backups') $name
    Invoke-PullList $Id $serial $items $dest
}

function Invoke-PullJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    $items = @()
    foreach ($path in @($p.paths)) {
        $path = [string]$path
        Test-PhonePath $path
        $items += , @{ size = [long]0; path = $path; rel = (Get-RemoteRel $path) }
    }
    $dest = Join-Path (Get-Dir 'downloads') 'Gallery'
    Invoke-PullList $Id ([string]$p.serial) $items $dest
}

# ---------------------------------------------------------------------------
# ffmpeg (optional): trim, shrink and GIF
# ---------------------------------------------------------------------------
function Get-FfmpegPath {
    $s = Get-Settings
    if ([string]$s.ffmpegPath -ne '' -and (Test-Path -LiteralPath $s.ffmpegPath -PathType Leaf)) { return [string]$s.ffmpegPath }
    foreach ($rel in @('core\ffmpeg\ffmpeg.exe', 'core\ffmpeg\bin\ffmpeg.exe', 'ffmpeg\ffmpeg.exe', 'ffmpeg\bin\ffmpeg.exe', 'ffmpeg.exe', 'core/ffmpeg/ffmpeg')) {
        $c = Join-Path $Root $rel
        if (Test-Path -LiteralPath $c -PathType Leaf) { return $c }
    }
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return [string]$cmd.Source }
    return ''
}

function Invoke-FfmpegJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    $ff = Get-FfmpegPath
    if ($ff -eq '') { Fail 'ffmpeg was not found. Put ffmpeg.exe in core\ffmpeg or choose it in Settings > Advanced.' }
    $in = Get-SafeFile 'recordings' ([string]$p.name)
    $stem = [IO.Path]::GetFileNameWithoutExtension($in)
    $dir = [IO.Path]::GetDirectoryName($in)
    $op = [string]$p.op
    $start = [double]$p.start
    $dur = [double]$p.duration
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $ss = ''
    if ($start -gt 0) { $ss = '-ss ' + $start.ToString('0.###', $inv) + ' ' }
    $tt = ''
    if ($dur -gt 0) { $tt = '-t ' + $dur.ToString('0.###', $inv) + ' ' }
    switch ($op) {
        'trim' {
            $out = New-UniquePath $dir ($stem + '-trim') 'mp4'
            if ([bool]$p.fast) { $argLine = '-y -hide_banner -loglevel error ' + $ss + '-i "' + $in + '" ' + $tt + '-c copy "' + $out + '"' }
            else { $argLine = '-y -hide_banner -loglevel error ' + $ss + '-i "' + $in + '" ' + $tt + '-c:v libx264 -preset veryfast -crf 20 -c:a aac -movflags +faststart "' + $out + '"' }
        }
        'small' {
            $h = [int]$p.height
            $out = New-UniquePath $dir ($stem + '-small') 'mp4'
            $argLine = '-y -hide_banner -loglevel error ' + $ss + '-i "' + $in + '" ' + $tt + '-vf scale=-2:' + $h + ' -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 96k -movflags +faststart "' + $out + '"'
        }
        'gif' {
            $fps = [int]$p.fps
            $w = [int]$p.width
            $out = New-UniquePath $dir $stem 'gif'
            $argLine = '-y -hide_banner -loglevel error ' + $ss + $tt + '-i "' + $in + '" -vf "fps=' + $fps + ',scale=' + $w + ':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "' + $out + '"'
        }
        default { Fail 'Unknown conversion.' }
    }
    Set-Job $Id @{ state = 'running'; total = 1; message = 'Converting with ffmpeg' }
    $r = Invoke-Native $ff $argLine 1800 $dir
    if ($r.code -ne 0 -or -not (Test-Path -LiteralPath $out)) { Fail ('ffmpeg could not do that: ' + (($r.err + $r.out).Trim() | Select-Object -First 1)) }
    $sz = ([IO.FileInfo]$out).Length
    Set-Job $Id @{ state = 'done'; done = 1; message = ('Saved ' + [IO.Path]::GetFileName($out) + ' (' + (Get-FileSizeLabel $sz) + ')'); finished = (Get-UtcNow); result = @{ file = [IO.Path]::GetFileName($out); size = [long]$sz } }
    Add-Activity 'library' ('Created ' + [IO.Path]::GetFileName($out))
}

function Invoke-GifCaptureJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    $serial = [string]$p.serial
    $secs = [int]$p.seconds
    $ff = Get-FfmpegPath
    if ($ff -eq '') { Fail 'ffmpeg was not found. A GIF needs ffmpeg: put ffmpeg.exe in core\ffmpeg or choose it in Settings > Advanced.' }
    $sel = Resolve-Target $serial
    $remote = ([string](Get-Settings).remoteTmpDir).TrimEnd('/') + '/stk-gif.mp4'
    Set-Job $Id @{ state = 'running'; total = 3; done = 0; message = ('Recording ' + $secs + ' seconds on the phone') }
    $r = Invoke-Adb ($sel + 'shell screenrecord --time-limit ' + $secs + ' --size 720x1280 ' + $remote) ($secs + 30)
    $tmp = Join-Path $LogDir ('gif-' + [guid]::NewGuid().ToString('N') + '.mp4')
    try {
        Set-Job $Id @{ done = 1; message = 'Copying from the phone' }
        $b = Invoke-Adb ($sel + 'pull ' + $remote + ' "' + $tmp + '"') 120
        [void](Invoke-Adb ($sel + 'shell rm ' + $remote) 10)
        if (-not (Test-Path -LiteralPath $tmp)) { Fail ('The phone did not record the screen: ' + ($r.err + $r.out + $b.err).Trim()) }
        Set-Job $Id @{ done = 2; message = 'Making the GIF' }
        $dir = Get-Dir 'recordings'
        $out = New-UniquePath $dir (New-FileStem 'Gif-{date}_{time}' $serial) 'gif'
        $fps = [int]$p.fps; $w = [int]$p.width
        $g = Invoke-Native $ff ('-y -hide_banner -loglevel error -i "' + $tmp + '" -vf "fps=' + $fps + ',scale=' + $w + ':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "' + $out + '"') 600 $dir
        if ($g.code -ne 0 -or -not (Test-Path -LiteralPath $out)) { Fail ('ffmpeg could not make the GIF: ' + ($g.err + $g.out).Trim()) }
        Set-Job $Id @{ state = 'done'; done = 3; message = ('Saved ' + [IO.Path]::GetFileName($out)); finished = (Get-UtcNow); result = @{ file = [IO.Path]::GetFileName($out) } }
        Add-Activity 'library' ('Created ' + [IO.Path]::GetFileName($out))
    } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------------------
# Macros and scheduled tasks
# ---------------------------------------------------------------------------
function Test-MacroSteps {
    param($Steps)
    $list = @($Steps)
    if ($list.Count -eq 0) { Fail 'This macro has no steps.' }
    if ($list.Count -gt 200) { Fail 'A macro can have up to 200 steps.' }
    $out = @()
    foreach ($s in $list) {
        $t = [string](Get-Prop $s 't' '')
        $st = @{ t = $t }
        switch ($t) {
            'tap' { $st.x = [int](Get-Prop $s 'x' -1); $st.y = [int](Get-Prop $s 'y' -1); if ($st.x -lt 0 -or $st.y -lt 0 -or $st.x -gt 10000 -or $st.y -gt 10000) { Fail 'A tap step has a position outside the screen.' } }
            'long' { $st.x = [int](Get-Prop $s 'x' -1); $st.y = [int](Get-Prop $s 'y' -1); if ($st.x -lt 0 -or $st.y -lt 0 -or $st.x -gt 10000 -or $st.y -gt 10000) { Fail 'A long-press step has a position outside the screen.' } }
            'swipe' {
                foreach ($k in @('x1', 'y1', 'x2', 'y2')) { $st[$k] = [int](Get-Prop $s $k -1); if ($st[$k] -lt 0 -or $st[$k] -gt 10000) { Fail 'A swipe step has a position outside the screen.' } }
                $st.ms = [int](Get-Prop $s 'ms' 300); if ($st.ms -lt 50 -or $st.ms -gt 5000) { $st.ms = 300 }
            }
            'key' { $st.key = [string](Get-Prop $s 'key' ''); if (-not $KeyCodes.ContainsKey($st.key) -and $st.key -notin @('notifications', 'quicksettings', 'collapse')) { Fail 'A key step uses an unknown key.' } }
            'text' { $st.text = [string](Get-Prop $s 'text' ''); if ($st.text -notmatch '^[A-Za-z0-9 .,@_:/+=\-]{1,200}$') { Fail 'A text step uses characters the phone cannot type (letters, numbers, spaces and . , @ _ : / + = - only).' } }
            'wait' { $st.ms = [int](Get-Prop $s 'ms' 500); if ($st.ms -lt 0) { $st.ms = 0 }; if ($st.ms -gt 30000) { $st.ms = 30000 } }
            'open' { $st.package = [string](Get-Prop $s 'package' ''); Test-PackageName $st.package }
            default { Fail 'This macro has a step the toolkit does not know.' }
        }
        $out += , $st
    }
    return , $out
}

function Invoke-MacroSteps {
    param([string]$Serial, $Steps, [string]$JobId = '', [long]$Base = 0)
    $n = 0
    foreach ($st in $Steps) {
        if ($JobId -and (Test-JobCancel $JobId)) { return $false }
        $n++
        switch ($st.t) {
            'tap' { $r = Invoke-DeviceShell $Serial ('input tap ' + $st.x + ' ' + $st.y) 10 }
            'long' { $r = Invoke-DeviceShell $Serial ('input swipe ' + $st.x + ' ' + $st.y + ' ' + $st.x + ' ' + $st.y + ' 800') 10 }
            'swipe' { $r = Invoke-DeviceShell $Serial ('input swipe ' + $st.x1 + ' ' + $st.y1 + ' ' + $st.x2 + ' ' + $st.y2 + ' ' + $st.ms) 10 }
            'key' { Invoke-Key $Serial $st.key; $r = @{ code = 0 } }
            'text' { $r = Invoke-DeviceShell $Serial ('input text ' + ($st.text -replace ' ', '%s')) 12 }
            'wait' { $left = [int]$st.ms; while ($left -gt 0) { $chunk = [math]::Min(250, $left); Start-Sleep -Milliseconds $chunk; $left -= $chunk; if ($JobId -and (Test-JobCancel $JobId)) { return $false } }; $r = @{ code = 0 } }
            'open' { $r = Invoke-DeviceShell $Serial ('monkey -p ' + $st.package + ' -c android.intent.category.LAUNCHER 1') 20 }
        }
        if ($r.code -ne 0) { Fail ('Step ' + $n + ' (' + $st.t + ') failed: ' + ($r.err + $r.out).Trim()) }
        if ($JobId) { Set-Job $JobId @{ done = [long]($Base + $n) } }
    }
    return $true
}

function Invoke-MacroJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    $steps = @($p.steps)
    $times = 1
    if ($p.ContainsKey('repeat')) { $times = [int]$p.repeat }
    if ($times -lt 1) { $times = 1 }
    if ($times -gt 100) { $times = 100 }
    Set-Job $Id @{ state = 'running'; total = [long]($steps.Count * $times); message = 'Running' }
    for ($i = 1; $i -le $times; $i++) {
        Set-Job $Id @{ message = ('Run ' + $i + ' of ' + $times) }
        $ok = Invoke-MacroSteps ([string]$p.serial) $steps $Id ([long]($steps.Count * ($i - 1)))
        if (-not $ok -or (Test-JobCancel $Id)) { Set-Job $Id @{ state = 'cancelled'; message = 'Stopped'; finished = (Get-UtcNow) }; return }
        Set-Job $Id @{ done = [long]($steps.Count * $i) }
    }
    Set-Job $Id @{ state = 'done'; message = 'Finished'; finished = (Get-UtcNow) }
}

function Invoke-ShotJob {
    param([string]$Id)
    $p = Get-JobParams $Id
    Set-Job $Id @{ state = 'running'; total = 1; message = 'Taking a screenshot' }
    $s = Get-Settings
    $dest = New-UniquePath (Get-Dir 'screenshots') ((New-FileStem $s.screenshotTemplate ([string]$p.serial)) ) 'png'
    $file = Save-Screenshot ([string]$p.serial) $dest
    Set-Job $Id @{ state = 'done'; done = 1; message = ('Saved ' + [IO.Path]::GetFileName($file)); finished = (Get-UtcNow); result = @{ file = [IO.Path]::GetFileName($file) } }
}

function Invoke-Job {
    param([string]$Id)
    $kind = Use-Lock { $Shared.jobs[$Id].kind }
    $state = Use-Lock { $Shared.jobs[$Id].state }
    if ($state -ne 'queued') { return }
    switch ($kind) {
        'backup' { Invoke-BackupJob $Id }
        'pull' { Invoke-PullJob $Id }
        'ffmpeg' { Invoke-FfmpegJob $Id }
        'gif' { Invoke-GifCaptureJob $Id }
        'macro' { Invoke-MacroJob $Id }
        'shot' { Invoke-ShotJob $Id }
        default { Fail 'Unknown job type.' }
    }
    $v = Use-Lock { $Shared.jobs[$Id] }
    if ($v) { Add-Event 'job' @{ job = $Id; title = [string]$v.title; state = [string]$v.state; message = [string]$v.message } }
}

$JobLoop = @'

while (-not $Shared.stop) {
    $id = $null
    if (-not $Shared.jobQueue.TryTake([ref]$id, 1000)) { continue }
    try { Invoke-Job $id } catch {
        $m = $_.Exception.Message
        Set-Job $id @{ state = 'failed'; message = $m; finished = (Get-UtcNow) }
        Add-Event 'job' @{ job = $id; title = [string](Use-Lock { $Shared.jobs[$id].title }); state = 'failed'; message = $m }
        if ($_.Exception -isnot [System.InvalidOperationException]) { Write-BackendLog ('Job: ' + $_.Exception.ToString()) }
    }
}
'@

$SchedLoop = @'

$last = @{}
$ran = @{}
while (-not $Shared.stop) {
    try {
        $list = @(Get-StoreValue 'schedules' @())
        $now = Get-Date
        $seenIds = @{}
        foreach ($sc in $list) {
            $id = [string](Get-Prop $sc 'id' '')
            if ($id -eq '') { continue }
            $seenIds[$id] = $true
            if (-not [bool](Get-Prop $sc 'enabled' $true)) { [void]$last.Remove($id); continue }
            $due = $false
            $ranKey = ''
            $mode = [string](Get-Prop $sc 'mode' 'every')
            if ($mode -eq 'daily') {
                $at = [string](Get-Prop $sc 'at' '')
                if ($at -match '^(\d{1,2}):(\d{2})$') {
                    $target = Get-Date -Hour ([int]$Matches[1]) -Minute ([int]$Matches[2]) -Second 0
                    $key = $id + $now.ToString('yyyyMMdd')
                    if ($now -ge $target -and $now -lt $target.AddMinutes(10) -and -not $ran.ContainsKey($key)) { $due = $true; $ranKey = $key }
                }
            } else {
                $every = [int](Get-Prop $sc 'everyMin' 0)
                if ($every -lt 1) { continue }
                if (-not $last.ContainsKey($id)) { $last[$id] = $now }
                if (($now - $last[$id]).TotalMinutes -ge $every) { $due = $true }
            }
            if (-not $due) { continue }
            # Only count the run once it was really queued, so a phone that is unplugged at that moment does not use up the run for that day.
            $serial = [string](Get-Prop $sc 'serial' '')
            $ready = @($Shared.devices | Where-Object { $null -ne $_ -and $_.state -eq 'device' })
            if ($serial -eq '' -and $ready.Count -gt 0) { $serial = [string]$ready[0].id }
            if (-not ($ready | Where-Object { $_.id -eq $serial })) { continue }
            # Do not pile up: skip while the previous run of this task is still waiting or running.
            $busy = @(Use-Lock { @($Shared.jobs.Values | Where-Object { $_.params -is [hashtable] -and [string]$_.params.schedule -eq $id -and $_.state -in @('queued', 'running') }) })
            if ($busy.Count -gt 0) { continue }
            try {
                $type = [string](Get-Prop $sc 'type' 'shot')
                $queued = $false
                if ($type -eq 'macro') {
                    $macro = @(Get-StoreValue 'macros' @()) | Where-Object { [string](Get-Prop $_ 'id' '') -eq [string](Get-Prop $sc 'macro' '') } | Select-Object -First 1
                    if ($macro) { [void](New-Job 'macro' ('Scheduled: ' + [string](Get-Prop $sc 'name' 'macro')) @{ serial = $serial; steps = (Test-MacroSteps (Get-Prop $macro 'steps' @())); repeat = 1; schedule = $id }); $queued = $true }
                } else { [void](New-Job 'shot' ('Scheduled screenshot') @{ serial = $serial; schedule = $id }); $queued = $true }
                if ($queued) {
                    if ($mode -eq 'daily') { $ran[$ranKey] = $true } else { $last[$id] = $now }
                }
            } catch {
                Write-BackendLog ('Schedule: ' + $_.Exception.Message)
                if ($mode -eq 'daily') { $ran[$ranKey] = $true } else { $last[$id] = $now }
            }
        }
        foreach ($k in @($last.Keys)) { if (-not $seenIds.ContainsKey($k)) { [void]$last.Remove($k) } }
        if ($ran.Count -gt 200) { $ran.Clear() }
    } catch { Write-BackendLog ('Scheduler: ' + $_.Exception.Message) }
    for ($i = 0; $i -lt 100 -and -not $Shared.stop; $i++) { Start-Sleep -Milliseconds 100 }
}
'@

$Routes['GET /api/ffmpeg'] = { param($Ctx)
    $p = Get-FfmpegPath
    Send-Json $Ctx @{ available = ($p -ne ''); path = $p }
}

$Routes['POST /api/ffmpeg'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = [string](Get-Prop $body 'name' '')
    [void](Get-SafeFile 'recordings' $name)
    if ((Get-FfmpegPath) -eq '') { Fail 'ffmpeg was not found. Put ffmpeg.exe in core\ffmpeg or choose it in Settings > Advanced.' }
    if (Test-InProgress $name) { Fail 'This recording is still in progress. Stop it first.' }
    $op = [string](Get-Prop $body 'op' '')
    $start = [double](Get-Prop $body 'start' 0)
    $dur = [double](Get-Prop $body 'duration' 0)
    if ($start -lt 0 -or $start -gt 86400 -or $dur -lt 0 -or $dur -gt 86400) { Fail 'The start and length must be positive times in seconds.' }
    $pm = @{ name = $name; op = $op; start = $start; duration = $dur; fast = [bool](Get-Prop $body 'fast' $false) }
    switch ($op) {
        'trim' { if ($dur -le 0) { Fail 'Choose how many seconds to keep.' }; $title = 'Trim ' + $name }
        'small' { $h = [int](Get-Prop $body 'height' 720); if ($h -notin @(360, 480, 540, 720, 1080)) { Fail 'Choose a height from the list.' }; $pm.height = $h; $title = 'Shrink ' + $name }
        'gif' {
            $fps = [int](Get-Prop $body 'fps' 12); $w = [int](Get-Prop $body 'width' 480)
            if ($fps -lt 4 -or $fps -gt 30) { Fail 'GIF frame rate is between 4 and 30.' }
            if ($w -notin @(240, 320, 480, 640, 720)) { Fail 'Choose a GIF width from the list.' }
            if ($dur -le 0) { $pm.duration = 10 }; if ($pm.duration -gt 60) { Fail 'GIFs can be up to 60 seconds.' }
            $pm.fps = $fps; $pm.width = $w; $title = 'GIF from ' + $name
        }
        default { Fail 'Unknown conversion.' }
    }
    $id = New-Job 'ffmpeg' $title $pm
    Send-Json $Ctx @{ ok = $true; job = $id }
}

$Routes['POST /api/gif-capture'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $secs = [int](Get-Prop $body 'seconds' 6)
    if ($secs -lt 2 -or $secs -gt 30) { Fail 'A GIF can be 2 to 30 seconds long.' }
    if ((Get-FfmpegPath) -eq '') { Fail 'A GIF needs ffmpeg. Put ffmpeg.exe in core\ffmpeg or choose it in Settings > Advanced.' }
    $fps = [int](Get-Prop $body 'fps' 12); if ($fps -lt 4 -or $fps -gt 30) { $fps = 12 }
    $w = [int](Get-Prop $body 'width' 360); if ($w -notin @(240, 320, 360, 480, 640)) { $w = 360 }
    $id = New-Job 'gif' 'Record a GIF' @{ serial = $serial; seconds = $secs; fps = $fps; width = $w }
    Send-Json $Ctx @{ ok = $true; job = $id }
}

$Routes['POST /api/backup'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $paths = @()
    foreach ($p in @(Get-Prop $body 'paths' @())) { $p = ([string]$p).TrimEnd('/'); Test-PhonePath $p; if ($p -notmatch '^/(sdcard|storage/emulated/0)(/.*)?$') { Fail 'Backups can only read the shared storage folder (/sdcard).' }; $paths += $p }
    if ($paths.Count -eq 0) { Fail 'Choose at least one phone folder.' }
    if ($paths.Count -gt 12) { Fail 'Choose up to 12 folders at a time.' }
    $id = New-Job 'backup' 'Back up phone folders' @{ serial = $serial; paths = $paths }
    Send-Json $Ctx @{ ok = $true; job = $id }
}

$Routes['GET /api/backups'] = { param($Ctx)
    $root = Join-Path (Get-Dir 'downloads') 'Backups'
    $out = @()
    if (Test-Path -LiteralPath $root) {
        foreach ($d in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -ErrorAction SilentlyContinue)
            $size = [long]0
            foreach ($f in $files) { $size += [long]$f.Length }
            $last = ''
            if ($files.Count -gt 0) { $last = (($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) }
            $out += , @{ name = $d.Name; files = $files.Count; size = $size; modified = $last; path = $d.FullName }
        }
    }
    Send-Json $Ctx @{ root = $root; backups = @($out) }
}

$Routes['POST /api/macro/run'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $serial = [string](Get-Prop $body 'serial' '')
    Test-Serial $serial
    $steps = Test-MacroSteps (Get-Prop $body 'steps' @())
    $repeat = [int](Get-Prop $body 'repeat' 1)
    $name = [string](Get-Prop $body 'name' 'Macro')
    if ($name.Length -gt 60) { $name = $name.Substring(0, 60) }
    $id = New-Job 'macro' ('Macro: ' + ($name -replace '[^A-Za-z0-9._ \-()]', '')) @{ serial = $serial; steps = $steps; repeat = $repeat }
    Send-Json $Ctx @{ ok = $true; job = $id }
}

$Routes['POST /api/macros'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $name = ([string](Get-Prop $body 'name' '')).Trim()
    if ($name -notmatch '^[A-Za-z0-9 ._\-()]{1,40}$') { Fail 'Macro names can use letters, numbers, spaces and . _ - ( ) (up to 40).' }
    $steps = Test-MacroSteps (Get-Prop $body 'steps' @())
    $id = [string](Get-Prop $body 'id' '')
    if ($id -notmatch '^[a-z0-9]{4,12}$') { $id = [guid]::NewGuid().ToString('N').Substring(0, 8) }
    Use-Lock {
        $list = @(Get-StoreValue 'macros' @())
        $keep = @($list | Where-Object { [string](Get-Prop $_ 'id' '') -ne $id })
        if ($keep.Count -ge 60) { Fail 'You can keep up to 60 macros.' }
        $keep += , @{ id = $id; name = $name; steps = $steps }
        Set-StoreValue 'macros' $keep
    }
    Send-Json $Ctx @{ ok = $true; id = $id }
}

$Routes['POST /api/schedules'] = { param($Ctx)
    $body = Read-JsonBody $Ctx
    $list = @()
    foreach ($sc in @(Get-Prop $body 'schedules' @())) {
        $id = [string](Get-Prop $sc 'id' '')
        if ($id -notmatch '^[a-z0-9]{4,12}$') { $id = [guid]::NewGuid().ToString('N').Substring(0, 8) }
        $type = [string](Get-Prop $sc 'type' 'shot'); if ($type -notin @('shot', 'macro')) { Fail 'Unknown schedule action.' }
        $mode = [string](Get-Prop $sc 'mode' 'every'); if ($mode -notin @('every', 'daily')) { Fail 'Unknown schedule type.' }
        $entry = @{ id = $id; name = ([string](Get-Prop $sc 'name' 'Task') -replace '[^A-Za-z0-9._ \-()]', ''); type = $type; mode = $mode; enabled = [bool](Get-Prop $sc 'enabled' $true); serial = [string](Get-Prop $sc 'serial' ''); macro = [string](Get-Prop $sc 'macro' '') }
        Test-Serial $entry.serial
        if ($mode -eq 'every') { $e = [int](Get-Prop $sc 'everyMin' 15); if ($e -lt 1 -or $e -gt 1440) { Fail 'Repeat every 1 to 1440 minutes.' }; $entry.everyMin = $e }
        else { $at = [string](Get-Prop $sc 'at' '08:00'); if ($at -notmatch '^([01]?\d|2[0-3]):[0-5]\d$') { Fail 'Time must look like 08:30.' }; $entry.at = $at }
        $list += , $entry
    }
    if ($list.Count -gt 20) { Fail 'You can keep up to 20 scheduled tasks.' }
    Set-StoreValue 'schedules' $list
    Send-Json $Ctx @{ ok = $true }
}

# ---------------------------------------------------------------------------
# Export and import of settings, profiles and the store
# ---------------------------------------------------------------------------
$Routes['GET /api/export'] = { param($Ctx)
    $payload = @{ toolkit = 'scrcpy-toolkit'; version = $ToolkitVersion; exported = (Get-UtcNow); settings = (Get-Settings); profiles = @(Get-Profiles); store = (Get-StoreAll) }
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $payload -Depth 9))
    Send-Bytes $Ctx $bytes 'application/json; charset=utf-8' 200 'no-store' @{ 'Content-Disposition' = 'attachment; filename="scrcpy-toolkit-backup.json"' }
}

$Routes['POST /api/import'] = { param($Ctx)
    $body = Read-JsonBody $Ctx 1900000
    if ([string](Get-Prop $body 'toolkit' '') -ne 'scrcpy-toolkit') { Fail 'That file is not a Scrcpy Toolkit backup.' }
    $counts = @{ settings = 0; profiles = 0; store = 0; skipped = 0 }
    $st = Get-Prop $body 'settings' $null
    if ($st -is [hashtable]) {
        $patch = @{}
        foreach ($k in $st.Keys) { if ($SchemaByKey.ContainsKey([string]$k) -and $k -notin @('port', 'serverWorkers', 'adbPath', 'scrcpyPath', 'ffmpegPath', 'recordingsDir', 'screenshotsDir', 'downloadsDir')) { $patch[[string]$k] = $st[$k] } }
        [void](Save-SettingsPatch $patch)
        $counts.settings = $patch.Count
    }
    $pr = @(Get-Prop $body 'profiles' @())
    if ($pr.Count -gt 0) {
        $list = @()
        foreach ($p in $pr) {
            $n = [string](Get-Prop $p 'name' '')
            $v = Get-Prop $p 'values' $null
            if ($n -match '^[A-Za-z0-9 ._\-]{1,40}$' -and $v -is [hashtable]) { $list += , @{ name = $n; values = $v } }
        }
        if ($list.Count -gt 0) { Save-Profiles ($list | Select-Object -First 40); $counts.profiles = $list.Count }
    }
    $store = Get-Prop $body 'store' $null
    if ($store -is [hashtable]) {
        foreach ($k in @($store.Keys)) {
            # Lists must stay lists, so a damaged backup cannot turn saved macros or tasks into something else.
            if ([string]$k -in @('macros', 'schedules', 'snippets', 'pins', 'games', 'intents', 'wifihosts') -and $store[$k] -isnot [array]) { $counts.skipped++; continue }
            try { Set-StoreValue ([string]$k) $store[$k]; $counts.store++ } catch { $counts.skipped++ }
        }
    }
    Add-Activity 'system' 'Imported a toolkit backup.'
    Send-Json $Ctx (@{ ok = $true; counts = $counts })
}

$Routes['POST /api/screenshot-save'] = { param($Ctx)
    $name = Get-Query $Ctx 'name'
    $stem = ([IO.Path]::GetFileNameWithoutExtension($name) -replace '[^A-Za-z0-9._ \-()]', '_').Trim()
    if ($stem -eq '') { $stem = 'Edited' }
    if ($stem.Length -gt 80) { $stem = $stem.Substring(0, 80) }
    $dir = Join-Path $LogDir ('upload-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    try {
        $tmp = Join-Path $dir 'in.png'
        $size = Save-Upload $Ctx $tmp
        if ($size -gt 40MB -or $size -lt 16) { Fail 'That picture is not a valid size.' }
        $head = New-Object byte[] 8
        $fs = [IO.File]::OpenRead($tmp); try { [void]$fs.Read($head, 0, 8) } finally { $fs.Dispose() }
        if ($head[0] -ne 0x89 -or $head[1] -ne 0x50 -or $head[2] -ne 0x4E -or $head[3] -ne 0x47) { Fail 'Only PNG pictures can be saved here.' }
        $dest = New-UniquePath (Get-Dir 'screenshots') $stem 'png'
        Move-Item -LiteralPath $tmp -Destination $dest
        Add-Activity 'screenshot' ('Saved edited screenshot ' + [IO.Path]::GetFileName($dest))
        Send-Json $Ctx @{ ok = $true; file = [IO.Path]::GetFileName($dest) }
    } finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

foreach ($k in @('GET /api/store', 'POST /api/store', 'GET /api/jobs', 'POST /api/jobs/cancel', 'POST /api/jobs/clear', 'GET /api/ffmpeg', 'GET /api/export', 'POST /api/import', 'POST /api/macros', 'POST /api/schedules')) { $FastRoutes[$k] = $true }
