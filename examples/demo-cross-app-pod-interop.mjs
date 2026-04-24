// Cool demo: Cross-app pod interoperability.
//
// Verborgh's loudest current critique of Solid: apps store data
// however they like, so app B can't read app A's pod content
// without prior coordination. The result is an interop problem
// pretending to be a decentralization story.
//
// The fix he advocates: stop letting apps invent their own schemas.
// Have apps publish to standard shapes (cg: + W3C vocabularies).
// Then any compliant app can read any compliant pod.
//
// This demo: ONE pod's descriptor set, rendered by THREE different
// "apps" with three different UIs. None of the apps reads or writes
// app-specific schema; they all consume the same standard
// cg:ContextDescriptor structure. Each presents it through its own
// lens — timeline / trust graph / RDF inspector.

console.log('=== Cross-app pod interoperability ===\n');
console.log('One pod, three apps, zero app-specific schemas.\n');

// ── A small pod content set: 6 descriptors of varied kinds ──

const pod = [
  {
    id: 'urn:cg:memory:vocab-emergence-2026-04-22',
    describes: 'urn:graph:memory:vocab-emergence-2026-04-22',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-22T14:00:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:mark', generatedAtTime: '2026-04-22T14:00:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:mark' } },
      { type: 'Semiotic', modalStatus: 'Asserted', epistemicConfidence: 0.92 },
      { type: 'Trust', trustLevel: 'SelfAsserted', issuer: 'urn:agent:mark' },
    ],
    payload: 'Vocabulary alignment converges in ~45 rounds with threshold 3 over 9 subjects.',
  },
  {
    id: 'urn:cg:attestation:bob-attests-mark-2026-04-23',
    describes: 'urn:agent:mark',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-23T09:00:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:bob', generatedAtTime: '2026-04-23T09:00:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:bob' } },
      { type: 'Semiotic', modalStatus: 'Asserted' },
      { type: 'Trust', trustLevel: 'PeerAttested', issuer: 'urn:agent:bob', amtaAxes: { honesty: 0.9, competence: 0.85 } },
    ],
    payload: '(amta:Attestation about urn:agent:mark)',
  },
  {
    id: 'urn:cg:attestation:carol-attests-mark-2026-04-23',
    describes: 'urn:agent:mark',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-23T15:30:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:carol', generatedAtTime: '2026-04-23T15:30:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:carol' } },
      { type: 'Semiotic', modalStatus: 'Asserted' },
      { type: 'Trust', trustLevel: 'PeerAttested', issuer: 'urn:agent:carol', amtaAxes: { honesty: 0.95, competence: 0.92 } },
    ],
    payload: '(amta:Attestation about urn:agent:mark)',
  },
  {
    id: 'urn:cg:code-review:pr42-bob',
    describes: 'urn:code:pr:42',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-22T11:15:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:bob', generatedAtTime: '2026-04-22T11:15:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:bob' } },
      { type: 'Semiotic', modalStatus: 'Asserted', interpretationFrame: 'code:Approved' },
      { type: 'Trust', trustLevel: 'PeerAttested', issuer: 'urn:agent:bob' },
    ],
    payload: '(code:Review verdict=Approved on PR #42)',
  },
  {
    id: 'urn:cg:memory:meeting-notes-2026-04-23',
    describes: 'urn:graph:notes/team-meeting-2026-04-23',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-23T16:00:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:mark', generatedAtTime: '2026-04-23T16:00:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:mark' } },
      { type: 'Semiotic', modalStatus: 'Asserted', epistemicConfidence: 0.85 },
      { type: 'Trust', trustLevel: 'SelfAsserted', issuer: 'urn:agent:mark' },
    ],
    payload: 'Discussed Q3 priorities; revisit after pitch on Friday.',
  },
  {
    id: 'urn:cg:hypothetical:emergent-policy-shared-threshold',
    describes: 'urn:claim:emergent-shared-policy-threshold',
    facets: [
      { type: 'Temporal', validFrom: '2026-04-23T18:00:00Z' },
      { type: 'Provenance', wasAttributedTo: 'urn:agent:carol', generatedAtTime: '2026-04-23T18:00:00Z' },
      { type: 'Agent', assertingAgent: { agentIdentity: 'urn:agent:carol' } },
      { type: 'Semiotic', modalStatus: 'Hypothetical', epistemicConfidence: 0.6 },
      { type: 'Trust', trustLevel: 'PeerAttested', issuer: 'urn:agent:carol' },
    ],
    payload: 'Hypothesis: emergent policy threshold ≈ median of independent inputs. Needs more data.',
  },
];

console.log(`Pod contains ${pod.length} descriptors. Each conforms to standard cg: shape.\n`);

// Helpers
function timeOf(d) { return d.facets.find(f => f.type === 'Temporal')?.validFrom; }
function authorOf(d) { return d.facets.find(f => f.type === 'Provenance')?.wasAttributedTo; }
function modalOf(d) { return d.facets.find(f => f.type === 'Semiotic')?.modalStatus; }
function confidenceOf(d) { return d.facets.find(f => f.type === 'Semiotic')?.epistemicConfidence; }
function trustOf(d) { return d.facets.find(f => f.type === 'Trust'); }
function shortIri(iri) { return iri.split(':').slice(-2).join(':'); }
function shortAgent(iri) { return iri?.split(':').at(-1) ?? '(unknown)'; }

