/**
 * bbs-2023 BBS+ signature suite for W3C Verifiable Credentials.
 *
 * BBS+ enables **selective disclosure**: a holder receives a credential
 * signed by an issuer over an ordered list of "messages" (the
 * credential claims), then later derives a zero-knowledge proof
 * revealing only a subset of those messages while still proving the
 * issuer signed the full original.
 *
 * Use cases:
 *   - Privacy-preserving credential presentation (show your degree
 *     without revealing your GPA, etc.)
 *   - GDPR data minimization (verifier learns only what they need)
 *   - Foxxi competency credentials where the learner reveals one
 *     aligned skill without revealing the full course completion record
 *
 * This module composes @digitalbazaar/bbs-signatures (BLS12-381 BBS+)
 * into the substrate's existing VC issuance pattern. The credential
 * shape stays compatible with W3C VC 2.0 + Open Badges 3.0; only the
 * proof block carries BBS+ specifics.
 *
 * Standards reference:
 *   - W3C VC Data Integrity 1.0
 *   - bbs-2023 cryptosuite spec (https://www.w3.org/TR/vc-di-bbs/)
 *   - BBS+ Signatures Draft 06 (https://datatracker.ietf.org/doc/draft-irtf-cfrg-bbs-signatures/)
 */

import * as bbs from '@digitalbazaar/bbs-signatures';

export interface BbsKeyPair {
  /** BLS12-381 secret key (32 bytes). */
  privateKey: Uint8Array;
  /** BLS12-381 G2 public key (96 bytes). */
  publicKey: Uint8Array;
  /** Multibase-encoded public key for use in did:key / verificationMethod (zUC7… for BLS12-381-G2-Pub). */
  publicKeyMultibase: string;
}

/** Generate a fresh BBS+ keypair (BLS12-381-G2). */
export async function generateBbsKeyPair(seed?: Uint8Array): Promise<BbsKeyPair> {
  const kp = await bbs.generateKeyPair({
    seed,
    ciphersuite: bbs.CIPHERSUITES.BLS12381_SHA256,
  });
  return {
    privateKey: kp.secretKey,
    publicKey: kp.publicKey,
    publicKeyMultibase: encodeBls12381G2Multibase(kp.publicKey),
  };
}

/**
 * Multibase-encode a BLS12-381-G2 public key per Multikey 2022 spec.
 * Prefix `0xeb01` identifies BLS12-381-G2-Pub.
 */
function encodeBls12381G2Multibase(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(publicKey.length + 2);
  prefixed[0] = 0xeb;
  prefixed[1] = 0x01;
  prefixed.set(publicKey, 2);
  return 'z' + base58Encode(prefixed);
}

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (bytes.length === 0) return '';
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    const r = n % 58n;
    out = ALPHABET[Number(r)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = '1' + out; else break;
  }
  return out;
}

// ── Sign + verify (BBS+ over message list) ───────────────────

/**
 * Sign an ordered list of messages with a BBS+ key. The signature
 * commits to ALL messages; the holder later selects which to reveal
 * via deriveProof.
 *
 * For Foxxi credentials each message is one VC claim: e.g.
 *   messages = [
 *     'achievement.id=urn:foxxi:golf-explained',
 *     'achievement.name=Golf Explained',
 *     'subject.id=did:example:learner',
 *     'aligned_skill.targetCode=engineering',
 *     'aligned_skill.proficiencyLevel=Intermediate',
 *     ...
 *   ]
 * Then on presentation the holder can deriveProof revealing only
 * messages [0, 1, 2] to a verifier (hiding the proficiency level).
 */
export async function bbsSign(args: {
  messages: readonly Uint8Array[];
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  header?: Uint8Array;
}): Promise<Uint8Array> {
  return bbs.sign({
    secretKey: args.privateKey,
    publicKey: args.publicKey,
    header: args.header ?? new Uint8Array(),
    messages: args.messages,
    ciphersuite: bbs.CIPHERSUITES.BLS12381_SHA256,
  });
}

