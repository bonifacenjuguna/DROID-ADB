' DROID ADB silent launcher: starts the service with no window and opens the dashboard.
' Double-click it, or use the DROID ADB desktop shortcut. Problems show as a normal message box.
' Arguments (used by the Windows Startup shortcut and by the droidadb:// link):
'   login           start hidden only if it is not running yet, do not open the browser
'   droidadb://...  same as login (the installed web app's Start button)
Option Explicit
Dim sh, fso, root, ps, mode, arg, cmd, rc, logf, tail, ts, lines, i, ping
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps = root & "\core\scripts\start.ps1"
If Not fso.FileExists(ps) Or Not fso.FileExists(root & "\core\server\server.ps1") Or Not fso.FileExists(root & "\index.html") Then
  MsgBox "DROID ADB files are missing. Please download the complete ZIP again.", 16, "DROID ADB"
  WScript.Quit 1
End If
mode = ""
If WScript.Arguments.Count > 0 Then arg = LCase(WScript.Arguments(0)) Else arg = ""
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps & """"
If arg = "login" Or Left(arg, 11) = "droidadb://" Then cmd = cmd & " -IfNotRunning -NoBrowser"
sh.CurrentDirectory = root
rc = sh.Run(cmd, 0, True)
If rc <> 0 Then
  tail = ""
  logf = root & "\Logs\backend-error.log"
  If fso.FileExists(logf) Then
    Set ts = fso.OpenTextFile(logf, 1)
    If Not ts.AtEndOfStream Then lines = Split(ts.ReadAll, vbCrLf)
    ts.Close
    If IsArray(lines) Then
      For i = UBound(lines) - 5 To UBound(lines)
        If i >= 0 Then If Len(Trim(lines(i))) > 0 Then tail = tail & lines(i) & vbCrLf
      Next
    End If
  End If
  MsgBox "DROID ADB could not start." & vbCrLf & vbCrLf & tail & vbCrLf & "Details: Logs\backend-error.log", 16, "DROID ADB"
  WScript.Quit 1
End If
