import React from 'react';

export function Card(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
      padding: 16, marginBottom: 14,
    }}>
      {(props.title || props.right) && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          {props.title && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{props.title}</div>}
          {props.right && <div style={{ marginLeft: 'auto' }}>{props.right}</div>}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: React.ReactNode }) {
  const bg = {
    neutral: '#2a3046', good: 'rgba(94,210,122,0.18)', warn: 'rgba(255,177,85,0.18)', bad: 'rgba(255,119,119,0.18)', accent: 'rgba(124,193,255,0.18)',
  }[tone];
  const fg = {
    neutral: 'var(--text-dim)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', accent: 'var(--accent)',
  }[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: bg, color: fg, fontSize: 11, fontWeight: 500,
    }}>{children}</span>
  );
}

export function Button(props: { onClick?: () => void; primary?: boolean; disabled?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button onClick={props.onClick} disabled={props.disabled} style={{
      padding: '8px 14px',
      background: props.primary ? 'var(--accent)' : 'var(--panel-2)',
      color: props.primary ? '#0c0e14' : 'var(--text)',
      border: '1px solid var(--border)', borderRadius: 6,
      fontSize: 13, fontWeight: 500,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.5 : 1,
      ...(props.style ?? {}),
    }}>{props.children}</button>
  );
}

export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; onSubmit?: () => void }) {
  return (
    <input
      value={props.value}
      onChange={e => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      onKeyDown={e => { if (e.key === 'Enter' && props.onSubmit) props.onSubmit(); }}
      style={{
        flex: 1, padding: '8px 12px', background: 'var(--panel-2)',
        color: 'var(--text)', border: '1px solid var(--border)',
        borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
      }}
    />
  );
}

export function Header({ session, onLogout, transport }: { session: { role: string; name: string; webId: string }; onLogout: () => void; transport: 'bridge' | 'sample' | 'probing' }) {
  return (
    <div style={{
      padding: '12px 20px', background: 'var(--panel)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>Foxxi</div>
      <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>· Interego-grounded L&D dashboard</div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Pill tone={transport === 'bridge' ? 'good' : transport === 'sample' ? 'warn' : 'neutral'}>
          {transport === 'bridge' ? '● live bridge' : transport === 'sample' ? '● offline sample' : '● probing…'}
        </Pill>
        <Pill tone="accent">{session.role}</Pill>
        <div style={{ fontSize: 13 }}>{session.name}</div>
        <Button onClick={onLogout}>Sign out</Button>
      </div>
    </div>
  );
}
