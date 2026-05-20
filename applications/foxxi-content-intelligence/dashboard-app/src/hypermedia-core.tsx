/**
 * Hypermedia client core — Richardson Level 3 navigation for React SPAs.
 *
 * VERTICAL-AGNOSTIC. Nothing in this file mentions Foxxi. Any vertical
 * whose bridge serves a `hydra:EntryPoint` with HAL-style `_links` /
 * `_embedded` / `_affordances` envelopes can drive its dashboard from
 * this module — it never hardcodes resource URLs. The one URL a consumer
 * must supply is the entry point (`HypermediaProvider entryUrl=…`);
 * every other URL is discovered by following a link relation.
 *
 * Cool URIs (Berners-Lee) + Richardson Level 3 + Amundsen "RESTful Web
 * APIs" §5 all converge on this: the client knows one URL and walks the
 * affordance graph from there.
 *
 * ── Promotion path ────────────────────────────────────────────────
 * This module is deliberately decoupled from the vertical. When a
 * SECOND vertical needs a hypermedia dashboard, promote it verbatim to
 * `applications/_shared/hypermedia-client/` as a proper workspace
 * package (its own package.json with `react` as a peerDependency, so
 * cross-package `react` / `@types/react` resolution is set up once,
 * against a real second consumer). Until then it lives here — a
 * relocation with one consumer only buys broken module resolution.
 *
 * The Foxxi-specific entry-point URL lives in the sibling adapter
 * `hypermedia.tsx`, which re-exports this whole surface.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

// ── Types mirroring the server envelope shapes ──────────────────────

/** One variable of a Hydra IriTemplate link (`hydra:IriTemplateMapping`).
 *  The value is sourced either from the caller's session (`fromSession`)
 *  or by an out-of-band exchange (`fromExchange`) — the latter keeps a
 *  long-lived secret out of the URL by minting a one-time code first. */
export interface TemplateVariableMapping {
  variable: string;
  required: boolean;
  description?: string;
  /** Copy a field of the caller's own session. */
  fromSession?: 'bearerToken' | 'actorDid' | 'actorName';
  /** Mint a one-time code at `mintUrl` (POST, bearer-authenticated) and
   *  substitute the returned code — see out-of-band-auth-exchange. */
  fromExchange?: { mintUrl: string; method: string };
}
export interface HypermediaLink {
  href: string;
  templated?: boolean;
  method?: string;
  title?: string;
  /** Hydra `hydra:variableRepresentation`, when this link is a template. */
  variableRepresentation?: string;
  /** Hydra `hydra:mapping` — present when `templated` is true. The client
   *  iterates this to substitute variables structurally rather than
   *  string-scanning the href for `{…}` braces. */
  mapping?: TemplateVariableMapping[];
}

/** Caller-side session context used to expand a templated link. Keys
 *  match `TemplateVariableMapping.fromSession`. */
export interface SessionContext {
  bearerToken?: string;
  actorDid?: string;
  actorName?: string;
}

/**
 * Mint a one-time out-of-band launch code. POSTs the caller's session
 * bearer to `mintUrl`; the returned short-lived single-use code is what
 * travels in the URL — the long-lived bearer never does.
 */
export async function mintLaunchCode(mintUrl: string, bearer: string | null): Promise<string> {
  if (!bearer) throw new Error('cannot mint a launch code without a session bearer');
  const r = await fetch(mintUrl, { method: 'POST', headers: { Authorization: `Bearer ${bearer}` } });
  if (!r.ok) throw new Error(`launch-code mint ${mintUrl} → HTTP ${r.status}`);
  const j = await r.json() as { code?: string };
  if (!j.code) throw new Error('launch-code mint returned no code');
  return j.code;
}

/**
 * Expand a Hydra IriTemplate link against a caller session. Iterates the
 * server-declared `mapping` — never guesses variables from the href —
 * URI-encoding each value. Variables marked `fromExchange` trigger an
 * out-of-band code mint (hence async). Throws if a `required` variable
 * cannot be sourced.
 */
export async function expandTemplatedLink(link: HypermediaLink, ctx: SessionContext): Promise<string> {
  let href = link.href;
  for (const m of link.mapping ?? []) {
    let value: string | undefined;
    if (m.fromExchange) {
      value = await mintLaunchCode(m.fromExchange.mintUrl, ctx.bearerToken ?? null);
    } else if (m.fromSession) {
      value = ctx[m.fromSession];
    }
    if (value == null && m.required) {
      throw new Error(`templated link "${link.title ?? link.href}" missing required variable "${m.variable}"`);
    }
    href = href.replace(`{${m.variable}}`, encodeURIComponent(value ?? ''));
  }
  return href;
}
export interface HypermediaAffordance {
  rel: string;
  href: string;
  method: string;
  title?: string;
  description?: string;
  expects?: Array<{ name: string; type: string; required: boolean; description?: string }>;
  mcpTool?: string;
}
export interface HypermediaCollection<T> {
  '@type': 'hydra:Collection';
  '@id': string;
  'hydra:totalItems': number;
  'hydra:member': T[];
  _links: Record<string, HypermediaLink>;
  _affordances: HypermediaAffordance[];
}
export interface HypermediaItem<T> {
  '@id': string;
  _links: Record<string, HypermediaLink>;
  _embedded?: Record<string, unknown>;
  _affordances: HypermediaAffordance[];
  [k: string]: unknown;
}
export interface EntryPoint {
  '@id': string;
  '@type': 'hydra:EntryPoint';
  _links: Record<string, HypermediaLink>;
}

