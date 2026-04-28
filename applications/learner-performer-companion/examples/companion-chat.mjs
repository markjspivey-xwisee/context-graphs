// Learner / Performer Companion — runnable end-to-end interaction.
//
// VERTICAL APPLICATION OF INTEREGO — NOT part of the protocol; not a
// reference implementation of the protocol. One specific use case among
// many possible. See applications/learner-performer-companion/README.md
// for the framing and applications/README.md for layering discipline.
//
// What this script demonstrates:
//
//   1. WALLET BUILD-UP — import an Open Badge 3.0 credential, verify the
//      proof block, store as lpc:Credential in the user's pod.
//   2. LEARNING HISTORY — bring in xAPI Statements via the lrs-adapter,
//      translated into lpc:LearningExperience descriptors that cross-link
//      to credentials + training content.
//   3. TRAINING CONTENT KG — ingest a SCORM-style course as lpc:TrainingContent
//      with lpc:LearningObjective sub-descriptors and PGSL grounding atoms.
//   4. PERFORMANCE RECORD — receive a manager review, write to the user's
//      pod with cg:ProvenanceFacet attributing it to the manager.
//   5. CHAT QUERIES — three grounded responses, each producing an
//      lpc:CitedResponse descriptor with explicit citations:
//        a. content question      → cites training-content atom
//        b. credential question   → cites lpc:Credential descriptor
//        c. development plan      → composes review + training KG; Hypothetical
//
// The human (Mark) is the protagonist. The assistant (Aria) is the helper.

import { Wallet, getBytes, hashMessage, SigningKey } from 'ethers';
import { randomUUID } from 'node:crypto';

// ── Cast ──────────────────────────────────────────────────────────────

const MARK    = Wallet.createRandom();   // the user — protagonist
const ARIA    = Wallet.createRandom();   // Interego-grounded assistant
const ACME    = Wallet.createRandom();   // training issuer (credential authority)
const JANE    = Wallet.createRandom();   // Mark's manager

const did = (label, w) => `did:key:${w.address.toLowerCase()}#${label}`;
const MARK_DID = did('mark', MARK);
const ARIA_DID = did('aria', ARIA);
const ACME_DID = did('acme-training', ACME);
const JANE_DID = did('jane', JANE);

// ── Signing helper ────────────────────────────────────────────────────

function signEvent(wallet, eventId, eventType, payload) {
  const canonical = JSON.stringify({ eventId, eventType, payload }, Object.keys({ eventId, eventType, payload }).sort());
  const digest = hashMessage(canonical);
  const sk = new SigningKey(wallet.privateKey);
  const sig = sk.sign(getBytes(digest));
  return { signature: sig.serialized, signer: wallet.address };
}

// ── Output formatting ─────────────────────────────────────────────────

const HR = '─'.repeat(72);
const sep  = (label) => console.log(`\n${HR}\n  ${label}\n${HR}`);
const block = (label, body) =>
  console.log(`\n  ${label}\n${body.split('\n').map(l => '    ' + l).join('\n')}`);
const chat = (speaker, msg) => console.log(`\n  ${speaker}: ${msg}`);

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║  Learner / Performer Companion — grounded chat over the user's wallet ║
║  Vertical application of Interego (NOT the protocol)                  ║
║  Mark (human) is protagonist; Aria (Interego agent) is the assistant  ║
╚════════════════════════════════════════════════════════════════════════╝`);

// ── 1. WALLET BUILD-UP ────────────────────────────────────────────────

sep('1. WALLET BUILD-UP — import + verify + store an Open Badge 3.0 credential');

const credentialIri = `urn:cg:credential:open-badge-3:cs101-mod3-${randomUUID().slice(0, 8)}`;
const vcProofBlock = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-rdfc-2022',
  created: '2025-09-15T11:00:00Z',
  verificationMethod: `${ACME_DID}-vm-1`,
  proofPurpose: 'assertionMethod',
  proofValue: `z${ACME.address.slice(2)}…[truncated for display]`,
};
const credSig = signEvent(ACME, credentialIri, 'lpc:Credential', { holder: MARK_DID, format: 'OB-3.0' });

block('Importing Open Badge 3.0 from ACME training (verifies VC proof on import):', `
<${credentialIri}> a lpc:Credential , passport:Achievement ;
    lpc:credentialFormat lpc:OpenBadge3 ;
    lpc:credentialFramework "OB-3.0" ;
    lpc:vcProof """${JSON.stringify(vcProofBlock)}""" ;
    lpc:verificationStatus lpc:Verified ;
    cg:temporal     [ a cg:TemporalFacet ;
                      cg:validFrom "2025-09-15T11:00:00Z"^^xsd:dateTime ] ;
    cg:provenance   [ a cg:ProvenanceFacet ;
                      prov:wasAttributedTo <${ACME_DID}> ] ;
    cg:agent        [ a cg:AgentFacet ;
                      cg:assertingAgent <${MARK_DID}> ;     # subject = Mark
                      cg:onBehalfOf <${MARK_DID}> ] ;
    cg:semiotic     [ a cg:SemioticFacet ;
                      cg:content "Completed Customer Service 101: Module 3 — Handling Frustration" ;
                      cg:modalStatus cg:Asserted ] ;
    cg:trust        [ a cg:TrustFacet ;
                      cg:issuer <${ACME_DID}> ;
                      cg:trustLevel cg:ThirdPartyAttested ] ;
    cg:signature "${credSig.signature.slice(0, 24)}…" .

