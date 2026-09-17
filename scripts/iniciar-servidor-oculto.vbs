' Lanza iniciar-servidor.cmd sin ventana. La tarea programada apunta aqui
' porque un .cmd lanzado directo deja una consola abierta en la sesion, y
' si el usuario la cierra por accidente, mata el servidor.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & carpeta & "\iniciar-servidor.cmd""", 0, False
