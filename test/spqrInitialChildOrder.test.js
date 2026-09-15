import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { edgesDB, edgesWikipedia, verticesDB, verticesWikipedia } from '../js/data.js';
import { generateEdgesMap, spqr_tree } from '../js/spqr.js';
import { computeGraphDrawing, getPEmbeddingOrder, setPEmbeddingOrder, P_AXIS_SLOT } from '../js/spqrDrawing.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const functions = [
  'findOptimalRoot', 'dfsMaxDistance', 'findPath',
  'SPQRComponentPositionsFromInputGraph', 'sortChildrenSpatiallyAdvanced',
  'buildTreeStructure', 'logTreeHierarchyWithLevels',
  'getParentVirtualEdgeIdForComponent', 'getPChildComponentIds',
  'getDefaultPEmbeddingOrder', 'normalizePEmbeddingOrder', 'ensurePEmbeddingOrder',
  'getStoredPChildOrder', 'sortChildrenByVirtualEdgeOrder',
  'reingoldTilfordLayout', 'firstWalk', 'secondWalk', 'checkForConflicts',
  'getMinDistance', 'getContour', 'enforceLevelWideSpacing', 'logNodePositions',
  'drawSPQRTreeReingoldTilford', 'storeInputNodePositions', 'refreshSPQRLayoutFromInputDrawing'
];

function fixture(vertices, edges) {
  const tree = spqr_tree(generateEdgesMap(edges));
  const counts = {};
  const virtualEdgeData = new Map();
  for (const comp of tree) {
    comp.id = comp.type + (counts[comp.type] = (counts[comp.type] || 0) + 1);
    comp.neighbors = [];
    for (const [nodes, id] of comp.virtualEdgeEntry) {
      if (!virtualEdgeData.has(id)) virtualEdgeData.set(id, { nodes, components: [] });
      virtualEdgeData.get(id).components.push(comp.id);
    }
  }
  for (const { components } of virtualEdgeData.values()) {
    if (components.length !== 2) continue;
    const [a, b] = components;
    tree.find(c => c.id === a).neighbors.push({ id: b });
    tree.find(c => c.id === b).neighbors.push({ id: a });
  }
  // D3's deterministic initial coordinates, before the stopped simulation ticks.
  const nodes = vertices.map((id, i) => ({
    id: String(id),
    x: 10 * Math.sqrt(i + 0.5) * Math.cos(i * Math.PI * (3 - Math.sqrt(5))),
    y: 10 * Math.sqrt(i + 0.5) * Math.sin(i * Math.PI * (3 - Math.sqrt(5)))
  }));
  const state = {
    data: { spqrTree: tree, virtualEdgeData, inputNodePositions: new Map() },
    ui: { preferSRoot: false },
    ui_state: { spqrDrawingMode: 'fancy' }
  };
  let renderedTree;
  let refreshCount = 0;
  const context = vm.createContext({
    state, getPEmbeddingOrder, setPEmbeddingOrder, P_AXIS_SLOT,
    console: { log() {}, warn() {} },
    elements: {
      svgInput: { selectAll: () => ({ each: callback => nodes.forEach(callback) }) },
      svgSPQR: { node: () => ({ getBoundingClientRect: () => ({ width: 1000, height: 1000 }) }) }
    },
    // Only the DOM painting is stubbed; tree ordering and layout run unchanged.
    drawTreeWithLayout: layout => { renderedTree = layout; },
    centerSPQRView() {},
    refreshSPQRPictograms: () => { refreshCount++; }
  });
  for (const name of functions) {
    const start = main.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing function ${name}`);
    vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), context);
  }
  state.data.spqrRoot = context.findOptimalRoot(tree);
  context.storeInputNodePositions();
  return {
    state, context, tree,
    get renderedTree() { return renderedTree; },
    get refreshCount() { return refreshCount; },
    compose() {
      const drawing = computeGraphDrawing(state.data.spqrRoot, tree, virtualEdgeData, 1000, 1000);
      for (const node of nodes) Object.assign(node, drawing.positions.get(Number(node.id)));
      return drawing;
    }
  };
}

const order = (f, id) => Array.from(f.tree.find(c => c.id === id).treeChildOrder);

for (const example of [
  { name: 'DiBattista', vertices: verticesDB, edges: edgesDB, parent: 'R1', expected: ['S4', 'P1'] },
  { name: 'Wikipedia', vertices: verticesWikipedia, edges: edgesWikipedia, parent: 'S1', expected: ['R3', 'R2', 'P1'] }
]) {
  test(`${example.name} child order follows final input coordinates on the first draw`, () => {
    const f = fixture(example.vertices, example.edges);
    if (example.name === 'DiBattista') {
      setPEmbeddingOrder(f.tree.find(c => c.id === 'P1'), ['S3', P_AXIS_SLOT, 'S2']);
    }
    const root = f.state.data.spqrRoot;
    f.context.drawSPQRTreeReingoldTilford(root);
    assert.notDeepEqual(order(f, example.parent), example.expected);
    const pOrders = f.tree.filter(c => c.type === 'P').map(c => [c, [...c.embeddingOrder]]);
    f.compose();
    f.context.refreshSPQRLayoutFromInputDrawing();
    assert.deepEqual(order(f, example.parent), example.expected);
    const children = f.renderedTree.nodes[example.parent].children;
    assert.ok(children.every((child, i) => i === 0 || child.x > children[i - 1].x));
    assert.equal(f.state.data.spqrRoot, root);
    assert.equal(f.state.data.spqrTree, f.tree);
    for (const [comp, expected] of pOrders) assert.deepEqual([...comp.embeddingOrder], expected);
    // Clicking Draw from SPQR again keeps the same corrected order.
    f.compose();
    f.context.refreshSPQRLayoutFromInputDrawing();
    assert.deepEqual(order(f, example.parent), example.expected);
  });
}

test('post-drawing layout preserves a manually chosen root', () => {
  const f = fixture(verticesWikipedia, edgesWikipedia);
  const root = f.tree.find(c => c.type === 'R');
  f.state.data.spqrManualRoot = root;
  f.context.drawSPQRTreeReingoldTilford(root);
  f.compose();
  f.context.refreshSPQRLayoutFromInputDrawing();
  assert.equal(f.state.data.spqrRoot, root);
  assert.equal(f.state.data.spqrManualRoot, root);
  assert.equal(f.renderedTree.root.id, root.id);
});

test('simple view and collapsed components do not trigger a full tree relayout', () => {
  for (const mode of ['simple', 'collapsed']) {
    const f = fixture(verticesDB, edgesDB);
    f.state.ui_state.spqrDrawingMode = mode === 'simple' ? 'simple' : 'fancy';
    f.state.data.anySPQRComponentCollapsed = mode === 'collapsed';
    f.context.refreshSPQRLayoutFromInputDrawing();
    assert.equal(f.renderedTree, undefined);
    assert.equal(f.refreshCount, 1);
  }
});
