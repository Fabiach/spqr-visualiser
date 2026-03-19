/**
 * Embedding-preserving spring embedder.
 *
 * Refines an existing straight-line drawing while preserving:
 * 1) edge non-crossing, and
 * 2) cyclic neighbor order at each vertex.
 *
 * This is intended as a post-process after SPQR-based layout.
 */
export class EmbeddingPreservingSpringEmbedder {
  constructor(options = {}) {
    this.options = {
      iterations: 180,
      springK: 0.14,
      repulsionK: 3500,
      repulsionRadius: 240,
      laplacianK: 0.07,
      crossingBarrierK: 2400,
      crossingBarrierDistance: 80,
      crossingBarrierExponent: 2,
      crossingClearance: 0,
      baseStep: 0.35,
      maxMove: 8,
      minStep: 0.01,
      initialTemperature: 1.0,
      coolingExponent: 1.8,
      thermalK: 0.28,
      stepHeatBoost: 1.0,
      ...options,
    };
  }

  refine(inputPositions, edges, options = {}) {
    const opts = { ...this.options, ...options };
    const positions = clonePositions(inputPositions);
    if (!positions || positions.size === 0 || !edges || edges.length === 0) {
      return positions;
    }

    const adjacency = buildAdjacency(edges);
    const nodeIds = [...positions.keys()];
    const fixed = new Set((opts.fixedNodes || []).map(Number));

    const targetLength = opts.targetLength || medianEdgeLength(positions, edges) || 80;
    const baseCentroid = centroidOf(positions, nodeIds);
    const referenceRotation = captureRotationSystem(positions, adjacency);

    for (let iter = 0; iter < opts.iterations; iter++) {
      const alpha = 1 - iter / Math.max(1, opts.iterations);
      const temperature = opts.initialTemperature * Math.pow(Math.max(0, alpha), opts.coolingExponent);
      const heatBoost = 1 + opts.stepHeatBoost * temperature;
      const stepInit = opts.baseStep * (0.30 + 0.70 * alpha) * heatBoost;
      const maxMove = opts.maxMove * (0.45 + 0.55 * alpha) * Math.sqrt(heatBoost);

      const forces = new Map(nodeIds.map(id => [id, { x: 0, y: 0 }]));

      // Edge springs (Hooke-like)
      for (const e of edges) {
        const u = Number(e.source);
        const v = Number(e.target);
        const pu = positions.get(u);
        const pv = positions.get(v);
        if (!pu || !pv) continue;

        const dx = pv.x - pu.x;
        const dy = pv.y - pu.y;
        const d = Math.hypot(dx, dy) || 1;
        const ext = d - targetLength;
        const f = opts.springK * ext;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;

        addForce(forces, u, +fx, +fy);
        addForce(forces, v, -fx, -fy);
      }

      // Pairwise repulsion (short-range)
      for (let i = 0; i < nodeIds.length; i++) {
        const a = nodeIds[i];
        const pa = positions.get(a);
        for (let j = i + 1; j < nodeIds.length; j++) {
          const b = nodeIds[j];
          const pb = positions.get(b);
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const d2 = dx * dx + dy * dy;
          const d = Math.sqrt(d2) || 1;
          if (d > opts.repulsionRadius) continue;

          const mag = opts.repulsionK / (d2 + 1e-6);
          const fx = (dx / d) * mag;
          const fy = (dy / d) * mag;

          addForce(forces, a, -fx, -fy);
          addForce(forces, b, +fx, +fy);
        }
      }

      // Gentle Laplacian smoothing toward neighbor centroid
      for (const v of nodeIds) {
        const nbrs = adjacency.get(v);
        if (!nbrs || nbrs.length === 0) continue;
        const pv = positions.get(v);
        let cx = 0;
        let cy = 0;
        for (const n of nbrs) {
          const pn = positions.get(n);
          if (!pn) continue;
          cx += pn.x;
          cy += pn.y;
        }
        cx /= nbrs.length;
        cy /= nbrs.length;

        addForce(forces, v, (cx - pv.x) * opts.laplacianK, (cy - pv.y) * opts.laplacianK);
      }

      // Soft crossing barrier: repel edges that get too close even before
      // an actual crossing occurs. This raises the "cost" of approaching a
      // crossing and helps keep more geometric clearance.
      if (opts.crossingBarrierK > 0 && opts.crossingBarrierDistance > 0) {
        const barrierDist = opts.crossingBarrierDistance;
        const barrierDist2 = barrierDist * barrierDist;
        for (let i = 0; i < edges.length; i++) {
          const e1 = edges[i];
          const a = Number(e1.source);
          const b = Number(e1.target);
          const pa = positions.get(a);
          const pb = positions.get(b);
          if (!pa || !pb) continue;

          for (let j = i + 1; j < edges.length; j++) {
            const e2 = edges[j];
            const c = Number(e2.source);
            const d = Number(e2.target);
            if (a === c || a === d || b === c || b === d) continue;

            const pc = positions.get(c);
            const pd = positions.get(d);
            if (!pc || !pd) continue;

            const close = segmentClosestPoints(pa, pb, pc, pd);
            if (!close || close.dist2 >= barrierDist2) continue;

            const dist = Math.sqrt(close.dist2 + 1e-9);
            const t = Math.max(0, (barrierDist - dist) / barrierDist);
            const mag = opts.crossingBarrierK * Math.pow(t, opts.crossingBarrierExponent || 2);

            let nx = close.p2.x - close.p1.x;
            let ny = close.p2.y - close.p1.y;
            const nlen = Math.hypot(nx, ny);
            if (nlen < 1e-9) {
              const m1 = { x: 0.5 * (pa.x + pb.x), y: 0.5 * (pa.y + pb.y) };
              const m2 = { x: 0.5 * (pc.x + pd.x), y: 0.5 * (pc.y + pd.y) };
              nx = m2.x - m1.x;
              ny = m2.y - m1.y;
              const ml = Math.hypot(nx, ny) || 1;
              nx /= ml;
              ny /= ml;
            } else {
              nx /= nlen;
              ny /= nlen;
            }

            // Push edge (a,b) opposite edge (c,d).
            addForce(forces, a, -0.5 * nx * mag, -0.5 * ny * mag);
            addForce(forces, b, -0.5 * nx * mag, -0.5 * ny * mag);
            addForce(forces, c, +0.5 * nx * mag, +0.5 * ny * mag);
            addForce(forces, d, +0.5 * nx * mag, +0.5 * ny * mag);
          }
        }
      }

      // Decaying thermal kick for broader early exploration.
      // The embedding-validity gate still rejects any move that changes
      // cyclic order or introduces crossings.
      if (temperature > 1e-6 && opts.thermalK > 0) {
        const thermalMag = opts.thermalK * targetLength * temperature;
        for (const v of nodeIds) {
          if (fixed.has(v)) continue;
          const angle = Math.random() * Math.PI * 2;
          addForce(forces, v, Math.cos(angle) * thermalMag, Math.sin(angle) * thermalMag);
        }
      }

      // Backtracking line search under embedding constraints.
      let step = stepInit;
      let accepted = false;
      while (step >= opts.minStep) {
        const candidate = applyForces(positions, forces, fixed, step, maxMove);
        recenterTo(candidate, nodeIds, baseCentroid);

        if (isEmbeddingValid(candidate, edges, adjacency, referenceRotation, opts.crossingClearance || 0)) {
          replacePositions(positions, candidate);
          accepted = true;
          break;
        }
        step *= 0.5;
      }

      // If no valid move exists at this iteration, keep current positions.
      if (!accepted) continue;
    }

    return positions;
  }
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    const u = Number(e.source);
    const v = Number(e.target);
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u).push(v);
    adj.get(v).push(u);
  }
  return adj;
}

