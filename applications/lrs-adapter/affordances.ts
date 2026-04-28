/**
 * Affordance declarations for the lrs-adapter vertical.
 *
 * Boundary translator between Interego pods and external xAPI LRSes.
 * Capabilities declared here once; bridge derives MCP tool schemas
 * from this; protocol publishes as cg:Affordance for generic
 * discovery.
 */

import type { Affordance } from '../_shared/affordance-mcp/index.js';
import type { IRI } from '../../src/index.js';

const LRS_AFFORDANCES: ReadonlyArray<Affordance> = [
  {
    action: 'urn:cg:action:lrs:ingest-statement' as IRI,
    toolName: 'lrs.ingest_statement',
    title: 'Ingest one xAPI Statement from an LRS',
    description: 'Fetch a single xAPI Statement from an LRS by ID, project as cg:ContextDescriptor in the user\'s pod with lrs:StatementIngestion audit. Auto-negotiates xAPI version (2.0.0 preferred; falls back to 1.0.3 for legacy LRSes like SCORM Cloud).',
    method: 'POST',
    targetTemplate: '{base}/lrs/ingest_statement',
    inputs: [
      { name: 'statement_id', type: 'string', required: true, description: 'xAPI Statement UUID.' },
      { name: 'lrs_endpoint', type: 'string', required: true, description: 'LRS xAPI endpoint URL.' },
      { name: 'lrs_username', type: 'string', required: true, description: 'LRS Basic auth username (Activity Provider key).' },
      { name: 'lrs_password', type: 'string', required: true, description: 'LRS Basic auth password (Activity Provider secret).' },
      { name: 'lrs_preferred_version', type: 'string', required: false, description: 'Preferred xAPI version.', enum: ['2.0.0', '1.0.3'] },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },
  {
    action: 'urn:cg:action:lrs:ingest-statement-batch' as IRI,
    toolName: 'lrs.ingest_statement_batch',
    title: 'Ingest a batch of xAPI Statements from an LRS',
    description: 'Fetch a batch of xAPI Statements from an LRS by filter (verb / activity / agent / since / until / limit) and publish each as cg:ContextDescriptor in the user\'s pod.',
    method: 'POST',
    targetTemplate: '{base}/lrs/ingest_statement_batch',
    inputs: [
      { name: 'lrs_endpoint', type: 'string', required: true, description: 'LRS xAPI endpoint URL.' },
      { name: 'lrs_username', type: 'string', required: true, description: 'LRS Basic auth username.' },
      { name: 'lrs_password', type: 'string', required: true, description: 'LRS Basic auth password.' },
      { name: 'lrs_preferred_version', type: 'string', required: false, description: 'Preferred xAPI version.', enum: ['2.0.0', '1.0.3'] },
      { name: 'verb', type: 'string', required: false, description: 'Filter by verb IRI.' },
      { name: 'activity', type: 'string', required: false, description: 'Filter by activity IRI.' },
      { name: 'agent', type: 'object', required: false, description: 'Filter by xAPI Agent.' },
      { name: 'since', type: 'string', required: false, description: 'ISO timestamp lower bound.' },
      { name: 'until', type: 'string', required: false, description: 'ISO timestamp upper bound.' },
      { name: 'limit', type: 'integer', required: false, description: 'Max statements to fetch.' },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },
  {
    action: 'urn:cg:action:lrs:project-descriptor' as IRI,
    toolName: 'lrs.project_descriptor',
    title: 'Project a descriptor to an LRS as an xAPI Statement',
    description: 'Read an Asserted descriptor from the pod and project to xAPI Statement, POST to the LRS. Counterfactual ALWAYS skipped; Hypothetical skipped without opt-in; multi-narrative descriptors lossy with audit-loud lossNote rows.',
    method: 'POST',
    targetTemplate: '{base}/lrs/project_descriptor',
    inputs: [
      { name: 'descriptor_iri', type: 'string', required: true, description: 'IRI of the descriptor to project.' },
      { name: 'actor', type: 'object', required: true, description: 'xAPI Agent shape for the Statement actor.' },
      { name: 'verb_id', type: 'string', required: true, description: 'xAPI verb IRI.' },
      { name: 'object_id', type: 'string', required: true, description: 'xAPI Activity IRI.' },
      { name: 'verb_display', type: 'string', required: false, description: 'Verb display name.' },
      { name: 'object_name', type: 'string', required: false, description: 'Activity display name.' },
      { name: 'modal_status', type: 'string', required: false, description: 'Source descriptor\'s modal status.', enum: ['Asserted', 'Hypothetical', 'Counterfactual'] },
      { name: 'allow_hypothetical', type: 'boolean', required: false, description: 'When true and modal_status=Hypothetical, project anyway with audit-loud lossy markers.' },
      { name: 'coherent_narratives', type: 'array', required: false, description: 'Multiple coherent narratives — preserved in result.extensions; lossy=true flag set.', itemType: 'string' },
      { name: 'lrs_endpoint', type: 'string', required: true, description: 'LRS xAPI endpoint URL.' },
      { name: 'lrs_username', type: 'string', required: true, description: 'LRS Basic auth username.' },
      { name: 'lrs_password', type: 'string', required: true, description: 'LRS Basic auth password.' },
      { name: 'lrs_preferred_version', type: 'string', required: false, description: 'Preferred xAPI version.', enum: ['2.0.0', '1.0.3'] },
      { name: 'pod_url', type: 'string', required: false, description: 'Pod URL.' },
      { name: 'user_did', type: 'string', required: false, description: 'User DID.' },
    ],
  },
  {
    action: 'urn:cg:action:lrs:lrs-about' as IRI,
    toolName: 'lrs.lrs_about',
    title: 'Probe an LRS\'s supported xAPI versions',
    description: 'Probe the LRS\'s /xapi/about endpoint to discover supported xAPI versions. Useful diagnostic for understanding which Statement projection target is appropriate.',
    method: 'POST',
    targetTemplate: '{base}/lrs/lrs_about',
    inputs: [
      { name: 'lrs_endpoint', type: 'string', required: true, description: 'LRS xAPI endpoint URL.' },
      { name: 'lrs_username', type: 'string', required: true, description: 'LRS Basic auth username.' },
      { name: 'lrs_password', type: 'string', required: true, description: 'LRS Basic auth password.' },
      { name: 'lrs_preferred_version', type: 'string', required: false, description: 'Preferred xAPI version.', enum: ['2.0.0', '1.0.3'] },
    ],
  },
];

export const lrsAffordances = LRS_AFFORDANCES;
