# Foxxi conformance map — IEEE / ADL / 1EdTech learning-technology standards

How the Foxxi vertical maps to (or extends, or wraps) the standards in
the ADL Total Learning Architecture (TLA), IEEE 1484.x family, and
1EdTech (formerly IMS Global) catalog. Every row cites the source file
that implements the mapping so you can verify the claim directly.

Layering reminder: standards-conformant behavior lives in the
**vertical** (this directory) + the **substrate's L3 reusable
primitives** (`applications/_shared/`, `src/`). The L1 protocol
(`cg:`, `cgh:`, `pgsl:`, `ie:`, `align:`) stays technology-neutral —
no SCORM/xAPI/LOM terms leak into it.

---

## 1. Content packaging — ADL SCORM 1.2 / 2004

| Standard requirement | Status | Where |
|---|---|---|
| Parse `imsmanifest.xml` (organizations / items / resources) | **Compliant** | [`imported/foxxi_storyline_parser_v03.py`](imported/foxxi_storyline_parser_v03.py) + [`applications/_shared/scorm/index.ts`](../_shared/scorm/index.ts) |
| Detect SCORM 1.2 vs 2004 via `adlcp_rootv1pX` namespace | **Compliant** | [`applications/_shared/scorm/index.ts`](../_shared/scorm/index.ts) (`unwrapScormPackage`) |
| Surface SCO / Asset / Resource as RDF types | **Compliant** | [`ns/foxxi-content-graph-v0.2.ttl`](ns/foxxi-content-graph-v0.2.ttl) `fxs:SCO`, `fxs:Resource`, `fxs:Asset` |
| Preserve manifest identifiers + organization tree | **Compliant** | `fxs:identifiedBy`, `fxs:hasOrganization`, `fxs:hasItem`, `fxs:hasChild` |
| Track standard conformance per package | **Compliant** | `fxs:standardConformance fxs:SCORM_2004_4` (etc.) |
| Extract `<sequencing>` rules | **Compliant** | [`src/lom-sequencing.ts`](src/lom-sequencing.ts) `sequencingRulesToTurtle()` — emits `fxs:SequencingRule` instances with `fxs:expression` carrying the verbatim rule XML for downstream LMS replay |
| Implement SCORM CMI runtime API | **Out of scope (architectural boundary)** | Foxxi covers authorship-time + post-hoc analytics. CMI runtime (`cmi.core.*`, `cmi.interactions.*`) is the LMS's runtime layer — outside the Foxxi vertical's stratum. Documented boundary, not a gap. |

## 2. xAPI — ADL Experience API / IEEE 9274.1.1

| Standard requirement | Status | Where |
|---|---|---|
| xAPI 1.0.3 + 2.0.0 statement ingest (actor / verb / object / result / context / timestamp) | **Compliant** | [`applications/lrs-adapter/src/translate.ts`](../lrs-adapter/src/translate.ts) |
| Statement projection — descriptor → xAPI Statement → LRS POST | **Compliant** | [`applications/lrs-adapter/src/pod-publisher.ts`](../lrs-adapter/src/pod-publisher.ts) |
| LRS endpoint contract (GET/POST `/xapi/statements`, GET `/xapi/about`) | **Compliant** | [`applications/lrs-adapter/src/lrs-client.ts`](../lrs-adapter/src/lrs-client.ts) — tested live against Lrsql, SCORM Cloud, Watershed |
| Modal-status filter on projection (Asserted only) | **Compliant** | Modal-truth invariant from L1; non-Asserted descriptors don't leak through |
| Signed Statements + Statement Forwarding | **Not implemented** | Deferred per xAPI-adapter README §"Out of scope" |

## 3. cmi5 — IEEE 9274.2.1

