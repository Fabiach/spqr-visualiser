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

export const P_REAL_EDGE_SLOT = Symbol('P_REAL_EDGE_SLOT');

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
 * @returns {{ positions: Map, edges: Array, tree: object, regions: Array, edgeRoutes: Map }}
 */
export function computeGraphDrawing(spqrRoot, spqrTree, virtualEdgeData, canvasW, canvasH) {
  const positions = new Map();   // vertexId → {x, y}
  const edges     = [];          // {source, target}
  const regions   = [];          // debug overlays

  _logLines = [];
  log(`=== computeGraphDrawing ===`);
  log(`Canvas: ${canvasW}×${canvasH} | components: ${spqrTree.length} | root: ${spqrRoot.id} (${spqrRoot.type})`);

  const rootNode = buildRootedTree(spqrRoot, spqrTree, virtualEdgeData);
  log(`Tree built. Root children: [${rootNode.children.map(c => `${c.comp.id}(${c.comp.type})`).join(', ')}]`);

  const rootRegion = { type: 'rect', x: 0, y: 0, w: canvasW, h: canvasH };
  drawSubtree(rootNode, rootRegion, null, null, positions, edges, regions);

  log(`--- Done: positions=${positions.size}, edges=${edges.length}, regions=${regions.length} ---`);
  downloadLog();
  return { positions, edges, tree: rootNode, regions, edgeRoutes: new Map() };
}

// ─── Log buffer + download export ────────────────────────────────────────────

