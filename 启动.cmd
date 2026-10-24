@echo off
setlocal
cd /d "%~dp0"
echo Starting Homework 2...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0code\start.ps1"
if errorlevel 1 echo Startup failed. See the message above.
pause
