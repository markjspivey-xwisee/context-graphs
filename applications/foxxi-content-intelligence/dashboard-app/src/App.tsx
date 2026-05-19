/**
 * Resource-oriented routing — each URL identifies a resource, not a UI tab.
 *
 *   /login                                       Login screen
 *   /me                                          Canonical self-link → /users/<userId>
 *   /users/:userId                               User profile + their enrollments + audit
 *
 *   /courses                                     Course catalog (collection)
 *   /courses/:courseId                           Course detail (concept graph + slide nav + chat)
 *
 *   /policies                                    Policy collection (admin)
 *   /policies/:policyId                          Single policy (admin)
 *
 *   /groups                                      Audience groups (admin)
 *   /groups/:groupId                             Single group (admin)
 *
 *   /audit                                       Tenant audit log (admin)
 *   /audit/:auditId                              Single audit record (admin)
 *
 *   /coverage                                    Concept coverage analytics (admin)
 *   /integrations                                Connector registry (admin)
 *
 *   /statements                                  xAPI statement collection
 *   /statements/:statementId                     Single statement
 *   /statements/aggregates                       Aggregates view
 *   /statements/conformance                      Profile-conformance view
 *
 *   /lrs-config                                  LRS operator config (admin)
 *
 * Browser back/forward works. Every URL is bookmarkable + shareable.
 * Legacy `/learner` and `/admin/*` URLs redirect to the canonical
 * resource URL for backward-compat with anything that might have
 * been bookmarked before this refactor.
 *
 * nginx falls back to index.html for any unknown path
 * (deploy/Dockerfile.foxxi-dashboard) so the SPA owns the full
 * path space.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Login } from './components/Login.js';
import { LearnerShell } from './components/LearnerShell.js';
import { CatalogTab, PoliciesTab, CoverageTab, AccessTab, IntegrationsTab, AuditTab } from './components/AdminShell.js';
import { LrsAdminPanel } from './components/LrsAdminPanel.js';
import { Header, Card } from './components/common.js';
import { loadSession, saveSession, clearSession, type FoxxiSession } from './auth/session.js';
import { getTransport, resetTransportProbe } from './interego/client.js';
import { SAMPLE_ADMIN_PAYLOAD } from './sample/data.js';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const [session, setSession] = useState<FoxxiSession | null>(loadSession());
  const [transport, setTransport] = useState<'bridge' | 'sample' | 'probing'>('probing');
  const navigate = useNavigate();

  useEffect(() => {
    getTransport().then(setTransport).catch(() => setTransport('sample'));
  }, []);

  function onSignIn(s: FoxxiSession) {
    saveSession(s);
    setSession(s);
    // Land on the user's own resource URL — their canonical self page.
    navigate(`/users/${s.userId}`, { replace: true });
  }
  function onLogout() {
    clearSession();
    resetTransportProbe();
    setSession(null);
    navigate('/login', { replace: true });
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login onSignIn={onSignIn} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = session.role === 'admin';
  const isLe = session.audienceTags?.includes('learning-engineering');
  const isPriv = isAdmin || isLe;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <Header session={session} onLogout={onLogout} transport={transport} />
      <TopNav session={session} />
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/login" element={<Navigate to={`/users/${session.userId}`} replace />} />
          <Route path="/me" element={<Navigate to={`/users/${session.userId}`} replace />} />
          <Route path="/users/:userId" element={<UserPage session={session} />} />

          <Route path="/courses" element={<CoursesPage session={session} />} />
          <Route path="/courses/:courseId" element={<CourseDetailPage session={session} />} />

          {isPriv && <Route path="/policies" element={<PoliciesPage />} />}
          {isPriv && <Route path="/policies/:policyId" element={<PoliciesPage />} />}
          {isPriv && <Route path="/groups" element={<GroupsPage />} />}
          {isPriv && <Route path="/groups/:groupId" element={<GroupsPage />} />}
          {isPriv && <Route path="/audit" element={<AuditPage />} />}
          {isPriv && <Route path="/audit/:auditId" element={<AuditPage />} />}
          {isPriv && <Route path="/coverage" element={<CoveragePage session={session} />} />}
          {isPriv && <Route path="/integrations" element={<IntegrationsPage />} />}
          {isPriv && <Route path="/statements" element={<StatementsPage session={session} />} />}
          {isPriv && <Route path="/statements/:statementSub" element={<StatementsPage session={session} />} />}
          {isPriv && <Route path="/lrs-config" element={<StatementsPage session={session} />} />}

          {/* Legacy redirects (old bookmarks) */}
          <Route path="/learner" element={<Navigate to={`/users/${session.userId}`} replace />} />
          <Route path="/learner/courses/:courseId" element={<RedirectCourse />} />
          <Route path="/admin" element={<Navigate to="/courses" replace />} />
          <Route path="/admin/catalog" element={<Navigate to="/courses" replace />} />
          <Route path="/admin/policies" element={<Navigate to="/policies" replace />} />
          <Route path="/admin/coverage" element={<Navigate to="/coverage" replace />} />
          <Route path="/admin/access" element={<Navigate to="/groups" replace />} />
          <Route path="/admin/integrations" element={<Navigate to="/integrations" replace />} />
          <Route path="/admin/audit" element={<Navigate to="/audit" replace />} />
          <Route path="/admin/lrs/statements" element={<Navigate to="/statements" replace />} />
          <Route path="/admin/lrs/aggregates" element={<Navigate to="/statements/aggregates" replace />} />
          <Route path="/admin/lrs/conformance" element={<Navigate to="/statements/conformance" replace />} />
          <Route path="/admin/lrs/config" element={<Navigate to="/lrs-config" replace />} />
          <Route path="/admin/:any" element={<Navigate to="/courses" replace />} />
          <Route path="/admin/lrs/:any" element={<Navigate to="/statements" replace />} />

          <Route path="/" element={<Navigate to={`/users/${session.userId}`} replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      <Footer session={session} transport={transport} />
    </div>
  );
}