let _logLines = [];
function log(msg) { _logLines.push(msg); }

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

  const anchorStr = anchorU ? `anchors=(${fmt(anchorU)})→(${fmt(anchorV)})` : 'root';
  log(`\n[drawSubtree] ${comp.id}(${comp.type}) | parentEdge=${parentEdgeId ?? 'none'} | ${anchorStr}`);
  log(`  region: ${regionDesc(region)}`);

  // Add region overlay for debugging (main.js expects {type, points})
  const pts = getRegionPoints(region);
  if (pts.length >= 3) regions.push({ type: comp.type, points: pts, label: comp.id });

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

  // Determine poles
  let poleU, poleV, poleUId, poleVId;
  if (anchorU && parentEdgeNodes) {
    poleUId = parentEdgeNodes[0];
    poleVId = parentEdgeNodes[1];
    poleU = anchorU;
    poleV = anchorV;
    positions.set(poleUId, poleU);
    positions.set(poleVId, poleV);
    log(`  [S] child poles: u=${poleUId}@(${fmt(poleU)}) v=${poleVId}@(${fmt(poleV)})`);
  } else {
    // Root S: place poles at left/right of region
    const cx = regionCentroid(region);
    poleUId = comp.graph.keys().next().value;
    poleVId = findCycleMidpoint(comp.graph, poleUId);
    poleU = { x: regionLeft(region) + 40, y: cx.y };
    poleV = { x: regionRight(region) - 40, y: cx.y };
    positions.set(poleUId, poleU);
    positions.set(poleVId, poleV);
    log(`  [S] root poles: u=${poleUId}@(${fmt(poleU)}) v=${poleVId}@(${fmt(poleV)})`);
  }

  // Traverse cycle arc from poleU to poleV (avoiding parent virtual edge)
  const path = traverseCycleArc(comp.graph, poleUId, poleVId, parentEdgeNodes);
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

  // --- P-child layout ---
  // When this S is a direct child of P, the poles lie outside the lane rectangle.
  // Instead of an arc, place inner vertices on a straight line through the region centre.
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

      for (const { u, v } of realEdges) {
        edges.push({ source: u, target: v });
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
            // Multi-vertex S: vtxPos is at topMid/botMid on the pole-facing short edge.
            // Use the inner-sibling corner (C) and current-lane far corner (D) from
            // the _poleTriangle metadata attached by drawP.
            const pt      = treeNode._poleTriangle;
            const cornerC = pt ? (poleId === pt.poleUId ? pt.cornerU      : pt.cornerV)      : null;
            const outerD  = pt ? (poleId === pt.poleUId ? pt.outerCornerU : pt.outerCornerV) : null;
            if (cornerC && outerD) {
              const isRChild = childNode.comp.type !== 'S';
              const boostedOutward = isRChild && pt?.rootOutermostBoost && pt?.laneDir;
              let regionPts;
              if (boostedOutward) {
                const apex = outwardPerpApex(polePos, vtxPos, pt.laneDir, 0.5);
                if (childNode.comp.type === 'P') {
                  regionPts = apex ? [polePos, cornerC, apex] : [polePos, cornerC, outerD];
                  // Clamp P-child inward growth by the inner boundary corner.
                  childNode._laneDepthRegion = { type: 'polygon', points: [polePos, vtxPos, cornerC] };
                } else {
                  regionPts = apex ? [polePos, cornerC, apex] : [polePos, cornerC, outerD];
                  childNode._laneDepthRegion = null;
                }
                log(`  [S] P-child pole-edge (short-edge apex): pole=${poleId}@(${fmt(polePos)}) cornerC=(${fmt(cornerC)}) vtx@(${fmt(vtxPos)}) apex=(${fmt(apex)}) child=${childNode.comp.type} → region`);
              } else {
                childNode._laneDepthRegion = null;
                regionPts = isRChild
                  ? [polePos, cornerC, outerD]
                  : [polePos, vtxPos, cornerC];
                log(`  [S] P-child pole-edge (short-edge): pole=${poleId}@(${fmt(polePos)}) vtx@(${fmt(vtxPos)}) cornerC=(${fmt(cornerC)}) outerD=(${fmt(outerD)}) R=${isRChild} → triangle region`);
              }
              const childRegion = {
                type: 'polygon',
                points: regionPts,
                autoFlipIfR: boostedOutward,
                preferOutsideDir: boostedOutward ? pt.laneDir : null
              };
              drawSubtree(childNode, childRegion, posARaw, posBRaw, positions, edges, regions);
              continue;
            }
          } else if (path.length === 3) {
            // Single inner vertex (path.length == 3): vtxPos is at the centre of the
            // lane rectangle.  Use the closest point on each long edge (near/far) as
            // the triangle corners instead of the short-edge corners.
            //
            // Sort region points by their projection onto inwardPerp (the direction
            // FROM the u-v axis INTO the lane):
            //   byPerp[0..1] = the two near-edge corners (smallest inwardPerp proj)
            //   byPerp[2..3] = the two far-edge corners  (largest inwardPerp proj)
            // For a centre vtxPos the nearest point on each long edge is simply that
            // edge's midpoint.
            const rPtsS  = getRegionPoints(region);
            const byPerp = [...rPtsS].sort((a, b) => dot(a, inwardPerp) - dot(b, inwardPerp));
            const cornerN = midpoint(byPerp[0], byPerp[1]);  // nearest pt on near long edge
            const cornerFBase = midpoint(byPerp[2], byPerp[3]);  // nearest pt on far long edge
            let cornerF = cornerFBase;
            // R grandchild needs both sides of the virtual edge for flip support:
            //   triangle(pole, nearEdgeMid, farEdgeMid) spans the full lane width.
            // S/P grandchild only needs the inner side:
            //   triangle(pole, vtxPos, nearEdgeMid).
            const isRChild = childNode.comp.type !== 'S';

            // If drawP provided an expanded outer corner pair (root-outermost boost),
            // use its midpoint as the far anchor for centre-case R grandchildren.
            const ptCenter = treeNode._poleTriangle;
            const cornerC = ptCenter
              ? (poleId === ptCenter.poleUId ? ptCenter.cornerU : ptCenter.cornerV)
              : cornerN;
            if (isRChild && ptCenter?.outerCornerU && ptCenter?.outerCornerV) {
              cornerF = midpoint(ptCenter.outerCornerU, ptCenter.outerCornerV);
            }

            let regionPts;
            const boostedOutward = isRChild && ptCenter?.rootOutermostBoost && ptCenter?.laneDir;
            if (boostedOutward) {
              const apex = outwardPerpApex(polePos, vtxPos, ptCenter.laneDir, 0.5);
              if (childNode.comp.type === 'P') {
                regionPts = apex ? [polePos, cornerC, apex] : [polePos, cornerN, cornerF];
              } else {
                regionPts = apex ? [polePos, cornerC, apex] : [polePos, cornerN, cornerF];
              }
              // Keep the opposite side depth as it would have been without apex boost.
              childNode._laneDepthRegionOpposite = { type: 'polygon', points: [polePos, cornerN, cornerFBase] };
              if (childNode.comp.type === 'P') {
                // Clamp P-child inward growth by the inner boundary corner.
                childNode._laneDepthRegion = { type: 'polygon', points: [polePos, vtxPos, cornerC] };
              } else {
                childNode._laneDepthRegion = null;
              }
              log(`  [S] P-child pole-edge (centre apex): pole=${poleId}@(${fmt(polePos)}) cornerC=(${fmt(cornerC)}) vtx@(${fmt(vtxPos)}) apex=(${fmt(apex)}) child=${childNode.comp.type} → region`);
            } else {
              childNode._laneDepthRegionOpposite = null;
              childNode._laneDepthRegion = null;
              regionPts = isRChild
                ? [polePos, cornerN, cornerF]
                : [polePos, vtxPos, cornerN];
              log(`  [S] P-child pole-edge (centre): pole=${poleId}@(${fmt(polePos)}) vtx@(${fmt(vtxPos)}) cornerN=(${fmt(cornerN)}) cornerF=(${fmt(cornerF)}) R=${isRChild} → triangle region`);
            }
            const childRegion = {
              type: 'polygon',
              points: regionPts,
              autoFlipIfR: boostedOutward,
              preferOutsideDir: boostedOutward ? ptCenter.laneDir : null
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

  // Draw real edges in the arc
  for (const { u, v } of realEdges) {
    edges.push({ source: u, target: v });
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
    // Pick first two vertices of graph as poles
    const verts = [...comp.graph.keys()];
    poleUId = verts[0];
    poleVId = verts[1] ?? verts[0];
  }
  positions.set(poleUId, posU);
  positions.set(poleVId, posV);

  log(`  [P] poles: u=${poleUId}@(${fmt(posU)}) v=${poleVId}@(${fmt(posV)})`);

  const k = childEdges.length;
  log(`  [P] children=${k}`);
  if (k === 0) return;

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
  childIdsInDefaultEdgeOrder.forEach((id, idx) => {
    if (idx % 2 === 0) defaultLeft.push(id);
    else defaultRight.push(id);
  });
  const defaultVisualOrder = [...defaultLeft.reverse(), P_REAL_EDGE_SLOT, ...defaultRight];

  const normalizeVisualOrder = (candidate) => {
    const expected = new Set(childIdsInDefaultEdgeOrder);
    const out = [];
    const seen = new Set();
    let seenReal = false;

    for (const token of Array.isArray(candidate) ? candidate : []) {
      if (token === P_REAL_EDGE_SLOT) {
        if (!seenReal) {
          out.push(token);
          seenReal = true;
        }
        continue;
      }
      if (!expected.has(token) || seen.has(token)) continue;
      out.push(token);
      seen.add(token);
    }

    for (const token of defaultVisualOrder) {
      if (token === P_REAL_EDGE_SLOT) {
        if (!seenReal) {
          out.push(token);
          seenReal = true;
        }
        continue;
      }
      if (seen.has(token)) continue;
      out.push(token);
      seen.add(token);
    }

    if (!seenReal) out.push(P_REAL_EDGE_SLOT);
    return out;
  };

  const visualOrder = normalizeVisualOrder(treeNode.embeddingOrder);
  treeNode.embeddingOrder = [...visualOrder];
  if (treeNode.comp) treeNode.comp.embeddingOrder = [...visualOrder];

  const uvSlotIndex = visualOrder.findIndex(t => t === P_REAL_EDGE_SLOT);
  const leftChildIds = [];
  const rightChildIds = [];
  for (let i = 0; i < visualOrder.length; i++) {
    const token = visualOrder[i];
    if (token === P_REAL_EDGE_SLOT) continue;

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
  log(`  [P] order L→R=[${visualOrder.map(t => t === P_REAL_EDGE_SLOT ? 'u-v' : String(t)).join(', ')}]`);

  // Two perpendicular directions from u-v axis
  const axisDir  = normalize(sub(posV, posU));
  const perpCCW  = perp(axisDir);                          // one side
  const perpCW   = { x: -perpCCW.x, y: -perpCCW.y };      // other side

  // Lane geometry parameters (computed once, shared by all children)
  const uvDist      = dist(posU, posV);
  const childHeight = 0.5 * uvDist;            // height of each child rect along the u-v axis
  const inset       = (uvDist - childHeight) / 2; // inset from each pole along the axis

  // Measure perpendicular reach from the actual boundary at the two endpoints of the
  // central 50% u-v segment (25% and 75% along u-v). This avoids over-allocating P
  // lanes based on far-away parts of the region.
  const depthRegion = treeNode._laneDepthRegion || region;
  const t0 = uvDist > 1e-9 ? inset / uvDist : 0.25;
  const t1 = 1 - t0;
  const samples = [
    add(posU, scale(axisDir, uvDist * t0)),
    add(posU, scale(axisDir, uvDist * t1))
  ];
  const measureSideDepths = (rgn) => {
    const left = samples.reduce((minD, p) => {
      const d = rayExtentToBoundary(rgn, p, perpCCW);
      return Math.min(minD, d);
    }, Infinity);
    const right = samples.reduce((minD, p) => {
      const d = rayExtentToBoundary(rgn, p, perpCW);
      return Math.min(minD, d);
    }, Infinity);
    return {
      left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : 0
    };
  };

  let { left: maxDepthL, right: maxDepthR } = measureSideDepths(depthRegion);

  // One-sided apex boosts should only expand the outside side. For the opposite
  // side, use the pre-boost region depth if provided.
  if (treeNode._laneDepthRegionOpposite) {
    const opposite = measureSideDepths(treeNode._laneDepthRegionOpposite);
    if (maxDepthL > 1e-6 && maxDepthR <= 1e-6 && opposite.right > 1e-6) maxDepthR = opposite.right;
    if (maxDepthR > 1e-6 && maxDepthL <= 1e-6 && opposite.left > 1e-6) maxDepthL = opposite.left;
  }

  // For P-children allocated from an R edge with one inner face + outer face,
  // mirror the usable depth from the constrained inner face to both sides.
  if (treeNode._mirrorPerpDepth) {
    const mirrored = Math.max(maxDepthL, maxDepthR);
    maxDepthL = mirrored;
    maxDepthR = mirrored;
  }

  const nLeft      = leftChildIds.length;
  const nRight     = rightChildIds.length;
  // Fallback only applies for rect regions (root case) where ray measurement may be
  // unreliable. For polygon regions the measurement is accurate — trust it even if 0.
  const fallback   = (1 / 2) * childHeight;   // uvDist/4
  const useFallback = depthRegion.type === 'rect';
  const laneWidthL = nLeft  > 0 && (maxDepthL > 1e-6 || !useFallback) ? maxDepthL / nLeft  : fallback;
  const laneWidthR = nRight > 0 && (maxDepthR > 1e-6 || !useFallback) ? maxDepthR / nRight : fallback;

  // Inset endpoints: the near edge of every child rectangle runs between these two points
  const poleNearU = add(posU, scale(axisDir, inset));
  const poleNearV = sub(posV, scale(axisDir, inset));

  log(`  [P] uvDist=${uvDist.toFixed(1)} childHeight=${childHeight.toFixed(1)} laneWidthL=${laneWidthL.toFixed(1)} laneWidthR=${laneWidthR.toFixed(1)} inset=${inset.toFixed(1)} depthL=${maxDepthL.toFixed(1)} depthR=${maxDepthR.toFixed(1)} depthRegion=${depthRegion.type}${treeNode._mirrorPerpDepth ? ' mirrored' : ''}`);

  // ── Pass 1: pre-compute lane geometries per side (from u-v outward) ─────────
  const laneGeomByCompId = new Map();

  const buildSideLanes = (childIds, goLeft) => {
    const laneDir   = goLeft ? perpCCW : perpCW;
    const laneWidth = goLeft ? laneWidthL : laneWidthR;
    const nearToFar = goLeft ? [...childIds].reverse() : [...childIds];
    let sideDepth = 0;
    let prevNearToken = null;

    for (let j = 0; j < nearToFar.length; j++) {
      const childId = nearToFar[j];
      const startDepth = sideDepth;
      const nearEdgeU  = add(poleNearU, scale(laneDir, startDepth));
      const nearEdgeV  = add(poleNearV, scale(laneDir, startDepth));
      const farEdgeU   = add(poleNearU, scale(laneDir, startDepth + laneWidth));
      const farEdgeV   = add(poleNearV, scale(laneDir, startDepth + laneWidth));
      const meetPt     = rayRayIntersect(posU, sub(farEdgeU, posU), posV, sub(farEdgeV, posV));
      const nextDepth  = meetPt ? dot(sub(meetPt, posU), laneDir) : startDepth + laneWidth;
      const isOutermost = j === nearToFar.length - 1;

      laneGeomByCompId.set(childId, {
        goLeft,
        laneDir,
        laneWidth,
        startDepth,
        nearEdgeU,
        nearEdgeV,
        farEdgeU,
        farEdgeV,
        innerSiblingId: prevNearToken,
        isOutermost
      });

      prevNearToken = childId;

      // Optimisation: a 3-vertex S child (single inner vertex placed at lane centre)
      // only draws content up to the midpoint of its rectangle — the outer half is empty.
      // The next sibling can therefore start at the 3-cycle's far edge (startDepth +
      // laneWidth) rather than the ray-intersection depth, which can be much larger.
      // This avoids both overlap and the inflated spacing caused by ray convergence.
      const childEdgeInfoForDepth = childEdgeByCompId.get(childId);
      const childNodeForDepth = childEdgeInfoForDepth ? childByEdgeId.get(childEdgeInfoForDepth.edgeId) : null;
      const isCentreS = childNodeForDepth?.comp?.type === 'S' && childNodeForDepth?.comp?.graph?.size === 3;
      sideDepth = isCentreS ? startDepth + laneWidth : nextDepth;
    }
  };

  buildSideLanes(leftChildIds, true);
  buildSideLanes(rightChildIds, false);

  // ── Pass 2: draw children in the user-selected left-to-right slot order ─────
  let laneIdx = 0;
  for (let slotIdx = 0; slotIdx < visualOrder.length; slotIdx++) {
    const token = visualOrder[slotIdx];
    if (token === P_REAL_EDGE_SLOT) {
      log(`  [P] slot ${slotIdx} → u-v (real edge)`);
      continue;
    }

    const lane = laneGeomByCompId.get(token);
    const childEdgeInfo = childEdgeByCompId.get(token);
    const childNode = childEdgeInfo ? childByEdgeId.get(childEdgeInfo.edgeId) : null;
    if (!lane || !childNode) continue;

    const innerLane = lane.innerSiblingId ? laneGeomByCompId.get(lane.innerSiblingId) : null;
    const cornerU = innerLane ? innerLane.farEdgeU : lane.nearEdgeU;
    const cornerV = innerLane ? innerLane.farEdgeV : lane.nearEdgeV;

    // Attach metadata so drawS/drawR can allocate the triangular zone for any
    // grandchild virtual edge whose one endpoint is a P pole.
    // outerCornerU/V are the far corners of the CURRENT child's own short edge —
    // they lie on the opposite side of the virtual edge from cornerU/V, giving an
    // R grandchild space to be drawn in either embedding orientation (flip).
    let outerCornerU = lane.farEdgeU;
    let outerCornerV = lane.farEdgeV;
    let rootOutermostBoost = false;

    // Root-P optimization: if this is the outermost lane on its side, extend the
    // outside triangle apex farther out, because no sibling region exists beyond it.
    if (!treeNode.parent && lane.isOutermost) {
      const outwardBoost = Math.max(0.75 * childHeight, 2 * lane.laneWidth);
      outerCornerU = add(outerCornerU, scale(lane.laneDir, outwardBoost));
      outerCornerV = add(outerCornerV, scale(lane.laneDir, outwardBoost));
      rootOutermostBoost = true;
      log(`    outermost-root boost: +${outwardBoost.toFixed(1)} along ${lane.goLeft ? 'L' : 'R'} side`);
    }

    childNode._poleTriangle = {
      poleUId, poleVId,
      cornerU, cornerV,
      outerCornerU,
      outerCornerV,
      laneDir: lane.laneDir,
      rootOutermostBoost
    };

    const laneRegion = {
      type: 'polygon',
      points: [lane.nearEdgeU, lane.nearEdgeV, lane.farEdgeV, lane.farEdgeU]
    };

    log(`  [P] lane ${laneIdx} → child ${childNode.comp.id}(${childNode.comp.type}) side=${lane.goLeft?'L':'R'} startDepth=${lane.startDepth.toFixed(1)} slot=${slotIdx}`);
    log(`    nearEdge: (${fmt(lane.nearEdgeU)})–(${fmt(lane.nearEdgeV)})  farEdge: (${fmt(lane.farEdgeU)})–(${fmt(lane.farEdgeV)})`);
    log(`    poleTriangle cornerU=(${fmt(cornerU)}) cornerV=(${fmt(cornerV)})`);

    drawSubtree(childNode, laneRegion, posU, posV, positions, edges, regions);
    laneIdx++;
  }
}

// ─── R component ─────────────────────────────────────────────────────────────

function drawR(treeNode, region, anchorU, anchorV, parentEdgeId, positions, edges, regions) {
  const { comp } = treeNode;
  const { parentEdgeNodes, childEdges, realEdges } = classifyEdges(comp, parentEdgeId);

  log(`  [R] vertices=${comp.graph.size} childEdges=${childEdges.length} realEdges=${realEdges.length}`);

  // 1. Get rotation system
  let { embedding } = isPlanarAndEmbed(comp.graph);
  if (treeNode.embeddingFlip && embedding) {
    const flipped = new Map();
    for (const [v, nbrs] of embedding) flipped.set(v, [...nbrs].reverse());
    embedding = flipped;
  }

  // 2. Extract faces
  const faces = extractFaces(embedding);

  // 3. Choose outer face
  let outerFace;
  if (anchorU && parentEdgeNodes) {
    const [pU, pV] = parentEdgeNodes;
    const facesWithPoles = faces.filter(f => f.includes(pU) && f.includes(pV));
    outerFace = findLargestFace(facesWithPoles.length ? facesWithPoles : faces);
    log(`  [R] faces=${faces.length} outerFace=[${outerFace.join(',')}] (contains anchors ${pU},${pV})`);
  } else {
    outerFace = findLargestFace(faces);
    log(`  [R] faces=${faces.length} outerFace=[${outerFace.join(',')}] (largest, root)`);
  }

  // 4. Tutte embedding
  let rawPos;
  try {
    rawPos = tutteEmbedding(comp.graph, outerFace);
  } catch (e) {
    console.warn('tutteEmbedding failed for R component', comp.id, e);
    // Fallback: place vertices on circle
    rawPos = fallbackCircleLayout(comp.graph);
  }

  // 5. Build boundary Tutte and apply
  let applied = false;
  if (anchorU && parentEdgeNodes) {
    const [pU, pV] = parentEdgeNodes;
    const rawU = rawPos.get(pU);
    const rawV = rawPos.get(pV);
    if (rawU && rawV) {
      // Detect P-child: both poles lie outside the region bbox
      const bbox = regionBBox(region);
      const uOut = anchorU.x < bbox.minX || anchorU.x > bbox.maxX || anchorU.y < bbox.minY || anchorU.y > bbox.maxY;
      const vOut = anchorV.x < bbox.minX || anchorV.x > bbox.maxX || anchorV.y < bbox.minY || anchorV.y > bbox.maxY;

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

      const axDir = normalize(sub(anchorV, anchorU));
      const pDir  = perp(axDir);
      const rPts  = getRegionPoints(region);

      let dstU, dstV, farPath;

      if (uOut && vOut) {
        // P-child: poles are outside the region.  Use the two inside corners
        // (closest to the u-v axis) as proxy Tutte-boundary points for the poles;
        // the far arc goes along the opposite edge of the rectangle.
        const sorted = [...rPts].sort((a, b) =>
          Math.abs(dot(sub(a, anchorU), pDir)) - Math.abs(dot(sub(b, anchorU), pDir))
        );
        const insidePair = [sorted[0], sorted[1]];
        const farPair    = [sorted[2], sorted[3]];
        insidePair.sort((a, b) => dot(sub(a, anchorU), axDir) - dot(sub(b, anchorU), axDir));
        farPair.sort   ((a, b) => dot(sub(a, anchorU), axDir) - dot(sub(b, anchorU), axDir));
        dstU    = insidePair[0];
        dstV    = insidePair[1];
        farPath = [dstU, farPair[0], farPair[1], dstV];
        // Store proxy positions so the grandchild region computation can clamp
        // faces that include P poles to inside the lane rectangle.
        treeNode._poleProxies = new Map([[pU, dstU], [pV, dstV]]);
        log(`  [R] P-child: dstU=(${fmt(dstU)}) dstV=(${fmt(dstV)}) farPath=[${farPath.map(fmt).join(' → ')}]`);
      } else {
        // Non-P-child: poles are on/inside the region — use them directly.
        // Determine which side of the u-v axis the far arc lies on by looking
        // at the raw Tutte positions (the similarity transform is orientation-
        // preserving, so the sign transfers unchanged to canvas space).
        dstU = anchorU;
        dstV = anchorV;
        const rawAxis    = normalize(sub(rawV, rawU));
        const rawPerpDir = perp(rawAxis);
        let sumPerp = 0;
        for (const v of farArc) sumPerp += dot(sub(rawPos.get(v), rawU), rawPerpDir);
        let sideSign = sumPerp >= 0 ? 1 : -1;

        // Auto-flip R into the intended outside side when parent S provided an
        // outward direction hint for boosted pole-edge regions.
        // When embeddingFlip is set, the user wants the opposite of the default
        // outward orientation, so invert desiredSign.
        if (region?.autoFlipIfR && region?.preferOutsideDir) {
          const baseSign = dot(normalize(region.preferOutsideDir), pDir) >= 0 ? 1 : -1;
          const desiredSign = treeNode.embeddingFlip ? -baseSign : baseSign;
          if (desiredSign !== sideSign) {
            sideSign = desiredSign;
            log(`  [R] auto outside-side flip: desiredSign=${desiredSign}`);
          }
        }

        // Collect region corners on the target side, sorted along axDir
        const farCorners = rPts
          .filter(c => sideSign * dot(sub(c, anchorU), pDir) > 1e-3)
          .sort((a, b) => dot(sub(a, anchorU), axDir) - dot(sub(b, anchorU), axDir));

        farPath = [dstU, ...farCorners, dstV];
        log(`  [R] non-P-child: sideSign=${sideSign} farCorners=[${farCorners.map(fmt).join(', ')}]`);
      }

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

      // Re-run Tutte with the boundary-snapped positions
      try {
        rawPos = tutteEmbedding(comp.graph, outerFace, outerPositions);
      } catch (e) {
        console.warn('tutteEmbedding (boundary) failed', comp.id, e);
        rawPos = fallbackCircleLayout(comp.graph);
      }

      // Positions are already in canvas space — write directly
      for (const [v, p] of rawPos) {
        positions.set(v, p);
        log(`    vertex ${v} → (${fmt(p)})`);
      }

      // P-child: restore poles to their committed canvas positions
      if (uOut && vOut) {
        positions.set(pU, anchorU);
        positions.set(pV, anchorV);
        log(`  [R] P-child: poles restored u=(${fmt(anchorU)}) v=(${fmt(anchorV)})`);
      } else {
        log(`  [R] non-P-child boundary Tutte applied`);
      }

      applied = true;
    } else {
      log(`  [R] WARN: anchor vertices not in rawPos (pU=${pU} pV=${pV})`);
    }
  }
  if (!applied) {
    // Root R (no anchors): scale raw Tutte into the canvas region
    const scaled = scaleRegion(rawPos, region);
    for (const [v, p] of scaled) positions.set(v, p);
    log(`  [R] scaleRegion fallback applied`);
  }

  // 6. Draw real edges
  for (const { u, v } of realEdges) {
    edges.push({ source: u, target: v });
    log(`    real edge ${u}–${v} | (${fmt(positions.get(u))})→(${fmt(positions.get(v))})`);
  }

  // 7. Allocate child regions: both adjacent faces of each virtual edge
  const childByEdgeId = new Map(treeNode.children.map(ch => [ch.parentEdgeId, ch]));
  const pt = treeNode._poleTriangle;
  const poleSetR = pt ? new Set([pt.poleUId, pt.poleVId]) : null;

  // Pre-compute axis direction and short-edge projection bounds for the P-child
  // pole-triangle check (only meaningful when we have valid pole anchors).
  const axisDirR   = anchorU && anchorV ? normalize(sub(anchorV, anchorU)) : null;
  const rPtsR      = axisDirR ? getRegionPoints(region) : [];
  const axProjsR   = rPtsR.map(p => dot(p, axisDirR));
  const minAxProjR = axProjsR.length ? Math.min(...axProjsR) : 0;
  const maxAxProjR = axProjsR.length ? Math.max(...axProjsR) : 0;

  for (const { u, v, edgeId } of childEdges) {
    const childNode = childByEdgeId.get(edgeId);
    if (!childNode) continue;
    const posA = positions.get(u);
    const posB = positions.get(v);
    if (!posA || !posB) continue;

    // Default: no special P-lane depth constraints for this child.
    childNode._laneDepthRegion = null;
    childNode._mirrorPerpDepth = false;

    // Special case: one endpoint is a P pole (outside the lane rectangle) AND the
    // other endpoint sits on the pole-facing short edge of the lane rectangle.
    // In that case use the free triangular zone instead of the face-based region.
    if (poleSetR && axisDirR && (poleSetR.has(u) || poleSetR.has(v))) {
      const poleId     = poleSetR.has(u) ? u : v;
      const polePos    = positions.get(poleId);
      const vtxPos     = poleSetR.has(u) ? posB : posA;
      const vtxAxProj  = dot(vtxPos, axisDirR);
      const onShortEdge = vtxAxProj <= minAxProjR + 1.0 || vtxAxProj >= maxAxProjR - 1.0;

      if (onShortEdge) {
        const cornerC = poleId === pt.poleUId ? pt.cornerU      : pt.cornerV;
        const outerD  = poleId === pt.poleUId ? pt.outerCornerU : pt.outerCornerV;
        // R grandchild: full A-C-D triangle (both sides of virtual edge) for flip support.
        // S/P grandchild: narrower A-B-C triangle is sufficient.
        const isRChild = childNode.comp.type !== 'S';
        const regionPts = isRChild
          ? [polePos, cornerC, outerD]
          : [polePos, vtxPos, cornerC];
        log(`  [R] P-child pole-edge (short-edge): pole=${poleId}@(${fmt(polePos)}) vtx@(${fmt(vtxPos)}) cornerC=(${fmt(cornerC)}) outerD=(${fmt(outerD)}) R=${isRChild} → triangle region`);
        const childRegion = { type: 'polygon', points: regionPts };
        drawSubtree(childNode, childRegion, posA, posB, positions, edges, regions);
        continue;
      }
    }

    // Find both faces adjacent to edge (u,v)
    const [faceLeft, faceRight] = findBothAdjacentFaces(faces, u, v);

    // Transform face vertices to canvas coords.
    // When this R is a P-child, replace P pole vertices with their proxy
    // positions (the inner lane corners used during Tutte boundary setup)
    // so that the face-based region stays inside the lane rectangle instead
    // of ballooning out to the actual pole coordinates far outside the lane.
    const transformFace = (face, usePoleProxies = true) => face.map(vid =>
      ((usePoleProxies ? treeNode._poleProxies?.get(vid) : null) ?? positions.get(vid) ?? { x: 0, y: 0 })
    );

    log(`  [R] child edge ${u}-${v} → ${childNode.comp.id}(${childNode.comp.type}) faceLeft=[${faceLeft?.join(',') ?? 'none'}] faceRight=[${faceRight?.join(',') ?? 'none'}]`);
    let childRegion;
    if (faceLeft && faceRight) {
      // Merge both faces into one polygon (all vertices of both faces)
      const pts1 = transformFace(faceLeft, true);
      const pts2 = transformFace(faceRight, true);

      // For P-children, constrain lane-depth measurement to the smaller adjacent face.
      // This avoids using far outer-face geometry to inflate the P lanes.
      if (childNode.comp.type === 'P') {
        const a1 = Math.abs(polygonSignedArea(pts1));
        const a2 = Math.abs(polygonSignedArea(pts2));
        childNode._laneDepthRegion = { type: 'polygon', points: a1 <= a2 ? pts1 : pts2 };
        childNode._mirrorPerpDepth = true;
        log(`  [R] P-child depth constraint: area1=${a1.toFixed(1)} area2=${a2.toFixed(1)} mirrored=true`);
      }

      if (childNode.comp.type === 'S') {
        const leftIsOuter  = faceLeft === outerFace;
        const rightIsOuter = faceRight === outerFace;
        // S children should receive the full adjacent face polygon in true canvas
        // coordinates; do not clamp pole vertices to P-child proxy corners.
        const pts1Raw = transformFace(faceLeft, false);
        const pts2Raw = transformFace(faceRight, false);
        const a1 = Math.abs(polygonSignedArea(pts1Raw));
        const a2 = Math.abs(polygonSignedArea(pts2Raw));

        let chosen = pts1Raw;
        let chosenLabel = 'left';
        if (leftIsOuter !== rightIsOuter) {
          // Prefer the inner adjacent face when one side is outer.
          chosen = leftIsOuter ? pts2Raw : pts1Raw;
          chosenLabel = leftIsOuter ? 'right(inner)' : 'left(inner)';
        } else if (a2 < a1) {
          // Otherwise choose the tighter adjacent face to keep placement local.
          chosen = pts2Raw;
          chosenLabel = 'right(smaller)';
        } else {
          chosenLabel = 'left(smaller-or-equal)';
        }

        childRegion = { type: 'polygon', points: chosen };
        log(`  [R] S-child face pick: chosen=${chosenLabel} areaL=${a1.toFixed(1)} areaR=${a2.toFixed(1)} leftOuter=${leftIsOuter} rightOuter=${rightIsOuter}`);
      } else {
        childRegion = { type: 'polygon', points: convexHull([...pts1, ...pts2]) };
      }
    } else if (faceLeft) {
      const usePoleProxies = childNode.comp.type !== 'S';
      childRegion = { type: 'polygon', points: transformFace(faceLeft, usePoleProxies) };
    } else if (faceRight) {
      const usePoleProxies = childNode.comp.type !== 'S';
      childRegion = { type: 'polygon', points: transformFace(faceRight, usePoleProxies) };
    } else {
      // Fallback: bounding box around edge
      childRegion = edgeBoundingBox(posA, posB, 60);
    }

    drawSubtree(childNode, childRegion, posA, posB, positions, edges, regions);
  }
}

// Find both faces adjacent to edge {u,v}.
// faceForward  = face to the LEFT  of u→v (contains directed half-edge u→v)
// faceBackward = face to the LEFT  of v→u (contains directed half-edge v→u)
//              = face to the RIGHT of u→v
// Together these are the two distinct faces on either side of the edge.
function findBothAdjacentFaces(faces, u, v) {
  let faceForward = null, faceBackward = null;
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (a === u && b === v) faceForward  = face;
      if (a === v && b === u) faceBackward = face;
    }
    if (faceForward && faceBackward) break;
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
function dist(a, b) { return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function normalize(v) { const l = Math.sqrt(v.x * v.x + v.y * v.y) || 1; return { x: v.x / l, y: v.y / l }; }
function scale(v, s) { return { x: v.x * s, y: v.y * s }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function perp(v) { return { x: -v.y, y: v.x }; }  // 90° CCW
function dot(a, b) { return a.x * b.x + a.y * b.y; }
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

/** Andrew's monotone chain convex hull. Returns CCW ordered hull vertices. */
function convexHull(pts) {
  const sorted = [...pts].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : pts; // fallback if degenerate
}

function polygonSignedArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

function regionCentroid(region) {
  const pts = getRegionPoints(region);
  if (!pts.length) return { x: 0, y: 0 };
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

function regionLeft(region) {
  if (region.type === 'rect') return region.x;
  return Math.min(...getRegionPoints(region).map(p => p.x));
}

function regionRight(region) {
  if (region.type === 'rect') return region.x + region.w;
  return Math.max(...getRegionPoints(region).map(p => p.x));
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
