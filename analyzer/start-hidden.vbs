' Demarre l'analyseur BuBuTravel sans fenetre, au demarrage de Windows.
' Ne fait rien s'il tourne deja (evite deux analyseurs en parallele).
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='python.exe' OR Name='cmd.exe'")
For Each p In procs
  If Not IsNull(p.CommandLine) Then
    If InStr(1, p.CommandLine, "analyzer.py", 1) > 0 Or InStr(1, p.CommandLine, "run-background.cmd", 1) > 0 Then
      WScript.Quit 0
    End If
  End If
Next
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "cmd.exe /c """ & dir & "\run-background.cmd""", 0, False
