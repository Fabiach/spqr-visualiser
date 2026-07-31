/**
 * spqrDrawing.js — Compute a drawing/embedding of the original graph
 *                  from its SPQR tree, by allocating space to components top-down.
 *
 * Algorithm: top-down (pre-order). Root gets full canvas. Each component draws
 * itself in its allocated region, then allocates exclusive sub-regions to children
 * based on virtual edge positions. Guarantees a planar, non-overlapping output.
 */

import { isPlanarAndEmbed } from './planarity.js';
import { extractFaces, findLargestFace, tutteEmbedding, scaleToBox } from './tutte.js';

// ─── Exports needed by main.js ───────────────────────────────────────────────

// The position of this token separates the children drawn on the two sides of
// the pole axis.  If the P skeleton contains a real pole edge, that edge lies
// on the divider; otherwise the token is a purely geometric control.
export const P_AXIS_SLOT = Symbol('P_AXIS_SLOT');

export function flipRNode(treeNode) {
  if (treeNode) treeNode.embeddingFlip = !treeNode.embeddingFlip;
}

export function getPEmbeddingOrder(treeNode) {
  return treeNode?.embeddingOrder ?? null;
}

export function setPEmbeddingOrder(treeNode, order) {
  if (!treeNode) return null;
  const normalized = Array.isArray(order) ? [...order] : null;
  treeNode.embeddingOrder = normalized;
  if (treeNode.comp) treeNode.comp.embeddingOrder = normalized;
  return normalized;
}

