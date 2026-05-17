import React, { useEffect, useState } from 'react';
import { Login } from './components/Login.js';
import { LearnerShell } from './components/LearnerShell.js';
import { AdminShell } from './components/AdminShell.js';
import { Header } from './components/common.js';
import { loadSession, saveSession, clearSession, type FoxxiSession } from './auth/session.js';
import { getTransport, resetTransportProbe } from './interego/client.js';

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
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Header session={session} onLogout={onLogout} transport={transport} />
      {session.role === 'learner' ? <LearnerShell session={session} /> : <AdminShell session={session} />}
    </div>
  );
}
