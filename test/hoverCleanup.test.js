import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPointerHoverLifecycle, getSPQRComponentColor } from '../js/spqrInteraction.js';

// Exercise the actual page handlers with in-memory SVG selections. No browser,
// timers or balanced event counts are required to reproduce a rapid transition.
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const handlerNames = [
  'handleMouseOverInput', 'highlight', 'unhighlight', 'highlightInSPQRDrawing',
  'unhighlightInSPQRDrawing', 'restoreSkeletonVertex', 'clearSkeletonElementHover',
];
const handlers = handlerNames.map(name => {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing handler: ${name}`);
  return main.slice(start, main.indexOf('\nfunction ', start + 1));
}).join('\n');

class Vertex {
  constructor(id, componentId = null) {
    this.datum = { id };
    this.componentId = componentId;
    this.attrs = new Map([['fill', componentId ? '#3498db' : 'steelblue']]);
    this.styles = new Map();
    this.isConnected = true;
  }
  contains(target) { return target === this; }
  closest() { return { getAttribute: () => this.componentId }; }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  get color() { return this.styles.get('fill') ?? this.attrs.get('fill'); }
}

class Selection {
  constructor(nodes) { this.nodes = nodes; }
  filter(predicate) { return new Selection(this.nodes.filter(node => predicate(node.datum))); }
  each(fn) { this.nodes.forEach(node => fn.call(node, node.datum)); return this; }
  attr(name, value) {
    if (arguments.length === 1) return this.nodes[0]?.getAttribute(name);
    for (const node of this.nodes) {
      if (value == null) node.attrs.delete(name);
      else node.setAttribute(name, value);
    }
    return this;
  }
  style(name, value) {
    if (arguments.length === 1) return this.nodes[0]?.styles.get(name);
    for (const node of this.nodes) node.styles.set(name, value);
    return this;
  }
  // Raising a hover target can generate additional pointer boundary events.
  raise() { throw new Error('Hover must preserve SVG stacking order'); }
}

function fixture() {
  const inputs = ['0', '1'].map(id => new Vertex(id));
  const skeletons = ['S1', 'P1'].flatMap(comp => inputs.map(node => new Vertex(node.datum.id, comp)));
  const components = ['S1', 'P1'].map(id => ({
    id, type: id[0], graph: new Map([[0, [1]], [1, [0]]]), isSelected: false, isHovered: false,
  }));
  const inputSel = new Selection(inputs);
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    pointerHover: createPointerHoverLifecycle(),
    state: {
      data: { spqrTree: components, articulationPoints: new Set() },
      ui_state: { drawMode: false, edgeStart: null },
    },
    elements: {
      svgInput: { node: () => ({}) },
      svgSPQR: { selectAll: () => new Selection(skeletons) },
    },
    d3: { select: node => new Selection([node]), zoomTransform: () => ({ k: 1 }) },
    InputZoomContainer: { selectAll: () => inputSel },
    getInputZoomAdjustedLength: value => value,
    zoomAdjustedR: value => value,
    zoomReferenceScales: { input: 1 },
    getSPQRComponentById: id => components.find(comp => comp.id === id),
    getSPQRComponentColor,
    isDraggingInputNode: false,
    skeletonElementHover: null,
    highlightComponent() {},
    renderInputVirtualEdgeHighlights() {},
  });
  vm.runInContext(handlers, context);
  const enter = node => context.handleMouseOverInput({ currentTarget: node }, node.datum, inputSel, null);
  return { context, inputs, skeletons, components, enter };
}

test('rapid repeated input hovers leave no yellow vertices in either drawing', () => {
  const { context, inputs, skeletons, enter } = fixture();
  for (let i = 0; i < 100; i++) {
    const node = inputs[i % 2];
    enter(node);
    enter(node); // Duplicate enter, without an extra leave.
    assert.equal(node.color, 'orange');
    assert.equal(skeletons.filter(v => v.color === 'orange').length, 2);
    if (i > 0) context.pointerHover.clear(inputs[(i + 1) % 2]); // Late leave.
    assert.equal(node.color, 'orange');
  }
  context.pointerHover.reconcile(new Vertex('outside')); // Missing final mouseleave.
  assert.ok(inputs.every(node => node.color === 'steelblue'));
  assert.ok(skeletons.every(node => node.color === '#3498db'));
  assert.ok(skeletons.every(node => node.getAttribute('data-base-r') === '6'));
});

test('input cleanup restores current selection colors even if selection changes during hover', () => {
  const { context, inputs, skeletons, components, enter } = fixture();
  enter(inputs[0]);
  components[0].isSelected = true;
  context.pointerHover.clear();
  assert.equal(inputs[0].color, 'green');
  assert.equal(skeletons[0].color, 'green');
  assert.equal(skeletons[2].color, '#3498db');
});

test('skeleton cleanup derives vertex colors from current state instead of a stale yellow snapshot', () => {
  const { context, inputs, skeletons } = fixture();
  const vertex = skeletons[0];
  vertex.setAttribute('fill', 'orange');
  inputs[0].styles.set('fill', 'orange');
  context.skeletonElementHover = {
    target: vertex, element: vertex, componentId: 'S1', kind: 'vertex', datum: vertex.datum,
    appearance: [['fill', 'orange']],
  };
  context.pointerHover.enter(vertex, context.clearSkeletonElementHover);
  context.pointerHover.clear();
  assert.equal(vertex.color, '#3498db');
  assert.equal(inputs[0].color, 'steelblue');
  assert.equal(context.skeletonElementHover, null);
});

test('clearing hover preserves an intentional edge-start color but clears the skeleton copies', () => {
  const { context, inputs, skeletons, enter } = fixture();
  enter(inputs[0]);
  context.state.ui_state.drawMode = true;
  context.state.ui_state.edgeStart = '0';
  context.pointerHover.clear();
  assert.equal(inputs[0].color, 'orange');
  assert.ok(skeletons.every(node => node.color === '#3498db'));
});

test('articulation-point cleanup restores red rather than keeping a transient hover color', () => {
  const { context, inputs, enter } = fixture();
  context.state.data.articulationPoints.add('0');
  enter(inputs[0]);
  context.pointerHover.clear();
  assert.equal(inputs[0].color, 'red');
});
