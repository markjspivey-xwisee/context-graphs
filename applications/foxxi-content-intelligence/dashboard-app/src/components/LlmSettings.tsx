import React, { useState } from 'react';
import { Card, Button, Pill } from './common.js';
import { type LlmMode, type LlmSettings } from '../auth/llm-settings.js';

const MODE_INFO: Record<LlmMode, { label: string; subtitle: string; pillTone: 'accent' | 'good' | 'warn' }> = {
  'bridge-env': {
    label: 'Bridge-owned key',
    subtitle: 'The bridge has its own FOXXI_LLM_API_KEY env var. Tenant-owned bridge pays for inference. Dashboard sends NO key per request.',
    pillTone: 'accent',
  },
  'byok': {
    label: 'BYOK — your Anthropic key',
    subtitle: 'Paste your Anthropic key once; stored in localStorage and sent per-request as llm_api_key. Bridge uses it transiently for the one LLM call (no persist, no log). Your subscription pays.',
    pillTone: 'good',
  },
  'mcp-client': {
    label: 'MCP-client-as-LLM',
    subtitle: "Dashboard calls foxxi.retrieve_course_context (no LLM at the bridge). You copy the cited transcripts into YOUR agent (Claude.ai / Claude Desktop / Claude Code / Cursor) and have it synthesise — your existing subscription pays. No API key anywhere.",
    pillTone: 'warn',
  },
};

export function LlmSettingsDialog(props: {
  current: LlmSettings;
  onSave: (s: LlmSettings) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<LlmMode>(props.current.mode);
  const [byokKey, setByokKey] = useState(props.current.byokKey ?? '');
  const [showKey, setShowKey] = useState(false);

  function save() {
    props.onSave({
      mode,
      byokKey: mode === 'byok' ? byokKey.trim() || undefined : undefined,
      llmModel: props.current.llmModel,
    });
    props.onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(8,10,14,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, zIndex: 100,
    }} onClick={props.onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 640 }}>
        <Card title="LLM mode + key">
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.55 }}>
            Three architectures, all routed through Interego. Pick the one that matches your auth + billing.
            Settings persist in browser localStorage; never sent anywhere but the bridge for the chosen mode.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {(Object.keys(MODE_INFO) as LlmMode[]).map(m => {
              const info = MODE_INFO[m];
              const selected = mode === m;
              return (
                <button key={m}
                  onClick={() => setMode(m)}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    background: selected ? 'rgba(124,193,255,0.10)' : 'var(--panel-2)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 6,
                    cursor: 'pointer', color: 'var(--text)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%',
                      border: `2px solid ${selected ? 'var(--accent)' : 'var(--text-dim)'}`,
                      background: selected ? 'var(--accent)' : 'transparent',
                    }} />
                    <strong style={{ fontSize: 14 }}>{info.label}</strong>
                    <Pill tone={info.pillTone}>{m}</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 22, lineHeight: 1.55 }}>
                    {info.subtitle}
                  </div>
                </button>
              );
            })}
          </div>

          {mode === 'byok' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
                Anthropic API key (starts with <code>sk-ant-</code>):
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={byokKey}
                  onChange={e => setByokKey(e.target.value)}
                  placeholder="sk-ant-…"
                  style={{
                    flex: 1, padding: '8px 12px', background: 'var(--panel-2)',
                    color: 'var(--text)', border: '1px solid var(--border)',
                    borderRadius: 6, fontSize: 13, fontFamily: 'monospace',
                  }}
                />
                <Button onClick={() => setShowKey(s => !s)}>{showKey ? 'hide' : 'show'}</Button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.55 }}>
                Stored in this browser's localStorage. Sent as <code>llm_api_key</code> in each agentic call;
                bridge uses it transiently for the one outbound Anthropic call and doesn't persist or log it.
                Clear by switching to a different mode and saving.
              </div>
            </div>
          )}

          {mode === 'mcp-client' && (
            <div style={{
              marginBottom: 16, padding: 10,
              background: 'rgba(255,177,85,0.08)',
              border: '1px solid rgba(255,177,85,0.3)',
              borderRadius: 6, fontSize: 12, lineHeight: 1.55,
            }}>
              In this mode the dashboard calls <code>foxxi.retrieve_course_context</code> instead of the LLM-augmented
              tool. You'll get the retrieval scaffold + verbatim cited transcripts. To synthesise an answer,
              paste the question + cited transcripts into your existing agent session (Claude.ai / Claude Desktop /
              Claude Code / Cursor). Your existing subscription pays. The Interego trace records
              <code> keySource: 'mcp-client'</code> for honest provenance.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button primary onClick={save}
              disabled={mode === 'byok' && !byokKey.trim()}>
              Save
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
