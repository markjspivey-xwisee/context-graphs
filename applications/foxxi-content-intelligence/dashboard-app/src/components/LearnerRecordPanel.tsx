/**
 * Learner Record panel — the IEEE P2997 Enterprise Learner Record view.
 *
 * Surfaces the learner's unified, provenance-pointed record assembled by
 * the `foxxi.assemble_learner_record` affordance: learning experiences
 * (from Foxxi-as-LRS), competencies (Asserted from verified credentials,
 * Hypothetical when merely inferred), conferred credentials, the
 * organisations in the learner's path, and — the P2997 hallmark —
 * explicit pointers to where each class of raw data is stored.
 *
 * Hypermedia-driven: looks the affordance up on the entry point and
 * invokes it; no hardcoded bridge URL.
 */

import React, { useEffect, useState } from 'react';
import { Card, Pill, Button, Stat } from './common.js';
import { useAffordance, useHypermedia, invokeAffordance } from '../hypermedia.js';
import type { FoxxiSession } from '../auth/session.js';

interface ElrExperience {
  id: string; verb: string; verbDisplay: string;
  activityId: string; activityName?: string; timestamp: string;
  modalStatus: 'Asserted'; rawDataLocation: string;
}
interface ElrCompetency {
  id: string; label: string; modalStatus: 'Asserted' | 'Hypothetical';
  framework?: string; proficiencyLevel?: string; evidence: string[];
}
interface ElrCredential {
  id: string; achievementName?: string; issuer: string;
  verified: boolean; rawDataLocation: string;
}
interface ElrRawDataLocation { kind: string; location: string; description: string }
interface ElrOrganization { id: string; role: string }
interface EnterpriseLearnerRecord {
  id: string;
  conformsTo: string;
  learner: { did: string; name?: string };
  assembledAt: string;
  organizationPath: ElrOrganization[];
  experiences: ElrExperience[];
  competencies: ElrCompetency[];
  credentials: ElrCredential[];
  provenance: { rawDataLocations: ElrRawDataLocation[] };
  summary: {
    experienceCount: number; credentialCount: number; verifiedCredentialCount: number;
    competencyCount: number; assertedCompetencies: number; inferredCompetencies: number;
  };
}

