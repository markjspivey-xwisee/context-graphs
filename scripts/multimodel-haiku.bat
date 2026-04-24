@echo off
REM Multi-model Interego workflow: Claude Haiku 4.5 agent.
REM Spawned by run-multimodel-workflow.bat.

cd /d D:\devstuff\harness\context-graphs\scripts

set TAG=%1
if "%TAG%"=="" set TAG=unknown

set PROMPT=Use the interego MCP to publish a memory descriptor on the home pod describing your identity as an AI model. Include: (1) the model family you believe you are (e.g. 'claude-haiku'), (2) one thing you think you're especially good at, (3) a tag '%TAG%' in the content so this descriptor is discoverable. Use graph_iri 'urn:graph:multimodel:%TAG%/haiku'. Modal status: Asserted. Report the descriptor URL in one sentence.

echo [Haiku agent] publishing self-identity descriptor...
claude -p "%PROMPT%" --dangerously-skip-permissions --mcp-config mcp-config-A.json --model haiku --max-budget-usd 0.15 --output-format json --allowedTools "mcp__interego__*" > multimodel-haiku.json 2>&1

echo [Haiku agent] done. Transcript: scripts\multimodel-haiku.json
pause >nul
