/**
 * decompositionAnimation.js
 *
 * A bespoke, non-reusable animation that illustrates the SPQR decomposition of
 * one specific graph used in the tutorial:
 *
 *     vertices: [1, 2, 3, 4, 5]
 *     edges:    [1,5] [1,2] [2,3] [2,4] [2,5] [3,4] [3,5] [4,5]
 *
 * The graph is biconnected and splits at the separation pair {2, 5} into:
 *   - S node : path 2–1–5            (+ virtual edge 2–5)   "left part"
 *   - P node : real edge 2–5         (+ 2 virtual edges)    "middle"
 *   - R node : K4 on {2,3,4,5}       (+ virtual edge 2–5)   "right part"
 *
 * The animation walks through:
 *   1. full graph, separation pair {2,5} highlighted
 *   2. the left part (S) peels off to the left, leaving virtual edges behind
 *   3. the right part (R) peels off to the right, leaving the P node in the middle
 *   4. three separate components, each with its own virtual edge(s)
 *   5. the virtual edges line up to show how the three components reconnect
 *
 * This is intentionally hardcoded for this graph only. It draws into a plain
 * <svg> using d3 (already loaded globally on the page).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// Component colours – match the rest of the tutorial.
const COLOR = {
  S: '#32b450',   // green  (series)
  P: '#4682e6',   // blue   (parallel)
  R: '#e0492f',   // red    (rigid)
  sep: '#f0a020',  // orange (separation pair vertices 2 & 5)
  vertex: '#444',  // neutral interior vertices
  edge: '#555',
  virtual: '#9a6bd0', // virtual edge colour (purple, distinct from components)
};

const VIEW_W = 760;
const VIEW_H = 360;
const R = 15; // vertex radius

/**
 * Layouts.  Each named layout maps a vertex key to {x, y}.  Vertex keys are
 * strings; we use suffixes (e.g. "2S", "2P", "2R") to represent the copies of
 * the separation-pair vertices that appear in more than one component once the
 * graph has been split.
 */

// Phase 0 – the whole graph, centred.  Separation pair {2,5} on a vertical axis.
const FULL = {
  '1': { x: 250, y: 180 },
  '2': { x: 370, y: 70 },
  '5': { x: 370, y: 290 },
  '4': { x: 470, y: 180 },
  '3': { x: 560, y: 180 },
};

// Layout once everything has been split into three components, arranged
// left (S) – middle (P) – right (R).  Copies of 2 & 5 per component.
const SPLIT = {
  // S component (left)
  '2S': { x: 120, y: 70 },
  '5S': { x: 120, y: 290 },
  '1':  { x: 55,  y: 180 },
  // P component (middle)
  '2P': { x: 370, y: 70 },
  '5P': { x: 370, y: 290 },
  // R component (right)
  '2R': { x: 560, y: 70 },
  '5R': { x: 560, y: 290 },
  '4':  { x: 620, y: 180 },
  '3':  { x: 720, y: 230 },
};

// Intermediate layout: only the S (left) part has peeled off; the P and R parts
// are still joined together on the right, sharing the original 2/5 positions.
const STEP_S = {
  '2S': { x: 120, y: 70 },
  '5S': { x: 120, y: 290 },
  '1':  { x: 55,  y: 180 },
  // remaining (P + R) keep the original full-graph positions for 2 & 5
  '2P': { x: 370, y: 70 },
  '5P': { x: 370, y: 290 },
  '4':  { x: 470, y: 180 },
  '3':  { x: 560, y: 180 },
};

