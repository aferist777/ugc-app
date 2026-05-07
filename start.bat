@echo off
cd /d "%~dp0"
title UGC Character Generator
echo Starting UGC Character Generator...
echo.
start "" "http://localhost:3000"
npm start
pause
