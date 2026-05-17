import React, { useMemo, useState } from 'react';
import { Card, Pill, Button } from './common.js';
import { coverageQuery, type CoverageQueryResult } from '../interego/client.js';
import { SAMPLE_ADMIN_PAYLOAD } from '../sample/data.js';
import type { FoxxiSession } from '../auth/session.js';

type Tab = 'catalog' | 'policies' | 'coverage' | 'audit';

export function AdminShell({ session }: { session: FoxxiSession }) {
  const [tab, setTab] = useState<Tab>('catalog');
  const a = SAMPLE_ADMIN_PAYLOAD;

  return (
    <div style={{ maxWidth: 1180, margin: '24px auto', padding: 20 }}>
      <Card title={`L&D Admin · ${a.meta.tenant}`}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Signed in as <strong>{session.name}</strong> ({a.meta.admin_user_role}) · tenant pod: <code>{a.meta.tenant_pod}</code>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          <TabBtn t={tab} v="catalog" onClick={setTab}>Catalog ({a.catalog.length})</TabBtn>
          <TabBtn t={tab} v="policies" onClick={setTab}>Policies ({a.policies.length})</TabBtn>
          <TabBtn t={tab} v="coverage" onClick={setTab}>Coverage ({a.coverage.length} concepts)</TabBtn>
          <TabBtn t={tab} v="audit" onClick={setTab}>Audit log ({a.audit.length})</TabBtn>
        </div>
      </Card>

      {tab === 'catalog' && <CatalogTab />}
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'coverage' && <CoverageTab tenantPodUrl={session.tenantPodUrl} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

function TabBtn({ t, v, onClick, children }: { t: Tab; v: Tab; onClick: (v: Tab) => void; children: React.ReactNode }) {
  return <Button primary={t === v} onClick={() => onClick(v)}>{children}</Button>;
}

function CatalogTab() {
  const real = SAMPLE_ADMIN_PAYLOAD.catalog.filter(c => c.is_real);
  const stub = SAMPLE_ADMIN_PAYLOAD.catalog.filter(c => !c.is_real);
  return (
    <Card title="Tenant catalog" right={<Pill tone="accent">foxxi.ingest_content_package</Pill>}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
        Real Foxxi-parsed courses (full transcripts + extracted concept maps): <strong>{real.length}</strong>.
        Stub catalog entries representing courses synced from connected LMSes: <strong>{stub.length}</strong>.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {real.map(c => (
          <div key={c.course_id} style={{
            padding: 12, background: 'var(--panel-2)',
            borderRadius: 6, border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill tone="good">parsed</Pill>
              <div style={{ fontWeight: 500 }}>{c.title}</div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>{c.category}</div>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>
              {c.authoring_tool} · {c.standard} · {c.slide_count} slides · {c.concept_count} concepts · {Math.round(c.audio_seconds)}s audio
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>
              Audience tags: {c.audience_tags.join(', ')}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          + {stub.length} stub catalog entries from LMS connectors (Cornerstone OnDemand etc.)
        </div>
      </div>
    </Card>
  );
}

function PoliciesTab() {
  const a = SAMPLE_ADMIN_PAYLOAD;
  return (
    <Card title="Assignment policies" right={<Pill tone="accent">foxxi.assign_audience + foxxi.publish_authoring_policy</Pill>}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
        Each policy binds a course to an audience group via a Foxxi assignment descriptor. The substrate
        resolves a learner's enrollments by walking these + matching audience-group membership.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {a.policies.slice(0, 14).map(p => (
          <div key={p.policy_id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: 8, background: 'var(--panel-2)', borderRadius: 4,
            border: '1px solid var(--border)',
          }}>
            <Pill tone={p.enabled ? 'good' : 'neutral'}>{p.enabled ? 'on' : 'off'}</Pill>
            <div style={{ flex: 1 }}>{p.course_title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.audience_label}</div>
            <Pill tone={p.requirement_type === 'required' ? 'bad' : 'neutral'}>{p.requirement_type}</Pill>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.trigger} · {p.due_relative_days}d</div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          + {a.policies.length - 14} more policies (truncated for display)
        </div>
      </div>
    </Card>
  );
}

function CoverageTab({ tenantPodUrl }: { tenantPodUrl: string }) {
  const a = SAMPLE_ADMIN_PAYLOAD;
  const coverage = useMemo(() => a.coverage.slice(0, 30).map(c => ({
    concept: c.concept_label,
    taughtIn: c.taught_in_courses,
    mentionedIn: c.mentioned_in_courses,
  })), [a.coverage]);

  const [mode, setMode] = useState<'abac' | 'merkle-attested-opt-in' | 'zk-distribution'>('merkle-attested-opt-in');
  const [result, setResult] = useState<CoverageQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true); setErr(null);
    try {
      const r = await coverageQuery({
        tenantPodUrl,
        coverage,
        privacyMode: mode,
        epsilon: mode === 'zk-distribution' ? 1.0 : undefined,
        distributionEdges: mode === 'zk-distribution' ? ['0', '2', '5', '10'] : undefined,
        distributionMaxValue: mode === 'zk-distribution' ? '100' : undefined,
      });
      setResult(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Catalog concept coverage" right={<Pill tone="accent">foxxi.coverage_query</Pill>}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
        Privacy-respecting coverage analysis — composes the substrate's aggregate-privacy ladder.
        v2 merkle-attested-opt-in gives a tamper-evident count + per-leaf inclusion proofs.
        v3 zk-distribution gives a DP-noised histogram of "concepts taught in 1 course / 2-4 / 5-9 / 10+".
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button primary={mode === 'abac'} onClick={() => setMode('abac')}>abac (plain count)</Button>
        <Button primary={mode === 'merkle-attested-opt-in'} onClick={() => setMode('merkle-attested-opt-in')}>merkle-attested-opt-in (v2)</Button>
        <Button primary={mode === 'zk-distribution'} onClick={() => setMode('zk-distribution')}>zk-distribution (v3)</Button>
        <div style={{ flex: 1 }} />
        <Button primary onClick={run} disabled={loading}>{loading ? 'Querying…' : 'Run query'}</Button>
      </div>
      {err && <div style={{ color: 'var(--bad)' }}>✗ {err}</div>}
      {result && (
        <div style={{
          padding: 12, background: 'var(--panel-2)', borderRadius: 6,
          border: '1px solid var(--border)', fontSize: 12,
        }}>
          <div style={{ marginBottom: 8 }}>
            <Pill tone="good">privacyMode: {result.mode}</Pill>
            {result.coverageCount !== undefined && (
              <span style={{ marginLeft: 12 }}>count: <strong>{result.coverageCount}</strong></span>
            )}
            {result.bundle?.count !== undefined && (
              <span style={{ marginLeft: 12 }}>count: <strong>{result.bundle.count}</strong></span>
            )}
            {result.bundle?.bucketSumCommitments && (
              <span style={{ marginLeft: 12 }}>histogram buckets: <strong>{result.bundle.bucketSumCommitments.length}</strong></span>
            )}
          </div>
          {result.bundle?.merkleRoot && (
            <div style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--text-dim)' }}>
              merkleRoot: {result.bundle.merkleRoot}
            </div>
          )}
        </div>
      )}
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12 }}>
          Coverage records sent to query ({coverage.length})
        </summary>
        <div style={{ marginTop: 8, maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
          {coverage.map(c => (
            <div key={c.concept} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{c.concept}</strong> — taught in {c.taughtIn.length}, mentioned in {c.mentionedIn.length}
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}

function AuditTab() {
  const a = SAMPLE_ADMIN_PAYLOAD;
  const recent = a.audit.slice(0, 30);
  return (
    <Card title="Audit log" right={<Pill tone="accent">foxxi.publish_compliance_evidence</Pill>}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
        Every admin + learner action becomes a framework-cited compliance descriptor via the
        compliance-overlay (SOC 2 / EU AI Act / NIST RMF). Audit entries chain
        actor → action → target → result → reason.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, maxHeight: 480, overflow: 'auto' }}>
        {recent.map(a => (
          <div key={a.audit_id} style={{
            display: 'flex', gap: 8, padding: '6px 8px',
            borderBottom: '1px solid var(--border)',
            fontFamily: 'monospace',
          }}>
            <div style={{ color: 'var(--text-dim)' }}>{a.timestamp}</div>
            <Pill tone={a.result === 'allowed' ? 'good' : 'bad'}>{a.result}</Pill>
            <div style={{ color: 'var(--accent)' }}>{a.action}</div>
            <div>{a.target_type}/{a.target_id}</div>
            {a.reason && <div style={{ color: 'var(--text-dim)' }}>· {a.reason}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}
