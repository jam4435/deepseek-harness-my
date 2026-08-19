Option Explicit

' Double-click entry point for DeepSeek Harness Web.
' Starts scripts\windows-launcher\dsh-web-watchdog.ps1 with no visible window,
' then opens http://127.0.0.1:3080 in the default browser as soon as it answers.

Const URL = "http://127.0.0.1:3080/"
Const POLL_MS = 500
Const POLLS = 120

Dim shell, fso, scriptDir, watchdog, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
watchdog = scriptDir & "\dsh-web-watchdog.ps1"

If Not fso.FileExists(watchdog) Then
    MsgBox "Missing watchdog script:" & vbCrLf & watchdog, vbCritical, "DeepSeek Harness Web"
    WScript.Quit 1
End If

If WebIsUp() Then
    shell.Run URL, 1, False
    WScript.Quit 0
End If

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & watchdog & """"
shell.Run command, 0, False

Dim attempt
For attempt = 1 To POLLS
    WScript.Sleep POLL_MS
    If WebIsUp() Then
        shell.Run URL, 1, False
        WScript.Quit 0
    End If
Next

MsgBox "Web UI did not start within " & (POLL_MS * POLLS \ 1000) & " seconds." & vbCrLf & vbCrLf & _
       "Logs: %LOCALAPPDATA%\deepseek-harness\web-launcher", vbExclamation, "DeepSeek Harness Web"
WScript.Quit 1

Function WebIsUp()
    Dim http
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    If http Is Nothing Then Set http = CreateObject("MSXML2.ServerXMLHTTP")
    If http Is Nothing Then
        WebIsUp = False
        Exit Function
    End If
    http.setTimeouts 1000, 1000, 1000, 2000
    http.open "GET", URL, False
    http.send
    WebIsUp = (Err.Number = 0 And http.status = 200)
    Err.Clear
    On Error GoTo 0
End Function
