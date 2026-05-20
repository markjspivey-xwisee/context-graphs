/**
 * Foxxi Enterprise Learner Record (ELR) assembler — IEEE P2997.
 *
 * IEEE P2997 "Standard for Enterprise Learner Record" (LTSC, ADL-chaired)
 * defines an ELR data model that "preserves data ownership by providing
 * indications to where raw learner data is stored" and tracks a learner's
 * path through organisations, learning experiences, demonstrated
 * competencies, conferred credentials, and employment history.
 *
 * This module COMPOSES that aggregate from primitives the substrate
 * already provides — it invents no new credential, xAPI, or competency
 * machinery:
 *
 *   experiences  ← Foxxi-as-LRS xAPI statements for the learner
 *                  (each is already a committed/Asserted claim).
 *   credentials  ← the learner's pod wallet, via exportClr() — the
 *                  existing discover() + Data-Integrity-verify path.
 *   competencies ← two provenance-distinct sources:
 *                    · Asserted    — alignments on *verified* credentials.
 *                    · Hypothetical — inferred from passed/completed xAPI
 *                      experiences that carry no credential yet. Modal
 *                      status keeps a prediction from masquerading as an
 *                      observed fact (cg:modalStatus, L1).
 *   provenance   ← P2997's hallmark: every entry points back to where
 *                  its raw record lives (pod descriptor URL, LRS, …).
 *
 * Pure read. No writes. The caller (or a transfer endpoint — P2997
 * Part 2) decides whether to publish the ELR as its own descriptor.
 */

import { exportClr, type ClrEnvelope } from './clr.js';
import type { StoredStatement } from './statement-store.js';

const ELR_CONTEXT = [
  'https://www.w3.org/ns/credentials/v2',
  'https://standards.ieee.org/ieee/2997/', // IEEE P2997 ELR
] as const;

const ADL = 'http://adlnet.gov/expapi/verbs/';
/** Verbs that imply the learner demonstrated something (→ inferred competency). */
const MASTERY_VERBS = new Set([`${ADL}passed`, `${ADL}completed`, `${ADL}mastered`]);

// ── ELR data model ──────────────────────────────────────────────────

export type ElrModalStatus = 'Asserted' | 'Hypothetical';

/** P2997: an organisation in the learner's path. */
export interface ElrOrganization {
  id: string;
  /** How this org appears in the record. */
  role: 'credential-issuer' | 'lrs-authority' | 'tenant';
}

/** A learning experience — projected from one xAPI statement. */
export interface ElrExperience {
  id: string;
  verb: string;
  verbDisplay: string;
  activityId: string;
  activityName?: string;
  timestamp: string;
  /** xAPI Statements are committed claims — always Asserted. */
  modalStatus: 'Asserted';
  /** Where the raw record lives (P2997 data-ownership pointer). */
  rawDataLocation: string;
}

/** A demonstrated or inferred competency. */
export interface ElrCompetency {
  id: string;
  label: string;
  /** Asserted = backed by a verified credential; Hypothetical = inferred
   *  from experience alone, not yet credentialed. */
  modalStatus: ElrModalStatus;
  framework?: string;
  proficiencyLevel?: string;
  /** IRIs/ids of the experiences or credential this competency rests on. */
  evidence: string[];
}

/** A conferred credential — thin projection of a wallet entry. */
export interface ElrCredential {
  id: string;
  achievementName?: string;
  issuer: string;
  verified: boolean;
  /** Pod descriptor URL — the raw record (P2997 data-ownership pointer). */
  rawDataLocation: string;
}

/** P2997: an indication of where a class of raw learner data is stored. */
export interface ElrRawDataLocation {
  kind: 'learner-pod' | 'lrs' | 'credential-descriptor';
  location: string;
  description: string;
}

export interface EnterpriseLearnerRecord {
  '@context': readonly string[];
  type: readonly string[];
  id: string;
  /** Declares the data model this aggregate conforms to. */
  conformsTo: string;
  learner: { did: string; name?: string };
  assembledAt: string;
  organizationPath: ElrOrganization[];
  experiences: ElrExperience[];
  competencies: ElrCompetency[];
  credentials: ElrCredential[];
  provenance: { rawDataLocations: ElrRawDataLocation[] };
  summary: {
    experienceCount: number;
    credentialCount: number;
    verifiedCredentialCount: number;
    competencyCount: number;
    assertedCompetencies: number;
    inferredCompetencies: number;
  };
}

export interface AssembleElrConfig {
  learnerDid: string;
  learnerName?: string;
  learnerPodUrl: string;
  /** The tenant whose bridge is assembling the record. */
  tenantDid: string;
  /** Foxxi-as-LRS endpoint — recorded as a raw-data location. */
  lrsEndpoint: string;
  /** The learner's xAPI statements (caller pulls them from the LRS store
   *  so this module stays pure + testable). */
  statements: readonly StoredStatement[];
  fetch?: typeof globalThis.fetch;
}

// ── Assembler ───────────────────────────────────────────────────────

/**
 * Assemble the learner's Enterprise Learner Record. Composes exportClr()
 * (wallet credentials) with the supplied xAPI experiences and derives
 * the competency set across both, modal-statusing each.
 */
