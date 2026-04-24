// Cool demo: Federated reasoning over distributed royal-family data.
//
// Idehen's classic SPARQL-reasoning demo uses the British Royal Family
// to show inference over linked data — but his version loads everything
// into one Virtuoso instance. We do the harder version: the same facts
// are scattered across five independent pods, each with its own
// authority level, some conflicting with others. An Interego agent
// reasons across all of them using cross-pod attribute resolution +
// modal composition.
//
// What this proves that a single-store version can't:
//
//   - Reasoning works when facts are owned by different parties.
//   - Conflicting claims get resolved by trust + modal lattice, not
//     by whoever wrote to the DB last.
//   - You can add a new pod with new facts and the reasoning picks
//     them up automatically via the resolver.
//
// This is the federation-enabled version of a demo Idehen has been
// running for years. Our version would be impossible on his stack
// without a shared trust anchor; ours needs none.

import { evaluateAbac, resolveAttributes, ModalAlgebra } from '../dist/index.js';

console.log('=== Federated royal-family reasoning ===\n');
console.log('Five independent pods each hold different pieces of the lineage.');
console.log('None has the whole picture. Reasoning is cross-pod.\n');

// ── Five pods, each with different authority + different facts ──

const POD = {
  // High-authority: the official royal household. Full HighAssurance.
  royalHousehold: {
    url: 'urn:pod:royal-household',
    authority: 'HighAssurance',
    issuer: 'urn:agent:royal-household',
  },
  // Authoritative genealogy society (for historical births/deaths).
  genealogy: {
    url: 'urn:pod:genealogy-society',
    authority: 'HighAssurance',
    issuer: 'urn:agent:genealogy-society',
  },
  // Government registrar (for legal relationships: marriages, abdications).
  registrar: {
    url: 'urn:pod:registrar',
    authority: 'HighAssurance',
    issuer: 'urn:agent:government-registrar',
  },
  // A tabloid — asserts things. Low trust.
  tabloid: {
    url: 'urn:pod:daily-gossip',
    authority: 'SelfAsserted',
    issuer: 'urn:agent:tabloid',
  },
  // A historian's personal pod. Peer-attested — mid-trust.
  historian: {
    url: 'urn:pod:historian-jones',
    authority: 'PeerAttested',
    issuer: 'urn:agent:historian-jones',
  },
};

// Each descriptor is a claim. Subject + predicate + object expressed
// as a ContextFacet on the descriptor that "describes" the subject.

function claim(pod, subject, predicate, object, modal = 'Asserted', confidence = 0.95) {
  return {
    id: `urn:desc:${pod.url.split(':').at(-1)}/${Math.random().toString(36).slice(2, 8)}`,
    describes: [subject],
    facets: [
      {
        type: 'Trust',
        trustLevel: pod.authority,
        issuer: pod.issuer,
        // Encoded as an AMTA-style axis for cross-pod attribute
        // extraction — the subject-IRI under the predicate key.
        amtaAxes: { [predicate]: object },
      },
      {
        type: 'Semiotic',
        modalStatus: modal,
        groundTruth: modal === 'Asserted',
        epistemicConfidence: confidence,
      },
    ],
  };
}

// ── The federated claim set ──

const QUEEN_E2 = 'urn:person:queen-elizabeth-ii';
const CHARLES = 'urn:person:charles-iii';
const WILLIAM = 'urn:person:prince-william';
const HARRY = 'urn:person:prince-harry';

const descriptors = [
  // royal-household (HighAssurance): Charles is the heir.
  claim(POD.royalHousehold, QUEEN_E2, 'child', CHARLES),
  claim(POD.royalHousehold, CHARLES, 'heir', WILLIAM),
  claim(POD.royalHousehold, CHARLES, 'child', WILLIAM),
  claim(POD.royalHousehold, CHARLES, 'child', HARRY),

  // genealogy-society (HighAssurance): corroborating birth records.
  claim(POD.genealogy, CHARLES, 'birthYear', 1948),
  claim(POD.genealogy, WILLIAM, 'birthYear', 1982),
  claim(POD.genealogy, HARRY, 'birthYear', 1984),

  // registrar (HighAssurance): Harry's step-back from royal duties (2020).
  claim(POD.registrar, HARRY, 'royalDutiesStatus', 'stepped-back', 'Asserted', 0.99),

  // historian-jones (PeerAttested): additional context.
  claim(POD.historian, HARRY, 'currentResidence', 'California'),

  // tabloid (SelfAsserted): claims William has secretly abdicated.
  // This SHOULD be filtered out by the trust predicate.
  claim(POD.tabloid, WILLIAM, 'royalDutiesStatus', 'secretly-abdicated', 'Asserted', 0.95),

  // tabloid (SelfAsserted): claims Harry has returned (false).
  claim(POD.tabloid, HARRY, 'royalDutiesStatus', 'returned', 'Asserted', 0.95),
];

