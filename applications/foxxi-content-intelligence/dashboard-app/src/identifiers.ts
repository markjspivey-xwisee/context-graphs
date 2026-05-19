/**
 * Opaque resource identifiers for URLs.
 *
 * Principles applied (Amundsen / Richardson / Cool URIs):
 *   - URLs reference resources by opaque ids, not business slugs
 *   - Identifiers are stable + deterministic so they're cacheable +
 *     bookmarkable across deployments
 *   - The client maps opaque ↔ slug at the route boundary; everything
 *     below the route boundary works in the underlying domain model
 *
 * Two derivation functions are exported:
 *
 *   userIdToUuid(userId)             — user-id slug → UUID v5 (via wallet
 *                                       address, the substrate's crypto-
 *                                       rooted identity)
 *   opaqueId(kind, slug)             — generic kind + slug → UUID v5
 *
 * Plus pre-built bidirectional maps for the dashboard's known
 * collections — courses, policies, groups, audit-records, integrations
 * — so the SPA can resolve opaque ↔ slug without async fetches in
 * route resolvers.
 */

import { ethers } from 'ethers';
import { SAMPLE_ADMIN_PAYLOAD } from './sample/data.js';

const DEFAULT_DEMO_SEED = 'foxxi-demo-acme-training-2026-05-17-v1';

function sha256Hex(input: string): string {
  const enc = new TextEncoder();
  return ethers.sha256(enc.encode(input)).slice(2); // strip 0x
}

function deriveWalletAddress(userId: string): string {
  const h = sha256Hex(`${DEFAULT_DEMO_SEED}:${userId}`);
  return new ethers.Wallet('0x' + h).address;
}

function hexToUuidV5(h: string): string {
  const variantNibble = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    h.slice(0, 8) + '-' +
    h.slice(8, 12) + '-' +
    '5' + h.slice(13, 16) + '-' +
    variantNibble + h.slice(17, 20) + '-' +
    h.slice(20, 32)
  );
}

function walletToUuid(addr: string): string {
  return hexToUuidV5(sha256Hex(`foxxi:user-uuid:${addr.toLowerCase()}`));
}

// ── User identifiers ────────────────────────────────────────────────

const userIdToUuidMap = new Map<string, string>();
const uuidToUserIdMap = new Map<string, string>();
for (const u of SAMPLE_ADMIN_PAYLOAD.users) {
  const wallet = deriveWalletAddress(u.user_id);
  const uuid = walletToUuid(wallet);
  userIdToUuidMap.set(u.user_id, uuid);
  uuidToUserIdMap.set(uuid, u.user_id);
}

export function userIdToUuid(userId: string): string {
  const cached = userIdToUuidMap.get(userId);
  if (cached) return cached;
  const wallet = deriveWalletAddress(userId);
  const uuid = walletToUuid(wallet);
  userIdToUuidMap.set(userId, uuid);
  uuidToUserIdMap.set(uuid, userId);
  return uuid;
}

export function uuidToUserId(uuid: string): string | null {
  return uuidToUserIdMap.get(uuid) ?? null;
}

// ── Generic opaque-id derivation ────────────────────────────────────

export function opaqueId(kind: string, slug: string): string {
  return hexToUuidV5(sha256Hex(`foxxi:${kind}:${slug}`));
}

// ── Pre-built collection maps (courses, policies, groups, audit, integrations) ─

function buildCollectionMap<T>(
  kind: string,
  items: ReadonlyArray<T>,
  slugOf: (item: T) => string,
): { toOpaque: Map<string, string>; toSlug: Map<string, string> } {
  const toOpaque = new Map<string, string>();
  const toSlug = new Map<string, string>();
  for (const item of items) {
    const slug = slugOf(item);
    const o = opaqueId(kind, slug);
    toOpaque.set(slug, o);
    toSlug.set(o, slug);
  }
  return { toOpaque, toSlug };
}

const a = SAMPLE_ADMIN_PAYLOAD;
const courseMap = buildCollectionMap('course', a.catalog, (c) => c.course_id);
const policyMap = buildCollectionMap('policy', a.policies, (p) => p.policy_id);
const groupMap = buildCollectionMap('group', a.groups, (g) => g.group_id);
const auditMap = buildCollectionMap('audit-record', a.audit, (r) => r.audit_id);
const integrationMap = buildCollectionMap('integration', a.connections, (i) => i.id);

// Course: slug ↔ opaque
export const courseSlugToOpaque = (slug: string) =>
  courseMap.toOpaque.get(slug) ?? opaqueId('course', slug);
export const courseOpaqueToSlug = (opaque: string) =>
  courseMap.toSlug.get(opaque) ?? null;

// Policy
export const policySlugToOpaque = (slug: string) =>
  policyMap.toOpaque.get(slug) ?? opaqueId('policy', slug);
export const policyOpaqueToSlug = (opaque: string) =>
  policyMap.toSlug.get(opaque) ?? null;

// Group
export const groupSlugToOpaque = (slug: string) =>
  groupMap.toOpaque.get(slug) ?? opaqueId('group', slug);
export const groupOpaqueToSlug = (opaque: string) =>
  groupMap.toSlug.get(opaque) ?? null;

// Audit record
export const auditSlugToOpaque = (slug: string) =>
  auditMap.toOpaque.get(slug) ?? opaqueId('audit-record', slug);
export const auditOpaqueToSlug = (opaque: string) =>
  auditMap.toSlug.get(opaque) ?? null;

// Integration / connector
export const integrationSlugToOpaque = (slug: string) =>
  integrationMap.toOpaque.get(slug) ?? opaqueId('integration', slug);
export const integrationOpaqueToSlug = (opaque: string) =>
  integrationMap.toSlug.get(opaque) ?? null;

// ── Helpers ─────────────────────────────────────────────────────────

/** Construct a canonical resource URL from a collection name + opaque id. */
export function resourceUrl(collection: string, opaque: string): string {
  return `/${collection}/${opaque}`;
}