| Standard requirement | Status | Where |
|---|---|---|
| AU (Assignable Unit) detection | **Compliant** | [`applications/_shared/scorm/index.ts`](../_shared/scorm/index.ts) (extracts `<au>` from `cmi5.xml`) |
| `fxs:AssignableUnit` as RDF type | **Compliant** | [`ns/foxxi-content-graph-v0.2.ttl`](ns/foxxi-content-graph-v0.2.ttl) |
| 9 cmi5 statement profiles (launched / initialized / completed / passed / failed / abandoned / waived / terminated / satisfied) | **Compliant** | [`src/cmi5.ts`](src/cmi5.ts) — `buildCmi5Statement(verb)` covers all 9; `buildPassedSessionTrace()` emits a full lifecycle trace; `foxxi.emit_cmi5_session` affordance dispatches |
| Context category tag (`cmi5/context/categories/cmi5`) | **Compliant** | Built into every statement by `buildCmi5Statement`; moveOn category added for `satisfied` / `waived` per §10 |
| Session / moveOn / mastery semantics | **Compliant** | `evaluateMoveOn()` implements §11 — applies `Passed / Completed / CompletedAndPassed / CompletedOrPassed / NotApplicable` rules against the learner's score + mastery threshold |

## 4. IEEE LOM 1484.12.1 — Learning Object Metadata

| LOM category | Status | Where |
|---|---|---|
| General (title, identifier, language, description) | **Compliant** | `dcterms:title`, `dcterms:identifier`, `dcterms:language` on `fxs:Package` |
| Technical (duration, format, version) | **Partial** | `schema:duration`, `schema:softwareVersion`; format/size not auto-extracted |
| Educational (typical learning time, context, difficulty, learning resource type) | **Compliant** | [`src/lom-sequencing.ts`](src/lom-sequencing.ts) `lomToTurtle()` emits IEEE LOM namespace triples for every §5 field (interactivityType, learningResourceType, interactivityLevel, semanticDensity, intendedEndUserRole, context, difficulty, typicalLearningTime, educationalDescription, educationalLanguage) |
| Lifecycle (status, version, contribute) | **Compliant** | `lomToTurtle()` §2 — status / version / contribute (role, entity, date) emitted with proper LOM IRIs |
| Rights (cost, copyright, description) | **Compliant** | `lomToTurtle()` §6 |
| Relation, Classification | **Compliant** | `lomToTurtle()` §7 + §9 (purpose: discipline / educationalObjective / competency / etc.) |
| Annotation, Meta-Metadata | **Schema-supported (lifted when present in source manifest)** | Categories tracked by the LOM type but rarely populated by authoring tools; lifter passes through whatever the manifest carries |

## 5. IEEE 1484.20.1 RDCEO / 1484.20.2 RCD — Reusable Competency Definitions

| Standard requirement | Status | Where |
|---|---|---|
| Formal competency definitions (statement, scope, mastery) | **Compliant via L2 mapping** | [`ns/rcd.ttl`](ns/rcd.ttl) declares `rcd:CompetencyDefinition` (subclass of `fxk:Skill`) with `rcd:statement`, `rcd:scope`, `rcd:masteryRubric` |
| Five-rung proficiency scale (Novice / Beginner / Intermediate / Advanced / Expert) | **Compliant** | [`ns/rcd.ttl`](ns/rcd.ttl) declares individuals `rcd:Novice` … `rcd:Expert` with `rdf:value 1..5` |
| Framework membership (`fromFramework`) | **Compliant** | `fxk:fromFramework`, `fxk:caseFrameworkRef` |
| Skill prerequisite + develops semantics | **Compliant** | `fxk:requiresSkill`, `fxk:developsSkill` |

## 6. 1EdTech CASE 1.0 — Competencies + Academic Standards Exchange

