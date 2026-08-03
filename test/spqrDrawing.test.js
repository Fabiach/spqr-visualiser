import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGraphDrawing,
  createPBandOpening,
  findComponentStraightLineCrossings,
  findRoutedDrawingPlanarityViolations,
  P_AXIS_SLOT,
  openPBandDrawingAtPoles
} from '../js/spqrDrawing.js';
import { generateEdgesMap, spqr_tree } from '../js/spqr.js';
import { edgesBrown, edgesDB, edgesTutorialPAndR } from '../js/data.js';

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
    if (components.length !== 2) continue;
    const [a, b] = components;
    tree.find(component => component.id === a).neighbors.push({ id: b });
    tree.find(component => component.id === b).neighbors.push({ id: a });
  }
  return { tree, virtualEdgeData };
}

test('moving a P child across the edge divider opens the other side of a one-sided allocation', () => {
  const { tree, virtualEdgeData } = buildDrawableTree(edgesDB);
  const root = tree.find(component => component.id === 'S4');
  const pNode = tree.find(component => component.id === 'P1');
  assert.ok(root);
  assert.ok(pNode);

  pNode.embeddingOrder = ['S2', 'S3', P_AXIS_SLOT];
  const before = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);

  pNode.embeddingOrder = ['S2', P_AXIS_SLOT, 'S3'];
  const after = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);

  const maxMovement = Math.max(...[...before.positions].map(([vertexId, point]) => {
    const next = after.positions.get(vertexId);
    return next ? Math.hypot(next.x - point.x, next.y - point.y) : 0;
  }));

  assert.ok(maxMovement > 1);
  assert.deepEqual(after.componentPoses.get(pNode.id).leftChildIds, ['S2']);
  assert.deepEqual(after.componentPoses.get(pNode.id).rightChildIds, ['S3']);
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(after.positions, after.edges, after.edgeRoutes),
    []
  );
});

