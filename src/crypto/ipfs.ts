/**
 * @module crypto/ipfs
 * @description IPFS pinning for PGSL fragments and descriptors.
 *
 * PGSL atoms are already content-addressed (deterministic URIs from content).
 * IPFS extends this to permanent, decentralized storage:
 *   urn:pgsl:atom:X → ipfs://Qm<hash(X)>
 *
 * Supports Pinata, web3.storage, or mock (for testing).
 */

import type { IRI } from '../model/types.js';
import type { CID, IpfsPinResult, IpfsAnchor, IpfsConfig } from './types.js';
import type { FetchFn } from '../solid/types.js';

// ── Content hashing ──────────────────────────────────────────

/**
 * SHA-256 hash of a string, returned as hex.
 * Uses Web Crypto API (available in Node 20+ and browsers).
 */
export async function sha256(content: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const data = new TextEncoder().encode(content);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple hash for environments without Web Crypto
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

// ── IPFS Pinning ─────────────────────────────────────────────

/**
 * Pin content to IPFS via configured provider.
 */
export async function pinToIpfs(
  content: string,
  name: string,
  config: IpfsConfig,
  fetchFn?: FetchFn,
): Promise<IpfsPinResult> {
  switch (config.provider) {
    case 'pinata':
      return pinToPinata(content, name, config, fetchFn);
    case 'web3storage':
      return pinToWeb3Storage(content, name, config, fetchFn);
    case 'mock':
    default:
      return mockPin(content, name);
  }
}

/**
 * Pin via Pinata API.
 */
async function pinToPinata(
  content: string,
  name: string,
  config: IpfsConfig,
  fetchFn?: FetchFn,
): Promise<IpfsPinResult> {
  const doFetch = fetchFn ?? defaultFetch;
  const resp = await doFetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      pinataContent: { content, name },
      pinataMetadata: { name },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Pinata pin failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as { IpfsHash: string; PinSize: number };
  const gateway = config.gateway ?? 'https://gateway.pinata.cloud/ipfs/';

  return {
    cid: data.IpfsHash as CID,
    size: data.PinSize,
    url: `${gateway}${data.IpfsHash}`,
    pinnedAt: new Date().toISOString(),
    provider: 'pinata',
  };
}

/**
 * Pin via web3.storage API.
 */
async function pinToWeb3Storage(
  content: string,
  name: string,
  config: IpfsConfig,
  fetchFn?: FetchFn,
): Promise<IpfsPinResult> {
  const doFetch = fetchFn ?? defaultFetch;
  const blob = new Blob([content], { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', blob, name);

  const resp = await doFetch('https://api.web3.storage/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: formData as any,
  });

  if (!resp.ok) {
    throw new Error(`web3.storage pin failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as { cid: string };
  return {
    cid: data.cid as CID,
    size: content.length,
    url: `https://w3s.link/ipfs/${data.cid}`,
    pinnedAt: new Date().toISOString(),
    provider: 'web3storage',
  };
}

/**
 * Mock IPFS pinning (for testing without a real IPFS node).
 * Generates a deterministic CID from the content hash.
 */
async function mockPin(content: string, _name: string): Promise<IpfsPinResult> {
  const hash = await sha256(content);
  const cid = `bafymock${hash.slice(0, 40)}` as CID;

  return {
    cid,
    size: content.length,
    url: `ipfs://${cid}`,
    pinnedAt: new Date().toISOString(),
    provider: 'mock',
  };
}

/**
 * Create an IpfsAnchor from a pin result.
 */
export async function createIpfsAnchor(content: string, pinResult: IpfsPinResult): Promise<IpfsAnchor> {
  return {
    cid: pinResult.cid,
    gatewayUrl: pinResult.url,
    contentHash: await sha256(content),
    pinnedAt: pinResult.pinnedAt,
  };
}

/**
 * Pin a PGSL fragment to IPFS and return the anchor.
 */
export async function pinPgslFragment(
  fragmentUri: IRI,
  content: string,
  config: IpfsConfig,
  fetchFn?: FetchFn,
): Promise<IpfsAnchor> {
  const name = `pgsl-${fragmentUri.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 60)}`;
  const result = await pinToIpfs(content, name, config, fetchFn);
  return createIpfsAnchor(content, result);
}

/**
 * Pin a descriptor's Turtle to IPFS and return the anchor.
 */
export async function pinDescriptor(
  descriptorId: IRI,
  turtle: string,
  config: IpfsConfig,
  fetchFn?: FetchFn,
): Promise<IpfsAnchor> {
  const name = `descriptor-${descriptorId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 60)}`;
  const result = await pinToIpfs(turtle, name, config, fetchFn);
  return createIpfsAnchor(turtle, result);
}

// ── Default fetch ────────────────────────────────────────────

const defaultFetch: FetchFn = async (url, init) => {
  const resp = await fetch(url, init as RequestInit);
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: { get: (n: string) => resp.headers.get(n) },
    text: () => resp.text(),
    json: () => resp.json(),
  };
};
