@echo off
rem buho-docs: CLI de Buho Docs para agentes de IA y personas.
rem Usa el propio ejecutable de la app en modo Node (no hace falta instalar Node). Guia: buho-docs skill
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\BuhoDocs.exe" "%~dp0buho-docs.mjs" %*
exit /b %ERRORLEVEL%
