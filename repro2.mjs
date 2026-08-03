import { computeGraphDrawing } from './js/spqrDrawing.js';
import { generateEdgesMap, spqr_tree } from './js/spqr.js';
import { edgesWikipedia } from './js/data.js';

function build() {
  const tree = spqr_tree(generateEdgesMap(edgesWikipedia));
  const counts = new Map();
  for (const c of tree) {
    const n = (counts.get(c.type) || 0) + 1;
    counts.set(c.type, n);
    c.id = `${c.type}${n}`;
    c.neighbors = [];
  }
  const ved = new Map();
  for (const c of tree) {
    for (const [nodes, id] of c.virtualEdgeEntry) {
      if (!ved.has(id)) ved.set(id, { components: [], nodes });
      ved.get(id).components.push(c.id);
    }
  }
  for (const { components } of ved.values()) {
    if (components.length !== 2) continue;
    const [a, b] = components;
    tree.find(c => c.id === a).neighbors.push({ id: b });
    tree.find(c => c.id === b).neighbors.push({ id: a });
  }
  return { tree, ved };
}

const { tree: t0 } = build();
console.error('COMPONENTS: ' + t0.map(c => c.id).join(', '));

for (const rootId of t0.map(c => c.id)) {
  for (const flipId of t0.filter(c => c.type === 'R').map(c => c.id)) {
    const { tree, ved } = build();
    const root = tree.find(c => c.id === rootId);
    let before, after;
    try { before = computeGraphDrawing(root, tree, ved, 1000, 1000).edgeRoutes.size; }
    catch (e) { before = 'ERR'; }
    const { tree: tree2, ved: ved2 } = build();
    const root2 = tree2.find(c => c.id === rootId);
    tree2.find(c => c.id === flipId).embeddingFlip = true;
    try { after = computeGraphDrawing(root2, tree2, ved2, 1000, 1000).edgeRoutes.size; }
    catch (e) { after = 'ERR'; }
    if (before !== after || after === 'ERR' || after > 0)
      console.error(`root=${rootId} flip=${flipId}: routes ${before} -> ${after}`);
  }
}
console.error('done');
