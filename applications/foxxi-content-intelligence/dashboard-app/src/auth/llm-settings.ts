/**
 * LLM mode + BYOK settings for the dashboard.
 *
 * Two modes for the dashboard surface:
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
 * The substrate still exposes a third architecture as a primitive —
 * `foxxi.retrieve_course_context` returns the retrieval scaffold + cited
 * transcripts WITHOUT an LLM call, so an MCP-native agent (Claude Code,
 * Cursor, etc.) can call it directly and synthesise in its own context.
 * That path is for agent-to-agent use; it isn't exposed as a dashboard
 * UI option because a browser SPA can't usefully forward the result to a
 * separate agent session (the human-mediated copy-paste flow was clunky
 * enough to be worse than just using BYOK or bridge-env here).
 *
 * Settings persist in localStorage. The Anthropic key is NEVER sent to
 * the substrate's static bundle or any third party — it only goes from
 * the dashboard to the bridge (TLS in production), and the bridge uses
 * it transiently for the one outbound call.
 */

export type LlmMode = 'bridge-env' | 'byok';

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
