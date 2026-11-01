' DROID ADB silent launcher. Starts the background service without showing any window.
' Double-click it, point a shortcut at it, or let Windows or the web page start it.
'   Launch.vbs                 start (or restart) the service and open the dashboard
'   Launch.vbs nobrowser       start the service only, no browser (used at Windows start-up)
'   Launch.vbs url "droidadb://start"   used by the Start button in the web page
Option Explicit
Dim sh, fso, root, i, a, noBrowser, keepRunning, cmd, rc, errFile, msg, ts
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
noBrowser = False
keepRunning = False
For i = 0 To WScript.Arguments.Count - 1
  a = LCase(WScript.Arguments(i))
  If a = "nobrowser" Then
    noBrowser = True
    keepRunning = True
  ElseIf a = "url" Then
    keepRunning = True
  End If
Next
If Not fso.FileExists(root & "\core\scripts\start.ps1") Then
  MsgBox "The launcher script is missing. Download the complete ZIP again.", 16, "DROID ADB"
  WScript.Quit 1
End If
errFile = root & "\Logs\launch-error.txt"
On Error Resume Next
If fso.FileExists(errFile) Then fso.DeleteFile errFile, True
On Error GoTo 0
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\core\scripts\start.ps1"""
If noBrowser Then cmd = cmd & " -NoBrowser"
If keepRunning Then cmd = cmd & " -KeepRunning"
rc = sh.Run(cmd, 0, True)
If rc <> 0 Then
  msg = "DROID ADB could not start."
  If fso.FileExists(errFile) Then
    Set ts = fso.OpenTextFile(errFile, 1)
    If Not ts.AtEndOfStream Then msg = msg & vbCrLf & vbCrLf & Left(ts.ReadAll, 600)
    ts.Close
  End If
  msg = msg & vbCrLf & vbCrLf & "More detail is in the Logs folder (backend-error.log)."
  MsgBox msg, 16, "DROID ADB"
  WScript.Quit 1
End If
