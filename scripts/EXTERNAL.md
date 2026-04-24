# External demo scripts

Some demos exercise multiple real Claude Code CLI sessions or multiple
LLM providers. These can't be run from inside another Claude Code
session (the outer session's `CLAUDECODE` env blocks child spawns
even with `env -u CLAUDECODE`, because of downstream pipe behavior).

Run them from a real terminal (cmd, PowerShell, or Git Bash) —
double-click the `.bat` or launch from a shell.

## Catalog

### `run-mcp-multiagent-test.bat`

Two agents: Agent A publishes a tagged memory; Agent B discovers it.
Proves the stdio MCP server + cross-session federation works with real
LLMs. Canonical liveness test.

**Cost:** ~$0.35
**Time:** ~1 minute

### `run-multimodel-workflow.bat`

Four agents across three model tiers (Opus, Sonnet, Haiku) + a
discovery agent. Each model-agent publishes a self-identity
descriptor; the discovery agent reads all three and summarizes.

Proves the Interego protocol is **model-agnostic** — the collaboration
layer (pod descriptors) carries the workflow regardless of which LLM
is producing tool calls. Extending this to GPT-4 / Gemini requires
matching child `.bat` files that invoke those models' respective CLI
clients with an Interego MCP config; the discovery agent doesn't care
which framework published, only that the descriptors exist on the pod.

**Cost:** ~$1-2
**Time:** ~3-4 minutes (with manual key-presses between steps)

## After running any script

Transcripts land as JSON files in this `scripts/` directory. Report
back to Claude Code with "the test ran" and it will read the
transcripts and summarize what each agent did.

## In-session demos (don't need this directory)

For demos that can run without spawning Claude Code CLI, see
`examples/demo-*.mjs` at the project root. Those run as plain Node
scripts in ~1 second with no cost. Examples:

- `demo-federated-royal-family.mjs` — cross-pod reasoning with trust
- `demo-nanotation-pipeline.mjs` — markdown → typed descriptor
- `demo-abac-cross-pod.mjs` — attribute-based access control
- `demo-abac-sybil-resistance.mjs` — attack + defense
- `demo-vocabulary-emergence.mjs` — emergent alignment
- `demo-stigmergic-colony.mjs` — colony intelligence
- (and several more)

The in-session demos are the artifacts to screenshot for slides.
The external scripts are the artifacts to run in front of a
demo-day audience.
