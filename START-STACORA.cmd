@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Stacora needs Node.js 22 or newer. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo Stacora - open http://127.0.0.1:3000 in your browser.
echo Keep this window open. Press Ctrl+C to stop.
echo.
if exist ".env" (
  node --env-file=.env server.mjs
) else (
  node server.mjs
)
pause
