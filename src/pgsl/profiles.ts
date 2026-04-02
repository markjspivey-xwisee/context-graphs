/**
 * @module pgsl/profiles
 * @description Ingestion profiles for domain-specific data formats.
 *
 * PGSL is the substrate — format-agnostic, content-addressed.
 * Ingestion profiles define how domain-specific data maps onto
 * the PGSL lattice, preserving domain semantics as structural
 * nesting in the lattice.
 *
 * Each profile:
 *   1. Parses raw domain data (JSON, RDF, etc.)
 *   2. Transforms it into a structured representation
 *   3. Ingests via embedInPGSL with 'structured' granularity
 *
 * The structured representation preserves domain groupings as
 * nested PGSL fragments. Inner structures become atoms at the
 * outer level — their content is content-addressed and reused
 * across statements that share the same sub-structure.
 *
 * Profiles:
 *   xapi   — actor/verb/object/result/context nesting
 *   lers   — issuer/subject/achievement/evidence nesting
 *   rdf    — subject/predicate/object triple structure
 *   raw    — flat word tokenization (default, no structure)
 *
 * Users can register custom profiles for their domains.
 */

import type { IRI } from '../model/types.js';
import type { PGSLInstance, NodeProvenance } from './types.js';
import { embedInPGSL } from './geometric.js';

// ── Profile Interface ──────────────────────────────────────

export interface IngestionProfile {
  /** Profile name (e.g., 'xapi', 'lers', 'rdf') */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /**
   * Transform raw input into a structured string for PGSL ingestion.
   * Returns a string in nested paren notation: ((a,b),(c,d))
   * that embedInPGSL with 'structured' granularity will recursively ingest.
   */
  transform(input: unknown): string;
}

// ── Profile Registry ───────────────────────────────────────

const profileRegistry = new Map<string, IngestionProfile>();

export function registerProfile(profile: IngestionProfile): void {
  profileRegistry.set(profile.name, profile);
}

export function getProfile(name: string): IngestionProfile | undefined {
  return profileRegistry.get(name);
}

export function listProfiles(): string[] {
  return [...profileRegistry.keys()];
}

/**
 * Ingest data using a named profile.
 * Transforms via the profile, then ingests with structured tokenization.
 */
export function ingestWithProfile(
  pgsl: PGSLInstance,
  profileName: string,
  input: unknown,
  _provenance?: NodeProvenance,
): IRI {
  const profile = profileRegistry.get(profileName);
  if (!profile) throw new Error(`Unknown ingestion profile: ${profileName}`);

  const structured = profile.transform(input);
  return embedInPGSL(pgsl, structured, undefined, 'structured');
}

// ── xAPI Profile ───────────────────────────────────────────

export interface XapiStatement {
  actor: { name?: string; mbox?: string; account?: { name: string; homePage: string } };
  verb: { id: string; display?: Record<string, string> };
  object: { id: string; definition?: { name?: Record<string, string>; type?: string } };
  result?: { score?: { scaled?: number; raw?: number; max?: number }; success?: boolean; duration?: string; completion?: boolean };
  timestamp?: string;
  context?: { platform?: string; instructor?: { name?: string; mbox?: string }; registration?: string; extensions?: Record<string, unknown> };
}

/**
 * xAPI ingestion profile.
 *
 * Transforms an xAPI JSON statement into structured PGSL notation:
 *   ((actor name), (verb display), (object name), (score, success, duration))
 *
 * Each component becomes a nested fragment in the lattice:
 *   - Actor fragment: content-addressed by actor name
 *   - Verb atom: the verb display text (e.g., "completed")
 *   - Object fragment: content-addressed by activity name
 *   - Result fragment: score + success + duration
 *
 * Shared components across statements reuse the same content-addressed URIs.
 * Two learners who "completed" the same activity share both the verb atom
 * AND the object fragment — structural overlap at the right granularity.
 */
