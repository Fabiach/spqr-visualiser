/**
 * A bespoke decomposition animation for the DiBattista example graph.
 *
 * Unlike the small introductory example, this graph contains nested separation
 * pairs. The animation first exposes the central P-component at {1,17}, then
 * unfolds the left and right branches until the complete ten-node SPQR tree is
 * visible.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLOR = {
  S: '#32b450',
  P: '#4682e6',
  R: '#e0492f',
  sep: '#f0a020',
  vertex: '#52677a',
  edge: '#71808e',
  virtual: '#9a6bd0',
  tree: '#d58b39',
};

const SOFT = {
  S: '#e9f8ed',
  P: '#edf3ff',
  R: '#fceeed',
};

const VIEW_W = 900;
const VIEW_H = 650;
const VERTEX_R = 9;

const VERTICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const EDGES = [
  [1, 2], [1, 17], [1, 10], [1, 11], [2, 3], [3, 4], [3, 6],
  [4, 5], [4, 7], [5, 6], [6, 7], [7, 8], [8, 17], [1, 9],
  [9, 17], [10, 12], [11, 12], [11, 13], [11, 14], [12, 15],
  [12, 16], [12, 17], [13, 15], [14, 15], [15, 16], [16, 17],
];

const NORMALIZED_POSITIONS = {
  1: [0.50, 0.95], 2: [0.38, 0.85], 3: [0.28, 0.75],
  4: [0.18, 0.63], 5: [0.26, 0.61], 6: [0.37, 0.49],
  7: [0.24, 0.35], 8: [0.322, 0.23], 9: [0.56, 0.61],
  10: [0.64, 0.77], 11: [0.78, 0.75], 12: [0.70, 0.59],
  13: [0.78, 0.61], 14: [0.88, 0.62], 15: [0.84, 0.51],
  16: [0.74, 0.29], 17: [0.45, 0.10],
};

const FULL = Object.fromEntries(
  Object.entries(NORMALIZED_POSITIONS).map(([id, [x, y]]) => [
    id,
    { x: 35 + x * 730, y: 25 + y * 390 },
  ])
);

const COMPONENTS = [
  { id: 'P2', type: 'P', pair: '1,17', x: 450, y: 340, stage: 2 },
  { id: 'S1', type: 'S', pair: '1,9,17', x: 95, y: 430, stage: 2 },
  { id: 'S5', type: 'S', pair: '1,2,3,7,8,17', x: 315, y: 430, stage: 2 },
  { id: 'R1', type: 'R', pair: '1,11,12,15,16,17', x: 660, y: 430, stage: 2 },
  { id: 'R2', type: 'R', pair: '3,4,6,7', x: 315, y: 515, stage: 3 },
  { id: 'S6', type: 'S', pair: '4,5,6', x: 315, y: 605, stage: 4 },
  { id: 'S4', type: 'S', pair: '1,10,12', x: 565, y: 515, stage: 5 },
  { id: 'P1', type: 'P', pair: '11,15', x: 760, y: 515, stage: 5 },
  { id: 'S2', type: 'S', pair: '11,14,15', x: 700, y: 605, stage: 5 },
  { id: 'S3', type: 'S', pair: '11,13,15', x: 845, y: 605, stage: 5 },
];

const TREE_LINKS = [
  ['P2', 'S1'], ['P2', 'S5'], ['P2', 'R1'],
  ['S5', 'R2'], ['R2', 'S6'],
  ['R1', 'S4'], ['R1', 'P1'], ['P1', 'S2'], ['P1', 'S3'],
];

export class DiBattistaDecompositionAnimation {
  constructor(container, options = {}) {
    this.container = container;
    this.onLoadExample = options.onLoadExample || null;
    this.step = 0;
    this.loadedFinalStep = false;
    this.build();
  }

  build() {
    this.container.innerHTML = '';
    this.container.classList.add('decomp-anim', 'db-decomp-anim');

    const expandRow = document.createElement('div');
    expandRow.className = 'db-decomp-expand-row';
    this.expandBtn = document.createElement('button');
    this.expandBtn.className = 'db-decomp-expand-btn';
    this.expandBtn.type = 'button';
    this.expandBtn.textContent = 'Open large';
    this.expandBtn.addEventListener('click', () => this.openExpanded());
    expandRow.appendChild(this.expandBtn);
    this.container.appendChild(expandRow);

    this.caption = document.createElement('div');
    this.caption.className = 'decomp-anim-caption';
    this.container.appendChild(this.caption);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'decomp-anim-svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('width', '100%');
    this.container.appendChild(svg);
    this.svg = d3.select(svg);

    this.gFullFrame = this.svg.append('g').attr('class', 'db-full-frame').attr('opacity', 0);
    this.gFullFrame.append('rect')
      .attr('x', 12).attr('y', 14).attr('width', 340).attr('height', 250).attr('rx', 12)
      .attr('fill', '#fff').attr('stroke', '#d9e1e8').attr('stroke-width', 2);
    this.gFullFrame.append('text')
      .attr('x', 28).attr('y', 39).attr('fill', '#52677a')
      .attr('font-size', 14).attr('font-weight', 700).text('Input graph');

    this.gFull = this.svg.append('g').attr('class', 'db-full-graph');
    this.gFocus = this.svg.append('g').attr('class', 'db-split-scenes');
    this.gTreeLinks = this.svg.append('g').attr('class', 'db-tree-links');
    this.gTreeNodes = this.svg.append('g').attr('class', 'db-tree-nodes');

    this.renderFullGraph();
    this.renderSplitScenes();
    this.renderTree();

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
    controls.append(this.prevBtn, this.progress, this.nextBtn);
    this.container.appendChild(controls);

    this.goToStep(0, false);
  }

  renderFullGraph() {
    this.gFull.selectAll('line.db-edge')
      .data(EDGES)
      .enter()
      .append('line')
      .attr('class', 'db-edge')
      .attr('x1', ([u]) => FULL[u].x)
      .attr('y1', ([u]) => FULL[u].y)
      .attr('x2', ([, v]) => FULL[v].x)
      .attr('y2', ([, v]) => FULL[v].y)
      .attr('stroke', COLOR.edge)
      .attr('stroke-width', 2.2)
      .attr('stroke-linecap', 'round');

    const vertices = this.gFull.selectAll('g.db-vertex')
      .data(VERTICES)
      .enter()
      .append('g')
      .attr('class', 'db-vertex')
      .attr('data-vertex-id', id => id)
      .attr('transform', id => `translate(${FULL[id].x},${FULL[id].y})`);

    vertices.append('circle')
      .attr('class', 'db-vertex-halo')
      .attr('r', VERTEX_R + 6)
      .attr('fill', 'none')
      .attr('stroke', COLOR.sep)
      .attr('stroke-width', 3)
      .attr('opacity', 0);
    vertices.append('circle')
      .attr('class', 'db-vertex-dot')
      .attr('r', VERTEX_R)
      .attr('fill', COLOR.vertex)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);
    vertices.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#fff')
      .attr('font-size', '8px')
      .attr('font-weight', 700)
      .text(id => id);
  }

  renderSplitScenes() {
    const scene = stage => this.gFocus.append('g')
      .attr('class', 'db-split-scene')
      .attr('data-scene', stage)
      .attr('opacity', 0);

    const addSceneFrame = (group, title) => {
      group.append('rect')
        .attr('x', 368).attr('y', 14).attr('width', 520).attr('height', 250).attr('rx', 12)
        .attr('fill', '#fff').attr('stroke', '#d9e1e8').attr('stroke-width', 2);
      group.append('text')
        .attr('x', 384).attr('y', 39).attr('fill', '#52677a')
        .attr('font-size', 14).attr('font-weight', 700).text(title);
    };

    const firstSplit = scene(2);
    addSceneFrame(firstSplit, 'Split at {1,17}: three smaller graph pieces');
    this.drawFragment(firstSplit, {
      title: 'left piece', vertices: [1, 2, 3, 4, 5, 6, 7, 8, 17], virtualEdges: [[1, 17]],
      poles: [1, 17], x: 384, y: 51, width: 176, height: 190, color: COLOR.S,
    });
    this.drawFragment(firstSplit, {
      title: 'S1', vertices: [1, 9, 17], virtualEdges: [[1, 17]],
      poles: [1, 17], x: 570, y: 51, width: 120, height: 190, color: COLOR.S,
    });
    this.drawFragment(firstSplit, {
      title: 'right piece', vertices: [1, 10, 11, 12, 13, 14, 15, 16, 17], virtualEdges: [[1, 17]],
      poles: [1, 17], x: 700, y: 51, width: 172, height: 190, color: COLOR.R,
    });

    const leftFirstSplit = scene(3);
    addSceneFrame(leftFirstSplit, 'Split at {3,7}: S5 and the remaining piece');
    this.drawFragment(leftFirstSplit, {
      title: 'S5 · 6-cycle', vertices: [1, 2, 3, 7, 8, 17], virtualEdges: [[1, 17], [3, 7]],
      poles: [3, 7], x: 404, y: 51, width: 218, height: 190, color: COLOR.S,
    });
    this.drawFragment(leftFirstSplit, {
      title: 'remaining piece', vertices: [3, 4, 5, 6, 7], virtualEdges: [[3, 7]],
      poles: [3, 7], x: 642, y: 51, width: 210, height: 190, color: COLOR.R,
    });

    const leftSplit = scene(4);
    addSceneFrame(leftSplit, 'Split at {4,6}: the terminal cycle separates');
    this.drawFragment(leftSplit, {
      title: 'S5 · 6-cycle', vertices: [1, 2, 3, 7, 8, 17], virtualEdges: [[1, 17], [3, 7]],
      x: 384, y: 51, width: 150, height: 190, color: COLOR.S,
    });
    this.drawFragment(leftSplit, {
      title: 'R2 · K₄', vertices: [3, 4, 6, 7], virtualEdges: [[3, 7], [4, 6]],
      poles: [4, 6], x: 545, y: 51, width: 150, height: 190, color: COLOR.R,
    });
    this.drawFragment(leftSplit, {
      title: 'S6 · 3-cycle', vertices: [4, 5, 6], virtualEdges: [[4, 6]],
      poles: [4, 6], x: 706, y: 51, width: 166, height: 190, color: COLOR.S,
    });

    const rightSplit = scene(5);
    addSceneFrame(rightSplit, 'The right piece yields five SPQR nodes');
    this.drawFragment(rightSplit, {
      title: 'R1', vertices: [1, 11, 12, 15, 16, 17], virtualEdges: [[1, 17], [1, 12], [11, 15]],
      poles: [1, 12, 11, 15], x: 384, y: 51, width: 178, height: 190, color: COLOR.R,
    });
    this.drawFragment(rightSplit, {
      title: 'S4', vertices: [1, 10, 12], virtualEdges: [[1, 12]],
      poles: [1, 12], x: 573, y: 51, width: 92, height: 84, color: COLOR.S,
    });
    this.drawParallelFragment(rightSplit, {
      title: 'P1', x: 676, y: 51, width: 92, height: 84,
    });
    this.drawFragment(rightSplit, {
      title: 'S2', vertices: [11, 14, 15], virtualEdges: [[11, 15]],
      poles: [11, 15], x: 573, y: 146, width: 92, height: 95, color: COLOR.S,
    });
    this.drawFragment(rightSplit, {
      title: 'S3', vertices: [11, 13, 15], virtualEdges: [[11, 15]],
      poles: [11, 15], x: 676, y: 146, width: 92, height: 95, color: COLOR.S,
    });
  }

  drawFragment(parent, config) {
    const { title, vertices, virtualEdges = [], poles = [], x, y, width, height, color } = config;
    const group = parent.append('g').attr('class', 'db-fragment');
    group.append('rect')
      .attr('x', x).attr('y', y).attr('width', width).attr('height', height).attr('rx', 8)
      .attr('fill', `${color}0d`).attr('stroke', color).attr('stroke-width', 1.5);
    group.append('text')
      .attr('x', x + 9).attr('y', y + 18).attr('fill', color)
      .attr('font-size', 11).attr('font-weight', 800).text(title);

    const vertexSet = new Set(vertices);
    const poleSet = new Set(poles.map(Number));
    const virtualKeys = new Set(virtualEdges.map(([u, v]) => [Math.min(u, v), Math.max(u, v)].join('-')));
    const points = vertices.map(id => ({ id, x: NORMALIZED_POSITIONS[id][0], y: NORMALIZED_POSITIONS[id][1] }));
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const inner = { x: x + 12, y: y + 29, width: width - 24, height: height - 40 };
    const scaleX = inner.width / Math.max(0.08, maxX - minX);
    const scaleY = inner.height / Math.max(0.08, maxY - minY);
    const scale = Math.min(scaleX, scaleY);
    const usedW = (maxX - minX) * scale;
    const usedH = (maxY - minY) * scale;
    const project = id => ({
      x: inner.x + (inner.width - usedW) / 2 + (NORMALIZED_POSITIONS[id][0] - minX) * scale,
      y: inner.y + (inner.height - usedH) / 2 + (NORMALIZED_POSITIONS[id][1] - minY) * scale,
    });

    EDGES.filter(([u, v]) => {
      const key = [Math.min(u, v), Math.max(u, v)].join('-');
      return vertexSet.has(u) && vertexSet.has(v) && !virtualKeys.has(key);
    }).forEach(([u, v]) => {
      const a = project(u);
      const b = project(v);
      group.append('line')
        .attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y)
        .attr('stroke', '#71808e').attr('stroke-width', 1.6).attr('stroke-linecap', 'round');
    });
    virtualEdges.forEach(([u, v]) => {
      const a = project(u);
      const b = project(v);
      group.append('line')
        .attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y)
        .attr('stroke', COLOR.virtual).attr('stroke-width', 1.8).attr('stroke-dasharray', '5,4');
    });
    points.forEach(({ id }) => {
      const point = project(id);
      group.append('circle')
        .attr('cx', point.x).attr('cy', point.y).attr('r', 5)
        .attr('fill', poleSet.has(Number(id)) ? COLOR.sep : color)
        .attr('stroke', '#fff').attr('stroke-width', 1);
      group.append('text')
        .attr('x', point.x).attr('y', point.y + 0.5)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('fill', '#fff').attr('font-size', 5.5).attr('font-weight', 700).text(id);
    });
  }

  drawParallelFragment(parent, { title, x, y, width, height }) {
    const group = parent.append('g').attr('class', 'db-fragment');
    group.append('rect')
      .attr('x', x).attr('y', y).attr('width', width).attr('height', height).attr('rx', 8)
      .attr('fill', `${COLOR.P}0d`).attr('stroke', COLOR.P).attr('stroke-width', 1.5);
    group.append('text')
      .attr('x', x + 9).attr('y', y + 18).attr('fill', COLOR.P)
      .attr('font-size', 11).attr('font-weight', 800).text(title);
    const top = { x: x + width / 2, y: y + 30 };
    const bottom = { x: x + width / 2, y: y + height - 12 };
    [-17, 0, 17].forEach(offset => {
      group.append('path')
        .attr('d', `M ${top.x} ${top.y} Q ${top.x + offset} ${(top.y + bottom.y) / 2} ${bottom.x} ${bottom.y}`)
        .attr('fill', 'none').attr('stroke', COLOR.virtual).attr('stroke-width', 1.6)
        .attr('stroke-dasharray', '4,3');
    });
    [top, bottom].forEach(point => group.append('circle')
      .attr('cx', point.x).attr('cy', point.y).attr('r', 4).attr('fill', COLOR.sep));
  }

  renderTree() {
    const componentById = new Map(COMPONENTS.map(component => [component.id, component]));
    this.gTreeLinks.selectAll('line.db-tree-link')
      .data(TREE_LINKS.map(([source, target]) => ({
        source: componentById.get(source),
        target: componentById.get(target),
      })))
      .enter()
      .append('line')
      .attr('class', 'db-tree-link')
      .attr('data-stage', d => d.target.stage)
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
      .attr('stroke', COLOR.tree)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0);

    const nodes = this.gTreeNodes.selectAll('g.db-component')
      .data(COMPONENTS)
      .enter()
      .append('g')
      .attr('class', 'db-component')
      .attr('data-component-id', d => d.id)
      .attr('data-stage', d => d.stage)
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .attr('opacity', 0);

    nodes.append('rect')
      .attr('x', -53)
      .attr('y', -30)
      .attr('width', 106)
      .attr('height', 60)
      .attr('rx', 9)
      .attr('fill', d => SOFT[d.type])
      .attr('stroke', d => COLOR[d.type])
      .attr('stroke-width', 2.5);

    nodes.append('text')
      .attr('x', -41)
      .attr('y', -17)
      .attr('fill', d => COLOR[d.type])
      .attr('font-size', '14px')
      .attr('font-weight', 800)
      .text(d => d.id);
    nodes.append('text')
      .attr('x', 0)
      .attr('y', 24)
      .attr('text-anchor', 'middle')
      .attr('fill', '#415466')
      .attr('font-size', d => d.pair.length > 12 ? '7px' : '8.5px')
      .text(d => `{${d.pair}}`);

    nodes.each((d, index, groups) => {
      this.drawComponentIcon(d3.select(groups[index]), d);
    });
  }

  drawComponentIcon(group, component) {
    const { id, type } = component;
    const icon = group.append('g').attr('transform', 'translate(0,-4)');
    if (type === 'P') {
      icon.append('circle').attr('cy', -13).attr('r', 4).attr('fill', COLOR.P);
      icon.append('circle').attr('cy', 13).attr('r', 4).attr('fill', COLOR.P);
      const strands = id === 'P2'
        ? [{ offset: -22, virtual: true }, { offset: -7, virtual: false }, { offset: 9, virtual: true }, { offset: 23, virtual: true }]
        : [{ offset: -16, virtual: true }, { offset: 0, virtual: true }, { offset: 16, virtual: true }];
      strands.forEach(({ offset, virtual }) => {
        icon.append('path')
          .attr('d', `M 0 -13 Q ${offset} 0 0 13`)
          .attr('fill', 'none')
          .attr('stroke', virtual ? COLOR.virtual : '#788896')
          .attr('stroke-width', 1.7)
          .attr('stroke-dasharray', virtual ? '3,2' : null);
      });
      return;
    }

    const points = id === 'S5'
      ? [[0, -15], [13, -8], [13, 8], [0, 15], [-13, 8], [-13, -8]]
      : id === 'R2'
        ? [[-13, -12], [13, -12], [13, 12], [-13, 12]]
        : type === 'S'
          ? [[0, -14], [15, 10], [-15, 10]]
          : [[-16, -11], [0, -15], [16, -8], [15, 9], [0, 15], [-16, 10]];

    const edgePairs = id === 'R2'
      ? [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]]
      : id === 'R1'
        ? [[0, 1], [1, 2], [1, 3], [2, 3], [2, 4], [2, 5], [3, 4], [4, 5], [5, 0]]
        : points.map((_, index) => [index, (index + 1) % points.length]);
    edgePairs.forEach(([a, b]) => {
      icon.append('line')
        .attr('x1', points[a][0]).attr('y1', points[a][1])
        .attr('x2', points[b][0]).attr('y2', points[b][1])
        .attr('stroke', type === 'R' ? '#9b6870' : '#71808e')
        .attr('stroke-width', type === 'R' ? 1.15 : 1.6);
    });
    points.forEach(([x, y]) => {
      icon.append('circle').attr('cx', x).attr('cy', y).attr('r', 3.2).attr('fill', COLOR[type]);
    });
  }

  setCaption(html) {
    this.caption.innerHTML = html;
  }

  setFullGraph(opacity, duration) {
    this.gFull.transition().duration(duration).attr('opacity', opacity);
  }

  setGraphMode(compact, duration) {
    this.gFull.transition().duration(duration)
      .attr('transform', compact ? 'translate(6,28) scale(0.43)' : 'translate(70,50) scale(1.05)');
    this.gFullFrame.transition().duration(duration).attr('opacity', compact ? 1 : 0);
  }

  setFocusScene(stage, duration) {
    this.gFocus.selectAll('g.db-split-scene').transition().duration(duration)
      .attr('opacity', function() {
        return Number(this.getAttribute('data-scene')) === stage ? 1 : 0;
      });
  }

  highlightSubgraph(vertices, duration) {
    const active = vertices ? new Set(vertices.map(Number)) : null;
    this.gFull.selectAll('line.db-edge').transition().duration(duration)
      .attr('opacity', ([u, v]) => !active || (active.has(u) && active.has(v)) ? 1 : 0.14)
      .attr('stroke-width', ([u, v]) => active && active.has(u) && active.has(v) ? 3.4 : 2.2);
    this.gFull.selectAll('g.db-vertex').transition().duration(duration)
      .attr('opacity', id => !active || active.has(Number(id)) ? 1 : 0.22);
  }

  highlightPairs(pairs, duration) {
    const highlighted = new Set(pairs.flat().map(Number));
    this.gFull.selectAll('g.db-vertex').each(function(id) {
      const active = highlighted.has(Number(id));
      const group = d3.select(this);
      group.select('.db-vertex-dot').transition().duration(duration)
        .attr('fill', active ? COLOR.sep : COLOR.vertex);
      group.select('.db-vertex-halo').transition().duration(duration)
        .attr('opacity', active ? 0.85 : 0);
    });
  }

  setTreeStage(stage, duration, emphasizeLinks = false) {
    this.gTreeNodes.selectAll('g.db-component').transition().duration(duration)
      .attr('opacity', d => d.stage <= stage ? 1 : 0)
      .attr('transform', d => {
        const offset = d.stage <= stage ? 0 : -12;
        return `translate(${d.x},${d.y + offset})`;
      });
    this.gTreeLinks.selectAll('line.db-tree-link').transition().duration(duration)
      .attr('opacity', d => d.target.stage <= stage ? 1 : 0)
      .attr('stroke-dasharray', emphasizeLinks ? '7,5' : null)
      .attr('stroke', emphasizeLinks ? COLOR.virtual : COLOR.tree);
  }

  get steps() {
    return [
      duration => {
        this.setCaption(
          'The <strong>DiBattista graph</strong> is still biconnected, but it contains several nested separation pairs.'
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(false, duration);
        this.setFocusScene(0, duration);
        this.highlightSubgraph(null, duration);
        this.highlightPairs([], duration);
        this.setTreeStage(0, duration);
      },
      duration => {
        this.setCaption(
          `The first splitting pair is <strong style="color:${COLOR.sep}">{1,17}</strong>. ` +
          'It separates a long series part, a small cycle (17-1-9), and the right rigid part; the real edge 1–17 is a fourth parallel component.'
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(false, duration);
        this.setFocusScene(0, duration);
        this.highlightSubgraph(null, duration);
        this.highlightPairs([[1, 17]], duration);
        this.setTreeStage(0, duration);
      },
      duration => {
        this.setCaption(
          `That split creates the central <strong style="color:${COLOR.P}">P2</strong>. ` +
          `From left to right, its neighboring pieces are the series piece <strong style="color:${COLOR.S}">S5</strong>, ` +
          `the cycle <strong style="color:${COLOR.S}">S1</strong>, and the rigid piece <strong style="color:${COLOR.R}">R1</strong>.`
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(2, duration);
        this.highlightSubgraph(null, duration);
        this.highlightPairs([[1, 17]], duration);
        this.setTreeStage(2, duration);
      },
      duration => {
        this.setCaption(
          `The left series branch splits again at <strong style="color:${COLOR.sep}">{3,7}</strong>, ` +
          `separating the six-cycle <strong style="color:${COLOR.S}">S5</strong> from the smaller rigid piece that remains.`
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(3, duration);
        this.highlightSubgraph([1, 2, 3, 4, 5, 6, 7, 8, 17], duration);
        this.highlightPairs([[3, 7]], duration);
        this.setTreeStage(3, duration);
      },
      duration => {
        this.setCaption(
          `The remaining piece now splits at <strong style="color:${COLOR.sep}">{4,6}</strong>. ` +
          `This leaves the rigid skeleton <strong style="color:${COLOR.R}">R2 = K₄</strong> and exposes ` +
          `the terminal cycle <strong style="color:${COLOR.S}">S6</strong>.`
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(4, duration);
        this.highlightSubgraph([3, 4, 5, 6, 7], duration);
        this.highlightPairs([[4, 6]], duration);
        this.setTreeStage(4, duration);
      },
      duration => {
        this.setCaption(
          `On the right, <strong style="color:${COLOR.R}">R1</strong> separates ` +
          `<strong style="color:${COLOR.S}">S4</strong> at <strong style="color:${COLOR.sep}">{1,12}</strong> and the parallel component ` +
          `<strong style="color:${COLOR.P}">P1</strong> at <strong style="color:${COLOR.sep}">{11,15}</strong>; ` +
          `P1 in turn carries the two cycles <strong style="color:${COLOR.S}">S2</strong> and <strong style="color:${COLOR.S}">S3</strong>.`
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(5, duration);
        this.highlightSubgraph([1, 10, 11, 12, 13, 14, 15, 16, 17], duration);
        this.highlightPairs([[1, 12], [11, 15]], duration);
        this.setTreeStage(5, duration);
      },
      duration => {
        this.setCaption(
          `The complete decomposition has <strong>ten nodes</strong>. Every dashed connection represents a pair of twin virtual edges, ` +
          'and the nesting of the splits is exactly the branching structure of the SPQR tree.'
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(5, duration);
        this.highlightSubgraph(null, duration);
        this.highlightPairs([], duration);
        this.setTreeStage(5, duration, true);
      },
      duration => {
        this.setCaption(
          'Now the DiBattista graph and its computed SPQR tree are shown on the main canvases. Hover the components to trace each branch back into the graph.'
        );
        this.setFullGraph(1, duration);
        this.setGraphMode(true, duration);
        this.setFocusScene(5, duration);
        this.highlightSubgraph(null, duration);
        this.highlightPairs([], duration);
        this.setTreeStage(5, duration, true);
      },
    ];
  }

  goToStep(index, animate = true) {
    const steps = this.steps;
    const clamped = Math.max(0, Math.min(index, steps.length - 1));
    const previous = this.step;
    this.step = clamped;
    steps[clamped](animate ? 700 : 0);
    this.prevBtn.disabled = clamped === 0;
    this.nextBtn.disabled = clamped === steps.length - 1;
    this.progress.textContent = `Step ${clamped + 1} of ${steps.length}`;

    const finalStep = steps.length - 1;
    if (clamped === finalStep && previous !== finalStep && this.onLoadExample) {
      this.onLoadExample();
    }
  }

  openExpanded() {
    if (this.modal) return;

    this.placeholder = document.createComment('DiBattista animation');
    this.container.parentNode.insertBefore(this.placeholder, this.container);

    this.modal = document.createElement('div');
    this.modal.className = 'db-decomp-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-label', 'DiBattista SPQR decomposition animation');

    const dialog = document.createElement('div');
    dialog.className = 'db-decomp-modal-dialog';
    const header = document.createElement('div');
    header.className = 'db-decomp-modal-header';
    const title = document.createElement('strong');
    title.textContent = 'DiBattista SPQR decomposition';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'db-decomp-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close large animation');
    closeBtn.textContent = 'Close ×';
    closeBtn.addEventListener('click', () => this.closeExpanded());
    header.append(title, closeBtn);
    dialog.append(header, this.container);
    this.modal.appendChild(dialog);
    this.modal.addEventListener('click', event => {
      if (event.target === this.modal) this.closeExpanded();
    });

    this.escapeHandler = event => {
      if (event.key === 'Escape') this.closeExpanded();
    };
    document.addEventListener('keydown', this.escapeHandler);
    document.body.appendChild(this.modal);
    document.body.classList.add('db-decomp-modal-open');
    this.container.classList.add('db-decomp-anim-expanded');
    this.expandBtn.disabled = true;
    closeBtn.focus();
  }

  closeExpanded() {
    if (!this.modal) return;

    this.container.classList.remove('db-decomp-anim-expanded');
    this.expandBtn.disabled = false;
    if (this.placeholder && this.placeholder.parentNode) {
      this.placeholder.parentNode.insertBefore(this.container, this.placeholder);
      this.placeholder.remove();
    }
    document.removeEventListener('keydown', this.escapeHandler);
    this.modal.remove();
    this.modal = null;
    this.placeholder = null;
    this.escapeHandler = null;
    document.body.classList.remove('db-decomp-modal-open');
    this.expandBtn.focus();
  }

  destroy() {
    this.closeExpanded();
    if (this.svg) this.svg.interrupt().selectAll('*').interrupt();
    this.container.innerHTML = '';
  }
}

export default DiBattistaDecompositionAnimation;
