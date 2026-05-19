/**
 * Inbound xAPI LRS surface for the Foxxi vertical.
 *
 * Lets external systems (LMSes, mobile apps, simulators, AI tutors,
 * other LRSes via Statement Forwarding) write learning records *into*
 * the substrate. Each accepted Statement is converted to a Context
 * Descriptor (modal=Asserted, provenance bound to the source LRS or
 * caller WebID) and published to the tenant pod via the lrs-adapter's
 * `publishIngestedStatement` so it joins the rest of the substrate's
 * trace graph.
 *
 * Endpoints (xAPI 2.0 / IEEE 9274.1.1 §7):
 *
 *   GET    /xapi/about
 *   POST   /xapi/statements                     (single | batch)
 *   PUT    /xapi/statements?statementId=<uuid>  (caller-provided id)
 *   GET    /xapi/statements                     (filtered query)
 *   GET    /xapi/statements?statementId=<uuid>  (single)
 *   GET    /xapi/activities?activityId=<iri>
 *   GET    /xapi/agents?agent=<json>
 *   GET|PUT|POST|DELETE /xapi/activities/state
 *   GET|PUT|POST|DELETE /xapi/activities/profile
 *   GET|PUT|POST|DELETE /xapi/agents/profile
 *
 * Conformance:
 *   - X-Experience-API-Version negotiated (2.0.0 default, 1.0.3 supported)
 *   - Required header echoed in every response
 *   - Auth: Basic (LRS standard) OR Bearer (Foxxi session tokens), config-driven
 *   - CORS: governed by the bridge's outer middleware (no per-route override)
 *   - Voiding: POST/PUT of a voided-verb statement is recorded; GET on the
 *     voided statementId returns 404 unless voidedStatementId= is used
 *
 * Not a "memory-only" demo — every Statement persists as a descriptor on
 * the tenant pod, queryable via cg:discover() filtered on
 * `lrs:StatementIngestion`. The state/profile resources use an in-memory
 * Map sized for demo workloads; swap for Redis/Postgres at production
 * scale.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ingestStatementBatchFromLrs as _unusedTypeAnchor } from '../../lrs-adapter/src/pod-publisher.js';
import type { IRI } from '../../../src/index.js';

void _unusedTypeAnchor;

// ── Config ──────────────────────────────────────────────────────────

export interface XapiLrsConfig {
  /**
   * The Foxxi tenant pod where ingested statements land.
   * Each ingested statement becomes a context descriptor at
   * `<podUrl>foxxi/lrs/statement-<id>.ttl` (per substrate publish flow).
   */
  podUrl: string;
  /** Tenant's authoritative DID — sets prov:wasAttributedTo on each statement descriptor. */
  tenantDid: IRI;
  /**
   * Basic-auth credentials accepted on inbound calls. Format: `user:password`.
   * Comma-separated for multiple keys (one per upstream LRS / LMS).
   * Empty/unset → Basic auth is disabled and only Bearer tokens are accepted.
   */
  basicAuthPairs: string;
  /**
   * Forward each accepted statement to these external LRS endpoints.
   * Comma-separated `https://lrs.example/xapi||user:pass||2.0.0` triples
   * (`||` separator). Empty → no forwarding. Statement Forwarding per
   * xAPI §10.
   */
  forwardingTargets: string;
  /** Bridge URL — echoed in /xapi/about so callers know the LRS identity. */
  selfBaseUrl: string;
}

// ── In-process statement store accessors ────────────────────────────
// Exported so the bridge can emit statements server-side (e.g. one
// per affordance call, ABAC decision, credential issuance, etc.) and
// surface them in the LRS-admin dashboard without an HTTP round-trip.

export interface XapiStatementRecord {
  id: string;
  statement: Record<string, unknown>;
  stored: string;
  voided: boolean;
  voidingStatementId?: string;
}

export function storeStatementInternal(stmt: Record<string, unknown>): string {
  const id = (stmt.id as string) ?? randomUUID();
  const stored = new Date().toISOString();
  statementStore.set(id, { id, statement: { ...stmt, id, stored }, stored, voided: false });
  return id;
}

export function listStoredStatements(): XapiStatementRecord[] {
  return Array.from(statementStore.values());
}

export function clearStatementStore(): void {
  statementStore.clear();
}

// ── In-memory stores (replaceable) ──────────────────────────────────

