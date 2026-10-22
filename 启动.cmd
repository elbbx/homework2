@echo off
cd /d "%~dp0code"
set "OPEN_BROWSER=1"
echo Open http://127.0.0.1:3000 in your browser. Do not open index.html directly.
node --env-file-if-exists=.env server.mjs
pause
