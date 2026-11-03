@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
    echo NEXUS could not start: its components are missing.
    echo Run this in this folder: npm install
    pause
    exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
