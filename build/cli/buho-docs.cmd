@echo off
rem buho-docs: CLI de Buho Docs para agentes de IA y personas.
rem buho-docs.exe habla con la app abierta (milisegundos) y, si esta cerrada, usa el motor de la app en modo Node.
"%~dp0buho-docs.exe" %*
exit /b %ERRORLEVEL%
