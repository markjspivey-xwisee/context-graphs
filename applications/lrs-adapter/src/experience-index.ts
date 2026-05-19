/**
 * ADL TLA Experience Index — read-side federator.
 *
 * The TLA Experience Index defines a query layer over multiple LRSs:
 * given a filter (actor, verb, object, since), fetch matching xAPI
 * Statements from every configured LRS, deduplicate by Statement ID,
 * and return a unified result-set that respects each statement's
 * original provenance.
 *
 * The substrate already had **write-side** Experience Index coverage
 * (each vertical projects descriptors to a connected LRS via
 * pod-publisher). This module closes the read side: a single
 * `queryFederatedStatements()` call talks to N LRSs and composes
 * results.
 *
 * Standards reference:
 *   - xAPI 1.0.3 §7.2 GET Statements (filtering grammar)
 *   - xAPI 2.0.0 §A.4 (extended filter set)
 *   - ADL TLA Experience Index 2024 draft
 */

import { LrsClient, type LrsClientConfig, type XapiStatement } from './lrs-client.js';

export interface FederatedLrsEndpoint {
  /** Label so federated results can attribute each statement to its source. */
  label: string;
  config: LrsClientConfig;
}

export interface FederatedQueryFilter {
  /** Actor as xAPI Agent object (mbox / mbox_sha1sum / openid / account). */
  agent?: Record<string, unknown>;
  /** Verb IRI. */
  verb?: string;
  /** Object activity IRI. */
  activity?: string;
  /** ISO 8601 lower bound (exclusive). */
  since?: string;
  /** ISO 8601 upper bound (inclusive). */
  until?: string;
  /** Registration (cmi5 sessionId / xAPI 2.0 registration). */
  registration?: string;
  /** Maximum statements to fetch per LRS. */
  limit?: number;
}

export interface FederatedStatement {
  /** xAPI Statement as returned. */
  statement: XapiStatement;
  /** Which LRS the statement was retrieved from. */
  sourceLrsLabel: string;
  /** Stable Statement ID for dedup. */
  statementId: string;
}

export interface FederatedQueryResult {
  totalStatements: number;
  uniqueStatements: number;
  perLrs: Array<{ lrsLabel: string; statementCount: number; error?: string }>;
  statements: FederatedStatement[];
}

/**
 * Query every configured LRS in parallel + merge results. Statements
 * with the same `id` from multiple LRSs (e.g. forwarded between
 * institutions) are deduplicated; the first arrival wins.
 *
 * Errors per-LRS are reported in `perLrs[i].error` rather than failing
 * the whole query — partial federation is better than no federation.
 */
export async function queryFederatedStatements(
  endpoints: readonly FederatedLrsEndpoint[],
  filter: FederatedQueryFilter,
): Promise<FederatedQueryResult> {
  const perLrs: FederatedQueryResult['perLrs'] = [];
  const seen = new Set<string>();
  const statements: FederatedStatement[] = [];

  const results = await Promise.all(endpoints.map(async ep => {
    try {
      const client = new LrsClient(ep.config);
      const ss = await fetchStatements(client, filter, ep.config.endpoint);
      return { ep, statements: ss, error: undefined };
    } catch (err) {
      return { ep, statements: [] as XapiStatement[], error: (err as Error).message };
    }
  }));

  let total = 0;
  for (const { ep, statements: ss, error } of results) {
    perLrs.push({ lrsLabel: ep.label, statementCount: ss.length, error });
    total += ss.length;
    for (const s of ss) {
      const id = (s as { id?: string }).id;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      statements.push({ statement: s, sourceLrsLabel: ep.label, statementId: id });
    }
  }

  return {
    totalStatements: total,
    uniqueStatements: statements.length,
    perLrs,
    statements,
  };
}

/**
 * Use the LRS's GET /statements endpoint directly with the filter.
 * The substrate's LrsClient handles version negotiation + auth; we
 * just build the URL.
 */
async function fetchStatements(client: LrsClient, filter: FederatedQueryFilter, endpoint: string): Promise<XapiStatement[]> {
  // Use the LrsClient's negotiated version + auth via direct fetch so
  // we can pass arbitrary filter params (the substrate client only
  // exposes statement POST / by-id GET today).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headers = await (client as any).commonHeaders() as Record<string, string>;
  const url = new URL(`${endpoint.replace(/\/$/, '')}/statements`);
  if (filter.agent) url.searchParams.set('agent', JSON.stringify(filter.agent));
  if (filter.verb) url.searchParams.set('verb', filter.verb);
  if (filter.activity) url.searchParams.set('activity', filter.activity);
  if (filter.since) url.searchParams.set('since', filter.since);
  if (filter.until) url.searchParams.set('until', filter.until);
  if (filter.registration) url.searchParams.set('registration', filter.registration);
  if (filter.limit) url.searchParams.set('limit', String(filter.limit));

  const r = await fetch(url.toString(), { headers });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${r.statusText}`);
  const body = await r.json() as { statements?: XapiStatement[] };
  return body.statements ?? [];
}
