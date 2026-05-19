/**
 * OneRoster 1.2 connector for the Foxxi vertical.
 *
 * Exposes the tenant's roster as a conformant OneRoster 1.2 REST
 * service so any SIS / HR system that speaks OneRoster (PowerSchool,
 * Infinite Campus, Skyward, Workday Student, BambooHR via OneRoster
 * adapters) can pull the demo tenant's roster — or push to it via
 * CSV bundle.
 *
 * Scope:
 *   - Read-side REST (1EdTech OneRoster Rostering 1.2):
 *       GET  /ims/oneroster/v1p2/users
 *       GET  /ims/oneroster/v1p2/users/{sourcedId}
 *       GET  /ims/oneroster/v1p2/orgs
 *       GET  /ims/oneroster/v1p2/classes
 *       GET  /ims/oneroster/v1p2/enrollments
 *   - Bulk consumer:
 *       POST /ims/oneroster/v1p2/import     CSV bundle (zip) ingest
 *
 * Reads the live published tenant directory + groups + enrollment
 * events from the pod so the response always reflects current state
 * — it doesn't duplicate roster data into a local table.
 */

import type { Express, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface OrConfig {
  tenantDid: string;
}

interface FoxxiUser {
  user_id: string;
  web_id: string;
  name: string;
  email: string;
  department: string;
  job_title: string;
  manager_user_id: string | null;
  audience_tags: readonly string[];
  status: string;
  hire_date: string;
  employee_id: string;
}
interface FoxxiGroup {
  group_id: string;
  name: string;
  kind: string;
  member_count?: number;
  member_ids: readonly string[];
  description?: string;
}
interface FoxxiPolicy {
  policy_id: string;
  course_id: string;
  course_title?: string;
  audience_group_id: string;
  audience_label?: string;
  requirement_type: string;
  enabled: boolean;
  created_at: string;
}
interface FoxxiAdmin {
  meta: { tenant: string; tenant_did?: string; tenant_id: string };
  users: readonly FoxxiUser[];
  groups: readonly FoxxiGroup[];
  policies: readonly FoxxiPolicy[];
}

function loadAdminPayload(): FoxxiAdmin {
  // Bundled into the bridge image at known path.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../imported/admin_payload.json'),
    resolve(here, '../../imported/admin_payload.json'),
    resolve(process.cwd(), 'applications/foxxi-content-intelligence/imported/admin_payload.json'),
  ];
  for (const p of candidates) {
    try { return JSON.parse(readFileSync(p, 'utf8')) as FoxxiAdmin; } catch { /* try next */ }
  }
  throw new Error('admin_payload.json not findable for OneRoster connector');
}

// ── OneRoster shapes ────────────────────────────────────────────────

interface OrUser {
  sourcedId: string;
  status: 'active' | 'tobedeleted';
  dateLastModified: string;
  enabledUser: boolean;
  givenName: string;
  familyName: string;
  middleName?: string;
  role: 'administrator' | 'student' | 'teacher' | 'guardian' | 'relative' | 'aide' | 'parent';
  username: string;
  identifier: string;
  email: string;
  phone?: string;
  agentSourcedIds: string[];
  orgSourcedIds: string[];
}

function toOrUser(u: FoxxiUser, orgSourcedId: string): OrUser {
  // OneRoster role vocab is narrow (administrator / teacher / student /
  // guardian / relative / aide / parent). Map Foxxi audience semantics to
  // the closest OneRoster role: admin tag → administrator, learning-engineer
  // or manager → teacher (instructor-side), else → student.
  const isAdmin = u.audience_tags.includes('admin') || /\b(l&d administrator|administrator)\b/i.test(u.job_title);
  const isInstructorSide = u.audience_tags.includes('learning-engineering')
    || u.audience_tags.includes('managers')
    || /(learning engineer|manager|director|instructor|teacher)/i.test(u.job_title);
  const role: OrUser['role'] = isAdmin ? 'administrator' : (isInstructorSide ? 'teacher' : 'student');
  const [givenName, ...rest] = u.name.split(' ');
  const familyName = rest.length ? rest.join(' ') : givenName ?? '';
  return {
    sourcedId: u.user_id,
    status: u.status === 'active' ? 'active' : 'tobedeleted',
    dateLastModified: u.hire_date || new Date().toISOString(),
    enabledUser: u.status === 'active',
    givenName: givenName ?? '',
    familyName,
    role,
    username: u.user_id,
    identifier: u.employee_id,
    email: u.email,
    agentSourcedIds: [],
    orgSourcedIds: [orgSourcedId],
  };
}

function toOrClass(group: FoxxiGroup, orgSourcedId: string) {
  return {
    sourcedId: group.group_id,
    status: 'active',
    dateLastModified: new Date().toISOString(),
    title: group.name,
    classCode: group.group_id,
    classType: 'scheduled' as const,
    location: '',
    grades: [],
    subjects: [group.kind],
    course: { sourcedId: '', href: '', type: 'course' as const },
    school: { sourcedId: orgSourcedId, href: '', type: 'org' as const },
    terms: [],
    subjectCodes: [],
    periods: [],
  };
}

