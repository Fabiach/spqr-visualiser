import test from 'node:test';
import assert from 'node:assert/strict';

import {
  orientNodeMapByAnchor,
  orientRootNodeMap,
  signedSideOfEdge
} from '../js/pictogramOrientation.js';

function angleOf(positions, u, v) {
  const a = positions.get(u);
  const b = positions.get(v);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

test('root orientation follows the labelled cycle rather than a fixed top edge', () => {
  const pictogram = new Map([
    [0, { x: 0, y: -1 }],
    [1, { x: 1, y: 0 }],
    [2, { x: 0, y: 1 }],
    [3, { x: -1, y: 0 }]
  ]);
  const drawing = new Map([
    [0, { x: 1, y: 0 }],
    [1, { x: 0, y: 1 }],
    [2, { x: -1, y: 0 }],
    [3, { x: 0, y: -1 }]
  ]);

  const result = orientRootNodeMap(pictogram, drawing);

  assert.equal(result.matched, true);
  assert.equal(result.reflected, false);
  assert.ok(
    Math.abs(angleDifference(angleOf(pictogram, 0, 1), angleOf(drawing, 0, 1))) < 1e-9
  );
});

test('anchored orientation aligns the directed twin edge and the unfolding side', () => {
  const pictogram = new Map([
    [0, { x: -1, y: 0 }],
    [1, { x: 1, y: 0 }],
    [2, { x: 0, y: 1 }]
  ]);
  const drawing = new Map([
    [0, { x: 0, y: -5 }],
    [1, { x: 0, y: 5 }],
    [2, { x: 6, y: 0 }]
  ]);

  const result = orientNodeMapByAnchor(pictogram, drawing, [0, 1]);

  assert.equal(result.matched, true);
  assert.equal(result.reflected, true);
  assert.ok(
    Math.abs(angleDifference(angleOf(pictogram, 0, 1), angleOf(drawing, 0, 1))) < 1e-9
  );
  assert.ok(Math.abs((pictogram.get(0).x + pictogram.get(1).x) / 2) < 1e-9);
  assert.ok(Math.abs((pictogram.get(0).y + pictogram.get(1).y) / 2) < 1e-9);
  assert.equal(
    Math.sign(signedSideOfEdge(pictogram, [0, 1, 2], [0, 1])),
    Math.sign(signedSideOfEdge(drawing, [0, 1, 2], [0, 1]))
  );
});
