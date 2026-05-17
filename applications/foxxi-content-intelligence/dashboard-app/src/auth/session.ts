/**
 * Demo identity for the Foxxi dashboard.
 *
 * In production this is replaced with the substrate's real auth flow
 * (DID-resolution, SIWE / WebAuthn, did:web / did:ethr). For the
 * dashboard demo we let the user pick a role + a sample identity from
 * the Acme Training Co tenant roster so they can click around as
 * different audience members.
 *
 * The session shape mirrors what the substrate's downstream APIs
 * expect: a stable `webId` (used as the learner_did argument on the
 * bridge), an audience-tags array (so the dashboard can show a hint
 * about which policies will match), and the active role (which
 * top-level shell to render).
 */

import { SAMPLE_ADMIN_PAYLOAD } from '../sample/data.js';

export type SessionRole = 'learner' | 'admin';

export interface FoxxiSession {
  role: SessionRole;
  webId: string;
  name: string;
  audienceTags: string[];
  tenantPodUrl: string;
}

export interface SessionOption {
  webId: string;
  name: string;
  jobTitle: string;
  department: string;
  audienceTags: string[];
}

const STORAGE_KEY = 'foxxi:session';

export function loadSession(): FoxxiSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FoxxiSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: FoxxiSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function adminSessionOption(): SessionOption {
  const m = SAMPLE_ADMIN_PAYLOAD.meta;
  return {
    webId: m.admin_user_web_id,
    name: m.admin_user_name,
    jobTitle: m.admin_user_role,
    department: 'L&D / Administration',
    audienceTags: ['admin'],
  };
}

/**
 * Learner-side options: pick from the Acme Training Co roster, prioritised
 * to show interesting audience-tag membership for demoing the
 * enrollment-discovery flow. Returns ~12 representative users.
 */
export function learnerSessionOptions(): SessionOption[] {
  const interesting = new Set([
    'u-joshua', // Joshua Liu — engineering (golf-explained required)
    'u-le', // Ngozi Kowalski — engineering + manager
    'u0062', // Heather Zhang — engineer + manager
    'u0001', // Jessica Torres — CEO (mostly only required-of-all)
    'u0021', // Annie Johnson — actor in audit log entries
    'u0107', // Compliance & Standards member
    'u0145', // Commercial dept
  ]);
  const picks: SessionOption[] = [];
  for (const id of interesting) {
    const u = SAMPLE_ADMIN_PAYLOAD.users.find(x => x.user_id === id);
    if (u) picks.push({
      webId: u.web_id,
      name: u.name,
      jobTitle: u.job_title,
      department: u.department,
      audienceTags: u.audience_tags,
    });
  }
  // Round out the list with a few additional users.
  for (const u of SAMPLE_ADMIN_PAYLOAD.users) {
    if (interesting.has(u.user_id)) continue;
    if (picks.length >= 12) break;
    picks.push({
      webId: u.web_id,
      name: u.name,
      jobTitle: u.job_title,
      department: u.department,
      audienceTags: u.audience_tags,
    });
  }
  return picks;
}

export function sessionFromOption(opt: SessionOption, role: SessionRole, tenantPodUrl: string): FoxxiSession {
  return {
    role,
    webId: opt.webId,
    name: opt.name,
    audienceTags: opt.audienceTags,
    tenantPodUrl,
  };
}
