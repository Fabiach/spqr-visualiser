import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompletingAnimationLifecycle,
  createPointerHoverLifecycle,
  getInterComponentEdgePorts,
  getSPQRComponentColor,
  getSPQRSkeletonEdges,
  getSPQRTwinComponentId,
  getSPQRVirtualEdgeColor,
  isSPQRTwinVirtualEdge,
} from '../js/spqrInteraction.js';

function hoverTarget() {
  return { isConnected: true, contains(target) { return target === this; } };
}

test('repeated enters and a single leave clear a transient highlight exactly once', () => {
  const hover = createPointerHoverLifecycle();
  const target = hoverTarget();
  let paints = 0, clears = 0;
  for (let i = 0; i < 100; i++) {
    if (hover.enter(target, () => { clears++; })) paints++;
  }
  assert.equal(paints, 1);
  assert.equal(hover.clear(target), true);
  assert.equal(hover.clear(target), false);
  assert.equal(clears, 1);
});

test('moving rapidly between targets clears the old highlight even without its leave event', () => {
  const hover = createPointerHoverLifecycle();
  const first = hoverTarget(), second = hoverTarget();
  const events = [];
  hover.enter(first, () => events.push('first cleared'));
  hover.enter(second, () => events.push('second cleared'));
  assert.deepEqual(events, ['first cleared']);
  assert.equal(hover.clear(first), false); // A late leave cannot clear the new target.
  assert.equal(hover.isActive(second), true);
  hover.reconcile(hoverTarget());
  assert.deepEqual(events, ['first cleared', 'second cleared']);
});

test('redrawn targets and interrupted pointer interactions release hover state', () => {
  const hover = createPointerHoverLifecycle();
  const target = hoverTarget();
  let clears = 0;
  hover.enter(target, () => { clears++; hover.clear(); });
  hover.reconcile(target);
  assert.equal(clears, 0);
  target.isConnected = false;
  hover.reconcile(target);
  assert.equal(clears, 1);
  hover.enter(hoverTarget(), () => { clears++; });
  hover.clear(); // Window blur, pointer cancellation, or drag start.
  assert.equal(clears, 2);
});

test('SPQR selection colors are determined by component type', () => {
  assert.equal(getSPQRComponentColor('R'), 'red');
  assert.equal(getSPQRComponentColor({ type: 'S' }), 'green');
  assert.equal(getSPQRComponentColor({ type: 'P' }), 'blue');
  assert.equal(getSPQRComponentColor('Q'), 'orange');
});

test('twin virtual edges retain their shared color regardless of component type or endpoint order', () => {
  const colors = new Map([[0, { color: '#f58231' }]]);
  const series = {
    type: 'S', graph: new Map([[1, [2, 3]], [2, [1, 3]], [3, [1, 2]]]),
    virtualEdgeEntry: [[[2, 1], 0]],
  };
  const parallel = {
    type: 'P', graph: new Map([[1, null], [2, null]]), virtualEdgeEntry: [[[1, 2], 0]],
  };
  const edges = getSPQRSkeletonEdges(series, colors, 'fallback');
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.filter(edge => edge.virtualEdgeId === undefined).map(edge => edge.color), ['green', 'green']);
  assert.equal(edges.find(edge => edge.virtualEdgeId === 0).color, '#f58231');
  assert.equal(getSPQRSkeletonEdges(parallel, colors, 'fallback')[0].color, '#f58231');
});

test('only virtual edges shared by two distinct SPQR nodes are twins', () => {
  const edges = new Map([
    [0, { components: ['S1', 'P1'], nodes: [1, 2] }],
    [1, { components: ['S1'], nodes: [2, 3] }],
    [2, { components: ['S1', 'S1'], nodes: [3, 4] }],
  ]);
  assert.equal(isSPQRTwinVirtualEdge(edges, 0, 'S1'), true);
  assert.equal(isSPQRTwinVirtualEdge(edges, 0, 'P1'), true);
  assert.equal(isSPQRTwinVirtualEdge(edges, 0, 'R1'), false);
  assert.equal(isSPQRTwinVirtualEdge(edges, 1, 'S1'), false);
  assert.equal(isSPQRTwinVirtualEdge(edges, 2, 'S1'), false);
  assert.equal(isSPQRTwinVirtualEdge(edges, 99, 'S1'), false);
});

