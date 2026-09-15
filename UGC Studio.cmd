@echo off
rem UGC Studio - opens the app on the library next to this file (library\).
rem Until there is a built UGC Studio.exe, the app runs from this source folder.
setlocal
set "HERE=%~dp0"
set "ELECTRON=%HERE%node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo UGC Studio cannot start: Electron is not installed in this folder.
  echo Open a terminal in this folder and run: npm install
  pause
  exit /b 1
)
set "UGC_DATA_DIR=%HERE%library"
start "" /D "%HERE%" "%ELECTRON%" "%HERE%."
