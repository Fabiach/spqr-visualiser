import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isSPQRTwinVirtualEdge } from '../js/spqrInteraction.js';

const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const start = main.indexOf('function addUnreplacedPPoleIndicators(');
assert.ok(start >= 0, 'Missing P pole-indicator renderer');
const source = main.slice(start, main.indexOf('\nfunction ', start + 1));

function fixture() {
  const virtualEdgeData = new Map([
    [5, { components: ['P1', 'S1'] }],
    [7, { components: ['P1', 'S2'] }],
    [9, { components: ['P2', 'S3'] }],
  ]);
  const context = vm.createContext({
    state: { data: { virtualEdgeData } },
    isSPQRTwinVirtualEdge,
  });
  vm.runInContext(source, context);
  return context;
}

test('a selected P pole indicator remains when no other twin is focused', () => {
  const context = fixture();
  const edges = new Map();
  const indicator = { virtualEdgeId: 5, ownerComponentId: 'P1' };
  context.addUnreplacedPPoleIndicators(edges, [indicator]);
  assert.deepEqual([...edges.keys()], [5]);
});

test('a focused virtual edge replaces the selected P pole indicator', () => {
  const context = fixture();
  const focused = { virtualEdgeId: 7, focused: true };
  const edges = new Map([[7, focused]]);
  const indicator = { virtualEdgeId: 5, ownerComponentId: 'P1' };
  context.addUnreplacedPPoleIndicators(edges, [indicator]);
  assert.deepEqual([...edges.keys()], [7]);
  assert.equal(edges.get(7), focused);
});

test('an unrelated virtual edge does not replace the selected P pole indicator', () => {
  const context = fixture();
  const edges = new Map([[9, { virtualEdgeId: 9, focused: true }]]);
  const indicator = { virtualEdgeId: 5, ownerComponentId: 'P1' };
  context.addUnreplacedPPoleIndicators(edges, [indicator]);
  assert.deepEqual([...edges.keys()], [9, 5]);
});