const xapiProfile: IngestionProfile = {
  name: 'xapi',
  description: 'xAPI (Experience API) statement: actor/verb/object/result structure',

  transform(input: unknown): string {
    const stmt = input as XapiStatement;

    // Actor: name or mbox or account
    const actorName = stmt.actor.name
      ?? stmt.actor.mbox?.replace('mailto:', '')
      ?? stmt.actor.account?.name
      ?? 'unknown';

    // Verb: display text (prefer en-US) or extract from URI
    const verbDisplay = stmt.verb.display?.['en-US']
      ?? stmt.verb.display?.[Object.keys(stmt.verb.display)[0] ?? '']
      ?? stmt.verb.id.split('/').pop()
      ?? 'unknown';

    // Object: activity name or ID
    const objectName = stmt.object.definition?.name?.['en-US']
      ?? stmt.object.definition?.name?.[Object.keys(stmt.object.definition?.name ?? {})[0] ?? '']
      ?? stmt.object.id.split('/').pop()?.replace(/-/g, ' ')
      ?? 'unknown';

    // Result: score, success, duration (if present)
    const resultParts: string[] = [];
    if (stmt.result) {
      if (stmt.result.score?.raw !== undefined) resultParts.push(String(stmt.result.score.raw));
      else if (stmt.result.score?.scaled !== undefined) resultParts.push(String(Math.round(stmt.result.score.scaled * 100)));
      if (stmt.result.success !== undefined) resultParts.push(stmt.result.success ? 'passed' : 'failed');
      if (stmt.result.duration) resultParts.push(stmt.result.duration);
    }

    // Build structured notation
    // Actor words become a nested fragment
    const actorPart = `(${actorName.split(/\s+/).join(',')})`;
    // Verb is a single atom
    const verbPart = verbDisplay;
    // Object words become a nested fragment
    const objectPart = `(${objectName.split(/\s+/).join(',')})`;
    // Result becomes a nested fragment (if present)
    const resultPart = resultParts.length > 0 ? `(${resultParts.join(',')})` : '';

    // Outer structure: (actor, verb, object[, result])
    const parts = [actorPart, verbPart, objectPart];
    if (resultPart) parts.push(resultPart);

    return `(${parts.join(',')})`;
  },
};

// ── LERS Profile ───────────────────────────────────────────

export interface LersCredential {
  issuer: string;
  subject: { name: string; id?: string };
  achievement: { name: string; level?: string; framework?: string; criteria?: string };
  evidence?: { sources?: string[]; statementCount?: number; averageScore?: number };
  issuanceDate?: string;
  expirationDate?: string;
}

/**
 * IEEE LERS ingestion profile.
 *
 * Transforms a LERS credential into structured PGSL notation:
 *   ((issuer), (subject name), (achievement name, level, framework), (evidence sources))
 *
 * The achievement fragment is content-addressed — two credentials for the
 * same achievement (e.g., "USAF Instrument Rating, Proficient") share
 * the same fragment URI regardless of who earned it.
 */
const lersProfile: IngestionProfile = {
  name: 'lers',
  description: 'IEEE LERS (Learning & Employment Record): issuer/subject/achievement/evidence structure',

  transform(input: unknown): string {
    const cred = input as LersCredential;

    const issuerPart = `(${cred.issuer.split(/[\s/:]+/).filter(s => s.length > 1).join(',')})`;
    const subjectPart = `(${cred.subject.name.split(/\s+/).join(',')})`;

    const achieveParts = [cred.achievement.name];
    if (cred.achievement.level) achieveParts.push(cred.achievement.level);
    if (cred.achievement.framework) achieveParts.push(cred.achievement.framework);
    const achievePart = `(${achieveParts.join(',')})`;

    const parts = [issuerPart, subjectPart, achievePart];

    if (cred.evidence) {
      const evidenceParts: string[] = [];
      if (cred.evidence.statementCount !== undefined) evidenceParts.push(`${cred.evidence.statementCount} statements`);
      if (cred.evidence.averageScore !== undefined) evidenceParts.push(`avg ${cred.evidence.averageScore}`);
      if (evidenceParts.length > 0) {
        parts.push(`(${evidenceParts.join(',')})`);
      }
    }

    return `(${parts.join(',')})`;
  },
};

// ── RDF Triple Profile ─────────────────────────────────────

export interface RdfTriple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * RDF triple ingestion profile.
 *
 * Transforms an RDF triple into structured PGSL notation:
 *   ((subject words), (predicate words), (object words))
 *
 * Each component is a nested fragment. The predicate "is_a" shared
 * across triples becomes a single content-addressed atom.
 */
const rdfProfile: IngestionProfile = {
  name: 'rdf',
  description: 'RDF triple: subject/predicate/object structure',

  transform(input: unknown): string {
    const triple = input as RdfTriple;

    // Extract local names from URIs
    const localName = (uri: string) => {
      const parts = uri.split(/[#/]/).pop() ?? uri;
      return parts.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    };

    const s = localName(triple.subject).split(/\s+/).join(',');
    const p = localName(triple.predicate).split(/\s+/).join(',');
    const o = localName(triple.object).split(/\s+/).join(',');

    return `((${s}),(${p}),(${o}))`;
  },
};

// ── Raw Profile (default) ──────────────────────────────────

const rawProfile: IngestionProfile = {
  name: 'raw',
  description: 'Raw text: flat word tokenization, no structural nesting',

  transform(input: unknown): string {
    return String(input);
  },
};

// ── Register Built-in Profiles ─────────────────────────────

registerProfile(xapiProfile);
registerProfile(lersProfile);
registerProfile(rdfProfile);
registerProfile(rawProfile);

// ── Convenience: batch ingest ──────────────────────────────

/**
 * Ingest multiple items using the same profile.
 * Returns URIs for all ingested items.
 */
export function batchIngestWithProfile(
  pgsl: PGSLInstance,
  profileName: string,
  inputs: unknown[],
): IRI[] {
  return inputs.map(input => ingestWithProfile(pgsl, profileName, input));
}
