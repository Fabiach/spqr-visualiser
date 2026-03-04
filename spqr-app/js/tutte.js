/**
 * tutte.js — Tutte (barycentric) embedding for planar graphs
 *
 * Implements Tutte's spring-embedding theorem:
 *   For a 3-connected planar graph, fixing the vertices of any face
 *   on a convex polygon and placing every interior vertex at the
 *   barycenter (average) of its neighbours yields a crossing-free
 *   straight-line drawing.
 *
 * Exports
 * -------
 *   tutteEmbedding(graph, outerFace)  → Map<vertex, {x,y}>
 *   extractFaces(embedding)           → number[][]
 *   findLargestFace(faces)            → number[]
 *   scaleToBox(positions, w, h, pad)  → Map<vertex, {x,y}>
 */

// ───────────────────────────────────────────────────────────────────
//  PUBLIC API
// ───────────────────────────────────────────────────────────────────

/**
 * Compute a Tutte embedding.
 *
 * @param {Map<number, number[]>} graph
 *        Adjacency list — vertex id → array of neighbour ids.
 *        The graph must be connected.
 * @param {number[]} outerFace
 *        Vertices of the chosen outer face **in cyclic order**
 *        (clockwise or counter-clockwise — both work, the polygon
 *        will simply be mirrored).
 * @returns {Map<number, {x:number, y:number}>}
 *          Position for every vertex.  Boundary vertices lie on the
 *          unit circle; interior vertices are inside the convex hull.
 */
