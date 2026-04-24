@echo off
REM Multi-model Interego workflow: Claude Opus 4.7 agent.
REM Spawned by run-multimodel-workflow.bat.

cd /d D:\devstuff\harness\context-graphs\scripts

set TAG=%1
if "%TAG%"=="" set TAG=unknown

set PROMPT=Use the interego MCP to publish a memory descriptor on the home pod describing your identity as an AI model. Include: (1) the model family you believe you are (e.g. 'claude-opus'), (2) one thing you think you're especially good at, (3) a tag '%TAG%' in the content so this descriptor is discoverable. Use graph_iri 'urn:graph:multimodel:%TAG%/opus'. Modal status: Asserted. Report the descriptor URL in one sentence.

echo [Opus agent] publishing self-identity descriptor...
claude -p "%PROMPT%" --dangerously-skip-permissions --mcp-config mcp-config-A.json --model opus --max-budget-usd 0.50 --output-format json --allowedTools "mcp__interego__*" > multimodel-opus.json 2>&1

echo [Opus agent] done. Transcript: scripts\multimodel-opus.json
pause >nul