| Standard requirement | Status | Where |
|---|---|---|
| Export a competency framework as CASE 1.0 JSON-LD | **Compliant** | [`src/case-exporter.ts`](src/case-exporter.ts) — `frameworkToCase(framework)` |
| CFDocument / CFItem / CFAssociation shapes | **Compliant** | Exported per spec |
| `isPrerequisiteOf` associations from `fxk:prerequisiteOf` | **Compliant** | Walked during export |
| RDCEO mastery rubric → CASE CFRubric / CFRubricCriterion / CFRubricCriterionLevel | **Compliant** | Auto-generated when any skill carries an RDCEO `proficiencyLevel` |
| Affordance: `foxxi.export_case_framework` | **Compliant** | [`affordances.ts`](affordances.ts) + bridge handler |

## 7. ADL CaSS — Competency & Skills System

| Standard requirement | Status | Where |
|---|---|---|
| Push framework to CaSS (`POST /api/framework`) | **Compliant** | [`src/cass-connector.ts`](src/cass-connector.ts) `pushFrameworkToCass()` + `foxxi.push_to_cass` affordance |
| Push competency assertion to CaSS (`POST /api/assertion`) | **Compliant** | `pushAssertionToCass()` exported (no bridge affordance yet — assertion emission lives upstream in the credentialing flow; CaSS-side assertions can be added with the same one-line connector) |

## 8. W3C Verifiable Credentials Data Model 2.0

| Standard requirement | Status | Where |
|---|---|---|
| vc-jwt (EdDSA JWS encoding per VC DM 2.0 §6.3) | **Compliant** | [`applications/_shared/vc-jwt/index.ts`](../_shared/vc-jwt/index.ts) |
| Data Integrity Proofs (cryptosuite `eddsa-jcs-2022`) | **Compliant** | [`applications/_shared/vc-jwt/data-integrity-jcs.ts`](../_shared/vc-jwt/data-integrity-jcs.ts) |
| `eddsa-rdfc-2022` (URDNA2015 canonicalization) | **Compliant** | [`applications/_shared/vc-jwt/data-integrity-rdfc.ts`](../_shared/vc-jwt/data-integrity-rdfc.ts) — JSON-LD expand → N-Quads → URDNA2015 canonicalize → SHA-256 → Ed25519 (composes `jsonld` + `rdf-canonize` + `@noble/curves/ed25519`) |
| BBS+ selective disclosure (`bbs-2023`) | **Compliant** | [`applications/_shared/vc-jwt/bbs-2023.ts`](../_shared/vc-jwt/bbs-2023.ts) — full sign / verify / deriveProof / verifyProof via `@digitalbazaar/bbs-signatures` (BLS12-381 SHA-256 ciphersuite); `flattenCredentialSubject()` helper produces a stable message list from a VC's claims |
| W3C-compliant credential round-trip verification | **Compliant** | `verifyDataIntegrityProof()` self-checks the issued VC before publish |

## 9. W3C Decentralized Identifiers (DIDs)

| DID method | Status | Where |
|---|---|---|
| `did:key` (Ed25519) | **Compliant** | [`applications/_shared/vc-jwt/index.ts`](../_shared/vc-jwt/index.ts) — generation + decoding |
| `did:web` | **Compliant** | [`src/solid/did-resolver.ts`](../../../src/solid/did-resolver.ts) — HTTPS fetch of `.well-known/did.json` (or `/<path>/did.json` per spec), parses verificationMethod, returns full DID document. Per-DID URL derivation per did:web v0.0.3. |
| `did:ethr` | **Compliant** | Same `did-resolver.ts` — derives the `EcdsaSecp256k1RecoveryMethod2020` verification method from the Ethereum address with proper CAIP-10 `blockchainAccountId`. Supports both `did:ethr:<address>` and `did:ethr:<chainspec>:<address>` forms. |

## 10. 1EdTech Open Badges 3.0

