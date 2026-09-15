import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCompletingAnimationLifecycle } from '../js/spqrInteraction.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const tutorialSource = readFileSync(new URL('../js/tutorial.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '')
  .replace('export class Tutorial', 'class Tutorial')
  .replace('export default Tutorial;', 'globalThis.Tutorial = Tutorial;');

function fixture() {
  const frames = [];
  const events = [];
  const selection = new Proxy({}, { get: (_, key) => key === 'size' ? () => 0 : () => selection });
  const dom = () => ({
    style: {}, classList: { add() {}, remove() {} },
    addEventListener() {}, querySelector: () => null
  });
  const nodes = new Map();
  const lifecycle = createCompletingAnimationLifecycle();
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, dom()); return nodes.get(id); },
      querySelector: () => dom()
    },
    history: { pushState() {} }, requestAnimationFrame: callback => frames.push(callback),
    elements: { svgInput: { selectAll: () => selection, node: () => ({}) }, svgSPQR: { selectAll: () => selection } },
    pointerHover: { clear() {} }, isDraggingInputNode: false,
    stopEmbeddingAnimation: () => lifecycle.stop(),
    closePEmbeddingDialog: () => events.push('close-dialog'),
    clearGraph: () => events.push('clear-svg'), resetStats() {},
    initializeZoomContainer: kind => ({ kind, selectAll: () => selection }),
    InputZoomContainer: null, SPQRZoomContainer: null,
    updateEmbeddingSwitchButton() {}, updateRerootButton() {}, updateSwitchViewButton() {},
    updateInputActionButtons() {}, setActiveToolOff() {}, clearTimeout() {},
    d3: { select: () => selection, zoomTransform: () => ({ k: 1 }) },
    saveZoomState() {}, restoreZoomState() {}, refreshInputGraph() {},
    getInputZoomAdjustedLength: x => x, zoomAdjustedR: x => x, zoomReferenceScales: { input: 1 }
  });
  const stateStart = main.indexOf('const state = {');
  vm.runInContext(main.slice(stateStart, main.indexOf('\n};', stateStart) + 3) + '\nglobalThis.state = state;', context);
  for (const name of ['resetState', 'clearBothGraphs', 'clearTutorialGraph', 'addNewNode']) {
    const source = main.slice(main.indexOf(`function ${name}(`));
    vm.runInContext(source.slice(0, source.search(/^}\r?$/m) + 1), context);
  }
  vm.runInContext(tutorialSource, context);
  const tutorial = new context.Tutorial(context.state, {}, { clearGraph: context.clearTutorialGraph });
  tutorial.start(10);
  frames.splice(0).forEach(callback => callback());
  return { context, tutorial, lifecycle, frames, events };
}

for (const leave of ['next', 'exit', 'finish']) {
  test(`${leave} discards the previous graph and stops its animation before the next canvas edit`, () => {
    const { context: c, tutorial, lifecycle, events } = fixture();
    const state = c.state;
    state.data.graphNodes = [{ id: '8', x: 10, y: 20 }];
    state.data.graphEdges = [[8, 9]];
    state.data.graphLinks = [{ source: '8', target: '9' }];
    state.data.spqrTree = [{ id: 'P1' }];
    state.data.spqrRoot = state.data.spqrTree[0];
    state.data.inputNodePositions.set('8', { x: 10, y: 20 });
    state.data.edgeRoutes.set('8-9', {});
    state.data.composedDrawing = {};
    state.data.componentDefaultPositions.set('P1', {});
    state.ui.pendingHighlightCompId = 'P1';
    state.ui_state.drawMode = true;
    state.ui_state.edgeStart = '8';
    state.simulation.input = { stop: () => events.push('stop-input') };
    state.simulation.spqr = { stop: () => events.push('stop-spqr') };
    lifecycle.start({ stop: () => events.push('stop-animation') }, () => {
      // A transition's completion can still touch its old graph. It must finish
      // before reset clears the arrays and constructs the new SVG containers.
      state.data.graphNodes.push({ id: '9' });
    });
    events.length = 0;
    if (leave === 'exit') tutorial.exit();
    else {
      if (leave === 'finish') tutorial.currentStep = tutorial.steps.length - 1;
      tutorial.nextStep();
    }
    assert.equal(lifecycle.isActive(), false);
    for (const event of ['stop-animation', 'stop-input', 'stop-spqr']) {
      assert.ok(events.indexOf(event) >= 0 && events.indexOf(event) < events.indexOf('clear-svg'));
    }
    for (const key of ['graphNodes', 'graphEdges', 'graphLinks']) assert.equal(state.data[key].length, 0);
    for (const key of ['spqrTree', 'spqrRoot', 'composedDrawing']) assert.equal(state.data[key], null);
    assert.equal(state.data.edgeRoutes.size, 0);
    assert.equal(state.data.componentDefaultPositions.size, 0);
    assert.equal(state.ui.pendingHighlightCompId, null);
    assert.equal(state.ui_state.drawMode, false);
    assert.equal(state.ui_state.edgeStart, null);
    assert.equal(c.InputZoomContainer.kind, 'input');
    assert.equal(c.SPQRZoomContainer.kind, 'spqr');
    c.addNewNode(123, 456);
    assert.equal(state.data.graphNodes.length, 1);
    assert.equal(state.data.graphNodes[0].id, '1');
    assert.equal(state.data.graphNodes[0].x, 123);
    assert.equal(state.data.graphEdges.length, 0);
  });
}

test('queued tutorial callbacks cannot attach buttons or animations after navigation or exit', () => {
  for (const leave of ['next', 'exit']) {
    const { tutorial, frames } = fixture();
    let queried = 0;
    tutorial.textDiv.querySelector = () => { queried++; return null; };
    tutorial.setupExampleButton('oldExample', () => assert.fail('Old example was loaded'));
    tutorial.mountDecompositionAnimation();
    if (leave === 'exit') tutorial.exit();
    else tutorial.nextStep();
    frames.splice(0).forEach(callback => callback());
    assert.equal(queried, 0);
  }
});