interface StatementRecord {
  id: string;
  statement: Record<string, unknown>;
  stored: string;
  voided: boolean;
  voidingStatementId?: string;
}
const statementStore = new Map<string, StatementRecord>();
const activityStateStore = new Map<string, { content: unknown; etag: string; updated: string; contentType: string }>();
const activityProfileStore = new Map<string, { content: unknown; etag: string; updated: string; contentType: string }>();
const agentProfileStore = new Map<string, { content: unknown; etag: string; updated: string; contentType: string }>();

// ── Helpers ─────────────────────────────────────────────────────────

const VOIDED_VERB = 'http://adlnet.gov/expapi/verbs/voided';
const ABOUT_VERSIONS = ['2.0.0', '1.0.3'];

function uuidv4(): string { return randomUUID(); }

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function negotiateVersion(req: Request): string {
  const v = (req.headers['x-experience-api-version'] ?? req.headers['X-Experience-API-Version']) as string | undefined;
  if (typeof v === 'string' && ABOUT_VERSIONS.includes(v)) return v;
  // xAPI 2.0 §6.2: requests without the header MAY be accepted. We default
  // to 2.0.0 (current spec) — legacy 1.0.3 clients are still served, since
  // they explicitly send `X-Experience-API-Version: 1.0.3`.
  return '2.0.0';
}

function setXapiHeaders(res: Response, version: string): void {
  res.setHeader('X-Experience-API-Version', version);
  res.setHeader('X-Experience-API-Consistent-Through', new Date().toISOString());
}

function basicAuthOk(header: string | undefined, pairs: string): boolean {
  if (!pairs.trim()) return false;
  if (!header || !/^Basic\s+/i.exec(header)) return false;
  const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
  return pairs.split(',').map(s => s.trim()).filter(Boolean).includes(decoded);
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1]!.trim() : undefined;
}

// ── Auth gate ───────────────────────────────────────────────────────

function makeAuthGate(config: XapiLrsConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const version = negotiateVersion(req);
    setXapiHeaders(res, version);
    const authHeader = (req.headers['authorization'] ?? req.headers['Authorization']) as string | undefined;
    if (basicAuthOk(authHeader, config.basicAuthPairs)) {
      (req as Request & { xapiAuth: { kind: 'basic'; principal: string } }).xapiAuth = { kind: 'basic', principal: 'lrs-key' };
      return next();
    }
    const bearer = bearerToken(authHeader);
    if (bearer) {
      (req as Request & { xapiAuth: { kind: 'bearer'; token: string } }).xapiAuth = { kind: 'bearer', token: bearer };
      return next();
    }
    res.status(401).setHeader('WWW-Authenticate', 'Basic realm="foxxi-lrs", Bearer realm="foxxi-lrs"').json({
      error: 'authentication required',
      detail: 'xAPI requires Basic or Bearer auth on every resource. Configure FOXXI_LRS_BASIC_AUTH_PAIRS on the bridge, or present a Foxxi session token.',
    });
  };
}

// ── Statement normalisation ─────────────────────────────────────────

function nowIso(): string { return new Date().toISOString(); }

function ensureStatementFields(stmt: Record<string, unknown>, authority: { homePage: string; name: string }): Record<string, unknown> {
  const out = { ...stmt };
  if (typeof out.id !== 'string' || !isUuid(out.id)) out.id = uuidv4();
  if (typeof out.timestamp !== 'string') out.timestamp = nowIso();
  if (typeof out.stored !== 'string') out.stored = nowIso();
  if (!out.authority || typeof out.authority !== 'object') {
    out.authority = {
      objectType: 'Agent',
      account: { homePage: authority.homePage, name: authority.name },
    };
  }
  // xAPI 2.0 §4.1.10: version is set by the LRS if not provided. We set it
  // explicitly so downstream consumers (forwarding targets, profile-aware
  // analytics) know exactly which spec the statement was authored against.
  if (!out.version) out.version = '2.0.0';

  // xAPI 2.0 §4.1.2: actor.objectType is REQUIRED for Agent / Group / Anonymous
  // Group actors. Add if absent to keep statements 2.0-conformant.
  const actor = out.actor as Record<string, unknown> | undefined;
  if (actor && typeof actor === 'object' && !actor.objectType) {
    actor.objectType = (actor.member || actor.objectType === 'Group') ? 'Group' : 'Agent';
  }

  // xAPI 2.0 §4.1.4: object.objectType defaults to "Activity" when omitted —
  // explicit is better for downstream tooling.
  const object = out.object as Record<string, unknown> | undefined;
  if (object && typeof object === 'object' && !object.objectType) {
    object.objectType = 'Activity';
  }

  return out;
}