export function tutteEmbedding(graph, outerFace) {
  // ── Validate ──────────────────────────────────────────────────
  if (!graph || graph.size === 0) {
    throw new Error("tutteEmbedding: empty graph");
  }
  if (!outerFace || outerFace.length < 3) {
    throw new Error("tutteEmbedding: outer face must have ≥ 3 vertices");
  }

  const positions = new Map();
  const outerSet  = new Set(outerFace);

  // ── 1. Fix outer face on a regular convex polygon (unit circle) ─
  const nBoundary = outerFace.length;
  for (let i = 0; i < nBoundary; i++) {
    //  start at the top (−π/2) and walk counter-clockwise
    const angle = (-Math.PI / 2) + (2 * Math.PI * i) / nBoundary;
    positions.set(outerFace[i], {
      x: Math.cos(angle),
      y: Math.sin(angle),
    });
  }

  // ── 2. Collect interior vertices ────────────────────────────────
  const interior = [];
  for (const v of graph.keys()) {
    if (!outerSet.has(v)) interior.push(v);
  }
  const m = interior.length;
  if (m === 0) return positions;          // nothing to solve

  // ── 3. Index map  vertex → row ──────────────────────────────────
  const idx = new Map();
  interior.forEach((v, i) => idx.set(v, i));

  // ── 4. Build system   L_int · x = b_x ,  L_int · y = b_y ──────
  //   Row i  (vertex v = interior[i]):
  //     deg(v) · x_i  −  Σ_{w interior neighbour} x_w  =  Σ_{w boundary neighbour} x_w
  const L  = zeros(m, m);
  const bx = new Float64Array(m);
  const by = new Float64Array(m);

  for (let i = 0; i < m; i++) {
    const v    = interior[i];
    const nbrs = graph.get(v) || [];

    // Only count neighbours that are part of this (sub)graph
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

  // ── 5. Solve both systems ───────────────────────────────────────
  const xs = gaussianElimination(cloneMat(L), Float64Array.from(bx));
  const ys = gaussianElimination(cloneMat(L), Float64Array.from(by));

  // ── 6. Assemble result ──────────────────────────────────────────
  for (let i = 0; i < m; i++) {
    positions.set(interior[i], { x: xs[i], y: ys[i] });
  }
  return positions;
}

// ───────────────────────────────────────────────────────────────────
//  FACE EXTRACTION  (from a combinatorial / rotation-system embedding)
// ───────────────────────────────────────────────────────────────────

/**
 * Given a combinatorial embedding (rotation system), extract every
 * face as a cyclic vertex sequence.
 *
 * @param {Map<number, number[]>} embedding
 *   For each vertex v, its neighbours listed in **counter-clockwise**
 *   order.  (Clockwise also works — the faces will simply be the
 *   "other" set of faces, but the largest-face heuristic still holds.)
 * @returns {number[][]}  Array of faces, each face = array of vertex ids.
 */
export function extractFaces(embedding) {
  const visited = new Set();   // stores "u→v" half-edge keys
  const faces   = [];

  for (const [u, nbrs] of embedding) {
    for (let k = 0; k < nbrs.length; k++) {
      const v   = nbrs[k];
      const key = `${u}->${v}`;
      if (visited.has(key)) continue;

      // Trace the face starting from half-edge  u → v
      const face = [];
      let cur  = u;
      let next = v;

      do {
        face.push(cur);
        visited.add(`${cur}->${next}`);

        // At vertex `next`, find where `cur` sits in the neighbour list
        const nextNbrs = embedding.get(next);
        const pos      = nextNbrs.indexOf(cur);

        // The next half-edge of the same face:
        //   advance one position in the CCW list  →  prev in CW
        //   i.e. (pos + 1) % degree
        const nextPos = (pos + 1) % nextNbrs.length;

        cur  = next;
        next = nextNbrs[nextPos];
      } while (!(cur === u && next === v));

      faces.push(face);
    }
  }
  return faces;
}

/**
 * Return the face with the most vertices (a reasonable heuristic for
 * the "outer" face of a maximal planar or near-maximal planar graph).
 *
 * @param {number[][]} faces — output of extractFaces()
 * @returns {number[]}
 */
export function findLargestFace(faces) {
  let best = [];
  for (const f of faces) {
    if (f.length > best.length) best = f;
  }
  return best;
}

// ───────────────────────────────────────────────────────────────────
//  SCALING / CENTERING UTILITIES
// ───────────────────────────────────────────────────────────────────

/**
 * Linearly rescale positions so they fit inside the box
 * [pad, width−pad] × [pad, height−pad].
 *
 * @param {Map<number,{x:number,y:number}>} positions
 * @param {number} width   target box width
 * @param {number} height  target box height
 * @param {number} [pad=20]  padding on every side
 * @returns {Map<number,{x:number,y:number}>}  new map (original unchanged)
 */
export function scaleToBox(positions, width, height, pad = 20) {
  let minX =  Infinity, maxX = -Infinity;
  let minY =  Infinity, maxY = -Infinity;

  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x;  if (x > maxX) maxX = x;
    if (y < minY) minY = y;  if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale  = Math.min((width  - 2 * pad) / rangeX,
                           (height - 2 * pad) / rangeY);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const out = new Map();
  for (const [v, { x, y }] of positions) {
    out.set(v, {
      x: width  / 2 + (x - cx) * scale,
      y: height / 2 + (y - cy) * scale,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────
//  LINEAR ALGEBRA  (Gaussian elimination with partial pivoting)
// ───────────────────────────────────────────────────────────────────

/**
 * Solve  A x = b  via Gaussian elimination with partial pivoting.
 * **Destructive** — A and b are modified in place.
 *
 * @param {Float64Array[]} A  n×n matrix (array of rows)
 * @param {Float64Array}   b  right-hand side (length n)
 * @returns {Float64Array}    solution vector x
 */
export function gaussianElimination(A, b) {
  const n = b.length;

  // ── Forward elimination ───────────────────────────────────────
  for (let col = 0; col < n; col++) {
    // Partial pivoting — find row with largest |A[row][col]|
    let bestVal = Math.abs(A[col][col]);
    let bestRow = col;
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(A[row][col]);
      if (v > bestVal) { bestVal = v; bestRow = row; }
    }
    if (bestRow !== col) {
      [A[col], A[bestRow]] = [A[bestRow], A[col]];
      [b[col], b[bestRow]] = [b[bestRow], b[col]];
    }

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error(`Singular matrix at column ${col}`);
    }

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let k = col; k < n; k++) {
        A[row][k] -= factor * A[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  // ── Back substitution ─────────────────────────────────────────
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
    x[i] = sum / A[i][i];
  }
  return x;
}

// ───────────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ───────────────────────────────────────────────────────────────────

/** Create an m×n zero-filled matrix (array of Float64Arrays). */
function zeros(m, n) {
  const M = new Array(m);
  for (let i = 0; i < m; i++) M[i] = new Float64Array(n);
  return M;
}

/** Deep-clone a matrix (array of Float64Arrays). */
function cloneMat(M) {
  return M.map(row => Float64Array.from(row));
}