test('a series face is granted whole only when exactly one child borders it', () => {
  const unique = buildDrawableTree(edgesBrown);
  const sRoot = unique.tree.find(component => component.id === 'S4');
  assert.ok(sRoot);

  const uniqueDrawing = computeGraphDrawing(
    sRoot, unique.tree, unique.virtualEdgeData, 1000, 1000
  );
  const seriesPose = uniqueDrawing.componentPoses.get('S4');
  const parallelPose = uniqueDrawing.componentPoses.get('P2');
  assert.deepEqual(seriesPose.faceAdjacentChildIds, ['P2']);
  assert.deepEqual(seriesPose.exclusiveFaceChildIds, ['P2']);
  assert.equal(seriesPose.exclusiveSeriesFaceGeometry, 'cycle-face');

  // The full S4 cycle boundary, not a narrow edge band, bounds P2's region.
  const pointKey = point => `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
  const cycleBoundary = new Set(
    seriesPose.cycleOrder.map(vertexId => pointKey(uniqueDrawing.positions.get(vertexId)))
  );
  const childBoundary = new Set(parallelPose.regionPoints.map(pointKey));
  assert.deepEqual(childBoundary, cycleBoundary);
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(
      uniqueDrawing.positions, uniqueDrawing.edges, uniqueDrawing.edgeRoutes
    ),
    []
  );

  const shared = buildDrawableTree(edgesDB);
  const sharedRoot = shared.tree.find(component => component.id === 'S5');
  assert.ok(sharedRoot);
  const sharedDrawing = computeGraphDrawing(
    sharedRoot, shared.tree, shared.virtualEdgeData, 1000, 1000
  );
  const sharedPose = sharedDrawing.componentPoses.get('S5');
  assert.deepEqual(new Set(sharedPose.faceAdjacentChildIds), new Set(['P2', 'R2']));
  assert.deepEqual(sharedPose.exclusiveFaceChildIds, []);
  assert.equal(sharedPose.exclusiveSeriesFaceGeometry, null);
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(
      sharedDrawing.positions, sharedDrawing.edges, sharedDrawing.edgeRoutes
    ),
    []
  );
});

test('an R child of S flips across its parent twin edge into the opposite guaranteed side', () => {
  const { tree, virtualEdgeData } = buildDrawableTree(edgesBrown);
  const root = tree.find(component => component.id === 'S4');
  const rigid = tree.find(component => component.id === 'R1');
  assert.ok(root);
  assert.ok(rigid);

  rigid.embeddingFlip = false;
  const before = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);
  rigid.embeddingFlip = true;
  const after = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);

  const beforePose = before.componentPoses.get('R1');
  const afterPose = after.componentPoses.get('R1');
  assert.deepEqual(beforePose.parentEdgeNodes, [7, 3]);
  assert.deepEqual(afterPose.parentEdgeNodes, [7, 3]);
  assert.equal(beforePose.seriesParentSideSign, -afterPose.seriesParentSideSign);
  assert.deepEqual(beforePose.outerFace, [3, 8, 7]);
  assert.deepEqual(afterPose.outerFace, [3, 7, 8]);

  const pointOnSegment = (point, a, b, tolerance = 1e-6) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const lengthSquared = ab.x * ab.x + ab.y * ab.y;
    const t = lengthSquared < 1e-12 ? 0 : Math.max(0, Math.min(1,
      ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSquared
    ));
    return Math.hypot(point.x - (a.x + t * ab.x), point.y - (a.y + t * ab.y)) <= tolerance;
  };
  const pointInOrOnPolygon = (point, polygon) => {
    if (polygon.some((a, index) => pointOnSegment(point, a, polygon[(index + 1) % polygon.length]))) {
      return true;
    }
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if (((a.y > point.y) !== (b.y > point.y))
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };

  for (const drawing of [before, after]) {
    const rigidPose = drawing.componentPoses.get('R1');
    const seriesPose = drawing.componentPoses.get('S2');
    const [u, v] = rigidPose.parentEdgeNodes;
    const axisA = drawing.positions.get(u);
    const axisB = drawing.positions.get(v);

    assert.deepEqual(rigidPose.seriesParentAxis, { from: axisA, to: axisB });
    assert.ok(rigidPose.regionPoints.some(point => Math.hypot(point.x - axisA.x, point.y - axisA.y) < 1e-6));
    assert.ok(rigidPose.regionPoints.some(point => Math.hypot(point.x - axisB.x, point.y - axisB.y) < 1e-6));
    assert.ok(rigidPose.regionPoints.every(point => pointInOrOnPolygon(point, seriesPose.regionPoints)));

    // R1's region is local to the S2 edge 7–3, not the P2 pole edge 4–3.
    assert.equal(pointInOrOnPolygon(drawing.positions.get(4), rigidPose.regionPoints), false);

    const axis = { x: axisB.x - axisA.x, y: axisB.y - axisA.y };
    for (const vertexId of [6, 8, 9]) {
      const point = drawing.positions.get(vertexId);
      const side = axis.x * (point.y - axisA.y) - axis.y * (point.x - axisA.x);
      assert.equal(Math.sign(side), rigidPose.seriesParentSideSign);
    }
    assert.deepEqual(
      findRoutedDrawingPlanarityViolations(drawing.positions, drawing.edges, drawing.edgeRoutes),
      []
    );
  }
});

test('flipping an R child reflects its P slot across the u-v axis', () => {
  const { tree, virtualEdgeData } = buildDrawableTree(edgesTutorialPAndR);
  const pNode = tree.find(component => component.id === 'P1');
  const rChild = tree.find(component => component.id === 'R1');
  assert.ok(pNode);
  assert.ok(rChild);

  pNode.embeddingOrder = ['R1', P_AXIS_SLOT, 'S1'];
  rChild.embeddingFlip = false;
  const before = computeGraphDrawing(pNode, tree, virtualEdgeData, 1000, 1000);
  const beforePose = before.componentPoses.get(pNode.id);

  rChild.embeddingFlip = true;
  const after = computeGraphDrawing(pNode, tree, virtualEdgeData, 1000, 1000);
  const afterPose = after.componentPoses.get(pNode.id);

  assert.deepEqual(beforePose.leftChildIds, ['R1']);
  assert.deepEqual(beforePose.rightChildIds, ['S1']);
  assert.deepEqual(afterPose.leftChildIds, []);
  assert.deepEqual(afterPose.rightChildIds, ['R1', 'S1']);

  const nonPoleVertices = [...rChild.graph.keys()]
    .filter(vertexId => !beforePose.poleNodes.includes(vertexId));
  const meanSignedDistance = (drawing, pose) => {
    const axisDx = pose.axis.to.x - pose.axis.from.x;
    const axisDy = pose.axis.to.y - pose.axis.from.y;
    const values = nonPoleVertices.map(vertexId => {
      const point = drawing.positions.get(vertexId);
      return axisDx * (point.y - pose.axis.from.y)
        - axisDy * (point.x - pose.axis.from.x);
    });
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  assert.ok(meanSignedDistance(before, beforePose) * meanSignedDistance(after, afterPose) < 0);
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(after.positions, after.edges, after.edgeRoutes),
    []
  );
});

test('the P axis slot selects the base side and an R flip overrides it', () => {
  const cases = [
    { order: ['R1', P_AXIS_SLOT], flip: false, left: ['R1'], right: [] },
    { order: ['R1', P_AXIS_SLOT], flip: true, left: [], right: ['R1'] },
    { order: [P_AXIS_SLOT, 'R1'], flip: false, left: [], right: ['R1'] },
    { order: [P_AXIS_SLOT, 'R1'], flip: true, left: ['R1'], right: [] },
  ];

  for (const expected of cases) {
    const { tree, virtualEdgeData } = buildDrawableTree(edgesTutorialPAndR);
    const root = tree.find(component => component.id === 'S1');
    const pNode = tree.find(component => component.id === 'P1');
    const rChild = tree.find(component => component.id === 'R1');
    assert.ok(root);
    assert.ok(pNode);
    assert.ok(rChild);

    pNode.embeddingOrder = expected.order;
    rChild.embeddingFlip = expected.flip;
    const drawing = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);
    const pose = drawing.componentPoses.get(pNode.id);

    assert.deepEqual(pose.leftChildIds, expected.left);
    assert.deepEqual(pose.rightChildIds, expected.right);
    assert.deepEqual(
      findRoutedDrawingPlanarityViolations(drawing.positions, drawing.edges, drawing.edgeRoutes),
      []
    );
  }
});

test('a DiBattista R flip mirrors its complete expansion without swapping S2 and S3', () => {
  const { tree, virtualEdgeData } = buildDrawableTree(edgesDB);
  const root = tree.find(component => component.id === 'P2');
  const rNode = tree.find(component => component.id === 'R1');
  const pChild = tree.find(component => component.id === 'P1');
  assert.ok(root);
  assert.ok(rNode);
  assert.ok(pChild);

  pChild.embeddingOrder = ['S3', P_AXIS_SLOT, 'S2'];
  rNode.embeddingFlip = false;
  const before = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);

  rNode.embeddingFlip = true;
  const after = computeGraphDrawing(root, tree, virtualEdgeData, 1000, 1000);
  const rootPose = before.componentPoses.get(root.id);
  const axisA = rootPose.axis.from;
  const axisB = rootPose.axis.to;
  const axis = { x: axisB.x - axisA.x, y: axisB.y - axisA.y };
  const axisLengthSquared = axis.x * axis.x + axis.y * axis.y;
  const reflectAcrossRootAxis = point => {
    const offset = { x: point.x - axisA.x, y: point.y - axisA.y };
    const t = (offset.x * axis.x + offset.y * axis.y) / axisLengthSquared;
    const foot = { x: axisA.x + t * axis.x, y: axisA.y + t * axis.y };
    return { x: 2 * foot.x - point.x, y: 2 * foot.y - point.y };
  };

  const mirroredComponentIds = new Set(['R1', 'P1', 'S2', 'S3', 'S4']);
  const mirroredVertices = new Set(
    tree
      .filter(component => mirroredComponentIds.has(component.id))
      .flatMap(component => [...component.graph.keys()])
  );

  for (const vertexId of mirroredVertices) {
    const expected = reflectAcrossRootAxis(before.positions.get(vertexId));
    const actual = after.positions.get(vertexId);
    assert.ok(
      Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-6,
      `vertex ${vertexId} was not carried to its mirrored position`
    );
  }

  // The dialog order remains the user's canonical choice, while the effective
  // order reverses inside the mirrored R expansion.
  assert.deepEqual(pChild.embeddingOrder, ['S3', P_AXIS_SLOT, 'S2']);
  assert.deepEqual(
    after.componentPoses.get(pChild.id).visualOrder,
    ['S2', P_AXIS_SLOT, 'S3']
  );
  assert.ok(after.positions.get(14).x < after.positions.get(13).x);
  assert.deepEqual(
    findRoutedDrawingPlanarityViolations(after.positions, after.edges, after.edgeRoutes),
    []
  );
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