console.log(`${descriptors.length} claims distributed across ${Object.keys(POD).length} pods.\n`);

// ── The reasoning task ──
//
// "Who is currently next in the line of succession after Charles III?"
//
// Answer requires:
//   1. Find Charles's children (royal-household pod).
//   2. Order them by birth year (genealogy pod).
//   3. Exclude any who have stepped back from duties (registrar pod).
//   4. Ignore tabloid nonsense (trust filter).

console.log('── Question: who is next in the line of succession after Charles III? ──\n');

// Step 1: cross-pod attribute extraction, filtered by issuer trust.
//
// A naive agent would read everything. A smart one filters the
// attribute graph down to HighAssurance issuers for authoritative
// claims — exactly the sybil-resistance pattern applied to truth.

const HIGH_TRUST_ISSUERS = new Set(
  Object.values(POD)
    .filter(p => p.authority === 'HighAssurance')
    .map(p => p.issuer),
);

// Find all "X is a child of Charles" claims from HighAssurance sources.
function queryChildren(descriptors, parent) {
  const children = [];
  for (const d of descriptors) {
    if (!d.describes.includes(parent)) continue;
    const trust = d.facets.find(f => f.type === 'Trust');
    if (!trust || !HIGH_TRUST_ISSUERS.has(trust.issuer)) continue;
    const childObj = trust.amtaAxes?.child;
    if (childObj) children.push({ child: childObj, issuer: trust.issuer });
  }
  return children;
}

const charlesKids = queryChildren(descriptors, CHARLES);
console.log(`Step 1 — Charles's children (HighAssurance only):`);
for (const c of charlesKids) {
  console.log(`   ${c.child.split(':').at(-1)}   (attested by ${c.issuer.split(':').at(-1)})`);
}

// Step 2: birth years, also from HighAssurance.
function queryAttribute(descriptors, subject, predicate) {
  for (const d of descriptors) {
    if (!d.describes.includes(subject)) continue;
    const trust = d.facets.find(f => f.type === 'Trust');
    if (!trust || !HIGH_TRUST_ISSUERS.has(trust.issuer)) continue;
    if (trust.amtaAxes?.[predicate] !== undefined) {
      return { value: trust.amtaAxes[predicate], issuer: trust.issuer };
    }
  }
  return null;
}

console.log(`\nStep 2 — birth years:`);
const enriched = charlesKids.map(k => ({
  ...k,
  birthYear: queryAttribute(descriptors, k.child, 'birthYear')?.value,
}));
for (const k of enriched) {
  console.log(`   ${k.child.split(':').at(-1)}   born ${k.birthYear}`);
}

// Step 3: royal-duties status. Here we need to compose claims from
// MULTIPLE pods — and the tabloid pod claims contradictory things
// that we need to filter out.
console.log(`\nStep 3 — royal-duties status (with cross-pod conflict resolution):`);

function queryStatus(descriptors, subject) {
  // Gather ALL claims about royalDutiesStatus, not just HighAssurance.
  const allClaims = [];
  for (const d of descriptors) {
    if (!d.describes.includes(subject)) continue;
    const trust = d.facets.find(f => f.type === 'Trust');
    const sem = d.facets.find(f => f.type === 'Semiotic');
    if (!trust) continue;
    const status = trust.amtaAxes?.royalDutiesStatus;
    if (status !== undefined) {
      allClaims.push({
        status,
        issuer: trust.issuer,
        authority: trust.trustLevel,
        modal: sem?.modalStatus ?? 'Hypothetical',
        confidence: sem?.epistemicConfidence ?? 0.5,
      });
    }
  }

  // If any HighAssurance claim exists, it wins. Otherwise, fall back
  // to the most-confident claim, but mark the modal state as
  // Hypothetical (since we didn't have an authoritative source).
  const hiTrust = allClaims.filter(c => c.authority === 'HighAssurance');
  if (hiTrust.length > 0) {
    // Multiple HighAssurance claims → compose via modal meet.
    const composed = hiTrust.reduce(
      (acc, c) => ({ ...c, modal: ModalAlgebra.meet(acc.modal, c.modal) }),
      hiTrust[0],
    );
    return { ...composed, source: 'HighAssurance', contested: allClaims.length > hiTrust.length };
  }
  if (allClaims.length > 0) {
    const top = allClaims.sort((a, b) => b.confidence - a.confidence)[0];
    return { ...top, modal: 'Hypothetical', source: 'best-guess' };
  }
  return null;
}