test('a twin virtual edge identifies the neighboring SPQR node', () => {
  const edges = new Map([
    [0, { components: ['S1', 'P1'], nodes: [1, 2] }],
    [1, { components: ['S1'], nodes: [2, 3] }],
    [2, { components: ['S1', 'S1'], nodes: [3, 4] }],
  ]);
  assert.equal(getSPQRTwinComponentId(edges, 0, 'S1'), 'P1');
  assert.equal(getSPQRTwinComponentId(edges, 0, 'P1'), 'S1');
  assert.equal(getSPQRTwinComponentId(edges, 0, 'R1'), null);
  assert.equal(getSPQRTwinComponentId(edges, 1, 'S1'), null);
  assert.equal(getSPQRTwinComponentId(edges, 2, 'S1'), null);
});

test('P skeletons keep each parallel virtual edge distinct from the real pole edge', () => {
  const component = {
    type: 'P', graph: new Map([[0, [1]], [1, [0]]]),
    virtualEdgeEntry: [[[0, 1], 0], [[1, 0], 1], [[0, 1], 2]],
  };
  const colors = new Map([[0, { color: 'cyan' }], [1, { color: 'magenta' }], [2, { color: 'gold' }]]);
  const edges = getSPQRSkeletonEdges(component, colors, 'fallback');
  assert.equal(edges.length, 4);
  assert.deepEqual(edges.map(edge => edge.color), ['blue', 'cyan', 'magenta', 'gold']);
  assert.deepEqual(edges.slice(1).map(edge => edge.virtualEdgeId), [0, 1, 2]);
  assert.equal(edges[0].source, '0');
});

test('rigid real edges use the type color and missing virtual colors use the drawing fallback', () => {
  const component = {
    type: 'R', graph: new Map([[1, [2, 3]], [2, [1]], [3, [1]]]),
    virtualEdgeEntry: [[[3, 1], 7]],
  };
  assert.deepEqual(getSPQRSkeletonEdges(component, new Map(), '#e6194b'), [
    { source: '1', target: '2', color: 'red' },
    { source: '3', target: '1', virtualEdgeId: 7, color: '#e6194b' },
  ]);
  assert.equal(getSPQRVirtualEdgeColor(undefined, 0, '#e6194b'), '#e6194b');
});

test('free positioning uses side ports for horizontally separated overlapping nodes', () => {
  const posA = { x: 0, y: 0 };
  const boxA = { x: -50, y: -40, width: 100, height: 80 };
  const posB = { x: 240, y: 10 };
  const boxB = { x: -40, y: -30, width: 80, height: 60 };

  assert.deepEqual(
    getInterComponentEdgePorts(posA, boxA, posB, boxB, true),
    {
      pointA: { x: 50, y: 0 },
      pointB: { x: 200, y: 10 },
    }
  );
});

test('tree positioning keeps top/bottom ports for the same node placement', () => {
  const posA = { x: 0, y: 0 };
  const boxA = { x: -50, y: -40, width: 100, height: 80 };
  const posB = { x: 240, y: 10 };
  const boxB = { x: -40, y: -30, width: 80, height: 60 };

  assert.deepEqual(
    getInterComponentEdgePorts(posA, boxA, posB, boxB, false),
    {
      pointA: { x: 0, y: 40 },
      pointB: { x: 240, y: -20 },
    }
  );
});

test('a naturally completed animation stops its D3 timer and finalizes once', () => {
  let stops = 0;
  let finishes = 0;
  const timer = { stop: () => { stops += 1; } };
  const lifecycle = createCompletingAnimationLifecycle();

  lifecycle.start(timer, () => { finishes += 1; });
  assert.equal(lifecycle.complete(timer), true);
  assert.equal(stops, 1);
  assert.equal(finishes, 1);
  assert.equal(lifecycle.isActive(), false);

  assert.equal(lifecycle.complete(timer), false);
  assert.equal(stops, 1);
  assert.equal(finishes, 1);
});

test('interrupting an animation snaps it to completion before drag updates', () => {
  const events = [];
  const timer = { stop: () => events.push('timer stopped') };
  const lifecycle = createCompletingAnimationLifecycle();

  lifecycle.start(timer, () => events.push('geometry finalized'));
  assert.equal(lifecycle.stop(), true);
  assert.deepEqual(events, ['timer stopped', 'geometry finalized']);
  assert.equal(lifecycle.stop(), false);
});

test('starting a replacement animation completes the previous animation', () => {
  const events = [];
  const first = { stop: () => events.push('first stopped') };
  const second = { stop: () => events.push('second stopped') };
  const lifecycle = createCompletingAnimationLifecycle();

  lifecycle.start(first, () => events.push('first finalized'));
  lifecycle.start(second, () => events.push('second finalized'));

  assert.deepEqual(events, ['first stopped', 'first finalized']);
  assert.equal(lifecycle.complete(first), false);
  assert.equal(lifecycle.complete(second), true);
  assert.deepEqual(events, [
    'first stopped',
    'first finalized',
    'second stopped',
    'second finalized',
  ]);
});
