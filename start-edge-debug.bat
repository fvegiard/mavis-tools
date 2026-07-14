@echo off
setlocal
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set PORT=9223
set DATA_DIR=%LOCALAPPDATA%\Microsoft\Edge\MavisDebug

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo Starting Edge in debug mode on port %PORT% ...
echo Profile: %DATA_DIR%
echo.

start "" %EDGE% --remote-debugging-port=%PORT% --remote-debugging-address=127.0.0.1 --user-data-dir="%DATA_DIR%"

timeout /t 3 /nobreak >nul

echo.
echo Checking http://127.0.0.1:%PORT%/json/version ...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/json/version' -TimeoutSec 5).Content } catch { 'NOT REACHABLE' }"
echo.
echo Now run from Mavis:
echo   set CDP_URL=http://127.0.0.1:%PORT%
echo   cd "C:\Users\fvegi\.mavis\workspace\mcp-control"
echo   node mcp.cjs browser tabs
endlocal