export function LearnerRecordPanel({ session }: { session: FoxxiSession }) {
  const affordance = useAffordance('foxxi.assemble_learner_record');
  const { bearer, entry } = useHypermedia();
  const [elr, setElr] = useState<EnterpriseLearnerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!affordance || !entry) return;
    let cancel = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const r = await invokeAffordance({
          affordance,
          bearer,
          args: {
            learner_did: session.webId,
            learner_name: session.name,
            learner_pod_url: session.tenantPodUrl,
          },
        }) as EnterpriseLearnerRecord & { error?: string };
        if (cancel) return;
        if (r.error) { setError(r.error); }
        else { setElr(r); }
      } catch (err) {
        if (!cancel) setError((err as Error).message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [affordance, entry, bearer, session.webId, session.name, session.tenantPodUrl, version]);

  return (
    <Card
      title="Your Enterprise Learner Record"
      right={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Pill tone="accent" title="IEEE P2997 — Standard for Enterprise Learner Record (LTSC, ADL-chaired)">IEEE P2997</Pill>
          <Button onClick={() => setVersion(v => v + 1)} disabled={loading}>{loading ? 'Assembling…' : 'Refresh'}</Button>
        </div>
      }
    >
      <div style={{ marginBottom: 14, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.55 }}>
        Your record, unified across sources and <strong>provenance-pointed</strong>: learning experiences from
        Foxxi-as-LRS, credentials from your pod wallet, and competencies tagged{' '}
        <strong>Asserted</strong> (backed by a verified credential) or <strong>inferred</strong> (predicted
        from experience alone — not yet credentialed). Per IEEE P2997 every entry indicates where its raw
        record is stored.
      </div>

      {error && <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 12 }}>✗ {error}</div>}
      {!affordance && !error && (
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          The bridge entry point does not advertise the <code>assemble_learner_record</code> affordance —
          running in offline-sample mode.
        </div>
      )}
      {loading && !elr && <div style={{ color: 'var(--text-dim)' }}>Assembling your record…</div>}

      {elr && (
        <div>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
            <Stat label="Experiences" value={elr.summary.experienceCount} />
            <Stat label="Credentials" value={`${elr.summary.verifiedCredentialCount}/${elr.summary.credentialCount}`} tone="accent" />
            <Stat label="Asserted competencies" value={elr.summary.assertedCompetencies} tone="accent" />
            <Stat label="Inferred competencies" value={elr.summary.inferredCompetencies} />
          </div>

          {/* Organisation path */}
          <Section title="Organisation path">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {elr.organizationPath.map((o, i) => (
                <Pill key={i} tone={o.role === 'tenant' ? 'accent' : 'neutral'} title={o.id}>
                  {shorten(o.id)} · {o.role}
                </Pill>
              ))}
            </div>
          </Section>

          {/* Competencies */}
          <Section title={`Competencies (${elr.competencies.length})`}>
            {elr.competencies.length === 0 && <Empty>No competencies yet — pass or complete a course to earn one.</Empty>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {elr.competencies.map((c, i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ flex: 1, fontSize: 13 }}>{c.label}</span>
                  {c.framework && <Pill tone="neutral">{shorten(c.framework)}</Pill>}
                  <Pill
                    tone={c.modalStatus === 'Asserted' ? 'good' : 'neutral'}
                    title={c.modalStatus === 'Asserted'
                      ? 'cg:modalStatus = Asserted — backed by a verified credential.'
                      : 'cg:modalStatus = Hypothetical — inferred from a passed/completed experience; not yet credentialed.'}
                  >
                    {c.modalStatus === 'Asserted' ? 'credentialed' : 'inferred'}
                  </Pill>
                </div>
              ))}
            </div>
          </Section>

          {/* Credentials */}
          <Section title={`Credentials (${elr.credentials.length})`}>
            {elr.credentials.length === 0 && (
              <Empty>No credentials in your pod wallet yet. An admin issues these via <code>issue_completion_credential</code>; they publish to your pod and verify independently.</Empty>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {elr.credentials.map((c, i) => (
                <div key={i} style={rowStyle}>
                  <span style={{ flex: 1, fontSize: 13 }}>{c.achievementName ?? c.id}</span>
                  <Pill tone="neutral" title={c.issuer}>iss: {shorten(c.issuer)}</Pill>
                  <Pill tone={c.verified ? 'good' : 'bad'}>{c.verified ? 'verified ✓' : 'unverified'}</Pill>
                </div>
              ))}
            </div>
          </Section>

          {/* Experiences */}
          <Section title={`Learning experiences (${elr.experiences.length})`}>
            {elr.experiences.length === 0 && <Empty>No xAPI experiences recorded yet — launch a course to generate some.</Empty>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
              {elr.experiences.slice(0, 50).map((e, i) => (
                <div key={i} style={{ ...rowStyle, fontSize: 12 }}>
                  <code style={{ color: 'var(--accent)' }}>{e.verbDisplay}</code>
                  <span style={{ flex: 1, color: 'var(--text-dim)' }}>{e.activityName ?? shorten(e.activityId)}</span>
                  <span style={{ color: 'var(--text-dim)' }}>{e.timestamp.slice(0, 19).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Provenance — P2997 raw-data-location indications */}
          <Section title="Where your raw data lives (P2997 provenance)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {elr.provenance.rawDataLocations.map((p, i) => (
                <div key={i} style={{ ...rowStyle, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                  <Pill tone="neutral">{p.kind}</Pill>
                  <span style={{ flex: 1, wordBreak: 'break-all', color: 'var(--text-dim)' }}>{p.location}</span>
                </div>
              ))}
            </div>
          </Section>

          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12 }}>
            Conforms to: <code>{elr.conformsTo}</code> · assembled {elr.assembledAt.slice(0, 19).replace('T', ' ')}
          </div>
        </div>
      )}
    </Card>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px', background: 'var(--panel-2)',
  border: '1px solid var(--border)', borderRadius: 4,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>{children}</div>;
}

function shorten(s: string): string {
  if (s.length <= 42) return s;
  return s.slice(0, 22) + '…' + s.slice(-16);
}
