/**
 * Flexible graph import: accept the most common textual graph representations
 * pasted from the internet, auto-detect the format, and normalise to the shape
 * the rest of the app expects.
 *
 * Output contract (matches what drawInputGraph / the SPQR pipeline consume):
 *   {
 *     vertices: [{ id: <int>, label: <original string> }, ...],
 *     edges:    [[<int>, <int>], ...]   // endpoints are the mapped integer ids
 *   }
 *
 * Why integers: the SPQR pipeline (edge-map keys, edge creation, exporter)
 * assumes numeric vertex ids. So every distinct pasted label is mapped to a
 * stable integer 1..n; the original label is preserved on each vertex for
 * display. Graphs that already use integers map to themselves.
 *
 * Supported formats (auto-detected):
 *   - Edge list:      "1 2" / "1-2" / "1,2" / "A B", one edge per line
 *   - Adjacency list: "1: 2 3 4"  or  "1 2 3 4"  (first token = vertex)
 *   - DOT / Graphviz: graph { 1 -- 2; 2 -- 3 }  (also digraph / -> )
 *   - JSON:           {nodes,edges} | {nodes,links} | {links} | our own export
 */

export class GraphImportError extends Error {}

/** Assigns stable integer ids to labels in first-seen order. */
function makeLabelMapper() {
  const labelToId = new Map();
  let next = 1;
  return {
    id(label) {
      const key = String(label);
      if (!labelToId.has(key)) labelToId.set(key, next++);
      return labelToId.get(key);
    },
    has(label) {
      return labelToId.has(String(label));
    },
    labels: labelToId,
  };
}

/**
 * Build the {vertices, edges} result from a list of edges (as label pairs) and
 * an optional list of isolated/standalone vertex labels. Handles the label→int
 * mapping and de-duplicates vertices while preserving first-seen order.
 */
function assemble(edgeLabelPairs, extraVertexLabels = []) {
  const mapper = makeLabelMapper();
  const seenOrder = []; // ids in first-seen order
  const seen = new Set();

  const note = label => {
    const id = mapper.id(label);
    if (!seen.has(id)) {
      seen.add(id);
      seenOrder.push({ id, label: String(label) });
    }
    return id;
  };

  // Vertices appear in edge order first, then any standalone vertices.
  const edges = edgeLabelPairs.map(([a, b]) => {
    const ai = note(a);
    const bi = note(b);
    return [ai, bi];
  });
  for (const v of extraVertexLabels) note(v);

  return { vertices: seenOrder, edges };
}

// ── Format detection ─────────────────────────────────────────────────────────

function looksLikeJSON(text) {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[');
}

function looksLikeDOT(text) {
  return /\b(strict\s+)?(di)?graph\b/i.test(text) || /--|->/.test(text);
}

/** An adjacency list has lines with 3+ tokens or an explicit "v:" head. */
function looksLikeAdjacencyList(lines) {
  let multiNeighborLines = 0;
  let colonHeads = 0;
  for (const line of lines) {
    if (/^\s*[^:\s]+\s*:/.test(line)) colonHeads++;
    const tokens = tokenize(line);
    if (tokens.length >= 3) multiNeighborLines++;
  }
  // Explicit "v:" heads are a strong signal; otherwise require that most lines
  // carry more than two tokens (an edge list is exactly two per line).
  if (colonHeads >= Math.ceil(lines.length / 2)) return true;
  return multiNeighborLines >= Math.ceil(lines.length / 2) && multiNeighborLines > 0;
}

/**
 * Split a line into tokens on commas / whitespace / semicolons / arrows / dashes.
 * A single "-" between tokens (the common "1-2" edge shorthand) is treated as a
 * separator too; the trade-off is that hyphenated labels like "node-1" are not
 * supported, which is rare in pasted graph input.
 */
function tokenize(line) {
  return line
    .replace(/->|--/g, ' ')
    .split(/[\s,;-]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Per-format parsers ─────────────────────────────────────────────────────────

function parseJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new GraphImportError('Could not parse JSON: ' + e.message);
  }

  // Our own OGDF export (or anything with originalGraph) → use the original graph.
  if (data && data.originalGraph) data = data.originalGraph;

  const edgePairs = [];
  const extraVertices = [];

  const edgeArr = data.edges || data.links;
  if (Array.isArray(edgeArr)) {
    for (const e of edgeArr) {
      if (Array.isArray(e) && e.length >= 2) {
        edgePairs.push([e[0], e[1]]);
      } else if (e && typeof e === 'object') {
        const s = e.source ?? e.from ?? e.u ?? e[0];
        const t = e.target ?? e.to ?? e.v ?? e[1];
        if (s == null || t == null) {
          throw new GraphImportError('JSON edge missing source/target: ' + JSON.stringify(e));
        }
        // networkx/D3 may reference nodes by index or id; keep as-is (labels).
        edgePairs.push([s, t]);
      } else {
        throw new GraphImportError('Unrecognised JSON edge: ' + JSON.stringify(e));
      }
    }
  } else {
    throw new GraphImportError('JSON has no "edges" or "links" array.');
  }

  if (Array.isArray(data.nodes)) {
    for (const n of data.nodes) {
      const id = (n && typeof n === 'object') ? (n.id ?? n.name ?? n.label) : n;
      if (id != null) extraVertices.push(id);
    }
  }

  return assemble(edgePairs, extraVertices);
}

function parseDOT(text) {
  // Strip comments and the graph header/braces, then read edge statements.
  const body = text
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\b(strict\s+)?(di)?graph\b[^{]*\{/i, ' ')
    .replace(/\}/g, ' ');

  const edgePairs = [];
  const extraVertices = [];

  for (let stmt of body.split(/[;\n]+/)) {
    stmt = stmt.trim();
    if (!stmt) continue;
    // Drop attribute lists like [label="x"].
    stmt = stmt.replace(/\[[^\]]*\]/g, '').trim();
    if (!stmt) continue;
    // Skip pure attribute / keyword statements.
    if (/^(node|edge|rankdir|graph)\b/i.test(stmt) && !/--|->/.test(stmt)) continue;

    if (/--|->/.test(stmt)) {
      // A chain a -- b -- c produces edges a-b, b-c.
      const parts = stmt.split(/--|->/).map(s => unquote(s.trim())).filter(Boolean);
      for (let i = 0; i + 1 < parts.length; i++) edgePairs.push([parts[i], parts[i + 1]]);
    } else if (/=/.test(stmt)) {
      continue; // a graph-level attribute assignment
    } else {
      const v = unquote(stmt);
      if (v) extraVertices.push(v);
    }
  }

  if (edgePairs.length === 0 && extraVertices.length === 0) {
    throw new GraphImportError('No edges found in DOT input.');
  }
  return assemble(edgePairs, extraVertices);
}

