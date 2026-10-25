; Instalador de Búho Docs · Buho Corps Systems
; - Clic derecho en archivos .md: «Abrir con Búho Docs» (sin quitarle a nadie la app predeterminada).
; - Pone el CLI buho-docs (carpeta cli) en el PATH del usuario, para cualquier agente o terminal.
; - Al desinstalar quita todo, también la skill que la app deja a los agentes (solo la suya, con marca).
; Todo va en HKCU (instalación por usuario).

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.md\shell\BuhoDocs" "" "Abrir con Búho Docs"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.md\shell\BuhoDocs" "Icon" "$INSTDIR\BuhoDocs.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.md\shell\BuhoDocs\command" "" '"$INSTDIR\BuhoDocs.exe" "%1"'
  ; «Abrir con» de Windows la propone para .md
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BuhoDocs.exe\SupportedTypes" ".md" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BuhoDocs.exe\SupportedTypes" ".markdown" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\BuhoDocs.exe" "FriendlyAppName" "Búho Docs"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.md\OpenWithList\BuhoDocs.exe" "" ""

  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\cli'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $$p){$$p=''}; if(($$p -split ';') -notcontains $$d){[Environment]::SetEnvironmentVariable('Path',(($$p.TrimEnd(';')+';'+$$d).TrimStart(';')),'User')}"`
  Pop $0
!macroend

!macro BX_UNSKILL AGENT
  IfFileExists "$PROFILE\${AGENT}\skills\buho-docs\.instalado-por-buho-docs" 0 +2
    RMDir /r "$PROFILE\${AGENT}\skills\buho-docs"
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.md\shell\BuhoDocs"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\BuhoDocs.exe"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\.md\OpenWithList\BuhoDocs.exe"
  !insertmacro BX_UNSKILL .claude
  !insertmacro BX_UNSKILL .codex
  !insertmacro BX_UNSKILL .copilot
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d='$INSTDIR\cli'; $$p=[Environment]::GetEnvironmentVariable('Path','User'); if($$p){[Environment]::SetEnvironmentVariable('Path',(($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }) -join ';'),'User')}"`
  Pop $0
!macroend
