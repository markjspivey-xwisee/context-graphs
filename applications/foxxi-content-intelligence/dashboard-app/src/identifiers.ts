/**
 * Opaque resource identifiers for URLs.
 *
 * Per Amundsen ("RESTful Web APIs", with Richardson + Ruby) and the
 * Cool-URIs principle (Tim Berners-Lee, https://www.w3.org/Provider/Style/URI):
 *
 *   - URLs are stable, opaque references to resources
 *   - The client SHOULD NOT be able to reverse-engineer business
 *     identifiers from the URL path
 *   - A user's URL is a system GUID, not a slug like `u-joshua`
 *
 * For the demo, the system identifier IS the deterministic ECDSA
 * wallet address (the substrate's crypto-rooted identity). We project
 * it to a UUID v5-style string for URL ergonomics. Mapping is stable:
 * given the seed + userId, the UUID is always the same.
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

function walletToUuid(addr: string): string {
  const h = sha256Hex(`foxxi:user-uuid:${addr.toLowerCase()}`);
  const variantNibble = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    h.slice(0, 8) + '-' +
    h.slice(8, 12) + '-' +
    '5' + h.slice(13, 16) + '-' +
    variantNibble + h.slice(17, 20) + '-' +
    h.slice(20, 32)
  );
}

// Build the user_id → uuid map at module load (88 users, computed once).
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
  // For tokens minted with userIds not in the local sample (e.g. cross-tenant
  // federation), derive on demand. Keep the same deterministic function so
  // the URL is reproducible.
  const wallet = deriveWalletAddress(userId);
  const uuid = walletToUuid(wallet);
  userIdToUuidMap.set(userId, uuid);
  uuidToUserIdMap.set(uuid, userId);
  return uuid;
}

export function uuidToUserId(uuid: string): string | null {
  return uuidToUserIdMap.get(uuid) ?? null;
}

/**
 * Generate an opaque ID for any resource keyed by a slug. Used for
 * /policies/<id>, /groups/<id>, etc. so business slugs don't leak.
 */
export function opaqueId(kind: string, slug: string): string {
  const h = sha256Hex(`foxxi:${kind}:${slug}`);
  const variantNibble = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    h.slice(0, 8) + '-' +
    h.slice(8, 12) + '-' +
    '5' + h.slice(13, 16) + '-' +
    variantNibble + h.slice(17, 20) + '-' +
    h.slice(20, 32)
  );
}

/** Inverse of opaqueId — populate from a known collection at module-init time. */
export function buildSlugResolver<T extends { id: string }>(kind: string, items: ReadonlyArray<T & { id: string }>): {
  toOpaque: (slug: string) => string;
  toSlug: (opaque: string) => string | null;
} {
  const slugToOpaque = new Map<string, string>();
  const opaqueToSlug = new Map<string, string>();
  for (const item of items) {
    const o = opaqueId(kind, item.id);
    slugToOpaque.set(item.id, o);
    opaqueToSlug.set(o, item.id);
  }
  return {
    toOpaque: (s) => slugToOpaque.get(s) ?? opaqueId(kind, s),
    toSlug: (o) => opaqueToSlug.get(o) ?? null,
  };
}
