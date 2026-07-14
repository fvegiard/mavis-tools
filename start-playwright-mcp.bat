@echo off
setlocal

REM Start the official @playwright/mcp server, connected to your running
REM Edge instance (started by start-edge-debug.bat on port 9223).
REM This is the Microsoft-maintained browser MCP — 22+ tools, a11y tree,
REM cross-browser capable, regular releases.

set CDP_URL=http://127.0.0.1:9223
set BROWSER=msedge
set LOG_DIR=%LOCALAPPDATA%\Mavis\mcp-logs

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo ============================================
echo  Playwright MCP v0.0.78 (Microsoft official)
echo  Browser:  %BROWSER%
echo  CDP URL:  %CDP_URL%
echo  Log:      %LOG_DIR%\playwright-mcp.log
echo ============================================
echo.
echo Make sure Edge is running in debug mode:
echo   start-edge-debug.bat
echo.
echo Then point your MCP client (Mavis, Claude Desktop, etc.) at this server.
echo See SKILL.md "Config for Mavis" section.
echo.
echo Starting server now... (Ctrl+C to stop)
echo.

npx @playwright/mcp@latest --browser %BROWSER% --cdp-endpoint %CDP_URL% --caps vision 2>&1 | tee "%LOG_DIR%\playwright-mcp.log"

endlocal
