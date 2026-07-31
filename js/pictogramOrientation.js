/**
 * Geometry helpers for orienting an SPQR skeleton pictogram so that it agrees
 * with the currently displayed graph drawing.  These functions deliberately
 * preserve the pictogram's own scale and only apply rotations/reflections.
 */

function pointForId(positions, id) {
  if (!positions) return null;
  return positions.get(id)
    ?? positions.get(Number(id))
    ?? positions.get(String(id))
    ?? null;
}

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function centroid(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function rotateAround(point, pivot, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point.x - pivot.x;
  const y = point.y - pivot.y;
  return {
    x: pivot.x + x * cos - y * sin,
    y: pivot.y + x * sin + y * cos
  };
}

function reflectAcrossLine(point, lineA, lineB) {
  const dx = lineB.x - lineA.x;
  const dy = lineB.y - lineA.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { ...point };

  const ux = dx / length;
  const uy = dy / length;
  const px = point.x - lineA.x;
  const py = point.y - lineA.y;
  const projection = px * ux + py * uy;
  return {
    x: lineA.x + 2 * projection * ux - px,
    y: lineA.y + 2 * projection * uy - py
  };
}

function sideSum(positions, ids, edge) {
  const [u, v] = edge;
  const a = pointForId(positions, u);
  const b = pointForId(positions, v);
  if (!finitePoint(a) || !finitePoint(b)) return 0;

  const excluded = new Set([Number(u), Number(v)]);
  let sum = 0;
  for (const id of ids) {
    if (excluded.has(Number(id))) continue;
    const point = pointForId(positions, id);
    if (!finitePoint(point)) continue;
    sum += (b.x - a.x) * (point.y - a.y)
      - (b.y - a.y) * (point.x - a.x);
  }
  return sum;
}

/**
 * Align a directed edge in nodeMap with the same directed edge in the graph.
 * If other labelled vertices are available, the pictogram is also reflected
 * across that edge when its interior lies on the wrong side.
 */
export function orientNodeMapByAnchor(
  nodeMap,
  drawingPositions,
  anchorEdge,
  vertexIds = [...nodeMap.keys()]
) {
  const [u, v] = anchorEdge || [];
  const sourceU = pointForId(nodeMap, u);
  const sourceV = pointForId(nodeMap, v);
  const targetU = pointForId(drawingPositions, u);
  const targetV = pointForId(drawingPositions, v);

  if (![sourceU, sourceV, targetU, targetV].every(finitePoint)) {
    return { matched: false, angle: 0, reflected: false };
  }

  const sourceAngle = Math.atan2(
    sourceV.y - sourceU.y,
    sourceV.x - sourceU.x
  );
  const targetAngle = Math.atan2(
    targetV.y - targetU.y,
    targetV.x - targetU.x
  );
  const angle = targetAngle - sourceAngle;
  const pivot = {
    x: (sourceU.x + sourceV.x) / 2,
    y: (sourceU.y + sourceV.y) / 2
  };

  for (const [id, point] of nodeMap) {
    nodeMap.set(id, rotateAround(point, pivot, angle));
  }

  const pictureSide = sideSum(nodeMap, vertexIds, anchorEdge);
  const drawingSide = sideSum(drawingPositions, vertexIds, anchorEdge);
  let reflected = false;

  if (
    Math.abs(pictureSide) > 1e-7
    && Math.abs(drawingSide) > 1e-7
    && Math.sign(pictureSide) !== Math.sign(drawingSide)
  ) {
    const alignedU = pointForId(nodeMap, u);
    const alignedV = pointForId(nodeMap, v);
    for (const [id, point] of nodeMap) {
      nodeMap.set(id, reflectAcrossLine(point, alignedU, alignedV));
    }
    reflected = true;
  }

  // Give every anchored pictogram the same stable local origin. In particular,
  // a Whitney flip now visibly reflects the skeleton around a parent edge that
  // stays fixed instead of letting the edge drift within the pictogram box.
  const finalU = pointForId(nodeMap, u);
  const finalV = pointForId(nodeMap, v);
  const anchorMidpoint = {
    x: (finalU.x + finalV.x) / 2,
    y: (finalU.y + finalV.y) / 2
  };
  for (const [id, point] of nodeMap) {
    nodeMap.set(id, {
      x: point.x - anchorMidpoint.x,
      y: point.y - anchorMidpoint.y
    });
  }

  return { matched: true, angle, reflected };
}

function evaluateRootCandidate(source, target, reflected) {
  let dot = 0;
  let cross = 0;

  for (let i = 0; i < source.length; i++) {
    const sourceX = source[i].x;
    const sourceY = reflected ? -source[i].y : source[i].y;
    const targetX = target[i].x;
    const targetY = target[i].y;
    dot += sourceX * targetX + sourceY * targetY;
    cross += sourceX * targetY - sourceY * targetX;
  }

  const angle = Math.atan2(cross, dot);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let error = 0;

  for (let i = 0; i < source.length; i++) {
    const sourceX = source[i].x;
    const sourceY = reflected ? -source[i].y : source[i].y;
    const x = sourceX * cos - sourceY * sin;
    const y = sourceX * sin + sourceY * cos;
    error += (x - target[i].x) ** 2 + (y - target[i].y) ** 2;
  }

  return { angle, reflected, error };
}

/**
 * Choose the rotation/reflection of an unanchored root pictogram that best
 * matches the positions of its labelled vertices in the graph drawing.
 */
export function orientRootNodeMap(
  nodeMap,
  drawingPositions,
  vertexIds = [...nodeMap.keys()]
) {
  const matchedIds = vertexIds.filter(id => {
    return finitePoint(pointForId(nodeMap, id))
      && finitePoint(pointForId(drawingPositions, id));
  });
  if (matchedIds.length < 2) {
    return { matched: false, angle: 0, reflected: false, error: Infinity };
  }

  const sourcePoints = matchedIds.map(id => pointForId(nodeMap, id));
  const targetPoints = matchedIds.map(id => pointForId(drawingPositions, id));
  const sourceCenter = centroid(sourcePoints);
  const targetCenter = centroid(targetPoints);

  let source = sourcePoints.map(point => ({
    x: point.x - sourceCenter.x,
    y: point.y - sourceCenter.y
  }));
  let target = targetPoints.map(point => ({
    x: point.x - targetCenter.x,
    y: point.y - targetCenter.y
  }));

  const sourceRms = Math.sqrt(
    source.reduce((sum, point) => sum + point.x ** 2 + point.y ** 2, 0)
      / source.length
  );
  const targetRms = Math.sqrt(
    target.reduce((sum, point) => sum + point.x ** 2 + point.y ** 2, 0)
      / target.length
  );
  if (sourceRms < 1e-9 || targetRms < 1e-9) {
    return { matched: false, angle: 0, reflected: false, error: Infinity };
  }

  source = source.map(point => ({
    x: point.x / sourceRms,
    y: point.y / sourceRms
  }));
  target = target.map(point => ({
    x: point.x / targetRms,
    y: point.y / targetRms
  }));

  const candidates = [
    evaluateRootCandidate(source, target, false),
    evaluateRootCandidate(source, target, true)
  ];
  const best = candidates.reduce((a, b) => a.error <= b.error ? a : b);
  const cos = Math.cos(best.angle);
  const sin = Math.sin(best.angle);

  for (const [id, point] of nodeMap) {
    const x = point.x - sourceCenter.x;
    const y = best.reflected
      ? -(point.y - sourceCenter.y)
      : point.y - sourceCenter.y;
    nodeMap.set(id, {
      x: sourceCenter.x + x * cos - y * sin,
      y: sourceCenter.y + x * sin + y * cos
    });
  }

  return { matched: true, ...best };
}

export function signedSideOfEdge(positions, vertexIds, anchorEdge) {
  return sideSum(positions, vertexIds, anchorEdge);
}