function addForce(forces, id, fx, fy) {
  const f = forces.get(id);
  if (!f) return;
  f.x += fx;
  f.y += fy;
}

function applyForces(positions, forces, fixed, step, maxMove) {
  const out = clonePositions(positions);
  for (const [id, p] of out) {
    if (fixed.has(id)) continue;
    const f = forces.get(id) || { x: 0, y: 0 };
    let dx = f.x * step;
    let dy = f.y * step;
    const m = Math.hypot(dx, dy);
    if (m > maxMove) {
      const s = maxMove / m;
      dx *= s;
      dy *= s;
    }
    p.x += dx;
    p.y += dy;
  }
  return out;
}

function clonePositions(map) {
  const out = new Map();
  for (const [id, p] of map) {
    out.set(Number(id), { x: p.x, y: p.y });
  }
  return out;
}

function replacePositions(target, source) {
  target.clear();
  for (const [id, p] of source) {
    target.set(id, { x: p.x, y: p.y });
  }
}

function medianEdgeLength(positions, edges) {
  const vals = [];
  for (const e of edges) {
    const u = Number(e.source);
    const v = Number(e.target);
    const pu = positions.get(u);
    const pv = positions.get(v);
    if (!pu || !pv) continue;
    vals.push(Math.hypot(pv.x - pu.x, pv.y - pu.y));
  }
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  const m = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[m] : 0.5 * (vals[m - 1] + vals[m]);
}

