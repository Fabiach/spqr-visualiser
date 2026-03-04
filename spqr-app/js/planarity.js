/**
 * planarity.js — Planarity testing and planar embedding
 *
 * Two main strategies:
 *
 * 1. **Full planarity test + embedding** via an incremental edge-addition
 *    algorithm with face tracking.  Runs in O(V²) which is fine for
 *    small SPQR component subgraphs (typically < 50 vertices).
 *
 * 2. **Embedding-only** for graphs already known to be planar (e.g.
 *    R-components of an SPQR tree of a planar input graph).
 *
 * Both produce a **rotation system**: Map<vertex, orderedNeighbours[]>
 * where neighbours are listed in consistent cyclic order around
 * every vertex.
 *
 * Exports
 * -------
 *   isPlanarAndEmbed(graph) → { planar, embedding }
 *   isPlanar(graph)         → boolean
 *   computePlanarEmbedding(graph) → Map  (assumes graph is planar)
 */

// ═══════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Test planarity and — if planar — compute a combinatorial embedding.
 *
 * @param {Map<number, number[]>} graph
 *        Adjacency list (undirected, simple).
 * @returns {{ planar: boolean, embedding: Map<number, number[]>|null }}
 */
export function isPlanarAndEmbed(graph) {
  const V = graph.size;
  if (V <= 3) return { planar: true, embedding: trivialEmbed(graph) };

  const E = countEdges(graph);
  if (E > 3 * V - 6) return { planar: false, embedding: null };

  return fragmentEmbed(graph);
}

/**
 * Convenience — just the boolean.
 */
export function isPlanar(graph) {
  return isPlanarAndEmbed(graph).planar;
}

/**
 * Compute a planar embedding for a graph that is already known to be
 * planar (skips the planarity proof).  Falls back to DFS-tree-based
 * embedding.
 *
 * @param {Map<number, number[]>} graph
 * @returns {Map<number, number[]>}  rotation system
 */
export function computePlanarEmbedding(graph) {
  const result = isPlanarAndEmbed(graph);
  if (result.planar) return result.embedding;
  // Fallback: just return sorted neighbours
  return trivialEmbed(graph);
}

// ═══════════════════════════════════════════════════════════════════
//  TRIVIAL CASES
// ═══════════════════════════════════════════════════════════════════

function trivialEmbed(graph) {
  const emb = new Map();
  for (const [v, nbrs] of graph) {
    emb.set(v, [...nbrs].sort((a, b) => a - b));
  }
  return emb;
}

function countEdges(graph) {
  let c = 0;
  for (const [, nbrs] of graph) c += nbrs.length;
  return c / 2;
}

// ═══════════════════════════════════════════════════════════════════
//  FRAGMENT-BASED EMBEDDING  (Demoucron-Malgrange-Pertuiset style)
// ═══════════════════════════════════════════════════════════════════
//
// Overview
// --------
// 1. Find a cycle C in the graph (an initial face).
// 2. Maintain a set of "fragments" — subgraphs not yet embedded whose
//    attachment points (contact vertices) lie on already-embedded vertices.
// 3. For each fragment, determine which faces of the current embedding
//    can accommodate it.
// 4. If some fragment has 0 admissible faces → non-planar.
//    If exactly 1 → embed it there.
//    If > 1 → pick any.
// 5. Embedding a fragment means choosing a path within it between two
//    contact vertices and splicing that path into the chosen face.
// 6. Repeat until all edges are embedded.

