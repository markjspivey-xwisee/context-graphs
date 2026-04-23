// Cool test: Sybil-resistant ABAC.
//
// Attack surface: a policy like "require ≥ 2 peer attestations of
// codeQuality ≥ 0.8" is trivially bypassed if anyone can create
// infinite identities and self-issue attestations from each one.
// That's a sybil attack. The attack works at the attribute-resolver
// layer: all attestations about the subject are aggregated, so five
// fake peers claiming alice is qualified count the same as two real
// ones.
//
// Defense: filter the attribute resolution by the ATTESTOR's own
// trustworthiness. Only attestations from issuers who themselves
// hold a trust attestation ≥ HighAssurance count. Sybil attackers
// typically don't have this — they're self-asserted entities.
//
// The defense uses only existing primitives:
//   - The attribute resolver already tracks source-descriptor IRIs
//   - filterAttributeGraph lets us drop facets by a source predicate
//   - The policy itself doesn't change
//
// This is the composition story: a real security property
// (sybil resistance) emerges from composing the resolver + filter
// + existing ABAC policy, not from a bespoke sybil-defense module.

import {
  evaluateAbac,
  resolveAttributes,
  filterAttributeGraph,
  extractAttribute,
} from '../dist/index.js';

const NOW = '2026-04-23T12:00:00Z';
const ALICE = 'urn:agent:alice';
const RESOURCE = 'urn:code:pr:42';
const ACTION = 'urn:action:code:merge';

console.log('=== Sybil-resistant ABAC: attack + defense ===\n');

// ── The policy (unchanged across the three acts) ────────────

const qualityShape = {
  iri: 'urn:shape:QualifiedReviewer',
  constraints: [
    { path: 'amta:codeQuality', minCount: 2, minInclusive: 0.8,
      message: 'need ≥ 2 codeQuality attestations ≥ 0.8' },
  ],
};

const mergePolicy = {
  id: 'urn:policy:permit-qualified-merge',
  policyPredicateShape: qualityShape.iri,
  governedAction: ACTION,
  deonticMode: 'Permit',
};

const predicates = new Map([[qualityShape.iri, qualityShape]]);

// ── Act 1: Honest case — 2 real peer attestations ──────────

console.log('── Act 1 — Honest case ──\n');

const aliceSelf = {
  id: 'urn:desc:alice-self',
  describes: [ALICE],
  facets: [{ type: 'Trust', trustLevel: 'SelfAsserted', issuer: ALICE }],
};

// Two real peers. Each has their OWN HighAssurance trust standing.
const bobAttestsAlice = {
  id: 'urn:desc:bob->alice',
  describes: [ALICE],
  facets: [{
    type: 'Trust', trustLevel: 'PeerAttested',
    issuer: 'urn:agent:bob',
    amtaAxes: { codeQuality: 0.88 },
  }],
};

const carolAttestsAlice = {
  id: 'urn:desc:carol->alice',
  describes: [ALICE],
  facets: [{
    type: 'Trust', trustLevel: 'PeerAttested',
    issuer: 'urn:agent:carol',
    amtaAxes: { codeQuality: 0.92 },
  }],
};

// The issuers' own trust standings (resolved separately).
const issuerTrustRegistry = new Map([
  ['urn:agent:bob',   { trustLevel: 'HighAssurance' }],
  ['urn:agent:carol', { trustLevel: 'HighAssurance' }],
  ['urn:agent:alice', { trustLevel: 'SelfAsserted' }],
]);

function honestEval() {
  const graph = resolveAttributes(ALICE, [aliceSelf, bobAttestsAlice, carolAttestsAlice]);
  const qs = extractAttribute(graph, 'amta:codeQuality');
  console.log(`   attestations aggregated: ${qs.length}  (values: ${qs.join(', ')})`);
  const decision = evaluateAbac([mergePolicy], predicates, {
    subject: ALICE, subjectAttributes: graph,
    resource: RESOURCE, action: ACTION, now: NOW,
  });
  console.log(`   verdict: ${decision.verdict} — ${decision.reason}\n`);
  return decision;
}
honestEval();

// ── Act 2: Sybil attack — 5 fake identities, no filtering ──

console.log('── Act 2 — Sybil attack (no defense) ──\n');

// Attacker generates 5 fake identities, each self-asserted only,
// each issuing an attestation about alice claiming high quality.
// In reality alice and the attacker might be the same person.
const fakeIssuers = ['sybil1', 'sybil2', 'sybil3', 'sybil4', 'sybil5']
  .map(id => `urn:agent:${id}`);
for (const id of fakeIssuers) {
  issuerTrustRegistry.set(id, { trustLevel: 'SelfAsserted' });
}
const fakeAttestations = fakeIssuers.map((issuer, i) => ({
  id: `urn:desc:${issuer.split(':').pop()}->alice`,
  describes: [ALICE],
  facets: [{
    type: 'Trust', trustLevel: 'PeerAttested',
    issuer,
    amtaAxes: { codeQuality: 0.95 + i * 0.005 },
  }],
}));

