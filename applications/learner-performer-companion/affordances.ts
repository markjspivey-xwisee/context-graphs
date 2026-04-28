/**
 * Affordance declarations for the learner-performer-companion vertical.
 *
 * Single source of truth: each capability is declared as a typed
 * Affordance object. The vertical's bridge derives MCP tool schemas
 * from this; it ALSO publishes these as cg:Affordance descriptors so
 * generic Interego agents can discover and invoke the capabilities
 * via the protocol's standard affordance-walk (no per-vertical client
 * code required at the consuming agent).
 *
 * Action IRIs use the urn:cg:action:lpc:<verb> convention. Targets
 * use {base} as a placeholder for the bridge's deployment URL,
 * substituted at affordance-publication time.
 */

import type { Affordance } from '../_shared/affordance-mcp/index.js';
import type { IRI } from '../../src/index.js';

const LPC_AFFORDANCES: ReadonlyArray<Affordance> = [
  {
    action: 'urn:cg:action:lpc:ingest-training-content' as IRI,
    toolName: 'lpc.ingest_training_content',
    title: 'Ingest training content',
    description: 'Unwrap a SCORM 1.2 / SCORM 2004 / cmi5 zip package, extract launchable lesson content, mint content-addressed PGSL atoms, and publish lpc:TrainingContent + lpc:LearningObjective descriptors to the user\'s pod.',
    method: 'POST',
    targetTemplate: '{base}/lpc/ingest_training_content',
    inputs: [
      { name: 'zip_base64', type: 'string', required: true, description: 'SCORM zip package, base64-encoded.' },
      { name: 'authoritative_source', type: 'string', required: true, description: 'DID of the training content publisher (e.g., did:web:acme-training.example).' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL (default: authenticated user\'s pod).' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID (default: derived from authentication).' },
    ],
  },

  {
    action: 'urn:cg:action:lpc:import-credential' as IRI,
    toolName: 'lpc.import_credential',
    title: 'Import a verifiable credential',
    description: 'Verify a W3C Verifiable Credential (vc-jwt or DataIntegrityProof JSON-LD) and publish as lpc:Credential to the user\'s pod. Verification failures throw — bad VCs never land in the pod under credential IRIs.',
    method: 'POST',
    targetTemplate: '{base}/lpc/import_credential',
    inputs: [
      { name: 'vc_jwt', type: 'string', required: false, description: 'Compact JWS encoding of the VC (use this OR vc_jsonld).' },
      { name: 'vc_jsonld', type: 'object', required: false, description: 'JSON-LD VC with embedded DataIntegrityProof (use this OR vc_jwt).' },
      { name: 'for_content', type: 'string', required: false, description: 'IRI of the lpc:TrainingContent this credential certifies.' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },

  {
    action: 'urn:cg:action:lpc:record-performance-review' as IRI,
    toolName: 'lpc.record_performance_review',
    title: 'Record a performance review',
    description: 'Publish a performance review with cg:ProvenanceFacet attributing it to the manager (NOT the user). Stays in the user\'s pod portably.',
    method: 'POST',
    targetTemplate: '{base}/lpc/record_performance_review',
    inputs: [
      { name: 'content', type: 'string', required: true, description: 'Review text.' },
      { name: 'manager_did', type: 'string', required: true, description: 'DID of the reviewing manager.' },
      { name: 'signature', type: 'string', required: true, description: 'Manager\'s ECDSA signature over the content.' },
      { name: 'recorded_at', type: 'string', required: true, description: 'ISO timestamp.' },
      { name: 'flags_capability', type: 'string', required: false, description: 'Optional capability IRI flagged by the review.' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },

  {
    action: 'urn:cg:action:lpc:record-learning-experience' as IRI,
    toolName: 'lpc.record_learning_experience',
    title: 'Record a learning experience from an xAPI Statement',
    description: 'Ingest an xAPI Statement (any version 1.0.x or 2.0.x) as an lpc:LearningExperience descriptor in the user\'s pod, cross-linked to training content and credential earned.',
    method: 'POST',
    targetTemplate: '{base}/lpc/record_learning_experience',
    inputs: [
      { name: 'statement', type: 'object', required: true, description: 'xAPI Statement object.' },
      { name: 'for_content', type: 'string', required: true, description: 'IRI of the related lpc:TrainingContent.' },
      { name: 'earned_credential', type: 'string', required: false, description: 'Optional IRI of the lpc:Credential earned.' },
      { name: 'lrs_endpoint', type: 'string', required: false, description: 'Optional source LRS endpoint URL.' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },

  {
    action: 'urn:cg:action:lpc:grounded-answer' as IRI,
    toolName: 'lpc.grounded_answer',
    title: 'Answer a grounded chat question',
    description: 'Answer a natural-language question by retrieving from the user\'s pod with verbatim citation. Returns null when nothing in the wallet grounds the question — honest no-data, no confabulation. Persists an lpc:CitedResponse audit record.',
    method: 'POST',
    targetTemplate: '{base}/lpc/grounded_answer',
    inputs: [
      { name: 'question', type: 'string', required: true, description: 'The user\'s question.' },
      { name: 'persist_response', type: 'boolean', required: false, description: 'Whether to persist the response as audit. Default true.' },
      { name: 'assistant_did', type: 'string', required: false, description: 'DID of the answering assistant.' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },

  {
    action: 'urn:cg:action:lpc:list-wallet' as IRI,
    toolName: 'lpc.list_wallet',
    title: 'Summarize the user\'s wallet',
    description: 'Return a summary of training content, credentials, performance records, and learning experiences in the user\'s pod-backed wallet.',
    method: 'POST',
    targetTemplate: '{base}/lpc/list_wallet',
    inputs: [
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },
];

export const lpcAffordances = LPC_AFFORDANCES;
