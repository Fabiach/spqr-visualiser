import test from 'node:test';
import assert from 'node:assert/strict';

import { isPlanarAndEmbed, validateEmbedding } from '../js/planarity.js';
import { extractFaces } from '../js/tutte.js';

function graphFromOrderedEdges(edges) {
  const graph = new Map();
  for (const [u, v] of edges) {
    if (!graph.has(u)) graph.set(u, []);
    if (!graph.has(v)) graph.set(v, []);
    graph.get(u).push(v);
    graph.get(v).push(u);
  }
  return graph;
}

test('planar embedding is independent of adjacency insertion order', () => {
  const edges = [
    [0, 1], [1, 2], [0, 2],
    [0, 3], [1, 3], [2, 3],
    [0, 4], [1, 4], [3, 4],
    [0, 5], [3, 5], [4, 5]
  ];

  for (let shift = 0; shift < edges.length; shift++) {
    const ordered = edges.map((_, index) => {
      const edge = edges[(index + shift) % edges.length];
      return index % 2 === 0 ? edge : [edge[1], edge[0]];
    });
    const graph = graphFromOrderedEdges(ordered);
    const { planar, embedding } = isPlanarAndEmbed(graph);
    assert.equal(planar, true, `edge-order shift ${shift}`);
    assert.equal(validateEmbedding(graph, embedding).valid, true);
    assert.equal(extractFaces(embedding).length, edges.length - graph.size + 2);
  }
});

test('canonicalisation does not turn K3,3 into a planar graph', () => {
  const edges = [];
  for (const u of [0, 1, 2]) {
    for (const v of [3, 4, 5]) edges.push([u, v]);
  }
  assert.equal(isPlanarAndEmbed(graphFromOrderedEdges(edges)).planar, false);
});
