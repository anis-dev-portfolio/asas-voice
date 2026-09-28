' ============================ DEV / HÉRITAGE ============================
' Lanceur tout-en-un Asas Voice (antérieur au sidecar embarqué) :
'   1) démarre le backend local (port 4321) en arrière-plan, fenêtre cachée
'   2) ouvre l'application desktop (exe release)
' NOTE : l'app packagée (tauri build) embarque et lance déjà son backend (sidecar).
' Ce lanceur n'est donc utile que pour un exe de dev sans sidecar ; sinon l'étape 1
' est redondante (le 2e backend échoue à se lier au port 4321, sans conséquence).
Option Explicit
Dim sh, fso, root, backendCmd, appExe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Racine du repo = dossier parent de \scripts
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
backendCmd = root & "\scripts\start-backend.cmd"
appExe = root & "\apps\desktop\src-tauri\target\release\asas-voice.exe"

' 1) Backend en arrière-plan, fenêtre cachée (0). Si un backend tourne déjà sur 4321,
'    cette instance échoue à se lier au port et se ferme aussitôt : sans conséquence.
sh.Run "cmd /c """ & backendCmd & """", 0, False

' 2) Laisse le serveur démarrer avant d'ouvrir l'app.
WScript.Sleep 1800

' 3) Lance l'application (fenêtre normale).
If fso.FileExists(appExe) Then
  sh.Run """" & appExe & """", 1, False
Else
  MsgBox "asas-voice.exe est introuvable." & vbCrLf & vbCrLf & _
         "Compile d'abord la version release :" & vbCrLf & _
         "  pnpm --filter @asas-voice/desktop tauri build", _
         48, "Asas Voice"
End If