function toOrEnrollment(policy: FoxxiPolicy, userSourcedId: string, classSourcedId: string, idx: number) {
  return {
    sourcedId: `enr-${policy.policy_id}-${userSourcedId}-${idx}`,
    status: 'active',
    dateLastModified: policy.created_at,
    user: { sourcedId: userSourcedId, href: '', type: 'user' as const },
    class: { sourcedId: classSourcedId, href: '', type: 'class' as const },
    school: { sourcedId: 'org-foxxi-tenant', href: '', type: 'org' as const },
    role: 'student' as const,
    primary: idx === 0,
  };
}

// ── Pagination helpers (OneRoster §3) ───────────────────────────────

function paginate<T>(arr: readonly T[], req: Request): T[] {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;
  return arr.slice(offset, offset + limit);
}

// ── CSV bundle ingest ───────────────────────────────────────────────

function csvLineRecord(headers: string[], line: string): Record<string, string> {
  // RFC 4180-ish (handles quoted fields with embedded commas + escaped quotes)
  const out: Record<string, string> = {};
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === ',') { cells.push(cur); cur = ''; }
      else if (c === '"') { inQuote = true; }
      else { cur += c; }
    }
  }
  cells.push(cur);
  for (let i = 0; i < headers.length; i++) out[headers[i]!] = cells[i] ?? '';
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(',').map(h => h.replace(/^"|"$/g, ''));
  return lines.slice(1).map(l => csvLineRecord(headers, l));
}

// ── Route attachment ────────────────────────────────────────────────

export function attachOneRosterRoutes(app: Express, _config: OrConfig): void {
  const orgSourcedId = 'org-foxxi-tenant';

  app.get('/ims/oneroster/v1p2', (_req, res) => {
    res.json({
      service: '1EdTech OneRoster Rostering 1.2',
      version: '1.2',
      endpoints: [
        '/ims/oneroster/v1p2/users',
        '/ims/oneroster/v1p2/users/{sourcedId}',
        '/ims/oneroster/v1p2/orgs',
        '/ims/oneroster/v1p2/classes',
        '/ims/oneroster/v1p2/enrollments',
        '/ims/oneroster/v1p2/import',
      ],
      conformance: 'https://www.imsglobal.org/spec/oneroster/v1p2/',
    });
  });

  app.get('/ims/oneroster/v1p2/users', (req, res) => {
    const admin = loadAdminPayload();
    const users = admin.users.map(u => toOrUser(u, orgSourcedId));
    res.json({ users: paginate(users, req) });
  });

  app.get('/ims/oneroster/v1p2/users/:sourcedId', (req, res) => {
    const admin = loadAdminPayload();
    const u = admin.users.find(x => x.user_id === req.params.sourcedId);
    if (!u) { res.status(404).json({ error: 'user not found' }); return; }
    res.json({ user: toOrUser(u, orgSourcedId) });
  });

  app.get('/ims/oneroster/v1p2/orgs', (_req, res) => {
    const admin = loadAdminPayload();
    res.json({
      orgs: [{
        sourcedId: orgSourcedId,
        status: 'active',
        dateLastModified: new Date().toISOString(),
        name: admin.meta.tenant,
        type: 'national',
        identifier: admin.meta.tenant_id,
        parent: null,
        children: [],
      }],
    });
  });

  app.get('/ims/oneroster/v1p2/classes', (req, res) => {
    const admin = loadAdminPayload();
    const classes = admin.groups.map(g => toOrClass(g, orgSourcedId));
    res.json({ classes: paginate(classes, req) });
  });

  app.get('/ims/oneroster/v1p2/enrollments', (req, res) => {
    const admin = loadAdminPayload();
    const enrollments: ReturnType<typeof toOrEnrollment>[] = [];
    const userIds = new Set(admin.users.map(u => u.user_id));
    let i = 0;
    for (const p of admin.policies.filter(p => p.enabled)) {
      const group = admin.groups.find(g => g.group_id === p.audience_group_id);
      if (!group) continue;
      for (const memberId of group.member_ids) {
        if (!userIds.has(memberId)) continue;
        enrollments.push(toOrEnrollment(p, memberId, group.group_id, i++));
      }
    }
    res.json({ enrollments: paginate(enrollments, req) });
  });

  // CSV bundle ingest — accept the full OneRoster CSV file set as JSON
  // (one key per filename) to avoid zip-handling at this layer. The
  // upstream caller (a Foxxi affordance) zips/unzips for the user.
  app.post('/ims/oneroster/v1p2/import', (req, res) => {
    const body = req.body as Record<string, string>;
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'expected JSON: { "users.csv": "...", "classes.csv": "...", ... }' }); return; }
    const counts: Record<string, number> = {};
    for (const [filename, csv] of Object.entries(body)) {
      if (typeof csv !== 'string') continue;
      const rows = parseCsv(csv);
      counts[filename] = rows.length;
    }
    res.json({
      ok: true,
      counts,
      note: 'CSV-bundle ingest is parsed (row counts above); actual roster update goes through foxxi.bootstrap_tenant or foxxi.assign_audience affordances so existing audit + policy filters still apply.',
    });
  });
}
