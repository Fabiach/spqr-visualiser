import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGraphDrawing,
  createPBandOpening,
  findComponentStraightLineCrossings,
  findRoutedDrawingPlanarityViolations,
  openPBandDrawingAtPoles
} from '../js/spqrDrawing.js';
import { generateEdgesMap, spqr_tree } from '../js/spqr.js';

function graphFromEdges(edges) {
  const graph = new Map();
  for (const [u, v] of edges) {
    if (!graph.has(u)) graph.set(u, []);
    if (!graph.has(v)) graph.set(v, []);
    graph.get(u).push(v);
    graph.get(v).push(u);
  }
  return graph;
}

function routeKey(u, v) {
  return u < v ? `${u}-${v}` : `${v}-${u}`;
}

function buildDrawableTree(edges) {
  const tree = spqr_tree(generateEdgesMap(edges));
  const typeCounts = new Map();
  for (const component of tree) {
    const count = (typeCounts.get(component.type) || 0) + 1;
    typeCounts.set(component.type, count);
    component.id = `${component.type}${count}`;
    component.neighbors = [];
  }

  const virtualEdgeData = new Map();
  for (const component of tree) {
    for (const [nodes, edgeId] of component.virtualEdgeEntry) {
      if (!virtualEdgeData.has(edgeId)) {
        virtualEdgeData.set(edgeId, { components: [], nodes });
      }
      virtualEdgeData.get(edgeId).components.push(component.id);
    }
  }
  for (const { components } of virtualEdgeData.values()) {
    const [a, b] = components;
    tree.find(component => component.id === a).neighbors.push({ id: b });
    tree.find(component => component.id === b).neighbors.push({ id: a });
  }
  return { tree, virtualEdgeData };
}

test('root pole direction survives reversed twin-edge endpoint order', () => {
  const edges = [
    [1, 5], [1, 2], [2, 3], [2, 4],
    [2, 5], [3, 4], [3, 5], [4, 5]
  ];
  const { tree, virtualEdgeData } = buildDrawableTree(edges);
  const root = tree.find(component => component.type === 'P');
  const drawing = computeGraphDrawing(
    root,
    tree,
    virtualEdgeData,
    1000,
    1000,
    { rootPoleOrder: [2, 5] }
  );

  assert.ok(drawing.positions.get(2).y < drawing.positions.get(5).y);
  assert.deepEqual(drawing.componentPoses.get(root.id).poleNodes, [2, 5]);
});

test('localized pole opening preserves Tutte vertices and bends only violated pole edges', () => {
  const skeletonEdges = [
    [0, 1], [1, 2], [0, 2],
    [0, 3], [1, 3], [2, 3],
    [0, 4], [1, 4], [3, 4],
    [0, 5], [3, 5], [4, 5]
  ];
  const realEdges = skeletonEdges
    .filter(([u, v]) => !(u === 0 && v === 1))
    .map(([source, target]) => ({ source, target, ownerCompId: 'R-counterexample' }));

  const sourcePositions = new Map([
    [0, { x: -1, y: 0 }],
    [1, { x: 1, y: 0 }],
    [2, { x: 0, y: 2 }],
    [3, { x: -5 / 46, y: 11 / 23 }],
    [4, { x: -3 / 23, y: 4 / 23 }],
    [5, { x: -19 / 46, y: 5 / 23 }]
  ]);

  const actualU = { x: -2, y: -2 };
  const actualV = { x: 2, y: -2 };
  const outerTip = { x: 0, y: 2 };
  const innerTip = { x: 0, y: 0 };
  const opening = createPBandOpening(actualU, actualV, {
    type: 'polygon',
    points: [actualU, outerTip, actualV, innerTip],
    fanOuterTip: outerTip,
    fanInnerTip: innerTip
  });
  assert.ok(opening);

  // The old construction moved only the poles and created a crossing.
  const snappedPositions = new Map(sourcePositions);
  snappedPositions.set(0, actualU);
  snappedPositions.set(1, actualV);
  const snapCrossings = findComponentStraightLineCrossings(
    graphFromEdges(skeletonEdges),
    snappedPositions,
    new Set(['0,1'])
  );
  assert.ok(snapCrossings.length > 0);
  const directViolations = findRoutedDrawingPlanarityViolations(
    snappedPositions,
    realEdges,
    new Map()
  );
  const directlyViolatedEdgeKeys = new Set();
  for (const violation of directViolations) {
    const involved = violation.edges ?? (violation.edge ? [violation.edge] : []);
    for (const edge of involved) {
      directlyViolatedEdgeKeys.add(routeKey(edge.source, edge.target));
    }
  }

  // The localized construction moves only the poles. All remaining Tutte
  // vertices keep their original positions, and only pole edges are routed.
  const openedPositions = new Map(
    [...sourcePositions].map(([id, point]) => [id, { ...point }])
  );
  const routes = new Map();
  openPBandDrawingAtPoles({
    opening,
    poleIds: [0, 1],
    positions: openedPositions,
    edges: realEdges,
    edgeRoutes: routes
  });

  assert.deepEqual(openedPositions.get(0), actualU);
  assert.deepEqual(openedPositions.get(1), actualV);
  for (const vertexId of [2, 3, 4, 5]) {
    assert.deepEqual(openedPositions.get(vertexId), sourcePositions.get(vertexId));
  }
  assert.ok(routes.size > 0);
  const incidentEdgeCount = realEdges.filter(edge =>
    edge.source === 0 || edge.target === 0 || edge.source === 1 || edge.target === 1
  ).length;
  assert.ok(routes.size < incidentEdgeCount);
  for (const key of routes.keys()) {
    assert.equal(directlyViolatedEdgeKeys.has(key), true);
  }
  for (const edge of realEdges) {
    if (edge.source !== 0 && edge.target !== 0 && edge.source !== 1 && edge.target !== 1) {
      assert.equal(routes.has(routeKey(edge.source, edge.target)), false);
    }
  }
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(openedPositions, realEdges, routes),
    []
  );
});

test('final routed-drawing validator detects crossings and edges through vertices', () => {
  const positions = new Map([
    [0, { x: 0, y: 0 }],
    [1, { x: 0, y: 2 }],
    [2, { x: 2, y: 2 }],
    [3, { x: 2, y: 0 }],
    [4, { x: 1, y: 1 }]
  ]);
  const edges = [
    { source: 0, target: 2, ownerCompId: 'A' },
    { source: 1, target: 3, ownerCompId: 'B' }
  ];

  const violations = findRoutedDrawingPlanarityViolations(
    positions,
    edges,
    new Map()
  );
  assert.ok(violations.some(v => v.type === 'edge-crossing'));
  assert.ok(violations.some(v => v.type === 'edge-through-vertex' && v.vertexId === 4));
});
