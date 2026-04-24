@echo off
REM Multi-model Interego workflow: discovery agent that finds all
REM self-identity descriptors published by the three model-agents.
REM Spawned by run-multimodel-workflow.bat (final step).

cd /d D:\devstuff\harness\context-graphs\scripts

set TAG=%1
if "%TAG%"=="" set TAG=unknown

set PROMPT=Use the interego MCP to discover all descriptors tagged '%TAG%' on the home pod. There should be three: one from an opus-family agent, one from sonnet, one from haiku — each describing their own identity. List what you find. Report: did all three models successfully publish? What did each one say about its own strengths? Summarize in a short table.

echo [Discovery agent] searching for %TAG% descriptors...
claude -p "%PROMPT%" --dangerously-skip-permissions --mcp-config mcp-config-A.json --model sonnet --max-budget-usd 0.50 --output-format json --allowedTools "mcp__interego__*" > multimodel-discover.json 2>&1

echo [Discovery agent] done. Transcript: scripts\multimodel-discover.json
pause >nul
