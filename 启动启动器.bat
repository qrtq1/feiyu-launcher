@echo off
chcp 65001 >nul
rem ---- Feiyu Launcher quick start (runs the latest build from out\) ----
rem Clears ELECTRON_RUN_AS_NODE so the exe starts as an app, not as node.
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

if not exist "out\main\index.js" goto NOBUILD
if not exist "node_modules\electron\dist\electron.exe" goto NOELECTRON

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:NOBUILD
echo [!] out\main\index.js not found - build first.
echo     npm run build   (or node scripts\build.mjs)
pause
exit /b 1

:NOELECTRON
echo [!] electron not found in node_modules - run: pnpm setup:electron
pause
exit /b 1