| Standard requirement | Status | Where |
|---|---|---|
| `OpenBadgeCredential` typed VC | **Compliant** | [`src/credentials.ts`](src/credentials.ts) `buildCourseCompletionVc` |
| `AchievementSubject` + `Achievement` shape | **Compliant** | `credentialSubject.achievement` populated |
| `Achievement.criteria.narrative` | **Compliant** | Required field populated from `criterion_narrative` arg |
| `Achievement.alignment[]` for competency frameworks | **Compliant** | Built from `aligned_skills` arg |
| `evidence[]` linking back to learning experience traces | **Compliant** | `evidence` arg becomes the array |
| OB3 issuer (Profile) | **Partial** | Issuer is the issuer's `did:key`; tenant Profile name/details ride in published descriptor metadata. Full `issuer: { id, type, name }` object shape requires loosening the substrate's `VcPayload.issuer: string` type — deferred |
| Independent verification | **Compliant** | Any W3C VC verifier can verify; substrate's `verifyDataIntegrityProof()` confirms locally |

## 11. 1EdTech Comprehensive Learner Record (CLR) 2.0

| Standard requirement | Status | Where |
|---|---|---|
| CLR 2.0-shaped envelope wrapping multiple W3C VCs | **Compliant** | [`src/clr.ts`](src/clr.ts) `exportClr` |
| Each entry preserves its own DataIntegrityProof | **Compliant** | Envelope is an aggregator; per-entry proofs unmodified |
| Subject-binding check (each VC's `credentialSubject.id` must match `holderDid`) | **Compliant** | Cross-checked; mismatches surface with `verified: false, reason: 'subject DID mismatch'` |
| Affordance: `foxxi.export_clr` | **Compliant** | [`affordances.ts`](affordances.ts) + bridge handler |
| CLR 1.0 (pre-VC legacy) | **Compliant** | [`src/clr-1.ts`](src/clr-1.ts) `envelopeToClr1()` — projects the CLR 2.0 envelope to the legacy 1.0 JSON shape for institutional consumers still on the pre-VC format. Exposed via `foxxi.export_clr_v1` affordance. |

## 12. Learner wallet — ADL TLA "Learner Records Network"

| Concept | Status | Where |
|---|---|---|
| Pod-as-wallet | **Compliant** | The learner's Solid pod holds every `fxa:CourseCompletionCredential` / `fxa:CompetencyAssertion` |
| Credential portability | **Compliant** | Standard Solid pod migration; DID unchanged |
| Wallet contents discoverable by type IRI | **Compliant** | `cg:discover()` filtered on `dct:conformsTo` |
| Wallet envelope export (CLR 2.0) | **Compliant** | See §11 |
| Wallet backup / cross-pod replication | **Not implemented** | Achievable via existing E2EE envelope share; not yet a standard affordance |

## 13. ADL TLA backbone (Master Object Model + Experience Index)

| TLA component | Status | Where |
|---|---|---|
| Master Object Model — Course / Learner / Competency / Assessment / Result as RDF | **Compliant** | `fxs:Package` (course), learner WebID, `rcd:CompetencyDefinition`, `fxs:Item/SCO` (assessment), `lpc:PerformanceRecord` (result) |
| Experience Index — write side (statements → LRS) | **Compliant** | `lrs-adapter` projects descriptors to LRS |
| Experience Index — read side (federated xAPI queries across LRSs) | **Compliant** | [`applications/lrs-adapter/src/experience-index.ts`](../lrs-adapter/src/experience-index.ts) `queryFederatedStatements()` — parallel `GET /statements` across N configured LRSs, deduplication by Statement ID, per-LRS attribution + per-LRS error isolation. Exposed via `foxxi.query_experience_index` (admin-only). |

---

## Standards-citing tooling

Every credentialing affordance returns a payload whose `@context` array
references the standard spec it conforms to:

- `OpenBadgeCredential` → `https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json`
- `ClrCredential` → `https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json`
- `CFDocument` → `https://purl.imsglobal.org/spec/case/v1p0/context/case_v1p0.jsonld`

That makes every artifact independently verifiable: a third-party CASE
parser / OB3 verifier / CLR 2.0 consumer can fetch the spec context
and validate without trusting our README. The substrate-side
verification (`verifyDataIntegrityProof()`) does the same check locally
before publishing.
