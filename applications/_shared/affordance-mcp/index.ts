/**
 * Affordance → MCP-tool-schema derivation.
 *
 * First-principles position: a vertical's capabilities are declared as
 * cg:Affordance descriptors (the spec-level artifact). MCP/JSON-RPC
 * tool schemas, REST endpoints, OpenAPI specs — all of those are
 * derivations of the same affordance description.
 *
 * This module:
 *   1. Defines a typed shape for affordances that's easy to author in TS
 *   2. Derives MCP tool schemas (JSON Schema) from that shape
 *   3. Derives Turtle serialization (cg:Affordance / hydra:Operation /
 *      dcat:Distribution) so generic agents can discover affordances
 *      via the protocol's existing discover_context flow
 *
 * Verticals declare capabilities ONCE in TS; bridges and discovery
 * surfaces derive from there. Single source of truth.
 */

import type { IRI } from '@interego/core';

// ── Types ─────────────────────────────────────────────────────────────

export type JsonScalarType = 'string' | 'number' | 'integer' | 'boolean';
export type JsonType = JsonScalarType | 'object' | 'array';

/** A single input parameter on an affordance. */
export interface AffordanceInput {
  /** Property name (used as JSON-RPC key + Hydra hydra:property). */
  readonly name: string;
  /** JSON Schema type. */
  readonly type: JsonType;
  /** Required vs optional. */
  readonly required: boolean;
  /** Free-text description; surfaces to LLM tool selection + Hydra rdfs:comment. */
  readonly description: string;
  /** For arrays — element type. */
  readonly itemType?: JsonScalarType | 'object';
  /** For enums — allowed values. */
  readonly enum?: readonly string[];
  /** For numbers — bounds. */
  readonly minimum?: number;
  readonly maximum?: number;
  /** For arrays — minimum length. */
  readonly minItems?: number;
}

/** A capability the vertical exposes. */
export interface Affordance {
  /** Canonical action IRI (urn:cg:action:<vertical>:<verb>). */
  readonly action: IRI;
  /** MCP tool name (typically <vertical>.<verb>). */
  readonly toolName: string;
  /** Short title (Hydra hydra:title). */
  readonly title: string;
  /** Description for tool selection + protocol docs. */
  readonly description: string;
  /** HTTP method for hydra:target invocation. */
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Endpoint URL (hydra:target). Templated with `{base}` placeholder for
   *  the bridge's deployment URL — substituted at affordance-publication
   *  time. */
  readonly targetTemplate: string;
  /** Input parameters. */
  readonly inputs: ReadonlyArray<AffordanceInput>;
  /** Optional return-type IRI (hydra:returns). */
  readonly returns?: IRI;
  /** Optional MIME type the endpoint emits. */
  readonly mediaType?: string;
}

// ── Derive: MCP tool schema ──────────────────────────────────────────

export interface McpToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
  };
}

interface JsonSchemaProperty {
  type: JsonType;
  description: string;
  items?: { type: JsonScalarType | 'object' };
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
}

/**
 * Derive an MCP tool schema (JSON Schema-compliant inputSchema) from an
 * Affordance. The MCP server / per-vertical bridge calls this for every
 * affordance to get its tool schema; never hand-writes one.
 */
export function affordanceToMcpToolSchema(affordance: Affordance): McpToolSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const input of affordance.inputs) {
    const prop: JsonSchemaProperty = {
      type: input.type,
      description: input.description,
    };
    if (input.type === 'array' && input.itemType) {
      prop.items = { type: input.itemType };
    }
    if (input.enum) prop.enum = input.enum;
    if (input.minimum !== undefined) prop.minimum = input.minimum;
    if (input.maximum !== undefined) prop.maximum = input.maximum;
    if (input.minItems !== undefined) prop.minItems = input.minItems;

    properties[input.name] = prop;
    if (input.required) required.push(input.name);
  }

  return {
    name: affordance.toolName,
    description: affordance.description,
    inputSchema: { type: 'object', properties, required },
  };
}

// ── Derive: Turtle (cg:Affordance / hydra:Operation) ────────────────

/**
 * Derive a `cg:Affordance / cgh:Affordance / hydra:Operation /
 * dcat:Distribution` Turtle block from an Affordance. The vertical's
 * bridge publishes this on startup so generic Interego agents can
 * discover the capability via the protocol's existing affordance-walk.
 *
 * The {base} placeholder in targetTemplate is substituted with the
 * caller-supplied deploymentUrl.
 */
export function affordanceToTurtle(affordance: Affordance, deploymentUrl: string): string {
  const target = affordance.targetTemplate.replace('{base}', deploymentUrl);

  const inputClassIri = `${affordance.action}-input`;
  const inputProps = affordance.inputs.map((input, i) => {
    const propIri = `<${affordance.action}-prop-${input.name}>`;
    return `        [
            a hydra:SupportedProperty ;
            hydra:property ${propIri} ;
            hydra:required ${input.required ? 'true' : 'false'} ;
            rdfs:comment "${escapeLit(input.description)}"
        ]${i < affordance.inputs.length - 1 ? '' : ''}`;
  }).join(' ,\n');

  return `<${affordance.action}> a cg:Affordance, cgh:Affordance, hydra:Operation, dcat:Distribution ;
    cg:action <${affordance.action}> ;
    hydra:method "${affordance.method}" ;
    hydra:title "${escapeLit(affordance.title)}" ;
    rdfs:comment "${escapeLit(affordance.description)}" ;
    hydra:target <${target}> ;
    dcat:accessURL <${target}> ;
    ${affordance.mediaType ? `dcat:mediaType "${affordance.mediaType}" ;` : ''}
    ${affordance.returns ? `hydra:returns <${affordance.returns}> ;` : ''}
    hydra:expects [
        a hydra:Class ;
        rdfs:label "${escapeLit(affordance.toolName)}-input" ;
        hydra:supportedProperty
${inputProps}
    ] ;
    cg:encrypted false .`;
}

/** Multi-affordance turtle document with prefixes and a common manifest IRI. */
export function affordancesManifestTurtle(
  manifestIri: string,
  affordances: readonly Affordance[],
  deploymentUrl: string,
  options?: { verticalLabel?: string; rdfsComment?: string },
): string {
  const prefixes = `@prefix cg:    <https://markjspivey-xwisee.github.io/interego/ns/cg#> .
@prefix cgh:   <https://markjspivey-xwisee.github.io/interego/ns/cgh#> .
@prefix hydra: <http://www.w3.org/ns/hydra/core#> .
@prefix dcat:  <http://www.w3.org/ns/dcat#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .`;

  const manifestBlock = `<${manifestIri}> a hydra:Collection ;
    rdfs:label "${escapeLit(options?.verticalLabel ?? 'Vertical capability manifest')}" ;
    ${options?.rdfsComment ? `rdfs:comment "${escapeLit(options.rdfsComment)}" ;` : ''}
${affordances.map(a => `    cg:affordance <${a.action}>`).join(' ;\n')} .`;

  const blocks = affordances.map(a => affordanceToTurtle(a, deploymentUrl)).join('\n\n');

  return `${prefixes}\n\n${manifestBlock}\n\n${blocks}\n`;
}

// ── Internals ────────────────────────────────────────────────────────

function escapeLit(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
