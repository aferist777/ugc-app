@echo off
setlocal
rem ============================================================================
rem  UGC Character Generator - start the server and open the app.
rem
rem  Runs "npm start" (launcher.js, which respawns server.js so the in-app
rem  restart button keeps working) in THIS window, and opens the browser once
rem  the port actually answers. Not after a fixed sleep: on a cold start that
rem  opens a dead tab, and on a warm one it wastes the wait.
rem
rem  Closing this window stops the server.
rem ============================================================================

cd /d "%~dp0"

set "PORT=3000"
set "URL=http://localhost:%PORT%/library"

rem --- Already running? Open it and leave the running server alone -----------
netstat -ano | findstr /c:":%PORT% " | findstr /i "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [start-ugc] Port %PORT% is already serving. Opening the app, starting nothing.
  start "" "%URL%"
  goto :end
)

where node >nul 2>&1
if errorlevel 1 (
  echo [start-ugc] Node.js is not on PATH. Install Node, or run this from a shell where "node -v" works.
  pause
  goto :end
)

if not exist "node_modules\" (
  echo [start-ugc] node_modules is missing - installing dependencies first, this takes a while.
  call npm install
  if errorlevel 1 (
    echo [start-ugc] npm install failed - not starting.
    pause
    goto :end
  )
)

rem --- Wait for the port in a side window, then open the browser --------------
rem  One PowerShell command, single quotes inside, so there is no quote nesting
rem  to get wrong. It gives up after 60 tries rather than polling forever.
start "ugc-open" /min powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "for($i=0;$i -lt 60;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();Start-Process '%URL%';exit}catch{Start-Sleep -Seconds 1}}"

echo [start-ugc] Starting the server on port %PORT% ...
echo [start-ugc] The browser opens by itself. Close this window to stop the server.
echo.
call npm start

:end
endlocal