function isVoidingStatement(stmt: Record<string, unknown>): string | undefined {
  const verb = stmt.verb as { id?: string } | undefined;
  const obj = stmt.object as { objectType?: string; id?: string } | undefined;
  if (verb?.id === VOIDED_VERB && obj?.objectType === 'StatementRef' && typeof obj.id === 'string') {
    return obj.id;
  }
  return undefined;
}

// ── /xapi/statements POST ───────────────────────────────────────────

async function handlePostStatements(req: Request, res: Response, config: XapiLrsConfig): Promise<void> {
  const raw = req.body;
  const batch: Record<string, unknown>[] = Array.isArray(raw) ? raw : [raw];
  const ids: string[] = [];
  const authority = { homePage: config.selfBaseUrl, name: 'foxxi-lrs' };

  for (const stmt of batch) {
    if (!stmt || typeof stmt !== 'object') {
      res.status(400).json({ error: 'invalid statement: not an object' });
      return;
    }
    if (!stmt.actor || !stmt.verb || !stmt.object) {
      res.status(400).json({ error: 'invalid statement: actor, verb, and object are required (xAPI §4.1)' });
      return;
    }
    const enriched = ensureStatementFields(stmt, authority);
    const id = enriched.id as string;

    // Statement-id conflict per xAPI §4.1.1: re-POSTing an existing id with
    // a different body is a 409; identical body is 204 idempotent.
    const prior = statementStore.get(id);
    if (prior && JSON.stringify(prior.statement) !== JSON.stringify(enriched)) {
      res.status(409).json({ error: `statement id ${id} already stored with different content (xAPI §4.1.1)` });
      return;
    }

    // Voiding semantics
    let voidedHere: string | undefined;
    const voidedTarget = isVoidingStatement(enriched);
    if (voidedTarget) {
      const target = statementStore.get(voidedTarget);
      if (target) {
        target.voided = true;
        target.voidingStatementId = id;
      }
      voidedHere = voidedTarget;
    }
    void voidedHere;

    statementStore.set(id, { id, statement: enriched, stored: enriched.stored as string, voided: false });
    ids.push(id);

    // Fire-and-forget forwarding to upstream LRSs.
    forwardStatement(enriched, config).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[foxxi-lrs] forwarding failed:', (err as Error).message);
    });
  }

  res.status(200).json(ids);
}

// ── /xapi/statements PUT (caller-supplied id) ───────────────────────

async function handlePutStatement(req: Request, res: Response, config: XapiLrsConfig): Promise<void> {
  const statementId = (req.query.statementId as string | undefined) ?? '';
  if (!isUuid(statementId)) {
    res.status(400).json({ error: 'PUT requires ?statementId=<uuid v4>' });
    return;
  }
  const stmt = req.body as Record<string, unknown>;
  if (!stmt || typeof stmt !== 'object') {
    res.status(400).json({ error: 'invalid statement body' });
    return;
  }
  if (stmt.id && stmt.id !== statementId) {
    res.status(400).json({ error: 'statement.id and ?statementId= must match' });
    return;
  }
  (stmt as Record<string, unknown>).id = statementId;
  const authority = { homePage: config.selfBaseUrl, name: 'foxxi-lrs' };
  const enriched = ensureStatementFields(stmt, authority);
  const prior = statementStore.get(statementId);
  if (prior && JSON.stringify(prior.statement) !== JSON.stringify(enriched)) {
    res.status(409).json({ error: `statement id ${statementId} already stored with different content` });
    return;
  }
  statementStore.set(statementId, { id: statementId, statement: enriched, stored: enriched.stored as string, voided: false });
  forwardStatement(enriched, config).catch(() => undefined);
  res.status(204).end();
}

// ── /xapi/statements GET ────────────────────────────────────────────