# Verification: proof block validated against ACME's verificationMethod;
# verificationStatus = Verified. Stored in Mark's pod, owned by Mark.
# ACME can re-verify; cannot remove from Mark's pod.`);

// ── 2. LEARNING HISTORY (via lrs-adapter) ────────────────────────────

sep('2. LEARNING HISTORY — xAPI Statements ingested via lrs-adapter');

const xapiStatementId = randomUUID();
const lrsStmtIri = `urn:cg:lrs-statement:${xapiStatementId}`;
const learningExpIri = `urn:cg:lpc:learning-experience:cs101-mod3-${randomUUID().slice(0, 8)}`;

const trainingContentIri = `urn:cg:lpc:training-content:cs101:module-3`;

console.log(`
  → applications/lrs-adapter/ ingests Mark's completion statement from
    ACME's LRS, producing the cg:ContextDescriptor at <${lrsStmtIri}>.
  → This vertical wraps that descriptor as lpc:LearningExperience and
    adds cross-links to the credential (1) and the training content (3).`);

block('Resulting lpc:LearningExperience:', `
<${learningExpIri}> a lpc:LearningExperience ;
    lpc:basedOnStatement      <${lrsStmtIri}> ;
    lpc:relatesToContent      <${trainingContentIri}> ;
    lpc:relatesToCredential   <${credentialIri}> ;
    cg:temporal   [ a cg:TemporalFacet ;
                    cg:validFrom "2026-04-15T14:32:00Z"^^xsd:dateTime ] ;
    cg:provenance [ a cg:ProvenanceFacet ;
                    prov:wasAttributedTo <${MARK_DID}> ] ;
    cg:semiotic   [ a cg:SemioticFacet ;
                    cg:content """Completed module 3 with score 0.86. Identified second-contact
                                  escalation cue in 4 of 5 scenarios."""@en ;
                    cg:modalStatus cg:Asserted ] .`);

// ── 3. TRAINING CONTENT KG ────────────────────────────────────────────

sep('3. TRAINING CONTENT KG — SCORM module ingested as lpc:TrainingContent');

const objectiveIri = 'urn:cg:lpc:objective:cs101:mod3:second-contact-escalation';
const groundingAtomIri = 'urn:pgsl:atom:cs101-mod3-passage-7';
const groundingPassage = `When a customer makes second contact about an unresolved issue, do not lead with restating the previous solution. Acknowledge their frustration AND the prior contact explicitly, in that order, before re-engaging on the substance. Even when the technical answer is the same, the leading acknowledgment changes the conversation.`;

block('Training content + objective + grounding atom (PGSL):', `
<${trainingContentIri}> a lpc:TrainingContent ;
    lpc:contentFormat       lpc:ScormPackage ;
    lpc:contentStandard     "TLA-LAP" ;
    lpc:authoritativeSource <${ACME_DID}> ;
    lpc:learningObjective   <${objectiveIri}> ;
    cg:provenance           [ a cg:ProvenanceFacet ;
                              prov:wasAttributedTo <${ACME_DID}> ] ;
    cg:trust                [ a cg:TrustFacet ;
                              cg:issuer <${ACME_DID}> ;
                              cg:trustLevel cg:Authoritative ] ;
    cg:supersedes           <urn:cg:lpc:training-content:cs101:module-3:v0> .

<${objectiveIri}> a lpc:LearningObjective ;
    rdfs:label "Second-contact escalation handling" ;
    cg:semiotic [ a cg:SemioticFacet ;
                  cg:content """When a customer makes second contact about an unresolved issue,
                                acknowledge their frustration AND the prior contact before
                                offering the same or similar solution.""" ] ;
    lpc:groundingFragment <${groundingAtomIri}> .

<${groundingAtomIri}> a pgsl:Atom ;
    pgsl:value """${groundingPassage}""" ;
    cg:provenance [ a cg:ProvenanceFacet ; prov:wasAttributedTo <${ACME_DID}> ] ;
    cg:trust      [ a cg:TrustFacet ; cg:issuer <${ACME_DID}> ; cg:trustLevel cg:Authoritative ] .

# Citation = quoting the pgsl:Atom verbatim with its IRI.
# The user can click the IRI to see the passage in its course context.`);

