import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPQRComponent,
  generateEdgesMap,
  mergeSplitComponents,
  spqr_tree,
} from '../js/spqr.js';
import { spqrTreeToOGDFObject } from '../js/exportSPQR.js';

const screenshotGraphEdges = [
  [1, 2], [2, 3], [2, 4], [2, 5], [3, 4], [4, 5], [4, 6], [5, 6],
  [6, 7], [3, 7], [7, 8], [7, 9], [8, 10], [9, 10],
  [1, 11], [1, 12], [11, 12], [11, 13], [12, 13],
  [13, 14], [13, 15], [14, 15], [14, 16], [15, 16],
  [1, 17], [17, 18], [17, 19], [17, 20], [19, 20],
  [1, 21], [21, 22], [21, 23], [22, 23],
  [10, 24], [14, 24], [16, 24], [17, 24], [18, 24], [19, 24], [20, 24],
  [23, 24], [1, 24], [1, 26], [25, 26], [13, 26], [25, 13], [26, 24], [1, 25],
];

function vertexKey(component) {
  return [...component.graph.keys()].map(Number).sort((a, b) => a - b).join(',');
}

function edgeKey(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join('|');
}

function assignComponentIds(tree) {
  const counters = { S: 0, P: 0, R: 0 };
  for (const component of tree) {
    component.id = `${component.type}${++counters[component.type]}`;
  }
}

function virtualEdgeCarriers(tree) {
  const carriers = new Map();
  for (const component of tree) {
    for (const [ends, id] of component.virtualEdgeEntry) {
      if (!carriers.has(id)) carriers.set(id, []);
      carriers.get(id).push({ component, ends });
    }
  }
  return carriers;
}

function isConnectedAfterRemoving(graph, removed) {
  const remaining = [...graph.keys()].filter(vertex => !removed.has(vertex));
  if (remaining.length < 2) return true;
  const visited = new Set([remaining[0]]);
  const queue = [remaining[0]];
  while (queue.length > 0) {
    const vertex = queue.shift();
    for (const neighbor of graph.get(vertex) ?? []) {
      if (!removed.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return remaining.every(vertex => visited.has(vertex));
}

test('normalization merges adjacent S/P nodes but never adjacent R nodes', () => {
  const triangle = edges => generateEdgesMap(edges);
  const rigidA = new SPQRComponent(triangle([[1, 2], [2, 3], [3, 1]]), 'R', [[[1, 2], 1]]);
  const rigidB = new SPQRComponent(triangle([[1, 2], [2, 4], [4, 1]]), 'R', [[[1, 2], 1]]);
  assert.equal(mergeSplitComponents([rigidA, rigidB]).length, 2);

  const seriesA = new SPQRComponent(triangle([[1, 2], [2, 3], [3, 1]]), 'S', [
    [[1, 2], 2], [[2, 3], 3],
  ]);
  const seriesB = new SPQRComponent(triangle([[1, 2], [2, 4], [4, 1]]), 'S', [
    [[1, 2], 2], [[2, 4], 4],
  ]);
  const [merged] = mergeSplitComponents([seriesA, seriesB]);
  assert.deepEqual(merged.virtualEdgeEntry.map(([, id]) => id).sort((a, b) => a - b), [3, 4]);
  assert.equal(merged.graph.get(1).includes(2), false);
  assert.equal(merged.graph.get(2).includes(1), false);
});

test('the screenshot graph produces the independently verified SPQR components', () => {
  const tree = spqr_tree(generateEdgesMap(screenshotGraphEdges));
  const counts = tree.reduce((result, component) => {
    result[component.type] = (result[component.type] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { P: 4, S: 7, R: 5 });

  const rigidVertexSets = tree
    .filter(component => component.type === 'R')
    .map(vertexKey)
    .sort();
  assert.deepEqual(rigidVertexSets, [
    '1,11,12,13',
    '1,13,24,25,26',
    '2,3,4,5,6,7',
    '13,14,15,16,24',
    '17,19,20,24',
  ].sort());

  for (const rigid of tree.filter(component => component.type === 'R')) {
    const vertices = [...rigid.graph.keys()];
    for (let first = 0; first < vertices.length; first++) {
      for (let second = first + 1; second < vertices.length; second++) {
        assert.equal(
          isConnectedAfterRemoving(rigid.graph, new Set([vertices[first], vertices[second]])),
          true,
          `R skeleton ${vertexKey(rigid)} still has separation pair ${vertices[first]}-${vertices[second]}`,
        );
      }
    }
  }

  const carriers = virtualEdgeCarriers(tree);
  for (const [id, entries] of carriers) {
    assert.equal(entries.length, 2, `virtual edge ${id} must have exactly two twins`);
  }

  const rigidByVertices = new Map(
    tree.filter(component => component.type === 'R').map(component => [vertexKey(component), component])
  );
  const middle = rigidByVertices.get('1,13,24,25,26');
  const left = rigidByVertices.get('1,11,12,13');
  const right = rigidByVertices.get('13,14,15,16,24');
  const sharedPair = (first, second) => [...carriers.values()]
    .find(entries => entries.some(entry => entry.component === first)
      && entries.some(entry => entry.component === second))?.[0].ends;
  assert.equal(edgeKey(...sharedPair(middle, left)), '1|13');
  assert.equal(edgeKey(...sharedPair(middle, right)), '13|24');

  for (const entries of carriers.values()) {
    const [first, second] = entries.map(entry => entry.component);
    assert.equal(
      first.type === second.type && (first.type === 'S' || first.type === 'P'),
      false,
      `adjacent ${first.type}-nodes should have been normalized`,
    );
  }
});

test('OGDF-shaped export keeps real P pole edges and every virtual twin', () => {
  const tree = spqr_tree(generateEdgesMap(screenshotGraphEdges));
  assignComponentIds(tree);
  const graphNodes = Array.from({ length: 26 }, (_, index) => ({ id: index + 1 }));
  const exported = spqrTreeToOGDFObject(tree, tree[0], graphNodes, screenshotGraphEdges);

  const exportedRealEdges = exported.nodes.flatMap(node => node.skeleton.realEdges.map(edge => edgeKey(...edge)));
  const originalEdges = screenshotGraphEdges.map(edge => edgeKey(...edge));
  assert.equal(exportedRealEdges.length, originalEdges.length);
  assert.deepEqual([...exportedRealEdges].sort(), [...originalEdges].sort());

  const virtualById = new Map();
  for (const node of exported.nodes) {
    for (const edge of node.skeleton.virtualEdges) {
      assert.notEqual(edge.twinNode, null);
      if (!virtualById.has(edge.id)) virtualById.set(edge.id, []);
      virtualById.get(edge.id).push(node.id);
    }
  }
  for (const [id, nodes] of virtualById) {
    assert.equal(nodes.length, 2, `exported virtual edge ${id} must occur in both skeletons`);
  }

  const pSkeletonSizes = new Map(
    exported.nodes
      .filter(node => node.type === 'PNode')
      .map(node => [
        node.skeleton.vertices.slice().sort((a, b) => a - b).join(','),
        node.skeleton.realEdges.length + node.skeleton.virtualEdges.length,
      ])
  );
  assert.deepEqual(pSkeletonSizes, new Map([
    ['1,24', 5],
    ['17,24', 4],
    ['21,23', 3],
    ['7,10', 3],
  ]));
});
