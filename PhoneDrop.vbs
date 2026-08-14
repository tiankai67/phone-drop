Option Explicit

Dim WshShell, FSO, AppDir, URL, PORT, q
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
q = Chr(34)

AppDir = "C:\Apps\PhoneDrop\"
PORT = "3456"
URL = "http://127.0.0.1:" & PORT & "/"

' 让后续进程都在应用目录下工作
On Error Resume Next
WshShell.CurrentDirectory = AppDir
On Error GoTo 0

' ---- 定位 node.exe ----
Dim NodeExe
NodeExe = FindNode()
If NodeExe = "" Then
    MsgBox "未找到 Node.js，无法启动 Phone Drop。" & vbCrLf & _
           "请确认以下任一位置存在 node.exe，或先安装 Node.js：" & vbCrLf & _
           "  C:\Program Files\nodejs\node.exe" & vbCrLf & _
           "  （或 WorkBuddy 自带的 node）", vbCritical, "Phone Drop"
    WScript.Quit 1
End If

' ---- 若端口被上次残留占用，先清理 ----
Call KillByPort(PORT)
WScript.Sleep 800

' ---- 若已在运行，直接开网页 ----
If IsPortListening(PORT) Then
    Call OpenBrowser(URL)
    MsgBox "Phone Drop 已在运行，已为你打开网页。" & vbCrLf & "访问地址：" & URL, _
           vbInformation, "Phone Drop"
    WScript.Quit 0
End If

' ---- 后台启动服务（隐藏窗口，输出写入 server.log 便于排查）----
Dim startCmd
startCmd = "cmd /c cd /d " & q & AppDir & q & " && " & q & NodeExe & q & " " & _
           q & AppDir & "server.js" & q & " > " & q & AppDir & "server.log" & q & " 2>&1"
WshShell.Run startCmd, 0, False

' ---- 等待端口就绪（最多 20 秒）----
Dim i, ready
ready = False
For i = 1 To 40
    If IsPortListening(PORT) Then ready = True: Exit For
    WScript.Sleep 500
Next

If Not ready Then
    Dim diag
    diag = ""
    If FSO.FileExists(AppDir & "server.log") Then
        Dim lf: Set lf = FSO.OpenTextFile(AppDir & "server.log")
        Do While Not lf.AtEndOfStream
            diag = diag & lf.ReadLine & vbCrLf
        Loop
        lf.Close
    End If
    MsgBox "服务启动失败（端口 " & PORT & " 未就绪）。" & vbCrLf & vbCrLf & _
           "使用的 Node：" & NodeExe & vbCrLf & vbCrLf & _
           "server.log 内容：" & vbCrLf & Left(diag, 2000), _
           vbCritical, "Phone Drop"
    WScript.Quit 1
End If

' ---- 自动打开浏览器 ----
Call OpenBrowser(URL)

MsgBox "Phone Drop 已启动，网页已打开。" & vbCrLf & vbCrLf & _
       "访问地址：" & URL & vbCrLf & _
       "收到的文件保存在：" & AppDir & "received-files" & vbCrLf & vbCrLf & _
       "点击「确定」停止服务。", vbInformation, "Phone Drop"

' ---- 用户点确定后停止服务 ----
Call KillByPort(PORT)

' ===================== 函数 =====================

Function FindNode()
    Dim candidates(3)
    candidates(0) = "C:\Program Files\nodejs\node.exe"
    candidates(1) = "C:\Program Files (x86)\nodejs\node.exe"
    candidates(2) = "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe"
    candidates(3) = "C:\Users\Administrator\.workbuddy\binaries\node\versions\24.14.1\node.exe"
    Dim i
    For i = 0 To UBound(candidates)
        If FSO.FileExists(candidates(i)) Then FindNode = candidates(i): Exit Function
    Next
    ' 退而求其次：从 PATH 找
    Dim tmp, line
    tmp = AppDir & "_nodefind.tmp"
    WshShell.Run "cmd /c where node > " & q & tmp & q & " 2>nul", 0, True
    If FSO.FileExists(tmp) Then
        Dim f: Set f = FSO.OpenTextFile(tmp)
        line = ""
        If Not f.AtEndOfStream Then line = Trim(f.ReadLine)
        f.Close
        FSO.DeleteFile tmp, True
        If line <> "" And FSO.FileExists(line) Then FindNode = line: Exit Function
    End If
    FindNode = ""
End Function

' 优先用 HTTP 探测 /api/info（无需临时文件，最稳）；失败再退回到 netstat
Function IsPortListening(p)
    Dim http, ok
    ok = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    If Err.Number = 0 And Not http Is Nothing Then
        Err.Clear
        http.setTimeouts 1000, 1000, 1000, 1000
        http.Open "GET", "http://127.0.0.1:" & p & "/api/info", False
        http.Send
        If Err.Number = 0 And http.Status = 200 Then ok = True
        Err.Clear
    End If
    On Error GoTo 0
    If ok Then IsPortListening = True: Exit Function
    IsPortListening = PortViaNetstat(p)
End Function

Function PortViaNetstat(p)
    Dim tmp, cmd2, f, line
    tmp = AppDir & "_portchk.tmp"
    cmd2 = "cmd /c netstat -ano | findstr /C:" & q & ":" & p & q & " | findstr " & _
           q & "LISTENING" & q & " > " & q & tmp & q & " 2>nul"
    On Error Resume Next
    WshShell.Run cmd2, 0, True
    On Error GoTo 0
    PortViaNetstat = False
    If FSO.FileExists(tmp) Then
        Set f = FSO.OpenTextFile(tmp)
        Do While Not f.AtEndOfStream
            line = f.ReadLine
            If InStr(line, "LISTENING") > 0 Then PortViaNetstat = True
        Loop
        f.Close
        FSO.DeleteFile tmp, True
    End If
End Function

Sub KillByPort(p)
    Dim cmd3
    cmd3 = "cmd /c for /f " & q & "tokens=5" & q & " %a in ('netstat -ano ^| findstr /C:" & _
           q & ":" & p & q & " ^| findstr " & q & "LISTENING" & q & "') do taskkill /f /pid %a >nul 2>&1"
    On Error Resume Next
    WshShell.Run cmd3, 0, True
    On Error GoTo 0
End Sub

Sub OpenBrowser(u)
    On Error Resume Next
    WshShell.Run "explorer.exe " & q & u & q, 1, False
    If Err.Number <> 0 Then
        Err.Clear
        WshShell.Run q & u & q, 1, False
    End If
    On Error GoTo 0
End Sub