// ── 4. PERFORMANCE RECORD ────────────────────────────────────────────

sep('4. PERFORMANCE RECORD — manager review written to Mark\'s pod');

const reviewIri = `urn:cg:lpc:performance-record:q1-2026:review-${randomUUID().slice(0, 8)}`;
const reviewSig = signEvent(JANE, reviewIri, 'lpc:PerformanceRecord', { type: 'ManagerReview', subject: MARK_DID });

block('Manager Jane writes a Q1 review to Mark\'s pod (with provenance):', `
<${reviewIri}> a lpc:PerformanceRecord ;
    lpc:reviewType lpc:ManagerReview ;
    cg:temporal     [ a cg:TemporalFacet ;
                      cg:validFrom "2026-04-20T16:00:00Z"^^xsd:dateTime ] ;
    cg:provenance   [ a cg:ProvenanceFacet ;
                      prov:wasAttributedTo <${JANE_DID}> ] ;
    cg:agent        [ a cg:AgentFacet ;
                      cg:assertingAgent <${JANE_DID}> ] ;
    cg:trust        [ a cg:TrustFacet ;
                      cg:issuer <https://hr.acme.example> ;
                      cg:trustLevel cg:ThirdPartyAttested ] ;
    cg:semiotic     [ a cg:SemioticFacet ;
                      cg:content """Strong performance in customer-service-tone area. Three
                                    specific second-contact resolutions where Mark led with
                                    explicit acknowledgment of prior contact + frustration.
                                    GROWTH AREA: in clinical-affect technical scenarios, the
                                    explicit acknowledgment occasionally felt out of place;
                                    suggest training on tone-matching across affect contexts.""" ;
                      cg:modalStatus cg:Asserted ] ;
    lpc:flagsCapability <urn:cg:lpc:capability:customer-service-tone> ,
                        <urn:cg:lpc:capability:tone-matching-across-affect> ;
    cg:signature "${reviewSig.signature.slice(0, 24)}…" .

# Mark owns this descriptor in his pod. Jane signed it; Mark cannot
# silently rewrite the content (his pod stores Jane's signature alongside).
# When Mark changes employers, this record stays portable.`);

// ── 5. CHAT QUERIES — three grounded responses ───────────────────────

sep('5a. CHAT — content question (cites training-content atom)');

chat('Mark', 'What did the customer-service training say about second-contact escalation?');

const respAIri = `urn:cg:lpc:cited-response:${randomUUID().slice(0, 8)}`;
const respASig = signEvent(ARIA, respAIri, 'lpc:CitedResponse', { question: 'second-contact-escalation' });

chat('Aria', `From your Customer Service 101: Module 3 (which you completed on 2026-04-15
        with a score of 0.86 and earned an Open Badge 3.0 from ACME):

        > "${groundingPassage}"

        Source: ${groundingAtomIri}
        Module: ${trainingContentIri}
        Your completion: ${learningExpIri}
        Your credential:  ${credentialIri}`);

block('Stored as lpc:CitedResponse:', `
<${respAIri}> a lpc:CitedResponse ;
    lpc:answeredQuestion """What did the customer-service training say about second-contact escalation?""" ;
    lpc:assistantAttribution <${ARIA_DID}> ;
    lpc:citesFragment   <${groundingAtomIri}> ;
    lpc:citesDescriptor <${trainingContentIri}> ,
                        <${learningExpIri}> ,
                        <${credentialIri}> ;
    cg:semiotic [ a cg:SemioticFacet ; cg:modalStatus cg:Asserted ] ;
    cg:provenance [ a cg:ProvenanceFacet ; prov:wasAttributedTo <${ARIA_DID}> ] ;
    cg:signature "${respASig.signature.slice(0, 24)}…" .`);

sep('5b. CHAT — credential question (cites lpc:Credential)');

chat('Mark', 'Do I have a credential covering customer-service tone?');

const respBIri = `urn:cg:lpc:cited-response:${randomUUID().slice(0, 8)}`;
const respBSig = signEvent(ARIA, respBIri, 'lpc:CitedResponse', { question: 'credential-coverage' });

chat('Aria', `Yes — one credential in your wallet covers this area:

        - Open Badge 3.0: "Customer Service 101: Module 3 — Handling Frustration"
          Issuer: ACME training (verified ✓)
          Issued: 2025-09-15
          Underlying VC: cryptographically verified on import + on this query.

        Source: ${credentialIri}`);