export async function bbsVerify(args: {
  signature: Uint8Array;
  messages: readonly Uint8Array[];
  publicKey: Uint8Array;
  header?: Uint8Array;
}): Promise<boolean> {
  try {
    return await bbs.verifySignature({
      publicKey: args.publicKey,
      signature: args.signature,
      header: args.header ?? new Uint8Array(),
      messages: args.messages,
      ciphersuite: bbs.CIPHERSUITES.BLS12381_SHA256,
    });
  } catch {
    return false;
  }
}

/**
 * Derive a selective-disclosure proof from a BBS+ signature. The holder
 * picks `revealedIndexes` (a subset of the original messages); the
 * resulting proof convinces a verifier that the issuer signed a
 * message-set containing the revealed ones, without leaking the rest.
 */
export async function bbsDeriveProof(args: {
  signature: Uint8Array;
  messages: readonly Uint8Array[];
  revealedIndexes: readonly number[];
  publicKey: Uint8Array;
  header?: Uint8Array;
  presentationHeader?: Uint8Array;
}): Promise<Uint8Array> {
  return bbs.deriveProof({
    publicKey: args.publicKey,
    signature: args.signature,
    header: args.header ?? new Uint8Array(),
    presentationHeader: args.presentationHeader ?? new Uint8Array(),
    messages: args.messages,
    disclosedMessageIndexes: args.revealedIndexes,
    ciphersuite: bbs.CIPHERSUITES.BLS12381_SHA256,
  });
}

/**
 * Verify a derived (selective-disclosure) proof. The verifier sees
 * only the revealed messages + the proof; if `verifyDerivedProof`
 * returns true, the issuer signed a credential containing those
 * messages at the same positions.
 */
export async function bbsVerifyProof(args: {
  proof: Uint8Array;
  disclosedMessages: ReadonlyArray<{ index: number; message: Uint8Array }>;
  publicKey: Uint8Array;
  header?: Uint8Array;
  presentationHeader?: Uint8Array;
}): Promise<boolean> {
  try {
    return await bbs.verifyProof({
      publicKey: args.publicKey,
      proof: args.proof,
      header: args.header ?? new Uint8Array(),
      presentationHeader: args.presentationHeader ?? new Uint8Array(),
      disclosedMessages: args.disclosedMessages.map(d => d.message),
      disclosedMessageIndexes: args.disclosedMessages.map(d => d.index),
      ciphersuite: bbs.CIPHERSUITES.BLS12381_SHA256,
    });
  } catch {
    return false;
  }
}

// ── VC convenience: deconstruct a flat VC into a message list ──

/**
 * Flatten a VC's `credentialSubject` into BBS+ messages — one per
 * leaf claim. Order is stable (sorted by dot-path key) so the
 * verifier can re-flatten the disclosed subset and reach the same
 * indexes. Used by the higher-level VC issuer to translate a JSON
 * credential into the byte-list BBS+ signs over.
 */
export function flattenCredentialSubject(subject: Record<string, unknown>, prefix = ''): Array<{ path: string; value: Uint8Array }> {
  const out: Array<{ path: string; value: Uint8Array }> = [];
  const enc = new TextEncoder();
  const keys = Object.keys(subject).sort();
  for (const k of keys) {
    const v = subject[k];
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenCredentialSubject(v as Record<string, unknown>, path));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const itemPath = `${path}[${i}]`;
        if (typeof item === 'object' && item !== null) {
          out.push(...flattenCredentialSubject(item as Record<string, unknown>, itemPath));
        } else {
          out.push({ path: itemPath, value: enc.encode(`${itemPath}=${String(item)}`) });
        }
      });
    } else {
      out.push({ path, value: enc.encode(`${path}=${String(v)}`) });
    }
  }
  return out;
}
