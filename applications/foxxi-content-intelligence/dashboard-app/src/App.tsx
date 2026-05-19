import React, { useEffect, useState } from 'react';
import { Login } from './components/Login.js';
import { LearnerShell } from './components/LearnerShell.js';
import { AdminShell } from './components/AdminShell.js';
import { Header } from './components/common.js';
import { loadSession, saveSession, clearSession, type FoxxiSession } from './auth/session.js';
import { getTransport, resetTransportProbe } from './interego/client.js';
import { SAMPLE_ADMIN_PAYLOAD } from './sample/data.js';

export function App() {
  const [session, setSession] = useState<FoxxiSession | null>(loadSession());
  const [transport, setTransport] = useState<'bridge' | 'sample' | 'probing'>('probing');

  useEffect(() => {
    getTransport().then(setTransport).catch(() => setTransport('sample'));
  }, []);

  function onSignIn(s: FoxxiSession) {
    saveSession(s);
    setSession(s);
  }
  function onLogout() {
    clearSession();
    resetTransportProbe();
    setSession(null);
  }

  if (!session) {
    return <Login onSignIn={onSignIn} />;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <Header session={session} onLogout={onLogout} transport={transport} />
      <div style={{ flex: 1 }}>
        {session.role === 'learner' ? <LearnerShell session={session} /> : <AdminShell session={session} />}
      </div>
      <Footer session={session} transport={transport} />
    </div>
  );
}

function Footer({ session, transport }: { session: FoxxiSession; transport: 'bridge' | 'sample' | 'probing' }) {
  const meta = SAMPLE_ADMIN_PAYLOAD.meta;
  return (
    <footer style={{
      marginTop: 24, padding: '14px 20px',
      borderTop: '1px solid var(--border)',
      background: 'var(--panel)',
      fontSize: 11, color: 'var(--text-dim)',
      display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between',
    }}>
      <div>
        Foxxi · Interego-grounded L&amp;D · tenant <strong>{meta.tenant}</strong>
        {' '}<code style={{ marginLeft: 6 }}>{meta.tenant_id}</code>
      </div>
      <div>
        signed in as <strong>{session.name}</strong> ({session.role}){' '}
        · <code style={{ wordBreak: 'break-all' }}>{session.webId}</code>
      </div>
      <div>
        transport: <strong>{transport}</strong>
        {' '}· pod: <code style={{ wordBreak: 'break-all' }}>{meta.tenant_pod}</code>
      </div>
    </footer>
  );
}
