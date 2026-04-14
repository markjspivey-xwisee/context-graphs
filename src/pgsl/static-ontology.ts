/**
 * @module pgsl/static-ontology
 * @description Loaders for the static, canonical ontology files in docs/ns/.
 *
 * The Context Graphs system has three co-designed ontology layers
 * plus a cross-layer alignment ontology, all authored by hand in
 * Turtle under `docs/ns/`:
 *
 *   - context-graphs.ttl  — the typed context descriptor layer (cg:)
 *   - pgsl.ttl            — the substrate lattice layer (pgsl:)
 *   - harness.ttl         — the agent/eval/decorator harness layer (cgh:)
 *   - alignment.ttl       — cross-layer mappings (align:)
 *
 * Each also has a SHACL shapes file:
 *
 *   - pgsl-shapes.ttl
 *   - harness-shapes.ttl
 *
 * These static files are the canonical, versioned, ontology-engineered
 * definitions. The functions in this module load them at runtime
 * (Node only — browser consumers should bundle the.ttl files
 * themselves via their build tool).
 *
 * The older `pgslOwlOntology()` / `pgslShaclShapes()` generators in
 * `rdf.ts` remain available for minimal in-memory serialization, but
 * for the full authoritative ontology with all rdfs:comment text,
 * SKOS concept schemes, and cross-layer alignments, use these loaders.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Named ontology files available for loading.
 */
export type OntologyName =
  | 'context-graphs'
  | 'pgsl'
  | 'pgsl-shapes'
  | 'harness'
  | 'harness-shapes'
  | 'alignment';

/**
 * Resolve the docs/ns/ directory relative to this module's location.
 *
 * Works whether the library is run from source (src/pgsl/) or
 * compiled (dist/pgsl/) — both are two levels deep inside the
 * package root.
 */
function resolveNsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'docs', 'ns');
}

/**
 * Load a static ontology file by name and return it as a Turtle string.
 *
 * Throws if the file doesn't exist. Node-only.
 *
 * @example
 * ```ts
 * import { loadOntology } from '@markjspivey-xwisee/context-graphs';
 *
 * const pgslTtl = loadOntology('pgsl');
 * const harnessTtl = loadOntology('harness');
 * const alignmentTtl = loadOntology('alignment');
 * ```
 */
export function loadOntology(name: OntologyName): string {
  const path = resolve(resolveNsDir(), `${name}.ttl`);
  return readFileSync(path, 'utf-8');
}

/**
 * Load ALL four ontologies (cg, pgsl, harness, alignment) as a single
 * concatenated Turtle document. Useful when you want to load the full
 * system into a triple store in one pass.
 *
 * Note that the four files each declare their own prefix list; the
 * concatenated output repeats them, which most Turtle parsers handle
 * correctly (later declarations simply redeclare the same prefixes).
 * If your parser is strict, load each file individually.
 */
export function loadFullOntology(): string {
  const parts: string[] = [
    '# ═══════════════════════════════════════════════════════════',
    '# Context Graphs 1.0 — Full Ontology (cg + pgsl + harness + alignment)',
    '# ═══════════════════════════════════════════════════════════',
    '',
    loadOntology('context-graphs'),
    '',
    loadOntology('pgsl'),
    '',
    loadOntology('harness'),
    '',
    loadOntology('alignment'),
  ];
  return parts.join('\n');
}

/**
 * Load all SHACL shape files (pgsl-shapes + harness-shapes) concatenated.
 * Use this to validate an RDF graph against the full system's constraints.
 */
export function loadFullShapes(): string {
  const parts: string[] = [
    '# ═══════════════════════════════════════════════════════════',
    '# Context Graphs 1.0 — Full SHACL Shapes (pgsl + harness)',
    '# ═══════════════════════════════════════════════════════════',
    '',
    loadOntology('pgsl-shapes'),
    '',
    loadOntology('harness-shapes'),
  ];
  return parts.join('\n');
}

/**
 * Enumerate the named ontology files shipped with the library.
 * Each entry includes the name, namespace, and a brief description.
 */
export interface OntologyManifestEntry {
  readonly name: OntologyName;
  readonly namespace: string;
  readonly prefix: string;
  readonly kind: 'ontology' | 'shapes';
  readonly description: string;
}

/**
 * The manifest of every ontology file shipped with the library.
 * A programmatic index that mirrors the `docs/ns/README.md` documentation.
 */
export const ONTOLOGY_MANIFEST: readonly OntologyManifestEntry[] = [
  {
    name: 'context-graphs',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/context-graphs#',
    prefix: 'cg',
    kind: 'ontology',
    description:
      'Typed context descriptor layer. Seven facet types (Temporal, Provenance, Agent, AccessControl, Semiotic, Trust, Federation), composition operators (union, intersection, restriction, override), and federation primitives.',
  },
  {
    name: 'pgsl',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/pgsl#',
    prefix: 'pgsl',
    kind: 'ontology',
    description:
      'Poly-Granular Sequence Lattice substrate. Atoms, fragments, pullback squares, constituent morphisms, transitive containment. Aligned with PROV-O.',
  },
  {
    name: 'pgsl-shapes',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/pgsl#',
    prefix: 'pgsl',
    kind: 'shapes',
    description:
      'SHACL shapes that validate PGSL serializations: atom/fragment invariants, pullback commutativity, PROV-O provenance triples.',
  },
  {
    name: 'harness',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/harness#',
    prefix: 'cgh',
    kind: 'ontology',
    description:
      'Agent harness layer. Abstract Agent Types (AAT), policy engine with ODRL alignment, PROV traces, runtime evaluation with confidence scoring, decision functor, and affordance decorators.',
  },
  {
    name: 'harness-shapes',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/harness#',
    prefix: 'cgh',
    kind: 'shapes',
    description:
      'SHACL shapes for the harness layer: AAT invariants, policy rule well-formedness, PROV trace completeness, runtime eval bounds.',
  },
  {
    name: 'alignment',
    namespace: 'https://markjspivey-xwisee.github.io/context-graphs/ns/alignment#',
    prefix: 'align',
    kind: 'ontology',
    description:
      'Cross-layer alignment ontology tying cg, pgsl, and cgh together. Includes SKOS concept-scheme matches, external W3C vocabulary alignments (PROV-O, Hydra, ODRL, ACL, VC, DCAT, OWL-Time), and named integration patterns.',
  },
];

/**
 * Get the manifest entry for a named ontology file.
 */
export function getOntologyManifest(name: OntologyName): OntologyManifestEntry {
  const entry = ONTOLOGY_MANIFEST.find(e => e.name === name);
  if (!entry) {
    throw new Error(`Unknown ontology: ${name}`);
  }
  return entry;
}
