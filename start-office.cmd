@echo off
cd /d "%~dp0office"
echo AI Agent Office: 
echo A browser tab will open when the server is ready.
echo Keep this window open while using the office.
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-office.ps1"
npm start
pause
