import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fitBoundsToViewport,
  getAdaptiveInputMaxZoomRatio,
  getInputDrawingBounds,
  getInputZoomAdjustedLength
} from '../js/inputViewport.js';

test('fit uses SVG viewBox coordinates and centers the drawing', () => {
  const fit = fitBoundsToViewport(
    { minX: 100, minY: 200, maxX: 500, maxY: 600 },
    { x: 0, y: 0, width: 1000, height: 1000 },
    { padding: 50 }
  );

  assert.equal(fit.scale, 2.25);
  assert.equal(((100 + 500) / 2) * fit.scale + fit.translateX, 500);
  assert.equal(((200 + 600) / 2) * fit.scale + fit.translateY, 500);
});

test('drawing bounds include routed-edge control points', () => {
  const positions = new Map([
    [1, { x: 100, y: 100 }],
    [2, { x: 300, y: 300 }]
  ]);
  const routes = new Map([
    ['1-2', { type: 'polyline', points: [{ x: 40, y: 350 }] }],
    ['2-3', { type: 'cubic', cp1: { x: 500, y: 80 }, cp2: { x: 450, y: 400 } }]
  ]);

  assert.deepEqual(getInputDrawingBounds(positions, routes), {
    minX: 40,
    minY: 80,
    maxX: 500,
    maxY: 400
  });
});

test('deep component regions expand the allowed zoom range', () => {
  const componentPoses = new Map([
    ['root', { regionPoints: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }] }],
    ['deep', { regionPoints: [{ x: 498, y: 498 }, { x: 502, y: 498 }, { x: 500, y: 502 }] }]
  ]);
  const ratio = getAdaptiveInputMaxZoomRatio(
    componentPoses,
    { x: 0, y: 0, width: 1000, height: 1000 },
    0.9
  );

  assert.ok(ratio > 250);
  assert.ok(ratio <= 32768);
});

test('visual sizes are normalized to fit zoom and bounded at deep zoom', () => {
  const reference = 0.25;
  const base = 10;

  const atFit = getInputZoomAdjustedLength(base, reference, reference);
  assert.equal(atFit * reference, base);

  const atFourTimes = getInputZoomAdjustedLength(base, reference * 4, reference);
  assert.equal(atFourTimes * reference * 4, base * 2);

  const atDeepZoom = getInputZoomAdjustedLength(base, reference * 1000, reference);
  assert.ok(Math.abs(atDeepZoom * reference * 1000 - base * Math.sqrt(10)) < 1e-9);
});
