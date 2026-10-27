# DROID ADB audio self-test. No phone needed: checks the option mapping and the recording inspector.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File core\scripts\audio-selftest.ps1 [-Recording path\to\file.mkv]
param([string]$Recording = '')
$ErrorActionPreference = 'Stop'
$global:StkRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path (Join-Path (Join-Path $global:StkRoot 'core') 'server') 'lib.ps1')
$fail = 0
function Check { param([string]$Name, [bool]$Ok) if ($Ok) { Write-Host ('PASS  ' + $Name) } else { Write-Host ('FAIL  ' + $Name) -ForegroundColor Red; $script:fail++ } }
$base = Get-Defaults
Check 'default mode is video_only' ($base.audioMode -eq 'video_only')
function Plan { param([string]$Mode, [string]$Role, [bool]$Comp = $false, [bool]$Head = $false)
    $s = Get-Defaults; $s.audioMode = $Mode
    return (Resolve-AudioPlan -S $s -Mode $Role -Serial '' -Companion $Comp -Headless $Head -Probe $false)
}
$p = Plan 'video_only' 'record'; Check 'video_only: --no-audio only' (($p.argv -join ' ') -eq '--no-audio' -and -not $p.capture)
$p = Plan 'record_only' 'mirror'; Check 'record_only mirror: no capture' (($p.argv -join ' ') -eq '--no-audio')
$p = Plan 'record_only' 'record'; $a = $p.argv -join ' '
Check 'record_only record: dup, PC silent, records' ($a -match '--audio-dup' -and $a -match '--no-audio-playback' -and $a -match '--audio-source=playback' -and $p.recordsAudio -and -not $p.playsOnPc -and $p.phone -eq 'plays')
$p = Plan 'copy_play' 'record'; $a = $p.argv -join ' '
Check 'copy_play record: dup, PC plays, records' ($a -match '--audio-dup' -and $a -notmatch '--no-audio-playback' -and $p.recordsAudio -and $p.playsOnPc)
$p = Plan 'copy_play' 'mirror'; Check 'copy_play mirror: plays, does not record' ($p.playsOnPc -and -not $p.recordsAudio -and $p.capture)
$p = Plan 'copy_play' 'record' $true $true; Check 'copy_play companion: saves only, stays copy_play' ($p.recordsAudio -and -not $p.playsOnPc -and $p.effective -eq 'copy_play')
$p = Plan 'copy_play' 'record' $false $true; Check 'copy_play windowless: reported as record_only' ($p.effective -eq 'record_only' -and $p.warnings.Count -gt 0)
$p = Plan 'reroute' 'mirror'; $a = $p.argv -join ' '
Check 'reroute mirror: default output source, phone silent' ($a -notmatch '--audio-dup' -and $a -notmatch 'audio-source' -and $p.phone -eq 'silent' -and $p.playsOnPc)
$s = Get-Defaults; $s.audioMode = 'reroute'; $s.companionAudio = $false
$p = Resolve-AudioPlan -S $s -Mode 'record' -Serial '' -Companion $true -Headless $true -Probe $false
Check 'reroute companion with companionAudio off: no sound, reported' (($p.argv -join ' ') -eq '--no-audio' -and -not $p.recordsAudio -and $p.warnings.Count -gt 0)
$s = Get-Defaults; $s.audioMode = 'bogus'; Check 'unknown mode falls back to video_only' ((Get-AudioModeId $s) -eq 'video_only')
$cmd = New-ScrcpyArgs -S (Get-Defaults) -Mode 'record' -Serial '' -OutFile 'x.mkv' -Once @{} -Probe $false
Check 'default command has --no-audio and --record' ($cmd -match '--no-audio' -and $cmd -match '--record')
foreach ($m in @('video_only', 'record_only', 'copy_play', 'reroute')) { $s = Get-Defaults; $s.audioMode = $m; $s.streamAudio = 'silent_pc'; $r = Get-StreamAudioPlan $s; Write-Host ('INFO  stream silent_pc with ' + $m + ' -> ' + $r.status) }
$caps = Get-ScrcpyAudioCaps $true
Write-Host ('INFO  scrcpy ' + $caps.version + ' ok=' + $caps.ok)
if ($caps.ok) { foreach ($k in $caps.flags.Keys) { Check ('scrcpy supports ' + $k) ([bool]$caps.flags[$k]) } }
if ($Recording -ne '') { $r = Test-RecordingAudio $Recording $true; Write-Host ('INFO  ' + $r.state + ': ' + $r.summary) }
if ($fail -gt 0) { Write-Host ($fail.ToString() + ' check(s) failed.') -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed. Real-device tests are still needed (docs\AUDIO.md).'
