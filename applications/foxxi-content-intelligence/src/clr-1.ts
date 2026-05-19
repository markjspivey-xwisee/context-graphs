/**
 * 1EdTech Comprehensive Learner Record 1.0 — legacy pre-VC exporter.
 *
 * Some institutional consumers still want the CLR 1.0 JSON format
 * (achievements + accomplishments + learner blocks, HMAC or RSA
 * signature). This exporter projects the same in-pod credentials
 * we already aggregate for CLR 2.0 into the older shape.
 *
 * For CLR 1.0 we don't re-sign — the institutional consumer of the
 * 1.0 payload typically applies its own institutional signing. The
 * payload is provided as plaintext JSON; the operator wraps as needed.
 *
 * Standards reference:
 *   - 1EdTech CLR 1.0 (https://www.imsglobal.org/spec/clr/v1p0)
 */

import type { ClrEnvelope } from './clr.js';

export interface Clr1Document {
  type: string;
  id: string;
  learner: {
    id: string;
    name?: string;
  };
  issuer?: {
    id: string;
  };
  issuedOn: string;
  achievements: Clr1Achievement[];
  associations?: Clr1Association[];
}

export interface Clr1Achievement {
  id: string;
  type: string;
  name: string;
  description?: string;
  issuedOn?: string;
  issuer?: { id: string };
  criteriaNarrative?: string;
  alignments?: Array<{ targetCode: string; targetName: string }>;
}

export interface Clr1Association {
  associationType: string;
  source: string;
  target: string;
}

/**
 * Project a CLR 2.0 envelope (produced by clr.ts) into CLR 1.0 JSON.
 * The 2.0 envelope already aggregated the credentials + verified them;
 * this is a lossy shape-only projection for legacy consumers.
 */
export function envelopeToClr1(envelope: ClrEnvelope): Clr1Document {
  const achievements: Clr1Achievement[] = [];
  for (const entry of envelope.credentialEntries) {
    if (!entry.verified) continue;
    const subj = entry.credential.credentialSubject as {
      achievement?: {
        id?: string;
        name?: string;
        description?: string;
        criteria?: { narrative?: string };
        alignment?: Array<{ targetCode?: string; targetName?: string }>;
      };
    };
    const a = subj.achievement;
    if (!a?.name) continue;
    achievements.push({
      id: a.id ?? `urn:foxxi:clr1:achievement:${achievements.length}`,
      type: 'Achievement',
      name: a.name,
      ...(a.description ? { description: a.description } : {}),
      issuedOn: entry.credential.validFrom,
      issuer: { id: entry.credential.issuer },
      ...(a.criteria?.narrative ? { criteriaNarrative: a.criteria.narrative } : {}),
      ...(a.alignment ? { alignments: a.alignment.map(al => ({ targetCode: al.targetCode ?? '', targetName: al.targetName ?? '' })) } : {}),
    });
  }
  return {
    type: 'CLR',
    id: envelope.id.replace(':clr:', ':clr1:'),
    learner: { id: envelope.holderDid },
    issuedOn: envelope.exportedAt,
    achievements,
  };
}
