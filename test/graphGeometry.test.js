import test from 'node:test';
import assert from 'node:assert/strict';

import { updateStraightLinkSelections } from '../js/graphGeometry.js';

class FakeSelection {
  constructor(data) {
    this.data = data;
    this.values = new Map();
  }

  attr(name, value) {
    this.values.set(name, this.data.map(datum => value(datum)));
    return this;
  }
}

test('simple SPQR drag updates visible links and their hit areas together', () => {
  const links = [{
    source: { id: 'P1', x: 125, y: 240 },
    target: { id: 'R1', x: 480, y: 510 },
  }];
  const hitAreas = new FakeSelection(links);
  const visibleLinks = new FakeSelection(links);

  updateStraightLinkSelections(hitAreas, visibleLinks);

  for (const selection of [hitAreas, visibleLinks]) {
    assert.deepEqual(Object.fromEntries(selection.values), {
      x1: [125],
      y1: [240],
      x2: [480],
      y2: [510],
    });
  }
});