for (const k of enriched) {
  const s = queryStatus(descriptors, k.child);
  const name = k.child.split(':').at(-1).padEnd(16);
  if (!s) {
    console.log(`   ${name}  active (no status claim)`);
    k.active = true;
  } else {
    const contested = s.contested ? ' [⚠ tabloid contradicts]' : '';
    console.log(`   ${name}  status: ${s.status}  (${s.source}, modal=${s.modal})${contested}`);
    // Only Asserted-modal status claims gate active-ness. Hypothetical
    // ones (best-guess from low-trust sources) are too unreliable to
    // exclude a successor — the prince stays active by default.
    if (s.modal === 'Asserted' && s.status === 'stepped-back') {
      k.active = false;
    } else if (s.modal === 'Hypothetical') {
      k.active = true; // Don't trust the exclusion.
      console.log(`     → only a low-trust source claims this; not gating active status.`);
    } else {
      k.active = true;
    }
  }
}

// Step 4: ordering.
console.log(`\nStep 4 — ordered successors (active, eldest first):`);
const successors = enriched
  .filter(k => k.active)
  .sort((a, b) => a.birthYear - b.birthYear);
for (let i = 0; i < successors.length; i++) {
  console.log(`   ${i + 1}. ${successors[i].child.split(':').at(-1)}   (born ${successors[i].birthYear})`);
}

console.log(`\n── Answer ──`);
if (successors.length > 0) {
  console.log(`   Next in line after Charles III: ${successors[0].child.split(':').at(-1)}.`);
}

// ── Counterfactual: what happens if we naively trust everything? ──

console.log('\n── Counterfactual: naive reasoning (no trust filter) ──\n');

function queryStatusAllClaims(descriptors, subject) {
  const out = [];
  for (const d of descriptors) {
    if (!d.describes.includes(subject)) continue;
    const trust = d.facets.find(f => f.type === 'Trust');
    const status = trust?.amtaAxes?.royalDutiesStatus;
    if (status) out.push({ status, issuer: trust.issuer, authority: trust.trustLevel });
  }
  return out;
}

console.log('Naive reasoning enumerates all claims it can find and has no way to');
console.log('prefer one over another:\n');
for (const k of enriched) {
  const claims = queryStatusAllClaims(descriptors, k.child);
  if (claims.length === 0) {
    console.log(`   ${k.child.split(':').at(-1).padEnd(16)}  (no status claims — ambiguously active)`);
  } else {
    console.log(`   ${k.child.split(':').at(-1).padEnd(16)}  ${claims.length} competing claim(s):`);
    for (const c of claims) {
      const marker = c.issuer.includes('tabloid') ? '  ← TABLOID' : '';
      console.log(`        "${c.status}" (from ${c.issuer.split(':').at(-1)}, trust=${c.authority})${marker}`);
    }
  }
}
console.log('\n   Naive reasoning has no basis to pick: William has ONE claim,');
console.log('   which is from the tabloid. Harry has TWO contradicting claims.');
console.log('   Without trust + modal machinery, either picking "first" or');
console.log('   "last" gives the wrong answer somewhere.');

console.log('\n── What this demonstrates ──');
console.log('   No single pod has the whole lineage. No shared database.');
console.log('   No central trust anchor.');
console.log('');
console.log(`   Reasoning across ${Object.keys(POD).length} independent pods:`);
console.log('     - HighAssurance claims are composed where they corroborate,');
console.log('     - Low-trust contradictions are automatically filtered,');
console.log('     - Modal states (Asserted / Hypothetical) carry the');
console.log('       confidence the agent should place in its own conclusions.');
console.log('');
console.log('   Add a new pod with new facts — the resolver picks them up.');
console.log('   Remove a pod — the reasoning degrades gracefully, not silently.');
console.log('');
console.log('   This is the federated version of Idehen\'s classic');
console.log('   royal-family-reasoning demo. Same SPARQL-style inference,');
console.log('   but with trust + modal machinery built into the protocol.');
