/**
 * @module pgsl/coherence
 * @description Coherence verification between agents/systems.
 *
 * When two agents share context across a federation, their
 * interpretations may or may not align. Coherence is the property
 * that two agents' presheaf sections agree on their overlaps —
 * i.e., the sheaf condition holds for the pair.
 *
 * Three states:
 *   - Verified: coherence was checked and confirmed (sections glue)
 *   - Divergent: coherence was checked and failed (obstruction found)
 *   - Unexamined: coherence has never been checked (null state —
 *     observationally identical to verified from inside either system)
 *
 * The dangerous state is unexamined — both agents proceed as if
 * they agree, but neither has verified this. Coherence coverage
 * tracks which agent pairs have been examined.
 *
 * Coherence certificates are signed proof of verification,
 * stored as context descriptors with full provenance.
 */

import type { PGSLInstance } from './types.js';
import { resolve } from './lattice.js';
import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

export type CoherenceStatus = 'verified' | 'divergent' | 'unexamined';

export interface CoherenceCertificate {
  /** Unique ID for this certificate */
  readonly id: string;
  /** Agent A identifier */
  readonly agentA: string;
  /** Agent B identifier */
  readonly agentB: string;
  /** What was checked — the shared topic/object */
  readonly topic: string;
  /** Result */
  readonly status: CoherenceStatus;
  /** If verified: the shared structure (lattice meet content) */
  readonly sharedStructure?: string;
  /** If divergent: what specifically diverges */
  readonly obstruction?: CoherenceObstruction;
  /** When the check was performed */
  readonly verifiedAt: string;
  /** Signature of the verifying agent (if signed) */
  readonly signature?: string;
  /** Hash of the verification computation (replayable) */
  readonly computationHash: string;
}

export interface CoherenceObstruction {
  /** What kind of divergence */
  readonly type: 'term-mismatch' | 'structure-mismatch' | 'frame-incompatible';
  /** Human-readable description */
  readonly description: string;
  /** The specific items that diverge */
  readonly divergentItems: string[];
}

export interface CoherenceCoverage {
  /** Total number of agent pairs */
  readonly totalPairs: number;
  /** Number of verified pairs */
  readonly verified: number;
  /** Number of divergent pairs */
  readonly divergent: number;
  /** Number of unexamined pairs */
  readonly unexamined: number;
  /** Coverage ratio: (verified + divergent) / total — how much has been examined */
  readonly coverage: number;
  /** The unexamined pairs (the dangerous ones) */
  readonly unexaminedPairs: ReadonlyArray<{ agentA: string; agentB: string }>;
}

// ── Certificate Registry ───────────────────────────────────

const certificates = new Map<string, CoherenceCertificate>();

/**
 * Verify coherence between two agents' PGSL lattices.
 *
 * Checks whether two agents' ingested content shares structural
 * overlap (lattice meet exists) and whether the shared content
 * resolves to the same values.
 *
 * @param pgslA - Agent A's lattice
 * @param pgslB - Agent B's lattice
 * @param agentA - Agent A identifier
 * @param agentB - Agent B identifier
 * @param topic - What's being checked (e.g., "patient-status")
 */
export function verifyCoherence(
  pgslA: PGSLInstance,
  pgslB: PGSLInstance,
  agentA: string,
  agentB: string,
  topic: string,
): CoherenceCertificate {
  // Find atoms that exist in both lattices
  const sharedAtoms: string[] = [];
  const divergentAtoms: string[] = [];

  for (const [valueA] of pgslA.atoms) {
    if (pgslB.atoms.has(valueA)) {
      sharedAtoms.push(valueA);
    }
  }

  // For shared atoms, check if they participate in the same structures
  const sharedFragments: string[] = [];
  for (const [keyA, uriA] of pgslA.fragments) {
    if (pgslB.fragments.has(keyA)) {
      // Same item sequence exists in both lattices
      const resolvedA = resolve(pgslA, uriA);
      const resolvedB = resolve(pgslB, pgslB.fragments.get(keyA)!);
      if (resolvedA === resolvedB) {
        sharedFragments.push(resolvedA);
      } else {
        divergentAtoms.push(`${resolvedA} ≠ ${resolvedB}`);
      }
    }
  }

  const now = new Date().toISOString();
  const computationData = `${agentA}|${agentB}|${topic}|${sharedAtoms.join(',')}|${sharedFragments.join(',')}|${divergentAtoms.join(',')}|${now}`;
  const computationHash = createHash('sha256').update(computationData).digest('hex').slice(0, 40);

  let status: CoherenceStatus;
  let obstruction: CoherenceObstruction | undefined;
  let sharedStructure: string | undefined;

  if (sharedAtoms.length === 0 && sharedFragments.length === 0) {
    // No overlap at all — can't verify coherence
    status = 'unexamined';
  } else if (divergentAtoms.length > 0) {
    status = 'divergent';
    obstruction = {
      type: sharedFragments.length > 0 ? 'term-mismatch' : 'structure-mismatch',
      description: `${divergentAtoms.length} divergence(s) found in shared structure`,
      divergentItems: divergentAtoms,
    };
  } else {
    status = 'verified';
    sharedStructure = `${sharedAtoms.length} shared atoms, ${sharedFragments.length} shared fragments`;
  }

  const cert: CoherenceCertificate = {
    id: `cert:${computationHash.slice(0, 16)}`,
    agentA,
    agentB,
    topic,
    status,
    sharedStructure,
    obstruction,
    verifiedAt: now,
    computationHash,
  };

  // Store the certificate
  const pairKey = [agentA, agentB].sort().join('|');
  certificates.set(`${pairKey}:${topic}`, cert);

  return cert;
}

/**
 * Compute coherence coverage across a set of agents.
 *
 * Returns the ratio of examined-to-total agent pairs,
 * and identifies which pairs are unexamined (the dangerous state).
 */
export function computeCoverage(agents: string[]): CoherenceCoverage {
  const pairs: Array<{ agentA: string; agentB: string }> = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      pairs.push({ agentA: agents[i]!, agentB: agents[j]! });
    }
  }

  let verified = 0;
  let divergent = 0;
  const unexaminedPairs: Array<{ agentA: string; agentB: string }> = [];

  for (const pair of pairs) {
    const pairKey = [pair.agentA, pair.agentB].sort().join('|');
    // Check if any certificate exists for this pair
    let hasExamined = false;
    for (const [key] of certificates) {
      if (key.startsWith(pairKey + ':')) {
        const cert = certificates.get(key)!;
        if (cert.status === 'verified') verified++;
        else if (cert.status === 'divergent') divergent++;
        hasExamined = true;
        break;
      }
    }
    if (!hasExamined) {
      unexaminedPairs.push(pair);
    }
  }

  const totalPairs = pairs.length;
  const coverage = totalPairs > 0 ? (verified + divergent) / totalPairs : 1;

  return {
    totalPairs,
    verified,
    divergent,
    unexamined: unexaminedPairs.length,
    coverage,
    unexaminedPairs,
  };
}

/**
 * Get all coherence certificates.
 */
export function getCertificates(): CoherenceCertificate[] {
  return [...certificates.values()];
}

/**
 * Get the coherence status between two specific agents.
 */
export function getCoherenceStatus(agentA: string, agentB: string): CoherenceStatus {
  const pairKey = [agentA, agentB].sort().join('|');
  for (const [key, cert] of certificates) {
    if (key.startsWith(pairKey + ':')) {
      return cert.status;
    }
  }
  return 'unexamined';
}
