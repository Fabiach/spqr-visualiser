import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCompletingAnimationLifecycle,
  getInterComponentEdgePorts,
  getSPQRComponentColor,
} from '../js/spqrInteraction.js';

test('SPQR selection colors are determined by component type', () => {
  assert.equal(getSPQRComponentColor('R'), 'red');
  assert.equal(getSPQRComponentColor({ type: 'S' }), 'green');
  assert.equal(getSPQRComponentColor({ type: 'P' }), 'blue');
  assert.equal(getSPQRComponentColor('Q'), 'orange');
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
