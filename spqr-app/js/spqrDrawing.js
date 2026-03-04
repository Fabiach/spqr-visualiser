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
 *       Tutte barycentric embedding if planar, else force-directed.
 *
 *   S (series / cycle):
 *       Elliptical layout, elongated perpendicular to the parent
 *       interface axis.
 *
 *   P (parallel / multi-edge):
 *       Two poles placed at canonical positions; children fanned out
 *       in lanes above and below the pole axis, drawn as curves.
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
import { extractFaces, findLargestFace, scaleToBox } from './tutte.js';

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Enable detailed console debugging. */
const DEBUG = true;

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

/** How many force-directed ticks for non-planar R-nodes. */
const FORCE_TICKS = 300;

/** Minimum spacing factor for child drawings inside P-node lanes. */
const P_LANE_SPREAD = 0.35;

/** S-node ellipse aspect ratio (perpendicular / parallel to interface). */
const S_ELLIPSE_RATIO = 1.6;

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

  // Build tree
  const tree = buildParentChildTree(spqrRoot, spqrTree, virtualEdgeData);

  // Weights
  estimateWeights(tree.root);

  // Log the tree for debugging
  logTree(tree.root, 0);

  // Top-down composition: root gets canvas-scale allocation.
  // P-root: poles at top-center and bottom-center, children fan horizontally.
  // S/R-root: local drawing scaled to fill canvas (handled inside composeTopDown);
  //           targetU/targetV are ignored for root S/R nodes.
  const rootType = tree.root.comp.type;
  let rootTargetU, rootTargetV;
  if (rootType === 'P') {
    rootTargetU = { x: canvasW / 2, y: canvasH * 0.08 };
    rootTargetV = { x: canvasW / 2, y: canvasH * 0.92 };
  } else {
    // Placeholder — root S/R scaling is handled inside composeTopDown
    rootTargetU = { x: canvasW * 0.15, y: canvasH / 2 };
    rootTargetV = { x: canvasW * 0.85, y: canvasH / 2 };
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

  return { positions: scaled, edges, tree };
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
//  WEIGHT ESTIMATION  (bottom-up)
// ═══════════════════════════════════════════════════════════════════

/**
 * Post-order traversal assigning a subtree weight to each node.
 * Weight approximates how much "visual space" a subtree needs.
 */
function estimateWeights(node) {
  let childWeightSum = 0;
  for (const child of node.children) {
    estimateWeights(child);
    childWeightSum += child.weight;
  }

  const V = node.comp.graph ? node.comp.graph.size : 2;

  switch (node.comp.type) {
    case 'S':
      node.weight = V + childWeightSum;
      break;
    case 'P':
      node.weight = Math.max(V, childWeightSum);
      break;
    case 'R':
      node.weight = V + childWeightSum;
      break;
    default:
      node.weight = V + childWeightSum;
  }
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
//  R-NODE: Tutte embedding or force-directed fallback
// ─────────────────────────────────────────────────────────────────

function drawRLocal(node, virtualEdgeData, spqrTree) {
  const comp = node.comp;
  const positions = new Map();

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
          faces, comp, node._parentVirtualEdge
        );
        // Store for face-bounded child allocation during composition
        node._faces = faces;
        node._outerFace = outerFace;
        if (DEBUG) dbg('Outer face chosen:', outerFace);

        if (outerFace && outerFace.length >= 3) {
          // Root R-node: regular polygon so the natural shape
          // (e.g. equilateral triangle for K4) is preserved.
          // Non-root: dampened weight-proportional polygon so
          // heavy children get more room without extreme distortion.
          const isRootNode = !node._parentVirtualEdge;
          const outerFacePositions = isRootNode
            ? regularPolygonPositions(outerFace)
            : computeWeightedOuterFace(outerFace, node, subgraph.size);
          const tuttePos = tutteEmbeddingWithPositions(
            subgraph, outerFace, outerFacePositions
          );
          const maxDim = 2 + subgraph.size * 0.3;
          const scaled = scaleToBox(tuttePos, maxDim, maxDim, 0.1);

          for (const [v, pos] of scaled) {
            positions.set(Number(v), { x: pos.x, y: pos.y });
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
    dbgWarn(`R-node ${comp.id}: Tutte failed, using force layout.`, e);
  }

  if (DEBUG) {
    dbg('⚠️ Falling back to force-directed layout');
    dbgGroupEnd();
  }
  return forceDirectedLayout(subgraph);
}

/**
 * Choose the best outer face for the Tutte embedding used in
 * the composed drawing.
 */
function selectOuterFaceForDrawing(faces, comp, parentVirtualEdge) {
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

  // 1. Prefer face containing parent virtual edge
  if (parentVirtualEdge) {
    const [pu, pv] = parentVirtualEdge.map(Number);
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
 * Compute positions for the outer face vertices of an R-node Tutte
 * embedding, giving more perimeter to edges with heavier children.
 * Weights are dampened with sqrt to avoid extreme distortion.
 *
 * Returns a Map<vertex, {x, y}> for each outer face vertex.
 */
function computeWeightedOuterFace(outerFace, node, graphSize) {
  const nBoundary = outerFace.length;

  // Build edge → child weight map from all child virtual edges
  const childWeightForEdge = new Map();
  for (const { edge, childNode } of node._childVirtualEdges) {
    const [eu, ev] = edge;
    childWeightForEdge.set(`${eu}-${ev}`, childNode.weight);
    childWeightForEdge.set(`${ev}-${eu}`, childNode.weight);
  }

  // Compute weight for each edge of the outer face.
  // Use sqrt dampening: raw weights [1, 10, 1] → [1, 3.16, 1]
  // so heavy children get more space without obliterating the shape.
  const BASE = 1;
  const edgeWeights = [];
  let totalWeight = 0;
  for (let i = 0; i < nBoundary; i++) {
    const u = outerFace[i];
    const v = outerFace[(i + 1) % nBoundary];
    const key = `${u}-${v}`;
    const raw = childWeightForEdge.get(key) || BASE;
    const w = Math.sqrt(raw);
    edgeWeights.push(w);
    totalWeight += w;
  }

  // Compute vertex angles as cumulative edge allocations
  const angles = new Array(nBoundary);
  angles[0] = -Math.PI / 2;  // start at top, same as tutteEmbedding default
  for (let i = 1; i < nBoundary; i++) {
    angles[i] = angles[i - 1]
      + (edgeWeights[i - 1] / totalWeight) * 2 * Math.PI;
  }

  const positions = new Map();
  for (let i = 0; i < nBoundary; i++) {
    positions.set(outerFace[i], {
      x: Math.cos(angles[i]),
      y: Math.sin(angles[i]),
    });
  }

  if (DEBUG) {
    const allSame = edgeWeights.every(w => w === edgeWeights[0]);
    if (!allSame) {
      dbg('R-node weighted outer face:',
        edgeWeights.map((w, i) =>
          `${outerFace[i]}→${outerFace[(i+1)%nBoundary]}: w=${w}`
        ).join(', '));
    }
  }

  return positions;
}

/**
 * Tutte embedding that uses pre-computed outer face positions
 * (for weight-proportional polygon) instead of a regular polygon.
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

/**
 * Simple force-directed layout for non-planar R-components.
 * Uses D3 force simulation run synchronously.
 */
function forceDirectedLayout(subgraph) {
  const nodes = [];
  const nodeIndex = new Map();
  let idx = 0;
  for (const v of subgraph.keys()) {
    nodeIndex.set(v, idx);
    nodes.push({ id: v, index: idx, x: Math.random() * 2, y: Math.random() * 2 });
    idx++;
  }

  const links = [];
  const seen = new Set();
  for (const [v, nbrs] of subgraph) {
    for (const w of nbrs) {
      const key = Math.min(v, w) + '-' + Math.max(v, w);
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: nodeIndex.get(v), target: nodeIndex.get(w) });
      }
    }
  }

  // Run a quick spring-embedder
  const k = Math.sqrt(4.0 / nodes.length); // optimal distance
  for (let iter = 0; iter < FORCE_TICKS; iter++) {
    const temperature = 2.0 * (1 - iter / FORCE_TICKS);

    // Repulsive forces (all pairs)
    const disp = nodes.map(() => ({ dx: 0, dy: 0 }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        let force = (k * k) / dist;
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;
        disp[i].dx += fx;
        disp[i].dy += fy;
        disp[j].dx -= fx;
        disp[j].dy -= fy;
      }
    }

    // Attractive forces (edges)
    for (const { source, target } of links) {
      let dx = nodes[source].x - nodes[target].x;
      let dy = nodes[source].y - nodes[target].y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      let force = (dist * dist) / k;
      let fx = (dx / dist) * force;
      let fy = (dy / dist) * force;
      disp[source].dx -= fx;
      disp[source].dy -= fy;
      disp[target].dx += fx;
      disp[target].dy += fy;
    }

    // Apply displacements with temperature cooling
    for (let i = 0; i < nodes.length; i++) {
      const dLen = Math.sqrt(disp[i].dx ** 2 + disp[i].dy ** 2) || 0.001;
      const capped = Math.min(dLen, temperature);
      nodes[i].x += (disp[i].dx / dLen) * capped;
      nodes[i].y += (disp[i].dy / dLen) * capped;
    }
  }

  const positions = new Map();
  for (const n of nodes) {
    positions.set(n.id, { x: n.x, y: n.y });
  }
  return positions;
}

// ─────────────────────────────────────────────────────────────────
//  S-NODE: Elliptical layout
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

  // ── Weight-proportional angular allocation ────────────────────
  // Each edge of the cycle gets angular space proportional to the
  // weight of the child subtree behind it (virtual edges), or a
  // base weight of 1 (real edges / parent virtual edge).
  // This gives heavy children more room so they don't overlap.

  const childWeightForEdge = new Map();
  for (const { edge, childNode } of node._childVirtualEdges) {
    const [eu, ev] = edge;
    childWeightForEdge.set(`${eu}-${ev}`, childNode.weight);
    childWeightForEdge.set(`${ev}-${eu}`, childNode.weight);
  }

  const BASE_EDGE_WEIGHT = 1;
  const edgeWeights = [];
  let totalEdgeWeight = 0;
  for (let i = 0; i < n; i++) {
    const u = ordered[i];
    const v = ordered[(i + 1) % n];
    const key = `${u}-${v}`;
    const raw = childWeightForEdge.get(key) || BASE_EDGE_WEIGHT;
    const w = Math.sqrt(raw);  // dampened to avoid extreme distortion
    edgeWeights.push(w);
    totalEdgeWeight += w;
  }

  // Compute vertex angles as cumulative edge allocations
  const vertexAngles = new Array(n);
  vertexAngles[0] = 0;
  for (let i = 1; i < n; i++) {
    vertexAngles[i] = vertexAngles[i - 1]
      + (edgeWeights[i - 1] / totalEdgeWeight) * 2 * Math.PI;
  }

  if (DEBUG) {
    dbg('Edge weights:', edgeWeights.map((w, i) =>
      `${ordered[i]}→${ordered[(i+1)%n]}: ${w}`).join(', '));
    dbg('Vertex angles (deg):', vertexAngles.map(a => (a * 180 / Math.PI).toFixed(1)));
  }

  // Place on ellipse using weight-proportional angles
  const rx = 1.0;
  const ry = rx * S_ELLIPSE_RATIO;

  for (let i = 0; i < n; i++) {
    const angle = (n <= 2) ? i * Math.PI : vertexAngles[i];
    const v = ordered[i];
    positions.set(Number(v), {
      x: rx * Math.cos(angle),
      y: ry * Math.sin(angle),
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
//  COMPOSITION  (top-down)
// ═══════════════════════════════════════════════════════════════════

/**
 * Top-down (pre-order) composition.
 *
 * The PARENT decides how much world-space each child gets, then
 * the child draws itself into that allocated slot.  This gives the
 * "most central" node (root) full control of the layout, and
 * ensures that heavy subtrees get proportionally more room.
 *
 * @param {Object}  node           – tree node to compose
 * @param {{x,y}}   targetU        – world position for canonical (0,0)
 * @param {{x,y}}   targetV        – world position for canonical (1,0)
 * @param {Map}     virtualEdgeData
 * @param {Array}   spqrTree
 * @param {boolean} flip           – if true, mirror Y in canonical space
 *                                   (used for S-cycle outward expansion)
 */
function composeTopDown(node, targetU, targetV, virtualEdgeData, spqrTree,
                       flip = false, canvasW = 1000, canvasH = 1000) {

  const poleDist = Math.sqrt(
    (targetV.x - targetU.x) ** 2 + (targetV.y - targetU.y) ** 2
  ) || 1;

  if (DEBUG) {
    dbgGroup(`⚙️ COMPOSE (↓ top-down): ${node.id} (${node.comp.type}, w=${node.weight}) alloc=${poleDist.toFixed(1)}${flip ? ' FLIP' : ''}`);
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

  // ── 3. Apply S-node flip if needed ───────────────────────────
  if (flip) {
    canonicalPos = flipCanonicalY(canonicalPos);
    if (DEBUG) dbg('↕️ Flipped canonical Y (S-cycle outward)');
  }

  // ── 4. Map to world coordinates ──────────────────────────────
  //    Root S/R: scale the local drawing (ellipse / Tutte) uniformly
  //    to fill the canvas, preserving its natural proportions.
  //    Everything else: affine from canonical via targetU/targetV.
  let composed;
  const isRoot = !node._parentVirtualEdge;

  if (isRoot && node.comp.type !== 'P') {
    const ROOT_PADDING = 60;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const { x, y } of canonicalPos.values()) {
      if (x < minX) minX = x;  if (x > maxX) maxX = x;
      if (y < minY) minY = y;  if (y > maxY) maxY = y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rootScale = Math.min(
      (canvasW - 2 * ROOT_PADDING) / rangeX,
      (canvasH - 2 * ROOT_PADDING) / rangeY
    );
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
      dbg(`Root ${node.comp.type}: scaled to canvas (scale=${rootScale.toFixed(2)}, padding=${ROOT_PADDING}, bbox=${rangeX.toFixed(2)}×${rangeY.toFixed(2)})`);
    }
  } else {
    const worldPos = applyAffineFromCanonical(canonicalPos, targetU, targetV);
    composed = new Map(worldPos);
  }

  // ── 5. Process children ──────────────────────────────────────
  if (node.comp.type === 'P') {
    // ┌──────────────────────────────────────────────────────────┐
    // │  P-NODE: STRIP-BASED COMPOSITION                        │
    // │                                                         │
    // │  Each child composes its full subtree in its own         │
    // │  canonical space, then is uniformly scaled to fit a      │
    // │  non-overlapping strip perpendicular to the pole axis.   │
    // │  This guarantees siblings don't overlap and each         │
    // │  subtree gets space proportional to its weight.          │
    // └──────────────────────────────────────────────────────────┘

    // Sort children by weight (heaviest first)
    const sorted = [...node._childVirtualEdges].sort(
      (a, b) => b.childNode.weight - a.childNode.weight
    );

    // Pole axis direction and perpendicular
    const dx = targetV.x - targetU.x;
    const dy = targetV.y - targetU.y;
    const axisX = dx / poleDist;
    const axisY = dy / poleDist;
    const perpX = -axisY;     // perpendicular unit vector
    const perpY =  axisX;

    // Total perpendicular extent: how far children can spread
    // from the pole axis.
    // ROOT: use the actual canvas dimension perpendicular to the axis
    //       so strips fill the canvas without scalePositionsToCanvas
    //       compressing them.
    // NON-ROOT: use a ratio of the pole distance.
    const isRoot = !node._parentVirtualEdge;
    let totalPerpExtent;
    if (isRoot) {
      const PADDING = 40;
      // Which canvas dimension is perpendicular to the pole axis?
      const perpCanvas = Math.abs(perpX) > Math.abs(perpY)
        ? canvasW - 2 * PADDING
        : canvasH - 2 * PADDING;
      totalPerpExtent = perpCanvas;
    } else {
      const PERP_RATIO = 1.0;
      totalPerpExtent = poleDist * PERP_RATIO;
    }
    const totalWeight = sorted.reduce((s, ce) => s + ce.childNode.weight, 0) || 1;
    const STRIP_GAP_FRAC = 0.03; // 3% of total extent as gap between strips
    const gapSize = totalPerpExtent * STRIP_GAP_FRAC;
    const usableExtent = totalPerpExtent - gapSize * Math.max(0, sorted.length - 1);

    if (DEBUG) {
      dbg(`P-node strips: poleDist=${poleDist.toFixed(1)}, perpExtent=${totalPerpExtent.toFixed(1)}, ${sorted.length} children`);
      sorted.forEach(ce => dbg(`  ${ce.childNode.id}: w=${ce.childNode.weight}`));
    }

    // Greedy strip allocation: place next-heaviest child on the
    // side (left/right of pole axis) with less total width so far.
    // This balances the visual weight across both sides.
    const leftItems = [];   // items going to left (negative perp)
    const rightItems = [];  // items going to right (positive perp)
    for (let i = 0; i < sorted.length; i++) {
      const ce = sorted[i];
      const w = ce.childNode.weight;
      const stripW = usableExtent * (w / totalWeight);
      const sumL = leftItems.reduce((s, it) => s + it.stripW, 0);
      const sumR = rightItems.reduce((s, it) => s + it.stripW, 0);
      if (sumR <= sumL) {
        rightItems.push({ ce, stripW });
      } else {
        leftItems.push({ ce, stripW });
      }
    }

    // Lay out left items (negative perpendicular direction)
    // leftItems go from axis outward (first item closest to axis)
    const flipMul = flip ? -1 : 1;
    let cum = 0;
    const stripPlacements = [];
    for (const { ce, stripW } of rightItems) {
      const perpCenter = flipMul * (cum + stripW / 2);
      cum += stripW + gapSize;
      stripPlacements.push({ ce, stripW, perpCenter });
    }
    cum = 0;
    for (const { ce, stripW } of leftItems) {
      const perpCenter = flipMul * (-(cum + stripW / 2));
      cum += stripW + gapSize;
      stripPlacements.push({ ce, stripW, perpCenter });
    }

    // Pole midpoint in world space
    const midX = (targetU.x + targetV.x) / 2;
    const midY = (targetU.y + targetV.y) / 2;

    for (const { ce, stripW, perpCenter } of stripPlacements) {
      const child = ce.childNode;
      const [cu, cv] = ce.edge;

      // 1. Compose child in its own canonical space
      composeTopDown(child, { x: 0, y: 0 }, { x: 1, y: 0 },
                     virtualEdgeData, spqrTree, false, canvasW, canvasH);

      // 2. Get bounding box of child's composed positions
      const childPositions = child._composedPositions;
      let minCX = Infinity, maxCX = -Infinity;
      let minCY = Infinity, maxCY = -Infinity;
      for (const { x, y } of childPositions.values()) {
        if (x < minCX) minCX = x;
        if (x > maxCX) maxCX = x;
        if (y < minCY) minCY = y;
        if (y > maxCY) maxCY = y;
      }
      const canonW = maxCX - minCX || 1;
      const canonH = maxCY - minCY || 1;

      // 3. Compute uniform scale to fit child into its strip.
      //    Strip dimensions: poleDist × stripW.
      //    Canonical x (along poles) maps to poleDist.
      //    Canonical y (perpendicular) maps to stripW.
      const STRIP_MARGIN = 0.85; // use 85% of strip to leave margin
      const scaleAlong = (poleDist * STRIP_MARGIN) / canonW;
      const scalePerp  = (stripW * STRIP_MARGIN) / canonH;
      const scale = Math.min(scaleAlong, scalePerp);

      // 4. Canonical center
      const ccx = (minCX + maxCX) / 2;
      const ccy = (minCY + maxCY) / 2;

      // 5. Transform each position:
      //    - Center canonical at origin
      //    - Scale uniformly
      //    - Rotate: canonical x → pole axis, canonical y → perp
      //    - Translate to pole midpoint + perpendicular offset
      let added = 0;
      for (const [vid, pos] of childPositions) {
        if (vid === Number(cu) || vid === Number(cv)) continue;
        const relAlongAxis = (pos.x - ccx) * scale;
        const relPerp = (pos.y - ccy) * scale;
        composed.set(vid, {
          x: midX + axisX * relAlongAxis + perpX * (relPerp + perpCenter),
          y: midY + axisY * relAlongAxis + perpY * (relPerp + perpCenter),
        });
        added++;
      }

      if (DEBUG) {
        dbg(`  Strip ${child.id}: w=${ce.childNode.weight}, stripW=${stripW.toFixed(1)}, perpCenter=${perpCenter.toFixed(1)}, scale=${scale.toFixed(3)}, bbox=[${canonW.toFixed(2)}×${canonH.toFixed(2)}], merged ${added} verts`);
      }
    }

  } else {
    // ┌──────────────────────────────────────────────────────────┐
    // │  S / R NODE: FACE-BOUNDED CHILD COMPOSITION             │
    // │                                                         │
    // │  Each child composes in its own canonical space, then    │
    // │  is uniformly scaled into a bounded region.              │
    // │  R-node parents: children are bounded by the face        │
    // │  geometry of the Tutte embedding (triangle constraint).  │
    // │  S-node parents: centroid-based direction with veDist    │
    // │  proportional allocation.                               │
    // └──────────────────────────────────────────────────────────┘

    // Centroid of the parent's own skeleton in world space.
    // Used as fallback direction for S-nodes and non-outer-face R VEs.
    let centroid = null;
    {
      let cx = 0, cy = 0, n = 0;
      for (const pos of composed.values()) {
        cx += pos.x; cy += pos.y; n++;
      }
      if (n > 0) centroid = { x: cx / n, y: cy / n };
    }

    for (const { edge, childNode } of node._childVirtualEdges) {
      const [cu, cv] = edge;
      const cuNum = Number(cu), cvNum = Number(cv);
      const childTargetU = composed.get(cuNum);
      const childTargetV = composed.get(cvNum);

      if (!childTargetU || !childTargetV) {
        dbgWarn(`compose: missing positions for ${cu}-${cv} in ${node.id}`);
        continue;
      }

      const veDist = Math.sqrt(
        (childTargetV.x - childTargetU.x) ** 2 +
        (childTargetV.y - childTargetU.y) ** 2
      ) || 1;

      if (DEBUG) {
        dbg(`  → ${childNode.id} via [${cu},${cv}]: veDist=${veDist.toFixed(1)}`);
      }

      // 1. Compose child in its own canonical space (VE at (0,0)→(1,0))
      composeTopDown(childNode, { x: 0, y: 0 }, { x: 1, y: 0 },
                     virtualEdgeData, spqrTree, false, canvasW, canvasH);

      const childPositions = childNode._composedPositions;

      // 2. Compute child's bounding box in canonical space
      let minCX = Infinity, maxCX = -Infinity;
      let minCY = Infinity, maxCY = -Infinity;
      for (const { x, y } of childPositions.values()) {
        if (x < minCX) minCX = x;
        if (x > maxCX) maxCX = x;
        if (y < minCY) minCY = y;
        if (y > maxCY) maxCY = y;
      }
      const canonW = maxCX - minCX || 1;
      const canonH = maxCY - minCY || 1;

      // 3. VE axis and perpendicular in world space
      const veAxisX = (childTargetV.x - childTargetU.x) / veDist;
      const veAxisY = (childTargetV.y - childTargetU.y) / veDist;
      const vePerpX = -veAxisY;
      const vePerpY =  veAxisX;

      // VE midpoint
      const veMidX = (childTargetU.x + childTargetV.x) / 2;
      const veMidY = (childTargetU.y + childTargetV.y) / 2;

      // 4. Determine child direction and face-bounded allocation.
      //
      //    R-NODE PARENT: use the Tutte embedding's face geometry.
      //      - Find the two faces adjacent to this VE.
      //      - If the VE is on the outer face, the child goes into
      //        the non-outer adjacent face (inward).
      //      - If the VE is not on the outer face, pick the face
      //        on the centroid-away side.
      //      - Compute the face's perpendicular depth from the VE
      //        and use it to bound the child's allocation.
      //      - Apply a triangle-inscribed constraint so the child
      //        fits within the (potentially triangular) face.
      //
      //    S-NODE PARENT: centroid-based direction, veDist-proportional.

      let childDir = 1;      // perpendicular direction for child placement
      let faceDepth = null;  // perpendicular depth of target face (R-nodes)

      if (node.comp.type === 'R' && node._faces && node._outerFace) {
        // Find faces adjacent to this VE
        const adjFaces = node._faces.filter(
          f => f.includes(cuNum) && f.includes(cvNum)
        );

        // Identify the outer face among adjacents
        const outerSet = new Set(node._outerFace);
        const isOuterFace = (f) =>
          f.length === node._outerFace.length && f.every(v => outerSet.has(v));

        // Pick the child face:
        //  - If one adjacent face is the outer face, pick the other.
        //  - If neither is the outer face, use centroid to choose.
        let childFace = null;
        const nonOuterFaces = adjFaces.filter(f => !isOuterFace(f));

        if (nonOuterFaces.length === 1) {
          childFace = nonOuterFaces[0];
        } else if (nonOuterFaces.length >= 2) {
          // Both faces are non-outer — pick the one away from centroid
          if (centroid) {
            const crossCentroid =
              (childTargetV.x - childTargetU.x) * (centroid.y - childTargetU.y) -
              (childTargetV.y - childTargetU.y) * (centroid.x - childTargetU.x);
            const awaySign = crossCentroid >= 0 ? -1 : 1;
            for (const face of nonOuterFaces) {
              for (const fv of face) {
                if (fv === cuNum || fv === cvNum) continue;
                const fvPos = composed.get(fv);
                if (!fvPos) continue;
                const sd = vePerpX * (fvPos.x - childTargetU.x)
                         + vePerpY * (fvPos.y - childTargetU.y);
                if ((awaySign > 0 && sd > 0) || (awaySign < 0 && sd < 0)) {
                  childFace = face;
                }
                break;
              }
            }
          }
          if (!childFace) childFace = nonOuterFaces[0];
        }

        // Compute face depth and direction from the child face's vertices
        if (childFace) {
          for (const fv of childFace) {
            if (fv === cuNum || fv === cvNum) continue;
            const fvPos = composed.get(fv);
            if (!fvPos) continue;
            const sd = vePerpX * (fvPos.x - childTargetU.x)
                     + vePerpY * (fvPos.y - childTargetU.y);
            const dist = Math.abs(sd);
            if (faceDepth === null || dist > faceDepth) faceDepth = dist;
            // Direction is determined by the face vertex position
            childDir = sd >= 0 ? 1 : -1;
          }
        }

        if (DEBUG) {
          dbg(`    R-face: childFace=[${childFace}], faceDepth=${faceDepth?.toFixed(1) ?? 'N/A'}, childDir=${childDir}`);
        }
      } else {
        // S-node parent: centroid-based direction
        if (centroid) {
          const crossCentroid =
            (childTargetV.x - childTargetU.x) * (centroid.y - childTargetU.y) -
            (childTargetV.y - childTargetU.y) * (centroid.x - childTargetU.x);
          childDir = crossCentroid >= 0 ? -1 : 1;
        }
      }

      // 5. Compute allocation and scale
      const SR_CHILD_MARGIN = 0.80;
      const allocAlong = veDist;
      let allocPerp;
      if (faceDepth !== null && faceDepth > 0) {
        allocPerp = faceDepth;
      } else {
        // S-node or fallback: proportional to veDist
        allocPerp = veDist * 0.5;
      }

      let scaleAlong = (allocAlong * SR_CHILD_MARGIN) / canonW;
      let scalePerp  = (allocPerp * SR_CHILD_MARGIN) / canonH;
      let scale = Math.min(scaleAlong, scalePerp);

      // Triangle-inscribed constraint for face-bounded allocation:
      // A triangular face with base b (VE length) and height h (face depth)
      // narrows linearly. At depth d, width = b*(1 - d/h).
      // The child rectangle (along=canonW*s, perp=canonH*s) must fit:
      //   canonW*s ≤ b*(1 - canonH*s/h)
      //   → s ≤ b*MARGIN / (canonW + b*canonH/h)
      if (faceDepth !== null && faceDepth > 0) {
        const triScale = (allocAlong * SR_CHILD_MARGIN) /
          (canonW + allocAlong * canonH / faceDepth);
        scale = Math.min(scale, triScale);
      }

      // 6. Canonical center
      const ccx = (minCX + maxCX) / 2;
      const ccy = (minCY + maxCY) / 2;

      // 7. Determine perpendicular flip
      //    Child's canonical positive-y should map to childDir direction.
      let childCanonCOMy = 0;
      let childCanonCount = 0;
      for (const [vid, pos] of childPositions) {
        if (vid === cuNum || vid === cvNum) continue;
        childCanonCOMy += pos.y;
        childCanonCount++;
      }
      if (childCanonCount > 0) childCanonCOMy /= childCanonCount;

      const canonExpandSign = childCanonCOMy >= 0 ? 1 : -1;
      const perpFlip = canonExpandSign * childDir < 0 ? -1 : 1;

      // 8. Perpendicular offset: position child so it starts at the VE
      //    and extends into the face/outward direction.
      const actualPerpExtent = canonH * scale;
      const perpOffset = childDir * actualPerpExtent * 0.5;

      if (DEBUG) {
        dbg(`    alloc: along=${allocAlong.toFixed(1)}, perp=${allocPerp.toFixed(1)}, scale=${scale.toFixed(4)}, childDir=${childDir}, perpFlip=${perpFlip}, perpOffset=${perpOffset.toFixed(1)}`);
      }

      // 9. Transform each position:
      //    - Center canonical at (ccx, ccy)
      //    - Scale uniformly
      //    - Rotate: canonical-x → VE axis, canonical-y → VE perp (with flip)
      //    - Translate to VE midpoint + perpendicular offset
      let added = 0;
      for (const [vid, pos] of childPositions) {
        if (vid === cuNum || vid === cvNum) continue;
        const relAlong = (pos.x - ccx) * scale;
        const relPerp  = (pos.y - ccy) * scale * perpFlip;
        composed.set(vid, {
          x: veMidX + veAxisX * relAlong + vePerpX * (relPerp + perpOffset),
          y: veMidY + veAxisY * relAlong + vePerpY * (relPerp + perpOffset),
        });
        added++;
      }
      if (DEBUG) dbg(`  Merged ${added} verts from ${childNode.id}`);
    }
  }

  if (DEBUG) {
    dbg(`Done ${node.id}: ${composed.size} vertices`);
    dbgGroupEnd();
  }

  node._composedPositions = composed;
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

// ═══════════════════════════════════════════════════════════════════
//  EMBEDDING SWITCHING  (future: Step 5)
// ═══════════════════════════════════════════════════════════════════

/**
 * Mirror/flip an R-node's local drawing across the parent interface
 * axis (reflects y in canonical coords).
 * After calling, recompose from this node upward.
 */
export function flipRNode(node) {
  if (!node._localPositions) return;
  for (const [v, pos] of node._localPositions) {
    pos.y = -pos.y;
  }
}

/**
 * Permute the children of a P-node (reorder the lanes).
 * After calling, recompose from this node upward.
 * @param {Array<number>} perm – new ordering indices
 */
export function permutePChildren(node, perm) {
  if (node.comp.type !== 'P') return;
  const old = [...node._childVirtualEdges];
  node._childVirtualEdges = perm.map(i => old[i]);
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
