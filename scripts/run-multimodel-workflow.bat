@echo off
REM Multi-model Interego workflow — prove the protocol is model-agnostic
REM by having agents backed by three different Claude model tiers each
REM publish their self-identity to the shared pod, then a fourth agent
REM discovers all three.
REM
REM This is the Idehen "loose coupling" thesis made real: the protocol
REM carries the collaboration; the specific LLM doesn't matter.
REM
REM Run from a real terminal (cmd / PowerShell), NOT inside Claude Code.
REM Cost: ~$1-2 total (Opus + Sonnet + Haiku + discovery).
REM
REM To extend beyond Claude (GPT-4 via OpenAI CLI, Gemini via Google CLI),
REM add matching child .bat files invoking those models' respective CLI
REM clients with an Interego MCP config. The discovery agent doesn't care
REM which framework published, only that the descriptors exist on the pod.

setlocal

if not exist "D:\devstuff\harness\context-graphs\mcp-server\dist\server.js" (
  echo ERROR: MCP server not built. Run:
  echo   cd D:\devstuff\harness\context-graphs\mcp-server ^&^& npm run build
  exit /b 1
)

REM Unique tag so we can find all descriptors from this run.
set /a RNDTAG=%RANDOM%
set TAG=mm-%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%-%RNDTAG%

echo === Multi-model Interego workflow ===
echo Tag: %TAG%
echo.
echo Step 1 of 4 — launching Opus agent in a new window...
start "Opus agent" "D:\devstuff\harness\context-graphs\scripts\multimodel-opus.bat" %TAG%

echo Wait for Opus to finish (check the new window), then press a key.
pause ^>nul

echo.
echo Step 2 of 4 — launching Sonnet agent in a new window...
start "Sonnet agent" "D:\devstuff\harness\context-graphs\scripts\multimodel-sonnet.bat" %TAG%

echo Wait for Sonnet to finish, then press a key.
pause ^>nul

echo.
echo Step 3 of 4 — launching Haiku agent in a new window...
start "Haiku agent" "D:\devstuff\harness\context-graphs\scripts\multimodel-haiku.bat" %TAG%

echo Wait for Haiku to finish, then press a key.
pause ^>nul

echo.
echo Step 4 of 4 — launching discovery agent to find all three...
start "Discovery agent" "D:\devstuff\harness\context-graphs\scripts\multimodel-discover.bat" %TAG%

echo.
echo When the discovery agent finishes, four JSON transcripts will be at:
echo   scripts\multimodel-opus.json
echo   scripts\multimodel-sonnet.json
echo   scripts\multimodel-haiku.json
echo   scripts\multimodel-discover.json
echo.
echo Tell Claude Code "the multi-model test ran, tag %TAG%" and it will
echo read the four transcripts and summarize what each model said.

endlocal
