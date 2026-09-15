import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { generateEdgesMap, spqr_tree } from '../js/spqr.js';
import { factorials } from '../js/data.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function fixture({ manual = true, preset = false, routed = false, mode = 'fancy' } = {}) {
  const state = {
    data: {
      graphNodes: [{ id: '1', x: 50, y: 50 }, { id: '2', x: 200, y: 70 }, { id: '3', x: 80, y: 190 }],
      graphEdges: [[1, 2], [2, 3], [3, 1]],
      componentDefaultPositions: new Map(), draggedComponents: new Set(),
      inputLayoutIsManual: manual, isPreset: preset,
      edgeRoutes: new Map(routed ? [['1-2', {}]] : [])
    },
    simulation: {}, d3selections: {},
    ui_state: { spqrDrawingMode: mode, inputLabelsVisible: true }
  };
  let drawings = 0;
  let treeViews = 0;
  const button = {};
  const context = vm.createContext({
    state, factorials, generateEdgesMap, calculateSPQRTree: spqr_tree, structuredClone,
    console: { log() {}, warn() {}, error(error) { throw error; } },
    elements: { svgSPQR: {} }, document: { getElementById: () => ({}) },
    SPQRZoomContainer: null, InputZoomContainer: null,
    clearGraph() {}, initializeZoomContainer() {}, assignVirtualEdgeColors() {},
    findOptimalRoot: tree => tree[0],
    updateEmbeddingSwitchButton() {}, updateRerootButton() {}, updateSwitchViewButton() {},
    createSPQRVisualizationFancy: () => { treeViews++; },
    createSPQRVisualizationSimple: () => { treeViews++; },
    drawInputGraphFromSPQR: () => {
      drawings++;
      for (const node of state.data.graphNodes) { node.x = 999; node.y = 999; }
    },
    createPresetGraph: () => ({}), setupInputEventHandlers() {}, updateInputActionButtons() {},
    resetState: () => assert.fail('Graph loading unexpectedly failed'),
    drawFromSPQRBtn: button, getSelectedSPQRComponent: () => null,
    isBiconnected: () => true,
    d3: { select: () => ({ style() {} }) }
  });
  for (const name of ['buildSPQRNodes', 'buildSPQRLinks', 'buildAdjacencyList',
    'buildVirtualEdgeData', 'edgeSetSignature', 'createSPQRVisualization', 'drawInputGraph']) {
    const start = main.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const body = main.slice(start);
    vm.runInContext(body.slice(0, body.search(/^}\r?$/m) + 1), context, { filename: name });
  }
  const start = main.indexOf('drawFromSPQRBtn.onclick = function() {');
  assert.ok(start >= 0);
  vm.runInContext(main.slice(start, main.indexOf('\n    };', start) + 7), context);
  return { state, context, button, get drawings() { return drawings; }, get treeViews() { return treeViews; } };
}

test('calculating a manual graph builds the tree without moving vertices, even with old routes', () => {
  for (const mode of ['fancy', 'simple']) {
    const f = fixture({ routed: true, mode });
    const before = structuredClone(f.state.data.graphNodes);
    f.context.createSPQRVisualization();
    assert.equal(f.treeViews, 1);
    assert.equal(f.state.data.spqrTree.length, 1);
    assert.equal(f.state.data.spqrTree[0].type, 'S');
    assert.equal(f.drawings, 0);
    assert.deepEqual(f.state.data.graphNodes, before);
  }
});

test('loading a fresh example or pasted graph re-enables automatic drawing', () => {
  for (const name of [null, 'Wikipedia']) {
    const f = fixture();
    f.context.drawInputGraph([1, 2, 3], f.state.data.graphEdges, name);
    assert.equal(f.state.data.inputLayoutIsManual, false);
    f.context.createSPQRVisualization();
    assert.equal(f.drawings, 1);
  }
});

test('tutorial fixed layouts retain their existing automatic-drawing policy', () => {
  for (const routed of [false, true]) {
    const f = fixture({ manual: false, preset: true, routed });
    f.context.createSPQRVisualization();
    assert.equal(f.drawings, routed ? 1 : 0);
  }
});

test('explicit Draw from SPQR works for manual layouts with a missing, current, or stale tree', () => {
  for (const treeState of ['missing', 'current', 'stale']) {
    const f = fixture();
    if (treeState !== 'missing') f.context.createSPQRVisualization();
    if (treeState === 'stale') f.state.data.spqrTreeEdgeSignature = 'old graph';
    assert.equal(f.drawings, 0);
    f.button.onclick();
    assert.equal(f.drawings, 1);
    assert.ok(f.state.data.spqrRoot);
    assert.ok(f.state.data.graphNodes.every(node => node.x === 999));
  }
});
