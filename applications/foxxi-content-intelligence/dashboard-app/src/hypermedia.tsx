/**
 * Hypermedia client — Richardson Level 3 navigation in the SPA.
 *
 * The dashboard does NOT hardcode URL patterns for the Foxxi resources
 * collection. It fetches the root entry point at /api/foxxi/v1, which
 * returns a hydra:EntryPoint document containing the URLs of every
 * top-level resource collection plus the /affordances manifest URL.
 *
 * From there, every resource response (collection or item) carries
 *   _links:        { self, collection, related-resource, … }
 *   _embedded:     { sub-resources, expanded items }
 *   _affordances:  cg:Affordance instances applicable to this resource
 *
 * The SPA navigates by following links from these responses. Resource
 * URL strings live in the server's responses, not in client config.
 *
 * Cool URIs (Berners-Lee) + Richardson Level 3 + Amundsen "RESTful
 * Web APIs" §5 all converge on this: the only URL the client must
 * know is the entry point. Every other URL is discovered via a link
 * relation.
 *
 * For SPAs with bookmarkable routes (react-router based), the URL bar
 * presents a *projection* of the resource the user is currently
 * viewing. Bookmarks resolve back through the same entry-point fetch
 * + link traversal.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

const ENTRY_URL_DEFAULT =
  (import.meta.env.VITE_FOXXI_BRIDGE_URL as string | undefined ?? 'https://interego-foxxi-bridge.livelysky-8b81abb0.eastus.azurecontainerapps.io')
  + '/api/foxxi/v1';

// ── Types mirroring the server envelope shapes ──────────────────────

export interface HypermediaLink {
  href: string;
  templated?: boolean;
  method?: string;
  title?: string;
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

interface HypermediaCtx {
  entry: EntryPoint | null;
  error: string | null;
  bearer: string | null;
}
const Ctx = createContext<HypermediaCtx>({ entry: null, error: null, bearer: null });

export function HypermediaProvider({
  bearer, entryUrl = ENTRY_URL_DEFAULT, children,
}: {
  bearer: string | null;
  entryUrl?: string;
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