function unquote(s) {
  return s.replace(/^["']|["']$/g, '');
}

function parseAdjacencyList(lines) {
  const edgePairs = [];
  const extraVertices = [];
  for (const line of lines) {
    // Support "v: n1 n2" and "v n1 n2".
    const m = line.match(/^\s*([^:\s]+)\s*:\s*(.*)$/);
    let head, rest;
    if (m) {
      head = m[1];
      rest = tokenize(m[2]);
    } else {
      const toks = tokenize(line);
      head = toks[0];
      rest = toks.slice(1);
    }
    if (head == null) continue;
    if (rest.length === 0) {
      extraVertices.push(head);
    } else {
      for (const n of rest) edgePairs.push([head, n]);
    }
  }
  if (edgePairs.length === 0 && extraVertices.length === 0) {
    throw new GraphImportError('No vertices found in adjacency list.');
  }
  return assemble(edgePairs, extraVertices);
}

function parseEdgeList(lines) {
  const edgePairs = [];
  const extraVertices = [];
  for (const line of lines) {
    const toks = tokenize(line);
    if (toks.length === 0) continue;
    if (toks.length === 1) {
      extraVertices.push(toks[0]);
    } else {
      // Two tokens = one edge. If a line has more than two (and we got here,
      // i.e. it wasn't detected as an adjacency list), pair them sequentially.
      for (let i = 0; i + 1 < toks.length; i += 2) {
        if (toks[i + 1] != null) edgePairs.push([toks[i], toks[i + 1]]);
      }
    }
  }
  if (edgePairs.length === 0 && extraVertices.length === 0) {
    throw new GraphImportError('No edges found. Expected one edge per line, e.g. "1 2".');
  }
  return assemble(edgePairs, extraVertices);
}

// ── Public entry point ─────────────────────────────────────────────────────────

/**
 * Parse pasted text into { vertices:[{id,label}], edges:[[int,int]], format }.
 * Throws GraphImportError with a human-readable message on failure.
 *
 * @param {string} text
 * @returns {{vertices: {id:number,label:string}[], edges: [number,number][], format: string}}
 */
export function parseGraphText(text) {
  if (!text || !text.trim()) {
    throw new GraphImportError('Input is empty.');
  }

  let format;
  let result;

  if (looksLikeJSON(text)) {
    format = 'json';
    result = parseJSON(text);
  } else {
    // Strip whole-line comments up front so format detection is not fooled by
    // words like "graph" appearing inside a comment.
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('%'));
    if (lines.length === 0) throw new GraphImportError('Input has no data lines.');

    const cleaned = lines.join('\n');
    if (looksLikeDOT(cleaned)) {
      format = 'dot';
      result = parseDOT(cleaned);
    } else if (looksLikeAdjacencyList(lines)) {
      format = 'adjacency-list';
      result = parseAdjacencyList(lines);
    } else {
      format = 'edge-list';
      result = parseEdgeList(lines);
    }
  }

  // Drop self-loops and duplicate (undirected) edges — the SPQR pipeline works
  // on simple biconnected graphs; keeping these would only create noise.
  const seen = new Set();
  const edges = [];
  for (const [a, b] of result.edges) {
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }

  if (result.vertices.length === 0) {
    throw new GraphImportError('No vertices could be read from the input.');
  }
  if (edges.length === 0) {
    throw new GraphImportError(
      'No edges could be read from the input. Expected something like "1 2" per line, ' +
      '"1: 2 3", a DOT "a -- b", or JSON {nodes, edges}.'
    );
  }

  return { vertices: result.vertices, edges, format };
}
