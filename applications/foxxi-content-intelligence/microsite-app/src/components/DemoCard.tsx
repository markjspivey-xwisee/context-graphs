import React, { useState } from 'react';
import type { BridgeCall } from '../bridge-client.js';

export interface DemoStep {
  /** Short title shown above the card. */
  title: string;
  /** One-line subtitle in italic Garamond. */
  subtitle: string;
  /** Explanatory text shown above the action button. Markdown not parsed; plain text only. */
  body: string | React.ReactNode;
  /** The button label. */
  actionLabel: string;
  /** Executes the demo action. Returns a BridgeCall (or array of them for multi-call steps). */
  run: () => Promise<BridgeCall | BridgeCall[]>;
  /** Rendered after the result lands — explains what just happened in human terms. */
  explainer: (result: unknown) => React.ReactNode;
  /** Result summary chip ("learned: X") shown next to the call trace. */
  summarize?: (result: unknown) => string;
}

export function DemoCard({ step, stepNumber }: { step: DemoStep; stepNumber: number }) {
  const [running, setRunning] = useState(false);
  const [calls, setCalls] = useState<BridgeCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setRunning(true); setError(null);
    try {
      const r = await step.run();
      setCalls(Array.isArray(r) ? r : [r]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const lastResult = calls?.[calls.length - 1]?.result;

  return (
    <article style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 24,
      marginBottom: 18,
      boxShadow: 'var(--shadow)',
    }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--text)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600,
          flexShrink: 0,
        }}>{stepNumber}</div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'EB Garamond', serif", fontStyle: 'italic',
            fontSize: 22, color: 'var(--text)', lineHeight: 1.2,
          }}>{step.title}</div>
          <div style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 2 }}>{step.subtitle}</div>
        </div>
      </header>

      <div style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.6, marginBottom: 18 }}>
        {step.body}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: calls || error ? 18 : 0 }}>
        <button
          onClick={go}
          disabled={running}
          style={{
            padding: '10px 18px',
            background: running ? 'var(--panel-2)' : 'var(--text)',
            color: 'var(--panel)',
            border: 'none', borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: running ? 'wait' : 'pointer',
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? (
            <>running<span className="blink">·</span><span className="blink">·</span><span className="blink">·</span></>
          ) : calls ? `Re-run ${step.actionLabel}` : step.actionLabel}
        </button>
        {calls && step.summarize && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: 'var(--good)',
            padding: '4px 8px', borderRadius: 4,
            background: 'rgba(47,106,58,0.10)',
            border: '1px solid rgba(47,106,58,0.32)',
          }}>{step.summarize(lastResult)}</span>
        )}
      </div>

      {error && (
        <div style={{
          padding: 12, marginBottom: 14,
          background: 'rgba(168,51,31,0.10)',
          border: '1px solid rgba(168,51,31,0.32)',
          borderRadius: 4, fontSize: 13, color: 'var(--bad)',
        }}>✗ {error}</div>
      )}

      {calls && calls.map((call, i) => <CallTrace key={i} call={call} />)}

      {calls && (
        <div style={{
          marginTop: 18, padding: 14,
          background: 'var(--panel-2)',
          borderLeft: '3px solid var(--accent)',
          borderRadius: 4,
        }}>
          <div className="label" style={{ marginBottom: 8 }}>What just happened</div>
          <div style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--text)' }}>
            {step.explainer(lastResult)}
          </div>
        </div>
      )}
    </article>
  );
}

function CallTrace({ call }: { call: BridgeCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: 10, background: 'var(--panel-2)',
          border: '1px solid var(--border)', borderRadius: 4,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
          color: 'var(--text-dim)',
        }}>
        <span style={{ color: 'var(--accent)' }}>POST /mcp</span>
        <span style={{ color: 'var(--text)' }}>{call.tool}</span>
        {call.authed && <span style={{ color: 'var(--good)' }}>✓ authed as {call.callerWebId?.split('/').slice(-2, -1)[0]}</span>}
        <span style={{ marginLeft: 'auto' }}>{call.durationMs}ms</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div style={{
          marginTop: 6, padding: 12,
          background: '#1a2332', color: '#f5efe2',
          borderRadius: 4, fontSize: 11,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          maxHeight: 360, overflow: 'auto',
        }}>
          <div style={{ color: '#7fd693' }}>→ request</div>
          {`{
  "name": "${call.tool}",
  "arguments": ${JSON.stringify(call.args, null, 2)}
}`}
          <div style={{ color: '#7fd693', marginTop: 10 }}>← response</div>
          {JSON.stringify(call.result, null, 2)}
        </div>
      )}
    </div>
  );
}
