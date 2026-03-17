/**
 * spqrDrawing.js — Compute a drawing/embedding of the original graph
 *                  from its SPQR tree, by composing local per-component
 *                  drawings bottom-up.
 *
 * Algorithm outline
 * -----------------
 *   1. Root the SPQR tree (already done externally).
 *   2. Bottom-up (post-order), draw each component locally in a
 *      **canonical coordinate system** where the parent virtual edge
 *      endpoints sit at (0, 0) → (1, 0).
 *   3. For every virtual edge leading to a child, apply an affine
 *      transform (scale + rotate + translate) to map the child's
 *      canonical drawing into the parent's coordinate space.
 *   4. At the root, scale the final positions to fit the canvas.
 *
 * Component-type strategies
 * -------------------------
 *   R (rigid / triconnected):
 *       Tutte barycentric embedding (regular polygon outer face).
 *
 *   S (series / cycle):
 *       Uniform regular polygon (unit circle) layout.
 *
 *   P (parallel / multi-edge):
 *       Two poles placed at canonical positions; children in
 *       non-overlapping cone-safe squares between poles.
 *
 * Exports
 * -------
 *   computeGraphDrawing(spqrRoot, spqrTree, virtualEdgeData,
 *                       canvasW, canvasH)
 *       → { positions: Map<vertexId, {x,y}>,
 *           edges: Array<{source, target}>,
 *           tree: Object }
 *
 *   flipRNode(treeNode)              — mirror an R component
 *   permutePChildren(treeNode, perm) — reorder P-node children
 */

import { isPlanarAndEmbed } from './planarity.js';
import { extractFaces, findLargestFace } from './tutte.js';

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Enable detailed console debugging. */
const DEBUG = true;
export const P_REAL_EDGE_SLOT = '__p_real_edge__';

// ── Debug log buffer (collects output, then downloads as file) ──
let _debugLog = [];
let _debugIndent = 0;

function dbg(...args) {
  if (!DEBUG) return;
  const line = '  '.repeat(_debugIndent) + args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  _debugLog.push(line);
}
function dbgGroup(...args) {
  dbg(...args);
  _debugIndent++;
}
function dbgGroupEnd() {
  if (_debugIndent > 0) _debugIndent--;
}
function dbgWarn(...args) {
  dbg('⚠️', ...args);
}
function downloadDebugLog() {
  const text = _debugLog.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spqr_debug.log';
  a.click();
  URL.revokeObjectURL(url);
}
function resetDebugLog() {
  _debugLog = [];
  _debugIndent = 0;
}

/** Collected allocated regions for visualization (reset each drawing). */
let _allocatedRegions = [];
let _edgeRoutes = new Map();

// ═══════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Main entry point.  Given a rooted SPQR tree, compute positions for
 * every *real* vertex of the original graph.
 *
 * @param {Object}   spqrRoot       – root component (with .id, .type, .graph, …)
 * @param {Array}    spqrTree       – flat list of all components
 * @param {Map}      virtualEdgeData – from buildVirtualEdgeData()
 * @param {number}   canvasW
 * @param {number}   canvasH
 * @returns {{ positions: Map<number,{x:number,y:number}>,
 *             edges: Array<{source:number, target:number}>,
 *             tree: Object }}
 */