// ── App 1: Memory Browser (timeline view) ────────────────────

console.log('═'.repeat(60));
console.log(' App 1 — Memory Browser');
console.log(' "What did I do recently?"');
console.log('═'.repeat(60));

function renderApp1MemoryBrowser(pod) {
  const sorted = [...pod].sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  for (const d of sorted) {
    const time = timeOf(d).slice(0, 16).replace('T', ' ');
    const author = shortAgent(authorOf(d));
    const modal = modalOf(d);
    const conf = confidenceOf(d);
    const confStr = conf !== undefined ? ` (conf ${conf.toFixed(2)})` : '';
    console.log(`  ${time}  [${author.padEnd(6)}]  ${modal}${confStr}`);
    console.log(`                       ${d.payload}`);
  }
}

renderApp1MemoryBrowser(pod);
console.log();

// ── App 2: Trust Dashboard (who-attested-what-to-whom) ──────

console.log('═'.repeat(60));
console.log(' App 2 — Trust Dashboard');
console.log(' "Who is attesting to what about whom?"');
console.log('═'.repeat(60));

function renderApp2TrustDashboard(pod) {
  // Group by subject; show attestations + axes.
  const bySubject = new Map();
  for (const d of pod) {
    const trust = trustOf(d);
    if (!trust) continue;
    if (!bySubject.has(d.describes)) bySubject.set(d.describes, []);
    bySubject.get(d.describes).push({ d, trust });
  }

  for (const [subject, entries] of bySubject) {
    console.log(`\n  Subject: ${shortIri(subject)}`);
    for (const { d, trust } of entries) {
      const issuer = shortAgent(trust.issuer);
      const isSelf = trust.issuer === d.describes;
      const tag = isSelf ? '[self-asserted]' : '[peer-attested]';
      console.log(`    ${tag}  ${issuer.padEnd(6)}  trust=${trust.trustLevel}`);
      if (trust.amtaAxes) {
        for (const [axis, value] of Object.entries(trust.amtaAxes)) {
          const bar = '▰'.repeat(Math.round(value * 10)) + '▱'.repeat(10 - Math.round(value * 10));
          console.log(`              ${axis.padEnd(11)} ${value.toFixed(2)} ${bar}`);
        }
      }
    }
  }
}

renderApp2TrustDashboard(pod);
console.log();

// ── App 3: Knowledge Graph Inspector (RDF triples view) ─────

console.log('═'.repeat(60));
console.log(' App 3 — Knowledge Graph Inspector');
console.log(' "Show me the underlying RDF."');
console.log('═'.repeat(60));

function renderApp3GraphInspector(pod) {
  // Each descriptor → a small set of triples about its subject.
  for (const d of pod) {
    console.log(`\n  <${shortIri(d.id)}>`);
    console.log(`    a                        cg:ContextDescriptor ;`);
    console.log(`    cg:describes             <${shortIri(d.describes)}> ;`);
    for (const f of d.facets) {
      switch (f.type) {
        case 'Temporal':
          console.log(`    cg:validFrom             "${f.validFrom}"^^xsd:dateTime ;`);
          break;
        case 'Provenance':
          console.log(`    prov:wasAttributedTo     <${shortIri(f.wasAttributedTo)}> ;`);
          break;
        case 'Agent':
          console.log(`    cg:assertingAgent        <${shortIri(f.assertingAgent.agentIdentity)}> ;`);
          break;
        case 'Semiotic':
          console.log(`    cg:modalStatus           cg:${f.modalStatus} ;`);
          if (f.epistemicConfidence !== undefined) {
            console.log(`    cg:epistemicConfidence   "${f.epistemicConfidence}"^^xsd:double ;`);
          }
          break;
        case 'Trust':
          console.log(`    cg:trustLevel            cg:${f.trustLevel} ;`);
          console.log(`    cg:issuer                <${shortIri(f.issuer)}> ;`);
          break;
      }
    }
    console.log(`    .`);
  }
}

renderApp3GraphInspector(pod);
console.log();

// ── Summary ─────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log('── What this demonstrates ──');
console.log('═'.repeat(60));
console.log('   Same pod content. Three apps. Zero app-specific schema.');
console.log('');
console.log('   None of the apps:');
console.log('     - wrote anything app-specific to the pod');
console.log('     - required prior coordination with the pod\'s author');
console.log('     - knew which app produced which descriptor');
console.log('');
console.log('   All three could be replaced by a fourth app tomorrow,');
console.log('   reading the same pod, presenting the same data through');
console.log('   yet another lens. The pod owner doesn\'t migrate; the');
console.log('   apps are commodity views.');
console.log('');
console.log('   This is what Verborgh argues Solid SHOULD be: a graph');
console.log('   of typed claims, with apps as commodity readers/writers');
console.log('   over standard shapes — not a folder of opaque app blobs.');
console.log('   We get there by making typed-context (cg:) + standard');
console.log('   vocabularies the protocol-level requirement, not just');
console.log('   a recommendation.');
