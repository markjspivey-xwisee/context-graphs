/**
 * Sample data bundled at build time — the imported Acme Training Co
 * tenant payload from applications/foxxi-content-intelligence/imported/.
 *
 * Vite resolves the JSON imports at build time. The dashboard uses
 * these as the offline fallback when the Foxxi bridge isn't running.
 * When the bridge IS running, this data is sent to the bridge as the
 * `admin` / `course_content` argument of each affordance call (the
 * bridge handlers accept these directly per the in-process invocation
 * contract documented on the bridge's stub handlers).
 */

import adminPayloadJson from '../../../imported/admin_payload.json';
import golf-explainedTranscripts from '../../../imported/transcripts.json';
import golf-explainedDashboard from '../../../imported/dashboard_data.json';
import type { AdminPayload, CourseContent, CourseConcept, CourseTranscript } from '../types.js';

export const SAMPLE_ADMIN_PAYLOAD = adminPayloadJson as unknown as AdminPayload;

const ACME_TENANT_DID = 'did:web:acme-training.example';

function golf-explainedCourse(): CourseContent {
  return {
    courseIri: 'https://acme-training.example/courses/golf-explained#package',
    title: 'Golf Explained: Golf Rules',
    authoritativeSource: ACME_TENANT_DID,
    transcripts: golf-explainedTranscripts as unknown as Record<string, CourseTranscript>,
    concepts: (golf-explainedDashboard as unknown as { concepts: CourseConcept[] }).concepts,
  };
}

export const SAMPLE_LESSON_PAYLOADS: Record<string, CourseContent> = {
  golf-explained: golf-explainedCourse(),
};

export const SAMPLE_TENANT_POD_URL = SAMPLE_ADMIN_PAYLOAD.meta.tenant_pod;