export function permutePChildren(treeNode, perm) {
  return setPEmbeddingOrder(treeNode, perm);
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * @param {object}  spqrRoot       Root SPQRComponent
 * @param {object[]}spqrTree       Array of all SPQRComponents
 * @param {Map}     virtualEdgeData  edgeID → {components:[id,id], nodes:[u,v]}
 * @param {number}  canvasW
 * @param {number}  canvasH
 * @returns {{
 *   positions: Map,
 *   edges: Array,
 *   tree: object,
 *   regions: Array,
 *   edgeRoutes: Map,
 *   componentPoses: Map
 * }}
 */
export function computeGraphDrawing(spqrRoot, spqrTree, virtualEdgeData, canvasW, canvasH, options = {}) {
  const positions = new Map();   // vertexId → {x, y}
  const edges     = [];          // {source, target, ownerCompId}
  const regions   = [];          // debug overlays

  _logLines = [];
  _resetInvariantState();
  _edgeRoutes = new Map();
  _usedPBandOpening = false;
  log(`=== computeGraphDrawing ===`);
  log(`Canvas: ${canvasW}×${canvasH} | components: ${spqrTree.length} | root: ${spqrRoot.id} (${spqrRoot.type})`);

  const rootNode = buildRootedTree(spqrRoot, spqrTree, virtualEdgeData);
  rootNode.preferredPoleOrder = Array.isArray(options.rootPoleOrder)
    ? [...options.rootPoleOrder]
    : null;
  rootNode.referencePositions = options.rootReferencePositions instanceof Map
    ? new Map(options.rootReferencePositions)
    : null;
  log(`Tree built. Root children: [${rootNode.children.map(c => `${c.comp.id}(${c.comp.type})`).join(', ')}]`);

  const rootRegion = { type: 'rect', x: 0, y: 0, w: canvasW, h: canvasH };
  drawSubtree(rootNode, rootRegion, null, null, positions, edges, regions);

  checkI2(_nodeRegions);
  checkI3(_nodeRegions, _vertexToNode, positions);
  if (_usedPBandOpening) {
    const violations = findRoutedDrawingPlanarityViolations(positions, edges, _edgeRoutes);
    if (violations.length > 0) {
      throw new Error(
        `Localized P-band opening postcondition failed: `
        + `${violations.length} planarity violation(s): `
        + JSON.stringify(violations.slice(0, 8))
      );
    }
  }
  log(`--- Done: positions=${positions.size}, edges=${edges.length}, regions=${regions.length} ---`);
  // Note: the diagnostic log is no longer auto-downloaded. Call downloadLog()
  // from the browser console if you need to save spqrDrawing.log for debugging.
  return {
    positions,
    edges,
    tree: rootNode,
    regions,
    edgeRoutes: _edgeRoutes,
    componentPoses: _componentPoses
  };
}

// ─── Log buffer + download export ────────────────────────────────────────────

let _logLines = [];
function log(msg) { _logLines.push(msg); }

// ─── Invariant-checking state (reset per computeGraphDrawing call) ────────────
export const CHECK_INVARIANTS = true;
const INV_TOL = 4.0; // pixel tolerance for boundary membership

let _vertexToNode = new Map(); // vertexId → treeNode that placed it (I3)
let _nodeRegions  = [];        // {node, region} — one per drawn component (I2/I3)
let _edgeRoutes   = new Map(); // undirected edge key → polyline route
let _componentPoses = new Map(); // componentId → semantic pictogram orientation data
let _usedPBandOpening = false;

function _resetInvariantState() {
  _vertexToNode = new Map();
  _nodeRegions  = [];
  _componentPoses = new Map();
}

function updateComponentPose(componentId, patch) {
  const current = _componentPoses.get(componentId) || { componentId };
  _componentPoses.set(componentId, { ...current, ...patch });
}

/** Call downloadLog() from the browser console to save spqrDrawing.log */
export function downloadLog() {
  const blob = new Blob([_logLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'spqrDrawing.log';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Logging helpers
function fmt(p)          { return p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : 'null'; }
function regionDesc(r) {
  if (!r) return 'null';
  if (r.type === 'rect') return `rect(${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}×${r.h.toFixed(0)})`;
  const pts = getRegionPoints(r);
  const bbox = regionBBox(r);
  return `poly(${pts.length}pts bbox=${bbox.minX.toFixed(0)},${bbox.minY.toFixed(0)}..${bbox.maxX.toFixed(0)},${bbox.maxY.toFixed(0)})`;
}

// ─── Tree building ────────────────────────────────────────────────────────────

function buildRootedTree(spqrRoot, spqrTree, virtualEdgeData) {
  const compById = new Map(spqrTree.map(c => [c.id, c]));

  // edge-lookup: "idA,idB" → {edgeId, nodes:[u,v]}
  const edgeBetween = new Map();
  for (const [edgeId, { components, nodes }] of virtualEdgeData) {
    const k1 = `${components[0]},${components[1]}`;
    const k2 = `${components[1]},${components[0]}`;
    edgeBetween.set(k1, { edgeId, nodes });
    edgeBetween.set(k2, { edgeId, nodes });
  }

  const rootNode = makeTreeNode(spqrRoot, null, null, null);
  const nodeById = new Map([[spqrRoot.id, rootNode]]);
  const queue    = [rootNode];
  const visited  = new Set([spqrRoot.id]);

  while (queue.length) {
    const treeNode = queue.shift();
    for (const nbr of (treeNode.comp.neighbors || [])) {
      if (visited.has(nbr.id)) continue;
      visited.add(nbr.id);
      const childComp = compById.get(nbr.id);
      if (!childComp) continue;
      const ei = edgeBetween.get(`${treeNode.comp.id},${nbr.id}`);
      const child = makeTreeNode(childComp, treeNode, ei?.edgeId ?? null, ei?.nodes ?? null);
      treeNode.children.push(child);
      nodeById.set(nbr.id, child);
      queue.push(child);
    }
  }
  return rootNode;
}

function makeTreeNode(comp, parent, parentEdgeId, parentEdgeNodes) {
  return {
    comp,
    parent,
    parentEdgeId,
    parentEdgeNodes,
    children: [],
    embeddingFlip: comp.embeddingFlip ?? false,
    embeddingOrder: Array.isArray(comp.embeddingOrder) ? [...comp.embeddingOrder] : null
  };
}

// ─── Edge classification ──────────────────────────────────────────────────────

function classifyEdges(comp, parentEdgeId) {
  const virtualPairSet = new Set();
  for (const [[u, v]] of comp.virtualEdgeEntry) {
    virtualPairSet.add(edgeKey(u, v));
    virtualPairSet.add(edgeKey(v, u));
  }

  let parentEdgeNodes = null;
  const childEdges = [];

  for (const [[u, v], id] of comp.virtualEdgeEntry) {
    if (id === parentEdgeId) {
      parentEdgeNodes = [u, v];
    } else {
      childEdges.push({ u, v, edgeId: id });
    }
  }

  const realEdges = [];
  const seenReal  = new Set();
  for (const [u, nbrs] of comp.graph) {
    if (!nbrs) continue;
    for (const v of nbrs) {
      const k = edgeKey(u, v);
      if (!virtualPairSet.has(k) && !seenReal.has(k)) {
        seenReal.add(k);
        seenReal.add(edgeKey(v, u));
        realEdges.push({ u, v });
      }
    }
  }

  return { parentEdgeNodes, childEdges, realEdges };
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

function drawSubtree(treeNode, region, anchorU, anchorV, positions, edges, regions) {
  const { comp } = treeNode;
  const parentEdgeId = treeNode.parentEdgeId;

  // Twin virtual edges may list the same two pole IDs in opposite orders. The
  // supplied geometric anchors follow the parent skeleton's order, whereas a
  // child must receive them in its own parent-edge order. Match the anchors to
  // the already placed pole vertices before the child writes those positions;
  // otherwise the child can silently exchange u and v for the whole subtree.
  if (anchorU && anchorV && treeNode.parentEdgeNodes?.length >= 2) {
    const [childUId, childVId] = treeNode.parentEdgeNodes;
    const placedU = positions.get(childUId);
    const placedV = positions.get(childVId);
    if (placedU && placedV) {
      const direct = dist(anchorU, placedU) + dist(anchorV, placedV);
      const swapped = dist(anchorU, placedV) + dist(anchorV, placedU);
      if (swapped + 1e-6 < direct) {
        [anchorU, anchorV] = [anchorV, anchorU];
      }
    }
  }

  const anchorStr = anchorU ? `anchors=(${fmt(anchorU)})→(${fmt(anchorV)})` : 'root';
  log(`\n[drawSubtree] ${comp.id}(${comp.type}) | parentEdge=${parentEdgeId ?? 'none'} | ${anchorStr}`);
  log(`  region: ${regionDesc(region)}`);

  // Add region overlay for debugging (main.js expects {type, points})
  const pts = getRegionPoints(region);
  if (pts.length >= 3) regions.push({ type: comp.type, points: pts, label: comp.id });
  _nodeRegions.push({ node: treeNode, region });
  updateComponentPose(comp.id, {
    type: comp.type,
    isRoot: !treeNode.parent,
    parentComponentId: treeNode.parent?.comp?.id ?? null,
    parentEdgeId,
    parentEdgeNodes: treeNode.parentEdgeNodes
      ? [...treeNode.parentEdgeNodes]
      : null,
    regionPoints: pts.map(point => ({ x: point.x, y: point.y }))
  });

  if (comp.type === 'S') {
    drawS(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions);
  } else if (comp.type === 'P') {
    drawP(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions);
  } else if (comp.type === 'R') {
    drawR(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions);
  }
}

// ─── S component ─────────────────────────────────────────────────────────────

function drawS(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions) {
  const { comp } = treeNode;
  const { parentEdgeNodes, childEdges, realEdges } = classifyEdges(comp, parentEdgeId);

  // ── Root S: no anchor → regular polygon on circle ────────────────────────
  if (!anchorU) {
    const path = chooseRootCycleOrder(
      traverseFullCycle(comp.graph),
      treeNode.referencePositions
    );
    updateComponentPose(comp.id, { cycleOrder: [...path] });
    const n    = path.length;
    const bbox = regionBBox(region);
    const cx   = (bbox.minX + bbox.maxX) / 2;
    const cy   = (bbox.minY + bbox.maxY) / 2;
    // Radius r = 1/4 of the smaller canvas dimension, matching spec r = 1/4.
    // First vertex is fixed at the north (angle = -π/2), placing it at (cx, cy-r),
    // consistent with the spec anchor point (½, ½+¼) at the top of the circle.
    const r = Math.min(bbox.w, bbox.h) * 0.25;
    const circleCenter = { x: cx, y: cy };
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;   // -π/2 = north for i=0
      positions.set(path[i], { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      log(`    vertex ${path[i]} (root polygon i=${i}) → (${fmt(positions.get(path[i]))})`);
    }
    recordAndCheckI1(treeNode, path, region, positions);
    for (const { u, v } of realEdges) {
      edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
      log(`    real edge ${u}–${v}`);
    }
    // Child regions per spec: inner △(posA, posB, circleCenter) ∪ outer △(posA, posB, apexOut)
    // where apexOut = reflection of circleCenter across the chord — a rhombus symmetric about the edge.
    const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
    for (const { u, v, edgeId } of childEdges) {
      const childNode = childByEdgeId.get(edgeId);
      if (!childNode) continue;
      const posA = positions.get(u);
      const posB = positions.get(v);
      if (!posA || !posB) { log(`  [S] WARN: missing positions for child edge ${u}-${v}`); continue; }
      // Outer region: project rays from region centroid through posA/posB to the region boundary.
      const outerArc = projectOuterRegion(region, posA, posB, circleCenter);
      const pts = outerArc ? [posA, circleCenter, posB, ...outerArc] : [posA, circleCenter, posB];
      log(`  [S] root child region: edge=${u}-${v} child=${childNode.comp.id}${outerArc ? ` outerArc(${outerArc.length} pts)` : ' (no outer arc)'}`);
      drawSubtree(childNode, { type: 'polygon', points: pts }, posA, posB, positions, edges, regions);
    }
    return;
  }

  // Determine poles (child S: anchored by parent)
  let poleU, poleV, poleUId, poleVId;
  if (parentEdgeNodes) {
    poleUId = parentEdgeNodes[0];
    poleVId = parentEdgeNodes[1];
    poleU = anchorU;
    poleV = anchorV;
    positions.set(poleUId, poleU);
    positions.set(poleVId, poleV);
    log(`  [S] child poles: u=${poleUId}@(${fmt(poleU)}) v=${poleVId}@(${fmt(poleV)})`);
  } else {
    // Fallback (should not happen for non-root)
    poleUId = comp.graph.keys().next().value;
    poleVId = findCycleMidpoint(comp.graph, poleUId);
    poleU = anchorU;
    poleV = anchorV;
    positions.set(poleUId, poleU);
    positions.set(poleVId, poleV);
    log(`  [S] fallback poles: u=${poleUId}@(${fmt(poleU)}) v=${poleVId}@(${fmt(poleV)})`);
  }

  // Traverse cycle arc from poleU to poleV (avoiding parent virtual edge)
  const path = traverseCycleArc(comp.graph, poleUId, poleVId, parentEdgeNodes);
  updateComponentPose(comp.id, {
    cycleOrder: [...path],
    poleNodes: [poleUId, poleVId]
  });
  log(`  [S] cycle arc length=${path.length} vertices=[${path.join(',')}]`);
  // path = [poleUId, w1, ..., wk, poleVId]

  // Compute arc geometry
  const M         = midpoint(poleU, poleV);
  const centroid  = regionCentroid(region);
  const axisDir   = normalize(sub(poleV, poleU));
  const perpCCW   = perp(axisDir);  // 90° CCW

  // Determine inward perp direction (toward region centroid)
  const toCenter   = sub(centroid, M);
  const sign       = dot(toCenter, perpCCW) >= 0 ? 1 : -1;
  const inwardPerp = { x: perpCCW.x * sign, y: perpCCW.y * sign };

  // ── P-child fan layout ────────────────────────────────────────────────────────
  // When this S is a direct child of P (fan scheme), the region carries fanOuterTip
  // and fanInnerTip.  Place inner vertices along posU → midTip → posV, where
  // midTip = midpoint of the outer and inner band apices.
  if (anchorU && region.fanOuterTip) {
    log(`  [S] P-child fan layout: midTip=(${fmt(midpoint(region.fanOuterTip, region.fanInnerTip))})`);
      const midTip = midpoint(region.fanOuterTip, region.fanInnerTip);

      const n = path.length;
      const innerA = path[Math.floor(n / 2) - 1];
      const innerB = path[Math.floor(n / 2)];

      for (let k = 1; k < n - 1; k++) {
        const t = k / (n - 1);

        let base = t <= 0.5
          ? add(poleU, scale(sub(midTip, poleU), 2 * t))
          : add(midTip, scale(sub(poleV, midTip), 2 * (t - 0.5)));

        // push the two middle vertices outward toward fanOuterTip
        if (path[k] === innerA || path[k] === innerB) {
          const outward = region.fanOuterTip;
          const bias = 0.25; // strength of outward pull
          base = add(base, scale(sub(outward, base), bias));
        }

        positions.set(path[k], base);

      log(`    vertex ${path[k]} (P-fan t=${t.toFixed(2)}) → (${fmt(base)})`);
    }
    recordAndCheckI1(treeNode, path, region, positions);
    for (const { u, v } of realEdges) {
      edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
      log(`    real edge ${u}–${v}`);
    }
    // ── Per-edge child regions ──────────────────────────────────────────────────
    // Recover the fan's perpendicular direction from the outer tip.
    const axisDir_fan = normalize(sub(poleV, poleU));
    const perpCCW_fan = perp(axisDir_fan);
    const midUV       = midpoint(poleU, poleV);
    const perpDir_fan = dot(sub(region.fanOuterTip, midUV), perpCCW_fan) >= 0
      ? perpCCW_fan
      : { x: -perpCCW_fan.x, y: -perpCCW_fan.y };
    const negPerp_fan = { x: -perpDir_fan.x, y: -perpDir_fan.y };

    // Hit an open polyline (no closing segment) — returns { point, seg } or null.
    const hitChain = (chain, from, dir) => {
      for (let i = 0; i < chain.length - 1; i++) {
        const t = raySegmentIntersect(from, dir, chain[i], chain[i + 1]);
        if (t !== null && t > 1e-6)
          return { point: { x: from.x + t * dir.x, y: from.y + t * dir.y }, seg: i };
      }
      return null;
    };

    const outerChain = [poleU, region.fanOuterTip, poleV];
    const innerChain = [poleU, region.fanInnerTip, poleV];

    const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
    for (const { u, v, edgeId } of childEdges) {
      const childNode = childByEdgeId.get(edgeId);
      if (!childNode) continue;
      const posA = positions.get(u), posB = positions.get(v);
      if (!posA || !posB) { log(`  [S] WARN: missing positions for child edge ${u}-${v}`); continue; }

      const oAH = hitChain(outerChain, posA, perpDir_fan);
      const iAH = hitChain(innerChain, posA, negPerp_fan);
      const oBH = hitChain(outerChain, posB, perpDir_fan);
      const iBH = hitChain(innerChain, posB, negPerp_fan);

      // Pole vertices lie on the boundary at t=0 (filtered); fall back to the pole itself.
      const nearPole = (p) => dist(p, poleU) <= dist(p, poleV) ? poleU : poleV;
      const oA = oAH?.point ?? nearPole(posA);
      const iA = iAH?.point ?? nearPole(posA);
      const oB = oBH?.point ?? nearPole(posB);
      const iB = iBH?.point ?? nearPole(posB);
      const oA_seg = oAH?.seg ?? -1;
      const iA_seg = iAH?.seg ?? -1;
      const oB_seg = oBH?.seg ?? -1;
      const iB_seg = iBH?.seg ?? -1;


const isMiddleVirtualEdge =
  (u === innerA && v === innerB) ||
  (u === innerB && v === innerA);

let pts;

if (isMiddleVirtualEdge) {
  // Special case: the central virtual edge only owns the convex region
  // between innerA, innerTip and innerB.
  pts = [
    posA,
    oA,
    region.fanOuterTip,
    oB,
    posB,
    region.fanInnerTip
  ];

  log(`  [S] P-fan middle child ${childNode.comp.id}: apex-clipped region`);
} else {
  // Generic fan-strip construction
  pts = [iA, posA, oA];
  if (oA_seg === 0 && oB_seg === 1) pts.push(region.fanOuterTip);
  pts.push(oB, posB, iB);
  if (iA_seg === 0 && iB_seg === 1) pts.push(region.fanInnerTip);
}

log(
  `  [S] P-fan child ${childNode.comp.id}: ${pts.length}-gon ` +
  `oA_seg=${oA_seg} oB_seg=${oB_seg} iA_seg=${iA_seg} iB_seg=${iB_seg}`
);

drawSubtree(
  childNode,
  { type: 'polygon', points: pts },
  posA,
  posB,
  positions,
  edges,
  regions
);
    }
    return;
  }

  // --- P-child layout (legacy lane-rectangle scheme) ---
  // Kept for any non-fan callers; fires when both poles are outside the region bbox.
  {
    const bbox = regionBBox(region);
    const uOut = poleU.x < bbox.minX || poleU.x > bbox.maxX || poleU.y < bbox.minY || poleU.y > bbox.maxY;
    const vOut = poleV.x < bbox.minX || poleV.x > bbox.maxX || poleV.y < bbox.minY || poleV.y > bbox.maxY;
    if (anchorU && uOut && vOut) {
      log(`  [S] P-child layout: placing inner vertices on centreline`);
      const n = path.length;

      // Find the top-middle and bottom-middle of the region by projecting onto axisDir
      const rPts   = getRegionPoints(region);
      const byProj = [...rPts].sort((a, b) => dot(a, axisDir) - dot(b, axisDir));
      const topMid = midpoint(byProj[0], byProj[1]);
      const botMid = midpoint(byProj[byProj.length - 2], byProj[byProj.length - 1]);

      const innerCount = n - 2;
      for (let i = 1; i < n - 1; i++) {
        const t   = innerCount === 1 ? 0.5 : (i - 1) / (innerCount - 1);
        const pos = { x: topMid.x + t * (botMid.x - topMid.x), y: topMid.y + t * (botMid.y - topMid.y) };
        positions.set(path[i], pos);
        log(`    vertex ${path[i]} (P-child t=${t.toFixed(2)}) → (${fmt(pos)})`);
      }

      recordAndCheckI1(treeNode, path, region, positions);
      for (const { u, v } of realEdges) {
        edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
        log(`    real edge ${u}–${v}`);
      }

      const poleSet = new Set([poleUId, poleVId]);
      // Pre-compute the axisDir projection range of the lane rectangle's short edges.
      // A vertex is on the pole-facing short edge when its axisDir projection equals
      // the extreme (top or bottom) of the region — only then does the free triangular
      // zone apply.  (e.g. a single inner vertex placed at the lane centre does NOT
      // land on the short edge and should keep the old proxy behaviour.)
      const minAxProj = dot(byProj[0],                    axisDir);
      const maxAxProj = dot(byProj[byProj.length - 1],    axisDir);

      const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
      for (const { u, v, edgeId } of childEdges) {
        const childNode = childByEdgeId.get(edgeId);
        if (!childNode) continue;
        const posARaw = positions.get(u), posBRaw = positions.get(v);
        if (!posARaw || !posBRaw) { log(`  [S] WARN: missing positions for child edge ${u}-${v}`); continue; }

        const hasPoleU = poleSet.has(u);
        const hasPoleV = poleSet.has(v);

        if (hasPoleU || hasPoleV) {
          const poleId  = hasPoleU ? u : v;
          const polePos = hasPoleU ? posARaw : posBRaw;
          const vtxPos  = hasPoleU ? posBRaw : posARaw;

          // Only use the triangular zone when vtxPos is actually on the pole-facing
          // short edge of the rectangle (e.g. topMid / botMid for multi-vertex S).
          // A vertex at the centre of the lane (single inner vertex, t=0.5) is NOT
          // on the short edge — fall through to the old proxy code in that case.
          const vtxAxProj = dot(vtxPos, axisDir);
          const onShortEdge = vtxAxProj <= minAxProj + 1.0 || vtxAxProj >= maxAxProj - 1.0;

          if (onShortEdge) {
            // LaTeX free triangle △_u = T_in–T_out–u (or △_v = B_in–B_out–v).
            // T_in/B_in = near-side corner of the short edge (closest to u-v axis).
            // T_out/B_out = far-side corner of the same short edge.
            // byProj[0..1] = top corners, byProj[last-1..last] = bottom corners.
            const shortPair = poleId === poleUId
              ? [byProj[0], byProj[1]]
              : [byProj[rPts.length - 2], byProj[rPts.length - 1]];
            const cornerIn  = shortPair.reduce((a, b) => dot(a, inwardPerp) <= dot(b, inwardPerp) ? a : b);
            const cornerOut = shortPair.reduce((a, b) => dot(a, inwardPerp) >= dot(b, inwardPerp) ? a : b);
            const isRChild  = childNode.comp.type !== 'S';
            childNode._laneDepthRegion = null;
            const regionPts = isRChild
              ? [polePos, cornerIn, cornerOut]   // full △_u / △_v
              : [polePos, vtxPos,  cornerIn];    // inner sub-triangle
            log(`  [S] P-child pole-edge (short-edge): pole=${poleId}@(${fmt(polePos)}) cornerIn=(${fmt(cornerIn)}) cornerOut=(${fmt(cornerOut)}) R=${isRChild} → region`);
            drawSubtree(childNode, { type: 'polygon', points: regionPts }, posARaw, posBRaw, positions, edges, regions);
            continue;
          } else if (path.length === 3) {
            // Single inner vertex: vtxPos is at the centre of the lane rectangle.
            // The pole-adjacent region becomes C_in-u-T_out-C_out-C_in
            // (and symmetrically C_in-v-B_out-C_out-C_in).
            //
            // Sort region corners by inwardPerp to separate near vs far side,
            // then by axisDir within each side to find the corner adjacent to this pole.
            const rPtsS  = getRegionPoints(region);
            const byPerp = [...rPtsS].sort((a, b) => dot(a, inwardPerp) - dot(b, inwardPerp));
            const nearByAxis = [byPerp[0], byPerp[1]].sort((a, b) => dot(a, axisDir) - dot(b, axisDir));
            const farByAxis  = [byPerp[2], byPerp[3]].sort((a, b) => dot(a, axisDir) - dot(b, axisDir));
            // nearByAxis[0]=T_in, nearByAxis[1]=B_in; farByAxis[0]=T_out, farByAxis[1]=B_out
            const isU = poleId === poleUId;
            const topOuter = farByAxis[0];
            const botOuter = farByAxis[1];
            const cIn  = midpoint(nearByAxis[0], nearByAxis[1]);
            const cOut = midpoint(topOuter, botOuter);

            const regionPts = isU
              ? [cIn, polePos, topOuter, cOut]
              : [cIn, polePos, botOuter, cOut];

            const sequence = isU
              ? `C_in=(${fmt(cIn)}) → u=(${fmt(polePos)}) → T_out=(${fmt(topOuter)}) → C_out=(${fmt(cOut)}) → C_in`
              : `C_in=(${fmt(cIn)}) → v=(${fmt(polePos)}) → B_out=(${fmt(botOuter)}) → C_out=(${fmt(cOut)}) → C_in`;

            log(`  [S] P-child pole-edge (3-cycle): pole=${poleId}@(${fmt(polePos)}) vtx@(${fmt(vtxPos)})`);
            log(`  [S] 3-cycle polygon: ${sequence}`);
            childNode._laneDepthRegionOpposite = null;
            childNode._laneDepthRegion = null;
            const childRegion = {
              type: 'polygon',
              points: regionPts
            };
            drawSubtree(childNode, childRegion, posARaw, posBRaw, positions, edges, regions);
            continue;
          }

          // Vertex is not on the short edge and not the single-centre case: proxy approach
          const poleProxy = (id) => id === poleUId ? topMid : botMid;
          const posA = hasPoleU ? poleProxy(u) : posARaw;
          const posB = hasPoleV ? poleProxy(v) : posBRaw;
          const outwardThickness = perpExtentIntoRegion(region, posA, posB, inwardPerp);
          const inwardThickness  = perpExtentIntoRegion(region, posA, posB, { x: -inwardPerp.x, y: -inwardPerp.y });
          log(`  [S] child band (pole-proxy): edge=${u}-${v} child=${childNode.comp.id} onShortEdge=${onShortEdge}`);
          const childRegion = {
            type: 'polygon',
            points: [
              add(posA, scale(inwardPerp, -inwardThickness)),
              add(posB, scale(inwardPerp, -inwardThickness)),
              add(posB, scale(inwardPerp,  outwardThickness)),
              add(posA, scale(inwardPerp,  outwardThickness))
            ]
          };
          drawSubtree(childNode, childRegion, posA, posB, positions, edges, regions);
          continue;
        }

        // Normal case: both endpoints are inside the lane rectangle
        const outwardThickness = perpExtentIntoRegion(region, posARaw, posBRaw, inwardPerp);
        const inwardThickness  = perpExtentIntoRegion(region, posARaw, posBRaw, { x: -inwardPerp.x, y: -inwardPerp.y });
        log(`  [S] child band: edge=${u}-${v} child=${childNode.comp.id} outward=${outwardThickness.toFixed(1)} inward=${inwardThickness.toFixed(1)}`);
        const childRegion = {
          type: 'polygon',
          points: [
            add(posARaw, scale(inwardPerp, -inwardThickness)),
            add(posBRaw, scale(inwardPerp, -inwardThickness)),
            add(posBRaw, scale(inwardPerp,  outwardThickness)),
            add(posARaw, scale(inwardPerp,  outwardThickness))
          ]
        };
        drawSubtree(childNode, childRegion, posARaw, posBRaw, positions, edges, regions);
      }
      return;
    }
  }

  // ── R-child layout: vertices along u-v, perpendicular ray regions ────────────
  // Triggered when drawR annotated this node with face data (_rFaceLeftIds / _rFaceRightIds).
  if (treeNode._rFaceLeftIds !== undefined && anchorU) {
    log(`  [S] R-child layout: vertices along u-v, perpendicular ray regions`);

    const innerCount = path.length - 2;

    // Place inner vertices evenly along the u-v line segment
    for (let i = 1; i <= innerCount; i++) {
      const t = i / (innerCount + 1);
      positions.set(path[i], {
        x: poleU.x + t * (poleV.x - poleU.x),
        y: poleU.y + t * (poleV.y - poleU.y)
      });
      log(`    vertex ${path[i]} (R-child t=${t.toFixed(2)}) → (${fmt(positions.get(path[i]))})`);
    }

    recordAndCheckI1(treeNode, path, region, positions);
    for (const { u, v } of realEdges) {
      edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
      log(`    real edge ${u}–${v}`);
    }

    // Convert face ID arrays to coordinate arrays
    const faceLeftPts  = (treeNode._rFaceLeftIds  ?? []).map(id => positions.get(id)).filter(p => p);
    const faceRightPts = (treeNode._rFaceRightIds ?? []).map(id => positions.get(id)).filter(p => p);

    // Determine which perpendicular direction points into faceLeft vs faceRight
    const axisDir = normalize(sub(poleV, poleU));
    const perpCCW = perp(axisDir);
    const perpCW  = { x: -perpCCW.x, y: -perpCCW.y };
    let dirLeft = perpCCW, dirRight = perpCW;
    if (faceLeftPts.length >= 2) {
      const cL = {
        x: faceLeftPts.reduce((s, p) => s + p.x, 0) / faceLeftPts.length,
        y: faceLeftPts.reduce((s, p) => s + p.y, 0) / faceLeftPts.length
      };
      if (dot(sub(cL, midpoint(poleU, poleV)), perpCCW) < 0) {
        dirLeft  = perpCW;
        dirRight = perpCCW;
      }
    }

    // Find the poleU-poleV edge index to avoid in each face
    const findAvoidEdge = (faceIds) => {
      for (let i = 0; i < faceIds.length; i++) {
        const a = faceIds[i], b = faceIds[(i + 1) % faceIds.length];
        if ((a === poleUId && b === poleVId) || (a === poleVId && b === poleUId)) return i;
      }
      return -1;
    };
    const avoidEdgeL = findAvoidEdge(treeNode._rFaceLeftIds  ?? []);
    const avoidEdgeR = findAvoidEdge(treeNode._rFaceRightIds ?? []);

    const childByEdgeIdR = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
    for (const { u, v, edgeId } of childEdges) {
      const childNode = childByEdgeIdR.get(edgeId);
      if (!childNode) continue;
      const posUc = positions.get(u), posVc = positions.get(v);
      if (!posUc || !posVc) { log(`  [S] R-child WARN: missing positions for ${u}-${v}`); continue; }

      // Shoot perpendicular rays from u_c and v_c into both adjacent faces
      const rUL = faceLeftPts.length  > 0 ? rayHitOnFace(faceLeftPts,  posUc, dirLeft)  : null;
      const rVL = faceLeftPts.length  > 0 ? rayHitOnFace(faceLeftPts,  posVc, dirLeft)  : null;
      const rUR = faceRightPts.length > 0 ? rayHitOnFace(faceRightPts, posUc, dirRight) : null;
      const rVR = faceRightPts.length > 0 ? rayHitOnFace(faceRightPts, posVc, dirRight) : null;

      const H_uL = rUL?.point ?? null, edgeUL = rUL?.edgeIdx ?? -1;
      const H_vL = rVL?.point ?? null, edgeVL = rVL?.edgeIdx ?? -1;
      const H_uR = rUR?.point ?? null, edgeUR = rUR?.edgeIdx ?? -1;
      const H_vR = rVR?.point ?? null, edgeVR = rVR?.edgeIdx ?? -1;

      // Walk face boundary arcs between the hit points (avoiding the pole edge)
      const arcL = (H_uL && H_vL && edgeUL >= 0 && edgeVL >= 0)
        ? faceArcAvoiding(faceLeftPts,  edgeUL, edgeVL, avoidEdgeL)
        : [];
      const arcR = (H_uR && H_vR && edgeVR >= 0 && edgeUR >= 0)
        ? faceArcAvoiding(faceRightPts, edgeVR, edgeUR, avoidEdgeR)
        : [];

      // Polygon: posUc → H_uL → [arcL] → H_vL → posVc → H_vR → [arcR] → H_uR
      const pts = [posUc];
      if (H_uL) pts.push(H_uL);
      pts.push(...arcL);
      if (H_vL) pts.push(H_vL);
      pts.push(posVc);
      if (H_vR) pts.push(H_vR);
      pts.push(...arcR);
      if (H_uR) pts.push(H_uR);

      log(`  [S] R-child region for ${childNode.comp.id}: ${pts.length} pts`);
      drawSubtree(childNode, { type: 'polygon', points: pts }, posUc, posVc, positions, edges, regions);
    }
    return;
  }

  // Compute circumscribed circle through poleU, arcPeak, poleV.
  // arcPeak is placed at the center of the lane (50% of available depth).
  // By symmetry (arcPeak lies on the perpendicular bisector of poleU–poleV):
  //   circumcenter = M + inwardPerp * t,  t = (D²−halfChord²) / (2D)
  //   circumradius  R = sqrt(t² + halfChord²)
  const availableDepth = perpExtentIntoRegion(region, poleU, poleV, inwardPerp);
  const halfChord = dist(poleU, poleV) / 2;
  const D         = Math.min(halfChord, availableDepth * 0.5);   // arc peak at lane centre
  const arcPeak   = add(M, scale(inwardPerp, D));
  const t_circ    = D > 1e-6 ? (D * D - halfChord * halfChord) / (2 * D) : -halfChord * halfChord;
  const arcCenter = add(M, scale(inwardPerp, t_circ));
  const R         = Math.sqrt(t_circ * t_circ + halfChord * halfChord);

  log(`  [S] arc: availableDepth=${availableDepth.toFixed(1)} D=${D.toFixed(1)} t=${t_circ.toFixed(1)} R=${R.toFixed(1)} arcCenter=(${fmt(arcCenter)}) arcPeak=(${fmt(arcPeak)})`);
  log(`  [S] childEdges=${childEdges.length} realEdges=${realEdges.length}`);

  // Sweep from poleU to poleV along the arc that passes through arcPeak.
  const n          = path.length;
  const startAngle = Math.atan2(poleU.y  - arcCenter.y, poleU.x  - arcCenter.x);
  const endAngle   = Math.atan2(poleV.y  - arcCenter.y, poleV.x  - arcCenter.x);
  const peakAngle  = Math.atan2(arcPeak.y - arcCenter.y, arcPeak.x - arcCenter.x);

  // Choose CW or CCW based on which direction goes through arcPeak
  const ccwDist = (a, b) => { let d = b - a; if (d < 0) d += 2 * Math.PI; return d; };
  const startToEndCCW  = ccwDist(startAngle, endAngle);
  const startToPeakCCW = ccwDist(startAngle, peakAngle);
  let delta;
  if (startToPeakCCW < startToEndCCW) {
    delta = startToEndCCW;             // peak is on the CCW arc → go CCW
  } else {
    delta = startToEndCCW - 2 * Math.PI;  // peak is on the CW arc → go CW
  }

  for (let i = 0; i < n; i++) {
    if (i === 0) { log(`    vertex ${path[i]} (poleU) → (${fmt(poleU)})`); continue; }
    if (i === n - 1) { log(`    vertex ${path[i]} (poleV) → (${fmt(poleV)})`); continue; }
    const t     = i / (n - 1);
    const angle = startAngle + t * delta;
    const pos   = { x: arcCenter.x + R * Math.cos(angle), y: arcCenter.y + R * Math.sin(angle) };
    positions.set(path[i], pos);
    log(`    vertex ${path[i]} (arc t=${t.toFixed(2)}) → (${fmt(pos)})`);
  }

  recordAndCheckI1(treeNode, path, region, positions);
  // Draw real edges in the arc
  for (const { u, v } of realEdges) {
    edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
    log(`    real edge ${u}–${v}`);
  }

  // Build a lookup from edge-pair to child treeNode
  const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));

  // Allocate bands for child virtual edges
  for (const { u, v, edgeId } of childEdges) {
    const childNode = childByEdgeId.get(edgeId);
    if (!childNode) continue;
    const posA = positions.get(u);
    const posB = positions.get(v);
    if (!posA || !posB) { log(`  [S] WARN: missing positions for child edge ${u}-${v}`); continue; }

    const chordMid  = midpoint(posA, posB);
    const outDir    = normalize(sub(chordMid, arcCenter));
    const inDir     = { x: -outDir.x, y: -outDir.y };
    const outThickness = perpExtentIntoRegion(region, posA, posB, outDir);
    // P children need space on both sides of their virtual edge for their own lanes.
    const inThickness  = childNode.comp.type === 'P'
      ? perpExtentIntoRegion(region, posA, posB, inDir)
      : 0;
    log(`  [S] child band: edge=${u}-${v} child=${childNode.comp.id} outward=${outThickness.toFixed(1)} inward=${inThickness.toFixed(1)}`);

    const childRegion = {
      type: 'polygon',
      points: [
        add(posA, scale(inDir, inThickness)),
        add(posB, scale(inDir, inThickness)),
        add(posB, scale(outDir, outThickness)),
        add(posA, scale(outDir, outThickness))
      ]
    };
    drawSubtree(childNode, childRegion, posA, posB, positions, edges, regions);
  }
}

// Traverse the cycle arc from startId to endId, avoiding the parentEdgeNodes edge.
// Returns [startId, ..., endId].
function traverseCycleArc(graph, startId, endId, parentEdgeNodes) {
  const parentEdge = parentEdgeNodes ? new Set([edgeKey(parentEdgeNodes[0], parentEdgeNodes[1])]) : new Set();

  const path = [startId];
  let prev = null;
  let cur  = startId;

  while (cur !== endId) {
    const nbrs = graph.get(cur) || [];
    let next = null;
    for (const n of nbrs) {
      if (n === prev) continue;
      // Skip if this is the parent virtual edge we should avoid
      if (cur === startId && prev === null && parentEdge.has(edgeKey(cur, n))) continue;
      next = n;
      break;
    }
    if (next === null || path.length > graph.size + 2) break; // safety
    path.push(next);
    prev = cur;
    cur  = next;
  }
  return path;
}

// Choose the cyclic shift and direction whose regular-polygon placement best
// matches the currently displayed labelled cycle. This preserves the familiar
// tutorial orientation while retaining the same geometric root construction.
function chooseRootCycleOrder(path, referencePositions) {
  if (!(referencePositions instanceof Map) || path.length < 3) return path;
  const reference = path.map(id => referencePositions.get(id));
  if (reference.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return path;
  }

  const center = {
    x: reference.reduce((sum, point) => sum + point.x, 0) / reference.length,
    y: reference.reduce((sum, point) => sum + point.y, 0) / reference.length
  };
  const rms = Math.sqrt(reference.reduce((sum, point) =>
    sum + (point.x - center.x) ** 2 + (point.y - center.y) ** 2, 0
  ) / reference.length) || 1;
  const normalizedById = new Map(path.map((id, index) => [id, {
    x: (reference[index].x - center.x) / rms,
    y: (reference[index].y - center.y) / rms
  }]));

  let best = path;
  let bestError = Infinity;
  for (const base of [path, [path[0], ...path.slice(1).reverse()]]) {
    for (let shift = 0; shift < path.length; shift++) {
      const candidate = base.slice(shift).concat(base.slice(0, shift));
      let error = 0;
      for (let index = 0; index < candidate.length; index++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / candidate.length;
        const target = normalizedById.get(candidate[index]);
        error += (Math.cos(angle) - target.x) ** 2
          + (Math.sin(angle) - target.y) ** 2;
      }
      if (error < bestError) {
        bestError = error;
        best = candidate;
      }
    }
  }
  return best;
}

// Walk the full cycle starting at the first key of `graph`.
// Returns all vertices in traversal order (no duplicates).
function traverseFullCycle(graph) {
  const startId = graph.keys().next().value;
  const path = [];
  let prev = null, cur = startId;
  do {
    path.push(cur);
    const nbrs = graph.get(cur) || [];
    const next = nbrs.find(x => x !== prev) ?? nbrs[0];
    prev = cur;
    cur  = next;
  } while (cur !== startId && path.length <= graph.size + 1);
  return path;
}

// Find a vertex roughly "opposite" in a cycle from startId
function findCycleMidpoint(graph, startId) {
  // Traverse the cycle and return vertex at half the cycle length
  const n = graph.size;
  let prev = null, cur = startId;
  for (let i = 0; i < Math.floor(n / 2); i++) {
    const nbrs = graph.get(cur) || [];
    const next = nbrs.find(x => x !== prev) ?? nbrs[0];
    prev = cur;
    cur  = next;
  }
  return cur;
}

// ─── P component ─────────────────────────────────────────────────────────────

function drawP(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions) {
  const { comp } = treeNode;
  const { parentEdgeNodes, childEdges } = classifyEdges(comp, parentEdgeId);

  // Determine pole positions
  let posU, posV, poleUId, poleVId;
  if (anchorU && parentEdgeNodes) {
    poleUId = parentEdgeNodes[0];
    poleVId = parentEdgeNodes[1];
    posU = anchorU;
    posV = anchorV;
  } else {
    // Root P: poles at top-middle / bottom-middle of region
    const cx = region.type === 'rect' ? region.x + region.w / 2 : regionCentroid(region).x;
    const top = region.type === 'rect' ? region.y : Math.min(...getRegionPoints(region).map(p => p.y));
    const bot = region.type === 'rect' ? region.y + region.h : Math.max(...getRegionPoints(region).map(p => p.y));
    posU = { x: cx, y: top + 40 };
    posV = { x: cx, y: bot - 40 };
    // Prefer the displayed graph's pole direction when the caller supplies it;
    // otherwise retain the decomposition's deterministic vertex order.
    const verts = [...comp.graph.keys()];
    const preferred = treeNode.preferredPoleOrder;
    if (preferred?.length >= 2 && comp.graph.has(preferred[0]) && comp.graph.has(preferred[1])) {
      [poleUId, poleVId] = preferred;
    } else {
      poleUId = verts[0];
      poleVId = verts[1] ?? verts[0];
    }
  }
  positions.set(poleUId, posU);
  positions.set(poleVId, posV);
  updateComponentPose(comp.id, {
    poleNodes: [poleUId, poleVId],
    axis: {
      from: { x: posU.x, y: posU.y },
      to: { x: posV.x, y: posV.y }
    }
  });
  recordAndCheckI1(treeNode, [poleUId, poleVId], region, positions);

  log(`  [P] poles: u=${poleUId}@(${fmt(posU)}) v=${poleVId}@(${fmt(posV)})`);

  const k = childEdges.length;
  log(`  [P] children=${k}`);
  if (k === 0) return;

  // ── Geometry: perpendicular axes and usable fan depths ─────────────────────
  // The same best-origin depths are used both for the default proportional
  // left/right split and for constructing the fan regions.
  const axisDir  = normalize(sub(posV, posU));
  const perpCCW  = perp(axisDir);
  const perpCW   = { x: -perpCCW.x, y: -perpCCW.y };
  const uvDist   = dist(posU, posV);

  const depthRegion = region;

  // Keep the fan origin within the middle 40% of u-v. Since every region
  // assigned to a P component is convex, the deepest usable fan point is the
  // outward-most point of the polygon clipped to this axial strip. Such a point
  // is either a polygon vertex inside the strip or an edge intersection with
  // one of the strip boundaries.
  const P_RAY_ORIGIN_HALF_BAND = 0.20;
  const P_RAY_T_MIN = 0.5 - P_RAY_ORIGIN_HALF_BAND;
  const P_RAY_T_MAX = 0.5 + P_RAY_ORIGIN_HALF_BAND;

  const findFarthestFanPoint = (perpDir) => {
    const regionPts = getRegionPoints(depthRegion);
    const axialMin = uvDist * P_RAY_T_MIN;
    const axialMax = uvDist * P_RAY_T_MAX;
    const candidates = [];
    const EPS = 1e-9;

    const toLocal = (point) => {
      const offset = sub(point, posU);
      return {
        axial: dot(offset, axisDir),
        outward: dot(offset, perpDir)
      };
    };

    const addCandidate = (axial, outward) => {
      if (axial < axialMin - EPS || axial > axialMax + EPS) return;
      const clampedAxial = Math.max(axialMin, Math.min(axialMax, axial));
      if (candidates.some(c =>
        Math.abs(c.axial - clampedAxial) <= EPS &&
        Math.abs(c.outward - outward) <= EPS
      )) return;
      candidates.push({ axial: clampedAxial, outward });
    };

    const localPts = regionPts.map(toLocal);
    for (let i = 0; i < localPts.length; i++) {
      const a = localPts[i];
      const b = localPts[(i + 1) % localPts.length];

      // Original polygon vertices inside the central strip.
      addCandidate(a.axial, a.outward);

      // Intersections of this polygon edge with both strip boundaries.
      const axialDelta = b.axial - a.axial;
      if (Math.abs(axialDelta) <= EPS) continue;
      for (const boundary of [axialMin, axialMax]) {
        const edgeT = (boundary - a.axial) / axialDelta;
        if (edgeT < -EPS || edgeT > 1 + EPS) continue;
        const outward = a.outward + edgeT * (b.outward - a.outward);
        addCandidate(boundary, outward);
      }
    }

    let bestDepth = 0;
    let bestAxialSum = 0;
    let bestCount = 0;
    for (const candidate of candidates) {
      if (candidate.outward > bestDepth + 1e-3) {
        bestDepth = candidate.outward;
        bestAxialSum = candidate.axial;
        bestCount = 1;
      } else if (candidate.outward >= bestDepth - 1e-3) {
        bestAxialSum += candidate.axial;
        bestCount++;
      }
    }

    const bestAxial = bestCount > 0 ? bestAxialSum / bestCount : uvDist * 0.5;
    const origin = add(posU, scale(axisDir, bestAxial));
    return {
      origin,
      depth: bestDepth,
      boundaryPoint: add(origin, scale(perpDir, bestDepth))
    };
  };

  const {
    origin: originL,
    depth: fanDepthL,
    boundaryPoint: boundaryPointL
  } = findFarthestFanPoint(perpCCW);
  const {
    origin: originR,
    depth: fanDepthR,
    boundaryPoint: boundaryPointR
  } = findFarthestFanPoint(perpCW);

  // Show the selected fan endpoints in the optional region overlay.
  if (fanDepthL > 1e-6) {
    regions.push({
      type: 'cone-intersection',
      point: boundaryPointL,
      label: comp.id
    });
  }
  if (fanDepthR > 1e-6) {
    regions.push({
      type: 'cone-intersection',
      point: boundaryPointR,
      label: comp.id
    });
  }

  const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
  const childEdgeByCompId = new Map();
  for (const edgeInfo of childEdges) {
    const childNode = childByEdgeId.get(edgeInfo.edgeId);
    if (childNode?.comp?.id) childEdgeByCompId.set(childNode.comp.id, edgeInfo);
  }

  const childIdsInDefaultEdgeOrder = childEdges
    .map(({ edgeId }) => childByEdgeId.get(edgeId)?.comp?.id)
    .filter(Boolean);
  const defaultLeft = [];
  const defaultRight = [];
  // Proportional split: use the same depths that define the two fans.
  const _totalDepth = fanDepthL + fanDepthR;
  let _nLeftTarget, _nRightTarget;
  if (fanDepthL <= 1e-6 && fanDepthR <= 1e-6) {
    // Degenerate region: retain a deterministic roughly-even order. The
    // resulting zero-depth fan will be reported by the invariant checks.
    _nRightTarget = Math.floor(k / 2);
    _nLeftTarget  = k - _nRightTarget;
  } else if (fanDepthL <= 1e-6) {
    _nRightTarget = k; _nLeftTarget = 0;
  } else if (fanDepthR <= 1e-6) {
    _nLeftTarget = k; _nRightTarget = 0;
  } else {
    _nRightTarget = Math.round(k * fanDepthR / _totalDepth);
    _nLeftTarget  = k - _nRightTarget;
  }
  childIdsInDefaultEdgeOrder.forEach((id, idx) => {
    if (idx < _nLeftTarget) defaultLeft.push(id);
    else                    defaultRight.push(id);
  });
  const defaultVisualOrder = [...defaultLeft.reverse(), P_AXIS_SLOT, ...defaultRight];

  const normalizeVisualOrder = (candidate) => {
    const expected = new Set(childIdsInDefaultEdgeOrder);
    const out = [];
    const seen = new Set();
    let seenAxis = false;

    for (const token of Array.isArray(candidate) ? candidate : []) {
      if (token === P_AXIS_SLOT) {
        if (!seenAxis) {
          out.push(token);
          seenAxis = true;
        }
        continue;
      }
      if (!expected.has(token) || seen.has(token)) continue;
      out.push(token);
      seen.add(token);
    }

    for (const token of defaultVisualOrder) {
      if (token === P_AXIS_SLOT) {
        continue;
      }
      if (seen.has(token)) continue;
      out.push(token);
      seen.add(token);
    }

    if (!seenAxis) {
      const defaultAxisIndex = defaultVisualOrder.indexOf(P_AXIS_SLOT);
      out.splice(Math.min(defaultAxisIndex, out.length), 0, P_AXIS_SLOT);
    }
    return out;
  };

  const visualOrder = normalizeVisualOrder(treeNode.embeddingOrder);
  treeNode.embeddingOrder = [...visualOrder];
  if (treeNode.comp) treeNode.comp.embeddingOrder = [...visualOrder];

  const uvSlotIndex = visualOrder.findIndex(t => t === P_AXIS_SLOT);
  const leftChildIds = [];
  const rightChildIds = [];
  for (let i = 0; i < visualOrder.length; i++) {
    const token = visualOrder[i];
    if (token === P_AXIS_SLOT) continue;

    // Base side from slot position relative to u-v, then optionally toggle for
    // flipped direct R-children so their region moves across u-v while slot order stays fixed.
    let goLeft = i < uvSlotIndex;
    const edgeInfo = childEdgeByCompId.get(token);
    const childNode = edgeInfo ? childByEdgeId.get(edgeInfo.edgeId) : null;
    if (childNode?.comp?.type === 'R' && childNode.embeddingFlip) {
      const oldSide = goLeft ? 'L' : 'R';
      goLeft = !goLeft;
      log(`  [P] flip-side override: child=${token} ${oldSide}->${goLeft ? 'L' : 'R'}`);
    }

    if (goLeft) leftChildIds.push(token);
    else rightChildIds.push(token);
  }

  // A stored embeddingOrder can place children on a side that has zero
  // available depth (the u-v axis coincides with the region boundary after a
  // parent flip changes the geometry). Move them to the side that has space
  // rather than constructing a zero-depth fan.
  if (fanDepthL <= 1e-6 && leftChildIds.length > 0 && fanDepthR > 1e-6) {
    rightChildIds.unshift(...[...leftChildIds].reverse());
    leftChildIds.length = 0;
  } else if (fanDepthR <= 1e-6 && rightChildIds.length > 0 && fanDepthL > 1e-6) {
    leftChildIds.push(...rightChildIds);
    rightChildIds.length = 0;
  }

  updateComponentPose(comp.id, {
    visualOrder: [...visualOrder],
    leftChildIds: [...leftChildIds],
    rightChildIds: [...rightChildIds]
  });

  log(`  [P] order L→R=[${visualOrder.map(t => t === P_AXIS_SLOT ? 'u-v axis' : String(t)).join(', ')}]`);

  log(`  [P] uvDist=${uvDist.toFixed(1)} depthL=${fanDepthL.toFixed(1)} depthR=${fanDepthR.toFixed(1)} depthRegion=${depthRegion.type}`);

  log(`  [P] fan rayL: origin=(${fmt(originL)}) depth=${fanDepthL.toFixed(1)}`);
  log(`  [P] fan rayR: origin=(${fmt(originR)}) depth=${fanDepthR.toFixed(1)}`);

  // ── Build child-node lookup ───────────────────────────────────────────────────
  const childNodeByCompId = new Map();
  for (const [compId, edgeInfo] of childEdgeByCompId) {
    const cn = childByEdgeId.get(edgeInfo.edgeId);
    if (cn) childNodeByCompId.set(compId, cn);
  }

  // ── Build fan regions ─────────────────────────────────────────────────────────
  // nearToFarIds[0] is the child nearest the u-v axis (innermost).
  //
  // Band 0 (innermost, any type): triangle [posU, tip_1, posV].
  //   Poles are actual vertices → drawR takes the normal (non-P-child) path.
  //
  // Band i > 0, non-R child: quadrilateral band [posU, tip_{i+1}, posV, tip_i].
  
  const buildFanRegions = (nearToFarIds, perpDir, origin, depth) => {
    const n = nearToFarIds.length;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const d0   = depth *  i      / n;
      const d1   = depth * (i + 1) / n;
      const tip1 = add(origin, scale(perpDir, d1));

      const tip0 = add(origin, scale(perpDir, d0));  // inner apex (= origin when i=0, d0=0)

      let points;
      if (i === 0) {
        points = [posU, tip1, posV];
      } else {
        points = [posU, tip1, posV, tip0];
      }
      // fanOuterTip / fanInnerTip let drawS place its vertices along the midpoint ">".
      map.set(nearToFarIds[i], { type: 'polygon', points, fanOuterTip: tip1, fanInnerTip: tip0 });
    }
    return map;
  };

  // leftChildIds are ordered far-to-near in visual order; reverse for near-to-far fan.
  const fanRegionsL = buildFanRegions([...leftChildIds].reverse(), perpCCW, originL, fanDepthL);
  const fanRegionsR = buildFanRegions(rightChildIds,               perpCW,  originR, fanDepthR);

  // ── Draw children ─────────────────────────────────────────────────────────────
  for (let slotIdx = 0; slotIdx < visualOrder.length; slotIdx++) {
    const token = visualOrder[slotIdx];
    if (token === P_AXIS_SLOT) {
      log(`  [P] slot ${slotIdx} → u-v axis divider`);
      continue;
    }
    const fanRegion    = fanRegionsL.get(token) ?? fanRegionsR.get(token);
    const childEdgeInfo = childEdgeByCompId.get(token);
    const childNode    = childEdgeInfo ? childByEdgeId.get(childEdgeInfo.edgeId) : null;
    if (!fanRegion || !childNode) continue;

    log(`  [P] slot ${slotIdx} → child ${childNode.comp.id}(${childNode.comp.type}) side=${fanRegionsL.has(token) ? 'L' : 'R'}`);
    if (childNode.comp.type === 'R') {
      const opening = createPBandOpening(posU, posV, fanRegion);
      childNode._isPChild = false;

      if (opening) {
        const edgeStart = edges.length;
        const regionStart = regions.length;
        const nodeRegionStart = _nodeRegions.length;

        // Draw the complete R-subtree in a convex proxy triangle. Afterwards
        // only the two poles and their incident edge stubs are opened into the
        // concave band; every other vertex keeps its Tutte position.
        drawSubtree(
          childNode,
          opening.sourceRegion,
          opening.proxyU,
          opening.proxyV,
          positions,
          edges,
          regions
        );
        applyLocalizedBandOpeningToDrawnSubtree({
          opening,
          treeNode: childNode,
          positions,
          edges,
          edgeStart,
          regions,
          regionStart,
          nodeRegionStart
        });
      } else {
        // The innermost fan region is already a triangle, so no opening is
        // necessary and the true pole positions can be used directly.
        drawSubtree(childNode, fanRegion, posU, posV, positions, edges, regions);
      }
    } else {
      childNode._isPChild = true;
      drawSubtree(childNode, fanRegion, posU, posV, positions, edges, regions);
    }
  }
}

// ─── Guaranteed opening of an R-child P-band ────────────────────────────────

/**
 * Construct the convex proxy triangle used to draw an R-child of a P-node.
 * The final opening moves only its temporary poles. An incident edge is
 * rerouted only if the direct pole movement would otherwise violate planarity.
 */
export function createPBandOpening(actualU, actualV, fanRegion) {
  const outerTip = fanRegion?.fanOuterTip;
  const innerTip = fanRegion?.fanInnerTip;
  if (!actualU || !actualV || !outerTip || !innerTip) return null;

  const axis = normalize(sub(actualV, actualU));
  const pDir = perp(axis);
  const sideSign = dot(sub(outerTip, actualU), pDir) >= 0 ? 1 : -1;
  const outDir = scale(pDir, sideSign);
  const outerExtent = dot(sub(outerTip, actualU), outDir);
  const innerExtent = dot(sub(innerTip, actualU), outDir);

  // Band zero is the innermost triangle.  It needs no opening.
  if (outerExtent <= 1e-8 || innerExtent <= 1e-8) return null;

  const t = innerExtent / outerExtent;
  if (!(t > 1e-8 && t < 1 - 1e-8)) return null;

  const proxyU = add(actualU, scale(sub(outerTip, actualU), t));
  const proxyV = add(actualV, scale(sub(outerTip, actualV), t));
  const base = sub(proxyV, proxyU);
  const baseLen2 = dot(base, base);
  if (baseLen2 <= 1e-12) return null;

  // In the fan construction innerTip lies on the proxy base.  Project it to
  // that base to absorb floating-point noise without changing the geometry.
  const qParam = dot(sub(innerTip, proxyU), base) / baseLen2;
  if (qParam <= 1e-8 || qParam >= 1 - 1e-8) return null;
  const sourceInner = add(proxyU, scale(base, qParam));

  if (Math.abs(orientation(sourceInner, proxyU, outerTip)) <= 1e-10
      || Math.abs(orientation(sourceInner, outerTip, proxyV)) <= 1e-10) {
    return null;
  }

  return {
    actualU,
    actualV,
    proxyU,
    proxyV,
    outerTip,
    innerTip,
    sourceInner,
    sourceRegion: {
      type: 'polygon',
      points: [proxyU, outerTip, proxyV]
    },
    targetRegion: fanRegion
  };
}

function deduplicatePolyline(points, eps = 1e-8) {
  const out = [];
  for (const point of points) {
    if (out.length === 0 || dist(out[out.length - 1], point) > eps) out.push(point);
  }
  return out;
}

function orientedRoutePoints(edge, route) {
  const points = Array.isArray(route?.points) ? route.points : [];
  if (route?.from === undefined || route?.from === null) return points;
  return Number(route.from) === Number(edge.source) ? points : [...points].reverse();
}

function segmentCutIntersection(origin, toward, cutA, cutB, eps = 1e-10) {
  const ray = sub(toward, origin);
  const cut = sub(cutB, cutA);
  const denominator = ray.x * cut.y - ray.y * cut.x;
  if (Math.abs(denominator) <= eps) return null;
  const offset = sub(cutA, origin);
  const t = (offset.x * cut.y - offset.y * cut.x) / denominator;
  const u = (offset.x * ray.y - offset.y * ray.x) / denominator;
  if (t <= eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return add(origin, scale(ray, t));
}

function edgePolylineFromVertex(edge, vertexId, positions, routes) {
  const polyline = routedEdgePolyline(edge, positions, routes);
  return Number(edge.source) === Number(vertexId) ? polyline : [...polyline].reverse();
}

function routeMovedPole({
  vertexId,
  proxy,
  actual,
  outerTip,
  innerTip,
  cutFraction,
  positions,
  edges,
  edgeStart,
  routes,
  routeEdgeKeys
}) {
  const incidentEdges = edges
    .slice(edgeStart)
    .filter(edge => Number(edge.source) === Number(vertexId)
      || Number(edge.target) === Number(vertexId))
    .filter(edge => routeEdgeKeys.has(edgeRouteKey(edge.source, edge.target)));
  const sourcePolylines = incidentEdges.map(edge => ({
    edge,
    points: edgePolylineFromVertex(edge, vertexId, positions, routes)
  }));
  const cutOuter = add(proxy, scale(sub(outerTip, proxy), cutFraction));
  const cutInner = add(proxy, scale(sub(innerTip, proxy), cutFraction));
  const routed = [];

  for (const { edge, points } of sourcePolylines) {
    const firstIndex = points.findIndex((point, index) =>
      index > 0 && dist(point, proxy) > 1e-9
    );
    if (firstIndex < 0) continue;
    const port = segmentCutIntersection(proxy, points[firstIndex], cutOuter, cutInner);
    if (!port) return false;
    const openedPolyline = deduplicatePolyline([
      actual,
      port,
      ...points.slice(firstIndex)
    ]);
    routed.push({ edge, openedPolyline });
  }

  positions.set(vertexId, { ...actual });
  for (const { edge, openedPolyline } of routed) {
    const intermediate = openedPolyline.slice(1, -1);
    const key = edgeRouteKey(edge.source, edge.target);
    if (intermediate.length > 0) {
      routes.set(key, {
        type: 'polyline',
        from: Number(vertexId),
        points: intermediate,
        reason: 'localized-p-band-pole-opening'
      });
    } else {
      routes.delete(key);
    }
  }
  return true;
}

/**
 * Open a P-band without moving any non-pole vertex. Straight pole edges are
 * tried first. If one causes a planarity violation, a small cut across the
 * corresponding proxy corner supplies a local bend for that edge. Everything
 * beyond the cut remains exactly where Tutte placed it.
 */
export function openPBandDrawingAtPoles({
  opening,
  poleIds,
  positions,
  edges,
  edgeRoutes,
  edgeStart = 0
}) {
  const positionBackup = new Map(poleIds.map(id => [id, positions.get(id)]));
  const routeBackup = new Map(edgeRoutes);
  const fractions = [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025, 0.00125];

  // First try the natural drawing: move the poles and leave every existing
  // edge route untouched. Most pole edges then remain straight.
  positions.set(poleIds[0], { ...opening.actualU });
  positions.set(poleIds[1], { ...opening.actualV });
  const directViolations = findRoutedDrawingPlanarityViolations(
    positions,
    edges,
    edgeRoutes
  );
  if (directViolations.length === 0) {
    return { cutFraction: null, routedEdgeCount: 0 };
  }

  const eligibleEdgeKeys = new Set(
    edges.slice(edgeStart)
      .filter(edge => poleIds.some(id =>
        Number(edge.source) === Number(id) || Number(edge.target) === Number(id)
      ))
      .map(edge => edgeRouteKey(edge.source, edge.target))
  );
  const routeEdgeKeys = new Set();
  const addViolatedPoleEdges = (violations) => {
    for (const violation of violations) {
      const involved = violation.edges ?? (violation.edge ? [violation.edge] : []);
      for (const edge of involved) {
        const key = edgeRouteKey(edge.source, edge.target);
        if (eligibleEdgeKeys.has(key)) routeEdgeKeys.add(key);
      }
    }
  };
  addViolatedPoleEdges(directViolations);
  if (routeEdgeKeys.size === 0) {
    throw new Error('P-band pole movement caused a violation outside its incident edges');
  }

  for (const cutFraction of fractions) {
    while (true) {
      for (const [id, point] of positionBackup) positions.set(id, point);
      edgeRoutes.clear();
      for (const [key, route] of routeBackup) edgeRoutes.set(key, route);

      const openedU = routeMovedPole({
        vertexId: poleIds[0], proxy: opening.proxyU, actual: opening.actualU,
        outerTip: opening.outerTip, innerTip: opening.sourceInner, cutFraction,
        positions, edges, edgeStart, routes: edgeRoutes, routeEdgeKeys
      });
      const openedV = openedU && routeMovedPole({
        vertexId: poleIds[1], proxy: opening.proxyV, actual: opening.actualV,
        outerTip: opening.outerTip, innerTip: opening.sourceInner, cutFraction,
        positions, edges, edgeStart, routes: edgeRoutes, routeEdgeKeys
      });
      if (!openedV) break;

      const violations = findRoutedDrawingPlanarityViolations(positions, edges, edgeRoutes);
      if (violations.length === 0) {
        return { cutFraction, routedEdgeCount: routeEdgeKeys.size };
      }

      const previousSize = routeEdgeKeys.size;
      addViolatedPoleEdges(violations);
      if (routeEdgeKeys.size === previousSize) break;
    }
  }

  for (const [id, point] of positionBackup) positions.set(id, point);
  edgeRoutes.clear();
  for (const [key, route] of routeBackup) edgeRoutes.set(key, route);
  throw new Error('Could not route a planar localized P-band pole opening');
}

function applyLocalizedBandOpeningToDrawnSubtree({
  opening,
  treeNode,
  positions,
  edges,
  edgeStart,
  regions,
  regionStart,
  nodeRegionStart
}) {
  _usedPBandOpening = true;
  const result = openPBandDrawingAtPoles({
    opening,
    poleIds: treeNode.parentEdgeNodes,
    positions,
    edges,
    edgeRoutes: _edgeRoutes,
    edgeStart
  });

  // Only the opened R-child receives the full target band. Descendant regions
  // and their drawings remain in the unchanged proxy triangle.
  const finalPolePoint = new Map([
    [String(treeNode.parentEdgeNodes[0]), opening.actualU],
    [String(treeNode.parentEdgeNodes[1]), opening.actualV]
  ]);
  for (let i = regionStart; i < regions.length; i++) {
    const overlay = regions[i];
    if (i === regionStart && overlay.label === treeNode.comp.id) {
      overlay.points = [...getRegionPoints(opening.targetRegion)];
      continue;
    }
    if (overlay.type === 'outer-face-vertex' && finalPolePoint.has(String(overlay.label))) {
      overlay.point = finalPolePoint.get(String(overlay.label));
    }
  }

  for (let i = nodeRegionStart; i < _nodeRegions.length; i++) {
    const entry = _nodeRegions[i];
    if (i === nodeRegionStart && entry.node === treeNode) {
      entry.region = opening.targetRegion;
    }
  }

  updateComponentPose(treeNode.comp.id, {
    regionPoints: getRegionPoints(opening.targetRegion).map(point => ({ ...point }))
  });

  log(
    `  [P→R] moved only the poles of ${treeNode.comp.id} into the concave band; `
    + `${result.routedEdgeCount} crossing edge(s) rerouted`
    + (result.cutFraction === null ? '' : ` with local cut=${result.cutFraction}`)
  );
}

// ─── R component ─────────────────────────────────────────────────────────────

function drawR(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions) {
  const { comp } = treeNode;
  if (treeNode._isPChild) {
    throw new Error(
      `R component ${comp.id} reached drawR without the convex-proxy P-band opening`
    );
  }
  const { parentEdgeNodes, childEdges, realEdges } = classifyEdges(comp, parentEdgeId);

  log(`  [R] vertices=${comp.graph.size} childEdges=${childEdges.length} realEdges=${realEdges.length}`);
  console.log(`[R:${comp.id}] enter — verts=${comp.graph.size} childEdges=${childEdges.length} realEdges=${realEdges.length} anchored=${!!anchorU} region=${regionDesc(region)}`);

  // 1. Get rotation system
  let { embedding } = isPlanarAndEmbed(comp.graph);
  if (!embedding) {
    log(`  [R] WARN: component ${comp.id} is non-planar — using cycle-based outer face with boundary Tutte.`);
    console.log(`[R:${comp.id}] non-planar — proceeding with findShortestCycleArc as outer face`);
  }
  if (treeNode.embeddingFlip && embedding) {
    const flipped = new Map();
    for (const [v, nbrs] of embedding) flipped.set(v, [...nbrs].reverse());
    embedding = flipped;
    console.log(`[R:${comp.id}] embeddingFlip applied`);
  }

  // 2. Extract faces (empty for non-planar; outer face set via cycle fallback below)
  const faces = embedding ? extractFaces(embedding) : [];
  console.log(`[R:${comp.id}] faces=${faces.length} sizes=[${faces.map(f => f.length).join(',')}]`);

  // 3. Choose outer face
  let outerFace;
  // Both shared with the non-P-child sideSign defensive override below.
  let _canvasSideSign  = 0;  // which side of the axis the region has more depth on
  let _effectiveSideSign = 0; // like _canvasSideSign but inverted when flip moves to opposite side
  if (anchorU && parentEdgeNodes) {
    const [pU, pV] = parentEdgeNodes;

    // Find the two faces of the virtual edge: F1 has pU→pV as a consecutive
    // pair, F2 has pV→pU.  These are the only faces that satisfy the
    // boundary-Tutte invariant "near arc is empty", because the virtual edge
    // is a direct step in each face's traversal.  Picking any other face that
    // merely contains pU and pV as non-consecutive vertices breaks the farArc
    // computation and collapses the Tutte embedding to a line.
    let faceF1 = null, faceF2 = null;
    for (const f of faces) {
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        if (a === pU && b === pV && !faceF1) { faceF1 = f; break; }
        if (a === pV && b === pU && !faceF2) { faceF2 = f; break; }
      }
      if (faceF1 && faceF2) break;
    }

    // In the raw Tutte embedding, F1 (pU→pV) always places its far-arc on the
    // +pDir (CCW) side → sideSign = +1.  F2 (pV→pU) places its far-arc on the
    // -pDir side → sideSign = -1.  Choose the face whose far-arc side matches
    // the side where the allocated canvas region has depth.
    const axDirR = normalize(sub(anchorV, anchorU));
    const pDirR  = perp(axDirR);
    // Count non-pole region corners on each side of the u-v axis.
    // perpExtentIntoRegion is unreliable here: when pU/pV are face-boundary
    // vertices, the 25%/50%/75% sampling points lie exactly on the polygon
    // edge.  Outward rays exit through that same edge below the t>1e-6 guard,
    // return Infinity → fallback 100, and then "100 >= actual_depth" makes
    // _canvasSideSign default to +1 regardless of which side has real depth.
    const _rPtsForSide = getRegionPoints(region);
    const _posCount = _rPtsForSide.filter(c => dot(sub(c, anchorU), pDirR) > 1e-3).length;
    const _negCount = _rPtsForSide.filter(c => dot(sub(c, anchorU), pDirR) < -1e-3).length;
    _canvasSideSign = _posCount >= _negCount ? 1 : -1;

    // embeddingFlip should move the component to the opposite face when the
    // region has depth on both sides (e.g. R child of R gets centroids on
    // both sides of the axis).  For one-sided regions there are no corners on
    // the other side, so forcing the opposite sideSign would empty farCorners
    // and squish the drawing — in that case flip only changes the internal
    // arrangement (different outer-face vertices), not which side is used.
    const _hasDepthBothSides = _posCount > 0 && _negCount > 0;
    _effectiveSideSign = (treeNode.embeddingFlip && _hasDepthBothSides)
      ? -_canvasSideSign : _canvasSideSign;

    const matchFace   = _effectiveSideSign > 0 ? faceF1 : faceF2;
    const fallbackSet = [faceF1, faceF2].filter(Boolean);
    const byFace = matchFace
      ?? findLargestFace(fallbackSet.length ? fallbackSet : faces.filter(f => f.includes(pU) && f.includes(pV)));
    outerFace = (byFace?.length ? byFace : null) ?? findShortestCycleArc(comp.graph, pU, pV);
    log(`  [R] faces=${faces.length} canvasSideSign=${_canvasSideSign} effectiveSideSign=${_effectiveSideSign} flip=${treeNode.embeddingFlip} outerFace=[${outerFace.join(',')}] (virtual-edge face for anchors ${pU},${pV})`);
    console.log(`[R:${comp.id}] outerFace=[${outerFace.join(',')}] canvasSide=${_canvasSideSign} effectiveSide=${_effectiveSideSign} flip=${treeNode.embeddingFlip} faceF1=${faceF1 ? `[${faceF1.join(',')}]` : 'null'} faceF2=${faceF2 ? `[${faceF2.join(',')}]` : 'null'}`);
  } else {
    const largest = findLargestFace(faces);
    if (largest.length) {
      outerFace = largest;
    } else {
      const verts = [...comp.graph.keys()];
      outerFace = findShortestCycleArc(comp.graph, verts[0], verts[1] ?? verts[0]);
    }
    log(`  [R] faces=${faces.length} outerFace=[${outerFace.join(',')}] (largest, root)`);
    console.log(`[R:${comp.id}] root — outerFace=[${outerFace.join(',')}] (largest face)`);
  }

  updateComponentPose(comp.id, {
    outerFace: [...outerFace],
    embeddingFlip: !!treeNode.embeddingFlip
  });

  // 4+5. Tutte embedding (anchored: boundary Tutte only; root: unconstrained)
  let applied = false;
  if (anchorU && parentEdgeNodes) {
    const [pU, pV] = parentEdgeNodes;
    if (comp.graph.has(pU) && comp.graph.has(pV)) {
      // ── Universal boundary Tutte ─────────────────────────────────────────
      // Snap every outer-face vertex onto the region boundary, then re-run
      // Tutte with those explicit positions.  Tutte's convexity theorem then
      // guarantees all interior vertices stay inside the region.
      //
      // The outer face has two arcs between pU and pV.  Because the virtual
      // parent edge (pU–pV) lies on the outer face, the "near arc" is always
      // empty; the "far arc" holds all other outer-face vertices.

      // Walk the outer face to identify the far arc.
      const ofIdxMap = new Map(outerFace.map((v, i) => [v, i]));
      const iU = ofIdxMap.get(pU);
      const iV = ofIdxMap.get(pV);
      const arcFwd = [], arcBwd = [];
      let oi = iU;
      while (true) { oi = (oi + 1) % outerFace.length; if (oi === iV) break; arcFwd.push(outerFace[oi]); }
      oi = iU;
      while (true) { oi = (oi - 1 + outerFace.length) % outerFace.length; if (oi === iV) break; arcBwd.push(outerFace[oi]); }
      const farArc = arcFwd.length >= arcBwd.length ? arcFwd : arcBwd;
      console.log(`[R:${comp.id}] farArc=[${farArc.join(',')}] (fwd=${arcFwd.length} bwd=${arcBwd.length} chose=${arcFwd.length >= arcBwd.length ? 'fwd' : 'bwd'})`);

      const axDir = normalize(sub(anchorV, anchorU));
      const pDir  = perp(axDir);
      const rPts  = getRegionPoints(region);

      // Anchored R-nodes are always drawn in a convex working region.  When an
      // R-node belongs to a concave P-band, drawP supplies its convex proxy
      // triangle and opens the complete subtree afterwards.
      const dstU = anchorU;
      const dstV = anchorV;
      let sideSign = _effectiveSideSign !== 0 ? _effectiveSideSign : 1;
      console.log(`[R:${comp.id}] anchored convex draw: sideSign=${sideSign} (effectiveSideSign=${_effectiveSideSign})`);

      // Auto-flip R into the intended outside side when parent S provided an
      // outward direction hint for boosted pole-edge regions.
      if (region?.autoFlipIfR && region?.preferOutsideDir) {
        const baseSign = dot(normalize(region.preferOutsideDir), pDir) >= 0 ? 1 : -1;
        const desiredSign = treeNode.embeddingFlip ? -baseSign : baseSign;
        if (desiredSign !== sideSign) {
          sideSign = desiredSign;
          log(`  [R] auto outside-side flip: desiredSign=${desiredSign}`);
        }
      }

      const farCorners = rPts
        .filter(c => sideSign * dot(sub(c, anchorU), pDir) > 1e-3)
        .sort((a, b) => dot(sub(a, anchorU), axDir) - dot(sub(b, anchorU), axDir));

      const FARPATH_INSET = 0.15;
      const fMx = (anchorU.x + anchorV.x) * 0.5;
      const fMy = (anchorU.y + anchorV.y) * 0.5;
      const insetCorners = farCorners.map(c => {
        const candidate = {
          x: c.x + (fMx - c.x) * FARPATH_INSET,
          y: c.y + (fMy - c.y) * FARPATH_INSET
        };
        return pointInPolygon(candidate, rPts) ? candidate : c;
      });
      const farPath = [dstU, ...insetCorners, dstV];
      log(`  [R] anchored: sideSign=${sideSign} farCorners=[${farCorners.map(fmt).join(', ')}] edgeMid=(${fMx.toFixed(1)},${fMy.toFixed(1)}) inset=[${insetCorners.map(fmt).join(', ')}]`);
      console.log(`[R:${comp.id}] anchored: farCorners=${farCorners.length} insetCorners=[${insetCorners.map(fmt).join(', ')}] farPath=${farPath.length}pts`);

      log(`  [R] farArc=[${farArc.join(',')}] farPath=[${farPath.map(fmt).join(' → ')}]`);

      // Build explicit outer-boundary positions
      const outerPositions = new Map();
      outerPositions.set(pU, dstU);
      outerPositions.set(pV, dstV);
      const nArc = farArc.length;
      for (let k = 0; k < nArc; k++) {
        const t = (k + 1) / (nArc + 1);
        outerPositions.set(farArc[k], interpolateOnPath(farPath, t));
      }

      console.log(`[R:${comp.id}] outerPositions: pU=${pU}→(${fmt(dstU)}) pV=${pV}→(${fmt(dstV)}) farArc(${nArc}verts) along farPath(${farPath.length}pts)`);

      // Planar: boundary Tutte. Non-planar: outer positions applied directly, interior randomised.
      let rawPos;
      if (embedding) {
        try {
          rawPos = tutteEmbedding(comp.graph, outerFace, outerPositions);
          console.log(`[R:${comp.id}] boundary Tutte ok — ${rawPos.size} verts`);
        } catch (e) {
          console.warn('tutteEmbedding (boundary) failed', comp.id, e);
          rawPos = fallbackCircleLayout(comp.graph);
        }
      } else {
        rawPos = new Map(outerPositions);
        const outerSet = new Set(outerFace);
        const rPts = getRegionPoints(region);
        const bbox = regionBBox(region);
        for (const v of comp.graph.keys()) {
          if (outerSet.has(v)) continue;
          let p, attempts = 0;
          do {
            p = { x: bbox.minX + Math.random() * bbox.w, y: bbox.minY + Math.random() * bbox.h };
          } while (!pointInPolygon(p, rPts) && ++attempts < 20);
          rawPos.set(v, p);
        }
        console.log(`[R:${comp.id}] non-planar: outer positions direct, ${comp.graph.size - outerSet.size} interior verts randomised`);
      }

      for (const [v, p] of rawPos) {
        positions.set(v, p);
        log(`    vertex ${v} → (${fmt(p)})`);
      }

      log(`  [R] boundary Tutte applied (anchored convex region)`);
      console.log(`[R:${comp.id}] boundary Tutte applied (anchored convex region)`);

      applied = true;
    } else {
      log(`  [R] WARN: anchor vertices not in graph (pU=${pU} pV=${pV})`);
    }
  }
  if (!applied) {
    if (embedding) {
      // Root R planar: unconstrained Tutte, scale into 1/√2 × 1/√2 subsquare.
      let rawPos;
      try {
        rawPos = tutteEmbedding(comp.graph, outerFace);
        console.log(`[R:${comp.id}] root Tutte ok — ${rawPos.size} verts`);
      } catch (e) {
        console.warn('tutteEmbedding failed for R component', comp.id, e);
        rawPos = fallbackCircleLayout(comp.graph);
      }
      const bbox    = regionBBox(region);
      const side    = Math.min(bbox.w, bbox.h) / Math.sqrt(2);
      const cx      = (bbox.minX + bbox.maxX) / 2;
      const cy      = (bbox.minY + bbox.maxY) / 2;
      const subRegion = { type: 'rect', x: cx - side / 2, y: cy - side / 2, w: side, h: side };
      const scaled  = scaleRegion(rawPos, subRegion);
      for (const [v, p] of scaled) positions.set(v, p);
      log(`  [R] scaleRegion 1/√2 subsquare (side=${side.toFixed(1)}) applied`);
      console.log(`[R:${comp.id}] root scaled into subsquare side=${side.toFixed(1)} cx=${cx.toFixed(1)} cy=${cy.toFixed(1)}`);
    } else {
      // Root R non-planar: outer face along region boundary, interior randomly inside.
      const outerSet = new Set(outerFace);
      const rPts = getRegionPoints(region);
      const bbox = regionBBox(region);
      const closedBoundary = [...rPts, rPts[0]];
      const nBoundary = outerFace.length;
      for (let i = 0; i < nBoundary; i++) {
        positions.set(outerFace[i], interpolateOnPath(closedBoundary, i / nBoundary));
      }
      for (const v of comp.graph.keys()) {
        if (outerSet.has(v)) continue;
        let p, attempts = 0;
        do {
          p = { x: bbox.minX + Math.random() * bbox.w, y: bbox.minY + Math.random() * bbox.h };
        } while (!pointInPolygon(p, rPts) && ++attempts < 20);
        positions.set(v, p);
      }
      console.log(`[R:${comp.id}] non-planar root: outer face on region boundary, interior randomised`);
    }
  }

  recordAndCheckI1(treeNode, [...comp.graph.keys()], region, positions);
  console.log(`[R:${comp.id}] vertex positions: ${[...comp.graph.keys()].map(v => `${v}:(${fmt(positions.get(v))})`).join(' ')}`);
  for (const v of outerFace) {
    const p = positions.get(v);
    if (p) regions.push({ type: 'outer-face-vertex', point: p, label: String(v) });
  }
  // 6. Draw real edges
  for (const { u, v } of realEdges) {
    edges.push({ source: u, target: v, ownerCompId: treeNode.comp.id });
    log(`    real edge ${u}–${v} | (${fmt(positions.get(u))})→(${fmt(positions.get(v))})`);
  }

  // 7. Allocate child regions via greedy bipartite face matching
  //
  // Goal: assign each virtual edge an exclusive full face polygon as its region
  // (giving child components the maximum available space) using a max bipartite
  // matching so no face is double-assigned.  Virtual edges not matched fall back
  // to the current centroid-triangle approach.
  const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
  const pt      = treeNode._poleTriangle;
  const poleSetR = pt ? new Set([pt.poleUId, pt.poleVId]) : null;

  const axisDirR   = anchorU && anchorV ? normalize(sub(anchorV, anchorU)) : null;
  const rPtsR      = axisDirR ? getRegionPoints(region) : [];
  const axProjsR   = rPtsR.map(p => dot(p, axisDirR));
  const minAxProjR = axProjsR.length ? Math.min(...axProjsR) : 0;
  const maxAxProjR = axProjsR.length ? Math.max(...axProjsR) : 0;

  const outerFaceSet = new Set(outerFace);
  const isOuterFace  = (f) =>
    f && f.length === outerFace.length && f.every(id => outerFaceSet.has(id));

  // faceF2 (the non-outer face that also borders the parent virtual edge) must
  // not be allocated to children.  Using it as a child region bleeds into
  // sibling component areas because it shares the parent edge (pU–pV) which
  // coincides with the region boundary — its polygon extends to the canvas
  // boundary just like the outer face does.
  const isParentAdjNonOuter = (f) => {
    if (!f || !parentEdgeNodes || isOuterFace(f)) return false;
    const [pUn, pVn] = parentEdgeNodes;
    for (let j = 0; j < f.length; j++) {
      const a = f[j], b = f[(j + 1) % f.length];
      if ((a === pUn && b === pVn) || (a === pVn && b === pUn)) return true;
    }
    return false;
  };

  // Centroid of a face with pole-proxy substitution.
  const faceCentroid = (face) => {
    const pts = face.map(vid =>
      (treeNode._poleProxies?.get(vid) ?? positions.get(vid) ?? { x: 0, y: 0 })
    );
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
             y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  };

  // Full convex face polygon with pole-proxy substitution.
  const facePoly = (face) =>
    face.map(vid => treeNode._poleProxies?.get(vid) ?? positions.get(vid)).filter(p => p);

  // ── Pre-collect per-edge data ─────────────────────────────────────────────
  // eData[i]: null (skip) | { isPole, poleId, polePos, vtxPos } | face metadata
  const eData = childEdges.map(({ u, v, edgeId }) => {
    const childNode = childByEdgeId.get(edgeId);
    if (!childNode) return null;
    const posA = positions.get(u), posB = positions.get(v);
    if (!posA || !posB) return null;

    // P-pole short-edge special case: uses a precomputed triangle zone.
    if (poleSetR && axisDirR && (poleSetR.has(u) || poleSetR.has(v))) {
      const poleId    = poleSetR.has(u) ? u : v;
      const polePos   = positions.get(poleId);
      const vtxPos    = poleSetR.has(u) ? posB : posA;
      const vtxAxProj = dot(vtxPos, axisDirR);
      const onShortEdge = vtxAxProj <= minAxProjR + 1.0 || vtxAxProj >= maxAxProjR - 1.0;
      if (onShortEdge)
        return { isPole: true, u, v, edgeId, posA, posB, childNode, poleId, polePos, vtxPos };
      // Not on short edge: falls through to face-based logic below.
    }

    const [faceLeft, faceRight] = findBothAdjacentFaces(faces, u, v);
    const isLO       = isOuterFace(faceLeft)  || isParentAdjNonOuter(faceLeft);
    const isRO       = isOuterFace(faceRight) || isParentAdjNonOuter(faceRight);
    const trueOuterL = isOuterFace(faceLeft);
    const trueOuterR = isOuterFace(faceRight);
    const parentAdjL = isParentAdjNonOuter(faceLeft);
    const parentAdjR = isParentAdjNonOuter(faceRight);
    const innerFaces = [
      ...(faceLeft  && !isLO ? [faceLeft]  : []),
      ...(faceRight && !isRO ? [faceRight] : [])
    ];
    return { isPole: false, u, v, edgeId, posA, posB, childNode,
             faceLeft, faceRight, isLO, isRO, trueOuterL, trueOuterR, parentAdjL, parentAdjR, innerFaces };
  });

  // ── Exclusive-face assignment ─────────────────────────────────────────────
  // A virtual edge may claim a face only if NO other virtual edge is also
  // adjacent to it.  If two edges share a face, neither can claim it — both
  // fall back to centroid triangles for that face.  This prevents one child's
  // full-face region from containing another child's centroid point.
  const faceVEs = new Map();  // face → Set of ve indices adjacent to it
  for (let i = 0; i < eData.length; i++) {
    const d = eData[i];
    if (!d || d.isPole) continue;
    for (const face of d.innerFaces) {
      if (!faceVEs.has(face)) faceVEs.set(face, new Set());
      faceVEs.get(face).add(i);
    }
  }

  // For each VE, pick the first exclusive inner face (adjacent only to this VE).
  const matchVE = new Map();  // ve index → exclusive face
  for (let i = 0; i < eData.length; i++) {
    const d = eData[i];
    if (!d || d.isPole) continue;
    for (const face of d.innerFaces) {
      if ((faceVEs.get(face)?.size ?? 0) === 1) {
        matchVE.set(i, face);
        break;
      }
    }
  }

  log(`  [R] exclusive face assignment: ${matchVE.size}/${eData.filter(d => d && !d.isPole).length} edges get a full face`);
  console.log(`[R:${comp.id}] child regions: ${childEdges.length} virtual edges, ${matchVE.size}/${eData.filter(d => d && !d.isPole).length} get exclusive face`);

  // ── Emit child regions ─────────────────────────────────────────────────────
  for (let i = 0; i < eData.length; i++) {
    const d = eData[i];
    if (!d) continue;
    const { u, v, posA, posB, childNode } = d;

    // ── P-pole short-edge triangle (unchanged path) ───────────────────────
    if (d.isPole) {
      const { poleId, polePos, vtxPos } = d;
      const cornerC  = poleId === pt.poleUId ? pt.cornerU      : pt.cornerV;
      const outerD   = poleId === pt.poleUId ? pt.outerCornerU : pt.outerCornerV;
      const isRChild = childNode.comp.type !== 'S';
      const regionPts = isRChild ? [polePos, cornerC, outerD] : [polePos, vtxPos, cornerC];
      log(`  [R] P-child pole-edge (short-edge): pole=${poleId}@(${fmt(polePos)}) vtx@(${fmt(vtxPos)}) cornerC=(${fmt(cornerC)}) outerD=(${fmt(outerD)}) R=${isRChild} → triangle`);
      drawSubtree(childNode, { type: 'polygon', points: regionPts }, posA, posB, positions, edges, regions);
      continue;
    }

    const { faceLeft, faceRight, isLO, isRO, trueOuterL, trueOuterR, parentAdjL, parentAdjR } = d;

    // ── Full-face region (exclusive face) ──────────────────────────────────
    const matchedFace = matchVE.get(i);
    if (matchedFace) {
      const pts = facePoly(matchedFace);
      if (pts.length >= 3) {
        let regionPoints = pts;

        // Helper: extract the longer cyclic path from posA to posB through
        // the exclusive-face interior (avoids the direct VE edge, which is
        // always the shorter path).
        const extractInnerPath = () => {
          const iA = pts.indexOf(posA), iB = pts.indexOf(posB);
          if (iA === -1 || iB === -1 || iA === iB) return null;
          const n = pts.length;
          const fwdPath = [];
          for (let k = 0; k <= n; k++) {
            const idx = (iA + k) % n;
            fwdPath.push(pts[idx]);
            if (idx === iB && k > 0) break;
          }
          const bwdPath = [];
          for (let k = 0; k <= n; k++) {
            const idx = (iA - k + n) % n;
            bwdPath.push(pts[idx]);
            if (idx === iB && k > 0) break;
          }
          return fwdPath.length >= bwdPath.length ? fwdPath : bwdPath;
        };

        if (trueOuterL || trueOuterR) {
          // Adjacent to the true outer face: extend with the 15%-inset strip.
          const innerPath = extractInnerPath();
          if (innerPath) {
            const outerArc = projectOuterRegion(region, posA, posB, faceCentroid(matchedFace));
            if (outerArc) {
              regionPoints = [...innerPath, ...outerArc];
              log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face+outerStrip (${regionPoints.length} verts)`);
            } else {
              log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face (outerStrip null, ${pts.length} verts)`);
            }
          } else {
            log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face (outerStrip skipped, ${pts.length} verts)`);
          }
        } else if (parentAdjL || parentAdjR) {
          // Adjacent to the parent-VE face: extend with a centroid triangle
          // from that face so the child gets depth on both sides of its VE.
          const innerPath = extractInnerPath();
          if (innerPath) {
            const parentAdjFace = parentAdjL ? faceLeft : faceRight;
            regionPoints = [...innerPath, faceCentroid(parentAdjFace)];
            log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face+parentAdj (${regionPoints.length} verts)`);
          } else {
            log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face (parentAdj skipped, ${pts.length} verts)`);
          }
        } else {
          log(`  [R] child ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) full-face (${pts.length} verts)`);
        }

        if (childNode.comp.type === 'S' && !isLO && !isRO) {
          childNode._rFaceLeftIds  = faceLeft  ?? [];
          childNode._rFaceRightIds = faceRight ?? [];
        }
        drawSubtree(childNode, { type: 'polygon', points: regionPoints }, posA, posB, positions, edges, regions);
        continue;
      }
    }

    // ── Centroid fallback (shared face or degenerate polygon) ─────────────
    log(`  [R] child edge ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) faceLeft=[${faceLeft?.join(',') ?? 'none'}] faceRight=[${faceRight?.join(',') ?? 'none'}] (centroid fallback)`);

    let childRegion;
    if (isLO && isRO) {
      // Both faces excluded. If either is a parentAdj face, its centroid is
      // still usable (it's an interior face, just shares the parent boundary).
      if (parentAdjL && parentAdjR) {
        childRegion = { type: 'polygon', points: [posA, faceCentroid(faceLeft), posB, faceCentroid(faceRight)] };
        log(`  [R] child both-parentAdj centroids`);
      } else if (parentAdjL) {
        childRegion = { type: 'polygon', points: [posA, faceCentroid(faceLeft), posB] };
        log(`  [R] child parentAdj-L centroid`);
      } else if (parentAdjR) {
        childRegion = { type: 'polygon', points: [posA, faceCentroid(faceRight), posB] };
        log(`  [R] child parentAdj-R centroid`);
      } else {
        childRegion = edgeBoundingBox(posA, posB, 60);
        log(`  [R] child assigned fallback (both faces outer)`);
      }
    } else if (isLO) {
      if (faceRight) {
        const cInner = faceCentroid(faceRight);
        if (parentAdjL) {
          // faceLeft is parentAdj (not the true outer face): include its centroid.
          childRegion = { type: 'polygon', points: [posA, faceCentroid(faceLeft), posB, cInner] };
          log(`  [R] child both-centroids (faceLeft parentAdj)`);
        } else {
          const outerArc = projectOuterRegion(region, posA, posB, cInner);
          childRegion = { type: 'polygon', points: outerArc
            ? [posA, cInner, posB, ...outerArc] : [posA, cInner, posB] };
          log(`  [R] child inner+outer (faceLeft is outer)${outerArc ? ` (${outerArc.length} pts)` : ''}`);
        }
      } else {
        childRegion = edgeBoundingBox(posA, posB, 60);
        log(`  [R] child fallback (faceLeft outer, no faceRight)`);
      }
    } else if (isRO) {
      if (faceLeft) {
        const cInner = faceCentroid(faceLeft);
        if (parentAdjR) {
          // faceRight is parentAdj (not the true outer face): include its centroid.
          childRegion = { type: 'polygon', points: [posA, cInner, posB, faceCentroid(faceRight)] };
          log(`  [R] child both-centroids (faceRight parentAdj)`);
        } else {
          const outerArc = projectOuterRegion(region, posA, posB, cInner);
          childRegion = { type: 'polygon', points: outerArc
            ? [posA, cInner, posB, ...outerArc] : [posA, cInner, posB] };
          log(`  [R] child inner+outer (faceRight is outer)${outerArc ? ` (${outerArc.length} pts)` : ''}`);
        }
      } else {
        childRegion = edgeBoundingBox(posA, posB, 60);
        log(`  [R] child fallback (faceRight outer, no faceLeft)`);
      }
    } else if (faceLeft && faceRight) {
      childRegion = { type: 'polygon', points: [posA, faceCentroid(faceLeft), posB, faceCentroid(faceRight)] };
      log(`  [R] child both-triangles`);
    } else if (faceLeft) {
      childRegion = { type: 'polygon', points: [posA, faceCentroid(faceLeft), posB] };
    } else if (faceRight) {
      childRegion = { type: 'polygon', points: [posA, faceCentroid(faceRight), posB] };
    } else {
      childRegion = edgeBoundingBox(posA, posB, 60);
    }

    if (childNode.comp.type === 'S' && !isLO && !isRO) {
      childNode._rFaceLeftIds  = faceLeft  ?? [];
      childNode._rFaceRightIds = faceRight ?? [];
    }
    drawSubtree(childNode, childRegion, posA, posB, positions, edges, regions);
  }
}

// Find both faces adjacent to edge {u,v}.
// faceForward  = face to the LEFT  of u→v (contains directed half-edge u→v)
// faceBackward = face to the LEFT  of v→u (contains directed half-edge v→u)
//              = face to the RIGHT of u→v
// Together these are the two distinct faces on either side of the edge.
//
// NOTE: Virtual edges may be stored in arbitrary order (u,v) or (v,u). This function
// searches for both possible directions to ensure both adjacent faces are found.
// BFS shortest path from `from` to `to`, skipping the direct from→to edge.
// Returns [from, w1, ..., to] — the "far arc" of a cycle, used as an outer
// face for non-planar R components.
function findShortestCycleArc(graph, from, to) {
  const parent = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const u = queue.shift();
    for (const v of (graph.get(u) || [])) {
      if (u === from && v === to) continue;  // skip direct from→to edge
      if (parent.has(v)) continue;
      parent.set(v, u);
      if (v === to) {
        const path = [];
        let cur = v;
        while (cur !== null) { path.push(cur); cur = parent.get(cur); }
        return path.reverse();
      }
      queue.push(v);
    }
  }
  return [from, to];  // degenerate: no other path exists
}

function findBothAdjacentFaces(faces, u, v) {
  let faceForward = null, faceBackward = null;
  
  // Try original direction first (u→v and v→u)
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (a === u && b === v) faceForward  = face;
      if (a === v && b === u) faceBackward = face;
    }
    if (faceForward && faceBackward) break;
  }
  
  // If we didn't find both faces, the edge vertices might be swapped in the embedding.
  // Retry with reversed direction (v→u and u→v).
  if (!faceForward || !faceBackward) {
    const tempForward = faceForward, tempBackward = faceBackward;
    faceForward = null;
    faceBackward = null;
    for (const face of faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i + 1) % face.length];
        if (a === v && b === u) faceForward  = face;
        if (a === u && b === v) faceBackward = face;
      }
      if (faceForward && faceBackward) break;
    }
    // If retry still doesn't give us both, restore any partial results from first attempt
    if (!faceForward && tempForward) faceForward = tempForward;
    if (!faceBackward && tempBackward) faceBackward = tempBackward;
  }
  
  return [faceForward, faceBackward];
}

// Scale rawPos (unit-circle Tutte coords) to fit the allocated region
function scaleRegion(rawPos, region) {
  if (region.type === 'rect') {
    const scaled = scaleToBox(rawPos, region.w, region.h, 40);
    return shiftPositions(scaled, region.x, region.y);
  }
  // For polygon regions, use bounding box approach
  const bbox = regionBBox(region);
  const out = scaleToBox(rawPos, bbox.w, bbox.h, 20);
  return shiftPositions(out, bbox.minX, bbox.minY);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function edgeKey(u, v) { return u < v ? `${u},${v}` : `${v},${u}`; }
function edgeRouteKey(u, v) { return Number(u) < Number(v) ? `${Number(u)}-${Number(v)}` : `${Number(v)}-${Number(u)}`; }
function dist(a, b) { return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function normalize(v) { const l = Math.sqrt(v.x * v.x + v.y * v.y) || 1; return { x: v.x / l, y: v.y / l }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function perp(v) { return { x: -v.y, y: v.x }; }  // 90° CCW
function dot(a, b) { return a.x * b.x + a.y * b.y; }

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(p, a, b, eps = 1e-7) {
  if (Math.abs(orientation(a, b, p)) > eps) return false;
  return p.x >= Math.min(a.x, b.x) - eps
      && p.x <= Math.max(a.x, b.x) + eps
      && p.y >= Math.min(a.y, b.y) - eps
      && p.y <= Math.max(a.y, b.y) + eps;
}

function segmentsIntersect(a, b, c, d, eps = 1e-7) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))
      && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) {
    return true;
  }
  return (Math.abs(o1) <= eps && pointOnSegment(c, a, b, eps))
      || (Math.abs(o2) <= eps && pointOnSegment(d, a, b, eps))
      || (Math.abs(o3) <= eps && pointOnSegment(a, c, d, eps))
      || (Math.abs(o4) <= eps && pointOnSegment(b, c, d, eps));
}

/**
 * Return all crossings between nonincident skeleton edges. The parent virtual
 * edge can be excluded: it is an auxiliary boundary edge and is not rendered
 * in the expanded graph.
 */
export function findComponentStraightLineCrossings(graph, positions, excludedEdgeKeys = new Set()) {
  const graphEdges = [];
  const seen = new Set();
  for (const [u, nbrs] of graph) {
    for (const v of nbrs) {
      const key = edgeKey(u, v);
      if (seen.has(key) || excludedEdgeKeys.has(key)) continue;
      seen.add(key);
      graphEdges.push({ u, v, key });
    }
  }

  const crossings = [];
  for (let i = 0; i < graphEdges.length; i++) {
    const e1 = graphEdges[i];
    const a = positions.get(e1.u), b = positions.get(e1.v);
    if (!a || !b) continue;
    for (let j = i + 1; j < graphEdges.length; j++) {
      const e2 = graphEdges[j];
      if (e1.u === e2.u || e1.u === e2.v || e1.v === e2.u || e1.v === e2.v) continue;
      const c = positions.get(e2.u), d = positions.get(e2.v);
      if (c && d && segmentsIntersect(a, b, c, d)) crossings.push([e1, e2]);
    }
  }
  return crossings;
}

function routedEdgePolyline(edge, positions, routes) {
  const source = positions.get(Number(edge.source));
  const target = positions.get(Number(edge.target));
  if (!source || !target) return [];
  const route = routes?.get(edgeRouteKey(edge.source, edge.target));
  return [source, ...orientedRoutePoints(edge, route), target];
}

/**
 * Check the final logical drawing, including polyline bends.  The only allowed
 * contact between two different edges is their common graph endpoint.
 */
export function findRoutedDrawingPlanarityViolations(
  positions,
  edges,
  routes = new Map(),
  eps = 1e-7
) {
  const violations = [];
  const polylines = edges.map(edge => routedEdgePolyline(edge, positions, routes));

  const samePoint = (a, b) => dist(a, b) <= eps;
  const strictCross = (a, b, c, d) => {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    return ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))
        && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
  };

  // A single routed edge must itself remain simple.
  for (let i = 0; i < edges.length; i++) {
    const polyline = polylines[i];
    for (let a = 0; a + 1 < polyline.length; a++) {
      for (let b = a + 2; b + 1 < polyline.length; b++) {
        if (segmentsIntersect(polyline[a], polyline[a + 1], polyline[b], polyline[b + 1], eps)) {
          violations.push({ type: 'edge-self-intersection', edge: edges[i], segments: [a, b] });
        }
      }
    }
  }

  for (let i = 0; i < edges.length; i++) {
    const edgeA = edges[i];
    const idsA = [Number(edgeA.source), Number(edgeA.target)];
    for (let j = i + 1; j < edges.length; j++) {
      const edgeB = edges[j];
      const idsB = [Number(edgeB.source), Number(edgeB.target)];
      const sharedIds = idsA.filter(id => idsB.includes(id));
      const sharedPoint = sharedIds.length === 1 ? positions.get(sharedIds[0]) : null;

      const polyA = polylines[i];
      const polyB = polylines[j];
      for (let a = 0; a + 1 < polyA.length; a++) {
        for (let b = 0; b + 1 < polyB.length; b++) {
          const a0 = polyA[a], a1 = polyA[a + 1];
          const b0 = polyB[b], b1 = polyB[b + 1];
          if (!segmentsIntersect(a0, a1, b0, b1, eps)) continue;

          if (strictCross(a0, a1, b0, b1)) {
            violations.push({
              type: 'edge-crossing',
              edges: [edgeA, edgeB],
              segments: [a, b]
            });
            continue;
          }

          const contacts = [];
          for (const point of [a0, a1]) {
            if (pointOnSegment(point, b0, b1, eps)) contacts.push(point);
          }
          for (const point of [b0, b1]) {
            if (pointOnSegment(point, a0, a1, eps)) contacts.push(point);
          }
          const allowedAtSharedVertex = sharedPoint
            && contacts.length > 0
            && contacts.every(point => samePoint(point, sharedPoint));
          if (!allowedAtSharedVertex) {
            violations.push({
              type: 'edge-contact-or-overlap',
              edges: [edgeA, edgeB],
              segments: [a, b]
            });
          }
        }
      }
    }
  }

  // No edge may contain a nonincident graph vertex.
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const endpoints = new Set([Number(edge.source), Number(edge.target)]);
    const polyline = polylines[i];
    for (const [vertexId, point] of positions) {
      if (endpoints.has(Number(vertexId))) continue;
      for (let segment = 0; segment + 1 < polyline.length; segment++) {
        if (pointOnSegment(point, polyline[segment], polyline[segment + 1], eps)) {
          violations.push({
            type: 'edge-through-vertex',
            edge,
            vertexId,
            segment
          });
          break;
        }
      }
    }
  }

  return violations;
}

/** Reflect point P across the infinite line through A and B. */
function reflectPoint(P, A, B) {
  const AB = sub(B, A);
  const t  = dot(sub(P, A), AB) / dot(AB, AB);
  const foot = add(A, scale(AB, t));
  return { x: 2 * foot.x - P.x, y: 2 * foot.y - P.y };
}

/**
 * First point where ray (origin + t·dir, t>0) crosses any edge of the polygon
 * defined by `pts`. Returns null if no intersection is found.
 */
function rayFirstBoundaryHit(pts, origin, dir) {
  let minT = Infinity, best = null;
  for (let i = 0; i < pts.length; i++) {
    const t = raySegmentIntersect(origin, dir, pts[i], pts[(i + 1) % pts.length]);
    if (t !== null && t > 1e-6 && t < minT) {
      minT = t;
      best = { x: origin.x + t * dir.x, y: origin.y + t * dir.y };
    }
  }
  return best;
}

/**
 * First point where ray (origin + t·dir, t>0) crosses any edge of the polygon.
 * Returns {point, edgeIdx} or null.
 */
function rayHitOnFace(facePts, origin, dir) {
  let minT = Infinity, best = null, bestEdge = -1;
  for (let i = 0; i < facePts.length; i++) {
    const t = raySegmentIntersect(origin, dir, facePts[i], facePts[(i + 1) % facePts.length]);
    if (t !== null && t > 1e-6 && t < minT) {
      minT = t;
      best = { x: origin.x + t * dir.x, y: origin.y + t * dir.y };
      bestEdge = i;
    }
  }
  return best ? { point: best, edgeIdx: bestEdge } : null;
}

/**
 * Walk the boundary of facePts from H_A (on edge hitEdgeA) to H_B (on edge hitEdgeB),
 * going in the direction that avoids traversing avoidEdge.
 * Returns intermediate face vertices (excluding H_A and H_B themselves).
 */
function faceArcAvoiding(facePts, hitEdgeA, hitEdgeB, avoidEdge) {
  const n = facePts.length;
  if (n === 0 || hitEdgeA < 0 || hitEdgeB < 0 || hitEdgeA === hitEdgeB) return [];

  // Check whether the forward arc [hitEdgeA .. hitEdgeB] (cyclically) contains avoidEdge.
  const fwdContainsAvoid = hitEdgeA <= hitEdgeB
    ? (avoidEdge >= hitEdgeA && avoidEdge <= hitEdgeB)
    : (avoidEdge >= hitEdgeA || avoidEdge <= hitEdgeB);

  const arc = [];
  if (!fwdContainsAvoid) {
    // Forward: include vertices from (hitEdgeA+1)%n up to hitEdgeB (inclusive).
    for (let k = 1; k <= n; k++) {
      const idx = (hitEdgeA + k) % n;
      arc.push(facePts[idx]);
      if (idx === hitEdgeB) break;
    }
  } else {
    // Backward: include vertices from hitEdgeA down to (hitEdgeB+1)%n (inclusive).
    for (let k = 0; k < n; k++) {
      const idx = (hitEdgeA - k + n) % n;
      arc.push(facePts[idx]);
      if (idx === (hitEdgeB + 1) % n) break;
    }
  }
  return arc;
}

/**
 * Walk the boundary of regionPts from H_start (on edge edgeStart) to H_end (on edge edgeEnd),
 * returning the intermediate vertices of the arc that lies on the outward side.
 * `edgeMid` is a reference point on the u-v line; `outward` is the unit vector
 * pointing away from the inner region (perpendicular to u-v, away from innerPt).
 * The arc whose centroid scores highest along `outward` from `edgeMid` is returned.
 */
function regionOutwardArc(regionPts, edgeStart, edgeEnd, edgeMid, outward) {
  const n = regionPts.length;
  if (n === 0 || edgeStart < 0 || edgeEnd < 0 || edgeStart === edgeEnd) return [];

  // Forward arc: vertices from (edgeStart+1)%n up to edgeEnd (inclusive)
  const fwdVerts = [];
  for (let k = 1; k <= n; k++) {
    const idx = (edgeStart + k) % n;
    fwdVerts.push(regionPts[idx]);
    if (idx === edgeEnd) break;
  }

  // Backward arc: vertices from edgeStart down to (edgeEnd+1)%n (inclusive)
  const bwdVerts = [];
  for (let k = 0; k < n; k++) {
    const idx = (edgeStart - k + n) % n;
    bwdVerts.push(regionPts[idx]);
    if (idx === (edgeEnd + 1) % n) break;
  }

  // Pick the arc whose centroid is further in the outward direction from edgeMid.
  const arcCentroid = verts => verts.length === 0 ? edgeMid : {
    x: verts.reduce((s, p) => s + p.x, 0) / verts.length,
    y: verts.reduce((s, p) => s + p.y, 0) / verts.length
  };
  const score = verts => dot(sub(arcCentroid(verts), edgeMid), outward);
  return score(fwdVerts) >= score(bwdVerts) ? fwdVerts : bwdVerts;
}

/**
 * Project rays from the region centroid through posA and posB onto the region
 * boundary.  Returns [H_v, ...arc..., H_u] — the outward boundary arc from the
 * posB-projection to the posA-projection — to be appended after posB in the
 * combined child-region polygon [posA, innerPt, posB, H_v, ...arc..., H_u].
 * `innerPt` is the inner anchor (e.g. face centroid or circle centre) and is
 * used to determine which side of posA-posB is "outward".
 * Returns null if either projection fails.
 */
function projectOuterRegion(region, posA, posB, innerPt) {
  const regionPts = getRegionPoints(region);
  const ctr       = regionCentroid(region);

  const rU = rayHitOnFace(regionPts, ctr, normalize(sub(posA, ctr)));
  const rV = rayHitOnFace(regionPts, ctr, normalize(sub(posB, ctr)));
  if (!rU || !rV) return null;

  const H_u = rU.point, edgeU = rU.edgeIdx;
  const H_v = rV.point, edgeV = rV.edgeIdx;

  // Outward direction: perpendicular to posA-posB, pointing away from innerPt.
  const edgeDir = normalize(sub(posB, posA));
  const perpOpt = perp(edgeDir);
  const edgeMid = midpoint(posA, posB);
  const ref     = innerPt ?? ctr;
  const outward = dot(sub(ref, edgeMid), perpOpt) >= 0
    ? { x: -perpOpt.x, y: -perpOpt.y }
    : perpOpt;

  const arc = regionOutwardArc(regionPts, edgeV, edgeU, edgeMid, outward);
  return [H_v, ...arc, H_u];
}

/** Signed area of triangle (a, b, c); absolute value = area. */
function triangleArea(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function rayRayIntersect(p1, d1, p2, d2) {
  // Solve p1 + t*d1 = p2 + s*d2  →  t = cross(p2-p1, d2) / cross(d1, d2)
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-10) return null;  // parallel
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / denom;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

function outwardPerpApex(a, b, outwardHintDir, ratio = 0.5) {
  const edge = sub(b, a);
  const len = Math.hypot(edge.x, edge.y);
  if (len < 1e-9) return null;

  const edgeDir = { x: edge.x / len, y: edge.y / len };
  const n1 = perp(edgeDir);
  const n2 = { x: -n1.x, y: -n1.y };
  const hint = outwardHintDir ? normalize(outwardHintDir) : n1;
  const n = dot(n1, hint) >= dot(n2, hint) ? n1 : n2;

  const mid = midpoint(a, b);
  const d = Math.max(0, ratio) * len;
  return add(mid, scale(n, d));
}

/**
 * Arc-length parameterised interpolation along a polyline.
 * @param {Array<{x,y}>} path  — ordered waypoints
 * @param {number}       t     — fraction in [0,1]
 */
function interpolateOnPath(path, t) {
  const segLen = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(path[i+1].x - path[i].x, path[i+1].y - path[i].y);
    segLen.push(d);
    total += d;
  }
  if (total < 1e-10) return { ...path[0] };
  const target = t * total;
  let accum = 0;
  for (let i = 0; i < segLen.length; i++) {
    if (accum + segLen[i] >= target - 1e-10) {
      const lt = segLen[i] < 1e-10 ? 0 : (target - accum) / segLen[i];
      return {
        x: path[i].x + lt * (path[i+1].x - path[i].x),
        y: path[i].y + lt * (path[i+1].y - path[i].y),
      };
    }
    accum += segLen[i];
  }
  return { ...path[path.length - 1] };
}


// ─── Region helpers ───────────────────────────────────────────────────────────

function getRegionPoints(region) {
  if (region.type === 'rect') {
    return [
      { x: region.x,            y: region.y },
      { x: region.x + region.w, y: region.y },
      { x: region.x + region.w, y: region.y + region.h },
      { x: region.x,            y: region.y + region.h }
    ];
  }
  return region.points || [];
}


function regionCentroid(region) {
  const pts = getRegionPoints(region);
  if (!pts.length) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

function regionBBox(region) {
  const pts = getRegionPoints(region);
  const minX = Math.min(...pts.map(p => p.x));
  const maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  const maxY = Math.max(...pts.map(p => p.y));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * How far can we go from the u-v midline in `dir` before leaving the region?
 * Samples from the 25%, 50%, and 75% points along posU→posV (the "inside
 * corners" of the child rectangle at the near edge) and returns the minimum,
 * ensuring the far edge of the allocated parallelogram stays inside the region.
 */
function perpExtentIntoRegion(region, posU, posV, dir) {
  const pts = getRegionPoints(region);
  const n   = pts.length;

  const rayExtent = (origin) => {
    let minT = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const t = raySegmentIntersect(origin, dir, a, b);
      if (t !== null && t > 1e-6 && t < minT) minT = t;
    }
    return minT;
  };

  const lerp = (t) => ({ x: posU.x + t * (posV.x - posU.x), y: posU.y + t * (posV.y - posU.y) });
  const best = Math.min(rayExtent(lerp(0.25)), rayExtent(lerp(0.5)), rayExtent(lerp(0.75)));
  return best === Infinity ? 100 : best;
}

function rayExtentToBoundary(region, origin, dir) {
  const pts = getRegionPoints(region);
  if (!pts || pts.length < 3) return 0;
  let minT = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const t = raySegmentIntersect(origin, dir, a, b);
    if (t !== null && t > 1e-6 && t < minT) minT = t;
  }
  return Number.isFinite(minT) ? minT : 0;
}


/**
 * Ray-segment intersection.
 * Ray: origin + t*dir, Segment: a..b.
 * Returns t (>0) or null.
 */
function raySegmentIntersect(origin, dir, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const denom = dir.x * dy - dir.y * dx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denom;
  const s = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;
  if (s < -1e-9 || s > 1 + 1e-9) return null;
  return t;
}

/** Ray-casting point-in-polygon test for any simple polygon. */
function pointInPolygon(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Bounding box region around edge (a,b) with given half-thickness */
function edgeBoundingBox(a, b, halfThick) {
  const axis    = normalize(sub(b, a));
  const perpDir = perp(axis);
  return {
    type: 'polygon',
    points: [
      sub(a, scale(perpDir, halfThick)),
      add(a, scale(perpDir, halfThick)),
      add(b, scale(perpDir, halfThick)),
      sub(b, scale(perpDir, halfThick))
    ]
  };
}

// ─── Invariant-checking helpers ───────────────────────────────────────────────

/**
 * Record ownership of `vertexIds` by `treeNode`, then assert I1:
 * every vertex of the component's skeleton lies inside (or on the boundary of)
 * its assigned region.
 */
function recordAndCheckI1(treeNode, vertexIds, region, positions) {
  for (const vid of vertexIds) {
    if (!_vertexToNode.has(vid)) _vertexToNode.set(vid, treeNode);
  }
  if (!CHECK_INVARIANTS) return;
  const pts = getRegionPoints(region);
  if (pts.length < 3) return;
  const compId = treeNode.comp.id;
  for (const vid of vertexIds) {
    const p = positions.get(vid);
    if (!p) continue;
    if (!_pointInPolyOrBoundary(p, pts, INV_TOL)) {
      const msg = `[I1] comp=${compId}(${treeNode.comp.type}) vertex=${vid} at (${p.x.toFixed(1)},${p.y.toFixed(1)}) outside assigned region`;
      log(msg); console.warn(msg);
    }
  }
}

/** Point-in-polygon with boundary tolerance. */
function _pointInPolyOrBoundary(pt, pts, tol) {
  if (pointInPolygon(pt, pts)) return true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ab = sub(b, a);
    const len2 = ab.x * ab.x + ab.y * ab.y;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(pt, a), ab) / len2));
    const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
    if (Math.hypot(pt.x - proj.x, pt.y - proj.y) <= tol) return true;
  }
  return false;
}

/**
 * I2: For every pair of component regions, assert they are either disjoint or
 * one fully contains the other (laminar family).
 */
function checkI2(nodeRegions) {
  if (!CHECK_INVARIANTS) return;
  const n = nodeRegions.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { region: rA, node: nA } = nodeRegions[i];
      const { region: rB, node: nB } = nodeRegions[j];
      const ptsA = getRegionPoints(rA);
      const ptsB = getRegionPoints(rB);
      if (ptsA.length < 3 || ptsB.length < 3) continue;

      const aInB = ptsA.every(p => _pointInPolyOrBoundary(p, ptsB, INV_TOL));
      const bInA = ptsB.every(p => _pointInPolyOrBoundary(p, ptsA, INV_TOL));
      if (aInB || bInA) continue; // nested — ok

      // Disjoint check: no corner of A strictly inside B and vice versa, no edge crossings
      const anyAinB = ptsA.some(p => pointInPolygon(p, ptsB));
      const anyBinA = ptsB.some(p => pointInPolygon(p, ptsA));
      if (anyAinB || anyBinA) {
        const msg = `[I2] Regions ${nA.comp.id}(${nA.comp.type}) and ${nB.comp.id}(${nB.comp.type}) partially overlap (corners penetrate)`;
        log(msg); console.warn(msg);
        continue;
      }
      // Check for proper edge crossings
      let crosses = false;
      outer: for (let a = 0; a < ptsA.length && !crosses; a++) {
        const a1 = ptsA[a], a2 = ptsA[(a + 1) % ptsA.length];
        const dA = sub(a2, a1);
        const lenA = Math.hypot(dA.x, dA.y);
        for (let b = 0; b < ptsB.length; b++) {
          const t = raySegmentIntersect(a1, dA, ptsB[b], ptsB[(b + 1) % ptsB.length]);
          if (t !== null && t > INV_TOL && t < lenA - INV_TOL) { crosses = true; break; }
        }
      }
      if (crosses) {
        const msg = `[I2] Regions ${nA.comp.id}(${nA.comp.type}) and ${nB.comp.id}(${nB.comp.type}) have crossing edges (neither nested nor disjoint)`;
        log(msg); console.warn(msg);
      }
    }
  }
}

/**
 * I3: For every region S_n, every vertex whose canvas position lies inside S_n
 * must have been placed by c_n itself or one of its descendants in the SPQR tree.
 */
function checkI3(nodeRegions, vertexToNode, positions) {
  if (!CHECK_INVARIANTS) return;
  for (const { node, region } of nodeRegions) {
    const pts = getRegionPoints(region);
    if (pts.length < 3) continue;
    for (const [vid, pos] of positions) {
      if (!pointInPolygon(pos, pts)) continue;
      const owner = vertexToNode.get(vid);
      if (!owner) continue;
      if (!_isAncestorOrSelf(node, owner)) {
        const msg = `[I3] comp=${node.comp.id}(${node.comp.type}): vertex ${vid} is geometrically inside this region but belongs to ${owner.comp.id}(${owner.comp.type}), which is not a descendant`;
        log(msg); console.warn(msg);
      }
    }
  }
}

/** Returns true if `ancestor` is the same node as `node` or lies on the path to the root. */
function _isAncestorOrSelf(ancestor, node) {
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

/** Fallback: place all vertices on a unit circle */
function fallbackCircleLayout(graph) {
  const verts = [...graph.keys()];
  const n     = verts.length;
  const pos   = new Map();
  verts.forEach((v, i) => {
    const angle = (2 * Math.PI * i) / n;
    pos.set(v, { x: Math.cos(angle), y: Math.sin(angle) });
  });
  return pos;
}

/** Shift all positions by (dx, dy) */
function shiftPositions(posMap, dx, dy) {
  const out = new Map();
  for (const [v, { x, y }] of posMap) out.set(v, { x: x + dx, y: y + dy });
  return out;
}
