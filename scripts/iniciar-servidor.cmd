@echo off
rem Arranca el servidor para la tarea programada de Windows (Fase 4a).
rem Usa la ruta estable de fnm: la que pone fnm en el PATH es efimera
rem (cambia en cada sesion de shell) y una tarea programada no la tiene.
rem Trampa: si se actualiza Node con fnm, hay que ajustar la version aqui.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo [%date% %time%] arrancando servidor >> logs\servidor.log
"C:\Users\Randall Marquez\AppData\Roaming\fnm\node-versions\v24.16.0\installation\node.exe" src\index.js >> logs\servidor.log 2>&1