// ── Per-resource page components ────────────────────────────────────

function TopNav({ session }: { session: FoxxiSession }) {
  const isAdmin = session.role === 'admin';
  const isLe = session.audienceTags?.includes('learning-engineering');
  const isPriv = isAdmin || isLe;
  const location = useLocation();
  const active = (path: string) =>
    location.pathname === path || (path !== '/' && location.pathname.startsWith(path + '/')) || (path === `/users/${session.userId}` && location.pathname === '/me');
  const NavLink = ({ to, label }: { to: string; label: string }) => (
    <a href={to}
      onClick={e => { e.preventDefault(); history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }}
      style={{
        padding: '6px 12px', borderRadius: 4,
        background: active(to) ? 'var(--accent)' : 'transparent',
        color: active(to) ? 'white' : 'var(--text)',
        fontSize: 13, fontWeight: 500, textDecoration: 'none',
      }}>{label}</a>
  );
  return (
    <nav style={{
      padding: '8px 24px', background: 'var(--panel)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
      position: 'sticky', top: 65, zIndex: 40,
    }}>
      <NavLink to={`/users/${session.userId}`} label="My profile" />
      <NavLink to="/courses" label="Courses" />
      {isPriv && <span style={{ width: 12 }} />}
      {isPriv && <NavLink to="/policies" label="Policies" />}
      {isPriv && <NavLink to="/groups" label="Groups" />}
      {isPriv && <NavLink to="/audit" label="Audit" />}
      {isPriv && <NavLink to="/coverage" label="Coverage" />}
      {isPriv && <NavLink to="/integrations" label="Integrations" />}
      {isPriv && <NavLink to="/statements" label="xAPI / LRS" />}
    </nav>
  );
}

function UserPage({ session }: { session: FoxxiSession }) {
  const { userId } = useParams();
  // We render the LearnerShell as the user's home page (their enrollments + chat).
  // Future iteration: if the requested userId doesn't match session.userId AND the
  // caller isn't admin, show a 403 page. For now the LearnerShell only fetches
  // the *signed-in* identity's enrollments, so visiting another user's URL just
  // shows your own data — to be tightened.
  void userId;
  return <LearnerShell session={session} />;
}

function CoursesPage({ session }: { session: FoxxiSession }) {
  // The course catalog — visible to all roles.
  return (
    <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}>
      <CatalogTab />
    </div>
  );
}

function CourseDetailPage({ session }: { session: FoxxiSession }) {
  // Reuses LearnerShell's course-detail view by URL-driven openCourseId.
  return <LearnerShell session={session} />;
}

function RedirectCourse() {
  const { courseId } = useParams();
  return <Navigate to={courseId ? `/courses/${courseId}` : '/courses'} replace />;
}

function PoliciesPage() {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><PoliciesTab /></div>;
}
function GroupsPage() {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><AccessTab /></div>;
}
function AuditPage() {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><AuditTab /></div>;
}
function CoveragePage({ session }: { session: FoxxiSession }) {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><CoverageTab tenantPodUrl={session.tenantPodUrl} /></div>;
}
function IntegrationsPage() {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><IntegrationsTab /></div>;
}
function StatementsPage({ session }: { session: FoxxiSession }) {
  return <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}><LrsAdminPanel bearer={session.bearerToken} /></div>;
}

function NotFound() {
  return (
    <div style={{ maxWidth: 720, margin: '60px auto', padding: 20 }}>
      <Card title="Not found">
        <div style={{ color: 'var(--text-dim)' }}>
          The URL you're looking at doesn't map to any known resource. Check the address bar,
          or jump back to <a href="/me">your profile</a>.
        </div>
      </Card>
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
