import React, { useEffect, useState } from 'react';
import { Card, Pill, Button, Stat } from './common.js';
import { ChatPanel } from './ChatPanel.js';
import { SlideNavigator } from './SlideNavigator.js';
import { ConceptNetwork } from './ConceptNetwork.js';
import { LrsAdminPanel } from './LrsAdminPanel.js';
import { discoverAssignedCourses, getCourseContent, type DiscoverAssignedCoursesResult } from '../interego/client.js';
import type { CourseContent, EnrolledCourse } from '../types.js';
import type { FoxxiSession } from '../auth/session.js';

export function LearnerShell({ session }: { session: FoxxiSession }) {
  const [enrollments, setEnrollments] = useState<DiscoverAssignedCoursesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await discoverAssignedCourses({
          learnerWebId: session.webId,
          tenantPodUrl: session.tenantPodUrl,
        });
        if (!cancelled) setEnrollments(r);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [session.webId, session.tenantPodUrl]);

  const courseContent: CourseContent | undefined =
    openCourseId ? getCourseContent(openCourseId) : undefined;
  const [navConceptId, setNavConceptId] = useState<string | null>(null);
  const [navSlideId, setNavSlideId] = useState<string | null>(null);

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', padding: 20 }}>
      <Card title={`Welcome, ${session.name}`}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Audience tags: {session.audienceTags.map(t => (
            <span key={t} style={{ marginRight: 6 }}><Pill>{t}</Pill></span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
          Identity: <code>{session.webId}</code>
        </div>
      </Card>

      <Card title="Your assigned courses" right={<Pill tone="accent">foxxi.discover_assigned_courses</Pill>}>
        {error && <div style={{ color: 'var(--bad)' }}>✗ {error}</div>}
        {!enrollments && !error && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
        {enrollments && enrollments.enrollments.length === 0 && (
          <div style={{ color: 'var(--text-dim)' }}>
            No assignments matched your audience tags. (The L&D admin assigns courses via policy descriptors
            that target audience groups — your tags determine which apply.)
          </div>
        )}
        {enrollments && enrollments.enrollments.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
              Substrate matched {enrollments.enrollments.length} policy assignment{enrollments.enrollments.length === 1 ? '' : 's'} for your audience tags.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {enrollments.enrollments.map(e => (
                <EnrollmentRow key={e.policyId} enrollment={e} canOpen={!!getCourseContent(e.courseId)} onOpen={() => setOpenCourseId(e.courseId)} session={session} />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Learning engineers get the same LRS-admin view as L&D admins — cohort
          analytics + xAPI conformance + statement browsing is the LE's core
          surface (the ICICLE "data-informed decision making" leg). */}
      {session.audienceTags?.includes('learning-engineering') && (
        <LrsAdminPanel bearer={session.bearerToken} />
      )}

      {openCourseId && (
        <div>
          {!courseContent ? (
            <Card title={`Course content unavailable for ${openCourseId}`}>
              <div style={{ color: 'var(--text-dim)' }}>
                The dashboard ships sample course content only for lessons that the parser has fully
                processed (golf-explained by default). In a production deployment the substrate fetches the
                parsed course via <code>discover_context</code> against the tenant pod's published
                fxs/fxk descriptors.
              </div>
              <Button onClick={() => setOpenCourseId(null)} style={{ marginTop: 12 }}>Back</Button>
            </Card>
          ) : (
            <>
              <Card title={courseContent.title}
                right={<Button small onClick={() => setOpenCourseId(null)}>← Course list</Button>}>
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  Authoritative source: <code>{courseContent.authoritativeSource}</code>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                  Course IRI: <code>{courseContent.courseIri}</code>
                </div>
                {courseContent.packageMeta && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                    {courseContent.packageMeta.authoring_tool}
                    {courseContent.packageMeta.standard && <> · {courseContent.packageMeta.standard}</>}
                    {courseContent.packageMeta.authoring_version && <> · v{courseContent.packageMeta.authoring_version}</>}
                    {courseContent.packageMeta.parser_version && <> · parser {courseContent.packageMeta.parser_version}</>}
                  </div>
                )}
                {/* Stat strip — mirrors the originals' SCENES / SLIDES / CONCEPTS / EDGES / MOD-OF strip */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                  gap: 12, marginTop: 16,
                }}>
                  <Stat label="Scenes" value={courseContent.scenes?.length ?? '—'} />
                  <Stat label="Slides" value={courseContent.slides?.length ?? '—'} />
                  <Stat label="Concepts" value={courseContent.concepts.length} tone="accent" />
                  <Stat label="Prereq edges" value={courseContent.prereqEdges?.length ?? '—'} />
                  <Stat label="Transcripts" value={Object.keys(courseContent.transcripts).length} />
                </div>
              </Card>
              <ConceptNetwork
                concepts={courseContent.concepts}
                prereqEdges={courseContent.prereqEdges ?? []}
                slides={courseContent.slides ?? []}
                selectedSlideId={navSlideId}
                selectedConceptId={navConceptId}
                onSelectConcept={setNavConceptId}
                onJumpToSlide={sid => setNavSlideId(sid)}
              />
              <SlideNavigator
                course={courseContent}
                externalSelectedSlideId={navSlideId}
                externalSelectedConceptId={navConceptId}
                onSlideChange={setNavSlideId}
                onConceptChange={setNavConceptId}
              />
              <ChatPanel learnerDid={session.webId} course={courseContent} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const SCORM_PLAYER_BASE = 'https://interego-foxxi-scorm-player.livelysky-8b81abb0.eastus.azurecontainerapps.io';
const BRIDGE_BASE_FOR_PLAYER = import.meta.env.VITE_FOXXI_BRIDGE_URL ?? 'https://interego-foxxi-bridge.livelysky-8b81abb0.eastus.azurecontainerapps.io';

function buildPlayerUrl(courseId: string, session: { webId: string; name: string; bearerToken: string }): string {
  const u = new URL(SCORM_PLAYER_BASE);
  u.searchParams.set('bridge', BRIDGE_BASE_FOR_PLAYER);
  u.searchParams.set('bearer', session.bearerToken);
  u.searchParams.set('learner_did', session.webId);
  u.searchParams.set('learner_name', session.name);
  u.searchParams.set('course_id', courseId);
  return u.toString();
}

function EnrollmentRow({ enrollment, canOpen, onOpen, session }: { enrollment: EnrolledCourse; canOpen: boolean; onOpen: () => void; session?: FoxxiSession }) {
  const tone = enrollment.status === 'completed' ? 'good'
    : enrollment.status === 'overdue' ? 'bad' : 'warn';
  const playable = enrollment.courseId === 'golf-explained';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 12, background: 'var(--panel-2)',
      borderRadius: 6, border: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{enrollment.courseTitle}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
          {enrollment.category} · assigned {enrollment.assignedAt} · due {enrollment.dueAt || '—'}
        </div>
      </div>
      <Pill tone={enrollment.requirementType === 'required' ? 'bad' : 'neutral'}>
        {enrollment.requirementType}
      </Pill>
      <Pill tone={tone}>{enrollment.status}{enrollment.completedAt ? ` · ${enrollment.completedAt}` : ''}</Pill>
      {playable && session && (
        <Button
          primary
          onClick={() => window.open(buildPlayerUrl(enrollment.courseId, session), '_blank', 'noopener')}
          title="Open the SCORM course in a new tab. The player emits live xAPI statements to Foxxi-as-LRS."
        >
          ▶ Launch
        </Button>
      )}
      <Button onClick={onOpen} disabled={!canOpen} primary={!playable && canOpen}>
        {canOpen ? 'Open & ask' : 'Open'}
      </Button>
    </div>
  );
}
