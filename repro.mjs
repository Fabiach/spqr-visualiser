import { computeGraphDrawing } from './js/spqrDrawing.js';
import { generateEdgesMap, spqr_tree } from './js/spqr.js';
import { edgesWikipedia } from './js/data.js';

const graph = new Map();
for (const [u, v] of edgesWikipedia) {
  if (!graph.has(u)) graph.set(u, []);
  if (!graph.has(v)) graph.set(v, []);
  graph.get(u).push(v);
  graph.get(v).push(u);
}
const tree = spqr_tree(graph);
const virtualEdgeData = new Map();
for (const component of tree) {
  component.neighbors = [];
  for (const [nodes, edgeId] of component.virtualEdgeEntry || []) {
    if (!virtualEdgeData.has(edgeId)) virtualEdgeData.set(edgeId, { components: [], nodes });
    virtualEdgeData.get(edgeId).components.push(component.id);
  }
}
for (const { components } of virtualEdgeData.values()) {
  if (components.length !== 2) continue;
  const [a, b] = components;
  tree.find(c => c.id === a).neighbors.push({ id: b });
  tree.find(c => c.id === b).neighbors.push({ id: a });
}
const root = tree[0];
console.log('components:', tree.map(c => `${c.id}(${c.type})`).join(', '));
console.log('root =', root.id);

function routesOf(label) {
  const d = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);
  const keys = [...d.edgeRoutes.keys()];
  console.log(`\n--- ${label} ---`);
  console.log('edgeRoutes count =', d.edgeRoutes.size, keys.length ? `keys=${JSON.stringify(keys)}` : '(none)');
  for (const [k, r] of d.edgeRoutes) console.log(`   ${k}: type=${r.type} pts=${r.points?.length ?? '-'} from=${r.from}`);
  return d;
}

routesOf('BEFORE flip');
const r3 = tree.find(c => c.id === 'R3') || tree.find(c => c.type === 'R');
console.log('\nflipping', r3.id);
r3.embeddingFlip = true;
routesOf('AFTER flip ' + r3.id);