// ── React context — single fetch + cache for the entry point ───────

export interface HypermediaCtx {
  entry: EntryPoint | null;
  error: string | null;
  bearer: string | null;
}
const Ctx = createContext<HypermediaCtx>({ entry: null, error: null, bearer: null });

/**
 * Fetch + cache a vertical's entry point and expose it to descendants.
 * `entryUrl` is required — this core is vertical-agnostic; a vertical
 * wraps it with its own default (see the sibling hypermedia.tsx).
 */
export function HypermediaProvider({
  bearer, entryUrl, children,
}: {
  bearer: string | null;
  entryUrl: string;
  children: React.ReactNode;
}) {
  const [entry, setEntry] = useState<EntryPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(entryUrl, { headers: { Accept: 'application/ld+json, application/json' } });
        if (!r.ok) throw new Error(`entry-point fetch ${r.status}`);
        const e = await r.json() as EntryPoint;
        if (!cancel) { setEntry(e); setError(null); }
      } catch (err) { if (!cancel) setError((err as Error).message); }
    })();
    return () => { cancel = true; };
  }, [entryUrl]);
  return <Ctx.Provider value={{ entry, error, bearer }}>{children}</Ctx.Provider>;
}

export function useHypermedia(): HypermediaCtx {
  return useContext(Ctx);
}

// ── Helpers to fetch + follow hypermedia ───────────────────────────

export async function fetchHypermedia<T>(url: string, bearer: string | null): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/ld+json, application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Resolve a logical link rel on an entry point — returns the URL string or null. */
export function linkOf(entry: EntryPoint | null, rel: string): string | null {
  return entry?._links?.[rel]?.href ?? null;
}

/** Follow a relation from one resource into a sub-resource. */
export async function followLink<T>(resource: { _links?: Record<string, HypermediaLink> } | null,
                                    rel: string, bearer: string | null): Promise<T | null> {
  const link = resource?._links?.[rel];
  if (!link?.href) return null;
  return fetchHypermedia<T>(link.href, bearer);
}

/**
 * Hook to drive a UI from a top-level resource collection. Follows the
 * entry-point's link relation `rel` (e.g. 'courses', 'policies') and
 * fetches the collection resource. Returns the hydra:member array
 * unwrapped, plus pagination + refresh handles.
 *
 * Components that use this NEVER hardcode the collection URL — they
 * pass a link relation name and let the entry-point resolve it.
 */
export function useHypermediaCollection<T>(rel: string): {
  items: T[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { entry, bearer } = useHypermedia();
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!entry) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const url = entry._links[rel]?.href;
        if (!url) throw new Error(`entry-point has no _link rel="${rel}"`);
        const collection = await fetchHypermedia<HypermediaCollection<T>>(`${url}?limit=500`, bearer);
        if (!cancel) {
          setItems(collection['hydra:member'] ?? []);
          setTotal(collection['hydra:totalItems'] ?? 0);
          setError(null);
        }
      } catch (err) {
        if (!cancel) setError((err as Error).message);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [entry, bearer, rel, version]);

  return { items, total, loading, error, refresh: () => setVersion(v => v + 1) };
}

/**
 * Find a specific affordance by its underlying tool name (e.g.
 * `foxxi.coverage_query`). Returns the affordance descriptor including
 * its href, method, and expected inputs. The dashboard component then
 * invokes it via `invokeAffordance` — the URL is server-supplied, not
 * client-constructed.
 */
export function useAffordance(toolName: string): HypermediaAffordance | null {
  const { entry } = useHypermedia();
  const raw = (entry as unknown as { _affordances?: HypermediaAffordance[] } | null)?._affordances;
  if (!raw) return null;
  return raw.find(a => a.mcpTool === toolName) ?? null;
}

export interface AffordanceInvokeArgs {
  affordance: HypermediaAffordance;
  bearer: string | null;
  args?: Record<string, unknown>;
}
export async function invokeAffordance({ affordance, bearer, args }: AffordanceInvokeArgs): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const init: RequestInit = { method: affordance.method, headers };
  if (affordance.method !== 'GET' && affordance.method !== 'HEAD') {
    init.body = JSON.stringify(args ?? {});
  }
  const r = await fetch(affordance.href, init);
  if (!r.ok) throw new Error(`${affordance.method} ${affordance.href} → HTTP ${r.status}`);
  return r.json();
}