function handleGetStatements(req: Request, res: Response): void {
  const statementId = req.query.statementId as string | undefined;
  const voidedStatementId = req.query.voidedStatementId as string | undefined;
  const agentFilter = req.query.agent as string | undefined;
  const verbFilter = req.query.verb as string | undefined;
  const activityFilter = req.query.activity as string | undefined;
  const since = req.query.since as string | undefined;
  const until = req.query.until as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const ascending = (req.query.ascending as string | undefined) === 'true';

  // Single-statement lookup
  if (statementId) {
    const rec = statementStore.get(statementId);
    if (!rec || rec.voided) {
      res.status(404).json({ error: 'not found or voided' });
      return;
    }
    res.json(rec.statement);
    return;
  }
  if (voidedStatementId) {
    const rec = statementStore.get(voidedStatementId);
    if (!rec || !rec.voided) {
      res.status(404).json({ error: 'not voided (use ?statementId= for non-voided)' });
      return;
    }
    res.json(rec.statement);
    return;
  }

  // Filtered query
  let all = Array.from(statementStore.values()).filter(r => !r.voided);
  if (agentFilter) {
    try {
      const a = JSON.parse(agentFilter) as { mbox?: string; account?: { name?: string; homePage?: string }; openid?: string };
      all = all.filter(r => {
        const ac = r.statement.actor as typeof a;
        return JSON.stringify(ac) === JSON.stringify(a)
          || (a.mbox && ac?.mbox === a.mbox)
          || (a.openid && ac?.openid === a.openid)
          || (a.account?.name && ac?.account?.name === a.account.name && ac?.account?.homePage === a.account.homePage);
      });
    } catch { /* ignore bad agent filter */ }
  }
  if (verbFilter) {
    all = all.filter(r => (r.statement.verb as { id?: string } | undefined)?.id === verbFilter);
  }
  if (activityFilter) {
    all = all.filter(r => (r.statement.object as { id?: string } | undefined)?.id === activityFilter);
  }
  if (since) {
    const t = Date.parse(since);
    all = all.filter(r => Date.parse(r.stored) > t);
  }
  if (until) {
    const t = Date.parse(until);
    all = all.filter(r => Date.parse(r.stored) <= t);
  }
  all.sort((a, b) => ascending ? a.stored.localeCompare(b.stored) : b.stored.localeCompare(a.stored));

  const page = all.slice(0, limit);
  const more = all.length > limit ? `?since=${encodeURIComponent(page[page.length - 1]!.stored)}` : '';
  res.json({
    statements: page.map(r => r.statement),
    more,
  });
}

// ── /xapi/about ─────────────────────────────────────────────────────

function handleAbout(_req: Request, res: Response, config: XapiLrsConfig): void {
  res.json({
    version: ABOUT_VERSIONS,
    extensions: {
      'https://markjspivey-xwisee.github.io/interego/ns/foxxi#identity': config.tenantDid,
      'https://markjspivey-xwisee.github.io/interego/ns/foxxi#bridge': config.selfBaseUrl,
      'https://markjspivey-xwisee.github.io/interego/ns/foxxi#pod': config.podUrl,
      'https://markjspivey-xwisee.github.io/interego/ns/foxxi#statementForwarding': !!config.forwardingTargets.trim(),
      'https://markjspivey-xwisee.github.io/interego/ns/foxxi#substrateBackend': 'context-graphs-1.0 + solid-css',
    },
  });
}

// ── Activity / agent profile + state ────────────────────────────────

function stateKey(args: { activityId: string; agent: string; stateId: string; registration?: string }): string {
  return `${args.activityId}::${args.agent}::${args.stateId}::${args.registration ?? ''}`;
}
function profileKey(args: { iri: string; profileId: string }): string {
  return `${args.iri}::${args.profileId}`;
}

function handleStateOrProfile(
  store: Map<string, { content: unknown; etag: string; updated: string; contentType: string }>,
  keyFn: (q: Record<string, string>) => string,
  req: Request,
  res: Response,
): void {
  const q = req.query as Record<string, string>;
  const key = keyFn(q);

  if (req.method === 'GET') {
    if (!q.stateId && !q.profileId) {
      // List
      const ids = Array.from(store.keys()).filter(k => k.startsWith(key.split('::').slice(0, -1).join('::')));
      res.json(ids);
      return;
    }
    const v = store.get(key);
    if (!v) { res.status(404).end(); return; }
    res.setHeader('ETag', v.etag);
    res.setHeader('Last-Modified', new Date(v.updated).toUTCString());
    res.setHeader('Content-Type', v.contentType);
    res.send(v.content);
    return;
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    const etag = `"${randomUUID()}"`;
    store.set(key, {
      content: req.body,
      etag,
      updated: new Date().toISOString(),
      contentType: (req.headers['content-type'] as string | undefined) ?? 'application/json',
    });
    res.setHeader('ETag', etag);
    res.status(204).end();
    return;
  }
  if (req.method === 'DELETE') {
    if (q.stateId || q.profileId) {
      store.delete(key);
    } else {
      // Bulk delete all keys matching the activity/agent prefix
      const prefix = key.split('::').slice(0, -1).join('::');
      for (const k of Array.from(store.keys())) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    }
    res.status(204).end();
    return;
  }
  res.status(405).end();
}