export function computeGraphDrawing(
  spqrRoot, spqrTree, virtualEdgeData, canvasW = 1000, canvasH = 1000
) {
  resetDebugLog();
  _allocatedRegions = [];
  _edgeRoutes = new Map();

  // Build tree
  const tree = buildParentChildTree(spqrRoot, spqrTree, virtualEdgeData);

  // Log the tree for debugging
  logTree(tree.root, 0);

  // Top-down composition: root gets canvas-scale allocation.
  // P-root: poles at top-center and bottom-center, children fan horizontally.
  // S/R-root: local drawing scaled to fill canvas (handled inside composeTopDown);
  //           targetU/targetV are ignored for root S/R nodes.
  const rootType = tree.root.comp.type;
  let rootTargetU, rootTargetV;
  if (rootType === 'P') {
    // Place poles at canvas vertical extremes; final scaling normalizes.
    rootTargetU = { x: canvasW / 2, y: 0 };
    rootTargetV = { x: canvasW / 2, y: canvasH };
  } else {
    // Root S/R scaling is handled inside composeTopDown;
    // these values are overridden by the root-specific scaling path.
    rootTargetU = { x: 0, y: canvasH / 2 };
    rootTargetV = { x: canvasW, y: canvasH / 2 };
  }
  composeTopDown(
    tree.root, rootTargetU, rootTargetV,
    virtualEdgeData, spqrTree, false, canvasW, canvasH
  );

  // Collect
  const positions = tree.root._composedPositions;
  const edges = collectRealEdges(spqrTree);

  if (DEBUG) {
    // Validate: count unique real vertices across all components
    const allRealVertices = new Set();
    for (const comp of spqrTree) {
      for (const v of comp.graph.keys()) {
        allRealVertices.add(Number(v));
      }
    }
    dbgGroup('✅ VALIDATION');
    dbg(`Expected unique vertices: ${allRealVertices.size}, got: ${positions.size}`);
    dbg(`Expected vertices: [${[...allRealVertices].sort((a,b)=>a-b).join(', ')}]`);
    dbg(`Got vertices: [${[...positions.keys()].sort((a,b)=>a-b).join(', ')}]`);
    // Check for missing vertices
    const missing = [...allRealVertices].filter(v => !positions.has(v));
    if (missing.length > 0) dbgWarn(`Missing vertices: [${missing.join(', ')}]`);
    // Check for duplicate positions (exact same coordinate)
    const posStrMap = new Map();
    for (const [v, p] of positions) {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      if (posStrMap.has(key)) {
        dbgWarn(`Vertices ${posStrMap.get(key)} and ${v} have SAME position: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
      }
      posStrMap.set(key, v);
    }
    dbgGroupEnd();
  }

  // Scale
  const scaled = scalePositionsToCanvas(positions, canvasW, canvasH, 40);

  // Scale allocated regions with the same transform
  const scaledRegions = scaleRegions(_allocatedRegions, positions, canvasW, canvasH, 40);
  const scaledEdgeRoutes = scaleEdgeRoutes(_edgeRoutes, positions, canvasW, canvasH, 40);

  // ── Crossing detection post-pass ─────────────────────────────
  if (DEBUG) {
    const crossings = detectCrossings(scaled, edges);
    dbgGroup('🔍 CROSSING DETECTION');
    if (crossings.length === 0) {
      dbg('✅ No edge crossings detected — drawing is planar!');
    } else {
      dbgWarn(`❌ ${crossings.length} edge crossing(s) detected:`);
      for (const { e1, e2, edge1, edge2 } of crossings) {
        dbg(`  (${edge1.source}-${edge1.target}) × (${edge2.source}-${edge2.target})`);
      }
    }
    dbgGroupEnd();
  }

  if (DEBUG) {
    dbgGroup('📊 FINAL RESULT');
    dbg(`Vertices: ${scaled.size}`);
    for (const [v, p] of scaled) dbg(`  ${v}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
    dbg(`Real edges: ${edges.length}`);
    edges.forEach(e => dbg(`  ${e.source} — ${e.target}`));
    // Check: are there any NaN or Infinity positions?
    let badCount = 0;
    for (const [v, p] of scaled) {
      if (!isFinite(p.x) || !isFinite(p.y)) {
        dbgWarn(`  ❌ vertex ${v} has bad position: (${p.x}, ${p.y})`);
        badCount++;
      }
    }
    if (badCount === 0) dbg('  ✅ All positions are finite.');
    dbgGroupEnd();
  }

  if (DEBUG) downloadDebugLog();

  return { positions: scaled, edges, tree, regions: scaledRegions, edgeRoutes: scaledEdgeRoutes };
}

// ═══════════════════════════════════════════════════════════════════
//  TREE CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a lightweight parent-child tree from the flat component list.
 * Each tree node wraps a component and stores children + parent refs.
 */
function buildParentChildTree(root, spqrTree, virtualEdgeData) {
  const nodes = new Map();   // comp.id → treeNode

  // Create wrapper nodes
  for (const comp of spqrTree) {
    nodes.set(comp.id, {
      id:        comp.id,
      comp:      comp,
      children:  [],
      parent:    null,
      weight:    1,
      // Will be filled during compose:
      _localPositions:    null,   // Map<vertex, {x,y}> in canonical coords
      _composedPositions: null,   // Map<vertex, {x,y}> after children merged
      _parentVirtualEdge: null,   // [u, v] connecting to parent
      _childVirtualEdges: [],     // [{edge:[u,v], childNode}]
    });
  }

  // BFS from root to assign parent/children
  const visited = new Set();
  const queue = [root.id];
  visited.add(root.id);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentNode = nodes.get(currentId);
    const comp = currentNode.comp;

    for (const neighbor of (comp.neighbors || [])) {
      const nId = neighbor.id;
      if (visited.has(nId)) continue;
      visited.add(nId);

      const childNode = nodes.get(nId);
      childNode.parent = currentNode;
      currentNode.children.push(childNode);

      // Find the virtual edge connecting these two components
      const vEdge = findConnectingVirtualEdge(comp, childNode.comp, virtualEdgeData);
      if (vEdge) {
        currentNode._childVirtualEdges.push({ edge: vEdge, childNode });
        childNode._parentVirtualEdge = vEdge;
      }

      queue.push(nId);
    }
  }

  // Reorder _childVirtualEdges to match either an explicitly selected
  // embedding order or, by default, the SPQR-tree drawing's child order.
  for (const [, treeNode] of nodes) {
    const fallbackChildIds = treeNode.comp.embeddingChildOrder || treeNode.comp.treeChildOrder;
    const order = getPChildOrder(treeNode.comp, fallbackChildIds);
    if (order && order.length > 0 && treeNode._childVirtualEdges.length > 1) {
      const ceMap = new Map();
      for (const ce of treeNode._childVirtualEdges) {
        ceMap.set(ce.childNode.id, ce);
      }
      const reordered = [];
      for (const childId of order) {
        const ce = ceMap.get(childId);
        if (ce) {
          reordered.push(ce);
          ceMap.delete(childId);
        }
      }
      // Append any remaining children not in treeChildOrder
      for (const ce of ceMap.values()) reordered.push(ce);
      treeNode._childVirtualEdges = reordered;
    }
  }

  if (DEBUG) {
    dbgGroup('🌳 buildParentChildTree');
    dbg(`Total components: ${spqrTree.length}, root: ${root.id}`);
    dbg(`Virtual edge data:`);
    for (const [edgeId, data] of virtualEdgeData) {
      dbg(`  edgeId=${edgeId}  nodes=[${data.nodes}]  comps=[${data.components}]`);
    }
    for (const [id, n] of nodes) {
      dbg(`  ${id}: parent=${n.parent?.id ?? 'null'}, parentVE=${n._parentVirtualEdge}, childVEs=[${n._childVirtualEdges.map(ce=>`[${ce.edge}]->${ce.childNode.id}`).join(', ')}]`);
    }
    dbgGroupEnd();
  }

  return { root: nodes.get(root.id), nodes };
}

/**
 * Find the virtual edge (pair of original vertices) that connects
 * two adjacent SPQR components.
 */
function findConnectingVirtualEdge(compA, compB, virtualEdgeData) {
  for (const [edgeId, data] of virtualEdgeData) {
    const comps = data.components;
    if (
      (comps.includes(compA.id) && comps.includes(compB.id))
    ) {
      return [...data.nodes]; // [u, v]
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  LOCAL DRAWING  (per component type)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute local positions for a component's skeleton vertices.
 * Positions are in a "raw" coordinate system (not yet canonical).
 *
 * @returns {Map<number, {x:number, y:number}>}
 */
function drawComponentLocally(node, virtualEdgeData, spqrTree) {
  const comp = node.comp;
  switch (comp.type) {
    case 'R': return drawRLocal(node, virtualEdgeData, spqrTree);
    case 'S': return drawSLocal(node);
    case 'P': return drawPLocal(node, virtualEdgeData);
    default:  return drawRLocal(node, virtualEdgeData, spqrTree);
  }
}

// ─────────────────────────────────────────────────────────────────
//  R-NODE: Tutte embedding (regular polygon outer face)
// ─────────────────────────────────────────────────────────────────

function drawRLocal(node, virtualEdgeData, spqrTree) {
  const comp = node.comp;
  const positions = new Map();
  const shouldFlip = !!comp.embeddingFlip;

  // Build clean adjacency map
  const subgraph = new Map();
  for (const [v, nbrs] of comp.graph) {
    subgraph.set(Number(v), (nbrs || []).filter(w => comp.graph.has(w)).map(Number));
  }

  if (DEBUG) {
    dbgGroup(`🔷 drawRLocal: ${comp.id}`);
    dbg('Skeleton vertices:', [...subgraph.keys()]);
    for (const [v, nbrs] of subgraph) dbg(`  ${v} → [${nbrs.join(', ')}]`);
    dbg('Virtual edges:', comp.virtualEdgeEntry.map(ve => `[${ve[0]}] id=${ve[1]}`));
    dbg('Parent virtual edge:', node._parentVirtualEdge);
  }

  // ── Try Tutte embedding ───────────────────────────────────────
  try {
    const { planar, embedding } = isPlanarAndEmbed(subgraph);
    if (DEBUG) dbg('Planar:', planar);

    if (planar && embedding) {
      const faces = extractFaces(embedding);
      if (DEBUG) {
        dbg(`Faces (${faces.length}):`);
        faces.forEach((f, i) => dbg(`  F${i}: [${f.join(', ')}] len=${f.length}`));
      }

      if (faces.length >= 1) {
        const outerFace = selectOuterFaceForDrawing(
          faces, comp, node._parentVirtualEdge, shouldFlip
        );
        // Store for face-bounded child allocation during composition
        node._faces = faces;
        node._outerFace = outerFace;
        if (DEBUG) dbg('Outer face chosen:', outerFace);

        if (outerFace && outerFace.length >= 3) {
          // Regular polygon outer face for all R-nodes (root and non-root).
          // Tutte's theorem guarantees a planar straight-line drawing when
          // the outer face is a strictly convex polygon — a regular polygon
          // is the canonical choice with no heuristic distortion.
          const outerFacePositions = regularPolygonPositions(outerFace);
          const tuttePos = tutteEmbeddingWithPositions(
            subgraph, outerFace, outerFacePositions
          );

          for (const [v, pos] of tuttePos) {
            positions.set(Number(v), pos);
          }
          if (DEBUG) {
            dbg('Tutte positions:');
            for (const [v, p] of positions) dbg(`  ${v}: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
            dbgGroupEnd();
          }
          return positions;
        }
      }
    }
  } catch (e) {
    dbgWarn(`R-node ${comp.id}: Tutte embedding failed.`, e);
  }

  if (DEBUG) {
    dbgWarn('⚠️ R-node Tutte embedding failed — returning empty positions');
    dbgGroupEnd();
  }
  return positions;
}

/**
 * Choose the best outer face for the Tutte embedding used in
 * the composed drawing.
 *
 * When flip=true, the face on the OTHER side of the parent virtual
 * edge is chosen — i.e. the second face that shares the edge (u,v)
 * as a boundary edge.  This produces a genuinely distinct Tutte
 * drawing (the Whitney flip) rather than a simple y-mirror.
 */
function selectOuterFaceForDrawing(faces, comp, parentVirtualEdge, flip = false) {
  // Faces that have (u,v) or (v,u) as a consecutive boundary edge.
  function facesOnEdge(u, v) {
    const result = [];
    for (const face of faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        if ((a === u && b === v) || (a === v && b === u)) {
          result.push(face);
          break;
        }
      }
    }
    return result;
  }

  // Helper: find the largest face containing both u and v
  function largestFaceWith(u, v) {
    let best = null;
    for (const face of faces) {
      if (face.includes(u) && face.includes(v)) {
        if (!best || face.length > best.length) best = face;
      }
    }
    return best;
  }

  // 1. Prefer face(s) bounded by the parent virtual edge
  if (parentVirtualEdge) {
    const [pu, pv] = parentVirtualEdge.map(Number);
    const edgeFaces = facesOnEdge(pu, pv);
    if (edgeFaces.length >= 2) {
      // Sort largest-first; non-flip gets the largest, flip gets the other.
      edgeFaces.sort((a, b) => b.length - a.length);
      const chosen = flip ? edgeFaces[edgeFaces.length - 1] : edgeFaces[0];
      if (chosen && chosen.length >= 3) return chosen;
    }
    if (edgeFaces.length === 1 && edgeFaces[0].length >= 3) return edgeFaces[0];
    // Fallback: any face containing both endpoints
    const f = largestFaceWith(pu, pv);
    if (f && f.length >= 3) return f;
  }

  // 2. Largest face containing any virtual edge endpoints
  for (const ve of comp.virtualEdgeEntry) {
    const [u, v] = ve[0].map(Number);
    const f = largestFaceWith(u, v);
    if (f && f.length >= 3) return f;
  }

  // 3. Largest face overall
  return findLargestFace(faces);
}

// ─────────────────────────────────────────────────────────────────
//  WEIGHT-PROPORTIONAL OUTER FACE FOR R-NODE TUTTE EMBEDDING
// ─────────────────────────────────────────────────────────────────

/**
 * Regular polygon positions for a face — used for root R-nodes
 * so the Tutte embedding preserves the natural shape.
 */
function regularPolygonPositions(face) {
  const n = face.length;
  const positions = new Map();
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    positions.set(face[i], { x: Math.cos(angle), y: Math.sin(angle) });
  }
  return positions;
}

/**
 * Tutte embedding that uses pre-computed outer face positions
 * (for convex polygon boundary) instead of computing them internally.
 *
 * Re-implements the boundary setup, then delegates the linear solve
 * to the same Gaussian elimination approach as tutteEmbedding.
 */
function tutteEmbeddingWithPositions(graph, outerFace, outerPositions) {
  if (!graph || graph.size === 0) {
    throw new Error("tutteEmbeddingWithPositions: empty graph");
  }

  const positions = new Map();
  const outerSet = new Set(outerFace);

  // 1. Fix outer face at given positions
  for (const v of outerFace) {
    positions.set(v, outerPositions.get(v));
  }

  // 2. Collect interior vertices
  const interior = [];
  for (const v of graph.keys()) {
    if (!outerSet.has(v)) interior.push(v);
  }
  const m = interior.length;
  if (m === 0) return positions;

  // 3. Index map
  const idx = new Map();
  interior.forEach((v, i) => idx.set(v, i));

  // 4. Build Laplacian system  L·x = bx, L·y = by
  const L  = Array.from({ length: m }, () => new Float64Array(m));
  const bx = new Float64Array(m);
  const by = new Float64Array(m);

  for (let i = 0; i < m; i++) {
    const v = interior[i];
    const nbrs = graph.get(v) || [];
    let deg = 0;
    for (const w of nbrs) {
      if (!graph.has(w)) continue;
      deg++;
      if (outerSet.has(w)) {
        const p = positions.get(w);
        bx[i] += p.x;
        by[i] += p.y;
      } else {
        const j = idx.get(w);
        if (j !== undefined) L[i][j] -= 1;
      }
    }
    L[i][i] = deg;
  }

  // 5. Solve via Gaussian elimination
  const xs = gaussSolve(cloneMatrix(L), Float64Array.from(bx));
  const ys = gaussSolve(cloneMatrix(L), Float64Array.from(by));

  // 6. Assemble
  for (let i = 0; i < m; i++) {
    positions.set(interior[i], { x: xs[i], y: ys[i] });
  }
  return positions;
}

// ── Gaussian elimination helpers (self-contained) ───────────────
function cloneMatrix(M) {
  return M.map(row => Float64Array.from(row));
}

function gaussSolve(A, b) {
  const n = b.length;
  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];

    if (Math.abs(A[col][col]) < 1e-12) continue; // singular

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j < n; j++) {
        A[row][j] -= factor * A[col][j];
      }
      b[row] -= factor * b[col];
    }
  }
  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * x[j];
    }
    x[i] = Math.abs(A[i][i]) > 1e-12 ? sum / A[i][i] : 0;
  }
  return x;
}

// ─────────────────────────────────────────────────────────────────
//  S-NODE: Circle layout
// ─────────────────────────────────────────────────────────────────

function drawSLocal(node) {
  const comp = node.comp;
  const positions = new Map();

  // Get cycle order via DFS walk
  const ordered = getCycleOrder(comp);
  const n = ordered.length;
  if (n === 0) return positions;

  if (DEBUG) {
    dbgGroup(`🟢 drawSLocal: ${comp.id}`);
    dbg('Cycle order (raw):', [...ordered]);
    dbg('Graph:', [...comp.graph.entries()].map(([v,n]) => `${v}→[${n}]`));
    dbg('Virtual edges:', comp.virtualEdgeEntry.map(ve => `[${ve[0]}] id=${ve[1]}`));
    dbg('Parent virtual edge:', node._parentVirtualEdge);
  }

  // Find parent virtual edge endpoints in the cycle
  const parentEdge = node._parentVirtualEdge;
  let pivotA = -1, pivotB = -1;

  if (parentEdge) {
    // Rotate ordered so that parentEdge endpoints are at indices 0 and 1
    pivotA = Number(parentEdge[0]);
    pivotB = Number(parentEdge[1]);

    // Find where pivotA is and shift so it's at index 0
    let startIdx = ordered.indexOf(pivotA);
    if (startIdx === -1) startIdx = ordered.indexOf(pivotB);
    if (startIdx > 0) {
      const shifted = [...ordered.slice(startIdx), ...ordered.slice(0, startIdx)];
      ordered.splice(0, ordered.length, ...shifted);
    }

    // Ensure pivotB is at index 1 (might be at last index since it's a cycle)
    if (ordered.length > 1 && Number(ordered[1]) !== pivotB) {
      // Reverse the non-first elements
      const first = ordered[0];
      const rest = ordered.slice(1).reverse();
      ordered.splice(0, ordered.length, first, ...rest);
    }
  }

  // Store cycle order for composition (needed to determine child flip direction)
  node._cycleOrder = [...ordered];

  // ── Uniform angular allocation on a unit circle ───────────────
  // Each vertex gets an equal angular share (2π/n).  This is the
  // unique placement on a circle where all edges subtend equal
  // central angles — no heuristic weighting or distortion.
  // The result is a regular n-gon, which is strictly convex,
  // ensuring the centroid-triangle face decomposition is valid.

  for (let i = 0; i < n; i++) {
    const angle = (n <= 2) ? i * Math.PI : (i / n) * 2 * Math.PI;
    const v = ordered[i];
    positions.set(Number(v), {
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  }

  if (DEBUG) {
    dbg('Cycle order (after reorder):', [...ordered]);
    dbg('S positions:');
    for (const [v, p] of positions) dbg(`  ${v}: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
    dbgGroupEnd();
  }

  return positions;
}

/**
 * Walk the cycle graph to get nodes in cycle order.
 */
function getCycleOrder(comp) {
  const graph = comp.graph;
  if (!graph || graph.size === 0) return [];

  // For an S-component, each vertex has degree exactly 2.
  // Walk the cycle: start at any vertex, always go to the neighbor
  // that isn't the one we came from.
  const order = [];
  const start = graph.keys().next().value;

  let current = start;
  let prev = null;

  while (true) {
    order.push(Number(current));
    const nbrs = (graph.get(current) || []).filter(w => graph.has(w));

    // In a proper cycle, there should be exactly 2 neighbors.
    // Pick the one that isn't prev.
    let next = null;
    for (const w of nbrs) {
      if (w !== prev && Number(w) !== Number(prev)) {
        next = w;
        break;
      }
    }

    if (next === null || (Number(next) === Number(start) && order.length > 1)) {
      break; // completed the cycle
    }
    prev = current;
    current = next;
  }

  if (DEBUG) {
    dbg(`  getCycleOrder for ${comp.id}: [${order.join(', ')}] (${order.length} vertices, graph has ${graph.size})`);
    // Verify: does the cycle close?
    const lastNbrs = (graph.get(order[order.length - 1]) || []).filter(w => graph.has(w)).map(Number);
    const closesBack = lastNbrs.includes(Number(order[0]));
    dbg(`    Cycle closes: ${closesBack} (last=${order[order.length - 1]}, first=${order[0]}, last_nbrs=[${lastNbrs}])`);
    // Verify all vertices included
    if (order.length !== graph.size) {
      dbgWarn(`    ⚠️ getCycleOrder: got ${order.length} vertices but graph has ${graph.size}!`);
    }
  }

  return order;
}

// ─────────────────────────────────────────────────────────────────
//  P-NODE: Lanes (fanned out)
// ─────────────────────────────────────────────────────────────────

function drawPLocal(node, virtualEdgeData) {
  const comp = node.comp;
  const positions = new Map();

  // P-nodes have exactly 2 pole vertices
  const poles = Array.from(comp.graph.keys()).map(Number);
  if (poles.length < 2) return positions;

  const [poleA, poleB] = poles;

  // Place poles at canonical-ish positions (will be normalized later)
  positions.set(poleA, { x: 0, y: 0 });
  positions.set(poleB, { x: 1, y: 0 });

  if (DEBUG) {
    dbgGroup(`🟡 drawPLocal: ${comp.id}`);
    dbg(`Poles: ${poleA}, ${poleB}`);
    dbg('Virtual edges:', comp.virtualEdgeEntry.map(ve => `[${ve[0]}] id=${ve[1]}`));
    dbg('Parent virtual edge:', node._parentVirtualEdge);
    dbg(`Children: ${node._childVirtualEdges.map(ce => `${ce.childNode.id} via [${ce.edge}]`).join(', ')}`);
    dbgGroupEnd();
  }

  return positions;
}

function pComponentHasRealEdge(comp) {
  return !!(
    comp?.type === 'P'
    && comp.graph
    && Array.from(comp.graph.values()).some(neighbors => neighbors && neighbors.length > 0)
  );
}

function getUndirectedEdgeKey(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  return aNum < bNum ? `${aNum}-${bNum}` : `${bNum}-${aNum}`;
}

function getPRealEdge(comp) {
  if (!pComponentHasRealEdge(comp) || !comp?.graph) return null;

  const poles = Array.from(comp.graph.keys()).map(Number);
  if (poles.length < 2) return null;

  const [poleA, poleB] = poles;
  const neighborsA = comp.graph.get(poleA) || [];
  return neighborsA.includes(poleB) ? [poleA, poleB] : null;
}

function buildDefaultPEmbeddingOrder(comp, childIds) {
  const normalizedChildIds = Array.isArray(childIds) ? childIds.filter(id => id != null) : [];
  if (!pComponentHasRealEdge(comp)) return normalizedChildIds;

  const insertAt = Math.ceil(normalizedChildIds.length / 2);
  return [
    ...normalizedChildIds.slice(0, insertAt),
    P_REAL_EDGE_SLOT,
    ...normalizedChildIds.slice(insertAt),
  ];
}

function sanitizePEmbeddingOrder(comp, order, childIds) {
  if (!Array.isArray(order) || order.length === 0) return null;

  const normalizedChildIds = Array.isArray(childIds) ? childIds.filter(id => id != null) : [];
  const remainingChildren = new Set(normalizedChildIds);
  const allowRealEdge = pComponentHasRealEdge(comp);
  let sawRealEdge = false;
  const sanitized = [];

  for (const token of order) {
    if (token === P_REAL_EDGE_SLOT) {
      if (!allowRealEdge || sawRealEdge) continue;
      sawRealEdge = true;
      sanitized.push(token);
      continue;
    }

    if (!remainingChildren.has(token)) continue;
    remainingChildren.delete(token);
    sanitized.push(token);
  }

  for (const childId of normalizedChildIds) {
    if (remainingChildren.has(childId)) {
      remainingChildren.delete(childId);
      sanitized.push(childId);
    }
  }

  if (allowRealEdge && !sawRealEdge) {
    return buildDefaultPEmbeddingOrder(comp, sanitized.filter(token => token !== P_REAL_EDGE_SLOT));
  }

  return sanitized;
}

function getActivePEmbeddingOrder(comp, childIds) {
  const fullOrder = sanitizePEmbeddingOrder(comp, comp?.embeddingPOrder, childIds);
  if (fullOrder && fullOrder.length > 0) return fullOrder;
  return buildDefaultPEmbeddingOrder(comp, childIds);
}

function getPChildOrder(comp, childIds) {
  return getActivePEmbeddingOrder(comp, childIds)
    .filter(token => token !== P_REAL_EDGE_SLOT);
}

// ═══════════════════════════════════════════════════════════════════
//  S-NODE CHILD ORIENTATION HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Flip canonical positions across the x-axis (y → −y).
 * Used when a child subtree needs to expand on the opposite side
 * of its parent virtual edge (outward from the S-cycle instead of inward).
 * The virtual-edge endpoints (at y = 0) are unaffected.
 */
function flipCanonicalY(positions) {
  const out = new Map();
  for (const [id, p] of positions) {
    out.set(id, { x: p.x, y: -p.y });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  CANONICAL NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Translate + rotate + scale a set of positions so that:
 *   vertex u  →  (0, 0)
 *   vertex v  →  (1, 0)
 *
 * All other vertices are transformed by the same affine map.
 *
 * @param {Map<number,{x,y}>} positions
 * @param {number} u – vertex id for origin
 * @param {number} v – vertex id for (1,0)
 * @returns {Map<number,{x,y}>}  new map, original unchanged
 */
function normalizeToCanonical(positions, u, v) {
  const pu = positions.get(Number(u));
  const pv = positions.get(Number(v));

  if (!pu || !pv) {
    dbgWarn(`normalizeToCanonical: missing position for ${u} or ${v}`);
    return new Map(positions);
  }

  const dx = pv.x - pu.x;
  const dy = pv.y - pu.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const cos = dx / dist;
  const sin = dy / dist;

  const out = new Map();
  for (const [id, p] of positions) {
    // Translate so u is at origin
    const tx = p.x - pu.x;
    const ty = p.y - pu.y;
    // Rotate so v is on positive x-axis, then scale so v is at (1,0)
    out.set(id, {
      x: ( cos * tx + sin * ty) / dist,
      y: (-sin * tx + cos * ty) / dist,
    });
  }
  return out;
}

/**
 * Inverse of canonical: map from canonical coords back to world,
 * placing the interface edge from targetU to targetV.
 *
 * canonical (0,0) → targetU
 * canonical (1,0) → targetV
 *
 * @param {Map<number,{x,y}>} canonicalPositions
 * @param {{x,y}} targetU
 * @param {{x,y}} targetV
 * @returns {Map<number,{x,y}>}
 */
function applyAffineFromCanonical(canonicalPositions, targetU, targetV) {
  const dx = targetV.x - targetU.x;
  const dy = targetV.y - targetU.y;
  // The transform: scale by dist, rotate by angle, translate by targetU
  // x_world = targetU.x + dx * x_canon - dy * y_canon
  // y_world = targetU.y + dy * x_canon + dx * y_canon

  const out = new Map();
  for (const [id, p] of canonicalPositions) {
    out.set(id, {
      x: targetU.x + dx * p.x - dy * p.y,
      y: targetU.y + dy * p.x + dx * p.y,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Euclidean distance between two points. */
function ptDist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * 2D cross product (signed area of triangle p1→p2→p3).
 * Positive if CCW, negative if CW, 0 if collinear.
 */
function cross2D(p1, p2, p3) {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

/**
 * Test if two segments (a1–a2) and (b1–b2) properly intersect
 * (crossing, not just endpoint-touching).
 */
function segmentsIntersectProperly(a1, a2, b1, b2) {
  const d1 = cross2D(b1, b2, a1);
  const d2 = cross2D(b1, b2, a2);
  const d3 = cross2D(a1, a2, b1);
  const d4 = cross2D(a1, a2, b2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/**
 * Detect all proper crossings among a set of edges.
 * Skips pairs that share an endpoint (adjacent edges can't "cross").
 *
 * @param {Map<number,{x,y}>} positions
 * @param {Array<{source:number,target:number}>} edges
 * @returns {Array<{e1:number,e2:number,edge1:{source,target},edge2:{source,target}}>}
 */
function detectCrossings(positions, edges) {
  const crossings = [];
  for (let i = 0; i < edges.length; i++) {
    const { source: s1, target: t1 } = edges[i];
    const p1 = positions.get(s1), p2 = positions.get(t1);
    if (!p1 || !p2) continue;
    for (let j = i + 1; j < edges.length; j++) {
      const { source: s2, target: t2 } = edges[j];
      if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue;
      const p3 = positions.get(s2), p4 = positions.get(t2);
      if (!p3 || !p4) continue;
      if (segmentsIntersectProperly(p1, p2, p3, p4)) {
        crossings.push({ e1: i, e2: j, edge1: edges[i], edge2: edges[j] });
      }
    }
  }
  return crossings;
}

/**
 * For a face polygon, compute the centroid-triangle for a specific
 * edge (u, v).  The face must be convex (guaranteed by Tutte for
 * R-nodes and by convex polygon layout for S-nodes).
 *
 * Returns { centroid, depth, direction } where:
 *   centroid  — {x,y} of the face centroid
 *   depth     — perpendicular distance from edge (u,v) to centroid
 *   direction — +1 or −1, the perpendicular side the centroid is on
 *               relative to the directed edge u→v
 */
function computeFaceTriangle(face, uNum, vNum, composed, posOverrides = null) {
  let cx = 0, cy = 0, count = 0;
  for (const fv of face) {
    const pos = posOverrides?.get(Number(fv)) ?? composed.get(Number(fv));
    if (!pos) continue;
    cx += pos.x; cy += pos.y; count++;
  }
  if (count === 0) return null;
  const centroid = { x: cx / count, y: cy / count };

  const posU = posOverrides?.get(uNum) ?? composed.get(uNum);
  const posV = posOverrides?.get(vNum) ?? composed.get(vNum);
  if (!posU || !posV) return null;

  const edgeLen = ptDist(posU, posV) || 1;
  // Signed perpendicular distance from centroid to directed line u→v
  const signedDist = cross2D(posU, posV, centroid) / edgeLen;

  return {
    centroid,
    depth: Math.abs(signedDist),
    direction: signedDist >= 0 ? 1 : -1,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  COMPOSITION  (top-down, geometry-driven)
// ═══════════════════════════════════════════════════════════════════

/**
 * Top-down composition with geometric non-crossing guarantees.
 *
 *   P-nodes: children in non-overlapping squares between poles.
 *     Squares are arranged perpendicular to the pole axis.
 *     Mathematical proof ensures edges from any square to both
 *     poles cannot cross edges from another square.
 *
 *   S/R-nodes: centroid-based face triangulation.
 *     Each face is decomposed into triangles via its centroid.
 *     Each virtual edge gets triangle (Centroid, u, v) in the
 *     appropriate face.  These triangles partition the face and
 *     are pairwise disjoint, guaranteeing no child overlaps.
 */
function composeTopDown(node, targetU, targetV, virtualEdgeData, spqrTree,
                       flip = false, canvasW = 1000, canvasH = 1000) {

  const poleDist = ptDist(targetU, targetV) || 1;

  if (DEBUG) {
    dbgGroup(`⚙️ COMPOSE: ${node.id} (${node.comp.type}, w=${node.weight}) pDist=${poleDist.toFixed(1)}${flip ? ' FLIP' : ''}`);
  }

  // ── 1. Draw this component locally ───────────────────────────
  const localPos = drawComponentLocally(node, virtualEdgeData, spqrTree);
  node._localPositions = localPos;

  // ── 2. Normalize to canonical  (parent VE → (0,0)→(1,0)) ────
  let canonicalPos;
  if (node._parentVirtualEdge) {
    const [u, v] = node._parentVirtualEdge;
    canonicalPos = normalizeToCanonical(localPos, u, v);
    if (DEBUG) {
      const pu = canonicalPos.get(Number(u));
      const pv = canonicalPos.get(Number(v));
      dbg(`Canonical: u=${u}@(${pu?.x.toFixed(3)},${pu?.y.toFixed(3)})  v=${v}@(${pv?.x.toFixed(3)},${pv?.y.toFixed(3)})`);
    }
  } else {
    canonicalPos = new Map(localPos);
    if (DEBUG) dbg('ROOT — using local positions as canonical.');
  }

  // ── 3. Apply flip if requested ───────────────────────────────
  if (flip) {
    canonicalPos = flipCanonicalY(canonicalPos);
    if (DEBUG) dbg('↕️ Flipped canonical Y');
  }

  // ── 4. Map to world coordinates ──────────────────────────────
  let composed;
  const isRoot = !node._parentVirtualEdge;

  if (isRoot && node.comp.type !== 'P') {
    // Root S/R: scale to fill canvas preserving natural proportions.
    // No padding applied here — final scalePositionsToCanvas handles
    // uniform fitting with its own padding parameter.
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const { x, y } of canonicalPos.values()) {
      if (x < minX) minX = x;  if (x > maxX) maxX = x;
      if (y < minY) minY = y;  if (y > maxY) maxY = y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rootScale = Math.min(canvasW / rangeX, canvasH / rangeY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    composed = new Map();
    for (const [id, { x, y }] of canonicalPos) {
      composed.set(id, {
        x: canvasW / 2 + (x - cx) * rootScale,
        y: canvasH / 2 + (y - cy) * rootScale,
      });
    }
    if (DEBUG) {
      dbg(`Root ${node.comp.type}: scaled to canvas (scale=${rootScale.toFixed(2)})`);
    }
  } else {
    composed = applyAffineFromCanonical(canonicalPos, targetU, targetV);
  }

  // ── 5. Compose children per type ─────────────────────────────
  if (node.comp.type === 'P') {
    composePChildren_Squares(
      node, composed, targetU, targetV, poleDist,
      virtualEdgeData, spqrTree, canvasW, canvasH
    );
  } else {
    composeSRChildren_Triangles(
      node, composed, virtualEdgeData, spqrTree, canvasW, canvasH
    );
  }

  if (DEBUG) {
    dbg(`Done ${node.id}: ${composed.size} vertices`);
    dbgGroupEnd();
  }

  node._composedPositions = composed;
}

// ─────────────────────────────────────────────────────────────────
//  P-NODE CHILDREN: NON-OVERLAPPING SQUARES BETWEEN POLES
// ─────────────────────────────────────────────────────────────────

/**
 * Place each child of a P-node in a non-overlapping square cell
 * arranged perpendicular to the pole axis, centered between the poles.
 *
 * Crossing-freedom proof (two-sided cone-safe layout):
 *   Children are split into two groups placed on opposite sides of the
 *   pole axis.  Within each side, children are placed outward from the
 *   axis with cone-safe gaps:
 *
 *     x_cone = x_outer · H / (H − s_i)
 *
 *   where x_outer is the outside edge distance from axis.
 *   Each successive child starts at the cone boundary of its inner
 *   neighbor, ensuring no fan-cone overlap within a side.
 *
 *   Children on OPPOSITE sides of the axis cannot create crossings:
 *   their fan cones extend in opposite directions (away from axis),
 *   and any cross-pole edge pair parametrically intersects only
 *   at t, u > 1 (beyond the pole endpoints) or at the pole itself.
 *
 *   Within the same side, the cone gap guarantees no crossing.
 *   → No crossing between any two children.
 *
 *   Lightest children are placed innermost (nearest axis) to minimize
 *   cone expansion overhead, since f(s) = s²/(H−s) is convex increasing.
 */
function composePChildren_Squares(node, composed, targetU, targetV, poleDist,
                                   virtualEdgeData, spqrTree, canvasW, canvasH,
                                   maxPerpExtent = null) {
  const children = [...node._childVirtualEdges];
  if (children.length === 0) return;

  // Pole axis and perpendicular unit vectors
  const dx = targetV.x - targetU.x;
  const dy = targetV.y - targetU.y;
  const axisX = dx / poleDist;
  const axisY = dy / poleDist;
  const perpX = -axisY;
  const perpY =  axisX;

  // For the root P-node the full pole distance is the natural perpendicular
  // budget.  For non-root P-nodes placed inside a parent's allocated region
  // (slab or triangle), maxPerpExtent caps the budget so children cannot
  // overshoot the parent's space.
  const totalPerpExtent = maxPerpExtent !== null
    ? Math.min(poleDist, maxPerpExtent)
    : poleDist;

  const realEdge = getPRealEdge(node.comp);
  const H = poleDist;

  // Count non-pole vertices in each child's subtree for proportional sizing.
  // This is an exact count (not a heuristic) — it counts the actual vertices
  // that will be placed inside each square.
  function countSubtreeVertices(treeNode) {
    let count = 0;
    // Count skeleton vertices excluding the parent virtual-edge poles
    const pve = treeNode._parentVirtualEdge;
    const poleSet = pve ? new Set(pve.map(Number)) : new Set();
    if (treeNode.comp.graph) {
      for (const v of treeNode.comp.graph.keys()) {
        if (!poleSet.has(Number(v))) count++;
      }
    }
    for (const child of treeNode.children) {
      count += countSubtreeVertices(child);
    }
    return count;
  }

  // Attach vertex counts; minimum 1 so every child gets some space.
  // IMPORTANT: preserve the current _childVirtualEdges order exactly.
  // The embedding of a P-node is defined by this child order, and the
  // allocated spaces must follow it directly.
  const entries = children.map(ce => ({
    ce,
    vCount: Math.max(1, countSubtreeVertices(ce.childNode)),
  }));

  const entryById = new Map(entries.map(entry => [entry.ce.childNode.id, entry]));
  const slotItems = getActivePEmbeddingOrder(
    node.comp,
    children.map(ce => ce.childNode.id)
  ).map(token => (
    token === P_REAL_EDGE_SLOT
      ? { type: 'real-edge', token, edge: realEdge, vCount: 1 }
      : { type: 'child', token, entry: entryById.get(token) }
  )).filter(item => item.type === 'real-edge' || item.entry);

  const k = slotItems.length;
  const totalVCount = slotItems.reduce((sum, item) => sum + (item.vCount || item.entry?.vCount || 1), 0) || 1;

  // Split into two groups: even indices → right (+perp), odd → left (−perp)
  const rightGroup = slotItems
    .filter((item, j) => j % 2 === 0);
  const leftGroup  = slotItems
    .filter((item, j) => j % 2 === 1);

  // Layout one side outward from the pole axis (distances ≥ 0).
  // Each child's square side is proportional to its vertex count.
  // Cone expansion: next inner edge = outerEdge · H / (H − s).
  function layoutSide(group, scaleFactor) {
    if (group.length === 0) return { ss: [], centers: [], coneStarts: [], extent: 0 };
    const n = group.length;
    const ss = group.map(item =>
      ((item.vCount || item.entry?.vCount || 1) / totalVCount) * totalPerpExtent * scaleFactor
    );
    const centers = [];
    const coneStarts = []; // where the cone intersection falls (for visualization)
    // Minimum gap from the pole axis so the innermost square doesn't
    // sit directly on the U–V line.  The binary search automatically
    // compensates by reducing the scale factor.
    const axisGap = H * 0.05;
    let pos = axisGap; // inner edge distance from axis
    for (let j = 0; j < n; j++) {
      centers.push(pos + ss[j] / 2);
      if (j < n - 1) {
        const outerEdge = pos + ss[j];
        // Geometric cone expansion: H / (H − s) where s < H
        // is guaranteed by the binary search constraint.
        const expand = H / (H - ss[j]);
        const nextStart = outerEdge * expand;
        coneStarts.push(nextStart);
        pos = nextStart;
      }
    }
    const last = n - 1;
    return { ss, centers, coneStarts, extent: centers[last] + ss[last] / 2 };
  }

  // Binary search: largest scaleFactor where both sides fit in perpExtent/2
  const halfExtent = totalPerpExtent / 2;
  let lo = 0.001, hi = 2.0;
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const R = layoutSide(rightGroup, mid).extent;
    const L = layoutSide(leftGroup, mid).extent;
    if (Math.max(R, L) <= halfExtent) lo = mid; else hi = mid;
  }
  const rightLayout = layoutSide(rightGroup, lo);
  const leftLayout  = layoutSide(leftGroup, lo);

  // Expand the outermost square on each side to fill up to halfExtent.
  // Inner squares are constrained by cone expansion, but the outermost
  // square has no successor — it can grow to use all remaining space.
  function expandOutermost(layout) {
    if (layout.ss.length === 0) return;
    const last = layout.ss.length - 1;
    const innerEdge = layout.centers[last] - layout.ss[last] / 2;
    const newSide = halfExtent - innerEdge;
    if (newSide > layout.ss[last]) {
      layout.ss[last] = newSide;
      layout.centers[last] = innerEdge + newSide / 2;
      layout.extent = halfExtent;
    }
  }
  expandOutermost(rightLayout);
  expandOutermost(leftLayout);

  if (DEBUG) {
    dbg(`P-cones: k=${k}, poleDist=${H.toFixed(1)}, perpExtent=${totalPerpExtent.toFixed(1)}, halfExtent=${halfExtent.toFixed(1)}`);
    dbg(`  right: sides=[${rightLayout.ss.map(s=>s.toFixed(1))}] extent=${rightLayout.extent.toFixed(1)}`);
    dbg(`  left:  sides=[${leftLayout.ss.map(s=>s.toFixed(1))}] extent=${leftLayout.extent.toFixed(1)}`);
  }

  // Build perpCenter map: right group → positive, left group → negative
  const childPlacements = new Map();
  for (let j = 0; j < rightGroup.length; j++) {
    childPlacements.set(rightGroup[j], {
      perpCenter: +rightLayout.centers[j],
      side: rightLayout.ss[j],
    });
  }
  for (let j = 0; j < leftGroup.length; j++) {
    childPlacements.set(leftGroup[j], {
      perpCenter: -leftLayout.centers[j],
      side: leftLayout.ss[j],
    });
  }

  function emitWingAndCone(label, perpCenter, side) {
    const sqCX = midX + perpX * perpCenter;
    const sqCY = midY + perpY * perpCenter;
    const halfS = side / 2;

    // The full allocated region is the entire cone quadrilateral from pole U to
    // pole V.  At the outer perp edge (d_outer from the axis) the cone width is
    // `side`; the cone tapers to a point at each pole.  This is the maximal
    // crossing-safe region for this child — the cone-gap formula guarantees no
    // overlap with adjacent children's cones.
    const outerPerp = perpCenter >= 0 ? halfS : -halfS;

    const cornerNearV = {
      x: sqCX + axisX*halfS + perpX*outerPerp,
      y: sqCY + axisY*halfS + perpY*outerPerp
    };
    const cornerNearU = {
      x: sqCX - axisX*halfS + perpX*outerPerp,
      y: sqCY - axisY*halfS + perpY*outerPerp
    };

    // Wing polygon = the full cone kite: U → nearU-corner → nearV-corner → V.
    _allocatedRegions.push({
      type: 'wing',
      label,
      parentLabel: node.id,
      points: [
        { x: targetU.x, y: targetU.y },
        cornerNearU,
        cornerNearV,
        { x: targetV.x, y: targetV.y },
      ]
    });

    return { sqCX, sqCY, halfS };
  }

  // Emit cone intersection points for visualization.
  // These are the points where the two angular cone lines from U and V
  // through the outside corners of a square intersect — the boundary
  // beyond which the next square may start.
  const midX = (targetU.x + targetV.x) / 2;
  const midY = (targetU.y + targetV.y) / 2;

  function emitConeIntersections(layout, sign) {
    for (let j = 0; j < layout.coneStarts.length; j++) {
      const perpDist = layout.coneStarts[j] * sign;
      _allocatedRegions.push({
        type: 'cone-intersection',
        label: '',
        parentLabel: node.id,
        point: {
          x: midX + perpX * perpDist,
          y: midY + perpY * perpDist,
        },
      });
    }
  }
  emitConeIntersections(rightLayout, +1);
  emitConeIntersections(leftLayout, -1);

  for (let i = 0; i < slotItems.length; i++) {
    const item = slotItems[i];
    const placement = childPlacements.get(item);
    if (!placement) continue;

    const { perpCenter, side } = placement;
    const squareGeom = emitWingAndCone(
      item.type === 'real-edge'
        ? (item.edge ? `${item.edge[0]}-${item.edge[1]}` : 'real-edge')
        : item.entry.ce.childNode.id,
      perpCenter,
      side
    );

    if (item.type === 'real-edge') {
      if (item.edge) {
        // For odd-count P nodes, slot index 0 is the visual center. Draw it straight.
        const isCenterSlot = k % 2 === 1 && i === 0;
        if (!isCenterSlot) {
          _edgeRoutes.set(getUndirectedEdgeKey(item.edge[0], item.edge[1]), {
            type: 'quadratic',
            control: {
              x: midX + (squareGeom.sqCX - midX) * 2,
              y: midY + (squareGeom.sqCY - midY) * 2,
            },
            componentId: node.id,
          });
        }
      }
      continue;
    }

    const ce = item.entry.ce;

    const child = ce.childNode;
    const [cu, cv] = ce.edge;
    const cuNum = Number(cu), cvNum = Number(cv);

    // Phase 1: Draw child locally.
    // We do NOT call composeTopDown here — that would recurse
    // grandchildren in canonical space, then the P-wing scaling
    // would move non-pole vertices while poles stay at P-parent
    // positions, tearing the topology.  Instead, we map the direct
    // component to world space first, then compose grandchildren.
    // Side effect: sets child._cycleOrder for S-nodes.
    const localPos = drawComponentLocally(child, virtualEdgeData, spqrTree);
    child._localPositions = localPos;

    const savedPoleU = composed.get(cuNum);
    const savedPoleV = composed.get(cvNum);
    let added = 0;

    if (child.comp.type === 'S' && child._cycleOrder && child._cycleOrder.length > 2) {
      // ── S-node child: evenly-spaced axis placement ────────────────────
      // The S-skeleton is a path cu → v₁ → v₂ → … → vₖ → cv (plus the
      // virtual edge cu-cv closing the cycle).  Place each vⱼ at axis
      // fraction j/(k+1) between the poles, at the perpendicular depth
      // perpCenter — using the full wing length rather than compressing
      // everything into a small canonical bounding box.
      //
      // _cycleOrder after drawSLocal reorder: [cu, cv, v_k, v_{k-1}, …, v_1]
      // Reversing from index (n-1) down to 2 yields the path order v₁…vₖ.
      const cycleOrder = child._cycleOrder;
      const nonPole = [];
      for (let j = cycleOrder.length - 1; j >= 2; j--) {
        nonPole.push(Number(cycleOrder[j]));
      }
      const k = nonPole.length;
      // Sinusoidal perpendicular profile: each vertex curves away from the
      // pole axis proportional to sin(f·π), peaking at perpCenter (the center
      // of the allocated strip).  Keeping the arc central leaves the outer
      // half of the wing free for the S-component's children to spread into.
      for (let j = 0; j < k; j++) {
        const f = (j + 1) / (k + 1);
        const perpDepth = perpCenter * Math.sin(f * Math.PI);
        composed.set(nonPole[j], {
          x: targetU.x + f * (targetV.x - targetU.x) + perpX * perpDepth,
          y: targetU.y + f * (targetV.y - targetU.y) + perpY * perpDepth,
        });
        added++;
      }

      if (DEBUG) {
        dbg(`  Wing[${i}] ${child.id} (S-arc): side=${side.toFixed(1)}, perpC=${perpCenter.toFixed(1)}, k=${k} verts`);
      }

    } else {
      // ── P/R-node child: canonical bounding-box placement ──────────────
      // Normalize to canonical (poles at (0,0) and (1,0)), compute the
      // bounding box, then scale uniformly to fill the wing.
      const canonicalPos = normalizeToCanonical(localPos, cu, cv);

      let minCX = Infinity, maxCX = -Infinity;
      let minCY = Infinity, maxCY = -Infinity;
      for (const { x, y } of canonicalPos.values()) {
        if (x < minCX) minCX = x;  if (x > maxCX) maxCX = x;
        if (y < minCY) minCY = y;  if (y > maxCY) maxCY = y;
      }
      const canonW = maxCX - minCX || 1;
      const canonH = maxCY - minCY || 1;
      const ccx = (minCX + maxCX) / 2;
      const ccy = (minCY + maxCY) / 2;

      const sqCX = squareGeom.sqCX;
      const sqCY = squareGeom.sqCY;

      // The cone spans the full pole distance H along the axis;
      // perpendicular to the axis the child is constrained to `side`.
      const scale = Math.min(H / canonW, side / canonH);

      for (const [vid, pos] of canonicalPos) {
        const relAlong = (pos.x - ccx) * scale;
        const relPerp  = (pos.y - ccy) * scale;
        composed.set(vid, {
          x: sqCX + axisX * relAlong + perpX * relPerp,
          y: sqCY + axisY * relAlong + perpY * relPerp,
        });
        if (vid !== cuNum && vid !== cvNum) added++;
      }

      if (DEBUG) {
        dbg(`  Wing[${i}] ${child.id}: side=${side.toFixed(1)}, H=${H.toFixed(1)}, perpC=${perpCenter.toFixed(1)}, scale=${scale.toFixed(4)}, ${added} verts`);
      }
    }

    // Phase 3: Compose grandchildren. Poles are at in-square positions,
    // so all sub-allocations stay within this square.
    // Pass savedPoleU/V as position overrides so that any R-node grandchild
    // whose Tutte boundary includes cuNum or cvNum uses the TRUE final positions
    // of these poles (not the temporary in-square positions).  Without this,
    // R-node Tutte would pin those vertices at the in-square coordinates, but
    // after composition finishes the poles are restored to savedPoleU/V —
    // making interior vertices inconsistent with the restored pole positions.
    if (child._childVirtualEdges && child._childVirtualEdges.length > 0) {
      if (child.comp.type === 'P') {
        const cPosU = composed.get(cuNum);
        const cPosV = composed.get(cvNum);
        const childPoleDist = ptDist(cPosU, cPosV) || 1;
        // Cap perpExtent to the wing width so grandchildren don't escape the
        // parent P's allocated region (direct P→P nesting).
        composePChildren_Squares(
          child, composed, cPosU, cPosV, childPoleDist,
          virtualEdgeData, spqrTree, canvasW, canvasH,
          squareGeom.halfS * 2
        );
      } else if (child.comp.type === 'S') {
        // S-node child used sinusoidal arc placement — use slab allocation
        // for its children instead of centroid-triangle decomposition.
        composeSChildrenInWing(
          child, composed,
          targetU, axisX, axisY, perpX, perpY, H, squareGeom.halfS, perpCenter,
          virtualEdgeData, spqrTree, canvasW, canvasH
        );
      } else {
        const poleOverrides = new Map([[cuNum, savedPoleU], [cvNum, savedPoleV]]);
        composeSRChildren_Triangles(
          child, composed, virtualEdgeData, spqrTree, canvasW, canvasH,
          poleOverrides
        );
      }
    }

    // Restore poles to their parent-level positions.
    composed.set(cuNum, savedPoleU);
    composed.set(cvNum, savedPoleV);
  }
}

// ─────────────────────────────────────────────────────────────────
//  S-NODE CHILDREN WITHIN A WING: GREEDY SLAB ALLOCATION
// ─────────────────────────────────────────────────────────────────

/**
 * Allocate children of an S-node that was placed inside a P-node's wing
 * using the sinusoidal arc.
 *
 * For each virtual edge (a, b) of the S-node:
 *   - Project a and b onto the wing axis to get t_a and t_b.
 *   - Cut the wing with perpendicular lines at t_a and t_b ("horizontal
 *     lines through both poles").
 *   - The apex of the allocation is the point of maximum cone depth within
 *     the slab [t_a, t_b], sitting on the outer boundary of the wing.
 *   - The child is composed inside the triangle (Pa, Pb, apex).
 *
 * This is "greedy" in that each edge claims its full slab of the wing
 * without negotiating with siblings — the non-overlapping guarantee comes
 * from the S-path structure (slabs partition the wing along the axis).
 */
function composeSChildrenInWing(
  node, composed,
  targetU, axisX, axisY, perpX, perpY, H, halfS, perpCenter,
  virtualEdgeData, spqrTree, canvasW, canvasH
) {
  if (!node._childVirtualEdges || node._childVirtualEdges.length === 0) return;

  const d_outer  = Math.abs(perpCenter) + halfS;
  const perpSign = perpCenter >= 0 ? 1 : -1;
  // Axis length of the cone's flat-top region; triangular sides outboard of this.
  const tL = H / 2 - halfS;

  // Depth of the wing cone at axis position t (distance from pole axis to cone wall).
  function coneDepth(t) {
    if (tL <= 0) return d_outer;
    if (t <= tL)     return d_outer * t / tL;
    if (t >= H - tL) return d_outer * (H - t) / tL;
    return d_outer;
  }

  // Signed projection of a world point onto the wing axis (0 at U, H at V).
  function axisPos(p) {
    return (p.x - targetU.x) * axisX + (p.y - targetU.y) * axisY;
  }

  for (const { edge, childNode } of node._childVirtualEdges) {
    const [cu, cv] = edge;
    const cuNum = Number(cu), cvNum = Number(cv);

    const posA = composed.get(cuNum);
    const posB = composed.get(cvNum);
    if (!posA || !posB) continue;

    // Axis positions of both poles along the wing.
    const tA   = axisPos(posA);
    const tB   = axisPos(posB);
    const tMid = (tA + tB) / 2;

    // Apex = deepest available point in this slab on the outer cone wall.
    const depth = coneDepth(Math.max(0, Math.min(H, tMid)));
    const apexX = targetU.x + tMid * axisX + perpX * perpSign * depth;
    const apexY = targetU.y + tMid * axisY + perpY * perpSign * depth;

    if (DEBUG) {
      dbg(`  SlabChild ${childNode.id} via [${cu},${cv}]: tA=${tA.toFixed(1)}, tB=${tB.toFixed(1)}, depth=${depth.toFixed(1)}`);
    }

    _allocatedRegions.push({
      type: 'triangle',
      label: childNode.id,
      parentLabel: node.id,
      points: [
        { x: posA.x, y: posA.y },
        { x: posB.x, y: posB.y },
        { x: apexX, y: apexY },
      ]
    });

    const savedPoleU = composed.get(cuNum);
    const savedPoleV = composed.get(cvNum);

    if (childNode.comp.type === 'R') {
      composeRChildInTriangle(
        childNode, composed,
        posA, posB, cuNum, cvNum,
        apexX, apexY,
        posA, posB,
        virtualEdgeData, spqrTree, canvasW, canvasH,
        null
      );
    } else if (childNode.comp.type === 'P') {
      if (childNode._childVirtualEdges && childNode._childVirtualEdges.length > 0) {
        const childPoleDist = ptDist(posA, posB) || 1;
        // Cap the perpendicular budget to the slab depth so the grandchildren
        // cannot escape the parent's allocated cone region.
        composePChildren_Squares(
          childNode, composed, posA, posB, childPoleDist,
          virtualEdgeData, spqrTree, canvasW, canvasH,
          depth
        );
      }
    } else {
      // S-node grandchild: place its arc within the slab, then recurse.
      const localPos = drawComponentLocally(childNode, virtualEdgeData, spqrTree);
      childNode._localPositions = localPos;

      if (childNode._cycleOrder && childNode._cycleOrder.length > 2) {
        const cycleOrder = childNode._cycleOrder;
        const nonPole = [];
        for (let j = cycleOrder.length - 1; j >= 2; j--) {
          nonPole.push(Number(cycleOrder[j]));
        }
        const k = nonPole.length;
        // Peak at half the parent slab depth so the grandchild's own
        // children still have room on the outer side.
        const subPeak = perpSign * depth * 0.5;
        for (let j = 0; j < k; j++) {
          const f = (j + 1) / (k + 1);
          const pd = subPeak * Math.sin(f * Math.PI);
          composed.set(nonPole[j], {
            x: posA.x + f * (posB.x - posA.x) + perpX * pd,
            y: posA.y + f * (posB.y - posA.y) + perpY * pd,
          });
        }
        if (childNode._childVirtualEdges && childNode._childVirtualEdges.length > 0) {
          composeSRChildren_Triangles(
            childNode, composed, virtualEdgeData, spqrTree, canvasW, canvasH, null
          );
        }
      }
    }

    composed.set(cuNum, savedPoleU);
    composed.set(cvNum, savedPoleV);
  }
}

// ─────────────────────────────────────────────────────────────────
//  S / R NODE CHILDREN: CENTROID-TRIANGLE FACE DECOMPOSITION
// ─────────────────────────────────────────────────────────────────

/**
 * For each child virtual edge in an S or R component, find the
 * appropriate face, compute the centroid-triangle for that edge,
 * and compose the child within the triangle.
 *
 * Non-overlap proof:
 *   Each face is convex (Tutte guarantee for R-nodes, convex polygon
 *   for S-nodes).  The centroid C of a convex polygon is strictly
 *   interior.  The triangles (C, v_i, v_{i+1}) for consecutive
 *   boundary edges partition the face exactly with zero overlap.
 *   Different virtual edges — even on the SAME face — get disjoint
 *   triangles.  Faces themselves are disjoint by construction.
 *   Hence all child allocations are pairwise disjoint.
 */
function composeSRChildren_Triangles(node, composed, virtualEdgeData, spqrTree,
                                      canvasW, canvasH, posOverrides = null) {
  for (const { edge, childNode } of node._childVirtualEdges) {
    const [cu, cv] = edge;
    const cuNum = Number(cu), cvNum = Number(cv);

    // Use override positions when available — these are the TRUE final positions
    // of vertices that an ancestor P-node has temporarily displaced into a square.
    // Without overrides, posU/posV would be the temporary in-square positions,
    // causing the Tutte boundary and face centroid to be computed at wrong locations.
    const posU = posOverrides?.get(cuNum) ?? composed.get(cuNum);
    const posV = posOverrides?.get(cvNum) ?? composed.get(cvNum);

    if (!posU || !posV) {
      dbgWarn(`compose: missing positions for ${cu}-${cv} in ${node.id}`);
      continue;
    }

    if (DEBUG && posOverrides) {
      if (posOverrides.has(cuNum)) dbg(`  ↩ override posU for v${cuNum}: (${posU.x.toFixed(3)}, ${posU.y.toFixed(3)})`);
      if (posOverrides.has(cvNum)) dbg(`  ↩ override posV for v${cvNum}: (${posV.x.toFixed(3)}, ${posV.y.toFixed(3)})`);
    }

    // ── Find the centroid-triangle for this virtual edge ──────
    // Pass posOverrides so the face centroid (apex) is computed using real
    // pole positions, not the temporary in-square positions.
    const tri = findFaceTriangle(node, cuNum, cvNum, composed, posOverrides);

    if (!tri || tri.depth < 1e-6) {
      dbgWarn(`No valid triangle for child ${childNode.id} via [${cu},${cv}], depth=${tri?.depth}`);
      continue;
    }

    const { centroid: triApex, direction: dir } = tri;

    // Use the face centroid as the raw apex — it is guaranteed to be strictly
    // inside the parent face.  The old mid + perp*depth formula could overshoot
    // outside the face for thin (non-equilateral) parent faces, placing both
    // the apex and interior Tutte vertices at the same wrong position.
    const rawApexX = triApex.x;
    const rawApexY = triApex.y;

    // Shrink triangle toward its centroid to create gaps between siblings.
    // Factor 0.9 means each triangle is 90% of its full size, leaving
    // ~10% of the centroid-triangle area as padding between neighbors.
    const SHRINK = 0.9;
    const triCX = (posU.x + posV.x + rawApexX) / 3;
    const triCY = (posU.y + posV.y + rawApexY) / 3;
    const sU   = { x: triCX + SHRINK * (posU.x - triCX),    y: triCY + SHRINK * (posU.y - triCY) };
    const sV   = { x: triCX + SHRINK * (posV.x - triCX),    y: triCY + SHRINK * (posV.y - triCY) };
    const apexX = triCX + SHRINK * (rawApexX - triCX);
    const apexY = triCY + SHRINK * (rawApexY - triCY);

    // Recompute effective VE distance and depth for the shrunk triangle
    const sVeDist = ptDist(sU, sV) || 1;
    const sMidX = (sU.x + sV.x) / 2;
    const sMidY = (sU.y + sV.y) / 2;
    const sH = ptDist({ x: sMidX, y: sMidY }, { x: apexX, y: apexY });

    // Shrunk axis and perpendicular
    const sAxisX = (sV.x - sU.x) / sVeDist;
    const sAxisY = (sV.y - sU.y) / sVeDist;
    const sPerpX = -sAxisY * dir;
    const sPerpY =  sAxisX * dir;

    // Collect region for visualization (shrunk triangle)
    _allocatedRegions.push({
      type: 'triangle',
      label: childNode.id,
      parentLabel: node.id,
      points: [
        { x: sU.x, y: sU.y },
        { x: sV.x, y: sV.y },
        { x: apexX, y: apexY },
      ]
    });

    // ── R-node children: re-run Tutte in world space ─────────
    // Strategy: use the ALLOCATED triangle (in-square positions, no posOverrides)
    // as the Tutte domain so the embedding stays within allocated space. Then
    // project the REAL pole positions (from posOverrides) onto that allocated
    // triangle boundary so the Tutte poles respect actual positions.
    if (childNode.comp.type === 'R') {
      // Allocated (in-square) positions — define the Tutte domain.
      const allocPosU = composed.get(cuNum);
      const allocPosV = composed.get(cvNum);
      if (!allocPosU || !allocPosV) {
        dbgWarn(`composeRChildInTriangle: missing allocated positions for ${cuNum}-${cvNum}`);
        continue;
      }
      const allocTri = findFaceTriangle(node, cuNum, cvNum, composed); // NO posOverrides
      if (!allocTri || allocTri.depth < 1e-6) {
        dbgWarn(`No valid allocated triangle for R-child ${childNode.id} via [${cu},${cv}]`);
        continue;
      }
      const { centroid: allocApex } = allocTri;
      // Real (final) positions of the poles — may differ from allocated.
      const realPosU = posOverrides?.get(cuNum) ?? allocPosU;
      const realPosV = posOverrides?.get(cvNum) ?? allocPosV;
      const savedPoleU = composed.get(cuNum);
      const savedPoleV = composed.get(cvNum);
      composeRChildInTriangle(
        childNode, composed,
        allocPosU, allocPosV, cuNum, cvNum,
        allocApex.x, allocApex.y,
        realPosU, realPosV,
        virtualEdgeData, spqrTree, canvasW, canvasH,
        posOverrides
      );
      composed.set(cuNum, savedPoleU);
      composed.set(cvNum, savedPoleV);
      continue;
    }

    // ── Generic composition (S-nodes, P-nodes, fallback) ─────
    // Draw child locally + normalize to canonical (no grandchild recursion).
    const localPos = drawComponentLocally(childNode, virtualEdgeData, spqrTree);
    childNode._localPositions = localPos;
    const canonicalPos = normalizeToCanonical(localPos, cu, cv);

    // Bounding box of direct component's canonical positions
    let minCX = Infinity, maxCX = -Infinity;
    let minCY = Infinity, maxCY = -Infinity;
    for (const { x, y } of canonicalPos.values()) {
      if (x < minCX) minCX = x;  if (x > maxCX) maxCX = x;
      if (y < minCY) minCY = y;  if (y > maxCY) maxCY = y;
    }
    const canonW = maxCX - minCX || 1;
    const canonH = maxCY - minCY || 1;

    // Scale to fit in shrunk centroid-triangle.
    const scale = (sVeDist * sH) / (canonW * sH + canonH * sVeDist);

    const ccx = (minCX + maxCX) / 2;
    const ccy = (minCY + maxCY) / 2;

    const perpOffset = sH / 3;

    if (DEBUG) {
      dbg(`  → ${childNode.id} via [${cu},${cv}]: veDist=${sVeDist.toFixed(1)}, h=${sH.toFixed(1)}, dir=${dir}, scale=${scale.toFixed(4)}`);
    }

    // Place ALL vertices (including poles) into composed.
    // Poles are temporarily at in-triangle positions so grandchild
    // face triangles and sub-allocations stay contained.
    const savedPoleU = composed.get(cuNum);
    const savedPoleV = composed.get(cvNum);
    let added = 0;
    for (const [vid, pos] of canonicalPos) {
      const relAlong = (pos.x - ccx) * scale;
      const relPerp  = (pos.y - ccy) * scale;
      composed.set(vid, {
        x: sMidX + sPerpX * perpOffset + sAxisX * relAlong + sPerpX * relPerp,
        y: sMidY + sPerpY * perpOffset + sAxisY * relAlong + sPerpY * relPerp,
      });
      if (vid !== cuNum && vid !== cvNum) added++;
    }
    if (DEBUG) dbg(`    Merged ${added} verts from ${childNode.id}`);

    // Compose grandchildren. Poles are at in-triangle positions.
    if (childNode._childVirtualEdges && childNode._childVirtualEdges.length > 0) {
      if (childNode.comp.type === 'P') {
        const cPosU = composed.get(cuNum);
        const cPosV = composed.get(cvNum);
        const childPoleDist = ptDist(cPosU, cPosV) || 1;
        // Cap perpExtent to the triangle height so children don't escape the
        // parent's allocated triangle face.
        composePChildren_Squares(
          childNode, composed, cPosU, cPosV, childPoleDist,
          virtualEdgeData, spqrTree, canvasW, canvasH,
          sH
        );
      } else {
        composeSRChildren_Triangles(
          childNode, composed, virtualEdgeData, spqrTree, canvasW, canvasH,
          posOverrides
        );
      }
    }

    // Restore poles to their parent-level positions.
    composed.set(cuNum, savedPoleU);
    composed.set(cvNum, savedPoleV);
  }
}

function composeRChildInTriangle(
  childNode, composed, posU, posV, cuNum, cvNum,
  apexX, apexY,
  realPosU, realPosV,
  virtualEdgeData, spqrTree, canvasW, canvasH,
  posOverrides = null
) {
  // posU/posV  = ALLOCATED in-square positions (define the Tutte domain).
  // realPosU/V = TRUE final positions (from posOverrides, or same as alloc).
  if (DEBUG) {
    dbgGroup(`🔺 composeRChildInTriangle: ${childNode.id}`);
    dbg(`Alloc poles: u=${cuNum} @ (${posU.x.toFixed(3)}, ${posU.y.toFixed(3)})  v=${cvNum} @ (${posV.x.toFixed(3)}, ${posV.y.toFixed(3)})`);
    dbg(`Real  poles: u=${cuNum} @ (${realPosU.x.toFixed(3)}, ${realPosU.y.toFixed(3)})  v=${cvNum} @ (${realPosV.x.toFixed(3)}, ${realPosV.y.toFixed(3)})`);
    dbg(`Alloc apex: (${apexX.toFixed(3)}, ${apexY.toFixed(3)})`);
    dbg(`Alloc triangle area: ${(0.5 * Math.abs((posV.x-posU.x)*(apexY-posU.y) - (apexX-posU.x)*(posV.y-posU.y))).toFixed(3)}`);
  }

  drawComponentLocally(childNode, virtualEdgeData, spqrTree);

  const outerFace = childNode._outerFace;
  if (!outerFace || outerFace.length < 3) {
    dbgWarn(`composeRChildInTriangle: invalid outer face for ${childNode.id}`);
    if (DEBUG) dbgGroupEnd();
    return;
  }

  if (DEBUG) {
    dbg(`Outer face (${outerFace.length} verts): [${outerFace.join(', ')}]`);
    dbg(`All faces (${childNode._faces?.length ?? 0}):`);
    (childNode._faces || []).forEach((f, i) => dbg(`  F${i}: [${f.join(', ')}]`));
    dbg(`Local Tutte positions (unit-circle frame):`);
    if (childNode._localPositions) {
      for (const [v, p] of childNode._localPositions) {
        dbg(`  v${v}: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
      }
    }
  }

  const comp = childNode.comp;

  const subgraph = new Map();
  for (const [v, nbrs] of comp.graph) {
    subgraph.set(Number(v), (nbrs || []).filter(w => comp.graph.has(w)).map(Number));
  }

  // Allocated triangle domain — the Tutte embedding stays within this region.
  const U = { x: posU.x, y: posU.y };
  const V = { x: posV.x, y: posV.y };
  const A = { x: apexX, y: apexY };  // apex (triangle vertex, used for boundary projection)

  // Arc midpoint: place close to the apex so non-pole outer vertices spread
  // across most of the triangle height, rather than collapsing to the centroid.
  // Pull 10% back from the apex toward the centroid to avoid placing vertices
  // exactly on the shared triangle edges (U-A, V-A) that border adjacent
  // R-child allocations.
  const Cx = (U.x + V.x + A.x) / 3;
  const Cy = (U.y + V.y + A.y) / 3;
  const arcMid = { x: Cx + 0.9 * (A.x - Cx), y: Cy + 0.9 * (A.y - Cy) };

  // Project the REAL pole positions onto the allocated triangle boundary.
  // This ensures the Tutte polygon stays within allocated space while
  // the pole positions reflect the direction of actual pole locations.
  const poleU = projectOntoTriangleBoundary(realPosU, U, V, A);
  const poleV = projectOntoTriangleBoundary(realPosV, U, V, A);

  if (DEBUG) {
    const uMoved = ptDist(realPosU, poleU) > 1e-6;
    const vMoved = ptDist(realPosV, poleV) > 1e-6;
    dbg(`  projU: (${poleU.x.toFixed(3)},${poleU.y.toFixed(3)})${uMoved ? ` ← projected from (${realPosU.x.toFixed(3)},${realPosU.y.toFixed(3)})` : ' (on boundary)'}`);
    dbg(`  projV: (${poleV.x.toFixed(3)},${poleV.y.toFixed(3)})${vMoved ? ` ← projected from (${realPosV.x.toFixed(3)},${realPosV.y.toFixed(3)})` : ' (on boundary)'}`);
  }

  const outerPositions = new Map();

  outerPositions.set(cuNum, poleU);
  outerPositions.set(cvNum, poleV);

  const n = outerFace.length;

  // vertices excluding poles
  const remaining = outerFace.filter(v => v !== cuNum && v !== cvNum);

  // Determine arc direction: non-poles must lie on the arc that is the
  // LONGER path between the two poles in the face traversal, i.e. the
  // side that does NOT contain the direct virtual edge.
  // Face [1,2,8,7] with poles 7(i=3),8(i=2): going 7→1→2→8 = 3 steps
  //   → non-poles are between u and v going forward → arc U→A→V.
  // Face [7,8,6,5] with poles 7(i=0),8(i=1): going 7→8 = 1 step (short),
  //   going 8→6→5→7 = 3 steps → non-poles are between v and u → arc V→A→U.
  const uIdx = outerFace.indexOf(cuNum);
  const vIdx = outerFace.indexOf(cvNum);
  const stepsUtoV = (vIdx - uIdx + n) % n;
  const stepsVtoU = n - stepsUtoV;
  const arcStart = stepsUtoV > stepsVtoU ? poleU : poleV;
  const arcEnd   = stepsUtoV > stepsVtoU ? poleV : poleU;
  const arcStartLabel = stepsUtoV > stepsVtoU ? `U(${cuNum})` : `V(${cvNum})`;
  const arcEndLabel   = stepsUtoV > stepsVtoU ? `V(${cvNum})` : `U(${cuNum})`;

  if (DEBUG) {
    dbg(`Arc direction: uIdx=${uIdx}, vIdx=${vIdx}, n=${n}`);
    dbg(`  stepsUtoV=${stepsUtoV}, stepsVtoU=${stepsVtoU}`);
    dbg(`  → arc: ${arcStartLabel} → Apex → ${arcEndLabel}`);
    dbg(`  non-pole face vertices to distribute: [${remaining.join(', ')}]`);
  }

  const boundary = [arcStart, arcMid, arcEnd];

  const segLen = [
    ptDist(boundary[0], boundary[1]),
    ptDist(boundary[1], boundary[2])
  ];

  const totalLen = segLen[0] + segLen[1];

  if (DEBUG) {
    dbg(`Boundary arc: ${arcStartLabel}(${arcStart.x.toFixed(2)},${arcStart.y.toFixed(2)}) → Apex(${arcMid.x.toFixed(2)},${arcMid.y.toFixed(2)}) → ${arcEndLabel}(${arcEnd.x.toFixed(2)},${arcEnd.y.toFixed(2)})`);
    dbg(`  seg0 len=${segLen[0].toFixed(3)}, seg1 len=${segLen[1].toFixed(3)}, total=${totalLen.toFixed(3)}`);
  }

  for (let i = 0; i < remaining.length; i++) {

    const t = (i + 1) / (remaining.length + 1);
    const dist = t * totalLen;

    let p;

    if (dist <= segLen[0]) {

      const f = dist / segLen[0];
      p = {
        x: boundary[0].x + f * (boundary[1].x - boundary[0].x),
        y: boundary[0].y + f * (boundary[1].y - boundary[0].y)
      };

    } else {

      const f = (dist - segLen[0]) / segLen[1];
      p = {
        x: boundary[1].x + f * (boundary[2].x - boundary[1].x),
        y: boundary[1].y + f * (boundary[2].y - boundary[1].y)
      };

    }

    outerPositions.set(remaining[i], p);

    if (DEBUG) {
      dbg(`  outer v${remaining[i]}: t=${t.toFixed(3)}, dist=${dist.toFixed(3)} → (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
    }
  }

  if (DEBUG) {
    dbg(`World-space Tutte outer boundary (all ${outerFace.length} outer-face vertices):`);
    for (const v of outerFace) {
      const p = outerPositions.get(v);
      dbg(`  v${v}: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
    }
    // Check convexity of the outer boundary by signing cross products
    const pts = outerFace.map(v => outerPositions.get(v));
    let allPos = true, allNeg = true;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i+1)%pts.length], c = pts[(i+2)%pts.length];
      const cr = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
      if (cr < 0) allPos = false;
      if (cr > 0) allNeg = false;
    }
    const convex = allPos || allNeg;
    if (convex) {
      dbg(`  Outer boundary convexity: ✓ convex (${allPos ? 'CCW' : 'CW'})`);
    } else {
      dbgWarn(`  Outer boundary convexity: ✗ NOT convex — Tutte may produce crossings!`);
    }
  }

  const worldPositions = tutteEmbeddingWithPositions(
    subgraph,
    outerFace,
    outerPositions
  );

  if (DEBUG) {
    dbg(`Tutte world positions (${worldPositions.size} vertices):`);
    for (const [v, p] of worldPositions) {
      const isOuter = outerFace.includes(v);
      const isPole  = v === cuNum || v === cvNum;
      dbg(`  v${v} [${isPole ? 'POLE' : isOuter ? 'outer' : 'interior'}]: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
    }
    // Check for collisions in world positions
    const seen = new Map();
    for (const [v, p] of worldPositions) {
      const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      if (seen.has(key)) {
        dbgWarn(`  ⚠️ COLLISION: v${seen.get(key)} and v${v} both at (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`);
      }
      seen.set(key, v);
    }
  }

  let added = 0;

  for (const [vid, pos] of worldPositions) {
    if (vid === cuNum || vid === cvNum) continue;
    composed.set(vid, { x: pos.x, y: pos.y });
    added++;
  }

  if (DEBUG) dbg(`Wrote ${added} non-pole vertices to composed`);

  if (childNode._childVirtualEdges && childNode._childVirtualEdges.length > 0) {
    if (DEBUG) dbg(`Recursing into ${childNode._childVirtualEdges.length} grandchildren of ${childNode.id}`);
    composeSRChildren_Triangles(
      childNode,
      composed,
      virtualEdgeData,
      spqrTree,
      canvasW,
      canvasH,
      posOverrides
    );
  }

  const childComposed = new Map();

  for (const [vid, pos] of worldPositions) {
    childComposed.set(vid, { x: pos.x, y: pos.y });
  }

  childNode._composedPositions = childComposed;

  if (DEBUG) dbgGroupEnd();
}

function pointInTriangle(p, a, b, c) {
  const area = (p1, p2, p3) =>
    (p1.x * (p2.y - p3.y) +
     p2.x * (p3.y - p1.y) +
     p3.x * (p1.y - p2.y));

  const A  = area(a, b, c);
  const A1 = area(p, b, c);
  const A2 = area(a, p, c);
  const A3 = area(a, b, p);

  const hasNeg = (A1 < 0) || (A2 < 0) || (A3 < 0);
  const hasPos = (A1 > 0) || (A2 > 0) || (A3 > 0);

  return !(hasNeg && hasPos);
}


function projectToSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLen2 = abx * abx + aby * aby;
  let t = (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

// Returns the closest point on the boundary of triangle (a,b,c) to point p.
// Always projects to the boundary even if p is inside the triangle —
// guaranteeing Tutte poles lie on the boundary.
function projectOntoTriangleBoundary(p, a, b, c) {
  const candidates = [
    projectToSegment(p, a, b),
    projectToSegment(p, b, c),
    projectToSegment(p, c, a)
  ];
  let best = candidates[0];
  let bestDist = ptDist(p, candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    const d = ptDist(p, candidates[i]);
    if (d < bestDist) { bestDist = d; best = candidates[i]; }
  }
  return best;
}

/**
 * Find the centroid-triangle for a child's virtual edge in its
 * parent component.  Dispatches to type-specific logic.
 */
function findFaceTriangle(node, cuNum, cvNum, composed, posOverrides = null) {
  if (node.comp.type === 'R') {
    return findRNodeFaceTriangle(node, cuNum, cvNum, composed, posOverrides);
  }
  if (node.comp.type === 'S') {
    return findSNodeFaceTriangle(node, cuNum, cvNum, composed, posOverrides);
  }
  return null;
}

/**
 * R-node: find the non-outer face adjacent to the virtual edge,
 * then compute its centroid-triangle.
 *
 * If the VE borders two non-outer faces, we pick the one whose
 * centroid-triangle has greater depth (more room for the child).
 */
function findRNodeFaceTriangle(node, cuNum, cvNum, composed, posOverrides = null) {
  if (!node._faces || !node._outerFace) return null;

  const outerSet = new Set(node._outerFace);
  const isOuter = (f) =>
    f.length === node._outerFace.length && f.every(v => outerSet.has(v));

  // Find faces adjacent to this edge
  const adjFaces = node._faces.filter(
    f => f.includes(cuNum) && f.includes(cvNum)
  );

  // Prefer non-outer faces
  const nonOuter = adjFaces.filter(f => !isOuter(f));

  let targetFace = null;
  if (nonOuter.length === 1) {
    targetFace = nonOuter[0];
  } else if (nonOuter.length >= 2) {
    // Pick the face with larger depth (more room)
    let bestDepth = -1;
    for (const face of nonOuter) {
      const tri = computeFaceTriangle(face, cuNum, cvNum, composed, posOverrides);
      if (tri && tri.depth > bestDepth) {
        bestDepth = tri.depth;
        targetFace = face;
      }
    }
  } else if (adjFaces.length > 0) {
    // Fallback: all adjacent faces are outer (shouldn't normally happen)
    targetFace = adjFaces[0];
  }

  if (!targetFace) return null;

  if (DEBUG) {
    dbg(`    R-face for [${cuNum},${cvNum}]: [${targetFace.join(',')}] (from ${adjFaces.length} adj, ${nonOuter.length} non-outer)`);
  }

  return computeFaceTriangle(targetFace, cuNum, cvNum, composed, posOverrides);
}

/**
 * S-node: the interior face is the full cycle polygon.
 * All children go into the interior (centroid side).
 */
function findSNodeFaceTriangle(node, cuNum, cvNum, composed, posOverrides = null) {
  const cycle = node._cycleOrder;
  if (!cycle || cycle.length < 3) return null;

  if (DEBUG) {
    dbg(`    S-cycle face for [${cuNum},${cvNum}]: [${cycle.join(',')}]`);
  }

  return computeFaceTriangle(cycle, cuNum, cvNum, composed, posOverrides);
}

// ═══════════════════════════════════════════════════════════════════
//  REAL EDGE COLLECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Collect all *real* (non-virtual) edges from the SPQR components.
 * Virtual edges are replaced by the child structures during composition,
 * so we only want the real skeleton edges.
 */
function collectRealEdges(spqrTree) {
  const edgeSet = new Set();
  const edges = [];

  for (const comp of spqrTree) {
    // Build virtual edge lookup
    const virtualSet = new Set();
    for (const ve of comp.virtualEdgeEntry) {
      const [a, b] = ve[0];
      virtualSet.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
    }

    // Collect real edges
    for (const [v, nbrs] of comp.graph) {
      if (!nbrs) continue;
      for (const w of nbrs) {
        if (!comp.graph.has(w)) continue;
        const a = Math.min(Number(v), Number(w));
        const b = Math.max(Number(v), Number(w));
        const key = `${a}-${b}`;

        if (!virtualSet.has(key) && !edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: a, target: b });
        }
      }
    }
  }

  return edges;
}

// ═══════════════════════════════════════════════════════════════════
//  SCALING
// ═══════════════════════════════════════════════════════════════════

function scalePositionsToCanvas(positions, width, height, padding = 10) {
  if (positions.size === 0) return positions;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(
    (width - 2 * padding) / rangeX,
    (height - 2 * padding) / rangeY
  );

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const out = new Map();
  for (const [v, { x, y }] of positions) {
    out.set(v, {
      x: width / 2 + (x - cx) * scale,
      y: height / 2 + (y - cy) * scale,
    });
  }
  return out;
}

/**
 * Apply the same translate+scale as scalePositionsToCanvas to region
 * polygon points — uses the bounding box of *positions* (not regions)
 * so the transform matches exactly.
 */
function scaleRegions(regions, positions, width, height, padding = 10) {
  if (positions.size === 0 || regions.length === 0) return [];

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(
    (width - 2 * padding) / rangeX,
    (height - 2 * padding) / rangeY
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return regions.map(r => {
    if (r.type === 'cone-intersection' && r.point) {
      return {
        ...r,
        point: {
          x: width / 2 + (r.point.x - cx) * scale,
          y: height / 2 + (r.point.y - cy) * scale,
        },
      };
    }
    return {
      ...r,
      points: r.points.map(p => ({
        x: width / 2 + (p.x - cx) * scale,
        y: height / 2 + (p.y - cy) * scale,
      })),
    };
  });
}

function scaleEdgeRoutes(edgeRoutes, positions, width, height, padding = 10) {
  if (positions.size === 0 || !edgeRoutes || edgeRoutes.size === 0) return new Map();

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(
    (width - 2 * padding) / rangeX,
    (height - 2 * padding) / rangeY
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const out = new Map();
  for (const [key, route] of edgeRoutes) {
    out.set(key, {
      ...route,
      control: route.control ? {
        x: width / 2 + (route.control.x - cx) * scale,
        y: height / 2 + (route.control.y - cy) * scale,
      } : null,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
//  EMBEDDING SWITCHING  (future: Step 5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Mirror/flip an R-node's local drawing across the parent interface
 * axis (reflects y in canonical coords).
 * After calling, recompose from this node upward.
 */
export function flipRNode(node) {
  const comp = node?.comp ?? node;
  if (!comp || comp.type !== 'R') return false;
  comp.embeddingFlip = !comp.embeddingFlip;
  return comp.embeddingFlip;
}

/**
 * Permute the children of a P-node (reorder the lanes).
 * After calling, recompose from this node upward.
 * @param {Array<number>} perm – new ordering indices
 */
export function permutePChildren(node, perm) {
  const comp = node?.comp ?? node;
  if (!comp || comp.type !== 'P') return null;

  const childIds = [...(comp.embeddingChildOrder || comp.treeChildOrder || [])];
  const currentOrder = getActivePEmbeddingOrder(comp, childIds);
  if (currentOrder.length === 0) return null;
  if (!Array.isArray(perm) || perm.length !== currentOrder.length) return null;

  const nextOrder = perm.map(i => currentOrder[i]).filter(token => token != null);
  return setPEmbeddingOrder(comp, nextOrder);
}

export function setPEmbeddingOrder(node, order) {
  const comp = node?.comp ?? node;
  if (!comp || comp.type !== 'P') return null;

  const childIds = [...(comp.embeddingChildOrder || comp.treeChildOrder || [])];
  const currentOrder = getActivePEmbeddingOrder(comp, childIds);
  if (currentOrder.length === 0) return null;

  const sanitized = sanitizePEmbeddingOrder(comp, order, childIds);
  if (!sanitized || sanitized.length !== currentOrder.length) {
    return null;
  }

  comp.embeddingPOrder = sanitized;
  comp.embeddingChildOrder = sanitized.filter(token => token !== P_REAL_EDGE_SLOT);
  return [...comp.embeddingPOrder];
}

export function getPEmbeddingOrder(node) {
  const comp = node?.comp ?? node;
  if (!comp || comp.type !== 'P') return null;

  const childIds = [...(comp.embeddingChildOrder || comp.treeChildOrder || [])];
  const order = getActivePEmbeddingOrder(comp, childIds);
  return order.length > 0 ? [...order] : null;
}

// ═══════════════════════════════════════════════════════════════════
//  DEBUG
// ═══════════════════════════════════════════════════════════════════

function logTree(node, depth) {
  const indent = '  '.repeat(depth);
  const parentEdge = node._parentVirtualEdge
    ? `parent=[${node._parentVirtualEdge.join(',')}]`
    : 'ROOT';
  const childEdges = node._childVirtualEdges
    .map(ce => `[${ce.edge.join(',')}]→${ce.childNode.id}`)
    .join(', ');
  dbg(
    `${indent}${node.id} (${node.comp.type}, w=${node.weight}) ${parentEdge}` +
    (childEdges ? `  children: ${childEdges}` : '')
  );
  for (const child of node.children) {
    logTree(child, depth + 1);
  }
}