export async function assembleEnterpriseLearnerRecord(
  config: AssembleElrConfig,
): Promise<EnterpriseLearnerRecord> {
  // 1. Credentials — reuse the existing CLR composer (discover + verify).
  let clr: ClrEnvelope | null = null;
  try {
    clr = await exportClr({
      learnerPodUrl: config.learnerPodUrl,
      learnerDid: config.learnerDid,
      fetch: config.fetch,
    });
  } catch {
    clr = null; // pod unreachable / empty — ELR still assembles from LRS
  }

  // 2. Experiences — project the learner's xAPI statements.
  const experiences: ElrExperience[] = [];
  for (const rec of config.statements) {
    if (rec.voided) continue;
    const s = rec.statement;
    const verb = (s.verb as { id?: string; display?: Record<string, string> } | undefined);
    const obj = (s.object as { id?: string; definition?: { name?: Record<string, string> } } | undefined);
    experiences.push({
      id: rec.id,
      verb: verb?.id ?? '',
      verbDisplay: verb?.display?.['en'] ?? verb?.display?.['en-US']
        ?? Object.values(verb?.display ?? {})[0] ?? verb?.id?.split('/').pop() ?? 'observed',
      activityId: obj?.id ?? '',
      activityName: obj?.definition?.name?.['en'] ?? obj?.definition?.name?.['en-US']
        ?? Object.values(obj?.definition?.name ?? {})[0],
      timestamp: (s.timestamp as string | undefined) ?? rec.stored,
      modalStatus: 'Asserted',
      rawDataLocation: `${config.lrsEndpoint}/xapi/statements?statementId=${rec.id}`,
    });
  }

  // 3. Competencies — Asserted from verified credentials' alignments…
  const competencies: ElrCompetency[] = [];
  const seenCompetency = new Set<string>();
  for (const entry of clr?.credentialEntries ?? []) {
    if (!entry.verified) continue;
    const subj = entry.credential.credentialSubject as {
      achievement?: { id?: string; alignment?: Array<{ targetCode?: string; targetName?: string; targetFramework?: string }> };
    };
    for (const a of subj.achievement?.alignment ?? []) {
      const id = a.targetCode ?? a.targetName ?? '';
      if (!id || seenCompetency.has(`A:${id}`)) continue;
      seenCompetency.add(`A:${id}`);
      competencies.push({
        id, label: a.targetName ?? id,
        modalStatus: 'Asserted',
        framework: a.targetFramework,
        evidence: [entry.credential.id ?? entry.sourceDescriptor],
      });
    }
  }
  // …and Hypothetical, inferred from mastery-verb experiences that no
  // credential covers. cg:modalStatus keeps the prediction honest.
  for (const exp of experiences) {
    if (!MASTERY_VERBS.has(exp.verb)) continue;
    const label = exp.activityName ?? exp.activityId.split(/[#/]/).pop() ?? exp.activityId;
    const key = `H:${exp.activityId}`;
    if (!label || seenCompetency.has(key) || seenCompetency.has(`A:${label}`)) continue;
    seenCompetency.add(key);
    competencies.push({
      id: exp.activityId,
      label: `Demonstrated: ${label}`,
      modalStatus: 'Hypothetical',
      evidence: experiences.filter(e => e.activityId === exp.activityId && MASTERY_VERBS.has(e.verb)).map(e => e.id),
    });
  }

  // 4. Credentials projection.
  const credentials: ElrCredential[] = (clr?.credentialEntries ?? []).map(e => {
    const subj = e.credential.credentialSubject as { achievement?: { name?: string } };
    return {
      id: e.credential.id ?? e.sourceDescriptor,
      achievementName: subj.achievement?.name,
      issuer: typeof e.credential.issuer === 'string' ? e.credential.issuer : '',
      verified: e.verified,
      rawDataLocation: e.sourceDescriptor,
    };
  });

  // 5. Organisation path — distinct orgs the learner has records with.
  const orgs = new Map<string, ElrOrganization>();
  orgs.set(config.tenantDid, { id: config.tenantDid, role: 'tenant' });
  for (const c of credentials) {
    if (c.issuer && !orgs.has(c.issuer)) orgs.set(c.issuer, { id: c.issuer, role: 'credential-issuer' });
  }
  if (!orgs.has(config.lrsEndpoint)) {
    orgs.set(config.lrsEndpoint, { id: config.lrsEndpoint, role: 'lrs-authority' });
  }

  // 6. Provenance — P2997 raw-data-location indications.
  const rawDataLocations: ElrRawDataLocation[] = [
    { kind: 'learner-pod', location: config.learnerPodUrl, description: 'Learner-owned pod — credentials + competency assertions (the authoritative wallet).' },
    { kind: 'lrs', location: `${config.lrsEndpoint}/xapi/statements`, description: 'Foxxi-as-LRS — raw xAPI experience statements.' },
  ];
  for (const c of credentials) {
    rawDataLocations.push({ kind: 'credential-descriptor', location: c.rawDataLocation, description: `Pod descriptor for credential ${c.achievementName ?? c.id}.` });
  }

  return {
    '@context': ELR_CONTEXT,
    type: ['VerifiablePresentation', 'EnterpriseLearnerRecord'],
    id: `urn:foxxi:elr:${slugDid(config.learnerDid)}:${Date.now()}`,
    conformsTo: 'IEEE P2997 — Enterprise Learner Record (data model, Part 1)',
    learner: { did: config.learnerDid, name: config.learnerName },
    assembledAt: new Date().toISOString(),
    organizationPath: [...orgs.values()],
    experiences,
    competencies,
    credentials,
    provenance: { rawDataLocations },
    summary: {
      experienceCount: experiences.length,
      credentialCount: credentials.length,
      verifiedCredentialCount: credentials.filter(c => c.verified).length,
      competencyCount: competencies.length,
      assertedCompetencies: competencies.filter(c => c.modalStatus === 'Asserted').length,
      inferredCompetencies: competencies.filter(c => c.modalStatus === 'Hypothetical').length,
    },
  };
}

function slugDid(did: string): string {
  return did.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
}
