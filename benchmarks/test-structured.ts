import { createPGSL, embedInPGSL, resolve as pgslResolve, latticeStats, latticeMeet } from '../src/pgsl/index.js';
import type { IRI } from '../src/model/types.js';

const pgsl = createPGSL({ wasAttributedTo: 'test' as IRI, generatedAtTime: new Date().toISOString() });

// Ingest ((0,0),(0,0)) as structured
const uriA = embedInPGSL(pgsl, '((0,0),(0,0))', undefined, 'structured');
console.log('=== ((0,0),(0,0)) ===');
console.log('URI:', uriA);
console.log('Resolved:', pgslResolve(pgsl, uriA));

const statsA = latticeStats(pgsl);
console.log('After first: atoms=' + statsA.atoms + ', fragments=' + statsA.fragments);
console.log('');

// Ingest (0,0,0) as structured
const uriB = embedInPGSL(pgsl, '(0,0,0)', undefined, 'structured');
console.log('=== (0,0,0) ===');
console.log('URI:', uriB);
console.log('Resolved:', pgslResolve(pgsl, uriB));

const statsB = latticeStats(pgsl);
console.log('After second: atoms=' + statsB.atoms + ', fragments=' + statsB.fragments);
console.log('');

// Are they different?
console.log('Same URI?', uriA === uriB);
console.log('');

// What do they share?
const meet = latticeMeet(pgsl, uriA, uriB);
if (meet) {
  console.log('Meet:', meet);
  console.log('Meet resolved:', pgslResolve(pgsl, meet));
} else {
  console.log('No shared sub-fragment (different structures)');
}

// Show all nodes
console.log('\n=== All nodes ===');
for (const [uri, node] of pgsl.nodes) {
  const resolved = pgslResolve(pgsl, uri as IRI);
  console.log('  L' + node.level + ': "' + resolved + '"');
}
