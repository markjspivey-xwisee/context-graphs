import React, { useEffect, useState } from 'react';
import { Card, Pill, Button } from './common.js';
import { ChatPanel } from './ChatPanel.js';
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
                <EnrollmentRow key={e.policyId} enrollment={e} canOpen={!!getCourseContent(e.courseId)} onOpen={() => setOpenCourseId(e.courseId)} />
              ))}
            </div>
          </div>
        )}
      </Card>

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
              <Card title={courseContent.title}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  Authoritative source: <code>{courseContent.authoritativeSource}</code>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                  Course IRI: <code>{courseContent.courseIri}</code>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                  Transcripts: {Object.keys(courseContent.transcripts).length} · Extracted concepts: {courseContent.concepts.length}
                </div>
                <Button onClick={() => setOpenCourseId(null)} style={{ marginTop: 12 }}>Back to course list</Button>
              </Card>
              <ChatPanel learnerDid={session.webId} course={courseContent} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EnrollmentRow({ enrollment, canOpen, onOpen }: { enrollment: EnrolledCourse; canOpen: boolean; onOpen: () => void }) {
  const tone = enrollment.status === 'completed' ? 'good'
    : enrollment.status === 'overdue' ? 'bad' : 'warn';
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
      <Button onClick={onOpen} disabled={!canOpen} primary={canOpen}>
        {canOpen ? 'Open & ask' : 'Open'}
      </Button>
    </div>
  );
}