export class DecompositionAnimation {
  /**
   * @param {HTMLElement} container element to render the animation into
   * @param {Object} [options]
   * @param {Function} [options.onLoadExample] called when the final step is
   *   reached, to load the example graph into the app and calculate its SPQR
   *   tree on the main canvases
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onLoadExample = options.onLoadExample || null;
    this.svg = null;
    this.step = 0;
    this.build();
  }

  // ── DOM scaffolding ──────────────────────────────────────────────────────
  build() {
    this.container.innerHTML = '';
    this.container.classList.add('decomp-anim');

    // caption / phase label
    this.caption = document.createElement('div');
    this.caption.className = 'decomp-anim-caption';
    this.container.appendChild(this.caption);

    // svg
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'decomp-anim-svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('width', '100%');
    this.container.appendChild(svg);
    this.svg = d3.select(svg);

    // layers (draw order: edges under vertices)
    this.gEdges = this.svg.append('g').attr('class', 'anim-edges');
    this.gVirtual = this.svg.append('g').attr('class', 'anim-virtual');
    this.gVertices = this.svg.append('g').attr('class', 'anim-vertices');
    this.gLabels = this.svg.append('g').attr('class', 'anim-labels');

    // step controls: Prev / progress / Next
    const controls = document.createElement('div');
    controls.className = 'decomp-anim-controls';

    this.prevBtn = document.createElement('button');
    this.prevBtn.className = 'decomp-anim-btn';
    this.prevBtn.textContent = '‹ Back';
    this.prevBtn.addEventListener('click', () => this.goToStep(this.step - 1));

    this.progress = document.createElement('span');
    this.progress.className = 'decomp-anim-progress';

    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'decomp-anim-btn';
    this.nextBtn.textContent = 'Next ›';
    this.nextBtn.addEventListener('click', () => this.goToStep(this.step + 1));

    controls.appendChild(this.prevBtn);
    controls.appendChild(this.progress);
    controls.appendChild(this.nextBtn);
    this.container.appendChild(controls);

    // Render the first step. Steps are defined in this.steps.
    this.step = 0;
    this.renderBase();
    this.goToStep(0, /* animate */ false);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  setCaption(html) {
    this.caption.innerHTML = html;
  }

  // Create / update a real edge between two layout points.
  edge(id, a, b, color = COLOR.edge) {
    let sel = this.gEdges.select(`#${id}`);
    if (sel.empty()) {
      sel = this.gEdges
        .append('line')
        .attr('id', id)
        .attr('stroke', color)
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round');
    }
    return sel
      .attr('x1', a.x).attr('y1', a.y)
      .attr('x2', b.x).attr('y2', b.y);
  }

  // Create / update a virtual (dashed) edge.
  virtualEdge(id, a, b, color = COLOR.virtual) {
    let sel = this.gVirtual.select(`#${id}`);
    if (sel.empty()) {
      sel = this.gVirtual
        .append('line')
        .attr('id', id)
        .attr('stroke', color)
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '7,6');
    }
    return sel
      .attr('x1', a.x).attr('y1', a.y)
      .attr('x2', b.x).attr('y2', b.y);
  }

  // Create / update a vertex (circle + label) at a layout point.
  vertex(id, label, pos, fill) {
    let c = this.gVertices.select(`#v-${id}`);
    if (c.empty()) {
      c = this.gVertices
        .append('circle')
        .attr('id', `v-${id}`)
        .attr('r', R)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);
    }
    c.attr('cx', pos.x).attr('cy', pos.y).attr('fill', fill);

    let t = this.gLabels.select(`#t-${id}`);
    if (t.empty()) {
      t = this.gLabels
        .append('text')
        .attr('id', `t-${id}`)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', '#fff')
        .attr('font-weight', '700')
        .attr('font-size', '15px')
        .style('pointer-events', 'none')
        .text(label);
    }
    t.attr('x', pos.x).attr('y', pos.y);
    return c;
  }

  // ── base render: create every persistent element once ─────────────────────
  // All vertices, real edges, virtual edges, component labels and gluing links
  // are created up front (extras start hidden). Each step then declaratively
  // positions / shows / hides them, so stepping works in BOTH directions.
  renderBase() {
    this.gEdges.selectAll('*').remove();
    this.gVirtual.selectAll('*').remove();
    this.gVertices.selectAll('*').remove();
    this.gLabels.selectAll('*').remove();

    // real edges of the full graph
    this.edge('e-1-5', FULL['1'], FULL['5']);
    this.edge('e-1-2', FULL['1'], FULL['2']);
    this.edge('e-2-3', FULL['2'], FULL['3']);
    this.edge('e-2-4', FULL['2'], FULL['4']);
    this.edge('e-2-5', FULL['2'], FULL['5']);
    this.edge('e-3-4', FULL['3'], FULL['4']);
    this.edge('e-3-5', FULL['3'], FULL['5']);
    this.edge('e-4-5', FULL['4'], FULL['5']);

    // virtual edges (hidden until their step) — created in draw order under
    // the vertices. v-S and v-R are straight <line>s; P's two virtual edges
    // (v-rest-S, v-P-R) are <path>s so they can bow out into a multigraph.
    this.virtualEdge('v-S', FULL['2'], FULL['5']).attr('opacity', 0);
    this.virtualEdge('v-R', FULL['2'], FULL['5']).attr('opacity', 0);
    this.virtualPath('v-rest-S').attr('opacity', 0);
    this.virtualPath('v-P-R').attr('opacity', 0);
    this.setVirtualPath('v-rest-S', FULL['2'], FULL['5'], 0, 0, 0);
    this.setVirtualPath('v-P-R', FULL['2'], FULL['5'], 0, 0, 0);

    // gluing links (curved paths) shown only in the final step. They start at
    // the bulge midpoint of P's two bowed virtual edges (control offset 70 →
    // ±35 at mid-height) and reach across to the S and R virtual edges.
    this.glueLink('g-S', SPLIT['2P'].x - 35, STEP_S['2S'].x).attr('opacity', 0);
    this.glueLink('g-R', SPLIT['2P'].x + 35, SPLIT['2R'].x).attr('opacity', 0);

    // separation-pair copies for S and R (hidden until their step — hide both
    // the circle and its label via setVertex with duration 0)
    this.vertex('2S', '2', FULL['2'], COLOR.sep);
    this.vertex('5S', '5', FULL['5'], COLOR.sep);
    this.vertex('2R', '2', FULL['2'], COLOR.sep);
    this.vertex('5R', '5', FULL['5'], COLOR.sep);
    this.setVertex('2S', FULL['2'], COLOR.sep, 0, 0);
    this.setVertex('5S', FULL['5'], COLOR.sep, 0, 0);
    this.setVertex('2R', FULL['2'], COLOR.sep, 0, 0);
    this.setVertex('5R', FULL['5'], COLOR.sep, 0, 0);

    // original vertices (1,2,3,4,5)
    this.vertex('1', '1', FULL['1'], COLOR.vertex);
    this.vertex('3', '3', FULL['3'], COLOR.vertex);
    this.vertex('4', '4', FULL['4'], COLOR.vertex);
    this.vertex('2', '2', FULL['2'], COLOR.vertex);
    this.vertex('5', '5', FULL['5'], COLOR.vertex);

    // component labels (hidden until their step)
    this.compLabel('lbl-S', 110, 'S', COLOR.S);
    this.compLabel('lbl-P', 370, 'P', COLOR.P);
    this.compLabel('lbl-R', 620, 'R', COLOR.R);
  }

  // ── low-level setters used by the declarative step renderers ──────────────
  setVertex(id, pos, fill, opacity, dur) {
    const c = this.gVertices.select(`#v-${id}`);
    const t = this.gLabels.select(`#t-${id}`);
    c.transition().duration(dur)
      .attr('cx', pos.x).attr('cy', pos.y).attr('fill', fill).attr('opacity', opacity);
    t.transition().duration(dur)
      .attr('x', pos.x).attr('y', pos.y).attr('opacity', opacity);
  }

  setEdge(id, a, b, color, width, dur) {
    this.gEdges.select(`#${id}`).transition().duration(dur)
      .attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y)
      .attr('stroke', color).attr('stroke-width', width);
  }

  setVirtual(id, a, b, opacity, dur) {
    this.gVirtual.select(`#${id}`).transition().duration(dur)
      .attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y)
      .attr('opacity', opacity);
  }

  setOpacity(sel, opacity, dur) {
    sel.transition().duration(dur).attr('opacity', opacity);
  }

  // Create a virtual edge as a <path> (so it can be curved). Same dashed purple
  // styling as the <line> virtual edges.
  virtualPath(id, color = COLOR.virtual) {
    let p = this.gVirtual.select(`#${id}`);
    if (p.empty()) {
      p = this.gVirtual.append('path')
        .attr('id', id)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', '7,6');
    }
    return p;
  }

  // Animate a path-based virtual edge between a and b. `bow` is the horizontal
  // offset of the quadratic control point: 0 = straight, ±n bulges left/right.
  // The command structure (M..Q..) is constant so d3 interpolates `d` smoothly.
  setVirtualPath(id, a, b, bow, opacity, dur) {
    const cx = (a.x + b.x) / 2 + bow;
    const cy = (a.y + b.y) / 2;
    const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    this.gVirtual.select(`#${id}`).transition().duration(dur)
      .attr('d', d)
      .attr('opacity', opacity);
  }

  // straight "gluing" link between two virtual-edge midpoints at x=fromX / toX,
  // both on the mid-height axis (y=180). Solid orange, matching the
  // inter-component virtual edges in the real SPQR visualisation.
  glueLink(id, fromX, toX) {
    const y = 180;
    let l = this.gVirtual.select(`#${id}`);
    if (l.empty()) {
      l = this.gVirtual.append('line')
        .attr('id', id)
        .attr('stroke', 'orange')
        .attr('stroke-width', 2.5)
        .attr('stroke-linecap', 'round');
    }
    return l
      .attr('x1', fromX).attr('y1', y)
      .attr('x2', toX).attr('y2', y);
  }

  compLabel(id, x, text, color) {
    const y = 335;
    let g = this.gLabels.select(`#${id}`);
    if (g.empty()) {
      g = this.gLabels.append('g').attr('id', id).attr('opacity', 0);
      g.append('rect')
        .attr('x', x - 16).attr('y', y - 16)
        .attr('width', 32).attr('height', 28).attr('rx', 6)
        .attr('fill', color);
      g.append('text')
        .attr('x', x).attr('y', y - 1)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('fill', '#fff').attr('font-weight', '700').attr('font-size', '16px')
        .text(text);
    }
    return g;
  }

  // ── the discrete, navigable steps ─────────────────────────────────────────
  // Each step is a function (dur) that animates the SVG into that step's state.
  // Because every renderer sets a full target for the elements it touches,
  // d3 interpolates from the current state — so Back and Next both animate
  // correctly and landing on any step is consistent regardless of the path.
  get steps() {
    return [
      // 0 — full graph
      (dur) => {
        this.setCaption('A <strong>biconnected</strong> graph. Look at the decomposition step by step — use <strong>Next</strong> to advance.');
        this.setVertex('2', FULL['2'], COLOR.vertex, 1, dur);
        this.setVertex('5', FULL['5'], COLOR.vertex, 1, dur);
        this.setEdge('e-2-5', FULL['2'], FULL['5'], COLOR.edge, 3, dur);
        this.showFullGraph(dur);
        this.hideSplit(dur);
      },
      // 1 — highlight separation pair {2,5}
      (dur) => {
        this.setCaption(
          `Vertices <strong style="color:${COLOR.sep}">2</strong> and ` +
          `<strong style="color:${COLOR.sep}">5</strong> form a ` +
          `<strong>separation pair</strong>: removing both splits the graph into independent pieces.`
        );
        this.showFullGraph(dur);
        this.hideSplit(dur);
        this.setVertex('2', FULL['2'], COLOR.sep, 1, dur);
        this.setVertex('5', FULL['5'], COLOR.sep, 1, dur);
        this.setEdge('e-2-5', FULL['2'], FULL['5'], COLOR.sep, 5, dur);
      },
      // 2 — peel off the LEFT part (S = path 2–1–5)
      (dur) => {
        this.setCaption(
          `First we split off the <strong style="color:${COLOR.S}">left part</strong>: ` +
          `the path <strong>2 – 1 – 5</strong>. <br> The component is a <strong style="color:${COLOR.S}">series</strong> ` +
          `component (3-cycle, triangle), with a <strong style="color:${COLOR.virtual}">virtual edge</strong> standing in for the rest of the graph.`
        );
        // separation-pair vertices stay (orange) where they are
        this.setVertex('2', FULL['2'], COLOR.sep, 1, dur);
        this.setVertex('5', FULL['5'], COLOR.sep, 1, dur);
        this.setEdge('e-2-5', FULL['2'], FULL['5'], COLOR.edge, 3, dur);
        // right side (3,4 + their edges) unchanged on the right of centre
        this.setVertex('3', FULL['3'], COLOR.vertex, 1, dur);
        this.setVertex('4', FULL['4'], COLOR.vertex, 1, dur);
        this.setEdge('e-2-3', FULL['2'], FULL['3'], COLOR.edge, 3, dur);
        this.setEdge('e-2-4', FULL['2'], FULL['4'], COLOR.edge, 3, dur);
        this.setEdge('e-3-4', FULL['3'], FULL['4'], COLOR.edge, 3, dur);
        this.setEdge('e-3-5', FULL['3'], FULL['5'], COLOR.edge, 3, dur);
        this.setEdge('e-4-5', FULL['4'], FULL['5'], COLOR.edge, 3, dur);
        // S component slides left: vertex 1, the copies 2S/5S, its real edges
        this.setVertex('1', STEP_S['1'], COLOR.S, 1, dur);
        this.setVertex('2S', STEP_S['2S'], COLOR.sep, 1, dur);
        this.setVertex('5S', STEP_S['5S'], COLOR.sep, 1, dur);
        this.setEdge('e-1-2', STEP_S['1'], STEP_S['2S'], COLOR.edge, 3, dur);
        this.setEdge('e-1-5', STEP_S['1'], STEP_S['5S'], COLOR.edge, 3, dur);
        // S's virtual edge, plus the placeholder virtual edge left on the P/R side
        this.setVirtual('v-S', STEP_S['2S'], STEP_S['5S'], 1, dur);
        this.setVirtualPath('v-rest-S', FULL['2'], FULL['5'], -44, 1, dur);
        // R extras still hidden
        this.setVirtualPath('v-P-R', FULL['2'], FULL['5'], 0, 0, dur);
        this.setVirtual('v-R', FULL['2'], FULL['5'], 0, dur);
        this.setVertex('2R', FULL['2'], COLOR.sep, 0, dur);
        this.setVertex('5R', FULL['5'], COLOR.sep, 0, dur);
        this.hideLabels(dur);
        this.hideGlue(dur);
      },
      // 3 — split the RIGHT part into P (middle) and R (right)
      (dur) => {
        this.setCaption(
          `Now the <strong style="color:${COLOR.R}">right part</strong> splits too. The triconnected core ` +
          `<strong>K₄</strong> on {2,3,4,5} is a <strong style="color:${COLOR.R}">rigid</strong> component. ` +
          `The single real edge <strong>2–5</strong> stays behind and is a <strong style="color:${COLOR.P}">parallel</strong> component.`
        );
        this.applySplit(dur);
        this.hideLabels(dur);
        this.hideGlue(dur);
      },
      // 4 — three labelled components
      (dur) => {
        this.setCaption(
          `Three components, each carrying <strong style="color:${COLOR.virtual}">virtual edges</strong> ` +
          `(dashed) as a placeholder for the rest of the graph.`
        );
        this.applySplit(dur);
        this.showLabels(dur);
        this.hideGlue(dur);
      },
      // 5 — show how the virtual edges reconnect
      (dur) => {
        this.setCaption(
          ` <strong style="color:${COLOR.virtual}">Virtual edges</strong> created during the same splitting operation are twins — ` +
          `the <strong style="color:${COLOR.P}">parallel</strong> component links the ` +
          `<strong style="color:${COLOR.S}">series</strong> and <strong style="color:${COLOR.R}">rigid</strong> ` +
          `components, each via one virtual edge pair. These virtual edge pairs define neighboring nodes in the <strong>SPQR tree</strong>.`
        );
        this.applySplit(dur);
        this.showLabels(dur);
        this.showGlue(dur);
      },
      // 6 — load the example into the app and calculate its real SPQR tree
      (dur) => {
        this.setCaption(
          `Now the example graph is loaded in the left canvas and its ` +
          `<strong>SPQR tree</strong> can be seen on the right. Hover and click the ` +
          `components there to explore the decomposition you just stepped through.`
        );
        // keep the final split layout on screen as a reference
        this.applySplit(dur);
        this.showLabels(dur);
        this.showGlue(dur);
        // the app-side load + SPQR calculation is fired from goToStep when this
        // step is newly entered (see onLoadExample), so it doesn't re-run on a
        // repeat render of the same step
      },
    ];
  }

  // ── reusable state fragments ──────────────────────────────────────────────
  // Lay the full (unsplit) graph back out at its original positions.
  showFullGraph(dur) {
    this.setVertex('1', FULL['1'], COLOR.vertex, 1, dur);
    this.setVertex('3', FULL['3'], COLOR.vertex, 1, dur);
    this.setVertex('4', FULL['4'], COLOR.vertex, 1, dur);
    this.setEdge('e-1-5', FULL['1'], FULL['5'], COLOR.edge, 3, dur);
    this.setEdge('e-1-2', FULL['1'], FULL['2'], COLOR.edge, 3, dur);
    this.setEdge('e-2-3', FULL['2'], FULL['3'], COLOR.edge, 3, dur);
    this.setEdge('e-2-4', FULL['2'], FULL['4'], COLOR.edge, 3, dur);
    this.setEdge('e-3-4', FULL['3'], FULL['4'], COLOR.edge, 3, dur);
    this.setEdge('e-3-5', FULL['3'], FULL['5'], COLOR.edge, 3, dur);
    this.setEdge('e-4-5', FULL['4'], FULL['5'], COLOR.edge, 3, dur);
  }

  // Hide all the split-only extras (copies, virtual edges, labels, glue).
  hideSplit(dur) {
    this.setVertex('2S', FULL['2'], COLOR.sep, 0, dur);
    this.setVertex('5S', FULL['5'], COLOR.sep, 0, dur);
    this.setVertex('2R', FULL['2'], COLOR.sep, 0, dur);
    this.setVertex('5R', FULL['5'], COLOR.sep, 0, dur);
    this.setVirtual('v-S', FULL['2'], FULL['5'], 0, dur);
    this.setVirtual('v-R', FULL['2'], FULL['5'], 0, dur);
    this.setVirtualPath('v-rest-S', FULL['2'], FULL['5'], 0, 0, dur);
    this.setVirtualPath('v-P-R', FULL['2'], FULL['5'], 0, 0, dur);
    this.hideLabels(dur);
    this.hideGlue(dur);
  }

  // The fully-split three-component layout (S left, P middle, R right).
  applySplit(dur) {
    // separation pair (P's vertices) centred
    this.setVertex('2', SPLIT['2P'], COLOR.sep, 1, dur);
    this.setVertex('5', SPLIT['5P'], COLOR.sep, 1, dur);
    this.setEdge('e-2-5', SPLIT['2P'], SPLIT['5P'], COLOR.edge, 3, dur);

    // S component (left)
    this.setVertex('1', SPLIT['1'], COLOR.S, 1, dur);
    this.setVertex('2S', SPLIT['2S'], COLOR.sep, 1, dur);
    this.setVertex('5S', SPLIT['5S'], COLOR.sep, 1, dur);
    this.setEdge('e-1-2', SPLIT['1'], SPLIT['2S'], COLOR.edge, 3, dur);
    this.setEdge('e-1-5', SPLIT['1'], SPLIT['5S'], COLOR.edge, 3, dur);
    this.setVirtual('v-S', SPLIT['2S'], SPLIT['5S'], 1, dur);

    // R component (right) — its interior vertices take the R colour, matching
    // how vertex 1 takes the S colour in the S component. The shared 2/5 copies
    // stay orange.
    this.setVertex('2R', SPLIT['2R'], COLOR.sep, 1, dur);
    this.setVertex('5R', SPLIT['5R'], COLOR.sep, 1, dur);
    this.setVertex('3', SPLIT['3'], COLOR.R, 1, dur);
    this.setVertex('4', SPLIT['4'], COLOR.R, 1, dur);
    this.setEdge('e-2-3', SPLIT['2R'], SPLIT['3'], COLOR.edge, 3, dur);
    this.setEdge('e-2-4', SPLIT['2R'], SPLIT['4'], COLOR.edge, 3, dur);
    this.setEdge('e-3-4', SPLIT['3'], SPLIT['4'], COLOR.edge, 3, dur);
    this.setEdge('e-3-5', SPLIT['3'], SPLIT['5R'], COLOR.edge, 3, dur);
    this.setEdge('e-4-5', SPLIT['4'], SPLIT['5R'], COLOR.edge, 3, dur);
    this.setVirtual('v-R', SPLIT['2R'], SPLIT['5R'], 1, dur);

    // P is a multigraph: its real 2–5 edge runs straight down the middle while
    // its two virtual edges bow out to the left and right between the same pair.
    this.setVirtualPath('v-rest-S', SPLIT['2P'], SPLIT['5P'], -70, 1, dur);
    this.setVirtualPath('v-P-R', SPLIT['2P'], SPLIT['5P'], 70, 1, dur);
  }

  showLabels(dur) {
    this.setOpacity(this.gLabels.select('#lbl-S'), 1, dur);
    this.setOpacity(this.gLabels.select('#lbl-P'), 1, dur);
    this.setOpacity(this.gLabels.select('#lbl-R'), 1, dur);
  }
  hideLabels(dur) {
    this.setOpacity(this.gLabels.select('#lbl-S'), 0, dur);
    this.setOpacity(this.gLabels.select('#lbl-P'), 0, dur);
    this.setOpacity(this.gLabels.select('#lbl-R'), 0, dur);
  }
  showGlue(dur) {
    this.setOpacity(this.gVirtual.select('#g-S'), 1, dur);
    this.setOpacity(this.gVirtual.select('#g-R'), 1, dur);
  }
  hideGlue(dur) {
    this.setOpacity(this.gVirtual.select('#g-S'), 0, dur);
    this.setOpacity(this.gVirtual.select('#g-R'), 0, dur);
  }

  // ── navigation ────────────────────────────────────────────────────────────
  goToStep(index, animate = true) {
    const steps = this.steps;
    const clamped = Math.max(0, Math.min(index, steps.length - 1));
    const previous = this.step;
    this.step = clamped;
    const dur = animate ? 750 : 0;
    steps[clamped](dur);

    // update controls
    this.prevBtn.disabled = clamped === 0;
    this.nextBtn.disabled = clamped === steps.length - 1;
    this.progress.textContent = `Step ${clamped + 1} of ${steps.length}`;

    // On newly entering the final step, load the example into the app and
    // calculate its SPQR tree. Guard against re-firing on a same-step render.
    const lastStep = steps.length - 1;
    if (clamped === lastStep && previous !== lastStep && this.onLoadExample) {
      this.onLoadExample();
    }
  }

  destroy() {
    if (this.svg) this.svg.interrupt().selectAll('*').interrupt();
    this.container.innerHTML = '';
  }
}

export default DecompositionAnimation;