// Start fresh, alice has ONLY her self-assertion + the fakes (no
// real peers). Without filtering, policy fires true.
function undefendedAttack() {
  const graph = resolveAttributes(ALICE, [aliceSelf, ...fakeAttestations]);
  const qs = extractAttribute(graph, 'amta:codeQuality');
  console.log(`   attacker creates ${fakeIssuers.length} fake identities, all self-asserted,`);
  console.log(`   each issuing an attestation about alice.`);
  console.log(`   attestations aggregated (unfiltered): ${qs.length}  (values: ${qs.map(q => q.toFixed(3)).join(', ')})`);
  const decision = evaluateAbac([mergePolicy], predicates, {
    subject: ALICE, subjectAttributes: graph,
    resource: RESOURCE, action: ACTION, now: NOW,
  });
  console.log(`   verdict: ${decision.verdict} — attack SUCCEEDED — ${decision.reason}\n`);
  return decision;
}
undefendedAttack();

// ── Act 3: Defense — filter by issuer trust ────────────────

console.log('── Act 3 — Defense via issuer-trust filter ──\n');

/**
 * Filter: a facet counts only if the issuer (extracted from the
 * facet) has HighAssurance trust in the issuer registry. This is
 * the composition of (resolver → filterAttributeGraph → evaluator).
 */
function isIssuerHighTrust(facet /*, sourceDescriptorIri */) {
  const issuer = facet.issuer;
  if (!issuer) return false;
  const entry = issuerTrustRegistry.get(issuer);
  return entry?.trustLevel === 'HighAssurance';
}

function defendedAttack() {
  const graph = resolveAttributes(ALICE, [aliceSelf, ...fakeAttestations]);
  const filtered = filterAttributeGraph(graph, isIssuerHighTrust);
  const qs = extractAttribute(filtered, 'amta:codeQuality');
  console.log(`   same 5 fake attestations as Act 2, plus alice's self-assertion.`);
  console.log(`   filter: facet counts only if its issuer has HighAssurance trust.`);
  console.log(`   facets dropped: ${graph.facets.length - filtered.facets.length}`);
  console.log(`   attestations aggregated (filtered): ${qs.length}  (values: ${qs.length ? qs.join(', ') : '(none)'})`);
  const decision = evaluateAbac([mergePolicy], predicates, {
    subject: ALICE, subjectAttributes: filtered,
    resource: RESOURCE, action: ACTION, now: NOW,
  });
  console.log(`   verdict: ${decision.verdict} — attack BLOCKED — ${decision.reason}\n`);
  return decision;
}
defendedAttack();

// ── Act 4: Honest case survives the filter ─────────────────

console.log('── Act 4 — Sanity: honest actors survive the filter ──\n');

function honestSurvives() {
  const graph = resolveAttributes(
    ALICE,
    [aliceSelf, bobAttestsAlice, carolAttestsAlice, ...fakeAttestations],
  );
  const filtered = filterAttributeGraph(graph, isIssuerHighTrust);
  const qs = extractAttribute(filtered, 'amta:codeQuality');
  console.log(`   world has real attestations (bob, carol) AND sybil attack (5 fakes).`);
  console.log(`   filter keeps only HighAssurance-issuer facets.`);
  console.log(`   attestations kept: ${qs.length}  (values: ${qs.join(', ')})`);
  const decision = evaluateAbac([mergePolicy], predicates, {
    subject: ALICE, subjectAttributes: filtered,
    resource: RESOURCE, action: ACTION, now: NOW,
  });
  console.log(`   verdict: ${decision.verdict} — honest actors still succeed — ${decision.reason}\n`);
  return decision;
}
honestSurvives();

// ── Observed ──

console.log('── Observed ──');
console.log('   The attack: an attacker creates fake identities, self-attests,');
console.log('   issues attestations about alice. Without the filter, 5 fakes');
console.log('   pass the policy trivially (verdict Allowed, Act 2).');
console.log('');
console.log('   The defense: filterAttributeGraph — facets count only if');
console.log('   their issuer holds HighAssurance trust in the issuer registry.');
console.log('   The filter drops all 5 fakes; alice fails the policy (Act 3).');
console.log('');
console.log('   The sanity check: real attestations (bob, carol) have');
console.log('   HighAssurance; they pass the filter; alice succeeds (Act 4).');
console.log('');
console.log('   Nothing about the policy changed. Nothing about the evaluator');
console.log('   changed. The security property (sybil resistance) emerged');
console.log('   from composing three existing primitives — resolver + filter +');
console.log('   evaluator — at the attribute-graph layer, where the attack lives.');
console.log('');
console.log('   A production deployment would sharpen this further: issuer');
console.log('   trust itself might require ≥ N attestations (recursion); trust');
console.log('   levels could carry temporal decay; cross-pod issuer-trust');
console.log('   lookups would need caching. All of these use the same pattern.');