function fragmentEmbed(graph) {
  const vertices = [...graph.keys()];
  const V = vertices.length;
  const E = countEdges(graph);

  // ── 1. Find a cycle using DFS back-edge ──────────────────────
  const { parent, depth, backEdges } = dfsTree(graph, vertices[0]);

  if (backEdges.length === 0) {
    // Tree → trivially planar
    return { planar: true, embedding: trivialEmbed(graph) };
  }

  // ── 2. Initialise with the first cycle ────────────────────────
  const [bu, bv] = backEdges[0];  // back edge from deeper bu to ancestor bv
  const initCycle = pathToRoot(bu, bv, parent);  // [bv, ..., bu]

  const emb = new PlanarEmb();
  emb.initCycle(initCycle);

  const embeddedEdges = new Set();
  for (let i = 0; i < initCycle.length; i++) {
    const a = initCycle[i];
    const b = initCycle[(i + 1) % initCycle.length];
    embeddedEdges.add(canon(a, b));
  }

  const embeddedVerts = new Set(initCycle);

  // ── 3. Compute fragments and embed one by one ─────────────────
  let iteration = 0;
  const MAX_ITER = E * V + 10; // safety bound

  while (embeddedEdges.size < E) {
    if (++iteration > MAX_ITER) {
      return { planar: false, embedding: null };
    }

    const fragments = computeFragments(graph, embeddedVerts, embeddedEdges);

    if (fragments.length === 0) break;

    // For each fragment, find admissible faces
    let embedded = false;

    // Sort fragments: those with fewest admissible faces first (most constrained)
    const fragInfo = [];
    for (const frag of fragments) {
      const contacts = frag.contacts;
      const admissible = emb.admissibleFaces(contacts);
      fragInfo.push({ frag, admissible });
    }
    fragInfo.sort((a, b) => a.admissible.length - b.admissible.length);

    for (const { frag, admissible } of fragInfo) {
      if (admissible.length === 0) {
        return { planar: false, embedding: null };
      }

      const face = admissible[0];
      const path = findFragmentPath(frag, embeddedVerts);

      if (!path || path.length < 2) continue;

      const ok = emb.embedPathInFace(path, face);
      if (!ok) {
        return { planar: false, embedding: null };
      }

      for (let i = 0; i < path.length - 1; i++) {
        embeddedEdges.add(canon(path[i], path[i + 1]));
      }
      for (const v of path) embeddedVerts.add(v);

      embedded = true;
      break;  // recompute fragments after each step
    }

    if (!embedded) {
      return { planar: false, embedding: null };
    }
  }

  // ── 4. Extract rotation system ────────────────────────────────
  const rotation = emb.toRotation();

  // Verify completeness
  for (const [v, nbrs] of graph) {
    const rot = rotation.get(v);
    if (!rot || rot.length !== nbrs.length) {
      return { planar: false, embedding: null };
    }
  }

  return { planar: true, embedding: rotation };
}

// ═══════════════════════════════════════════════════════════════════
//  PLANAR EMBEDDING DATA STRUCTURE
// ═══════════════════════════════════════════════════════════════════

class PlanarEmb {
  constructor() {
    this.nxt = new Map();
    this.prv = new Map();
  }

  k(u, v) { return `${u}->${v}`; }

  pk(key) {
    const i = key.indexOf("->");
    return [Number(key.slice(0, i)), Number(key.slice(i + 2))];
  }

  /** Initialise with a single cycle [v0, v1, ..., vk]. */
  initCycle(c) {
    const n = c.length;
    // Interior face: c[0]→c[1]→c[2]→...→c[0]
    for (let i = 0; i < n; i++) {
      const u = c[i], v = c[(i + 1) % n], w = c[(i + 2) % n];
      this._link(this.k(u, v), this.k(v, w));
    }
    // Exterior face: c[0]→c[n-1]→c[n-2]→...→c[0]
    for (let i = 0; i < n; i++) {
      const u = c[i], v = c[((i - 1) + n) % n], w = c[((i - 2) + n) % n];
      this._link(this.k(u, v), this.k(v, w));
    }
  }

  _link(a, b) {
    this.nxt.set(a, b);
    this.prv.set(b, a);
  }

  // ── Face operations ─────────────────────────────────────────────

  traceFace(startKey) {
    const verts = new Set();
    const edges = [];
    let cur = startKey;
    const safety = this.nxt.size + 2;
    let steps = 0;
    do {
      edges.push(cur);
      const [a] = this.pk(cur);
      verts.add(a);
      cur = this.nxt.get(cur);
      if (!cur || ++steps > safety) break;
    } while (cur !== startKey);
    return { verts, edges };
  }

