/**
 * Export an SPQR tree in a JSON form that mirrors OGDF's SPQRTree / Skeleton API.
 *
 * OGDF's SPQRTree is an in-memory C++ structure with no on-disk format of its
 * own; its file I/O works on plain Graphs. This serializer therefore writes down
 * exactly the information OGDF's object exposes, so the JSON is a 1:1 textual
 * mirror of what you would read back through OGDF's methods:
 *
 *   originalGraph()  -> "originalGraph"          (the graph G)
 *   rootNode()       -> "root"                   (id of the root tree node)
 *   typeOf(v)        -> node.type                (SNode / PNode / RNode)
 *   skeleton(v)      -> node.skeleton
 *     original(node) -> skeleton.vertices        (skeleton vertices ARE G-vertices here)
 *     realEdge(e)    -> skeleton.realEdges       (edges backed by an edge of G)
 *     isVirtual(e)   -> skeleton.virtualEdges    (edges backed by a tree-edge)
 *     twinTreeNode(e)-> virtualEdge.twinNode     (the adjacent skeleton's node)
 *
 * Q-nodes are omitted, matching both this codebase and OGDF.
 *
 * The export covers tree structure only (no embedding / flip / child-order
 * state), which is what OGDF's SPQRTree stores by default.
 */

const TYPE_TO_OGDF = { S: 'SNode', P: 'PNode', R: 'RNode' };

/** Undirected edge key so {a,b} and {b,a} collapse to one entry. */
function edgeKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Skeleton vertices: keys of the component's graph, falling back to the
 *  virtual-edge endpoints for the degenerate components whose .graph may be
 *  missing (see spqr.js: 2-vertex bond rebuild). Returned as numbers. */
function skeletonVertices(component) {
  const verts = new Set();
  if (component.graph && typeof component.graph.keys === 'function') {
    for (const v of component.graph.keys()) verts.add(Number(v));
  }
  for (const [[u, w]] of component.virtualEdgeEntry || []) {
    verts.add(Number(u));
    verts.add(Number(w));
  }
  return [...verts];
}

/**
 * Serialize an SPQR tree to an OGDF-shaped plain object.
 *
 * @param {Array}  spqrTree   state.data.spqrTree  (array of SPQRComponent)
 * @param {Object} spqrRoot   state.data.spqrRoot  (root SPQRComponent, may be null)
 * @param {Array}  graphNodes state.data.graphNodes ([{id}, ...])
 * @param {Array}  graphEdges state.data.graphEdges ([[a,b], ...])
 * @returns {Object} OGDF-reconstructable JSON object
 */
export function spqrTreeToOGDFObject(spqrTree, spqrRoot, graphNodes, graphEdges) {
  const originalEdgeKeys = new Set(
    (graphEdges || []).map(([a, b]) => edgeKey(Number(a), Number(b)))
  );
  // Map each virtual-edge id to the component ids that carry it. A twin pair
  // (an id carried by two components) is one tree edge; twinNode names "the
  // other component" — OGDF's twinTreeNode(e).
  const idToComponents = new Map();
  for (const comp of spqrTree) {
    for (const [, virtualId] of comp.virtualEdgeEntry || []) {
      if (!idToComponents.has(virtualId)) idToComponents.set(virtualId, []);
      idToComponents.get(virtualId).push(comp.id);
    }
  }

  const nodes = spqrTree.map(comp => {
    // Every virtualEdgeEntry contributes its endpoint pair to virtualKeys.
    // A P-skeleton is the exception to the usual endpoint-based distinction:
    // it may contain one real pole edge and several virtual edges with exactly
    // the same endpoints.
    const virtualKeys = new Set();
    const virtualEdges = [];
    for (const [[u, w], virtualId] of comp.virtualEdgeEntry || []) {
      const a = Number(u), b = Number(w);
      virtualKeys.add(edgeKey(a, b));
      const carriers = idToComponents.get(virtualId) || [];
      const twinNode = carriers.find(id => id !== comp.id) ?? null;

      virtualEdges.push({ id: virtualId, ends: [a, b], twinNode });
    }

    // Real edges: skeleton adjacencies that are not virtual, except for the
    // distinct real pole edge stored by a P-component at the same endpoints as
    // its virtual edges.
    const realEdges = [];
    const seen = new Set();
    if (comp.graph && typeof comp.graph.entries === 'function') {
      for (const [v, neighbors] of comp.graph.entries()) {
        for (const n of neighbors || []) {
          const a = Number(v), b = Number(n);
          const key = edgeKey(a, b);
          const isRealPoleEdge = comp.type === 'P' && originalEdgeKeys.has(key);
          if (seen.has(key) || (virtualKeys.has(key) && !isRealPoleEdge)) continue;
          seen.add(key);
          realEdges.push([a, b]);
        }
      }
    }

    return {
      id: comp.id,
      type: TYPE_TO_OGDF[comp.type] || comp.type,
      skeleton: {
        vertices: skeletonVertices(comp),
        realEdges,
        virtualEdges,
      },
    };
  });

  const asNumberIfPossible = id => {
    const n = Number(id);
    return Number.isNaN(n) ? id : n;
  };

  return {
    format: 'ogdf-spqr-tree',
    version: 1,
    originalGraph: {
      nodes: (graphNodes || []).map(n => asNumberIfPossible(n.id)),
      edges: (graphEdges || []).map(([a, b]) => [Number(a), Number(b)]),
    },
    root: spqrRoot ? spqrRoot.id : null,
    nodes,
  };
}

/** Convenience: the object as a pretty-printed JSON string. */
export function spqrTreeToOGDFJSON(spqrTree, spqrRoot, graphNodes, graphEdges) {
  return JSON.stringify(
    spqrTreeToOGDFObject(spqrTree, spqrRoot, graphNodes, graphEdges),
    null,
    2
  );
}
