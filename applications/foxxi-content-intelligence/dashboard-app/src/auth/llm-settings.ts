/**
 * LLM mode + BYOK settings for the dashboard.
 *
 * Three modes, mirroring the substrate's three architectures:
 *
 *   - `bridge-env` — The bridge has its own FOXXI_LLM_API_KEY /
 *     ANTHROPIC_API_KEY env var. Dashboard sends NO key per request.
 *     Tenant-owned bridge pattern (tenant pays for inference).
 *
 *   - `byok` — User pastes their Anthropic API key into the dashboard
 *     Settings dialog. Key is stored in localStorage, sent as
 *     llm_api_key in each agentic call. Bridge uses it transiently for
 *     the one LLM call; doesn't persist/log. User's subscription pays.
 *
 *   - `mcp-client` — Dashboard calls the retrieval-only tool
 *     (foxxi.retrieve_course_context). No LLM call at the bridge.
 *     Useful when the user wants to copy the retrieval scaffold + cited
 *     transcripts into their own agent context (Claude.ai / Claude
 *     Desktop / Claude Code / Cursor / etc.) and have THEIR agent
 *     synthesize the answer using THEIR existing subscription.
 *     Substrate-purest: no key anywhere, audit trail records mcp-client
 *     as the key source.
 *
 * Settings persist in localStorage. The Anthropic key is NEVER sent to
 * the substrate's static bundle or any third party — it only goes from
 * the dashboard to the bridge (TLS in production), and the bridge uses
 * it transiently for the one outbound call.
 */

export type LlmMode = 'bridge-env' | 'byok' | 'mcp-client';

export interface LlmSettings {
  mode: LlmMode;
  byokKey?: string;
  llmModel?: string; // default claude-sonnet-4-5
}

const STORAGE_KEY = 'foxxi:llm';

const DEFAULTS: LlmSettings = { mode: 'bridge-env' };

export function loadLlmSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const s = JSON.parse(raw) as LlmSettings;
    return { ...DEFAULTS, ...s };
  } catch {
    return DEFAULTS;
  }
}

export function saveLlmSettings(s: LlmSettings): void {
  // Strip the key when not in byok mode so we don't keep it on disk
  // longer than the mode is active.
  const toStore: LlmSettings = s.mode === 'byok'
    ? s
    : { mode: s.mode, llmModel: s.llmModel };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
}

export function clearLlmSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}