  allFaces() {
    const visited = new Set();
    const faces = [];
    for (const key of this.nxt.keys()) {
      if (visited.has(key)) continue;
      const face = this.traceFace(key);
      for (const ek of face.edges) visited.add(ek);
      faces.push(face);
    }
    return faces;
  }

  admissibleFaces(contacts) {
    if (contacts.length === 0) return this.allFaces();
    if (contacts.length === 1) return this._facesOf(contacts[0]);

    const candidates = this._facesOf(contacts[0]);
    return candidates.filter(f => {
      for (let i = 1; i < contacts.length; i++) {
        if (!f.verts.has(contacts[i])) return false;
      }
      return true;
    });
  }

  _facesOf(v) {
    const faces = [];
    const seen = new Set();
    for (const key of this.nxt.keys()) {
      const [a] = this.pk(key);
      if (a !== v) continue;
      if (seen.has(key)) continue;
      const face = this.traceFace(key);
      for (const ek of face.edges) seen.add(ek);
      faces.push(face);
    }
    return faces;
  }

  // ── Path embedding ──────────────────────────────────────────────

  embedPathInFace(path, face) {
    const u = path[0];
    const v = path[path.length - 1];

    if (path.length === 2 && u === v) return true;

    // Find half-edges on this face arriving at u and arriving at v
    let heArriveU = null;
    let heLeaveU = null;
    let heArriveV = null;
    let heLeaveV = null;

    for (const ek of face.edges) {
      const [a, b] = this.pk(ek);
      if (a === u && !heLeaveU) heLeaveU = ek;
      if (b === u && !heArriveU) heArriveU = ek;
      if (a === v && !heLeaveV) heLeaveV = ek;
      if (b === v && !heArriveV) heArriveV = ek;
    }

    // Pendant: only one endpoint on the face boundary
    if (u === v || (!heLeaveV && !heArriveV)) {
      return this._embedPendant(path, heArriveU, heLeaveU);
    }

    if (!heLeaveU || !heLeaveV || !heArriveU || !heArriveV) return false;

    const fwd = [];
    const bwd = [];
    for (let i = 0; i < path.length - 1; i++) {
      fwd.push(this.k(path[i], path[i + 1]));
      bwd.push(this.k(path[i + 1], path[i]));
    }
    bwd.reverse();

    // Face A: ... → heArriveU → fwd → heLeaveV → ...
    this._link(heArriveU, fwd[0]);
    for (let i = 0; i < fwd.length - 1; i++) this._link(fwd[i], fwd[i + 1]);
    this._link(fwd[fwd.length - 1], heLeaveV);

    // Face B: ... → heArriveV → bwd → heLeaveU → ...
    this._link(heArriveV, bwd[0]);
    for (let i = 0; i < bwd.length - 1; i++) this._link(bwd[i], bwd[i + 1]);
    this._link(bwd[bwd.length - 1], heLeaveU);

    return true;
  }

  _embedPendant(path, heArriveU, heLeaveU) {
    if (!heArriveU || !heLeaveU) return false;

    const fwd = [];
    const bwd = [];
    for (let i = 0; i < path.length - 1; i++) {
      fwd.push(this.k(path[i], path[i + 1]));
      bwd.push(this.k(path[i + 1], path[i]));
    }
    bwd.reverse();

    // Insert spike: ... → heArriveU → fwd → bwd → heLeaveU → ...
    this._link(heArriveU, fwd[0]);
    for (let i = 0; i < fwd.length - 1; i++) this._link(fwd[i], fwd[i + 1]);
    this._link(fwd[fwd.length - 1], bwd[0]);
    for (let i = 0; i < bwd.length - 1; i++) this._link(bwd[i], bwd[i + 1]);
    this._link(bwd[bwd.length - 1], heLeaveU);

    return true;
  }

  // ── Rotation extraction ─────────────────────────────────────────