function centroidOf(positions, ids) {
  if (!ids || ids.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const p = positions.get(id);
    if (!p) continue;
    x += p.x;
    y += p.y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

function recenterTo(positions, ids, targetCentroid) {
  const c = centroidOf(positions, ids);
  const dx = targetCentroid.x - c.x;
  const dy = targetCentroid.y - c.y;
  for (const id of ids) {
    const p = positions.get(id);
    if (!p) continue;
    p.x += dx;
    p.y += dy;
  }
}

function captureRotationSystem(positions, adjacency) {
  const rot = new Map();
  for (const [v, nbrs] of adjacency) {
    if (!nbrs || nbrs.length < 3) continue;
    rot.set(v, neighborOrder(positions, v, nbrs));
  }
  return rot;
}

function neighborOrder(positions, centerId, neighbors) {
  const c = positions.get(centerId);
  const withAngles = neighbors
    .map(n => {
      const p = positions.get(n);
      return {
        id: n,
        angle: Math.atan2((p?.y ?? c.y) - c.y, (p?.x ?? c.x) - c.x),
      };
    })
    .sort((a, b) => a.angle - b.angle || a.id - b.id);
  return withAngles.map(x => x.id);
}

function isEmbeddingValid(positions, edges, adjacency, referenceRotation, crossingClearance = 0) {
  if (hasCrossingOrNearCrossing(positions, edges, crossingClearance)) return false;

  for (const [v, expected] of referenceRotation) {
    const nbrs = adjacency.get(v);
    if (!nbrs || nbrs.length < 3) continue;
    const got = neighborOrder(positions, v, nbrs);
    if (!isSameCyclicOrder(expected, got)) return false;
  }

  return true;
}

function isSameCyclicOrder(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const n = a.length;
  if (n <= 1) return true;

  const first = a[0];
  const start = b.indexOf(first);
  if (start === -1) return false;

  for (let i = 0; i < n; i++) {
    if (a[i] !== b[(start + i) % n]) return false;
  }
  return true;
}

function hasCrossingOrNearCrossing(positions, edges, clearance = 0) {
  const useClearance = clearance > 0;
  const clearance2 = clearance * clearance;

  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i];
    const a = Number(e1.source);
    const b = Number(e1.target);
    const p1 = positions.get(a);
    const p2 = positions.get(b);
    if (!p1 || !p2) continue;

    for (let j = i + 1; j < edges.length; j++) {
      const e2 = edges[j];
      const c = Number(e2.source);
      const d = Number(e2.target);

      // Adjacent edges may touch at shared endpoints.
      if (a === c || a === d || b === c || b === d) continue;

      const p3 = positions.get(c);
      const p4 = positions.get(d);
      if (!p3 || !p4) continue;

      if (segmentsIntersectProperly(p1, p2, p3, p4)) return true;
      if (useClearance) {
        const close = segmentClosestPoints(p1, p2, p3, p4);
        if (close && close.dist2 < clearance2) return true;
      }
    }
  }
  return false;
}

function cross2D(p1, p2, p3) {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

function segmentsIntersectProperly(a1, a2, b1, b2) {
  const d1 = cross2D(b1, b2, a1);
  const d2 = cross2D(b1, b2, a2);
  const d3 = cross2D(a1, a2, b1);
  const d4 = cross2D(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
      && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentClosestPoints(a, b, c, d) {
  const SMALL = 1e-9;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - c.x;
  const vy = d.y - c.y;
  const wx = a.x - c.x;
  const wy = a.y - c.y;

  const aDot = ux * ux + uy * uy;
  const bDot = ux * vx + uy * vy;
  const cDot = vx * vx + vy * vy;
  const dDot = ux * wx + uy * wy;
  const eDot = vx * wx + vy * wy;
  const denom = aDot * cDot - bDot * bDot;

  let sN, sD = denom;
  let tN, tD = denom;

  if (denom < SMALL) {
    sN = 0;
    sD = 1;
    tN = eDot;
    tD = cDot;
  } else {
    sN = (bDot * eDot - cDot * dDot);
    tN = (aDot * eDot - bDot * dDot);
    if (sN < 0) {
      sN = 0;
      tN = eDot;
      tD = cDot;
    } else if (sN > sD) {
      sN = sD;
      tN = eDot + bDot;
      tD = cDot;
    }
  }

  if (tN < 0) {
    tN = 0;
    if (-dDot < 0) sN = 0;
    else if (-dDot > aDot) sN = sD;
    else {
      sN = -dDot;
      sD = aDot;
    }
  } else if (tN > tD) {
    tN = tD;
    if ((-dDot + bDot) < 0) sN = 0;
    else if ((-dDot + bDot) > aDot) sN = sD;
    else {
      sN = (-dDot + bDot);
      sD = aDot;
    }
  }

  const sc = Math.abs(sN) < SMALL ? 0 : sN / sD;
  const tc = Math.abs(tN) < SMALL ? 0 : tN / tD;

  const p1 = { x: a.x + sc * ux, y: a.y + sc * uy };
  const p2 = { x: c.x + tc * vx, y: c.y + tc * vy };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return { p1, p2, dist2: dx * dx + dy * dy };
}