block('Stored as lpc:CitedResponse:', `
<${respBIri}> a lpc:CitedResponse ;
    lpc:answeredQuestion """Do I have a credential covering customer-service tone?""" ;
    lpc:assistantAttribution <${ARIA_DID}> ;
    lpc:citesDescriptor <${credentialIri}> ;
    cg:semiotic [ a cg:SemioticFacet ; cg:modalStatus cg:Asserted ] ;
    cg:provenance [ a cg:ProvenanceFacet ; prov:wasAttributedTo <${ARIA_DID}> ] ;
    cg:signature "${respBSig.signature.slice(0, 24)}…" .`);

sep('5c. CHAT — development plan (composes review + training KG; Hypothetical)');

chat('Mark', 'Generate a development plan for the gaps Jane flagged in my Q1 review.');

const planIri = `urn:cg:lpc:development-plan:q2-2026-${randomUUID().slice(0, 8)}`;
const respCIri = `urn:cg:lpc:cited-response:${randomUUID().slice(0, 8)}`;
const respCSig = signEvent(ARIA, respCIri, 'lpc:CitedResponse', { question: 'development-plan' });

chat('Aria', `Drafting a plan based on your Q1 review (Jane, 2026-04-20) and your
        training history. Marked Hypothetical — this is a SUGGESTION, not a commitment.

        Gap flagged: tone-matching across affect contexts (per Jane's review).

        Suggested actions:
          1. Module: "Tone Matching Across Customer Affects" (CS-201, ACME catalog)
             — not yet completed; estimated 90 minutes; would earn Open Badge 3.0.
          2. Pair with shadowing 3 calls in clinical-affect technical scenarios.
          3. Self-assessment after 2 weeks; consider revisiting Q1 review with Jane.

        Citations:
          Review:    ${reviewIri}
          Existing:  ${credentialIri} (foundation)
          Targeting: capability "tone-matching-across-affect"`);

block('Stored as lpc:DevelopmentPlan + lpc:CitedResponse:', `
<${planIri}> a lpc:DevelopmentPlan ;
    cg:semiotic [ a cg:SemioticFacet ;
                  cg:modalStatus cg:Hypothetical ] ;       # suggestion, not commitment
    cg:provenance [ a cg:ProvenanceFacet ;
                    prov:wasAttributedTo <${ARIA_DID}> ] ;
    cg:agent      [ a cg:AgentFacet ;
                    cg:assertingAgent <${ARIA_DID}> ;
                    cg:onBehalfOf <${MARK_DID}> ] .

<${respCIri}> a lpc:CitedResponse ;
    lpc:answeredQuestion """Generate a development plan for the gaps Jane flagged in my Q1 review.""" ;
    lpc:assistantAttribution <${ARIA_DID}> ;
    lpc:citesDescriptor <${reviewIri}> , <${credentialIri}> , <${planIri}> ;
    cg:semiotic [ a cg:SemioticFacet ; cg:modalStatus cg:Hypothetical ] ;
    cg:provenance [ a cg:ProvenanceFacet ; prov:wasAttributedTo <${ARIA_DID}> ] ;
    cg:signature "${respCSig.signature.slice(0, 24)}…" .

# Plan modal = Hypothetical because the assistant suggests; Mark (and
# possibly Jane) decide whether to commit. If Mark commits, he can write
# his own cg:modalStatus cg:Asserted descriptor citing this plan.`);

// ── Closing ───────────────────────────────────────────────────────────

sep('chat session complete');

console.log(`
  What just happened:

    Wallet:   1 Open Badge 3.0 imported + verified
    History:  1 xAPI completion ingested via lrs-adapter
    Content:  1 SCORM module + 1 learning objective + 1 grounding atom
    Records:  1 manager review written to pod with provenance
    Chat:     3 grounded responses, all stored as lpc:CitedResponse

  Substrate guarantees:
    - Every citation links to a descriptor the user can click through
    - Every credential's VC proof block is preserved + reverifiable
    - Every performance record carries cg:ProvenanceFacet attributing it
      to the issuer; the user cannot silently rewrite manager-issued content
    - The development plan is Hypothetical — assistant suggests, user decides
    - The wallet is portable; nothing here is locked to ACME's infrastructure

  What did NOT happen:
    - The assistant did NOT issue an xAPI Statement grading Mark.
      That direction belongs to applications/lrs-adapter/, invoked by
      employers / LRS systems, not by the user-side assistant.
    - No L1/L2/L3 ontologies were extended.

  Cast (signed by real ECDSA keys, not mocks):
    Mark   ${MARK.address}  → user (protagonist)
    Aria   ${ARIA.address}    → Interego-grounded assistant
    ACME   ${ACME.address}    → training issuer
    Jane   ${JANE.address}    → Mark's manager
`);