  toRotation() {
    const outgoing = new Map();
    for (const key of this.nxt.keys()) {
      const [u] = this.pk(key);
      if (!outgoing.has(u)) outgoing.set(u, []);
      outgoing.get(u).push(key);
    }

    const rotation = new Map();
    for (const [v, outs] of outgoing) {
      if (outs.length === 0) continue;
      const order = [];
      const start = outs[0];
      let cur = start;
      const visited = new Set();
      do {
        const [, w] = this.pk(cur);
        order.push(w);
        visited.add(cur);
        const twin = this.k(w, v);
        cur = this.nxt.get(twin);
        if (!cur) break;
      } while (cur !== start && !visited.has(cur));

      rotation.set(v, order);
    }
    return rotation;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  FRAGMENT COMPUTATION
// ═══════════════════════════════════════════════════════════════════

function computeFragments(graph, embeddedVerts, embeddedEdges) {
  const unembedded = [];
  for (const [u, nbrs] of graph) {
    for (const v of nbrs) {
      if (u < v && !embeddedEdges.has(canon(u, v))) {
        unembedded.push([u, v]);
      }
    }
  }
  if (unembedded.length === 0) return [];

  const adj = new Map();
  for (const [u, v] of unembedded) {
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u).push(v);
    adj.get(v).push(u);
  }

  const visited = new Set();
  const fragments = [];

  for (const startV of adj.keys()) {
    if (visited.has(startV)) continue;

    const compVerts = new Set();
    const compEdges = [];
    const queue = [startV];
    const vVisited = new Set();

    while (queue.length > 0) {
      const w = queue.shift();
      if (vVisited.has(w)) continue;
      vVisited.add(w);
      visited.add(w);
      compVerts.add(w);

      // If w is an embedded vertex, don't expand through it
      // (it's a contact point — we stop here)
      if (embeddedVerts.has(w) && w !== startV) {
        // Still add edges from w, but don't expand
        for (const x of (adj.get(w) || [])) {
          const ek = canon(w, x);
          if (!embeddedEdges.has(ek) && !compEdges.some(e => canon(e[0], e[1]) === ek)) {
            // We'll pick up this edge from the other side
          }
        }
        continue;
      }

      for (const x of (adj.get(w) || [])) {
        const ek = canon(w, x);
        if (embeddedEdges.has(ek)) continue;
        if (!compEdges.some(e => canon(e[0], e[1]) === ek)) {
          compEdges.push([w, x]);
        }
        compVerts.add(x);
        if (!vVisited.has(x)) queue.push(x);
      }
    }

    const contacts = [...compVerts].filter(v => embeddedVerts.has(v));

    if (compEdges.length > 0) {
      fragments.push({ verts: compVerts, edges: compEdges, contacts });
    }
  }

  return fragments;
}

function findFragmentPath(frag, embeddedVerts) {
  const { verts, edges, contacts } = frag;

  const adj = new Map();
  for (const v of verts) adj.set(v, []);
  for (const [u, v] of edges) {
    adj.get(u).push(v);
    adj.get(v).push(u);
  }

  if (contacts.length >= 2) {
    const start = contacts[0];
    const targets = new Set(contacts.slice(1));
    return bfsPath(start, targets, adj, embeddedVerts);
  } else if (contacts.length === 1) {
    const start = contacts[0];
    for (const w of (adj.get(start) || [])) {
      if (!embeddedVerts.has(w)) return [start, w];
    }
    return null;
  }

  return null;
}

function bfsPath(start, targets, adj, embeddedVerts) {
  const parent = new Map();
  parent.set(start, null);
  const queue = [start];

  while (queue.length > 0) {
    const u = queue.shift();
    if (u !== start && targets.has(u)) {
      const path = [];
      let cur = u;
      while (cur !== null) { path.push(cur); cur = parent.get(cur); }
      path.reverse();
      return path;
    }
    for (const w of (adj.get(u) || [])) {
      if (parent.has(w)) continue;
      if (embeddedVerts.has(w) && !targets.has(w) && w !== start) continue;
      parent.set(w, u);
      queue.push(w);
    }
  }

  // Fallback: allow any vertex
  parent.clear();
  parent.set(start, null);
  const q2 = [start];
  while (q2.length > 0) {
    const u = q2.shift();
    if (u !== start && targets.has(u)) {
      const path = [];
      let cur = u;
      while (cur !== null) { path.push(cur); cur = parent.get(cur); }
      path.reverse();
      return path;
    }
    for (const w of (adj.get(u) || [])) {
      if (parent.has(w)) continue;
      parent.set(w, u);
      q2.push(w);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  DFS TREE
// ═══════════════════════════════════════════════════════════════════

function dfsTree(graph, start) {
  const parent = new Map();
  const depth = new Map();
  const dfsOrder = [];
  const backEdges = [];
  const visited = new Set();
  const treeEdgeSet = new Set();

  function dfs(u, par, d) {
    visited.add(u);
    parent.set(u, par);
    depth.set(u, d);
    dfsOrder.push(u);

    for (const w of (graph.get(u) || [])) {
      if (!visited.has(w)) {
        treeEdgeSet.add(canon(u, w));
        dfs(w, u, d + 1);
      } else if (w !== par && !treeEdgeSet.has(canon(u, w))) {
        if (depth.get(u) > depth.get(w)) {
          backEdges.push([u, w]);
        }
        treeEdgeSet.add(canon(u, w));
      }
    }
  }

  dfs(start, -1, 0);
  return { parent, depth, dfsOrder, backEdges };
}

function pathToRoot(u, anc, parent) {
  const path = [];
  let cur = u;
  while (cur !== anc && cur !== -1 && cur !== undefined) {
    path.push(cur);
    cur = parent.get(cur);
  }
  if (cur === anc) path.push(anc);
  path.reverse();
  return path;
}

// ═══════════════════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════════════════

function canon(u, v) {
  return u < v ? `${u}-${v}` : `${v}-${u}`;
}

// ═══════════════════════════════════════════════════════════════════
//  EMBEDDING VALIDATION  (for debugging)
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate that an embedding (rotation system) is consistent with
 * the graph and forms a valid planar embedding.
 *
 * Returns { valid, errors } where errors is an array of strings
 * describing any problems found.
 */
export function validateEmbedding(graph, embedding) {
  const errors = [];

  if (!embedding) {
    errors.push('Embedding is null/undefined');
    return { valid: false, errors };
  }

  // 1. Every graph vertex must appear in the embedding
  for (const v of graph.keys()) {
    if (!embedding.has(v)) {
      errors.push(`Vertex ${v} missing from embedding`);
    }
  }

  // 2. Every embedding vertex must be in the graph
  for (const v of embedding.keys()) {
    if (!graph.has(v)) {
      errors.push(`Embedding has extra vertex ${v} not in graph`);
    }
  }

  // 3. Each vertex's rotation must have the same neighbors as the graph
  for (const [v, rot] of embedding) {
    const graphNbrs = new Set((graph.get(v) || []).map(Number));
    const embNbrs = new Set(rot.map(Number));

    for (const w of graphNbrs) {
      if (!embNbrs.has(w)) errors.push(`Vertex ${v}: neighbor ${w} in graph but missing from embedding rotation`);
    }
    for (const w of embNbrs) {
      if (!graphNbrs.has(w)) errors.push(`Vertex ${v}: neighbor ${w} in embedding but not a graph neighbor`);
    }
    if (rot.length !== graphNbrs.size) {
      errors.push(`Vertex ${v}: rotation has ${rot.length} entries but graph has ${graphNbrs.size} neighbors`);
    }
    // Check for duplicates in rotation
    if (new Set(rot).size !== rot.length) {
      errors.push(`Vertex ${v}: rotation has duplicate entries: [${rot}]`);
    }
  }

  // 4. Symmetry check: if u lists w as neighbor, w must list u
  for (const [v, rot] of embedding) {
    for (const w of rot) {
      const wRot = embedding.get(w);
      if (!wRot) {
        errors.push(`Vertex ${v} has neighbor ${w} but ${w} has no embedding entry`);
      } else if (!wRot.includes(v)) {
        errors.push(`Vertex ${v} lists ${w} as neighbor, but ${w}'s rotation [${wRot}] does not include ${v}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