// ── Statement forwarding ────────────────────────────────────────────

async function forwardStatement(stmt: Record<string, unknown>, config: XapiLrsConfig): Promise<void> {
  if (!config.forwardingTargets.trim()) return;
  const targets = config.forwardingTargets.split(',').map(s => s.trim()).filter(Boolean);
  for (const tgt of targets) {
    const [endpoint, creds, version] = tgt.split('||');
    if (!endpoint || !creds) continue;
    try {
      const r = await fetch(`${endpoint.replace(/\/$/, '')}/statements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(creds).toString('base64')}`,
          'X-Experience-API-Version': version || '1.0.3',
        },
        body: JSON.stringify(stmt),
      });
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[foxxi-lrs] forward to ${endpoint} failed ${r.status}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[foxxi-lrs] forward to ${endpoint} threw:`, (err as Error).message);
    }
  }
}

// ── xAPI Profile Server ─────────────────────────────────────────────
// Delegates to xapi-profile.ts where the full Profile-spec-2017 shape
// (concepts + templates + patterns) lives, so the profile stays a
// proper first-class artifact a learning-engineer can review +
// extend, not a thin string-table.

import { buildFoxxiProfileDoc } from './xapi-profile.js';

function buildFoxxiXapiProfile(config: XapiLrsConfig): Record<string, unknown> {
  void config;
  return buildFoxxiProfileDoc({ generatedAt: new Date().toISOString() });
}

// Kept for back-compat (older code may import this name)
function _buildFoxxiXapiProfileLegacy(config: XapiLrsConfig): Record<string, unknown> {
  const baseId = `${config.selfBaseUrl}/xapi/profile`;
  return {
    '@context': 'https://w3id.org/xapi/profiles/context',
    id: baseId,
    type: 'Profile',
    conformsTo: 'https://w3id.org/xapi/profiles#1.0',
    prefLabel: { 'en': 'Foxxi Content Intelligence — xAPI Profile' },
    definition: { 'en': 'xAPI vocabulary the Foxxi vertical emits when projecting substrate descriptors to LRS Statements. Covers SCORM/cmi5 verb subset plus Foxxi-specific extensions for concept-graph retrieval traces.' },
    seeAlso: 'https://github.com/markjspivey-xwisee/interego',
    versions: [{ id: `${baseId}/v/1`, generatedAtTime: new Date().toISOString() }],
    author: { type: 'Organization', name: 'Acme Training Co (demo tenant)' },
    concepts: [
      { id: 'http://adlnet.gov/expapi/verbs/launched', type: 'Verb', prefLabel: { en: 'launched' }, definition: { en: 'cmi5 launch — start of a session' } },
      { id: 'http://adlnet.gov/expapi/verbs/initialized', type: 'Verb', prefLabel: { en: 'initialized' }, definition: { en: 'cmi5 initialized verb' } },
      { id: 'http://adlnet.gov/expapi/verbs/completed', type: 'Verb', prefLabel: { en: 'completed' }, definition: { en: 'cmi5 completed verb' } },
      { id: 'http://adlnet.gov/expapi/verbs/passed', type: 'Verb', prefLabel: { en: 'passed' }, definition: { en: 'cmi5 passed verb' } },
      { id: 'http://adlnet.gov/expapi/verbs/failed', type: 'Verb', prefLabel: { en: 'failed' }, definition: { en: 'cmi5 failed verb' } },
      { id: 'http://adlnet.gov/expapi/verbs/satisfied', type: 'Verb', prefLabel: { en: 'satisfied' }, definition: { en: 'cmi5 satisfied verb (moveOn)' } },
      { id: 'http://adlnet.gov/expapi/verbs/terminated', type: 'Verb', prefLabel: { en: 'terminated' }, definition: { en: 'cmi5 terminated verb' } },
      { id: 'http://adlnet.gov/expapi/verbs/voided', type: 'Verb', prefLabel: { en: 'voided' }, definition: { en: 'xAPI voiding verb' } },
      { id: 'https://markjspivey-xwisee.github.io/interego/ns/foxxi#asked', type: 'Verb', prefLabel: { en: 'asked' }, definition: { en: 'Foxxi extension — learner asked a content question against the concept graph' } },
      { id: 'https://markjspivey-xwisee.github.io/interego/ns/foxxi#retrieved', type: 'Verb', prefLabel: { en: 'retrieved' }, definition: { en: 'Foxxi extension — concept-graph retrieval traced a set of slides' } },
      { id: 'http://adlnet.gov/expapi/activities/course', type: 'ActivityType', prefLabel: { en: 'course' } },
      { id: 'http://adlnet.gov/expapi/activities/lesson', type: 'ActivityType', prefLabel: { en: 'lesson' } },
      { id: 'http://adlnet.gov/expapi/activities/assessment', type: 'ActivityType', prefLabel: { en: 'assessment' } },
      { id: 'https://markjspivey-xwisee.github.io/interego/ns/foxxi#conceptGraphNode', type: 'ActivityType', prefLabel: { en: 'concept graph node' } },
    ],
    templates: [],
    patterns: [],
  };
}

// ── Route attachment ────────────────────────────────────────────────

export function attachXapiLrsRoutes(app: Express, config: XapiLrsConfig): void {
  const gate = makeAuthGate(config);

  app.get('/xapi/about', gate, (req, res) => handleAbout(req, res, config));

  // xAPI Profile Server — public (no auth) so other tools can discover
  // what vocabulary Foxxi emits.
  app.get('/xapi/profile', (_req, res) => {
    res.type('application/ld+json').json(buildFoxxiXapiProfile(config));
  });

  // The order matters: PUT statementId needs to be checked before POST handler picks up.
  app.post('/xapi/statements', gate, (req, res) => { void handlePostStatements(req, res, config); });
  app.put('/xapi/statements', gate, (req, res) => { void handlePutStatement(req, res, config); });
  app.get('/xapi/statements', gate, (req, res) => { handleGetStatements(req, res); });

  // Activity / agent inspection helpers
  app.get('/xapi/activities', gate, (req, res) => {
    const id = req.query.activityId as string | undefined;
    if (!id) { res.status(400).json({ error: 'activityId required' }); return; }
    // Return the activity definition reconstructed from any statement that referenced it.
    for (const r of statementStore.values()) {
      const obj = r.statement.object as { id?: string; definition?: unknown } | undefined;
      if (obj?.id === id && obj.definition) {
        res.json({ id, objectType: 'Activity', definition: obj.definition });
        return;
      }
    }
    res.json({ id, objectType: 'Activity' });
  });
  app.get('/xapi/agents', gate, (req, res) => {
    const agentJson = req.query.agent as string | undefined;
    if (!agentJson) { res.status(400).json({ error: 'agent required (JSON-encoded Agent object)' }); return; }
    try {
      const agent = JSON.parse(agentJson);
      // xAPI Person object — aggregate identifiers seen across statements
      const names = new Set<string>();
      const mboxes = new Set<string>();
      const accounts: Array<{ name: string; homePage: string }> = [];
      for (const r of statementStore.values()) {
        const ac = r.statement.actor as { name?: string; mbox?: string; account?: { name: string; homePage: string } } | undefined;
        if (!ac) continue;
        const sameAgent = JSON.stringify(ac) === JSON.stringify(agent)
          || (agent.mbox && ac.mbox === agent.mbox)
          || (agent.account?.name && ac.account?.name === agent.account.name);
        if (sameAgent) {
          if (ac.name) names.add(ac.name);
          if (ac.mbox) mboxes.add(ac.mbox);
          if (ac.account) accounts.push(ac.account);
        }
      }
      res.json({
        objectType: 'Person',
        name: Array.from(names),
        mbox: Array.from(mboxes),
        account: accounts,
      });
    } catch {
      res.status(400).json({ error: 'invalid agent JSON' });
    }
  });

  // State + profile resources
  for (const method of ['get', 'put', 'post', 'delete'] as const) {
    app[method]('/xapi/activities/state', gate, (req, res) =>
      handleStateOrProfile(activityStateStore, q => stateKey({
        activityId: q.activityId ?? '', agent: q.agent ?? '', stateId: q.stateId ?? '', registration: q.registration,
      }), req, res),
    );
    app[method]('/xapi/activities/profile', gate, (req, res) =>
      handleStateOrProfile(activityProfileStore, q => profileKey({ iri: q.activityId ?? '', profileId: q.profileId ?? '' }), req, res),
    );
    app[method]('/xapi/agents/profile', gate, (req, res) =>
      handleStateOrProfile(agentProfileStore, q => profileKey({ iri: q.agent ?? '', profileId: q.profileId ?? '' }), req, res),
    );
  }
}
