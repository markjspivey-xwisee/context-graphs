# Interego — Derivation Discipline

**Purpose.** Make the "higher levels built from lower levels" claim
checkable. Every class, property, or concept at L2 (architecture
patterns) or L3 (implementation / adjacent ontologies) MUST be
derivable from L1 (core protocol) + standard W3C vocabularies
(prov, dct, dcat, hydra, foaf, owl, rdfs, sh, xsd).

"Derivable" means one of these is present on the class / property:

1. `owl:equivalentClass <L1-term>` — strong identification; the
   higher-level class IS the lower-level class.
2. `rdfs:subClassOf <L1-or-W3C-term>` — the higher-level class is
   a specialization.
3. `rdfs:subPropertyOf <L1-or-W3C-property>` — for properties.
4. `cg:constructedFrom (<primitive> <primitive> ...)` — explicit
   construction when subClassOf / equivalentClass don't fit
   (e.g., a composite derived from multiple L1 primitives).
5. The term itself IS primitive (L1) — explicit in the ontology
   spec.

Anything without one of these is **ungrounded** and should either
be grounded or removed.

---

## Layer map

```
                Set (zero: membership + equality)
                 │
                 ▼
L1 PRIMITIVES    cg:ContextFacetData  (Set of properties typed by
                                       facet kind: Temporal,
                                       Provenance, Agent,
                                       AccessControl, Semiotic,
                                       Trust, Federation)
                 │
                 ▼
L1              cg:ContextDescriptor  (presheaf F^op → Set —
                                       maps facet types to
                                       facet-instance sets)
                 │
                 ▼
L1 ALGEBRA       Composition operators union / intersection /
                 restriction / override over ContextDescriptor.
                 These form a BOUNDED LATTICE at the facet-TYPE
                 level (classical idempotence + commutativity +
                 associativity + absorption hold on type sets;
                 multi-facet preservation is the design choice
                 that lets modal polyphony survive composition.)
                 │
                 ├──→ L1 pgsl:  Poly-Granular Sequence Lattice —
                 │              presheaf category L^op → Set with
                 │              subobject classifier Ω. Atom ⇉
                 │              Fragment via overlapping-pair
                 │              pullback (categorical pullback in
                 │              Set over the shared middle atom).
                 │
                 ├──→ L1 ie:    Interego namespace — protocol-
                 │              normative identifiers shared
                 │              across core + PGSL + align.
                 │
                 └──→ L1 align: Alignment — equivalentClass /
                                subClassOf declarations that
                                import external vocabularies
                                (SNOMED, ICD, W3C) into the
                                Interego category.

                  ═══════════════ L1/L2 boundary ═══════════════

L2 PATTERNS      hyprcat:, hypragent: — federation / agent-mesh
                 PATTERN ontologies. Each class subClassOf either
                 a cg:/ie: primitive or a W3C-standard term.

                  ═══════════════ L2/L3 boundary ═══════════════

L3 DOMAINS       hela:, sat:, cts:, olke:, amta: — domain-specific
                 extensions. Each class owl:equivalentClass or
                 rdfs:subClassOf an L1 term or a W3C-standard term.
                 These ontologies MUST NOT introduce novel primitive
                 structure; they are LENSES on the L1 substrate.

L3 IMPLEMENTATION src/, mcp-server/, deploy/, examples/.
                 TypeScript types that realize the L1 ontology;
                 no domain-specific types introduced at this layer.
```

## Derivation rules per class (audit table)

Updated automatically by `tools/derivation-lint.mjs` — ungrounded
classes fail CI.

### SAT (Semiotic Agent Topos)

| Class | Grounding | Notes |
|---|---|---|
| `sat:SemioticFieldFunctor` | `owl:equivalentClass cg:SemioticFacet` | ✓ strong |
| `sat:SemioticField` | `rdfs:subClassOf cg:SemioticFacet` | add |
| `sat:SemioticAgent` | `rdfs:subClassOf prov:Agent` | add |
| `sat:SemiosisEndofunctor` | `cg:constructedFrom (cg:SemioticFacet cg:SemioticFacet)` | add (iterated application of the Σ functor) |
| `sat:Interpretant` | `rdfs:subClassOf cg:SemioticFacet` | add (facet IS the interpretant of the sign) |
| `sat:Representamen` | `rdfs:subClassOf cg:ContextDescriptor` | add (descriptor IS the sign vehicle) |
| `sat:Object` | external referent — primitive, not a cg: type | mark explicit primitive |
| `sat:FixedPoint` | `cg:constructedFrom (sat:SemiosisEndofunctor)` | add (limit of endofunctor iteration) |

### HELA (topos-theoretic xAPI)

| Class | Grounding |
|---|---|
| `hela:Statement` | `rdfs:subClassOf prov:Activity` (already) |
| `hela:Trace` | `rdfs:subClassOf cg:ContextDescriptor` (add) |
| `hela:Omega` | `cg:constructedFrom (pgsl:Fragment cg:SemioticFacet)` (add — subobject classifier from PGSL + Semiotic) |
| `hela:SubPresheaf` | `rdfs:subClassOf cg:ContextDescriptor` (add) |
| `hela:LearnerObject` | `rdfs:subClassOf prov:Agent` (add) |
| `hela:Verb` | primitive — marks explicit |

### CTS (Compositional Tuple Store)

| Class | Grounding |
|---|---|
| `cts:Pattern` | `owl:equivalentClass cg:SyntagmaticPattern` (already) |
| rest | audit |

### OLKE (Organizational Learning)

All 2 classes currently ungrounded. `olke:KnowledgeEvolution`
should be `rdfs:subClassOf cg:ProvenanceFacet`. Similar for
`olke:LearningCycle`.

### AMTA (Agent-Mediated Trust Attestation)

All 6 classes audit; most should `rdfs:subClassOf cg:TrustFacet`
or `prov:Attribution`.

### HyprCat / HyprAgent

Already well-grounded (6 + 6 `rdfs:subClassOf` links). Remaining
classes checked by the lint.

---

## Runtime derivation

When the ontology says `X cg:constructedFrom (A B)`, implementations
SHOULD expose a runtime function that actually produces an `X` from
instances of `A` and `B`:

- `sat:SemiosisEndofunctor` → iterative `interpret(sign)` that
  returns the next interpretant.
- `hela:Omega` → `constructOmega(pgsl, semiotic)` → the subobject
  classifier as a runtime data structure.
- Composition operators (already implemented): `union`,
  `intersection`, `restriction`, `override` are the derivations of
  the lattice join / meet / restriction / override operations.
- Cross-pod geometric morphisms: `inverseImage(podA, podB)` /
  `directImage(podA, podB)` — pullback / pushforward of the
  descriptor presheaf along a pod inclusion.

This is the "emergent properties are actually constructable" test:
any higher-level phenomenon named in the ontology should be
derivable at runtime from L1 primitives, not just asserted.

---

## Enforcement

1. **Ontology grounding** — `tools/derivation-lint.mjs` walks every
   L2/L3 `.ttl` file, enumerates declared classes + properties, and
   fails CI if any lacks grounding (rules 1-5 above).
2. **Runtime derivation** — `tests/derivation.test.ts` asserts the
   runtime constructor exists and produces the expected shape for
   every class with `cg:constructedFrom`.
3. **Layer discipline** — `spec/LAYERS.md`'s existing transplant
   test is preserved; this derivation rule is additive (L2/L3 can
   still reference their own primitives AS LONG AS those primitives
   are grounded in L1).
