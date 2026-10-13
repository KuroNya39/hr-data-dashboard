@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node update-data.js
) else (
  D:\nodejs\node.exe update-data.js
)
pause
