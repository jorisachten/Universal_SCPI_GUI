@echo off
setlocal

REM Go to the directory of this script
cd /d "%~dp0"

echo Starting SCPI Web UI...
echo.

REM Start Flask app in a new window
start "SCPI Web UI" cmd /k python app.py

REM Wait a moment for Flask to start
timeout /t 2 >nul

REM Open browser with auto-discover
start http://127.0.0.1:5000/?autodiscover=1

echo Browser opened.
echo Close the Flask window to stop the server.
