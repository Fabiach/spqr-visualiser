import {verticesDB, edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia, verticesKindermann, edgesKindermann, factorials, verticesTutorialP, edgesTutorialP, edgesTutorialR, edgesTutorialS, verticesTutorialR, verticesTutorialS, fixedPositionsWikipedia, fixedPositionsDiBattista, fixedPositionsTutorialS, fixedPositionsTutorialR, fixedPositionsTutorialP} from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree} from './spqr.js';
import {clearGraph, createGraph, createPresetGraph} from './graph.js';
import Tutorial from './tutorial.js';
import {isPlanarAndEmbed, validateEmbedding} from './planarity.js';
import {tutteEmbedding, extractFaces, findLargestFace, scaleToBox} from './tutte.js';
import {computeGraphDrawing, flipRNode, getPEmbeddingOrder, P_AXIS_SLOT, setPEmbeddingOrder} from './spqrDrawing.js';
import {spqrTreeToOGDFJSON} from './exportSPQR.js';
import {parseGraphText, GraphImportError} from './graphImport.js';
import {
  orientNodeMapByAnchor,
  orientRootNodeMap
} from './pictogramOrientation.js';

/*
 * Base-path awareness for deployment under a subpath (e.g. GitHub Pages at
 * https://<user>.github.io/spqr-visualiser/). This module is always served at
 * "<base>js/main.js", so we can recover <base> from its own URL. BASE_PATH
 * always has a leading and trailing slash, e.g. "/spqr-visualiser/" or "/".
 */
const BASE_PATH = new URL('../', import.meta.url).pathname;

// The current location, expressed relative to BASE_PATH and without leading/
// trailing slashes, e.g. "tutorial/5" or "" for the app root.
function getAppRoute() {
  let p = window.location.pathname;
  if (p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length);
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

// Build an absolute, base-aware URL for an in-app route (no leading slash),
// e.g. buildAppUrl('tutorial/5') -> "/spqr-visualiser/tutorial/5".
function buildAppUrl(route = '') {
  return BASE_PATH + route.replace(/^\/+/, '');
}

// State management - consolidated
const state = {
  simulation: {
    input: null, //the d3 simulation of the input graph
    spqr: null //the d3 simulation of the SPQR graph
  },
  d3selections: {
    nodeInput: null, //the nodes of the input graph simulation
    linkInput: null, //the links of the input graph simulation
    labelInput: null, //the labels of the input graph simulation
    nodeSPQR: null, //the nodes of the SPQR graph simulation
    linkSPQR: null, //the links of the SPQR graph simulation
    labelSPQR: null //the labels of the SPQR graph simulation
  },
  data: {
    spqrTree: null, //the SPQR tree of the input graph, saved as an array of components
    spqrRoot: null, //the root component of the SPQR tree, the component that minimizes max depth of rooted SPQR tree
    spqrManualRoot: null, //user-chosen root override; null = use automatic root selection
    graphEdges: null, //edges of the input graph
    graphNodes: null, //nodes of the input graph
    graphLinks: null, //links of the input graph
    edgeRoutes: new Map(),
    componentPoses: new Map(),
    composedDrawing: null,
    virtualEdgeData: new Map(),
    allVirtualTwinEdgeLinks: [],
    inputNodePositions: new Map(),
    componentVirtualEdgesMap: new Map(),
    originalGraphEdges: null,
    inputNew: true,
    isPreset: false,
    presetType: null,
    componentCentroids: new Map(),
    anySPQRComponentCollapsed: false,
    previousSpqrTree: null,
    componentMapping: new Map(), // Maps old component IDs to new ones
    unchangedComponents: new Set(),
    changedComponents: new Set(),
    newComponents: new Set(),
    removedComponents: new Set(),
    inputGraphIsNotBiconnected: false,
    componentDefaultPositions: new Map(),  // Store default position of each component
    draggedComponents: new Set(),  // Track which components have been significantly dragged
    articulationPoints: new Set()  // Track articulation points to keep them red
  },
  ui: {
    colors: ["red", "blue", "yellow", "orange", "purple", "green"],
    redShades: [
      "#ff6b6b", // soft coral red
      "#ff3b3b", // bright red
      "#e03131", // deep crimson
      "#b71c1c", // dark brick red
      "#7f1d1d"  // very dark red
    ],
    greenShades: [
      "#8ef08e", // light mint green
      "#34d399", // teal-green
      "#22c55e", // classic green
      "#15803d", // forest green
      "#064e3b"  // very dark green
    ],
    colorC: 0,  // Added color counter
    spqrReady: true,
    dragUpdateTimer: null,  // For throttling drag updates
    canvasWidth: 1000,
    canvasHeight: 1000,
    pendingHighlightCompId: null,  // For reapplying highlighting after mode switch
    preferSRoot: false,            // When true, findOptimalRoot picks the S-component
    animateEmbeddingSwitch: true   // Animate node movement when switching embeddings
  },
  ui_state: {
    drawMode: false,
    edgeStart: null,
    deleteMode: false,
    currentTool: null, // Track current tool
    spqrDrawingMode: 'fancy', // Track SPQR drawing mode: 'fancy' or 'simple'
    inputLabelsVisible: true,
    spqrLabelStyle: 'type', // 'full' = P1/S1/R1, 'type' = P/S/R
    spqrCompLabelsVisible: true,
    spqrFreePositioning: true
  }
};

// DOM elements - cached
const elements = {
  svgInput: d3.select("#input-graph"),
  svgSPQR: d3.select("#spqr-graph"),
  inputCanvasWrapper: document.getElementById('input-graph')?.parentElement ?? null,
  form: document.getElementById('input-form'),
  spqrBtn: document.getElementById('spqr-btn'),
  nextCompBtn: document.getElementById('next-comp'),
  drawModeBtn: document.getElementById('draw-mode'),
  deleteModeBtn: document.getElementById('delete-mode'),
  resetInputBtn: document.getElementById('reset-input'),
  tutorialBtn: document.getElementById('tutorial-btn'),
  tutorialBtn: document.getElementById('tutorial-btn'),
  switchEmbeddingBtn: document.getElementById('switch-embedding-btn'),
  rerootBtn: document.getElementById('reroot-btn'),
  switchViewBtn: document.getElementById('switch-view-mode'),
  drawFromSPQRBtn: document.getElementById('draw-from-spqr-btn'),
  exportSpqrBtn: document.getElementById('export-spqr-btn'),
  pEmbeddingDialog: document.getElementById('p-embedding-dialog'),
  pEmbeddingDialogTitle: document.getElementById('p-embedding-dialog-title'),
  pEmbeddingDialogDescription: document.getElementById('p-embedding-dialog-description'),
  pEmbeddingDialogList: document.getElementById('p-embedding-dialog-list'),
  pEmbeddingApplyBtn: document.getElementById('p-embedding-apply'),
  pEmbeddingCancelBtn: document.getElementById('p-embedding-cancel'),
  exampleBtns: {
    tutorialP: document.getElementById('example-graph-tutorialP'),
    brown: document.getElementById('example-graph-brown'),
    db: document.getElementById('example-graph-db'),
    wikipedia: document.getElementById('example-graph-wikipedia'),
    kindermann: document.getElementById('example-graph-kindermann'),
    tutorialS: document.getElementById('example-graph-tutorialS'),
    tutorialR: document.getElementById('example-graph-tutorialR'),
  }
};

// Initialize tutorial
let tutorial = null;

let expandIconSVG = null;
d3.xml("assets/maximize.svg").then(data => {
  expandIconSVG = data.documentElement;
});

const spqrComponentPictureEdgeColor = "#999"; // Color for edges in SPQR component pictures (gray)
const spqrComponentPictureNormalStrokeWidth = 1.5;
const spqrComponentPictureVirtualStrokeWidth = 2;
const spqrComponentPictogramSize = 120;
const spqrComponentContentWidth = 88;
const spqrComponentContentHeight = 88;
const spqrComponentContentCenterY = 0;
const spqrParallelPoleHalfSpan = 42;
const spqrParallelCurveControlMax = 52;
const virtualEdgeColorPalette = ["#e6194b","#3cb44b","#f58231","#4363d8","#911eb4","#f032e6","#42d4f4","#9a6324","#000075","#808000"];

// Track zoom behaviors so we can apply transforms programmatically without fighting user interactions
const zoomBehaviors = { spqr: null, input: null };

const pEmbeddingDialogState = {
  componentId: null,
  order: [],
  selectedIndex: 0,
  hoveredChildId: null,
};

function getUndirectedEdgeKey(source, target) {
  const sourceId = Number(typeof source === 'object' ? source.id : source);
  const targetId = Number(typeof target === 'object' ? target.id : target);
  return sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
}

function getInputEdgeRoute(edge, routeLookup = state.data.edgeRoutes) {
  return routeLookup?.get(getUndirectedEdgeKey(edge.source, edge.target)) || null;
}

function getInputNodeRadius(_node = null, zoomK = null) {
  const ek = zoomK ?? d3.zoomTransform(elements.svgInput.node()).k;
  return 10 / Math.sqrt(ek);
}

function getStraightEdgeEndpoints(
  source,
  target,
  sourceRadius = getInputNodeRadius(source),
  targetRadius = getInputNodeRadius(target)
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
  return {
    x1: source.x + dx * sourceRadius / dist,
    y1: source.y + dy * sourceRadius / dist,
    x2: target.x - dx * targetRadius / dist,
    y2: target.y - dy * targetRadius / dist,
  };
}

function buildQuadraticEdgePath(source, target, control) {
  const sourceRadius = getInputNodeRadius(source);
  const targetRadius = getInputNodeRadius(target);
  const startDx = control.x - source.x;
  const startDy = control.y - source.y;
  const startLen = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
  const endDx = control.x - target.x;
  const endDy = control.y - target.y;
  const endLen = Math.sqrt(endDx * endDx + endDy * endDy) || 1;

  const start = {
    x: source.x + (startDx / startLen) * sourceRadius,
    y: source.y + (startDy / startLen) * sourceRadius,
  };
  const end = {
    x: target.x + (endDx / endLen) * targetRadius,
    y: target.y + (endDy / endLen) * targetRadius,
  };

  return `M ${start.x},${start.y} Q ${control.x},${control.y} ${end.x},${end.y}`;
}

function buildCubicEdgePath(source, target, cp1, cp2) {
  const sourceRadius = getInputNodeRadius(source);
  const targetRadius = getInputNodeRadius(target);
  const startDx = cp1.x - source.x;
  const startDy = cp1.y - source.y;
  const startLen = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
  const endDx = cp2.x - target.x;
  const endDy = cp2.y - target.y;
  const endLen = Math.sqrt(endDx * endDx + endDy * endDy) || 1;

  const start = {
    x: source.x + (startDx / startLen) * sourceRadius,
    y: source.y + (startDy / startLen) * sourceRadius,
  };
  const end = {
    x: target.x + (endDx / endLen) * targetRadius,
    y: target.y + (endDy / endLen) * targetRadius,
  };

  return `M ${start.x},${start.y} C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`;
}

function buildPolylineEdgePath(source, target, points) {
  const routePoints = Array.isArray(points) ? points.filter(Boolean) : [];
  if (routePoints.length === 0) {
    const straight = getStraightEdgeEndpoints(source, target);
    return `M ${straight.x1},${straight.y1} L ${straight.x2},${straight.y2}`;
  }
  const sourceRadius = getInputNodeRadius(source);
  const targetRadius = getInputNodeRadius(target);

  const first = routePoints[0];
  const last = routePoints[routePoints.length - 1];
  const startDx = first.x - source.x;
  const startDy = first.y - source.y;
  const startLen = Math.sqrt(startDx * startDx + startDy * startDy) || 1;
  const endDx = last.x - target.x;
  const endDy = last.y - target.y;
  const endLen = Math.sqrt(endDx * endDx + endDy * endDy) || 1;
  const start = {
    x: source.x + (startDx / startLen) * sourceRadius,
    y: source.y + (startDy / startLen) * sourceRadius,
  };
  const end = {
    x: target.x + (endDx / endLen) * targetRadius,
    y: target.y + (endDy / endLen) * targetRadius,
  };
  return `M ${start.x},${start.y} ${routePoints.map(p => `L ${p.x},${p.y}`).join(' ')} L ${end.x},${end.y}`;
}

function getOrientedPolylinePoints(edge, route) {
  const points = Array.isArray(route?.points) ? route.points : [];
  if (route?.from === undefined || route?.from === null) return points;
  const sourceId = Number(typeof edge.source === 'object' ? edge.source.id : edge.source);
  return sourceId === Number(route.from) ? points : [...points].reverse();
}

function applyInputEdgeGeometry(selection, routeLookup = state.data.edgeRoutes) {
  selection.each(function(edge) {
    const route = getInputEdgeRoute(edge, routeLookup);
    const element = d3.select(this);
    if (route?.type === 'polyline' && Array.isArray(route.points)) {
      element.attr('d', buildPolylineEdgePath(
        edge.source,
        edge.target,
        getOrientedPolylinePoints(edge, route)
      ));
      return;
    }
    if (route?.type === 'cubic' && route.cp1 && route.cp2) {
      element.attr('d', buildCubicEdgePath(edge.source, edge.target, route.cp1, route.cp2));
      return;
    }
    if (route?.type === 'quadratic' && route.control) {
      element.attr('d', buildQuadraticEdgePath(edge.source, edge.target, route.control));
      return;
    }

    const endpoints = getStraightEdgeEndpoints(edge.source, edge.target);
    element
      .attr('x1', endpoints.x1)
      .attr('y1', endpoints.y1)
      .attr('x2', endpoints.x2)
      .attr('y2', endpoints.y2);
  });
}

function rebuildInputEdgeSelections(routeLookup = state.data.edgeRoutes) {
  InputZoomContainer.selectAll('.edge-visible, .edge-hit-area').remove();
  // Remove any raw line elements left over from the initial force-simulation
  // layout (created by createGraph/createPresetGraph without CSS classes).
  // These are not caught by the selector above and would persist as ghost edges.
  if (state.d3selections.linkInputVisible) state.d3selections.linkInputVisible.remove();
  if (state.d3selections.linkInput) state.d3selections.linkInput.remove();

  const inputK = Math.sqrt(d3.zoomTransform(elements.svgInput.node()).k);
  const visibleNodes = [];
  const hitAreaNodes = [];
  const containerNode = InputZoomContainer.node();
  const getInsertionAnchor = () => {
    const directChildren = Array.from(containerNode?.childNodes || []);
    return directChildren.find(child => (
      child.nodeType === Node.ELEMENT_NODE
      && (
        child.classList?.contains('input-node')
        || child.tagName === 'text'
      )
    )) || null;
  };

  for (const edge of state.data.graphLinks || []) {
    const route = getInputEdgeRoute(edge, routeLookup);
    const visibleEdge = InputZoomContainer.insert(route ? 'path' : 'line', getInsertionAnchor)
      .datum(edge)
      .attr('class', 'edge-visible')
      .attr('stroke-opacity', 0.6)
      .attr('stroke', '#999')
      .attr('fill', 'none')
      .attr('data-base-sw', 2)
      .attr('stroke-width', 2 / inputK)
      .style('pointer-events', 'none');
    visibleNodes.push(visibleEdge.node());

    const hitAreaEdge = InputZoomContainer.insert(route ? 'path' : 'line', getInsertionAnchor)
      .datum(edge)
      .attr('class', 'edge-hit-area')
      .attr('stroke', 'transparent')
      .attr('fill', 'none')
      .attr('data-base-sw', 15)
      .attr('stroke-width', 15 / inputK)
      .style('cursor', 'pointer');
    hitAreaNodes.push(hitAreaEdge.node());
  }

  state.d3selections.linkInputVisible = d3.selectAll(visibleNodes);
  state.d3selections.linkInput = d3.selectAll(hitAreaNodes);
  applyInputEdgeGeometry(state.d3selections.linkInputVisible, routeLookup);
  applyInputEdgeGeometry(state.d3selections.linkInput, routeLookup);
}

/**
 * Get the current zoom-adjusted radius for a circle element.
 * Uses data-base-r as the logical size and divides by sqrt(k).
 * @param {number} baseR - The logical base radius
 * @param {string} canvas - "input" or "spqr"
 */
function zoomAdjustedR(baseR, canvas = "input") {
  const svg = canvas === "input" ? elements.svgInput : elements.svgSPQR;
  const k = d3.zoomTransform(svg.node()).k;
  // Input canvas: partial counter-scale (nodes grow with sqrt(k) as visual zoom cue).
  // SPQR canvas: full counter-scale so pictogram nodes stay constant visual size.
  return canvas === "spqr" ? baseR : baseR / Math.sqrt(k);
}

// Initialize zoom container - single initialization
let SPQRZoomContainer = initializeZoomContainer("spqr");
let InputZoomContainer = initializeZoomContainer("input");

function getSelectedSPQRComponent() {
  return state.data.spqrTree?.find(comp => comp.isSelected) || null;
}

function updateEmbeddingSwitchButton() {
  const btn = elements.switchEmbeddingBtn;
  if (!btn) return;

  const selected = getSelectedSPQRComponent();
  // The button is only relevant with a component selected; otherwise hide it.
  if (!selected) {
    closePEmbeddingDialog();
    btn.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Switch Embedding';
    btn.title = 'Select a P- or R-component in the SPQR tree first';
    return;
  }
  btn.style.display = '';

  if (selected.type === 'R') {
    if (pEmbeddingDialogState.componentId && pEmbeddingDialogState.componentId !== selected.id) {
      closePEmbeddingDialog();
    }
    btn.disabled = false;
    btn.textContent = `Flip ${selected.id}`;
    btn.title = `Flip the embedding of rigid component ${selected.id}`;
    return;
  }

  if (selected.type === 'P') {
    if (pEmbeddingDialogState.componentId && pEmbeddingDialogState.componentId !== selected.id) {
      closePEmbeddingDialog();
    }
    const order = ensurePEmbeddingOrder(selected);
    btn.disabled = order.length <= 1;
    btn.textContent = 'Reorder children';
    btn.title = btn.disabled
      ? `Parallel component ${selected.id} has no alternate child order`
      : `Manually reorder the child slots of parallel component ${selected.id}`;
    return;
  }

  closePEmbeddingDialog();
  btn.disabled = true;
  btn.textContent = 'Embedding Fixed';
  btn.title = `Component ${selected.id} has no alternate embedding`;
}

// Show the SPQR-canvas actions (view toggle + "Draw from SPQR") only while an
// SPQR tree is drawn, and label the view toggle with the view it would switch to.
function updateSwitchViewButton() {
  const hasTree = !!(state.data.spqrTree && state.data.spqrTree.length > 0);
  const btn = elements.switchViewBtn;
  if (btn) {
    btn.style.display = hasTree ? '' : 'none';
    btn.textContent = state.ui_state.spqrDrawingMode === 'simple'
      ? 'Switch view: Fancy'
      : 'Switch view: Simple';
  }
  if (elements.drawFromSPQRBtn) {
    elements.drawFromSPQRBtn.style.display = hasTree ? '' : 'none';
  }
  // The export lives in the (always-reachable) settings panel, so disable it
  // rather than hide it when there is no tree to export.
  if (elements.exportSpqrBtn) {
    elements.exportSpqrBtn.disabled = !hasTree;
    elements.exportSpqrBtn.title = hasTree
      ? 'Download the SPQR tree as OGDF-shaped JSON'
      : 'Calculate an SPQR tree first';
  }
}

// Show the input-canvas actions (Reset, Calculate SPQR tree) only once the
// input graph has at least one vertex.
function updateInputActionButtons() {
  const hasGraph = !!(state.data.graphNodes && state.data.graphNodes.length > 0);
  if (elements.resetInputBtn) elements.resetInputBtn.style.display = hasGraph ? '' : 'none';
  if (elements.spqrBtn)       elements.spqrBtn.style.display       = hasGraph ? '' : 'none';
}

function updateRerootButton() {
  const btn = elements.rerootBtn;
  if (!btn) return;
  const selected = getSelectedSPQRComponent();
  const isRoot = selected && selected === state.data.spqrRoot;
  // Only relevant with a component selected; otherwise hide it.
  if (!selected) {
    btn.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Reroot here';
    btn.title = 'Select a non-root component in the SPQR tree first';
  } else if (isRoot) {
    btn.style.display = '';
    btn.disabled = true;
    btn.textContent = `${selected.id} is root`;
    btn.title = 'This component is already the root of the SPQR tree';
  } else {
    btn.style.display = '';
    btn.disabled = false;
    btn.textContent = `Reroot at ${selected.id}`;
    btn.title = `Reroot the SPQR tree at component ${selected.id}`;
  }
}

function rerootAtSelected() {
  const selected = getSelectedSPQRComponent();
  if (!selected || selected === state.data.spqrRoot) return;
  selected.isSelected = false;
  unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, selected.id, "orange", false, 0, true);
  state.data.spqrManualRoot = selected;
  createSPQRVisualizationFancy();
  drawInputGraphFromSPQR();
  updateRerootButton();
  updateEmbeddingSwitchButton();
}

function switchSelectedEmbedding() {
  const selected = getSelectedSPQRComponent();
  if (!selected) return;

  if (selected.type === 'R') {
    flipRNode(selected);
  } else if (selected.type === 'P') {
    openPEmbeddingDialog(selected);
    return;
  } else {
    return;
  }

  // Remove stale temporary-edge elements (virtual edge overlays not in graphLinks).
  // rebuildInputEdgeSelections only clears .edge-visible/.edge-hit-area, so these
  // would otherwise stay at pre-flip positions and block correct re-creation.
  InputZoomContainer.selectAll(".temporary-edge").remove();

  drawInputGraphFromSPQR({ preserveZoom: true, animate: state.ui.animateEmbeddingSwitch });

  if (selected.isSelected) {
    // Clear stale tracked arrays so unhighlightComponent won't try to process pre-flip entries
    selected.highlightedNodes = [];
    selected.highlightedEdges = [];
    highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, selected.id);
  }
  updateEmbeddingSwitchButton();
}

function getSPQRComponentById(componentId) {
  return state.data.spqrTree?.find(comp => comp.id === componentId) || null;
}

function getPComponentRealEdge(comp) {
  if (!comp?.virtualEdgeEntry?.length) return null;

  const [u, v] = comp.virtualEdgeEntry[0][0];
  const uStr = String(u);
  const vStr = String(v);

  for (const [a, b] of state.data.graphEdges || []) {
    if ((String(a) === uStr && String(b) === vStr) || (String(a) === vStr && String(b) === uStr)) {
      return [uStr, vStr];
    }
  }

  return null;
}

function getParentVirtualEdgeIdForComponent(comp) {
  if (!comp || !state.data.virtualEdgeData) return null;

  for (const [edgeId, edgeData] of state.data.virtualEdgeData.entries()) {
    if (!edgeData.components.includes(comp.id)) continue;
    const otherId = edgeData.components.find(id => id !== comp.id);
    const otherComp = getSPQRComponentById(otherId);
    if (otherComp && comp.treeLevel != null && otherComp.treeLevel < comp.treeLevel) {
      return edgeId;
    }
  }
  return null;
}

function getPChildComponentIds(comp) {
  if (!comp?.virtualEdgeEntry || !state.data.virtualEdgeData) return [];

  const parentEdgeId = getParentVirtualEdgeIdForComponent(comp);
  const childIds = [];
  for (const [, edgeId] of comp.virtualEdgeEntry) {
    if (parentEdgeId !== null && edgeId === parentEdgeId) continue;
    const edgeData = state.data.virtualEdgeData.get(edgeId);
    const childId = edgeData?.components?.find(id => id !== comp.id);
    if (childId) childIds.push(childId);
  }
  return childIds;
}

function getDefaultPEmbeddingOrder(comp) {
  const childIds = getPChildComponentIds(comp);
  const left = [];
  const right = [];
  childIds.forEach((childId, index) => {
    if (index % 2 === 0) left.push(childId);
    else right.push(childId);
  });
  return [...left.reverse(), P_AXIS_SLOT, ...right];
}

function normalizePEmbeddingOrder(comp, candidateOrder) {
  const expectedChildren = getPChildComponentIds(comp);
  const expectedSet = new Set(expectedChildren);
  const defaultOrder = getDefaultPEmbeddingOrder(comp);
  const result = [];
  const seenChildren = new Set();
  let hasAxisSlot = false;

  for (const token of Array.isArray(candidateOrder) ? candidateOrder : []) {
    if (token === P_AXIS_SLOT) {
      if (!hasAxisSlot) {
        result.push(token);
        hasAxisSlot = true;
      }
      continue;
    }
    if (!expectedSet.has(token) || seenChildren.has(token)) continue;
    result.push(token);
    seenChildren.add(token);
  }

  for (const token of defaultOrder) {
    if (token === P_AXIS_SLOT) {
      continue;
    }
    if (seenChildren.has(token)) continue;
    result.push(token);
    seenChildren.add(token);
  }

  if (!hasAxisSlot) {
    const defaultAxisIndex = defaultOrder.indexOf(P_AXIS_SLOT);
    result.splice(Math.min(defaultAxisIndex, result.length), 0, P_AXIS_SLOT);
  }
  return result;
}

function ensurePEmbeddingOrder(comp) {
  if (!comp || comp.type !== 'P') return [];
  const normalized = normalizePEmbeddingOrder(comp, getPEmbeddingOrder(comp));
  setPEmbeddingOrder(comp, normalized);
  return normalized;
}

function describePEmbeddingToken(comp, token) {
  if (token === P_AXIS_SLOT) {
    const realEdge = getPComponentRealEdge(comp);
    return realEdge
      ? `Pole axis / real edge ${realEdge[0]}-${realEdge[1]}`
      : 'Pole axis u-v (side divider)';
  }

  const child = getSPQRComponentById(token);
  if (!child) return `Child ${token}`;
  return `${child.id} (${child.type})`;
}

function getPEmbeddingVisualOrder(slotOrder) {
  return Array.isArray(slotOrder) ? [...slotOrder] : [];
}

function getPEmbeddingSlotOrderFromVisual(visualOrder) {
  return Array.isArray(visualOrder) ? [...visualOrder] : [];
}

function setPEmbeddingDialogHoveredChild(childId = null) {
  const previousChildId = pEmbeddingDialogState.hoveredChildId;
  if (previousChildId === childId) return;

  if (previousChildId) {
    const previousChild = getSPQRComponentById(previousChildId);
    if (previousChild) {
      previousChild.isHovered = false;
      if (!previousChild.isSelected) {
        unhighlightComponent(
          state.d3selections.nodeInput,
          state.d3selections.linkInput,
          previousChildId
        );
      }
    }
  }

  pEmbeddingDialogState.hoveredChildId = childId;
  if (childId) {
    const child = getSPQRComponentById(childId);
    if (child) {
      child.isHovered = true;
      highlightComponent(
        state.d3selections.nodeInput,
        state.d3selections.linkInput,
        childId
      );
    }
  }
}

function renderPEmbeddingDialog() {
  const comp = getSPQRComponentById(pEmbeddingDialogState.componentId);
  if (!elements.pEmbeddingDialogList || !elements.pEmbeddingApplyBtn) {
    return;
  }

  if (!comp || comp.type !== 'P') {
    closePEmbeddingDialog();
    return;
  }

  const order = pEmbeddingDialogState.order;
  setPEmbeddingDialogHoveredChild();

  elements.pEmbeddingDialogTitle.textContent = `Reorder ${comp.id}`;
  elements.pEmbeddingDialogDescription.textContent =
    'Drag the slots into drawing order. Children before the pole-axis divider are drawn on one side of u-v; children after it are drawn on the other side.';
  elements.pEmbeddingDialogList.innerHTML = '';

  order.forEach((token, index) => {
    const item = document.createElement('div');
    item.className = 'p-embedding-dialog-item';
    if (token === P_AXIS_SLOT) item.classList.add('p-embedding-dialog-axis');
    item.draggable = true;
    item.dataset.index = String(index);
    if (token !== P_AXIS_SLOT) {
      item.dataset.childId = String(token);
      item.addEventListener('mouseenter', () => {
        setPEmbeddingDialogHoveredChild(token);
      });
      item.addEventListener('mouseleave', () => {
        if (pEmbeddingDialogState.hoveredChildId === token) {
          setPEmbeddingDialogHoveredChild();
        }
      });
    }

    const handle = document.createElement('span');
    handle.className = 'p-embedding-dialog-item-handle';
    handle.textContent = '⠿';

    const orderLabel = document.createElement('span');
    orderLabel.className = 'p-embedding-dialog-item-order';
    orderLabel.textContent = `${index + 1}.`;

    const itemLabel = document.createElement('span');
    itemLabel.className = 'p-embedding-dialog-item-label';
    itemLabel.textContent = describePEmbeddingToken(comp, token);

    const moveControls = document.createElement('span');
    moveControls.className = 'p-embedding-dialog-item-controls';

    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'p-embedding-dialog-move';
    moveUp.textContent = '↑';
    moveUp.title = 'Move up';
    moveUp.setAttribute('aria-label', `Move ${itemLabel.textContent} up`);
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', (e) => {
      e.stopPropagation();
      if (index === 0) return;
      [order[index - 1], order[index]] = [order[index], order[index - 1]];
      renderPEmbeddingDialog();
    });

    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'p-embedding-dialog-move';
    moveDown.textContent = '↓';
    moveDown.title = 'Move down';
    moveDown.setAttribute('aria-label', `Move ${itemLabel.textContent} down`);
    moveDown.disabled = index === order.length - 1;
    moveDown.addEventListener('click', (e) => {
      e.stopPropagation();
      if (index >= order.length - 1) return;
      [order[index], order[index + 1]] = [order[index + 1], order[index]];
      renderPEmbeddingDialog();
    });

    moveControls.append(moveUp, moveDown);
    item.append(handle, orderLabel, itemLabel, moveControls);

    item.addEventListener('dragstart', (e) => {
      pEmbeddingDialogState.dragIndex = index;
      item.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging');
      elements.pEmbeddingDialogList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (pEmbeddingDialogState.dragIndex !== index) {
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const from = pEmbeddingDialogState.dragIndex;
      const to = index;
      if (from == null || from === to) return;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      pEmbeddingDialogState.dragIndex = null;
      renderPEmbeddingDialog();
    });

    elements.pEmbeddingDialogList.appendChild(item);
  });

  elements.pEmbeddingApplyBtn.disabled = order.length <= 1;
}

function openPEmbeddingDialog(comp) {
  if (!comp || comp.type !== 'P' || !elements.pEmbeddingDialog) return;

  const slotOrder = ensurePEmbeddingOrder(comp);
  const order = getPEmbeddingVisualOrder(slotOrder);
  if (order.length <= 1) return;

  pEmbeddingDialogState.componentId = comp.id;
  pEmbeddingDialogState.order = [...order];
  pEmbeddingDialogState.selectedIndex = 0;
  if (elements.inputCanvasWrapper
      && elements.pEmbeddingDialog.parentElement !== elements.inputCanvasWrapper) {
    elements.inputCanvasWrapper.appendChild(elements.pEmbeddingDialog);
  }
  elements.pEmbeddingDialog.classList.add('show');
  renderPEmbeddingDialog();
}

function closePEmbeddingDialog() {
  if (!elements.pEmbeddingDialog) return;

  setPEmbeddingDialogHoveredChild();
  elements.pEmbeddingDialog.classList.remove('show');
  pEmbeddingDialogState.componentId = null;
  pEmbeddingDialogState.order = [];
  pEmbeddingDialogState.selectedIndex = 0;
}


function applyPEmbeddingDialogOrder() {
  const comp = getSPQRComponentById(pEmbeddingDialogState.componentId);
  if (!comp || comp.type !== 'P') {
    closePEmbeddingDialog();
    return;
  }

  const slotOrder = getPEmbeddingSlotOrderFromVisual(pEmbeddingDialogState.order);
  const normalized = normalizePEmbeddingOrder(comp, slotOrder);
  setPEmbeddingOrder(comp, normalized);

  closePEmbeddingDialog();
  drawInputGraphFromSPQR({ preserveZoom: true, animate: state.ui.animateEmbeddingSwitch });
  updateEmbeddingSwitchButton();
  drawSPQRTreeReingoldTilford(state.data.spqrRoot);
  if (comp.isSelected) {
    if (state.d3selections.nodeInput && state.d3selections.linkInput) {
      highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, comp.id);
    }
    // highlightSPQRNode skips selected nodes, so reapply the border manually after the redraw.
    const compGroup = elements.svgSPQR.select(`g.spqr-component[data-comp-id='${comp.id}']`);
    compGroup.select("rect.bounding-box").attr("stroke", "blue").attr("stroke-width", 3);
    compGroup.selectAll("circle.node").attr("fill", "blue");
  }
}

//RESETS STATE OF THE APPLICATION

function resetState() {
  stopEmbeddingAnimation();

  // Stop and clear simulations
  if (state.simulation.input) {
    state.simulation.input.stop();
    state.simulation.input = null;
  }
  if (state.simulation.spqr) {
    state.simulation.spqr.stop();
    state.simulation.spqr = null;
  }
  
  // Clear selections
  state.d3selections.nodeInput = null;
  state.d3selections.linkInput = null;
  state.d3selections.linkInputVisible = null;
  state.d3selections.labelInput = null;
  state.d3selections.nodeSPQR = null;
  state.d3selections.linkSPQR = null;
  state.d3selections.labelSPQR = null;
  
  // Clear data
  state.data.spqrTree = null;
  state.data.spqrRoot = null;
  state.data.spqrManualRoot = null;
  state.data.graphEdges = [];
  state.data.graphNodes = [];
  state.data.graphLinks = [];
  state.data.edgeRoutes = new Map();
  state.data.componentPoses = new Map();
  state.data.composedDrawing = null;
  state.data.virtualEdgeData.clear();
  state.data.allVirtualTwinEdgeLinks = [];
  state.data.inputNodePositions.clear();
  state.data.inputNew = true;
  state.data.isPreset = false;
  state.data.presetType = null;
  state.data.anySPQRComponentCollapsed = false;
  state.data.originalGraphEdges = null;
  state.data.componentVirtualEdgesMap = new Map();
  state.data.componentCentroids = new Map();
  state.data.inputGraphIsNotBiconnected = false;
  state.data.articulationPoints.clear();  // Clear articulation points
  updateEmbeddingSwitchButton();
  updateRerootButton();
  updateSwitchViewButton();
  updateInputActionButtons();

  // Reset UI state
  state.ui.colors = ["green", "red", "blue", "yellow", "orange", "purple"];
  state.ui.colorC = 0;
  state.ui.spqrReady = true;
  if (state.ui.dragUpdateTimer) {
    clearTimeout(state.ui.dragUpdateTimer);
    state.ui.dragUpdateTimer = null;
  }
  
  // Reset draw mode
  state.ui_state.drawMode = false;
  state.ui_state.deleteMode = false;
  state.ui_state.edgeStart = null;
  setActiveToolOff(); // Reset active tool
  state.ui_state.currentTool = null; // Reset current tool
  
  // Reset previous tree data
  state.data.previousSpqrTree = null;
  state.data.componentMapping.clear();
  state.data.unchangedComponents.clear();
  state.data.changedComponents.clear();
  state.data.newComponents.clear();
  state.data.removedComponents.clear();
  
  console.log("State reset complete");
  
  console.log("State reset complete");
}

//HANDLE FORMS AND BUTTONS TO READ IN DATA AND CREATE SPQR VISUALIZATION

function handleFormSubmit(e) {
  e.preventDefault();

  const hintEl = document.getElementById('graph-input-hint');
  const setHint = (msg, isError) => {
    if (!hintEl) return;
    hintEl.textContent = msg;
    hintEl.classList.toggle('input-hint-error', !!isError);
  };

  let parsed;
  try {
    parsed = parseInput();
  } catch (err) {
    if (err instanceof GraphImportError) {
      setHint(err.message, true);
      return; // leave the current graph untouched on a parse failure
    }
    throw err;
  }

  const { vertices, edges, format } = parsed;
  console.log('parsed graph:', { format, vertices, edges });

  resetState();
  state.data.originalGraphEdges = edges.map(e => [...e]);

  clearBothGraphs();
  // Run the force simulation so the imported graph is positioned and visible
  // immediately. We deliberately do NOT compute the SPQR tree here — the user
  // calculates it explicitly via the "Calculate SPQR tree" button, which then
  // redraws the input from the SPQR embedding.
  drawInputGraph(vertices, edges, null, true);

  const FORMAT_LABEL = {
    'edge-list': 'edge list',
    'adjacency-list': 'adjacency list',
    'dot': 'DOT',
    'json': 'JSON',
  };
  setHint(
    `Loaded ${vertices.length} vertices, ${edges.length} edges (read as ${FORMAT_LABEL[format] || format}).`,
    false
  );
}

function handleExampleGraph(vertices, edges, presetType = null) {
  return () => {
    console.log(`Loading example graph: ${presetType} (timerRunning=${_embeddingAnimTimer != null})`);

    stopEmbeddingAnimation();

    // Force stop any running simulations
    if (state.simulation.input) {
      state.simulation.input.stop();
    }
    if (state.simulation.spqr) {
      state.simulation.spqr.stop();
    }

    // Complete state reset
    resetState();
    state.data.isPreset = presetType !== null;
    
    // Clear both graphs completely
    clearBothGraphs();
    
    // Create fresh copies of the data to avoid mutation
    const freshVertices = vertices.map(v => typeof v === "object" ? {...v} : v);
    const freshEdges = edges.map(e => [...e]);
    
    console.log("Fresh vertices:", freshVertices);
    console.log("Fresh edges:", freshEdges);
    
    // Set up the graph with fresh data
    drawInputGraph(freshVertices, freshEdges, presetType);
    if (presetType != null) refreshInputGraph();
    
    createSPQRVisualization();

    // DIAG: check final cx/cy after everything
    if (state.d3selections.nodeInput) {
      state.d3selections.nodeInput.each(function(d) {
        const el = d3.select(this);
        console.log(`[POST-SPQR] node ${d.id}: cx=${el.attr("cx")} d.x=${d.x?.toFixed(1)}`);
      });
    }

  };
}

    function calculateAndStoreComponentCentroids() {
  state.data.componentCentroids.clear();
  
  state.data.spqrTree.forEach(comp => {
    let xSum = 0, ySum = 0, count = 0;
    
    comp.graph.forEach((_, nodeId) => {
      const pos = state.data.inputNodePositions.get(String(nodeId));
      if (pos) {
        xSum += pos.x;
        ySum += pos.y;
        count++;
      }
    });

    if (count > 0) {
      state.data.componentCentroids.set(comp.id, {
        x: xSum / count,
        y: ySum / count
      });
    }
  });
}
// Tutorial modal logic
document.addEventListener("DOMContentLoaded", () => {
  // Clear the paste box on load. autocomplete="off" is only advisory — some
  // browsers (notably Firefox) restore textarea contents across reloads anyway,
  // which would leave a stale graph sitting in the box.
  const graphInput = document.getElementById('graph-input');
  if (graphInput) graphInput.value = "";
  const graphInputHint = document.getElementById('graph-input-hint');
  if (graphInputHint) { graphInputHint.textContent = ""; graphInputHint.classList.remove('input-hint-error'); }

  const modal = document.getElementById("tutorial-modal");
  const closeBtn = modal.querySelector(".close");

  // Show modal on page load
  modal.style.display = "block";

  // Close when clicking X
  closeBtn.onclick = () => {
    modal.style.display = "none";
  };

  // Close when clicking outside the box
  window.onclick = event => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };
});

function getSpqrComponentLabel(componentId, style = state.ui_state.spqrLabelStyle) {
  return style === "type" ? componentId[0] : componentId;
}

function getSpqrLabelTabWidth(labelText) {
  return Math.max(24, labelText.length * 9 + 12);
}

function getSpqrLabelTabGeometry(boundingRect, labelText) {
  const width = getSpqrLabelTabWidth(labelText);
  const height = 22;
  const boxLeft = boundingRect.x;
  const y = boundingRect.y + 6;
  const outerX = boxLeft - width + 6;
  const outerCurve = 5;
  const innerX = boxLeft;
  const fillPath = [
    `M ${innerX} ${y}`,
    `H ${outerX + outerCurve}`,
    `Q ${outerX} ${y} ${outerX} ${y + outerCurve}`,
    `V ${y + height - outerCurve}`,
    `Q ${outerX} ${y + height} ${outerX + outerCurve} ${y + height}`,
    `H ${innerX}`,
    'Z'
  ].join(' ');
  const outlinePath = [
    `M ${innerX} ${y}`,
    `H ${outerX + outerCurve}`,
    `Q ${outerX} ${y} ${outerX} ${y + outerCurve}`,
    `V ${y + height - outerCurve}`,
    `Q ${outerX} ${y + height} ${outerX + outerCurve} ${y + height}`,
    `H ${innerX}`
  ].join(' ');
  return {
    fillPath,
    outlinePath,
    textX: outerX + 6,
    textY: y + 16
  };
}

function applySpqrLabelStyle() {
  const style = state.ui_state.spqrLabelStyle;
  const compVisible = state.ui_state.spqrCompLabelsVisible;

  // Fancy mode: update .bounding-label elements directly
  elements.svgSPQR.selectAll(".bounding-label").each(function() {
    const el = d3.select(this);
    const fullId = el.attr("data-comp-id");
    const labelText = fullId ? getSpqrComponentLabel(fullId, style) : "";
    if (fullId) el.text(labelText);
    const parent = d3.select(this.parentNode);
    const boundingRect = parent.datum()?.boundingRect ?? {
      x: -spqrComponentPictogramSize / 2,
      y: -spqrComponentPictogramSize / 2
    };
    const tab = getSpqrLabelTabGeometry(boundingRect, labelText);
    el
      .attr("x", tab.textX)
      .attr("y", tab.textY)
      .style("display", compVisible ? null : "none");
    parent
      .select(".bounding-label-tab")
      .attr("d", tab.fillPath)
      .style("display", compVisible ? null : "none");
    parent
      .select(".bounding-label-tab-outline")
      .attr("d", tab.outlinePath)
      .style("display", compVisible ? null : "none");
  });

  // Simple mode: update labelSPQR selection if present
  if (state.d3selections.labelSPQR) {
    const getText = style === 'type' ? d => d.id[0] : d => d.id;
    state.d3selections.labelSPQR.text(getText);
    state.d3selections.labelSPQR.style("display", compVisible ? null : "none");
  }
}

// Event listeners - consolidated
function setupEventListeners() {
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.spqrBtn.onclick = function() {

    const statusBox = d3.select("#biconnected-status");

    // An SPQR tree only exists for a biconnected graph with at least three
    // edges: the smallest triconnected components are a triangle (S), a
    // 3-bond (P), or a 4-vertex rigid graph (R). A single vertex (no edges) or
    // a single edge is degenerate and has no SPQR tree, so reject those here
    // before attempting any decomposition.
    const edgeCount = state.data.graphEdges ? state.data.graphEdges.length : 0;
    if (edgeCount < 3) {
      state.data.inputGraphIsNotBiconnected = false;
      state.data.spqrTree = null;
      state.data.spqrRoot = null;
      clearGraph(elements.svgSPQR);
      resetStats();
      // Refresh tree-dependent SPQR buttons now that there is no tree.
      updateSwitchViewButton();
      updateEmbeddingSwitchButton();
      updateRerootButton();
      statusBox
        .style("display", "block")
        .style("color", "red")
        .html(`⚠️ Not biconnected`);
      return;
    }

    var biconnected = isBiconnected(state.data.graphEdges);

    if (!biconnected) {
      state.data.inputGraphIsNotBiconnected = true;
      statusBox
        .style("display", "block")
        .style("color", "red")
        .html(`
          ⚠️ Not biconnected — red vertices are cut vertices
          <span class="info-tooltip" style="
            display: inline-block;
            width: 16px;
            height: 16px;
            line-height: 16px;
            text-align: center;
            border-radius: 50%;
            background: #666;
            color: white;
            font-size: 12px;
            font-weight: bold;
            cursor: help;
            margin-left: 4px;
            vertical-align: middle;
          " title="A cut vertex disconnects the graph when removed. Add edges to eliminate cut vertices and make the graph biconnected.">?</span>
        `);
    } else {
      statusBox.style("display", "none");
    }

  

    
    clearGraph(elements.svgSPQR);
    if(biconnected) createSPQRVisualization();
    else {
      resetStats()
    }
  };
  
  elements.exampleBtns.brown.onclick = handleExampleGraph(verticesBrown, edgesBrown);
  elements.exampleBtns.db.onclick = handleExampleGraph(verticesDB, edgesDB, "DiBattista");
  elements.exampleBtns.wikipedia.onclick = handleExampleGraph(verticesWikipedia, edgesWikipedia, "Wikipedia");
  elements.exampleBtns.kindermann.onclick = handleExampleGraph(verticesKindermann, edgesKindermann);
  elements.exampleBtns.tutorialP.onclick = handleExampleGraph(verticesTutorialP, edgesTutorialP, "TutorialP");
  elements.exampleBtns.tutorialS.onclick = handleExampleGraph(verticesTutorialS, edgesTutorialS, "TutorialS");
  elements.exampleBtns.tutorialR.onclick = handleExampleGraph(verticesTutorialR, edgesTutorialR, "TutorialR");
  
  // Wire up the combined SPQR view toggle button. It switches between the
  // schematic "fancy" layout and the force-directed "simple" layout, and is
  // only visible while an SPQR tree is shown in the canvas.
  const switchViewBtn = document.getElementById('switch-view-mode');

  switchViewBtn.onclick = function() {
    // Toggle the mode, then redraw if an SPQR tree is currently shown.
    state.ui_state.spqrDrawingMode =
      state.ui_state.spqrDrawingMode === 'simple' ? 'fancy' : 'simple';
    console.log(`Switched to ${state.ui_state.spqrDrawingMode} SPQR mode`);
    updateSwitchViewButton();

    if (state.data.spqrTree && state.data.spqrTree.length > 0) {
      const selectedCompId = state.data.spqrTree.find(c => c.isSelected)?.id;
      state.ui.pendingHighlightCompId = selectedCompId;
      createSPQRVisualization();
      // Apply highlighting immediately after the visualization is created
      if (selectedCompId) {
        requestAnimationFrame(() => {
          const selectedComp = state.data.spqrTree.find(c => c.id === selectedCompId);
          if (selectedComp && state.d3selections.nodeInput && state.d3selections.linkInput) {
            console.log(`[Mode Switch] Applying immediate highlighting to ${selectedCompId}`);
            selectedComp.isSelected = true;
            highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, selectedComp.id);
            // Update SPQR node fill color in simple mode
            if (state.ui_state.spqrDrawingMode === 'simple' && state.d3selections.nodeSPQR) {
              state.d3selections.nodeSPQR
                .style("fill", node => {
                  const nodeComp = state.data.spqrTree.find(c => c.id === node.id);
                  return nodeComp && nodeComp.isSelected ? "orange" : "steelblue";
                });
            }
            updateEmbeddingSwitchButton();
          }
        });
      }
    }
  };

  // Set fancy mode as default
  state.ui_state.spqrDrawingMode = 'fancy';
  updateSwitchViewButton();

  // Wire up "Draw from SPQR" button
  const drawFromSPQRBtn = document.getElementById('draw-from-spqr-btn');
  if (drawFromSPQRBtn) {
    drawFromSPQRBtn.onclick = function() {
      // Drawing vertices/edges only updates graphNodes/graphEdges — it does not
      // rebuild state.data.spqrTree. If the input graph has changed since the
      // tree was last computed, recompute it first so the drawing reflects the
      // current graph instead of a stale tree (which would ignore anything added
      // since the last "Calculate SPQR Tree"). When nothing changed we skip the
      // recompute, which preserves the user's manually chosen root.
      const treeMissing = !state.data.spqrTree || state.data.spqrTree.length === 0 || !state.data.spqrRoot;
      const graphChanged = edgeSetSignature(state.data.graphEdges) !== state.data.spqrTreeEdgeSignature;

      if (treeMissing || graphChanged) {
        if (!isBiconnected(state.data.graphEdges)) {
          console.warn("Input graph is not biconnected — cannot decompose. Make it biconnected first.");
          return;
        }
        // Mirror the "Calculate SPQR Tree" button so its biconnected-status box
        // stays in sync, then rebuild the tree (this preserves per-component
        // embedding flips).
        d3.select("#biconnected-status").style("display", "none");
        clearGraph(elements.svgSPQR);
        createSPQRVisualization();
      }

      if (!state.data.spqrTree || state.data.spqrTree.length === 0 || !state.data.spqrRoot) {
        console.warn("No SPQR tree available — calculate one first.");
        return;
      }
      const selected = getSelectedSPQRComponent();
      if (selected) {
        selected.isSelected = false;
        unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, selected.id, "orange", false, 0, true);
      }
      drawInputGraphFromSPQR();
    };
  }

  // ── Settings panels ───────────────────────────────────────────────────────
  const inputSettingsBtn   = document.getElementById('input-settings-btn');
  const inputSettingsPanel = document.getElementById('input-settings-panel');
  const spqrSettingsBtn    = document.getElementById('spqr-settings-btn');
  const spqrSettingsPanel  = document.getElementById('spqr-settings-panel');
  const inputLabelsCheck       = document.getElementById('input-labels-check');
  const spqrVertexLabelsCheck  = document.getElementById('spqr-vertex-labels-check');
  const spqrCompLabelsCheck    = document.getElementById('spqr-comp-labels-check');

  function setVertexLabelsVisible(visible) {
    state.ui_state.inputLabelsVisible = visible;
    if (state.d3selections.labelInput) {
      state.d3selections.labelInput.style("display", visible ? null : "none");
    }
    // Keep both checkboxes in sync
    if (inputLabelsCheck)      inputLabelsCheck.checked = visible;
    if (spqrVertexLabelsCheck) spqrVertexLabelsCheck.checked = visible;
  }

  function togglePanel(panel) {
    const open = panel.style.display === 'block';
    if (inputSettingsPanel) inputSettingsPanel.style.display = 'none';
    if (spqrSettingsPanel)  spqrSettingsPanel.style.display  = 'none';
    if (!open) panel.style.display = 'block';
  }

  if (inputSettingsBtn && inputSettingsPanel) {
    inputSettingsBtn.onclick = function(e) {
      e.stopPropagation();
      togglePanel(inputSettingsPanel);
    };
  }

  if (spqrSettingsBtn && spqrSettingsPanel) {
    spqrSettingsBtn.onclick = function(e) {
      e.stopPropagation();
      togglePanel(spqrSettingsPanel);
    };
  }

  document.addEventListener('click', function(e) {
    if (inputSettingsPanel && inputSettingsPanel.style.display === 'block' &&
        !inputSettingsPanel.contains(e.target) && e.target !== inputSettingsBtn) {
      inputSettingsPanel.style.display = 'none';
    }
    if (spqrSettingsPanel && spqrSettingsPanel.style.display === 'block' &&
        !spqrSettingsPanel.contains(e.target) && e.target !== spqrSettingsBtn) {
      spqrSettingsPanel.style.display = 'none';
    }
  });

  // ── Draw/Delete help popover ─────────────────────────────────────────────
  // Hover reveals it via CSS; clicking the badge pins it open (for touch and so
  // it stays put while reading), and an outside click closes it again.
  const drawHelpBtn     = document.getElementById('draw-help-btn');
  const drawHelpPopover = document.getElementById('draw-help-popover');
  if (drawHelpBtn && drawHelpPopover) {
    drawHelpBtn.onclick = function(e) {
      e.stopPropagation();
      const open = drawHelpPopover.classList.toggle('open');
      drawHelpBtn.classList.toggle('open', open);
    };
    document.addEventListener('click', function(e) {
      if (drawHelpPopover.classList.contains('open') &&
          !drawHelpPopover.contains(e.target) && e.target !== drawHelpBtn) {
        drawHelpPopover.classList.remove('open');
        drawHelpBtn.classList.remove('open');
      }
    });
  }

  if (inputLabelsCheck) {
    inputLabelsCheck.onchange = function() { setVertexLabelsVisible(this.checked); };
  }

  if (spqrVertexLabelsCheck) {
    spqrVertexLabelsCheck.onchange = function() { setVertexLabelsVisible(this.checked); };
  }

  if (spqrCompLabelsCheck) {
    spqrCompLabelsCheck.onchange = function() {
      state.ui_state.spqrCompLabelsVisible = this.checked;
      const styleGroup = document.getElementById('spqr-label-style-group');
      if (styleGroup) styleGroup.style.opacity = this.checked ? '1' : '0.4';
      applySpqrLabelStyle();
    };
  }

  document.querySelectorAll('input[name="spqr-label-style"]').forEach(radio => {
    radio.onchange = function() {
      if (this.checked) {
        state.ui_state.spqrLabelStyle = this.value;
        applySpqrLabelStyle();
      }
    };
  });

  const spqrFreePositioningCheck = document.getElementById('spqr-free-positioning-check');
  if (spqrFreePositioningCheck) {
    spqrFreePositioningCheck.onchange = function() {
      state.ui_state.spqrFreePositioning = this.checked;
      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    };
  }

  const embeddingAnimCheck = document.getElementById('embedding-anim-check');
  if (embeddingAnimCheck) {
    embeddingAnimCheck.onchange = function() {
      state.ui.animateEmbeddingSwitch = this.checked;
    };
  }

  // ── Export SPQR tree (OGDF-shaped JSON) ──────────────────────────────────
  const exportSpqrBtn = document.getElementById('export-spqr-btn');
  if (exportSpqrBtn) {
    exportSpqrBtn.onclick = function() {
      if (!state.data.spqrTree || state.data.spqrTree.length === 0) {
        console.warn('No SPQR tree to export — calculate one first.');
        return;
      }
      const json = spqrTreeToOGDFJSON(
        state.data.spqrTree,
        state.data.spqrRoot,
        state.data.graphNodes,
        state.data.graphEdges
      );
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spqr-tree.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // ── Regions toggle & filter panel ────────────────────────────────────────
  // The regions controls now live inside the SPQR settings panel: a
  // "Show allocated regions" checkbox plus a "Filter…" button that opens the
  // per-component panel.
  const toggleRegionsCheck = document.getElementById('toggle-regions-check');
  const regionsFilterBtn  = document.getElementById('regions-filter-btn');
  const regionsPanel      = document.getElementById('regions-panel');

  function setRegionsGroupVisible(visible) {
    const group = elements.svgInput.select(".region-overlay-group");
    if (group.empty()) return;
    group.style("display", visible ? null : "none");
    if (toggleRegionsCheck) toggleRegionsCheck.checked = visible;
    if (!visible && regionsPanel) regionsPanel.style.display = 'none';
  }

  if (toggleRegionsCheck) {
    toggleRegionsCheck.onchange = function() {
      const group = elements.svgInput.select(".region-overlay-group");
      if (group.empty()) { this.checked = false; return; }
      setRegionsGroupVisible(this.checked);
    };
  }

  if (regionsFilterBtn && regionsPanel) {
    regionsFilterBtn.onclick = function(e) {
      e.stopPropagation();
      const open = regionsPanel.style.display !== 'none';
      regionsPanel.style.display = open ? 'none' : 'block';
    };
    // Close panel when clicking outside
    document.addEventListener('click', function(e) {
      if (regionsPanel.style.display !== 'none' &&
          !regionsPanel.contains(e.target) &&
          e.target !== regionsFilterBtn) {
        regionsPanel.style.display = 'none';
      }
    });
  }

  /**
   * Rebuild the per-component checkbox panel from the current regions array.
   * Called after each SPQR drawing.
   */
  function buildRegionsPanel(regions) {
    const listEl = document.getElementById('regions-panel-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    // Collect unique labels in component-type order (P, S, R)
    const labelSet = new Set();
    for (const r of regions) { if (r.label) labelSet.add(r.label); }
    const labels = [...labelSet].sort((a, b) => {
      // Sort by type letter first, then by number
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      return parseInt(a.slice(1) || '0') - parseInt(b.slice(1) || '0');
    });
    if (labels.length === 0) return;

    const typeColor = { P: '#4682e6', S: '#32b450', R: '#c86432' };

    function getGroupEls(lbl) {
      return elements.svgInput.selectAll(`.region-overlay-group [data-label="${lbl}"]`);
    }

    function syncAllCheckbox() {
      const rows   = listEl.querySelectorAll('.rp-row input[type="checkbox"]');
      const allCb  = listEl.querySelector('.rp-all-row input[type="checkbox"]');
      if (!allCb) return;
      const checked = [...rows].filter(c => c.checked).length;
      allCb.checked       = checked === rows.length;
      allCb.indeterminate = checked > 0 && checked < rows.length;
    }

    // "All" row
    const allRow = document.createElement('div');
    allRow.className = 'rp-all-row';
    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.id   = 'rp-all-cb';
    allCb.checked = true;
    allCb.addEventListener('change', () => {
      const vis = allCb.checked;
      // Show/hide the whole group via master button logic, but keep panel open
      const group = elements.svgInput.select('.region-overlay-group');
      if (!group.empty()) group.style('display', vis ? null : 'none');
      if (toggleRegionsCheck) toggleRegionsCheck.checked = vis;
      // Sync every row checkbox
      listEl.querySelectorAll('.rp-row input[type="checkbox"]').forEach(c => {
        c.checked = vis;
        getGroupEls(c.dataset.lbl).style('display', vis ? null : 'none');
      });
    });
    const allLbl = document.createElement('label');
    allLbl.htmlFor = 'rp-all-cb';
    allLbl.textContent = 'All components';
    allRow.appendChild(allCb);
    allRow.appendChild(allLbl);
    listEl.appendChild(allRow);

    // One row per label
    for (const lbl of labels) {
      const compType = lbl[0].toUpperCase();
      const color    = typeColor[compType] || '#888';

      const row = document.createElement('div');
      row.className = 'rp-row';

      const dot = document.createElement('span');
      dot.className = 'rp-dot';
      dot.style.background = color;

      const cb = document.createElement('input');
      cb.type         = 'checkbox';
      cb.checked      = true;
      cb.dataset.lbl  = lbl;
      cb.id           = `rp-cb-${lbl}`;
      cb.addEventListener('change', () => {
        const vis = cb.checked;
        getGroupEls(lbl).style('display', vis ? null : 'none');
        // If showing, ensure the group itself is visible
        if (vis) {
          const group = elements.svgInput.select('.region-overlay-group');
          if (!group.empty() && group.style('display') === 'none') {
            group.style('display', null);
            if (toggleRegionsCheck) toggleRegionsCheck.checked = true;
          }
        }
        syncAllCheckbox();
      });

      const lblEl = document.createElement('label');
      lblEl.htmlFor    = `rp-cb-${lbl}`;
      lblEl.textContent = lbl;
      lblEl.style.color = color;
      lblEl.style.fontWeight = '600';

      row.appendChild(dot);
      row.appendChild(cb);
      row.appendChild(lblEl);
      listEl.appendChild(row);
    }
  }
  // Expose for use in drawInputGraphFromSPQR
  window._buildRegionsPanel = buildRegionsPanel;

  if (elements.switchEmbeddingBtn) {
    elements.switchEmbeddingBtn.onclick = function() {
      switchSelectedEmbedding();
    };
    updateEmbeddingSwitchButton();
  }

  if (elements.rerootBtn) {
    elements.rerootBtn.onclick = function() {
      rerootAtSelected();
    };
    updateRerootButton();
  }

  if (elements.pEmbeddingApplyBtn) {
    elements.pEmbeddingApplyBtn.onclick = function() {
      applyPEmbeddingDialogOrder();
    };
  }

  if (elements.pEmbeddingCancelBtn) {
    elements.pEmbeddingCancelBtn.onclick = function() {
      closePEmbeddingDialog();
    };
  }
}

function resetStats() {

  document.getElementById('r-count').textContent = "-";
  document.getElementById('s-count').textContent = "-";
  document.getElementById('p-count').textContent = "-";
  document.getElementById('q-count').textContent = "-";
  document.getElementById('embedding-count').textContent = "-";
  // No SPQR tree is shown after a stats reset, so hide the tree-dependent
  // SPQR-canvas actions.
  if (elements.switchViewBtn)    elements.switchViewBtn.style.display = 'none';
  if (elements.drawFromSPQRBtn)  elements.drawFromSPQRBtn.style.display = 'none';
  if (elements.exportSpqrBtn)    elements.exportSpqrBtn.disabled = true;
}

// Initialize
setupEventListeners();

// Initialize Tutorial System
function initializeTutorial() {
  const tutorialCallbacks = {
    clearGraph: () => {
      clearGraph(elements.svgInput);
      clearGraph(elements.svgSPQR);
      // clearGraph() removes the input/spqr zoom containers from the DOM, leaving
      // the module-level InputZoomContainer/SPQRZoomContainer references dangling.
      // Reinitialize them so an empty canvas stays drawable (e.g. Draw/Delete on
      // the "Try It Yourself" tutorial slide work even without a graph loaded).
      InputZoomContainer = initializeZoomContainer("input");
      SPQRZoomContainer = initializeZoomContainer("spqr");
      resetStats();
    },
    loadGraph: (graphData) => {
      console.log("Tutorial: Loading custom graph", graphData);
      const { vertices, edges, type = null } = graphData;

      // Force stop any running simulations
      if (state.simulation.input) {
        state.simulation.input.stop();
      }
      if (state.simulation.spqr) {
        state.simulation.spqr.stop();
      }

      // Reset state
      resetState();
      // Treat named tutorial graphs like presets so no force simulation runs
      state.data.isPreset = type !== null;

      // Clear both graphs
      clearBothGraphs();

      // Draw the graph using the same approach as example graphs
      const freshVertices = vertices.map(v => typeof v === "object" ? {...v} : v);
      const freshEdges = edges.map(e => [...e]);

      drawInputGraph(freshVertices, freshEdges, type);
      if (type !== null) refreshInputGraph();
    },
    loadPreset: (presetName) => {
      const presets = {
        'tutorialP': { vertices: verticesTutorialP, edges: edgesTutorialP, name: 'TutorialP' },
        'tutorialS': { vertices: verticesTutorialS, edges: edgesTutorialS, name: 'TutorialS' },
        'tutorialR': { vertices: verticesTutorialR, edges: edgesTutorialR, name: 'TutorialR' },
        'brown': { vertices: verticesBrown, edges: edgesBrown, name: 'Brown' },
        'wikipedia': { vertices: verticesWikipedia, edges: edgesWikipedia, name: 'Wikipedia' },
        'db': { vertices: verticesDB, edges: edgesDB, name: 'DiBattista' },
        'kindermann': { vertices: verticesKindermann, edges: edgesKindermann, name: 'Kindermann' }
      };
      
      const preset = presets[presetName];
      if (preset) {
        handleExampleGraph(preset.vertices, preset.edges, preset.name)();
      }
    },
    calculateSPQR: () => {
      if (elements.spqrBtn) {
        elements.spqrBtn.click();
      }
    },
    setPreferSRoot: () => {
      state.ui.preferSRoot = true;
    },
    // Base-aware URL helper so the tutorial's history/URL syncing and TOC links
    // work both at the domain root (local dev) and under a GitHub Pages subpath.
    buildAppUrl,
  };

  tutorial = new Tutorial(state, elements, tutorialCallbacks);
  
  // Add tutorial button event listener
  if (elements.tutorialBtn) {
    elements.tutorialBtn.onclick = () => {
      stopEmbeddingAnimation();
      resetState();
      clearBothGraphs();
      resetStats();
      tutorial.start();
    };
  }
}

// Call tutorial initialization
initializeTutorial();

// Auto-start tutorial when accessed via <base>tutorial or <base>tutorial/N.
// The route is matched relative to BASE_PATH so it works both at the domain
// root (local dev) and under a GitHub Pages project subpath.
{
  const route = getAppRoute();
  if (route === 'tutorial' || route.startsWith('tutorial/')) {
    const match = route.match(/^tutorial\/(\d+)$/);
    const stepIndex = match
      ? Math.max(0, Math.min(parseInt(match[1], 10) - 1, tutorial.steps.length - 1))
      : 0;
    tutorial.start(stepIndex);
  }
}

// PROCESS AND PARSE INPUT DATA
// Reads the single paste box and auto-detects the format (edge list, adjacency
// list, DOT, or JSON). Returns { vertices:[{id,label}], edges:[[int,int]], format }.
// Throws GraphImportError (handled by the caller) on unparseable input.
function parseInput() {
  const raw = (document.getElementById('graph-input')?.value) || '';
  return parseGraphText(raw);
}

function buildSPQRNodes(spqrTree) {
  let pCounter = 1, sCounter = 1, rCounter = 1;
  const nodesSPQR = [];

  for (const c of spqrTree) {
    const label = c.type === 'P' ? 'P' + pCounter++ :
                  c.type === 'S' ? 'S' + sCounter++ :
                                   'R' + rCounter++;
    c.id = label;
    nodesSPQR.push({ id: label });
  }


  return nodesSPQR;
}

function buildSPQRLinks(spqrTree, nodesSPQR) {
  // Build lookup
  const idToComps = new Map();
  spqrTree.forEach((comp, idx) => {
    for (const [, id] of comp.virtualEdgeEntry) {
      if (!idToComps.has(id)) idToComps.set(id, []);
      idToComps.get(id).push(idx);
    }
  });

  // Produce links
  const linksSPQR = [];
  for (const arr of idToComps.values()) {
    if (arr.length < 2) continue;
    const src = nodesSPQR[arr[0]].id;
    for (let k = 1; k < arr.length; k++) {
      linksSPQR.push({ source: src, target: nodesSPQR[arr[k]].id });
    }
  }

  return linksSPQR;
}

function buildAdjacencyList(spqrTree, nodesSPQR, linksSPQR) {
  const adj = new Map();
  spqrTree.forEach((_, i) => adj.set(i, new Set()));

  for (const { source, target } of linksSPQR) {
    const srcIdx = nodesSPQR.findIndex(n => n.id === source);
    const tgtIdx = nodesSPQR.findIndex(n => n.id === target);

    if (srcIdx !== -1 && tgtIdx !== -1) {
      adj.get(srcIdx).add(tgtIdx);
      adj.get(tgtIdx).add(srcIdx);
    }
  }

  adj.forEach((nbrSet, idx) => {
    spqrTree[idx].neighbors = Array.from(nbrSet).map(i => nodesSPQR[i]);
  });
}

function assignVirtualEdgeColors(virtualEdgeData) {
  const compUsedColors = new Map();
  const n = virtualEdgeColorPalette.length;
  let globalIdx = 0;

  // Build adjacency map so we can exclude colors from neighboring components.
  const neighborMap = new Map();
  for (const [, edgeInfo] of virtualEdgeData) {
    const [a, b] = edgeInfo.components;
    if (!neighborMap.has(a)) neighborMap.set(a, new Set());
    if (!neighborMap.has(b)) neighborMap.set(b, new Set());
    neighborMap.get(a).add(b);
    neighborMap.get(b).add(a);
  }

  console.log(`[assignVirtualEdgeColors] Assigning colors to ${virtualEdgeData.size} virtual edge(s).`);

  for (const [edgeId, edgeInfo] of virtualEdgeData) {
    const [compIdA, compIdB] = edgeInfo.components;
    if (!compUsedColors.has(compIdA)) compUsedColors.set(compIdA, new Set());
    if (!compUsedColors.has(compIdB)) compUsedColors.set(compIdB, new Set());
    const usedA = compUsedColors.get(compIdA);
    const usedB = compUsedColors.get(compIdB);

    // Full exclusion set: colors used by A, B, and all their other neighbors.
    // This ensures no two adjacent components share a color except for their own shared edge.
    const excluded = new Set([...usedA, ...usedB]);
    for (const nb of (neighborMap.get(compIdA) ?? [])) {
      if (nb !== compIdB) compUsedColors.get(nb)?.forEach(c => excluded.add(c));
    }
    for (const nb of (neighborMap.get(compIdB) ?? [])) {
      if (nb !== compIdA) compUsedColors.get(nb)?.forEach(c => excluded.add(c));
    }

    let color = null;
    let relaxed = false;
    for (let i = 0; i < n; i++) {
      const c = virtualEdgeColorPalette[(globalIdx + i) % n];
      if (!excluded.has(c)) { color = c; globalIdx = (globalIdx + i + 1) % n; break; }
    }
    // Relax to just A and B when neighborhood constraint is unsatisfiable.
    if (color === null) {
      relaxed = true;
      for (let i = 0; i < n; i++) {
        const c = virtualEdgeColorPalette[(globalIdx + i) % n];
        if (!usedA.has(c) && !usedB.has(c)) { color = c; globalIdx = (globalIdx + i + 1) % n; break; }
      }
    }
    // Last resort: avoid conflict in A only.
    if (color === null) {
      for (let i = 0; i < n; i++) {
        const c = virtualEdgeColorPalette[(globalIdx + i) % n];
        if (!usedA.has(c)) { color = c; globalIdx = (globalIdx + i + 1) % n; break; }
      }
    }
    if (color === null) { color = virtualEdgeColorPalette[globalIdx]; globalIdx = (globalIdx + 1) % n; }

    edgeInfo.color = color;
    usedA.add(color);
    usedB.add(color);

    console.log(`[assignVirtualEdgeColors] Edge ${edgeId} (comp ${compIdA} ↔ comp ${compIdB}): ${color}${relaxed ? " [relaxed]" : ""} | excluded: [${[...excluded].join(", ")}]`);
  }

  console.log(`[assignVirtualEdgeColors] Done. Colors used per component:`);
  compUsedColors.forEach((colors, compId) =>
    console.log(`  comp ${compId}: [${[...colors].join(", ")}]`)
  );
}

function buildVirtualEdgeData(spqrTree) {
  const virtualEdgeData = new Map();

  for (const component of spqrTree) {
        component.isCollapsed = false;
    component.isSelected = false;
    component.isHovered = false;
    component.highlightedNodes = [];
    component.highlightedEdges = [];
    for (const virtualEdge of component.virtualEdgeEntry) {
      const edgeID = virtualEdge[1];
      const edgeNodes = virtualEdge[0];

      if (virtualEdgeData.has(edgeID)) {
        virtualEdgeData.get(edgeID).components.push(component.id);
      } else {
        virtualEdgeData.set(edgeID, {
          components: [component.id],
          nodes: edgeNodes
        });
      }
    }
  }

  // Filter to only twin edges (connecting exactly 2 components)
  for (const [key, value] of virtualEdgeData) {
    if (value.components.length !== 2) {
      virtualEdgeData.delete(key);
    }
  }

  // Build twin edge links array
  const allVirtualTwinEdgeLinks = [];
  for (const [, edgeInfoArray] of virtualEdgeData.entries()) {
    if (edgeInfoArray.components.length === 2) {
      allVirtualTwinEdgeLinks.push({
        compAID: edgeInfoArray.components[0],
        compBID: edgeInfoArray.components[1],
        u: edgeInfoArray.nodes[0],
        v: edgeInfoArray.nodes[1]
      });
    }
  }

  
  const componentVirtualEdgesMap = new Map();
virtualEdgeData.forEach((edgeData, edgeId) => {
  // For both components of this virtual edge
  edgeData.components.forEach(componentId => {
    // Initialize array if this component hasn't been seen yet
    if (!componentVirtualEdgesMap.has(componentId)) {
      componentVirtualEdgesMap.set(componentId, []);
    }
    
    // Add virtual edge data to this component's array
    componentVirtualEdgesMap.get(componentId).push({
      edgeId: edgeId,
      components: edgeData.components,
      endpoints: edgeData.nodes,
      otherComponent: edgeData.components.find(id => id !== componentId)
    });
  });
});
  assignVirtualEdgeColors(virtualEdgeData);
  return { virtualEdgeData, allVirtualTwinEdgeLinks, componentVirtualEdgesMap };
}

// Initialize zoom container for SPQR visualization

function initializeZoomContainer(canvas) {
  const svgMap = {
    input: elements.svgInput,
    spqr: elements.svgSPQR
  };
  const classMap = {
    input: ".input-components",
    spqr: ".spqr-component"
  };

  const chosenSVG = svgMap[canvas];
  if (!chosenSVG) {
    console.error(`Unknown canvas type: ${canvas}`);
    return null;
  }

  const containerId = `${canvas}-zoom-container`;
  let container = chosenSVG.select(`#${containerId}`);

  // Create container if missing
  if (container.empty()) {
    container = chosenSVG.append("g").attr("id", containerId);
  }

  // Remove any existing zoom behavior before applying new one
  chosenSVG.on(".zoom", null);

  // Always set up zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .filter(event => {
      // Disable zoom if in draw or delete mode
      if (state.ui_state.drawMode || state.ui_state.deleteMode) {
        return false;
      }
      // Always allow wheel (scroll-to-zoom) events, even on components
      if (event.type === "wheel") return true;
      // Block mousedown-based panning on components so drag still works
      return !event.target.closest(classMap[canvas]);
    })
    .on("zoom", (event) => {
      container.attr("transform", event.transform);
      const k = event.transform.k;
      const sk = Math.sqrt(k);
      // Counter-scale circles (radius).
      // SPQR canvas: divide by k (full counter-scale → constant visual size).
      // Input canvas: divide by sqrt(k) (nodes grow slightly with zoom as visual cue).
      const circleScale = canvas === "spqr" ? k : sk;
      container.selectAll("circle").each(function() {
        const el = d3.select(this);
        if (canvas === "input" && el.classed("input-node")) {
          el.attr("r", getInputNodeRadius(el.datum(), k));
          return;
        }
        let baseR = parseFloat(el.attr("data-base-r"));
        if (!isFinite(baseR)) {
          baseR = parseFloat(el.attr("r")) || 10;
          el.attr("data-base-r", baseR);
        }
        el.attr("r", baseR / circleScale);
      });
      // Counter-scale text labels
      container.selectAll("text").each(function() {
        const el = d3.select(this);
        let baseFS = parseFloat(el.attr("data-base-fs"));
        if (!isFinite(baseFS)) {
          baseFS = parseFloat(el.style("font-size")) || 12;
          el.attr("data-base-fs", baseFS);
        }
        el.style("font-size", (baseFS / sk) + "px");
      });
      // Counter-scale stroke-widths on lines, paths, rects, circles
      container.selectAll("line, path, rect, circle").each(function() {
        const el = d3.select(this);
        let baseSW = parseFloat(el.attr("data-base-sw"));
        if (!isFinite(baseSW)) {
          baseSW = parseFloat(el.attr("stroke-width"));
          if (!isFinite(baseSW)) baseSW = parseFloat(el.style("stroke-width")) || 2;
          el.attr("data-base-sw", baseSW);
        }
        el.attr("stroke-width", baseSW / sk);
      });
      // Counter-scale dash arrays
      container.selectAll("[stroke-dasharray]").each(function() {
        const el = d3.select(this);
        let baseDash = el.attr("data-base-dash");
        if (!baseDash) {
          baseDash = el.attr("stroke-dasharray");
          el.attr("data-base-dash", baseDash);
        }
        el.attr("stroke-dasharray", baseDash.split(",").map(v => parseFloat(v) / sk).join(","));
      });
      // Recompute input graph edge endpoints so they stay at the counter-scaled radius
      if (canvas === "input" && state.d3selections.linkInput) {
        applyInputEdgeGeometry(state.d3selections.linkInput, state.data.edgeRoutes);
        if (state.d3selections.linkInputVisible) {
          applyInputEdgeGeometry(state.d3selections.linkInputVisible, state.data.edgeRoutes);
        }
      }
    });

  chosenSVG.call(zoom);
  // Store zoom behavior for programmatic transforms
  if (canvas === "spqr") {
    zoomBehaviors.spqr = zoom;
  } else if (canvas === "input") {
    zoomBehaviors.input = zoom;
  }
  // Reset the SVG's accumulated zoom state to identity so that
  // getInputNodeRadius() (which reads __zoom.k) returns the correct value
  // of 10 for the new graph.  Without this, a stale k from the previous
  // graph causes edge endpoints to be computed with the wrong node radius,
  // making some edges appear reversed / crossing (visually non-planar).
  // The zoom-to-fit (zoomToFitInputGraphToRegion) sets the real zoom afterwards.
  chosenSVG.call(zoom.transform, d3.zoomIdentity);
  
  // Disable double-click zoom 

    chosenSVG.on("dblclick.zoom", null);


  return container;
}

// Helper function to zoom/fit the SPQR graph to the canvas
function zoomToFitSPQRGraph() {
  const svg = elements.svgSPQR.node();
  if (!svg || !state.d3selections.nodeSPQR) {
    console.error("❌ zoomToFitSPQRGraph: SVG or nodeSPQR selection missing");
    return;
  }

  console.log("🔍 zoomToFitSPQRGraph START");
  console.log("  SVG clientWidth:", svg.clientWidth);
  console.log("  SVG clientHeight:", svg.clientHeight);
  
  // BEFORE ZOOM: Log current transform
  const beforeTransform = SPQRZoomContainer.attr("transform");
  console.log("  BEFORE - SPQRZoomContainer transform:", beforeTransform);
  
  // Reset transform to identity first to ensure clean state, using zoom behavior if available
  if (zoomBehaviors.spqr) {
    elements.svgSPQR.call(zoomBehaviors.spqr.transform, d3.zoomIdentity);
    console.log("  RESET - via zoom behavior to identity");
  } else {
    SPQRZoomContainer.attr("transform", "translate(0,0) scale(1)");
    console.log("  RESET - SPQRZoomContainer transform to identity (fallback)");
  }
  
  // BEFORE ZOOM: Log all node positions
  console.log("  BEFORE - Node positions:");
  state.d3selections.nodeSPQR.each(d => {
    console.log(`    ${d.id}: (${d.x.toFixed(2)}, ${d.y.toFixed(2)})`);
  });

  // Get bounds of all nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let nodeCount = 0;
  
  state.d3selections.nodeSPQR.each(d => {
    if (!isFinite(d.x) || !isFinite(d.y)) {
      console.warn(`  ⚠️ Node ${d.id} has invalid coordinates!`);
      return;
    }
    minX = Math.min(minX, d.x - 10); // 10 is node radius
    minY = Math.min(minY, d.y - 10);
    maxX = Math.max(maxX, d.x + 10);
    maxY = Math.max(maxY, d.y + 10);
    nodeCount++;
  });

  console.log(`  Processed ${nodeCount} nodes`);
  console.log(`  Bounds: minX=${minX.toFixed(2)}, minY=${minY.toFixed(2)}, maxX=${maxX.toFixed(2)}, maxY=${maxY.toFixed(2)}`);

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    console.error("❌ Could not calculate finite bounds for SPQR graph");
    return;
  }

  const width = svg.clientWidth || 1000;
  const height = svg.clientHeight || 1000;
  // Leave 15% margin on each side (i.e., 30% total), feels less claustrophobic
  const paddingX = width * 0.15;
  const paddingY = height * 0.15;

  console.log(`  Canvas dimensions: ${width}x${height}, PaddingX: ${paddingX.toFixed(2)}, PaddingY: ${paddingY.toFixed(2)}`);

  const fullWidth = maxX - minX;
  const fullHeight = maxY - minY;

  console.log(`  Graph dimensions: ${fullWidth.toFixed(2)}x${fullHeight.toFixed(2)}`);

  const scale = Math.min(
    (width - 2 * paddingX) / fullWidth,
    (height - 2 * paddingY) / fullHeight
  );

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const translateX = width / 2 - centerX * scale;
  const translateY = height / 2 - centerY * scale;

  console.log(`  Scale: ${scale.toFixed(4)}`);
  console.log(`  Graph center: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);
  console.log(`  Canvas center: (${(width/2).toFixed(2)}, ${(height/2).toFixed(2)})`);
  console.log(`  Translate: (${translateX.toFixed(2)}, ${translateY.toFixed(2)})`);
  console.log(`  New transform will be: translate(${translateX.toFixed(2)},${translateY.toFixed(2)}) scale(${scale.toFixed(4)})`);

  // Apply transform using zoom behavior when possible (keeps internal zoom state in sync)
  const targetTransform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
  if (zoomBehaviors.spqr) {
    elements.svgSPQR.call(zoomBehaviors.spqr.transform, targetTransform);
  } else {
    SPQRZoomContainer.attr("transform", `translate(${translateX},${translateY}) scale(${scale})`);
  }
  
  // AFTER ZOOM: Log what was applied
  const afterTransform = SPQRZoomContainer.attr("transform");
  console.log("  AFTER - SPQRZoomContainer transform:", afterTransform);
  console.log("✅ zoomToFitSPQRGraph END - zoom applied");
}

/**
 * Zoom/fit the input graph canvas so that all node positions are visible.
 */
function zoomToFitInputGraphFromPositions(positions) {
  const svg = elements.svgInput.node();
  if (!svg) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    if (!isFinite(x) || !isFinite(y)) continue;
    minX = Math.min(minX, x - 15);
    minY = Math.min(minY, y - 15);
    maxX = Math.max(maxX, x + 15);
    maxY = Math.max(maxY, y + 15);
  }
  if (!isFinite(minX)) return;

  const width = svg.clientWidth || 1000;
  const height = svg.clientHeight || 1000;
  const paddingX = width * 0.1;
  const paddingY = height * 0.1;

  const scale = Math.min(
    (width - 2 * paddingX) / (maxX - minX || 1),
    (height - 2 * paddingY) / (maxY - minY || 1)
  );

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const translateX = width / 2 - centerX * scale;
  const translateY = height / 2 - centerY * scale;

  const targetTransform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
  if (zoomBehaviors.input) {
    elements.svgInput.call(zoomBehaviors.input.transform, targetTransform);
  } else {
    InputZoomContainer.attr("transform", `translate(${translateX},${translateY}) scale(${scale})`);
  }
}

/**
 * Fit the input-graph viewport to a fixed region [rx, ry, rw, rh] (in graph
 * coordinates) rather than to the tight bounding box of the vertices.
 *
 * The SPQR drawing algorithm draws the whole graph inside the root region
 * [0,0,canvasW,canvasH], so fitting to that region guarantees every vertex is
 * visible and keeps the framing stable across embeddings/flips (whose vertex
 * bounding boxes vary). A small padding keeps vertices off the SVG border.
 */
function zoomToFitInputGraphToRegion(rx, ry, rw, rh) {
  const svg = elements.svgInput.node();
  if (!svg || !(rw > 0) || !(rh > 0)) return;

  const width = svg.clientWidth || 1000;
  const height = svg.clientHeight || 1000;
  const paddingX = width * 0.05;
  const paddingY = height * 0.05;

  const scale = Math.min(
    (width - 2 * paddingX) / rw,
    (height - 2 * paddingY) / rh
  );

  const centerX = rx + rw / 2;
  const centerY = ry + rh / 2;
  const translateX = width / 2 - centerX * scale;
  const translateY = height / 2 - centerY * scale;

  const targetTransform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
  if (zoomBehaviors.input) {
    elements.svgInput.call(zoomBehaviors.input.transform, targetTransform);
  } else {
    InputZoomContainer.attr("transform", `translate(${translateX},${translateY}) scale(${scale})`);
  }
}

// FUNCTIONS TO HANDLE DRAWING AND BUILDING INPUT AND SPQR GRAPH

/**
 * Modified refreshInputGraph to trigger smart SPQR redraw
 */
function refreshInputGraph() {
  console.log("Refreshing input graph...");
  
  // Stop current simulation
  if (state.simulation.input) {
    state.simulation.input
      .force("link", null)
      .force("charge", null)
      .force("center", null)
      .force("collision", null);
    state.simulation.input.stop();
  }

  // Update links based on current edges
  const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
  state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
    source: idToNode[String(s)],
    target: idToNode[String(t)]
  }));

  // Use smooth refresh to properly update the graph
  refreshInputGraphSmooth();
}



function refreshInputGraphSmooth() {
  
  // Helper to calculate edge endpoints at node radius (counter-scaled)
  function getEdgeEndpoints(source, target) {
    return getStraightEdgeEndpoints(source, target);
  }
  
  // Helper functions first
  function updatePositions() {
    // DIAG: log d.x/d.y and current cx/cy before setting
    console.log("[updatePositions] node count:", state.d3selections.nodeInput.size());
    state.d3selections.nodeInput.each(function(d) {
      console.log(`  node ${d.id}: d.x=${d.x?.toFixed(1)} d.y=${d.y?.toFixed(1)}  current cx=${d3.select(this).attr("cx")}`);
    });

    state.d3selections.nodeInput
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    state.d3selections.labelInput
      .attr("x", d => d.x + 12)
      .attr("y", d => d.y + 4);

    updateEdgePositions();
  }

  function updateEdgePositions() {
    // Update hit areas
    state.d3selections.linkInput.each(function(d) {
      const endpoints = getEdgeEndpoints(d.source, d.target);
      d3.select(this)
        .attr("x1", endpoints.x1)
        .attr("y1", endpoints.y1)
        .attr("x2", endpoints.x2)
        .attr("y2", endpoints.y2);
    });
    
    // Update visible edges
    if (state.d3selections.linkInputVisible) {
      state.d3selections.linkInputVisible.each(function(d) {
        const endpoints = getEdgeEndpoints(d.source, d.target);
        d3.select(this)
          .attr("x1", endpoints.x1)
          .attr("y1", endpoints.y1)
          .attr("x2", endpoints.x2)
          .attr("y2", endpoints.y2);
      });
    }
  }

  // === LINKS === (Create edges FIRST so they render behind nodes)
  // First, remove ALL existing edges (both with and without classes) to avoid duplicates
  InputZoomContainer.selectAll("line").remove();
  
  // Now create visible edges
  const visibleLinkSel = InputZoomContainer
    .selectAll(".edge-visible")
    .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`);
  
  visibleLinkSel.exit().remove();
  
  const inputK = Math.sqrt(d3.zoomTransform(elements.svgInput.node()).k);
  const visibleLinkEnter = visibleLinkSel.enter()
    .append("line")
    .attr("class", "edge-visible")
    .attr("stroke-opacity", 0.6)
    .attr("stroke", "#999")
    .attr("data-base-sw", 2)
    .attr("stroke-width", 2 / inputK)
    .style("pointer-events", "none");
  
  const visibleLinks = visibleLinkSel.merge(visibleLinkEnter);
  
  // Store reference to visible edges for updates
  state.d3selections.linkInputVisible = visibleLinks;
  
  // Update positions for visible edges (at node radius, not center)
  visibleLinks.each(function(d) {
    const endpoints = getEdgeEndpoints(d.source, d.target);
    d3.select(this)
      .attr("x1", endpoints.x1)
      .attr("y1", endpoints.y1)
      .attr("x2", endpoints.x2)
      .attr("y2", endpoints.y2);
  });

  // Then, handle hit areas (on top of visible edges)
  const linkSel = InputZoomContainer
    .selectAll(".edge-hit-area")
    .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`);

  linkSel.exit().remove();

  const linkEnter = linkSel.enter()
    .append("line")
    .attr("class", "edge-hit-area")
    .attr("stroke", "transparent")
    .attr("data-base-sw", 15)
    .attr("stroke-width", 15 / inputK)
    .style("cursor", "pointer");

  // Update linkInput selection to contain all edge hit areas
  state.d3selections.linkInput = linkSel.merge(linkEnter);
  
  // Update positions for hit areas (at node radius, not center)
  state.d3selections.linkInput.each(function(d) {
    const endpoints = getEdgeEndpoints(d.source, d.target);
    d3.select(this)
      .attr("x1", endpoints.x1)
      .attr("y1", endpoints.y1)
      .attr("x2", endpoints.x2)
      .attr("y2", endpoints.y2);
  });

  // === NODES === (Create nodes AFTER edges so they render on top)
  const nodeSel = InputZoomContainer
    .selectAll(".input-node")
    .data(state.data.graphNodes, d => d.id);


  nodeSel.exit().remove();

  const nodeEnter = nodeSel.enter()
    .append("circle")
    .attr("class", "input-node")
    .attr("data-node-id", d => d.id)
    .attr("data-base-r", 10)
    .attr("r", d => getInputNodeRadius(d))
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .style("fill", "steelblue")
    .attr("stroke", "#fff")
    .attr("stroke-width", "1.5px")
    .call(d3.drag()
      .on("start", function(event, d) {
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", function(event, d) {
        d.fx = event.x;
        d.fy = event.y;
        d.x = event.x;
        d.y = event.y;
        updateEdgePositions();
      })
      .on("end", function(event, d) {
        d.fx = null;
        d.fy = null;
      }));

  state.d3selections.nodeInput = nodeSel.merge(nodeEnter)
    .attr("r", d => getInputNodeRadius(d));
  state.d3selections.nodeInput.raise(); // ensure nodes are above edge hit areas in z-order

  // === LABELS === (Create labels LAST so they're always on top)
  // Scope to .input-label so the keyed data-join never picks up unrelated
  // <text> elements that also live inside InputZoomContainer (e.g. the
  // region-overlay labels added by "Draw from SPQR"). Those have no node
  // datum, so a bare selectAll("text") join would call the d => d.id key on
  // an undefined datum and throw, aborting the refresh before labels and drag
  // handlers are (re)attached — which is why a node added after Draw from SPQR
  // had no label and could not be dragged.
  const labelSel = InputZoomContainer
    .selectAll("text.input-label")
    .data(state.data.graphNodes, d => d.id);


  labelSel.exit().remove();

  const labelEnter = labelSel.enter()
    .append("text")
    .attr("class", "input-label")
    .attr("data-base-fs", 12)
    .style("font-size", (12 / inputK) + "px")
    .attr("x", 12)
    .attr("y", ".31em")
    .text(d => d.id);

  state.d3selections.labelInput = labelSel.merge(labelEnter);
  if (!state.ui_state.inputLabelsVisible) {
    state.d3selections.labelInput.style("display", "none");
  }

  // Setup event handlers for nodes and edges
  setupInputEventHandlers();
    
  // Update the simulation with new data
  if (state.simulation.input) {
    state.simulation.input.nodes(state.data.graphNodes);
    if (state.simulation.input.force("link")) {
      state.simulation.input.force("link").links(state.data.graphLinks);
    } else {
      console.warn("⚠️ No link force found in simulation");
    }
  } else {
    console.warn("⚠️ No input simulation found");
  }

  // Update positions directly
  updatePositions();

  // Re-establish event handlers
  setupInputEventHandlers();
  
  console.log("✅ REFRESH COMPLETE");
}


// Add these drag event handlers
function dragstarted(event, d) {
  if (!event.active) state.simulation.input.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) state.simulation.input.alphaTarget(0);
  if (!state.ui_state.drawMode) {
    d.fx = null;
    d.fy = null;
  }
}

function getInputGraphPos(event) {
  // event is a D3 event from the input SVG
  const svg = elements.svgInput.node();
  const p = d3.pointer(event, svg);              // screen coords relative to SVG
  const zt = d3.zoomTransform(svg);              // current zoom/pan transform
  const [x, y] = zt.invert(p);                   // map to graph coords
  return { x, y };
}

function setupInputEventHandlers() {
  // Remove any existing event handlers first
  state.d3selections.nodeInput
    .on("mouseover", null)
    .on("mouseout", null)
    .call(d3.drag().on("start", null).on("drag", null).on("end", null));

  // Clear edge event handlers
  state.d3selections.linkInput
    .on("mouseover", null)
    .on("mouseout", null);

  // Track if a node drag is in progress to suppress hover events
  let isDraggingNode = false;

  // Mouse hover events for cross-highlighting
  state.d3selections.nodeInput
    .on("mouseover", (evt, d) => {
      // Skip hover highlighting while dragging or for selected components
      const selectedComp = state.data.spqrTree?.find(comp => 
        comp.isSelected && comp.graph.has(parseInt(d.id))
      );
      console.log(`MOUSEOVER node ${d.id}: isDraggingNode=${isDraggingNode}, selectedComp=${selectedComp?.id}`);
      if (isDraggingNode) {
        console.log(`  -> Skipped (isDraggingNode=true)`);
        return;
      }
      
      if (!selectedComp) {
        console.log(`  -> Calling handleMouseOverInput`);
        handleMouseOverInput(evt, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR);
      } else {
        console.log(`  -> Skipped (node belongs to selected component)`);
      }
    })
    .on("mouseout", (evt, d) => {
      // Skip unhighlighting while dragging or for selected components
      const selectedComp = state.data.spqrTree?.find(comp => 
        comp.isSelected && comp.graph.has(parseInt(d.id))
      );
      console.log(`MOUSEOUT node ${d.id}: isDraggingNode=${isDraggingNode}, selectedComp=${selectedComp?.id}`);
      if (isDraggingNode) {
        console.log(`  -> Skipped (isDraggingNode=true)`);
        return;
      }
      // Keep the edge-start node highlighted while drawing an edge
      if (state.ui_state.drawMode && state.ui_state.edgeStart === d.id) {
        return;
      }
      if (!selectedComp) {
        console.log(`  -> Calling handleMouseOutInput`);
        handleMouseOutInput(evt, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR);
      } else {
        console.log(`  -> Skipped (node belongs to selected component)`);
      }
    });

  // Add edge hover events
  state.d3selections.linkInput
    .on("mouseover", (evt, d) => handleMouseOverEdgeInput(evt, d, state.d3selections.nodeInput, state.d3selections.linkInput))
    .on("mouseout", (evt, d) => handleMouseOutEdgeInput(evt, d, state.d3selections.nodeInput, state.d3selections.linkInput));


  // Add drag behavior to all nodes
  const dragBehavior = d3.drag()
    .on("start", function(event, d) {
      // Stop any running embedding animation immediately. The timer fires every
      // rAF and resets cx/cy to animated positions, overriding drag updates.
      stopEmbeddingAnimation();
      // Set flag to suppress mouseover/mouseout during drag
      isDraggingNode = true;
      console.log(`DRAG START node ${d.id}: isDraggingNode set to true`);
      // Pin the node in place - no need to restart the simulation
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", function(event, d) {
      d.fx = event.x;
      d.fy = event.y;
      d.x = event.x;
      d.y = event.y;

      // Update node position visually
      d3.select(this)
        .attr("cx", d.x)
        .attr("cy", d.y);

      // Update label position
      state.d3selections.labelInput
        .filter(label => label.id === d.id)
        .attr("x", d.x + 12)
        .attr("y", d.y + 4);
      
      applyInputEdgeGeometry(state.d3selections.linkInput, state.data.edgeRoutes);
      if (state.d3selections.linkInputVisible) {
        applyInputEdgeGeometry(state.d3selections.linkInputVisible, state.data.edgeRoutes);
      }

      // Update temporary-edge overlays (virtual edge highlights with no real backing edge).
      // Their datums hold references to the same node objects as the main simulation,
      // so source.x / target.x are already current after the position update above.
      // applyInputEdgeGeometry already handles dashed .edge-visible elements (real edges).
      InputZoomContainer.selectAll(".temporary-edge").each(function(edge) {
        if (!edge || !edge.source || !edge.target) return;
        d3.select(this)
          .attr("x1", edge.source.x)
          .attr("y1", edge.source.y)
          .attr("x2", edge.target.x)
          .attr("y2", edge.target.y);
      });

      // If this node is part of a selected component, maintain highlighting during drag
      const selectedComp = state.data.spqrTree?.find(comp => 
        comp.isSelected && comp.graph.has(parseInt(d.id))
      );
      if (selectedComp) {
        d3.select(this).classed("highlighted", true);
        // Apply the highlight color based on component type
        const highlightColor = selectedComp.type === "R" ? "red" : 
                              selectedComp.type === "S" ? "green" : 
                              "blue";
        d3.select(this).style("fill", highlightColor);
      }
    })
    .on("end", function(event, d) {
      console.log(`DRAG END node ${d.id}: isDraggingNode set to false`);
      // Clear the drag flag
      isDraggingNode = false;
      
      if (!event.active && state.simulation.input) {
        state.simulation.input.alphaTarget(0);
      }
      // Keep the node fixed at its current position after dragging
      d.fx = d.x;
      d.fy = d.y;
      
      // Reapply highlight if this node belongs to a selected component
      const selectedComp = state.data.spqrTree?.find(comp => 
        comp.isSelected && comp.graph.has(parseInt(d.id))
      );
      console.log(`DRAG END highlighting node ${d.id}: selectedComp=${selectedComp?.id}`);
      if (selectedComp) {
        d3.select(this).classed("highlighted", true);
        const highlightColor = selectedComp.type === "R" ? "red" : 
                              selectedComp.type === "S" ? "green" : 
                              "blue";
        d3.select(this).style("fill", highlightColor);
        console.log(`  -> Applied color: ${highlightColor}`);
      }
      
      storeInputNodePositions();
      refreshSPQRPictograms();
    });

  state.d3selections.nodeInput.call(dragBehavior);
}



  function clearBothGraphs() {
  console.log("Clearing both graphs");
  
  // Stop any running simulations first
  if (state.simulation.input) {
    state.simulation.input.stop();
  }
  if (state.simulation.spqr) {
    state.simulation.spqr.stop();
  }
  
  // Clear the graphs
  clearGraph(elements.svgInput);
  clearGraph(elements.svgSPQR);
  
  // Clear any zoom containers
  elements.svgInput.selectAll("g").remove();
  elements.svgSPQR.selectAll("g").remove();
  
  // Remove any temporary elements
  elements.svgInput.selectAll(".temporary-edge").remove();
  elements.svgSPQR.selectAll(".temporary-edge").remove();
  
  // Reinitialize zoom containers after clearing
  InputZoomContainer = initializeZoomContainer("input");
  SPQRZoomContainer = initializeZoomContainer("spqr");
  
  console.log("Graphs cleared");
}

function drawInputGraph(nodes = state.data.graphNodes, edges = state.data.graphEdges, presetType = null, runSimulation = false) {
  console.log("Setting graph with nodes:", nodes, "edges:", edges, "preset:", presetType);
  
  try {
    state.data.graphEdges = edges.map(e => [...e]); // Deep copy edges
    state.data.presetType = presetType;
    state.data.graphNodes = nodes.map(v => 
      typeof v === "object" ? {...v, id: String(v.id)} : { id: String(v) }
    );

    state.data.originalGraphEdges = edges.map(e => [...e]); 
    
    const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));

    state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
      source: idToNode[String(s)],
      target: idToNode[String(t)]
    }));

    console.log("Processed nodes:", state.data.graphNodes);
    console.log("Processed links:", state.data.graphLinks);

     InputZoomContainer = initializeZoomContainer("input");

    const result = createPresetGraph(
      InputZoomContainer,
      state.data.graphNodes,
      state.data.graphLinks,
      undefined,
      undefined,
      presetType,
      runSimulation
    );
    
    if (!result) {
      throw new Error("createPresetGraph returned null");
    }
    
    state.simulation.input = result.simulation;
    state.d3selections.nodeInput = result.nodeSel;
    state.d3selections.linkInput = result.linkSel;
    state.d3selections.linkInputVisible = result.visibleLinkSel;
    state.d3selections.labelInput = result.labelSel;
    if (!state.ui_state.inputLabelsVisible) {
      state.d3selections.labelInput.style("display", "none");
    }

    // Use the centralized event handler setup
    setupInputEventHandlers();

    updateInputActionButtons();
    console.log("Graph setup complete");
  } catch (error) {
    console.error("Error in setGraph:", error);
    // Reset state if there's an error
    resetState();
  }
}

/**
 * Draw the input graph using positions computed from the SPQR decomposition.
 * This replaces the force-directed layout with a composed embedding that
 * respects the tree structure: R → Tutte, S → ellipse, P → lanes.
 */
let _drawCallCount = 0;
const _diagLog = [];
window.downloadDiagLog = () => {
  const blob = new Blob([_diagLog.join('\n\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diag.log';
  a.click();
};
function drawInputGraphFromSPQR({ preserveZoom = false, animate = false } = {}) {
  const callId = ++_drawCallCount;
  console.log(`🎨 [draw#${callId}] drawInputGraphFromSPQR animate=${animate} preserveZoom=${preserveZoom} timerRunning=${_embeddingAnimTimer != null}`);

  stopEmbeddingAnimation();

  const oldPositions = animate && state.d3selections.nodeInput
    ? new Map(state.d3selections.nodeInput.data().map(d => [d.id, { x: d.x, y: d.y }]))
    : null;

  const root = state.data.spqrRoot;
  const tree = state.data.spqrTree;
  const vedData = state.data.virtualEdgeData;
  const canvasW = state.ui.canvasWidth;
  const canvasH = state.ui.canvasHeight;

  // Preserve the displayed root orientation when composing the graph. This is
  // especially important for the labelled tutorial examples: a root P-node
  // must not let Map insertion order exchange its poles, and a root S-cycle
  // should retain its familiar clockwise direction.
  let rootPoleOrder = null;
  const rootReferencePositions = new Map();
  for (const id of root?.graph?.keys?.() || []) {
    const circle = elements.svgInput.select(`circle.input-node[data-node-id='${id}']`);
    if (circle.empty()) continue;
    const x = Number(circle.attr('cx'));
    const y = Number(circle.attr('cy'));
    if (Number.isFinite(x) && Number.isFinite(y)) {
      rootReferencePositions.set(id, { x, y });
    }
  }
  if (root?.type === 'P') {
    const poleIds = [...root.graph.keys()];
    if (poleIds.length >= 2) {
      const displayedPoint = id => {
        const circle = elements.svgInput.select(`circle.input-node[data-node-id='${id}']`);
        if (circle.empty()) return null;
        const x = Number(circle.attr('cx'));
        const y = Number(circle.attr('cy'));
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      };
      const [a, b] = poleIds;
      const pointA = displayedPoint(a);
      const pointB = displayedPoint(b);
      if (pointA && pointB) {
        const aComesFirst = pointA.y < pointB.y
          || (Math.abs(pointA.y - pointB.y) < 1e-6 && pointA.x <= pointB.x);
        rootPoleOrder = aComesFirst ? [a, b] : [b, a];
      }
    }
  }

  // Log SPQR tree component embedding state before computing drawing
  {
    const flipStates = (tree || []).map(c => `${c.id}(${c.type}):flip=${!!c.embeddingFlip}`).join(', ');
    console.log(`[draw#${callId}] SPQR flip states: ${flipStates}`);
  }

  try {
    const {
      positions,
      edges,
      tree: composedTree,
      regions,
      edgeRoutes,
      componentPoses
    } = computeGraphDrawing(
      root, tree, vedData, canvasW, canvasH, {
        rootPoleOrder,
        rootReferencePositions
      }
    );

    // Log ALL computed positions so we can compare call 1 vs call 2
    const posFull = Array.from(positions.entries()).map(([id, p]) => `v${id}=(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    console.log(`[draw#${callId}] computeGraphDrawing ALL positions: ${posFull.join('  ')}`);

    // Build newPositions using the same d.id key so the animation has an
    // explicit, reliable target and never has to fall back on d.fx.
    const newPositions = oldPositions && state.d3selections.nodeInput
      ? new Map(state.d3selections.nodeInput.data().map(d => {
          const pos = positions.get(Number(d.id));
          return pos ? [d.id, { x: pos.x, y: pos.y }] : null;
        }).filter(Boolean))
      : null;

    state.data.edgeRoutes = edgeRoutes || new Map();
    state.data.componentPoses = componentPoses || new Map();
    state.data.composedDrawing = {
      positions: new Map(
        [...positions].map(([id, point]) => [id, { x: point.x, y: point.y }])
      ),
      tree: composedTree,
      regions,
      edgeRoutes: state.data.edgeRoutes,
      componentPoses: state.data.componentPoses
    };

    console.log(`[draw#${callId}] positions.size=${positions.size} edges=${edges.length}`);

    // ── Draw allocated region overlays ───────────────────────
    const zoomContainer = elements.svgInput.select("#input-zoom-container");
    zoomContainer.selectAll(".region-overlay-group").remove();
    // Reset checkbox + close panel whenever a fresh drawing is produced
    const _trCheck = document.getElementById('toggle-regions-check');
    if (_trCheck) _trCheck.checked = false;
    const _rpanel = document.getElementById('regions-panel');
    if (_rpanel) _rpanel.style.display = 'none';
    if (regions && regions.length > 0) {
      const regionGroup = zoomContainer.insert("g", ":first-child")
        .attr("class", "region-overlay-group")
        .style("display", "none");

      const typeColors = {
        P: "rgba(70,130,230,0.12)",
        S: "rgba(50,180,80,0.12)",
        R: "rgba(200,100,50,0.10)",
        // legacy keys kept for safety
        wing: "rgba(70,130,230,0.12)",
        square: "rgba(70,130,230,0.12)",
        triangle: "rgba(50,180,80,0.12)",
        cone: "rgba(200,100,50,0.06)",
      };
      const typeStrokes = {
        P: "rgba(70,130,230,0.5)",
        S: "rgba(50,180,80,0.5)",
        R: "rgba(200,100,50,0.45)",
        // legacy
        wing: "rgba(70,130,230,0.5)",
        square: "rgba(70,130,230,0.5)",
        triangle: "rgba(50,180,80,0.5)",
        cone: "rgba(200,100,50,0.35)",
      };

      for (const region of regions) {
        const lbl = region.label || '';
        // Outer-face vertices used as Tutte boundary constraints
        if (region.type === 'outer-face-vertex' && region.point) {
          const g = regionGroup.append("g");
          g.append("circle")
            .attr("cx", region.point.x)
            .attr("cy", region.point.y)
            .attr("r", 6)
            .attr("data-base-r", 6)
            .attr("data-label", lbl)
            .attr("fill", "rgba(255,180,0,0.85)")
            .attr("stroke", "rgba(180,100,0,1)")
            .attr("stroke-width", 1.5)
            .attr("data-base-sw", 1.5);
          g.append("text")
            .attr("x", region.point.x)
            .attr("y", region.point.y - 9)
            .attr("text-anchor", "middle")
            .attr("font-size", 10)
            .attr("fill", "rgba(140,70,0,1)")
            .attr("pointer-events", "none")
            .text(lbl);
          continue;
        }

        // Cone intersection points are rendered as circles, not polygons
        if (region.type === 'cone-intersection' && region.point) {
          regionGroup.append("circle")
            .attr("cx", region.point.x)
            .attr("cy", region.point.y)
            .attr("r", 4)
            .attr("data-base-r", 4)
            .attr("data-label", lbl)
            .attr("fill", "rgba(200,50,50,0.8)")
            .attr("stroke", "rgba(150,30,30,1)")
            .attr("stroke-width", 1)
            .attr("data-base-sw", 1);
          continue;
        }

        const pts = region.points.map(p => `${p.x},${p.y}`).join(" ");
        regionGroup.append("polygon")
          .attr("points", pts)
          .attr("data-label", lbl)
          .attr("fill", typeColors[region.type] || "rgba(128,128,128,0.10)")
          .attr("stroke", typeStrokes[region.type] || "rgba(128,128,128,0.4)")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", region.type === "cone" ? "6,3" : "none")
          .attr("data-base-sw", 1)
          .attr("data-base-dash", region.type === "cone" ? "6,3" : null);

        // Label at centroid of the region (skip empty labels)
        if (region.label) {
          const cx = region.points.reduce((s, p) => s + p.x, 0) / region.points.length;
          const cy = region.points.reduce((s, p) => s + p.y, 0) / region.points.length;
          const labelColor = region.type === 'P' ? "rgba(40,90,200,0.7)"
                           : region.type === 'S' ? "rgba(30,140,50,0.7)"
                           : "rgba(160,70,30,0.7)";
          regionGroup.append("text")
            .attr("x", cx)
            .attr("y", cy)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-size", 11)
            .attr("data-base-fs", 11)
            .attr("data-label", lbl)
            .attr("fill", labelColor)
            .attr("pointer-events", "none")
            .text(region.label);
        }
      }

      // Rebuild the per-region filter panel
      if (window._buildRegionsPanel) window._buildRegionsPanel(regions);
    }

    // Update the input graph node positions with the SPQR-derived ones
    if (state.d3selections.nodeInput) {
      // Stop the simulation if one exists (preset graphs with fixed
      // positions and user-drawn graphs may not have a simulation)
      if (state.simulation.input) {
        state.simulation.input.stop();
        state.simulation.input
          .force("link", null)
          .force("charge", null)
          .force("center", null)
          .force("collision", null);
      }

      // Apply the new positions to D3 nodes
      state.d3selections.nodeInput.each(function(d) {
        const pos = positions.get(Number(d.id));
        if (pos) {
          d.x = pos.x;
          d.y = pos.y;
          d.fx = pos.x;  // Pin positions
          d.fy = pos.y;
        } else {
          console.warn(`No SPQR position for vertex ${d.id}`);
        }
      });

      // Log actual d.x/d.y values after applying positions
      {
        const nodeSample = state.d3selections.nodeInput.data().slice(0, 5)
          .map(d => `v${d.id}=(${d.x?.toFixed(1)},${d.y?.toFixed(1)})`);
        console.log(`[draw#${callId}] node data after apply: ${nodeSample.join('  ')}`);
      }

      // Update visual positions — nodes
      state.d3selections.nodeInput
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", d => getInputNodeRadius(d));

      // Log actual cx/cy in DOM after setting
      {
        const domSample = [];
        state.d3selections.nodeInput.each(function(d) {
          if (domSample.length < 5)
            domSample.push(`v${d.id}=(${d3.select(this).attr("cx")},${d3.select(this).attr("cy")})`);
        });
        console.log(`[draw#${callId}] DOM cx/cy after attr set: ${domSample.join('  ')}`);
      }

      rebuildInputEdgeSelections(state.data.edgeRoutes);
      console.log(`[draw#${callId}] rebuildInputEdgeSelections done`);
      setupInputEventHandlers();

      // Update visual positions — edges (both hit-area and visible)
      applyInputEdgeGeometry(state.d3selections.linkInput, state.data.edgeRoutes);
      applyInputEdgeGeometry(state.d3selections.linkInputVisible, state.data.edgeRoutes);

      // Update labels
      state.d3selections.labelInput
        .attr("x", d => d.x + 12)
        .attr("y", d => d.y + 4);

      // Update stored positions
      storeInputNodePositions();
      refreshSPQRPictograms();

      // Zoom to fit the input graph (skip when caller wants to preserve current
      // zoom). Fit to the SPQR drawing region [0,0,canvasW,canvasH] — the area
      // the algorithm guarantees the whole graph is drawn inside — so the
      // framing is stable and every vertex is in view.
      if (!preserveZoom) zoomToFitInputGraphToRegion(0, 0, canvasW, canvasH);

      if (oldPositions && newPositions) animateEmbeddingTransition(oldPositions, newPositions);

      console.log(`✅ [draw#${callId}] Input graph redrawn from SPQR tree`);

      // Watch for async cx/cy overwrites on input graph circles
      {
        const _capturedId = callId;
        _diagLog.push(`=== draw#${_capturedId} completed — watching for cx/cy overwrites ===`);
        const _obs = new MutationObserver(mutations => {
          for (const m of mutations) {
            if (m.attributeName !== 'cx' && m.attributeName !== 'cy') continue;
            const newVal = m.target.getAttribute(m.attributeName);
            const stack = new Error().stack;
            _diagLog.push(`[OVERWRITE after draw#${_capturedId}] ${m.attributeName}=${newVal}\n${stack}`);
          }
        });
        state.d3selections.nodeInput.each(function() {
          _obs.observe(this, { attributes: true, attributeFilter: ['cx', 'cy'] });
        });
        setTimeout(() => _obs.disconnect(), 2000);
      }
    } else {
      console.warn("No input graph selections available to update.");
    }
  } catch (error) {
    console.error("Error drawing graph from SPQR:", error);
  }
}


let _embeddingAnimTimer = null;

function stopEmbeddingAnimation() {
  if (_embeddingAnimTimer) {
    _embeddingAnimTimer.stop();
    _embeddingAnimTimer = null;
  }
}

function animateEmbeddingTransition(oldPositions, newPositions, duration = 600) {
  if (!state.d3selections.nodeInput) return;

  stopEmbeddingAnimation();

  // Snapshot the selections NOW so the timer closure always operates on G1's
  // elements even after state.d3selections is updated to point at a new graph.
  // Without this, loading G2 while the animation is running causes the timer
  // to apply G1's position maps (keyed by node ID) onto G2's circles, which
  // share the same IDs — placing G2 nodes visually at G1's positions.
  const nodeInput        = state.d3selections.nodeInput;
  const labelInput       = state.d3selections.labelInput;
  const linkInputVisible = state.d3selections.linkInputVisible;
  const linkInput        = state.d3selections.linkInput;
  const edgeRoutes       = state.data.edgeRoutes;

  // d.x/d.y are NOT touched — they stay at the correct new positions throughout.
  // The animation is purely DOM-level: only SVG attributes move.

  // Helper: apply edge geometry using temporary interpolated source/target positions
  function applyEdgesAtT(t) {
    function updateEdgeSel(sel) {
      if (!sel) return;
      sel.each(function(link) {
        const srcOld = oldPositions.get(link.source.id);
        const tgtOld = oldPositions.get(link.target.id);
        if (!srcOld || !tgtOld) return;
        const srcNew = newPositions.get(link.source.id) ?? link.source;
        const tgtNew = newPositions.get(link.target.id) ?? link.target;
        const animSrc = {
          x: srcOld.x + (srcNew.x - srcOld.x) * t,
          y: srcOld.y + (srcNew.y - srcOld.y) * t
        };
        const animTgt = {
          x: tgtOld.x + (tgtNew.x - tgtOld.x) * t,
          y: tgtOld.y + (tgtNew.y - tgtOld.y) * t
        };
        const el = d3.select(this);
        const route = getInputEdgeRoute(link, edgeRoutes);
        if (route?.type === 'polyline' && Array.isArray(route.points)) {
          el.attr('d', buildPolylineEdgePath(
            animSrc,
            animTgt,
            getOrientedPolylinePoints(link, route)
          ));
        } else if (route?.type === 'cubic' && route.cp1 && route.cp2) {
          el.attr('d', buildCubicEdgePath(animSrc, animTgt, route.cp1, route.cp2));
        } else if (route?.type === 'quadratic' && route.control) {
          el.attr('d', buildQuadraticEdgePath(animSrc, animTgt, route.control));
        } else {
          const ep = getStraightEdgeEndpoints(animSrc, animTgt);
          el.attr('x1', ep.x1).attr('y1', ep.y1).attr('x2', ep.x2).attr('y2', ep.y2);
        }
      });
    }
    updateEdgeSel(linkInputVisible);
    updateEdgeSel(linkInput);
  }

  // Snap DOM to old positions so the animation starts visually from there
  nodeInput
    .attr("cx", d => (oldPositions.get(d.id) ?? { x: d.x }).x)
    .attr("cy", d => (oldPositions.get(d.id) ?? { y: d.y }).y);
  labelInput
    .attr("x", d => (oldPositions.get(d.id) ?? { x: d.x }).x + 12)
    .attr("y", d => (oldPositions.get(d.id) ?? { y: d.y }).y + 4);
  applyEdgesAtT(0);

  const ease = d3.easeCubicInOut;
  _embeddingAnimTimer = d3.timer(elapsed => {
    const raw = Math.min(1, elapsed / duration);
    const t = ease(raw);

    nodeInput
      .attr("cx", d => {
        const old = oldPositions.get(d.id), nw = newPositions.get(d.id);
        return old && nw ? old.x + (nw.x - old.x) * t : d.x;
      })
      .attr("cy", d => {
        const old = oldPositions.get(d.id), nw = newPositions.get(d.id);
        return old && nw ? old.y + (nw.y - old.y) * t : d.y;
      });

    labelInput
      .attr("x", d => {
        const old = oldPositions.get(d.id), nw = newPositions.get(d.id);
        return (old && nw ? old.x + (nw.x - old.x) * t : d.x) + 12;
      })
      .attr("y", d => {
        const old = oldPositions.get(d.id), nw = newPositions.get(d.id);
        return (old && nw ? old.y + (nw.y - old.y) * t : d.y) + 4;
      });

    applyEdgesAtT(t);

    InputZoomContainer.selectAll(".temporary-edge").each(function(edge) {
      if (!edge || !edge.source || !edge.target) return;
      const srcOld = oldPositions.get(edge.source.id);
      const tgtOld = oldPositions.get(edge.target.id);
      if (!srcOld || !tgtOld) return;
      const srcNew = newPositions.get(edge.source.id) ?? { x: edge.source.x, y: edge.source.y };
      const tgtNew = newPositions.get(edge.target.id) ?? { x: edge.target.x, y: edge.target.y };
      d3.select(this)
        .attr("x1", srcOld.x + (srcNew.x - srcOld.x) * t)
        .attr("y1", srcOld.y + (srcNew.y - srcOld.y) * t)
        .attr("x2", tgtOld.x + (tgtNew.x - tgtOld.x) * t)
        .attr("y2", tgtOld.y + (tgtNew.y - tgtOld.y) * t);
    });

    if (raw >= 1) {
        nodeInput.forEach(d => {
    d.fx = null;
    d.fy = null;
  });
  nodeInput
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);

  labelInput
    .attr("x", d => d.x + 12)
    .attr("y", d => d.y + 4);

  applyEdgesAtT(1);

  _embeddingAnimTimer = null;
  return true;
}
  });

}

/**
 * Modified createSPQRVisualization to support smart redraw
 */
function createSPQRVisualization() {
  console.log("Creating SPQR visualization...");

  const preservedEmbeddings = new Map(
    (state.data.spqrTree || []).map(comp => [comp.id, {
      embeddingFlip: !!comp.embeddingFlip,
      embeddingPOrder: comp.embeddingPOrder ? [...comp.embeddingPOrder] : null,
      embeddingChildOrder: comp.embeddingChildOrder ? [...comp.embeddingChildOrder] : null,
    }])
  );
  
  // Reset per-component drag tracking when creating new SPQR visualization
  state.data.componentDefaultPositions.clear();
  state.data.draggedComponents.clear();
  state.data.componentPoses = new Map();
  state.data.composedDrawing = null;
  
  // Regular full redraw for first time or when no previous tree exists
  state.data.spqrManualRoot = null; // new tree → reset any user-chosen root
  // Remember which input graph this tree was built from so "Draw from SPQR"
  // can tell whether the graph has changed since (and only then recompute).
  state.data.spqrTreeEdgeSignature = edgeSetSignature(state.data.graphEdges);
  const edgesMap = generateEdgesMap(state.data.graphEdges);
  console.log("With edges:", edgesMap);
  state.data.spqrTree = calculateSPQRTree(edgesMap);
  for (const comp of state.data.spqrTree) {
    const preserved = preservedEmbeddings.get(comp.id);
    if (!preserved) continue;
    comp.embeddingFlip = preserved.embeddingFlip;
    if (preserved.embeddingPOrder && preserved.embeddingPOrder.length > 0) {
      comp.embeddingPOrder = [...preserved.embeddingPOrder];
    }
    if (preserved.embeddingChildOrder && preserved.embeddingChildOrder.length > 0) {
      comp.embeddingChildOrder = [...preserved.embeddingChildOrder];
    }
  }
  
  const nodesSPQR = buildSPQRNodes(state.data.spqrTree);
  const linksSPQR = buildSPQRLinks(state.data.spqrTree, nodesSPQR);
  
  buildAdjacencyList(state.data.spqrTree, nodesSPQR, linksSPQR);
  
  const { virtualEdgeData, allVirtualTwinEdgeLinks, componentVirtualEdgesMap } = buildVirtualEdgeData(state.data.spqrTree);
  state.data.virtualEdgeData = virtualEdgeData;
  state.data.allVirtualTwinEdgeLinks = allVirtualTwinEdgeLinks;
  state.data.componentVirtualEdgesMap = componentVirtualEdgesMap;

  // Keep the comparison snapshot at the decomposition stage. The fancy view
  // subsequently attaches P_AXIS_SLOT to each P permutation; that symbolic
  // drawing token is intentionally not part of the cloneable decomposition.
  state.data.previousSpqrTree = structuredClone(state.data.spqrTree);

  // The DiBattista preset has a meaningful fixed left-to-right order at P1:
  // the cycle through vertex 13 (S3) lies to the left of the pole axis and the
  // cycle through vertex 14 (S2) lies to its right. Seed that permutation after
  // the cloneable decomposition snapshot, but before the first tree layout, so
  // the pictogram, tree children and input drawing all begin in the same order.
  if (state.data.presetType === 'DiBattista') {
    const p1 = state.data.spqrTree.find(comp => comp.id === 'P1' && comp.type === 'P');
    const hasExpectedChildren = state.data.spqrTree.some(comp => comp.id === 'S2')
      && state.data.spqrTree.some(comp => comp.id === 'S3');
    if (p1 && hasExpectedChildren) {
      setPEmbeddingOrder(p1, ['S3', P_AXIS_SLOT, 'S2']);
    }
  }

  clearGraph(elements.svgSPQR);
  SPQRZoomContainer = initializeZoomContainer("spqr");
  updateEmbeddingSwitchButton();
  updateRerootButton();
  updateSwitchViewButton();

  // Update embedding count. The number of embeddings is the product over all
  // P- and R-nodes of their independent embedding choices:
  //   • each P-node with k neighbours can permute them: (k−1)! choices
  //   • each R-node can be flipped (mirrored):          2 choices
  var embeddingCount = 1;
  var rCount = 0;
  var sCount = 0;
  var pCount = 0;
  for(const c of state.data.spqrTree) {
    if (c.type == 'P') {
      pCount += 1;
      console.log(c)
      embeddingCount *= factorials[c.neighbors.length-1];
    }
    if(c.type == 'R') {
      rCount += 1;
      embeddingCount *= 2;
    }
    if(c.type == 'S') {
      sCount += 1;
    }
  }
  console.log("EMBEDDING COUNT:", embeddingCount);
  document.getElementById('embedding-count').textContent = embeddingCount;

  document.getElementById('r-count').textContent = rCount;
  document.getElementById('s-count').textContent = sCount;
  document.getElementById('p-count').textContent = pCount;
  document.getElementById('q-count').textContent = Array.from(edgesMap.values()).reduce((sum, edges) => sum + edges.length, 0) / 2;

  // Check stored drawing mode preference
  if (state.ui_state.spqrDrawingMode === 'simple') {
    createSPQRVisualizationSimple(nodesSPQR, linksSPQR);
  } else {
    createSPQRVisualizationFancy();
  }
  
  if (!state.data.isPreset || (state.data.edgeRoutes && state.data.edgeRoutes.size > 0)) {
    drawInputGraphFromSPQR();
  }
}

/**
 * Simple SPQR visualization using force simulation
 */
function createSPQRVisualizationSimple(nodesSPQR, linksSPQR) {
  console.log("🎨 Creating simple SPQR visualization with force simulation");
  console.log(`   Nodes: ${nodesSPQR.length}, Links: ${linksSPQR.length}`);
  
  const result = createGraph(SPQRZoomContainer, nodesSPQR, linksSPQR);
  state.simulation.spqr = result.simulation;
  state.d3selections.nodeSPQR = result.nodeSel;
  state.d3selections.linkSPQR = result.linkSel;
  state.d3selections.labelSPQR = result.labelSel;
  applySpqrLabelStyle();

  console.log("   nodeSPQR selection size:", state.d3selections.nodeSPQR.size());
  
  // Deterministic initial layout: place nodes on a circle around canvas center
  const svg = elements.svgSPQR.node();
  const centerX = (svg.clientWidth || 1000) / 2;
  const centerY = (svg.clientHeight || 1000) / 2;
  const nodeCount = state.d3selections.nodeSPQR.size();
  const radius = Math.min(centerX, centerY) * 0.35; // 35% of half-dimension
  const angleStep = (2 * Math.PI) / Math.max(nodeCount, 1);

  state.d3selections.nodeSPQR.each((d, i) => {
    const angle = i * angleStep;
    d.x = centerX + radius * Math.cos(angle);
    d.y = centerY + radius * Math.sin(angle);
  });
  
  // Speed up the simulation convergence and restart from deterministic positions
  state.simulation.spqr
    .alpha(1)
    .alphaDecay(0.05)
    .restart();
  
  // Add drag and hover behavior to nodes in simple mode
  setupSPQRSimpleEventHandlers();
  
  // Center the graph on the canvas when simulation ends
  state.simulation.spqr.on("end", () => {
    console.log("✅ Simple SPQR simulation ended, calling zoomToFitSPQRGraph");
    // Add a small delay to ensure DOM is fully updated
    setTimeout(() => {
      console.log("⏱️  Calling zoomToFitSPQRGraph after delay");
      zoomToFitSPQRGraph();
    }, 100);
  });
}

/**
 * Fancy SPQR visualization with component drawings and Reingold-Tilford layout
 */
function createSPQRVisualizationFancy() {
  console.log("Creating fancy SPQR visualization with component drawings");

  // Stop any previous SPQR simulation so its async "end" callbacks
  // cannot fire and corrupt the Reingold-Tilford layout we are about to draw.
  if (state.simulation.spqr) {
    state.simulation.spqr.stop();
  }

  calculateAndStoreComponentCentroids();
  storeInputNodePositions();

  // Draw the Reingold-Tilford tree layout (also clears the SPQR canvas
  // and sets up SPQRZoomContainer, so this must come before any selections).
  drawSPQRTreeReingoldTilford();

  setupCrossGraphHoverEvents();
}

function setupCrossGraphHoverEvents() {
  if (state.d3selections.nodeInput) {
    state.d3selections.nodeInput
      .on("mouseover", (e, d) => handleMouseOverInput(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
      .on("mouseout",  (e, d) => handleMouseOutInput (e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));
  }

  if (state.d3selections.nodeSPQR) {
    state.d3selections.nodeSPQR
      .on("mouseover", (e, d) => handleMouseOverSPQR(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
      .on("mouseout",  (e, d) => handleMouseOutSPQR (e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));
  }
}

function setupSPQRSimpleEventHandlers() {
  // Add drag behavior to SPQR nodes in simple mode
  const dragBehavior = d3.drag()
    .on("start", function(event, d) {
      // Pin the node in place - no need to restart the simulation
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", function(event, d) {
      d.fx = event.x;
      d.fy = event.y;
      d.x = event.x;
      d.y = event.y;

      // Update node position visually
      d3.select(this)
        .attr("cx", d.x)
        .attr("cy", d.y);

      // Update label position
      state.d3selections.labelSPQR
        .filter(label => label.id === d.id)
        .attr("x", d.x + 12)
        .attr("y", d.y + 4);
      
      // Update edge positions
      state.d3selections.linkSPQR
        .attr("x1", l => l.source.id === d.id ? d.x : l.source.x)
        .attr("y1", l => l.source.id === d.id ? d.y : l.source.y)
        .attr("x2", l => l.target.id === d.id ? d.x : l.target.x)
        .attr("y2", l => l.target.id === d.id ? d.y : l.target.y);
    })
    .on("end", function(event, d) {
      // Cool down the simulation after dragging ends
      if (!event.active && state.simulation.spqr) {
        state.simulation.spqr.alphaTarget(0);
      }
      // Keep the node fixed at its current position after dragging
      d.fx = d.x;
      d.fy = d.y;
    });

  state.d3selections.nodeSPQR.call(dragBehavior);
  
  // Add hover highlighting for component nodes
  state.d3selections.nodeSPQR
    .on("mouseover", (event, d) => {
      console.log("Hovering SPQR node (component):", d.id);
      // Mark this component as hovered
      const comp = state.data.spqrTree.find(c => c.id === d.id);
      if (comp) comp.isHovered = true;
      highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, d.id);
    })
    .on("mouseout", (event, d) => {
      console.log("Left SPQR node (component):", d.id);
      const comp = state.data.spqrTree.find(c => c.id === d.id);
      if (comp) comp.isHovered = false;
      
      // Only unhighlight if this component is NOT selected
      console.log("Component isSelected:", comp ? comp.isSelected : "comp not found");
      if (comp && !comp.isSelected) {
        console.log("Unhighlighting because isSelected is false");
        unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, d.id);
      } else if (comp && comp.isSelected) {
        console.log("Keeping highlight because isSelected is true");
      }
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      console.log("Clicked SPQR node (component):", d.id);
      const comp = state.data.spqrTree.find(c => c.id === d.id);
      if (!comp) return;
      
      // Use the same click handler as fancy mode to properly handle selection
      handleComponentClick(comp);
      
      // Update SPQR node visual styling based on selection state
      state.d3selections.nodeSPQR
        .style("fill", node => {
          const nodeComp = state.data.spqrTree.find(c => c.id === node.id);
          return nodeComp && nodeComp.isSelected ? "orange" : "steelblue";
        });
    });
  
  // Add hover highlighting for edges connecting components
  state.d3selections.linkSPQR
    .on("mouseover", (event, d) => {
      const sourceCompId = d.source.id;
      const targetCompId = d.target.id;
      console.log(`Hovering SPQR edge [${sourceCompId}, ${targetCompId}]`);
      
      // Find the virtual edge data connecting these two components
      const virtualEdge = state.data.allVirtualTwinEdgeLinks.find(link =>
        (link.compAID === sourceCompId && link.compBID === targetCompId) ||
        (link.compAID === targetCompId && link.compBID === sourceCompId)
      );
      
      if (virtualEdge) {
        const { u, v } = virtualEdge;
        console.log(`Found virtual edge [${u}, ${v}], highlighting in input graph`);
        highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
      }
    })
    .on("mouseout", (event, d) => {
      const sourceCompId = d.source.id;
      const targetCompId = d.target.id;
      console.log(`Left SPQR edge [${sourceCompId}, ${targetCompId}]`);
      
      // Find the virtual edge data connecting these two components
      const virtualEdge = state.data.allVirtualTwinEdgeLinks.find(link =>
        (link.compAID === sourceCompId && link.compBID === targetCompId) ||
        (link.compAID === targetCompId && link.compBID === sourceCompId)
      );
      
      if (virtualEdge) {
        const { u, v } = virtualEdge;
        console.log(`Unhighlighting virtual edge [${u}, ${v}]`);
        unhighlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
        
        // Check if either component is selected or hovered - if so, restore its highlighting
        const sourceComp = state.data.spqrTree.find(c => c.id === sourceCompId);
        const targetComp = state.data.spqrTree.find(c => c.id === targetCompId);
        
        console.log(`Source comp ${sourceCompId}: isSelected=${sourceComp?.isSelected}, isHovered=${sourceComp?.isHovered}`);
        console.log(`Target comp ${targetCompId}: isSelected=${targetComp?.isSelected}, isHovered=${targetComp?.isHovered}`);
        
        if (sourceComp && (sourceComp.isSelected || sourceComp.isHovered)) {
          const sourceColor = sourceComp.type === "R" ? "red" : sourceComp.type === "S" ? "green" : "blue";
          console.log(`Re-highlighting edge with source color: ${sourceColor}`);
          highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), sourceColor, true);
        }
        
        if (targetComp && (targetComp.isSelected || targetComp.isHovered)) {
          const targetColor = targetComp.type === "R" ? "red" : targetComp.type === "S" ? "green" : "blue";
          console.log(`Re-highlighting edge with target color: ${targetColor}`);
          highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), targetColor, true);
        }
      }
    });
}

function storeInputNodePositions() {
  elements.svgInput.selectAll(".input-node").each(function(d) {
    state.data.inputNodePositions.set(d.id, { x: d.x, y: d.y });
  });
}

function SPQRComponentDragAndClickBehaivour(group, comp, componentIndex) {
  let dragStartX, dragStartY;
  let startClientX, startClientY;
  const clickTolerance = 3; // max px movement to still count as click

  const dragBehavior = d3.drag()
    .on("start", function(event) {
      event.sourceEvent.preventDefault();
      event.sourceEvent.stopPropagation();

      // Record starting mouse position
      startClientX = event.sourceEvent.clientX;
      startClientY = event.sourceEvent.clientY;

      // Current transform
      const transform = d3.select(this).attr("transform");
      const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
      dragStartX = match ? parseFloat(match[1]) : 0;
      dragStartY = match ? parseFloat(match[2]) : 0;

      d3.select(this)
        .style("cursor", "grabbing")
        .style("opacity", 0.8);
    })
    .on("drag", function(event) {
      const newX = dragStartX + event.x - event.subject.x;
      const newY = dragStartY + event.y - event.subject.y;
      d3.select(this).attr("transform", `translate(${newX}, ${newY})`);

      // Check if component has been significantly moved from default position
      const defaultPos = state.data.componentDefaultPositions.get(comp.id);
      if (defaultPos) {
        const distanceMoved = Math.sqrt(
          Math.pow(newX - defaultPos.x, 2) + Math.pow(newY - defaultPos.y, 2)
        );
        const dragThreshold = 5; // pixels
        if (distanceMoved > dragThreshold) {
          state.data.draggedComponents.add(comp.id);
        }
      }

      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    })
    .on("end", function(event) {
      d3.select(this)
        .style("cursor", "grab")
        .style("opacity", 1);
      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);

      // Detect click (movement smaller than tolerance)
      const dx = event.sourceEvent.clientX - startClientX;
      const dy = event.sourceEvent.clientY - startClientY;
      if (Math.abs(dx) < clickTolerance && Math.abs(dy) < clickTolerance) {
        handleComponentClick(comp, componentIndex, this);
      }
    });

  group.call(dragBehavior);
  group.style("cursor", "grab");

  const transform = group.attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  const initialX = match ? parseFloat(match[1]) : 0;
  const initialY = match ? parseFloat(match[2]) : 0;
  group.datum({ x: initialX, y: initialY });
}

async function handleComponentClick(comp) {
  // Toggle selection state
  console.log("handleComponentClick called for:", comp.id, "current isSelected:", comp.isSelected);
  
  if (!comp.isSelected) {
    // Deselect any previously selected component by properly unhighlighting it
    for (const c of state.data.spqrTree) {
      if (c.isSelected) {
        console.log("Deselecting previous component:", c.id);
        c.isSelected = false;
        unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, c.id, "orange", false, 0, true);
      }
    }
    // Select this component
    console.log("Setting isSelected to true for:", comp.id);
    comp.isSelected = true;
    console.log("Highlighting component:", comp.id);
    highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, comp.id);
  } else {
    // Deselect this component - pass forceFullUnhighlight=true to completely clear nodes
    console.log("Deselecting component:", comp.id);
    comp.isSelected = false;
    unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, comp.id, "orange", false, 0, true);
  }
  
  console.log("Component click - selection toggled:", comp.id, "isSelected:", comp.isSelected);
  updateEmbeddingSwitchButton();
  updateRerootButton();
}

async function collapseSpqrTreeRecursivelyToRootLevelByLevel(rootToCollapseTo) {
  console.log("Collapsing tree level by level from root:", rootToCollapseTo);

  // Group components by level
  const levels = new Map();
  for (const comp of state.data.spqrTree) {
    if (!levels.has(comp.treeLevel)) levels.set(Math.abs(rootToCollapseTo.treeLevel- comp.treeLevel), []);
    levels.get(Math.abs(rootToCollapseTo.treeLevel- comp.treeLevel)).push(comp);
  }

  const maxLevel = Math.max(...levels.keys());

  console.log("levels", levels)

  // Collapse from deepest level to just above root
  for (let level = maxLevel; level > 0; level--) {
    const compsAtLevel = levels.get(level) || [];
    console.log(`Collapsing level ${level} (${compsAtLevel.length} components)`);

    // Map parent ID → children
    const parentToChildren = new Map();
    for (const comp of compsAtLevel) {
      if(comp.isCollapsed) continue;
      const parentComp = comp.neighbors
        .map(n => state.data.spqrTree.find(c => c.id === n.id))
        .find(n => n && n.treeLevel < comp.treeLevel);

      if (!parentComp) continue;

      if (!parentToChildren.has(parentComp.id)) parentToChildren.set(parentComp.id, []);
      parentToChildren.get(parentComp.id).push({ comp, parentComp });
    }

    // For each parent, collapse children **sequentially**
    for (const [parentId, children] of parentToChildren.entries()) {
      for (const { comp, parentComp } of children) {
        const virtualEdgeToParent = [...state.data.virtualEdgeData.entries()].find(
          ([, e]) => e.components.includes(comp.id) && e.components.includes(parentComp.id)
        );
        comp.isCollapsed = true;
        updateAnySPQRComponentCollapsed();
        console.log(state.data.anySPQRComponentCollapsed)

        if (virtualEdgeToParent) {
          const edgeNodes = virtualEdgeToParent[1].nodes;
          comp.virtualEdgeToParent = edgeNodes;
          if(comp.type != 'P') { await collapseComponent(comp, edgeNodes);
            await sleep(500); // small pause between children
          } else { 
              collapseSpqrComponent(comp);
          }
        }
      }
    }
  }

  console.log("Level-by-level collapse complete.");
}

function assignTreeLevelsFromRoot(newRoot) {
  const visited = new Set();
  const queue = [{ comp: newRoot, level: 0 }];
  
  while (queue.length > 0) {
    const { comp, level } = queue.shift();
    if (visited.has(comp.id)) continue;

    comp.treeLevel = level;
    visited.add(comp.id);

    for (const neighbor of comp.neighbors) {
      const neighborComp = state.data.spqrTree.find(c => c.id === neighbor.id);
      if (!visited.has(neighborComp.id)) {
        queue.push({ comp: neighborComp, level: level + 1 });
      }
    }
  }
}

function collapseComponent(component, edgeToCollapseTo) {
  return new Promise(async resolve => {
    console.log("🔥 COLLAPSE START:", component.id, "edgeToCollapseTo:", edgeToCollapseTo);
    
    // Cache component data BEFORE any modifications
    cacheComponentData(component);
    
    component.isCollapsed = true;
    const componentNodeIds = [...component.graph.keys()].map(String);
    const [srcId, tgtId] = edgeToCollapseTo.map(String);

    console.log("📊 Component nodes:", componentNodeIds);
    console.log("🔗 Virtual edge nodes:", [srcId, tgtId]);

    const compGroup = elements.svgSPQR
      .selectAll(".spqr-component")
      .filter(function () {
        return d3.select(this).attr("data-comp-id") === String(component.id);
      });

    compGroup.classed("highlighted", true);

    const movingNodeIds = componentNodeIds.filter(id => id !== srcId && id !== tgtId);
    const componentNodes = state.data.graphNodes.filter(n => movingNodeIds.includes(n.id));

    console.log("🏃 Moving nodes:", movingNodeIds);

    // Highlight nodes about to collapse
    elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .classed("collapsing-node", true);

    elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => !movingNodeIds.includes(d.id) && componentNodeIds.includes(d.id))
      .classed("collapsing-virtual-edge-node", true);

    // Wait before collapsing
    await sleep(800);

    // Remove highlighting
    elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => !movingNodeIds.includes(d.id) && componentNodeIds.includes(d.id))
      .classed("collapsing-virtual-edge-node", false);

    elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .classed("collapsing-node", false);

    // NO moving nodes (e.g., 2-node P comp)
    if (componentNodes.length === 0) {
      console.log("⚠️ No moving nodes - simple collapse");
      compGroup.classed("highlighted", false);
      refreshInputGraphSmooth();
      resolve();
      return;
    }

    // Virtual edge endpoints
    const source = state.data.graphNodes.find(n => n.id === srcId);
    const target = state.data.graphNodes.find(n => n.id === tgtId);

    if (!source || !target) {
      console.error("❌ Virtual edge endpoints not found!");
      resolve();
      return;
    }

    // Helper: project point onto segment
    function projectPointOnSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx*dx + dy*dy;
      if (lenSq === 0) return { x: x1, y: y1 };

      let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t)); // clamp to [0,1]
      return { x: x1 + t * dx, y: y1 + t * dy };
    }

    // Animate nodes toward projection onto edge
    const nodeTransition = elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .transition()
      .duration(1000)
      .attrTween("cx", d => {
        const startX = d.x;
        const { x: projX } = projectPointOnSegment(d.x, d.y, source.x, source.y, target.x, target.y);
        return t => (d.x = startX + (projX - startX) * t);
      })
      .attrTween("cy", d => {
        const startY = d.y;
        const { y: projY } = projectPointOnSegment(d.x, d.y, source.x, source.y, target.x, target.y);
        return t => (d.y = startY + (projY - startY) * t);
      })
      .attrTween("r", function(d) {
          const startR = +d3.select(this).attr("r");
          const endR = 2;
          return t => {
              const easedT = t;
              return startR + (endR - startR) * easedT;
          };
      });

    // Animate labels to fade out
    elements.svgInput
      .selectAll("text")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .attr("opacity", 0);

    // Animate edges connected to moving nodes
    elements.svgInput
      .selectAll("line")
      .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`)
      .filter(link =>
        movingNodeIds.includes(link.source.id) || movingNodeIds.includes(link.target.id)
      )
      .transition()
      .duration(1000)
      .attrTween("x1", link => {
        const startX = link.source.x;
        const { x: projX } = projectPointOnSegment(link.source.x, link.source.y, source.x, source.y, target.x, target.y);
        return t => startX + (projX - startX) * t;
      })
      .attrTween("y1", link => {
        const startY = link.source.y;
        const { y: projY } = projectPointOnSegment(link.source.x, link.source.y, source.x, source.y, target.x, target.y);
        return t => startY + (projY - startY) * t;
      })
      .attrTween("x2", link => {
        const startX = link.target.x;
        const { x: projX } = projectPointOnSegment(link.target.x, link.target.y, source.x, source.y, target.x, target.y);
        return t => startX + (projX - startX) * t;
      })
      .attrTween("y2", link => {
        const startY = link.target.y;
        const { y: projY } = projectPointOnSegment(link.target.x, link.target.y, source.x, source.y, target.x, target.y);
        return t => startY + (projY - startY) * t;
      });

nodeTransition.end().then(() => {
  console.log("🎬 Animation complete, starting data updates...");
  
  compGroup.classed("highlighted", false);
  
  // FIXED: Proper virtual edge handling
  console.log("🔍 Checking for existing virtual edge...");
  const existingEdgeInArray = state.data.graphEdges.find(
    edge => (String(edge[0]) === srcId && String(edge[1]) === tgtId) ||
            (String(edge[0]) === tgtId && String(edge[1]) === srcId)
  );
  
  console.log("🔍 Existing edge in array found:", !!existingEdgeInArray);
  
  // Add virtual edge if it doesn't exist in the edges array
  if (!existingEdgeInArray) {
    console.log("➕ Adding new virtual edge to graphEdges");
    state.data.graphEdges.push([Number(srcId), Number(tgtId)]);
    console.log("📊 Virtual edge added:", [srcId, tgtId]);
  }

  // ... existing edge and node cleanup code ...

  // Rebuild graphLinks from clean data
  console.log("🔄 Rebuilding graphLinks from clean graphEdges...");
  const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
  
  state.data.graphLinks = state.data.graphEdges
    .map(([s, t]) => {
      const sourceNode = idToNode[String(s)];
      const targetNode = idToNode[String(t)];
      
      if (!sourceNode) {
        console.warn(`❌ Source node ${s} not found in remaining nodes`);
        return null;
      }
      if (!targetNode) {
        console.warn(`❌ Target node ${t} not found in remaining nodes`);
        return null;
      }
      
      return { source: sourceNode, target: targetNode };
    })
    .filter(link => link !== null);
  
  console.log(`📊 GraphLinks rebuilt: ${state.data.graphLinks.length} valid links`);

  // Final verification
  const finalVirtualEdge = state.data.graphLinks.find(
    l => (l.source.id === srcId && l.target.id === tgtId) ||
         (l.source.id === tgtId && l.target.id === srcId)
  );
  
  if (finalVirtualEdge) {
    console.log("✅ Virtual edge successfully created and verified");
  } else {
    console.error("❌ Virtual edge was lost during processing!");
    console.error("❌ Available edges:", state.data.graphLinks.map(l => `${l.source.id}-${l.target.id}`));
  }

  collapseSpqrComponent(component);
  console.log("🔄 Calling refreshInputGraphSmooth...");
  
  // ADD THIS LINE HERE:
  handleVirtualEdgeRemoval(edgeToCollapseTo);
  
  refreshInputGraphSmooth();
  
  console.log("✅ COLLAPSE COMPLETE for", component.id);
  resolve();
});
  });
}
function cacheComponentData(component) {
  if (component.cachedData) {
    return; // Already cached
  }
  
  console.log(`Caching data for component ${component.id}`);
  
  // Cache the original node positions and data
  component.cachedData = {
    nodePositions: new Map(),
    nodeData: new Map(),
    edges: []
  };
  
  // Store node positions and data
  for (const [nodeId, neighbors] of component.graph.entries()) {
    const nodeIdStr = String(nodeId);
    const graphNode = state.data.graphNodes.find(n => n.id === nodeIdStr);
    
    if (graphNode) {
      // Store position and any other node data
      component.cachedData.nodePositions.set(nodeIdStr, {
        x: graphNode.x,
        y: graphNode.y
      });
      
      // Store complete node data (in case we need other properties)
      component.cachedData.nodeData.set(nodeIdStr, {
        id: graphNode.id,
        x: graphNode.x,
        y: graphNode.y,
        // Add any other properties that might exist on the node
        ...graphNode
      });
    }
  }
  
  // Store edges within this component
  for (const [nodeId, neighbors] of component.graph.entries()) {
    for (const neighborId of neighbors) {
      // Only store each edge once (avoid duplicates)
      if (nodeId < neighborId) {
        component.cachedData.edges.push([String(nodeId), String(neighborId)]);
      }
    }
  }
  
  console.log(`Cached ${component.cachedData.nodePositions.size} nodes and ${component.cachedData.edges.length} edges for component ${component.id}`);
}

function collapseSpqrComponent(comp) {
  console.log(`Collapsing component ID: ${comp.id}, type: ${comp.type}`);
  const compGroup = d3.select(`[data-comp-id='${comp.id}']`);
  
  // Hide everything except container <g>
  compGroup.selectAll(".edge-normal, .edge-virtual, .node, rect, text").style("display", "none");

  // Draw placeholder bar
  let placeholder = compGroup.select(".collapsed-bar");
  if (placeholder.empty()) {
    placeholder = compGroup.append("rect")
      .attr("class", "collapsed-bar")
      .attr("x", -20)
      .attr("y", -10)
      .attr("width", 50)
      .attr("height", 20)
      .attr("rx", 4)
      .attr("fill", "#ddd")
      .style("opacity", 0.8)
      .attr("stroke", "#333");
  } else {
    placeholder.style("display", null);
  }

  // Draw expand icon
  d3.xml("assets/maximize.svg").then(data => {
    const iconNode = data.documentElement;
    compGroup.append(() => iconNode.cloneNode(true))
      .attr("class", "expand-icon")
      .attr("width", 20)
      .attr("height", 20)
      .attr("x", -10)
      .attr("y", -10)
      .style("cursor", "pointer")
      .on("click", () => {
        console.log(`Clicked expand for component ID: ${comp.id}, type: ${comp.type}`);
        expandSpqrComponent(comp);
      });
  });

  comp.isCollapsed = true;
}

function expandSpqrComponent(comp) {
  console.log(`Expanding component ID: ${comp.id}, type: ${comp.type}`);
  const compGroup = d3.select(`[data-comp-id='${comp.id}']`);

  // Restore content
  compGroup.selectAll(".edge-normal, .edge-virtual, .node, rect, text").style("display", null);

  // Hide placeholder + icon
  compGroup.select(".collapsed-bar").style("display", "none");
  compGroup.select(".expand-icon").remove();

  comp.isCollapsed = false;
  updateAnySPQRComponentCollapsed();
  
  // Find the virtual edge to parent if it exists
  const virtualEdgeToParent = findVirtualEdgeToParent(comp);
  if (virtualEdgeToParent) {
    comp.virtualEdgeToParent = virtualEdgeToParent;
    expandComponent(comp, virtualEdgeToParent);
  }
}

// Helper function to find virtual edge connecting to an expanded parent
function findVirtualEdgeToParent(component) {
  // Look for virtual edges that connect this component to an expanded component
  for (const [, edgeData] of state.data.virtualEdgeData.entries()) {
    if (edgeData.components.includes(component.id)) {
      const otherComponentId = edgeData.components.find(id => id !== component.id);
      const otherComponent = state.data.spqrTree.find(c => c.id === otherComponentId);
      
      // If the other component is expanded, this is our parent edge
      if (otherComponent && !otherComponent.isCollapsed) {
        return edgeData.nodes;
      }
    }
  }
  
  // If no expanded parent found, find any neighbor (fallback)
  for (const neighbor of component.neighbors) {
    const neighborComp = state.data.spqrTree.find(c => c.id === neighbor.id);
    if (neighborComp && !neighborComp.isCollapsed) {
      // Find virtual edge between this component and the neighbor
      for (const [, edgeData] of state.data.virtualEdgeData.entries()) {
        if (edgeData.components.includes(component.id) && edgeData.components.includes(neighborComp.id)) {
          return edgeData.nodes;
        }
      }
    }
  }
  
  return null;
}
async function expandPathToComponent(targetComponent) {
  console.log("Finding path to expand component:", targetComponent.id);
  
  // Find all expanded components
  const expandedComponents = state.data.spqrTree.filter(comp => !comp.isCollapsed);
  
  if (expandedComponents.length === 0) {
    // No components are expanded, just expand the target
    console.log("No expanded components found, expanding target directly");
    expandSpqrComponent(targetComponent);
    return;
  }
  
  // Find shortest path from any expanded component to target
  const pathToExpand = findShortestPathToExpanded(targetComponent, expandedComponents);
  
  if (!pathToExpand || pathToExpand.length === 0) {
    console.log("No path found, expanding target directly");
    expandSpqrComponent(targetComponent);
    return;
  }
  
  console.log("Path to expand:", pathToExpand.map(comp => comp.id));
  
  // Expand components along the path sequentially
  for (const comp of pathToExpand) {
    if (comp.isCollapsed) {
      console.log("Expanding component along path:", comp.id);
      expandSpqrComponent(comp);
      // Small delay between expansions for visual clarity
      await sleep(300);
    }
  }
}

function findShortestPathToExpanded(targetComponent, expandedComponents) {
  const visited = new Set();
  const queue = [{ component: targetComponent, path: [targetComponent] }];
  
  while (queue.length > 0) {
    const { component, path } = queue.shift();
    
    if (visited.has(component.id)) continue;
    visited.add(component.id);
    
    // Check if we've reached an expanded component
    if (expandedComponents.some(expanded => expanded.id === component.id)) {
      // Return path excluding the expanded component (since it's already expanded)
      return path.slice(0, -1).reverse(); // Reverse to expand from expanded->target direction
    }
    
    // Add neighbors to queue
    for (const neighbor of component.neighbors) {
      const neighborComp = state.data.spqrTree.find(c => c.id === neighbor.id);
      if (neighborComp && !visited.has(neighborComp.id)) {
        queue.push({
          component: neighborComp,
          path: [...path, neighborComp]
        });
      }
    }
  }
  
  // No path found (shouldn't happen in a connected tree)
  return null;
}

function expandComponent(component, edgeToCollapseTo) {
  return new Promise(async resolve => {
    component.isCollapsed = false;

    if (!component.cachedData) {
      console.error(`No cached data found for component ${component.id}`);
      resolve();
      return;
    }
    console.log("expanding this component:", component)

    const componentNodeIds = [...component.graph.keys()].map(String);
    const [srcId, tgtId] = edgeToCollapseTo.map(String);

    // Find virtual edge nodes
    const source = state.data.graphNodes.find(n => n.id === srcId);
    const target = state.data.graphNodes.find(n => n.id === tgtId);

    // Re-add removed nodes using cached data
    const missingNodeIds = [...component.graph.keys()].filter(
      id => !state.data.graphNodes.some(n => n.id === String(id))
    );
    
    const newNodes = missingNodeIds.map(id => {
      const nodeIdStr = String(id);
      const cachedNodeData = component.cachedData.nodeData.get(nodeIdStr);
      
      if (cachedNodeData) {
        // Start at virtual edge position for animation
        return { 
          ...cachedNodeData,
          x: (source.x + target.x) / 2,
          y: (source.y + target.y) / 2
        };
      } else {
        // Fallback if no cached data (shouldn't happen, but just in case)
        console.warn(`No cached data for node ${nodeIdStr} in component ${component.id}`);
        return { 
          id: nodeIdStr, 
          x: (source.x + target.x) / 2, 
          y: (source.y + target.y) / 2 
        };
      }
    });
    
    state.data.graphNodes.push(...newNodes);


    // Re-add edges using cached edges
    for (const [srcNodeId, tgtNodeId] of component.cachedData.edges) {
      if([srcNodeId, tgtNodeId] == edgeToCollapseTo) {
        continue;
      }
      // Add to edges array if not present
      const edgeExists = state.data.graphEdges.some(
        e => (e[0] === srcNodeId && e[1] === tgtNodeId) || 
             (e[0] === tgtNodeId && e[1] === srcNodeId) ||
             (String(e[0]) === srcNodeId && String(e[1]) === tgtNodeId) ||
             (String(e[0]) === tgtNodeId && String(e[1]) === srcNodeId)
      );
      if (!edgeExists) {
        state.data.graphEdges.push([Number(srcNodeId), Number(tgtNodeId)]);
      }
    }

    

    // Rebuild all graphLinks from graphEdges to ensure consistency
    const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
    state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
      source: idToNode[String(s)],
      target: idToNode[String(t)]
    })).filter(link => link.source && link.target); // Remove any invalid links

    const compGroup = elements.svgSPQR
      .selectAll(".spqr-component")
      .filter(function () {
        return d3.select(this).attr("data-comp-id") === String(component.id);
      });

    compGroup.classed("highlighted", true);

    const movingNodeIds = componentNodeIds.filter(id => id !== srcId && id !== tgtId);

    // Ensure all new edges are visible immediately by setting their positions
    elements.svgInput
      .selectAll("line")
      .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`)
      .filter(d => movingNodeIds.includes(d.source.id) || movingNodeIds.includes(d.target.id))
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

            handleVirtualEdgeRemoval(edgeToCollapseTo)  
    refreshInputGraphSmooth();

    // Animate nodes back to original cached positions
    const nodeTransition = elements.svgInput
      .selectAll("circle")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .transition()
      .duration(1000)
      .attrTween("cx", d => {
        const startX = d.x;
        const cachedPos = component.cachedData.nodePositions.get(d.id);
        const endX = cachedPos ? cachedPos.x : startX;
        return t => (d.x = startX + (endX - startX) * t);
      })
      .attrTween("cy", d => {
        const startY = d.y;
        const cachedPos = component.cachedData.nodePositions.get(d.id);
        const endY = cachedPos ? cachedPos.y : startY;
        return t => (d.y = startY + (endY - startY) * t);
      })
      .attrTween("r", d => {
        const startR = 2;
        const endR = 10; // Normal node radius
        return t => startR + (endR - startR) * t;
      });

    // Animate labels back to their proper positions
    const labelTransition = elements.svgInput
      .selectAll("text")
      .data(state.data.graphNodes, d => d.id)
      .filter(d => movingNodeIds.includes(d.id))
      .transition()
      .duration(1000)
      .attrTween("x", d => {
        const startX = (source.x + target.x) / 2 + 12;
        const cachedPos = component.cachedData.nodePositions.get(d.id);
        const endX = cachedPos ? cachedPos.x + 12 : startX;
        return t => startX + (endX - startX) * t;
      })
      .attrTween("y", d => {
        const startY = (source.y + target.y) / 2 + 4;
        const cachedPos = component.cachedData.nodePositions.get(d.id);
        const endY = cachedPos ? cachedPos.y + 4 : startY;
        return t => startY + (endY - startY) * t;
      })
      .attr("opacity", 1);

    // Animate edges that connect to the expanding nodes
    const edgeTransition = elements.svgInput
      .selectAll("line")
      .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`)
      .filter(d => movingNodeIds.includes(d.source.id) || movingNodeIds.includes(d.target.id))
      .transition()
      .duration(1000)
      .attrTween("x1", d => {
        const cachedPosSource = component.cachedData.nodePositions.get(d.source.id);
        if (cachedPosSource && movingNodeIds.includes(d.source.id)) {
          const startX = (source.x + target.x) / 2;
          return t => startX + (cachedPosSource.x - startX) * t;
        }
        return () => d.source.x;
      })
      .attrTween("y1", d => {
        const cachedPosSource = component.cachedData.nodePositions.get(d.source.id);
        if (cachedPosSource && movingNodeIds.includes(d.source.id)) {
          const startY = (source.y + target.y) / 2;
          return t => startY + (cachedPosSource.y - startY) * t;
        }
        return () => d.source.y;
      })
      .attrTween("x2", d => {
        const cachedPosTarget = component.cachedData.nodePositions.get(d.target.id);
        if (cachedPosTarget && movingNodeIds.includes(d.target.id)) {
          const startX = (source.x + target.x) / 2;
          return t => startX + (cachedPosTarget.x - startX) * t;
        }
        return () => d.target.x;
      })
      .attrTween("y2", d => {
        const cachedPosTarget = component.cachedData.nodePositions.get(d.target.id);
        if (cachedPosTarget && movingNodeIds.includes(d.target.id)) {
          const startY = (source.y + target.y) / 2;
          return t => startY + (cachedPosTarget.y - startY) * t;
        }
        return () => d.target.y;
      });

    // Wait for all transitions to complete
    Promise.all([nodeTransition.end(), labelTransition.end(), edgeTransition.end()]).then(() => {
      compGroup.classed("highlighted", false);
      // Hide collapsed bar + icon
      compGroup.select(".collapsed-bar").style("display", "none");
      compGroup.select(".expand-icon").remove();
      console.log("edge to collapse (expand)", edgeToCollapseTo)
      console.log(component)
      console.log(state.data.allVirtualTwinEdgeLinks)

      refreshInputGraphSmooth();
      resolve();
    });
  });
}

function shouldRemoveVirtualEdge(edgeToCollapseTo) {
  // Find the virtual edge link
  const virtualEdgeLink = state.data.allVirtualTwinEdgeLinks.find(link => 
    (link.u == edgeToCollapseTo[0] && link.v == edgeToCollapseTo[1]) ||
    (link.u == edgeToCollapseTo[1] && link.v == edgeToCollapseTo[0])
  );
  
  if (!virtualEdgeLink) {
    return false; // Not a virtual edge
  }
  
  const compA = state.data.spqrTree.find(c => c.id === virtualEdgeLink.compAID);
  const compB = state.data.spqrTree.find(c => c.id === virtualEdgeLink.compBID);
  
  if (!compA || !compB) {
    return false; // Components not found
  }
  
  // Both components must be expanded
  if (compA.isCollapsed || compB.isCollapsed) {
    return false;
  }
  
  // Check if the edge is a real edge in either P component
// Check if the edge is a real edge in either P component
const isRealEdgeInPComponent = (comp, u, v) => {
  if (comp.type !== 'P') return false;
  
  // Get neighbors of u
  const edges = Array.from(comp.graph.entries());
  
  // For P components with the new format, edges are stored as an array
  // where each entry points to its next neighbor
  for (const [node, neighbor] of edges) {
    if (
      // Check both directions
      (String(node) === String(u) && String(neighbor) === String(v)) ||
      (String(node) === String(v) && String(neighbor) === String(u))
    ) {
      return true;
    }
  }
  
  return false;
};
  
  if (isRealEdgeInPComponent(compA, edgeToCollapseTo[0], edgeToCollapseTo[1]) || 
      isRealEdgeInPComponent(compB, edgeToCollapseTo[0], edgeToCollapseTo[1])) {
    console.log(`Keeping edge [${edgeToCollapseTo[0]}, ${edgeToCollapseTo[1]}] - it's a real edge in a P component`);
    return false;
  }
  
  // For P components, ALL neighbors must be expanded
  const allNeighborsExpanded = (comp) => {
    if (comp.type !== 'P') return true; // Non-P components don't need this check
    
    return comp.neighbors.every(neighbor => {
      const neighborComp = state.data.spqrTree.find(c => c.id === neighbor.id);
      return neighborComp && !neighborComp.isCollapsed;
    });
  };
  
  if (!allNeighborsExpanded(compA) || !allNeighborsExpanded(compB)) {
    console.log(`Keeping edge [${edgeToCollapseTo[0]}, ${edgeToCollapseTo[1]}] - P component has collapsed neighbors`);
    return false;
  }
  
  console.log(`Removing virtual edge [${edgeToCollapseTo[0]}, ${edgeToCollapseTo[1]}] - all conditions met`);
  return true;
}

// Main function to handle virtual edge removal
function handleVirtualEdgeRemoval(edgeToCollapseTo) {
  if (shouldRemoveVirtualEdge(edgeToCollapseTo)) {
    console.log(`Removing virtual edge: [${edgeToCollapseTo[0]}, ${edgeToCollapseTo[1]}]`);
    // Remove the edge
    state.data.graphEdges = state.data.graphEdges.filter(edge => 
      !((String(edge[0]) === String(edgeToCollapseTo[0]) && String(edge[1]) === String(edgeToCollapseTo[1])) ||
        (String(edge[0]) === String(edgeToCollapseTo[1]) && String(edge[1]) === String(edgeToCollapseTo[0])))
    );
    
    // Rebuild graphLinks
    const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
    state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
      source: idToNode[String(s)],
      target: idToNode[String(t)]
    })).filter(link => link.source && link.target);
  }
}

function updateAnySPQRComponentCollapsed() {
  // If any component is collapsed, set the flag to true
  state.data.anySPQRComponentCollapsed = state.data.spqrTree.some(comp => comp.isCollapsed);
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}







// LETS YOU DRAW/DELETE NODES AND VERTICES IN THE INPUT GRAPH

elements.drawModeBtn.onclick = function() {
  setActiveTool('draw');
    state.ui_state.drawMode = !state.ui_state.drawMode;
  state.ui_state.deleteMode = false; // Disable delete mode when entering draw mode
  endOfDrawHandleSelectedNode();

  // Clear all highlighting when entering draw mode
  if (state.ui_state.drawMode) {
    clearAllHighlighting();
  }

  console.log("Draw mode:", state.ui_state.drawMode);
  elements.svgInput.selectAll("circle")
    .attr("fill", "steelblue");
};

elements.deleteModeBtn.onclick = function() {
  setActiveTool('delete');
  state.ui_state.deleteMode = !state.ui_state.deleteMode;
  endOfDrawHandleSelectedNode();
  state.ui_state.drawMode = false; // Disable draw mode when entering delete mode
  
  // Clear all highlighting when entering delete mode
  if (state.ui_state.deleteMode) {
    clearAllHighlighting();
  }
  
  console.log("Delete mode:", state.ui_state.deleteMode);
};

// Set up reset confirmation dialog
const resetDialog = document.getElementById('reset-confirmation');
const confirmYesBtn = document.getElementById('confirm-reset-yes');
const confirmNoBtn = document.getElementById('confirm-reset-no');

function closeResetDialog() {
  resetDialog.classList.remove('show');
}

function performReset() {
  console.log("Resetting input graph and state");
  closePEmbeddingDialog();
  resetState();
  clearBothGraphs();
  resetStats();
  // Clear the paste box and its hint
  const graphInput = document.getElementById('graph-input');
  if (graphInput) graphInput.value = "";
  const hintEl = document.getElementById('graph-input-hint');
  if (hintEl) { hintEl.textContent = ""; hintEl.classList.remove('input-hint-error'); }
  // Hide biconnected status box
  const statusBox = document.getElementById('biconnected-status');
  if (statusBox) statusBox.style.display = "none";
  
  closeResetDialog();
}

elements.resetInputBtn.onclick = function() {
  console.log("Reset button clicked - showing confirmation dialog");
  resetDialog.classList.add('show');
};

confirmYesBtn.addEventListener('click', performReset);
confirmNoBtn.addEventListener('click', closeResetDialog);

// Close dialog if clicking outside
resetDialog.addEventListener('click', (e) => {
  if (e.target === resetDialog) {
    closeResetDialog();
  }
});

if (elements.pEmbeddingDialog) {
  elements.pEmbeddingDialog.addEventListener('click', (e) => {
    if (e.target === elements.pEmbeddingDialog) {
      closePEmbeddingDialog();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.pEmbeddingDialog?.classList.contains('show')) {
    closePEmbeddingDialog();
  }
});


elements.svgInput.on("click", function(event) {
  if (!state.ui_state.drawMode && !state.ui_state.deleteMode) return;
  var mode;

  if(state.ui_state.deleteMode) {
    mode = "delete";
  }
  if(state.ui_state.drawMode) {
    mode = "draw";
  }

  // Convert screen coordinates to graph coordinates
  const { x: graphX, y: graphY } = getInputGraphPos(event);
  console.log("Click at graph coords:", graphX, graphY);

  // Check if click is on a node
  let clickedNodeId = null;
  InputZoomContainer.selectAll("circle").each(function(d) {
    if (!d) return;
    const dx = graphX - d.x;
    const dy = graphY - d.y;
    if (Math.sqrt(dx * dx + dy * dy) < 18) {
      clickedNodeId = d.id;
      console.log("Clicked on node:", d.id);
    }
  });

  let clickedEdgeId = null;
  let closestEdge = null;
  let closestDist = Infinity;
  let edgeSelectionLeniency = 3; // Distance threshold for edge selection
  
  console.log("Looking for edge hit areas...");
  const edgeHitAreas = InputZoomContainer.selectAll(".edge-hit-area");
  console.log("Found edge hit areas:", edgeHitAreas.size());
  
  InputZoomContainer.selectAll(".edge-hit-area").each(function(d) {
    console.log("Checking edge:", d);
    if (!d || clickedNodeId != null) {
      console.log("Skipping edge (no data or node clicked)");
      return;
    }
    
    const dist = pointToSegmentDistance(
      graphX, 
      graphY, 
      d.source.x, 
      d.source.y, 
      d.target.x, 
      d.target.y
    );
    
    console.log(`Distance to edge [${d.source.id}, ${d.target.id}]: ${dist}`);
    
    if (dist < edgeSelectionLeniency && dist < closestDist) {
      closestDist = dist;
      closestEdge = d;
      console.log("New closest edge:", closestEdge);
    }
  });

if (closestEdge && mode === "delete") {
  console.log("=== DELETING EDGE ===");
  console.log("Closest edge:", closestEdge);
  console.log("Distance:", closestDist);
  
  // Save zoom state
  const zoomState = saveZoomState("input");
  
  clickedEdgeId = `${closestEdge.source.id}-${closestEdge.target.id}`;
  console.log("Clicked on edge:", clickedEdgeId);
  console.log("Deleting edge:", clickedEdgeId);
  console.log("Current edges before deletion:", state.data.graphEdges);
  
  state.data.graphEdges = state.data.graphEdges.filter(e => 
    !(e[0] === Number(closestEdge.source.id) && e[1] === Number(closestEdge.target.id))
  );
  state.data.graphLinks = state.data.graphLinks.filter(link => 
    !(link.source.id === closestEdge.source.id && link.target.id === closestEdge.target.id)
  );
  
  console.log("Edges after deletion:", state.data.graphEdges);
  console.log("Links after deletion:", state.data.graphLinks);
  
  refreshInputGraph();
  
  // Restore zoom state
  restoreZoomState("input", zoomState);
  return;
}

if (clickedNodeId) {
  if(mode === "delete") {
    const zoomState = saveZoomState("input");
    
    state.data.graphNodes = state.data.graphNodes.filter(n => n.id !== clickedNodeId);
    state.data.graphEdges = state.data.graphEdges.filter(e => e[0] !== Number(clickedNodeId) && e[1] !== Number(clickedNodeId));
    state.data.graphLinks = state.data.graphLinks.filter(link => link.source.id !== clickedNodeId && link.target.id !== clickedNodeId);
    updateInputActionButtons();

    refreshInputGraph();

    restoreZoomState("input", zoomState);
    return;
  }

    if (!state.ui_state.edgeStart) {
      // Start edge drawing
      state.ui_state.edgeStart = clickedNodeId;
      highlight(state.d3selections.nodeInput, clickedNodeId);
      console.log("Starting edge from:", clickedNodeId);
      InputZoomContainer.selectAll(".input-node")
        .style("fill", d => d.id === clickedNodeId ? "orange" : "steelblue");
    } else if (state.ui_state.edgeStart !== clickedNodeId) {
      // Complete edge - add to both data structures
      const zoomState = saveZoomState("input"); // Save zoom before refresh
      
      console.log("Completing edge:", state.ui_state.edgeStart, "->", clickedNodeId);
      const newEdge = [Number(state.ui_state.edgeStart), Number(clickedNodeId)];
      unhighlight(state.d3selections.nodeInput, state.ui_state.edgeStart)
      
      // Add to edges array
      state.data.graphEdges.push(newEdge);
      
      // Add to links array for visualization
      const sourceNode = state.data.graphNodes.find(n => n.id === state.ui_state.edgeStart);
      const targetNode = state.data.graphNodes.find(n => n.id === clickedNodeId);
      if (sourceNode && targetNode) {
        state.data.graphLinks.push({
          source: sourceNode,
          target: targetNode
        });
      }

      if(state.data.spqrTree && state.data.spqrTree.length > 0) {
             // Unhighlight the first node BEFORE refreshing
      unhighlightInSPQRDrawing(state.ui_state.edgeStart);

                  // Unhighlight the second node BEFORE refreshing
      unhighlightInSPQRDrawing(clickedNodeId);
      }
            // Reset edge drawing state BEFORE refresh
      state.ui_state.edgeStart = null;


      // Refresh the entire graph to ensure consistency
      refreshInputGraph();
      
      // Restore zoom state
      restoreZoomState("input", zoomState);


    }
  } else if (state.ui_state.drawMode) {
    if (state.ui_state.edgeStart) {
      // Cancel edge drawing
      console.log("Canceling edge drawing");
      state.ui_state.edgeStart = null;
      InputZoomContainer.selectAll("circle")
        .style("fill", "steelblue");
      return;
    }

    // Add new node at graph coordinates (not screen coordinates)
    addNewNode(graphX, graphY);
  }
});

// Save current zoom transform
function saveZoomState(canvas) {
  const svg = canvas === "input" ? elements.svgInput : elements.svgSPQR;
  const currentTransform = d3.zoomTransform(svg.node());
  return {
    x: currentTransform.x,
    y: currentTransform.y,
    k: currentTransform.k
  };
}

// Restore zoom transform
function restoreZoomState(canvas, savedTransform) {
  const svg = canvas === "input" ? elements.svgInput : elements.svgSPQR;
  const zoom = d3.zoom().on("zoom", e => {
    const container = canvas === "input" ? InputZoomContainer : SPQRZoomContainer;
    container.attr("transform", e.transform);
  });
  
  svg.call(zoom);
  
  // Disable double-click zoom on input graph only
  if (canvas === "input") {
    svg.on("dblclick.zoom", null);
  }
  
  if (savedTransform) {
    svg.call(zoom.transform, 
      d3.zoomIdentity
        .translate(savedTransform.x, savedTransform.y)
        .scale(savedTransform.k)
    );
  }
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) return Math.sqrt(A * A + B * B); // Point case
    
    let t = dot / lenSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
    
    const projection = [x1 + t * C, y1 + t * D];
    const dx = px - projection[0];
    const dy = py - projection[1];
    
    return Math.sqrt(dx * dx + dy * dy);
}

function endOfDrawHandleSelectedNode() {
  if (!state.d3selections.nodeInput || !state.ui_state.edgeStart) return;
  unhighlight(state.d3selections.nodeInput, state.ui_state.edgeStart);
  state.ui_state.edgeStart = null;
}


function addNewNode(x, y) {
  // Initialize graphNodes array if it doesn't exist

    const zoomState = saveZoomState("input");
  if (!state.data.graphNodes) {
    state.data.graphNodes = [];
  }
  if (!state.data.graphEdges) {
    state.data.graphEdges = [];
  }

  let maxId = 0;
  state.data.graphNodes.forEach(n => {
    const idNum = parseInt(n.id, 10);
    if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
  });

  const newId = (maxId + 1).toString();
  console.log("Adding node:", newId);
  
  // Create new node with complete data structure
  const newNode = {
    id: newId,
    x: x,
    y: y,
    vx: 0,
    vy: 0,
    fx: x, // Fix position initially
    fy: y,
    index: state.data.graphNodes.length
  };
  
  // Add to data structures
  state.data.graphNodes.push(newNode);
  state.data.inputNodePositions.set(newId, { x: x, y: y });
  updateInputActionButtons();

  // Refresh the entire graph to ensure all behaviors are applied
   refreshInputGraph();
  
  restoreZoomState("input", zoomState);

  // Ensure the new node is not highlighted/selected after creation
  const newNodeSel = InputZoomContainer.selectAll("circle").filter(d => d && d.id === newId);
  console.log(`[addNewNode] Resetting highlight for new node ${newId}, selection size=${newNodeSel.size()}`);
  newNodeSel.each(function() {
    const currentHit = this.getAttribute("data-hit");
    console.log(`[addNewNode] node ${newId} prior data-hit=`, currentHit);
    this.setAttribute("data-hit", 0);
  }).style("fill", "steelblue").style("stroke", "#fff").style("stroke-width", "1.5px").attr("data-base-r", 10).attr("r", zoomAdjustedR(10, "input"));
  newNodeSel.each(function() {
    console.log(`[addNewNode] node ${newId} after reset data-hit=`, this.getAttribute("data-hit"));
  });
  
  console.log("Current graph nodes:", state.data.graphNodes);
  console.log("Current graph edges:", state.data.graphEdges);
}

  /**
   * Draw all SPQR components based on their positions in the input graph and run a force simulation on them.
   */

function drawAllSPQRComponents() {
  console.log("DRAWING ALL SPQR COMPONENTS");
  clearGraph(elements.svgSPQR);
  SPQRZoomContainer = initializeZoomContainer("spqr");

  // Step 1: Position all components at their input graph centroids, then spread them out
  const componentPositions = SPQRComponentPositionsFromInputGraph();
  
  // Step 2: Create initial component groups with calculated positions
  const groupArray = drawSPQRComponentAtPosition(componentPositions);
  
  // Step 3: Run force simulation for overall SPQR tree layout
  runSPQRForceSimulation(groupArray);
}

// Component positioning from input graph
function SPQRComponentPositionsFromInputGraph() {
  const componentPositions = new Map();
  const allCentroids = [];

  // Calculate centroid for each component
  state.data.spqrTree.forEach((comp, index) => {
    const positions = [];
    let xSum = 0, ySum = 0;

    comp.graph.forEach((_, nodeId) => {
      const pos = state.data.inputNodePositions.get(String(nodeId));
      if (pos) {
        positions.push(pos);
        xSum += pos.x;
        ySum += pos.y;
      }
    });

    if (positions.length > 0) {
      const center = {
        x: xSum / positions.length,
        y: ySum / positions.length
      };

      componentPositions.set(index, center);
      allCentroids.push(center);
    }
  });

  return componentPositions;
}

/**
 * Draw SPQR tree using Reingold-Tilford algorithm (replaces drawAllSPQRComponents)
 */
function drawSPQRTreeReingoldTilford(givenRoot = null) {
  
    if (!state.data.spqrTree || state.data.spqrTree.length === 0) {
        console.warn("❌ No SPQR tree data available");
        return;
    }

    var root;

    if (givenRoot != null) {
      root = givenRoot;
      state.data.spqrRoot = root;
    } else if (state.data.spqrManualRoot != null) {
      root = state.data.spqrManualRoot;
      state.data.spqrRoot = root;
    } else {
      root = findOptimalRoot(state.data.spqrTree);
      state.data.spqrRoot = root;
    }

    if(!root) {
        console.warn("❌ No valid root found for SPQR tree"); 
        return;
    } 

    // Get canvas dimensions
    const svgRect = elements.svgSPQR.node().getBoundingClientRect();
    
    // Build tree structure
    const tree = buildTreeStructure(root, state.data.spqrTree);

    // The rooted tree now tells every P-component which neighbour is its
    // parent. Establish its permutation before the first layout so that the
    // child order, the P pictogram's virtual edges, and the input drawing all
    // start from the same embedding.
    for (const comp of state.data.spqrTree) {
      if (comp.type === 'P') ensurePEmbeddingOrder(comp);
    }
    
    // Apply Reingold-Tilford algorithm
    const layout = reingoldTilfordLayout(tree);
    // Note: orientComponents() will be called later when the force simulation ends,
    // so we skip calling it here to avoid redundant redraws
    
    // Scale and center the layout
   // const scaledLayout = scaleAndCenterLayout(layout, svgRect.width, svgRect.height);
    
    // Store the tree's child ordering on each SPQR component so that
    // computeGraphDrawing can lay out P-node children in the same order.
    for (const [id, treeNode] of Object.entries(tree.nodes)) {
      const comp = state.data.spqrTree.find(c => c.id === id);
      if (comp && treeNode.children && treeNode.children.length > 0) {
        comp.treeChildOrder = treeNode.children.map(ch => ch.id);
      }
    }

    // Draw the tree using existing functions
    const groupArray = drawTreeWithLayout(layout, state.data.spqrTree);

   // Add this new centering code
    centerSPQRView();
    
    
    // Return the group array in case you want to add interactions later
    return groupArray;
}
function centerSPQRView() {
// Calculate bounds of all components
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

SPQRZoomContainer.selectAll("g.spqr-components").each(function () {
  const transform = d3.select(this).attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  if (!match) return;

  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  const bbox = getComponentBoundingBox(d3.select(this));
  if (!bbox) return;

  minX = Math.min(minX, x + bbox.x);
  minY = Math.min(minY, y + bbox.y);
  maxX = Math.max(maxX, x + bbox.x + bbox.width);
  maxY = Math.max(maxY, y + bbox.y + bbox.height);
});

// ---- apply padding before computing scale ----
const pad = 50;
minX -= pad;
minY -= pad;
maxX += pad;
maxY += pad;

// tree size after padding
const treeWidth  = maxX - minX;
const treeHeight = maxY - minY;
const treeCenterX = minX + treeWidth  / 2;
const treeCenterY = minY + treeHeight / 2;

console.log("Tree bounds:", {minX, minY, maxX, maxY});
console.log("Tree size:", {treeWidth, treeHeight});
console.log("Tree center:", {treeCenterX, treeCenterY});

// scale so that the larger of width/height fits svgWidth
// (swap svgWidth for svgHeight if you want height to dominate)
const marginFactor = 0.95;
const scale = (state.ui.canvasWidth / Math.max(treeWidth, treeHeight)) * marginFactor;

// translate so the padded tree is centered
const translateX = state.ui.canvasWidth  / 2 - treeCenterX * scale;
const translateY = state.ui.canvasHeight / 2 - treeCenterY * scale;

const zoom = d3.zoom().on("zoom", e => {
  SPQRZoomContainer.attr("transform", e.transform);
});

elements.svgSPQR.call(zoom);
elements.svgSPQR.call(
  zoom.transform,
  d3.zoomIdentity.translate(translateX, translateY).scale(scale)
);
}
/**
 * Find the optimal root that minimizes the maximum depth of the tree
 * Uses the efficient two-DFS diameter algorithm
 * @param {Array} spqrTree - SPQR tree data structure: Array of components
 * @returns {Object} component that minimizes the maximum depth of the tree as root
 */
function findOptimalRoot(spqrTree) {
    if (!spqrTree || spqrTree.length === 0) return null;
    if (spqrTree.length === 1) return spqrTree[0];

    // Tutorial override: pick the S-component with the most neighbours as root
    if (state.ui.preferSRoot) {
      state.ui.preferSRoot = false; // consume the flag
      const sComponents = spqrTree.filter(c => c.type === 'S');
      if (sComponents.length > 0) {
        return sComponents.reduce((best, c) =>
          (c.neighbors?.length ?? 0) > (best.neighbors?.length ?? 0) ? c : best
        );
      }
    }
    

    // Build adjacency list from neighbors
    const adjacency = {};
    spqrTree.forEach(component => {
        adjacency[component.id] = (component.neighbors || []).map(n => n.id);

    });
    
    // Step 1: DFS from any node to find one end of diameter
    const startNode = spqrTree[0];
    const firstDFS = dfsMaxDistance(startNode.id, adjacency);
    const diameterEnd1 = firstDFS.farthestNode;
    
    // Step 2: DFS from that end to find the other end of diameter
    const secondDFS = dfsMaxDistance(diameterEnd1, adjacency);
    const diameterEnd2 = secondDFS.farthestNode;
    const diameterLength = secondDFS.maxDistance;
    
    // Step 3: The center of the tree is the middle of the diameter path
    const diameterPath = findPath(diameterEnd1, diameterEnd2, adjacency);
    const typeScore = t => t === 'R' ? 2 : t === 'S' ? 1 : 0; // P scores lowest

    if (diameterPath.length % 2 == 1) {
      // Odd diameter: unique center — return it regardless of type
      return spqrTree.find(comp => comp.id === diameterPath[Math.floor(diameterPath.length / 2)]);
    }

    // Even diameter: two equally-central candidates at indices L/2-1 and L/2.
    // (floor and ceil of L/2 are identical for even L — the two middle nodes are L/2-1 and L/2.)
    const mid   = diameterPath.length / 2;
    const left  = spqrTree.find(comp => comp.id === diameterPath[mid - 1]);
    const right = spqrTree.find(comp => comp.id === diameterPath[mid]);
    if (typeScore(left.type) !== typeScore(right.type))
      return typeScore(left.type) > typeScore(right.type) ? left : right;
    if (left.neighbors.length !== right.neighbors.length)
      return left.neighbors.length > right.neighbors.length ? left : right;
    return left;
}

/**
 * DFS to find the node with maximum distance from source
 * @param {string} sourceId - Starting node ID
 * @param {Object} adjacency - Adjacency list representation
 * @returns {Object} {farthestNode: string, maxDistance: number}
 */
function dfsMaxDistance(sourceId, adjacency) {
    const visited = new Set();
    let maxDistance = 0;
    let farthestNode = sourceId;
    
    function dfs(nodeId, distance) {
        visited.add(nodeId);
        
        if (distance > maxDistance) {
            maxDistance = distance;
            farthestNode = nodeId;
        }
        
        const neighbors = adjacency[nodeId] || [];
        for (const neighborId of neighbors) {
            if (!visited.has(neighborId)) {
                dfs(neighborId, distance + 1);
            }
        }
    }
    
    dfs(sourceId, 0);
    return { farthestNode, maxDistance };
}

/**
 * Find path between two nodes in a tree
 * @param {string} start - Start node ID
 * @param {string} end - End node ID
 * @param {Object} adjacency - Adjacency list representation
 * @returns {Array} Path of node IDs from start to end
 */
function findPath(start, end, adjacency) {
    if (start === end) return [start];
    
    const visited = new Set();
    const parent = {};
    const queue = [start];
    visited.add(start);
    parent[start] = null;
    
    // BFS to find path
    while (queue.length > 0) {
        const current = queue.shift();
        
        if (current === end) {
            // Reconstruct path
            const path = [];
            let node = end;
            while (node !== null) {
                path.unshift(node);
                node = parent[node];
            }
            return path;
        }
        
        const neighbors = adjacency[current] || [];
        for (const neighborId of neighbors) {
            if (!visited.has(neighborId)) {
                visited.add(neighborId);
                parent[neighborId] = current;
                queue.push(neighborId);
            }
        }
    }
    
    return []; // Should never happen in a connected tree
}

// Updated drawing functions to use state.data instead of global variables

function drawSPQRVirtualEdgesBetweenComponents() {
  
  console.log("\n=== Drawing Virtual Edges Between Components ===");
  console.log("Total virtual edges:", state.data.virtualEdgeData.size);

  for (const [key, { components, nodes }] of state.data.virtualEdgeData.entries()) {

    
    // Debug: Check if this virtual edge is already registered with any P components
    const pComponents = state.data.spqrTree.filter(c => c.type === 'P');
    for (const pComp of pComponents) {
      const hasEdge = pComp.virtualEdgeEntry?.some(([vnodes, vid]) => 
        (vnodes[0] == nodes[0] && vnodes[1] == nodes[1]) || 
        (vnodes[0] == nodes[1] && vnodes[1] == nodes[0])
      );
      if (hasEdge) {
        console.log(`  ℹ️ Virtual edge found in P component ${pComp.id}`);
      }
    }

    if (components.length !== 2) {
      console.warn(`  ⚠️ Skipping - not connected to exactly 2 components:`, components);
      continue;
    }

    const [compAID, compBID] = components;
    const [u, v] = nodes;

    const indexA = state.data.spqrTree.findIndex(c => c.id === compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === compBID);

    if (indexA === -1 || indexB === -1) {
      console.error(`  ❌ Component ID not found in SPQR tree: ${compAID}, ${compBID}`);
      continue;
    }

    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);
    const compA = state.data.spqrTree[indexA];
    const compB = state.data.spqrTree[indexB];


    // Find midpoints considering component types
    const midA = findVirtualEdgeMidpoint(compAGroup, compA, u, v);
    const midB = findVirtualEdgeMidpoint(compBGroup, compB, u, v);

    if (midA && midB) {


      // Create or update the virtual edge
      // Use the actual virtual edge key from our data structure
      const edgeKey = key; // This is the key from virtualEdgeData

      
      // Get the specific virtual edge IDs used in each component
      const compAVirtualId = compA.type === 'P' ? 
        compA.virtualEdgeEntry.find(([nodes, id]) => 
          (nodes[0] == u && nodes[1] == v) || (nodes[0] == v && nodes[1] == u)
        )?.[1] : null;
        
      const compBVirtualId = compB.type === 'P' ? 
        compB.virtualEdgeEntry.find(([nodes, id]) => 
          (nodes[0] == u && nodes[1] == v) || (nodes[0] == v && nodes[1] == u)
        )?.[1] : null;
      
      const existingEdge = SPQRZoomContainer.select(`[data-link-id="${edgeKey}"]`);
      
      if (existingEdge.empty()) {
        // Create new edge
        SPQRZoomContainer.append("line")
          .attr("x1", midA.x)
          .attr("y1", midA.y)
          .attr("x2", midB.x)
          .attr("y2", midB.y)
          .attr("stroke", "orange")
          .attr("stroke-dasharray", "4 2")
          .attr("stroke-width", 2)
          .attr("class", "inter-component-virtual-edge")
          .attr("data-link-id", edgeKey)
          .attr("data-source-comp", compAID)
          .attr("data-target-comp", compBID)
          .attr("data-source-node", u)
          .attr("data-target-node", v)
          .attr("data-source-virtual-id", compAVirtualId)
          .attr("data-target-virtual-id", compBVirtualId)
          .style("cursor", "pointer")
          .on("mouseover", function() {
            // Highlight corresponding edge in input graph
            console.log(`🔗 Hovering virtual edge [${u}, ${v}]`);
            console.log(`   Source comp: ${compAID}, Target comp: ${compBID}`);
            highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
          })
          .on("mouseout", function() {
            // Unhighlight edge in input graph
            console.log(`🔗 Left virtual edge [${u}, ${v}]`);
            unhighlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
          });
      } else {
        // Update existing edge
        existingEdge
          .attr("x1", midA.x)
          .attr("y1", midA.y)
          .attr("x2", midB.x)
          .attr("y2", midB.y);
      }
    } else {
      console.warn(`  ⚠️ Skipping line draw - missing midpoints:`);
      console.warn(`    A: ${midA ? '✓' : '✗'}, B: ${midB ? '✓' : '✗'}`);
    }
  }
    
}

function findVirtualEdgeMidpoint(groupSelection, component, u, v) {


  if (component.type === 'P') {

    
    // Find the specific virtual edge that connects to the target component
    const targetComponents = [...state.data.virtualEdgeData.entries()]
      .filter(([_, data]) => {
        const [compA, compB] = data.components;
        const [nodeA, nodeB] = data.nodes;
        return (nodeA == u && nodeB == v || nodeA == v && nodeB == u) &&
               (compA === component.id || compB === component.id);
      })
      .map(([key, _]) => key);
      
    console.log("    Possible virtual edge keys:", targetComponents);
    
    // Find virtual edge entry that matches one of these keys
    const virtualEdgeEntry = component.virtualEdgeEntry.find(([nodes, virtualEdgeId]) => 
      targetComponents.includes(virtualEdgeId) &&
      ((nodes[0] == u && nodes[1] == v) || (nodes[0] == v && nodes[1] == u))
    );
    
    if (!virtualEdgeEntry) {
      console.warn("    ⚠️ No matching virtual edge entry found in component");
      console.warn("    Nodes:", u, v, "Virtual edge keys:", targetComponents);
      return null;
    }

    const virtualEdgeId = virtualEdgeEntry[1];

    const virtualPath = groupSelection.selectAll(".edge-virtual")
      .filter(d => {
        const match = (d.source.id == u && d.target.id == v && d.virtualEdgeId == virtualEdgeId) ||
                     (d.source.id == v && d.target.id == u && d.virtualEdgeId == virtualEdgeId);
        if (match) console.log("    Found matching path:", d);
        return match;
      })
      .node();

    if (!virtualPath) {
      console.warn("    ⚠️ No matching virtual path found");
      return null;
    }

    const transform = groupSelection.attr("transform");
    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
    const offsetX = match ? parseFloat(match[1]) : 0;
    const offsetY = match ? parseFloat(match[2]) : 0;


    const pathLength = virtualPath.getTotalLength();
    const midPoint = virtualPath.getPointAtLength(pathLength / 2);


    const result = {
      x: midPoint.x + offsetX,
      y: midPoint.y + offsetY
    };

    return result;
  } else {
    const edge = groupSelection.selectAll(".edge-virtual")
      .filter(d => {
        const match = (d.source.id == u && d.target.id == v) ||
                     (d.source.id == v && d.target.id == u);
        if (match) console.log("    Found matching edge:", d);
        return match;
      })
      .node();

    if (!edge) {
      console.warn("    ⚠️ No matching virtual edge found");
      return null;
    }

    const transform = groupSelection.attr("transform");
    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
    const offsetX = match ? parseFloat(match[1]) : 0;
    const offsetY = match ? parseFloat(match[2]) : 0;

    const x1 = parseFloat(edge.getAttribute("x1"));
    const y1 = parseFloat(edge.getAttribute("y1"));
    const x2 = parseFloat(edge.getAttribute("x2"));
    const y2 = parseFloat(edge.getAttribute("y2"));


    const result = {
      x: (x1 + x2) / 2 + offsetX,
      y: (y1 + y2) / 2 + offsetY
    };
    return result;
  }
}

function updateInterComponentVirtualEdgesLegacy() {
  // Remove old lines
  d3.selectAll(".inter-component-virtual-edge").remove();

  for (const [id, data] of state.data.virtualEdgeData.entries()) {
    const { components, nodes } = data;

    if (!components || components.length !== 2 || !nodes || nodes.length !== 2) {
      console.warn(`Skipping invalid virtual edge entry for id=${id}`, data);
      continue;
    }

    const [compAID, compBID] = components;
    const [u, v] = nodes;

    const indexA = state.data.spqrTree.findIndex(c => c.id === compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === compBID);
    if (indexA === -1 || indexB === -1) {
      console.warn(`Could not find component indices for ${compAID}, ${compBID}`);
      continue;
    }

    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);
    const twinPortA = findMidpoint(compAGroup, u, v, id);
    const twinPortB = findMidpoint(compBGroup, u, v, id);

    // Get positions and bounding boxes for both components
    const posA = getComponentPosition(compAGroup);
    const posB = getComponentPosition(compBGroup);
    const bboxA = getComponentBoundingBox(compAGroup);
    const bboxB = getComponentBoundingBox(compBGroup);

    if (!posA || !posB || !bboxA || !bboxB) {
      console.warn(`Skipping edge draw — missing position or bbox data for id=${id}`);
      continue;
    }

    // Calculate component centers
    const compACenterX = posA.x + bboxA.x + bboxA.width / 2;
    const compACenterY = posA.y + bboxA.y + bboxA.height / 2;
    const compBCenterX = posB.x + bboxB.x + bboxB.width / 2;
    const compBCenterY = posB.y + bboxB.y + bboxB.height / 2;

    // Calculate horizontal and vertical distances
    const deltaX = Math.abs(compBCenterX - compACenterX);
    const deltaY = Math.abs(compBCenterY - compACenterY);

    let pointA = twinPortA;
    let pointB = twinPortB;

    // In free-positioning mode, pick the axis where the two centers are furthest apart,
    // but only use horizontal (left/right) snapping when the child box is not entirely
    // below the parent box — i.e. at least part of the child overlaps the parent vertically.
    // In tree mode, always connect top/bottom.
    const parentBottomY = compACenterY <= compBCenterY
      ? posA.y + bboxA.y + bboxA.height
      : posB.y + bboxB.y + bboxB.height;
    const childTopY = compACenterY <= compBCenterY
      ? posB.y + bboxB.y
      : posA.y + bboxA.y;
    const childOverlapsParentVertically = childTopY < parentBottomY;
    const useHorizontal = state.ui_state.spqrFreePositioning && deltaX > deltaY && childOverlapsParentVertically;

    if (!pointA || !pointB) {
      pointA = null;
      pointB = null;
    }

    if ((!pointA || !pointB) && !useHorizontal) {
      // Use top/bottom connections (default tree-like appearance)
      if (compACenterY < compBCenterY) {
        // A is above B
        pointA = {
          x: compACenterX,
          y: posA.y + bboxA.y + bboxA.height
        };
        pointB = {
          x: compBCenterX,
          y: posB.y + bboxB.y
        };
      } else {
        // B is above A
        pointA = {
          x: compACenterX,
          y: posA.y + bboxA.y
        };
        pointB = {
          x: compBCenterX,
          y: posB.y + bboxB.y + bboxB.height
        };
      }
    } else if (!pointA || !pointB) {
      // Use left/right connections (horizontal, only when both are dragged)
      if (compACenterX < compBCenterX) {
        // A is left of B
        pointA = {
          x: posA.x + bboxA.x + bboxA.width,
          y: compACenterY
        };
        pointB = {
          x: posB.x + bboxB.x,
          y: compBCenterY
        };
      } else {
        // B is left of A
        pointA = {
          x: posA.x + bboxA.x,
          y: compACenterY
        };
        pointB = {
          x: posB.x + bboxB.x + bboxB.width,
          y: compBCenterY
        };
      }
    }

    if (pointA && pointB) {
      SPQRZoomContainer.insert("line", ":first-child")
        .attr("x1", pointA.x)
        .attr("y1", pointA.y)
        .attr("x2", pointB.x)
        .attr("y2", pointB.y)
        .attr("stroke", data.color ?? "orange")
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.72)
        .attr("data-virtual-edge-id", id)
        .attr("class", "inter-component-virtual-edge")
        .style("pointer-events", "none")
        .on("mouseover", function() {
          // Highlight corresponding edge in input graph
          console.log(`🔗 Hovering virtual edge [${u}, ${v}]`);
          highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
        })
        .on("mouseout", function() {
          // Unhighlight edge in input graph
          console.log(`🔗 Left virtual edge [${u}, ${v}]`);
          unhighlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), "orange");
          
          // Check if the components connected by this edge are selected/hovered and restore their colors
          const edgeVirtualEdgeData = state.data.virtualEdgeData.get(id);
          if (edgeVirtualEdgeData) {
            // Get all components that share this virtual edge
            for (const compId of edgeVirtualEdgeData.components) {
              const comp = state.data.spqrTree.find(c => c.id === compId);
              if (comp && (comp.isSelected || comp.isHovered)) {
                const compColor = comp.type === "R" ? "red" : comp.type === "S" ? "green" : "blue";
                highlightEdgeWithOpacity(state.d3selections.linkInput, String(u), String(v), compColor, true);
                break; // Only need to restore one color (either selected or hovered component)
              }
            }
          }
        });
    } else {
      console.warn(`Skipping edge draw — upperPoint or lowerPoint missing for id=${id}`);
    }
  }
}


function updateInterComponentVirtualEdges() {
  d3.selectAll(".inter-component-virtual-edge").remove();

  for (const [id, data] of state.data.virtualEdgeData.entries()) {
    const { components, nodes } = data;
    if (!components || components.length !== 2 || !nodes || nodes.length !== 2) {
      continue;
    }

    const [compAID, compBID] = components;
    const indexA = state.data.spqrTree.findIndex(comp => comp.id === compAID);
    const indexB = state.data.spqrTree.findIndex(comp => comp.id === compBID);
    if (indexA === -1 || indexB === -1) continue;

    const compA = state.data.spqrTree[indexA];
    const compB = state.data.spqrTree[indexB];
    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);
    const posA = getComponentPosition(compAGroup);
    const posB = getComponentPosition(compBGroup);
    const boxA = getComponentBoundingBox(compAGroup);
    const boxB = getComponentBoundingBox(compBGroup);
    if (!posA || !posB || !boxA || !boxB) continue;

    const aIsParent = (compA.treeLevel ?? Infinity) < (compB.treeLevel ?? Infinity);
    const parentPos = aIsParent ? posA : posB;
    const parentBox = aIsParent ? boxA : boxB;
    const childPos = aIsParent ? posB : posA;
    const childBox = aIsParent ? boxB : boxA;

    const parentPort = {
      x: parentPos.x + parentBox.x + parentBox.width / 2,
      y: parentPos.y + parentBox.y + parentBox.height
    };
    const childPort = {
      x: childPos.x + childBox.x + childBox.width / 2,
      y: childPos.y + childBox.y
    };

    SPQRZoomContainer.insert("line", ":first-child")
      .attr("x1", parentPort.x)
      .attr("y1", parentPort.y)
      .attr("x2", childPort.x)
      .attr("y2", childPort.y)
      .attr("stroke", data.color ?? "orange")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.72)
      .attr("data-virtual-edge-id", id)
      .attr("class", "inter-component-virtual-edge")
      .style("pointer-events", "none");
  }
}

// Helper function to get component position from transform
function getComponentPosition(group) {
  if (group.empty()) return null;
  
  const transform = group.attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  
  if (match) {
    return {
      x: parseFloat(match[1]),
      y: parseFloat(match[2])
    };
  }
  
  return { x: 0, y: 0 };
}

// Helper function to get component bounding box
function getComponentBoundingBox(group) {
  if (group.empty()) return null;
  
  const boundingRect = group.select(".bounding-box");
  
  if (boundingRect.empty()) return null;
  
  return {
    x: parseFloat(boundingRect.attr("x")),
    y: parseFloat(boundingRect.attr("y")),
    width: parseFloat(boundingRect.attr("width")),
    height: parseFloat(boundingRect.attr("height"))
  };
}


function findMidpoint(groupSelection, u, v, virtualEdgeId) {
  // Select all virtual edges in the group
  let edgeSelection = groupSelection.selectAll(".edge-virtual")
    .filter(d => {
      // Either direction: (u -> v) or (v -> u)
      return (d.source.id == u && d.target.id == v) ||
             (d.source.id == v && d.target.id == u);
    });

  // If multiple matches (P-component), filter further by virtual edge id
  if (edgeSelection.size() > 1 && virtualEdgeId !== undefined) {
    edgeSelection = edgeSelection.filter(d => d.virtualEdgeId === virtualEdgeId);
  }

  const edge = edgeSelection.node();
  if (!edge) {
    console.warn(`Virtual edge ${virtualEdgeId} not found in group ${groupSelection.attr("id")}`);
    return null;
  }

  // Get group's translation
  const transform = groupSelection.attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  const offsetX = match ? parseFloat(match[1]) : 0;
  const offsetY = match ? parseFloat(match[2]) : 0;

  // Path midpoint vs line midpoint
  if (edge.tagName.toLowerCase() === 'path') {
    let midPoint = null;
    if (
      typeof edge.getTotalLength === "function"
      && typeof edge.getPointAtLength === "function"
    ) {
      const pathLength = edge.getTotalLength();
      midPoint = edge.getPointAtLength(pathLength / 2);
    } else {
      // P pictograms use a single quadratic Bézier segment:
      // M x0,y0 Q cx,cy x1,y1. Its t=1/2 point is available directly,
      // avoiding a dependency on optional SVG path-measurement methods.
      const values = (edge.getAttribute("d") || "")
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)
        ?.map(Number);
      if (values?.length >= 6) {
        midPoint = {
          x: 0.25 * values[0] + 0.5 * values[2] + 0.25 * values[4],
          y: 0.25 * values[1] + 0.5 * values[3] + 0.25 * values[5]
        };
      }
    }
    if (!midPoint) return null;
    return { x: midPoint.x + offsetX, y: midPoint.y + offsetY };
  } else {
    const x1 = parseFloat(edge.getAttribute("x1"));
    const y1 = parseFloat(edge.getAttribute("y1"));
    const x2 = parseFloat(edge.getAttribute("x2"));
    const y2 = parseFloat(edge.getAttribute("y2"));
    return { x: (x1 + x2) / 2 + offsetX, y: (y1 + y2) / 2 + offsetY };
  }
}



function getBoundingBox(nodeMap) {
  const xs = Array.from(nodeMap.values()).map(p => p.x);
  const ys = Array.from(nodeMap.values()).map(p => p.y);
  return {
    minX: Math.min(...xs) - 10,
    maxX: Math.max(...xs) + 10,
    minY: Math.min(...ys) - 10,
    maxY: Math.max(...ys) + 10,
  };
}



function getOrderedNodes(comp) {
  const visited = new Set();
  const order = [];

  function dfs(v, prev) {
    visited.add(v);
    order.push(v);
    for (const w of comp.graph.get(v) || []) {
      if (!visited.has(w)) {
        dfs(w, v);
      }
    }
  }

  // Start from first node in the graph
  const start = comp.graph.keys().next().value;
  dfs(start, null);
  return order;
}


/**
 * Rotate (and if needed mirror) nodeMap in-place so:
 *   1. The parent virtual edge has the same angle as in the input graph.
 *   2. The interior vertices sit on the same side of that edge as they do
 *      in the input graph (fixes mirror-image artefacts).
 */
function alignNodeMapVirtualEdgeTop(nodeMap, comp) {
  const parentEdge = findParentVirtualEdge(comp);
  const edgeNodes  = parentEdge ?? (comp.virtualEdgeEntry.length > 0 ? comp.virtualEdgeEntry[0][0] : null);
  if (!edgeNodes) return;

  const [u, v] = edgeNodes;
  const uPic = nodeMap.get(Number(u));
  const vPic = nodeMap.get(Number(v));
  if (!uPic || !vPic) return;

  // Rotate so u→v is horizontal
  const picAngle = Math.atan2(vPic.y - uPic.y, vPic.x - uPic.x);
  if (Math.abs(picAngle) > 1e-4) {
    const cos = Math.cos(-picAngle), sin = Math.sin(-picAngle);
    for (const [id, { x, y }] of nodeMap)
      nodeMap.set(id, { x: x * cos - y * sin, y: x * sin + y * cos });
  }

  // Ensure interior nodes sit below the virtual edge (larger y = lower in SVG)
  const uP = nodeMap.get(Number(u));
  const attachIds = new Set([Number(u), Number(v)]);
  let interiorYSum = 0, interiorCount = 0;
  for (const [id, pos] of nodeMap) {
    if (!attachIds.has(id)) { interiorYSum += pos.y; interiorCount++; }
  }
  if (interiorCount > 0 && interiorYSum / interiorCount < uP.y) {
    for (const [id, { x, y }] of nodeMap)
      nodeMap.set(id, { x, y: -y });
  }
}

function alignNodeMapToInputGraph(nodeMap, comp) {
  const parentEdge = findParentVirtualEdge(comp);
  const edgeNodes  = parentEdge ?? (comp.virtualEdgeEntry.length > 0 ? comp.virtualEdgeEntry[0][0] : null);
  if (!edgeNodes) return;

  const [u, v] = edgeNodes;
  const uIn = state.data.inputNodePositions.get(String(u));
  const vIn = state.data.inputNodePositions.get(String(v));
  if (!uIn || !vIn) return;

  // ── Step 1: rotate to match the virtual-edge angle ────────────────────────
  const uPic = nodeMap.get(Number(u));
  const vPic = nodeMap.get(Number(v));
  if (!uPic || !vPic) return;

  const picAngle   = Math.atan2(vPic.y - uPic.y, vPic.x - uPic.x);
  const inputAngle = Math.atan2(vIn.y  - uIn.y,  vIn.x  - uIn.x);
  const delta = inputAngle - picAngle;

  if (Math.abs(delta) > 1e-4) {
    const cos = Math.cos(delta), sin = Math.sin(delta);
    for (const [id, { x, y }] of nodeMap)
      nodeMap.set(id, { x: x * cos - y * sin, y: x * sin + y * cos });
  }

  // ── Step 2: check which side of the edge the interior sits on ─────────────
  // cross(v-u, p-u) > 0  ⟹  p is to the left of the directed edge u→v
  const uP = nodeMap.get(Number(u));
  const vP = nodeMap.get(Number(v));
  const edX = vP.x - uP.x,  edY = vP.y - uP.y;
  const edXin = vIn.x - uIn.x, edYin = vIn.y - uIn.y;

  const attachIds = new Set([Number(u), Number(v)]);
  let picSide = 0, inputSide = 0;

  for (const [id, pos] of nodeMap) {
    if (attachIds.has(id)) continue;
    picSide += edX * (pos.y - uP.y) - edY * (pos.x - uP.x);

    const posIn = state.data.inputNodePositions.get(String(id));
    if (posIn) inputSide += edXin * (posIn.y - uIn.y) - edYin * (posIn.x - uIn.x);
  }

  // ── Step 3: if sides disagree, reflect across the virtual-edge axis ───────
  if (picSide !== 0 && inputSide !== 0 && Math.sign(picSide) !== Math.sign(inputSide)) {
    // Unit vector along the edge
    const len = Math.hypot(edX, edY);
    if (len < 1e-6) return;
    const dX = edX / len, dY = edY / len;
    // Midpoint of the edge (used as the pivot on the reflection line)
    const mX = (uP.x + vP.x) / 2, mY = (uP.y + vP.y) / 2;

    for (const [id, { x, y }] of nodeMap) {
      const px = x - mX, py = y - mY;              // translate to midpoint
      const dot = px * dX + py * dY;
      nodeMap.set(id, {
        x: 2 * dot * dX - px + mX,                 // reflect + translate back
        y: 2 * dot * dY - py + mY,
      });
    }
  }
}

/**
 * Apply the orientation contract shared by S- and R-node pictograms.
 * Non-root components are anchored by their directed parent virtual edge;
 * roots use the best labelled-vertex rotation/reflection.
 */
function orientNodeMapForComponent(nodeMap, comp, anchorEdge = null) {
  const parentEdge = findParentVirtualEdge(comp);
  const effectiveAnchor = anchorEdge ?? parentEdge;

  if (effectiveAnchor) {
    const result = orientNodeMapByAnchor(
      nodeMap,
      state.data.inputNodePositions,
      effectiveAnchor,
      [...comp.graph.keys()]
    );
    if (!result.matched && parentEdge) {
      alignNodeMapVirtualEdgeTop(nodeMap, comp);
    }
    return result;
  }

  return orientRootNodeMap(
    nodeMap,
    state.data.inputNodePositions,
    [...comp.graph.keys()]
  );
}

/**
 * Uniformly scale and centre a skeleton inside the shared SPQR-node square.
 */
function fitNodeMapToPictogram(nodeMap) {
  const positions = [...nodeMap.values()];
  if (positions.length === 0) return;

  const minX = Math.min(...positions.map(position => position.x));
  const maxX = Math.max(...positions.map(position => position.x));
  const minY = Math.min(...positions.map(position => position.y));
  const maxY = Math.max(...positions.map(position => position.y));
  const width = maxX - minX;
  const height = maxY - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const horizontalScale = width > 0
    ? spqrComponentContentWidth / width
    : Infinity;
  const verticalScale = height > 0
    ? spqrComponentContentHeight / height
    : Infinity;
  const finiteScales = [horizontalScale, verticalScale].filter(Number.isFinite);
  const scale = finiteScales.length > 0 ? Math.min(...finiteScales) : 1;

  for (const position of nodeMap.values()) {
    position.x = (position.x - centerX) * scale;
    position.y = (position.y - centerY) * scale + spqrComponentContentCenterY;
  }
}

function drawRComponentAsSubgraph(group, comp) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));

  const links = [];
  const virtualLinks = [];

  // Create virtual edge map for lookup (key -> virtualEdgeId)
  const virtualEdgeMap = new Map();
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [[v1, v2], id] = virtEdge;
    virtualEdgeMap.set(`${v1}-${v2}`, id);
    virtualEdgeMap.set(`${v2}-${v1}`, id);
  });

  // Extract links
  comp.graph.forEach((nbrs, v) => {
    if (!nbrs || nbrs.length === 0) {
      const ns = Array.from(comp.graph.keys());
      if (ns.length >= 2) {
        const [s, t] = [String(ns[0]), String(ns[1])];
        virtualLinks.push({ source: s, target: t, virtualEdgeId: virtualEdgeMap.get(`${s}-${t}`) });
      }
      return;
    }

    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        const virtualEdgeId = virtualEdgeMap.get(`${src}-${tgt}`);
        (virtualEdgeId !== undefined ? virtualLinks : links).push({ source: src, target: tgt, virtualEdgeId });
      }
    });
  });

  // ── Try Tutte embedding (for planar subgraphs) ──────────────
  const nodeMap = computeRComponentPositions(comp);
  orientNodeMapForComponent(nodeMap, comp);
  fitNodeMapToPictogram(nodeMap);

  const compGroup = group.append("g")
    .attr("class", "spqr-component")
    .attr("data-comp-id", comp.id)
    .attr("id", `spqr-component-${comp.id}`);

  // Draw normal edges
  compGroup.selectAll(".edge-normal")
    .data(links)
    .enter()
    .append("line")
    .attr("class", "edge-normal")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", "gray")
    .attr("stroke-width", 1.5);

  // Draw virtual edges
  compGroup.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("data-virtual-color", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("data-virtual-edge-id", d => d.virtualEdgeId)
    .attr("data-source-id", d => d.source)
    .attr("data-target-id", d => d.target)
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({
      source: { id: d.source },
      target: { id: d.target },
      virtualEdgeId: d.virtualEdgeId
    }));

  // Draw nodes
  compGroup.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("data-node-id", d => d.id)
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("data-base-r", 6)
    .attr("r", zoomAdjustedR(6, "spqr"))
    .attr("fill", "#3498db");

  // Add bounding box and hover
  addComponentBoundingElements(compGroup, nodeMap, comp.id);
  addComponentHoverEvents(compGroup, comp.id);
}

/**
 * Compute node positions for an R component.
 *
 * Pipeline:
 *   1. Run planarity test + embedding on the component subgraph.
 *   2. If planar → extract faces → choose outer face → Tutte embedding.
 *   3. If not planar (or Tutte fails) → fall back to input graph positions.
 *
 * The outer face is chosen to contain a virtual edge (so the attachment
 * points sit on the convex hull of the drawing).
 *
 * @param {Object} comp  SPQR component with .graph and .virtualEdgeEntry
 * @returns {Map<number, {x:number, y:number}>}  centred, scaled positions
 */
function computeRComponentPositions(comp) {
  const nodeMap = new Map();
  const DEBUG = true; // Set to false to suppress Tutte debug output

  try {
    // Build a clean adjacency map (numeric keys) from the component graph
    const subgraph = new Map();
    for (const [v, nbrs] of comp.graph) {
      subgraph.set(Number(v), (nbrs || []).filter(w => comp.graph.has(w)).map(Number));
    }

    const V = subgraph.size;
    let E = 0;
    for (const nbrs of subgraph.values()) E += nbrs.length;
    E /= 2;

    if (DEBUG) {
      console.group(`🔷 R component ${comp.id}  (V=${V}, E=${E})`);
      console.log('Subgraph adjacency:');
      for (const [v, nbrs] of subgraph) {
        console.log(`  ${v} → [${nbrs.join(', ')}]`);
      }
      console.log('Virtual edges:', comp.virtualEdgeEntry.map(ve => `${ve[0][0]}-${ve[0][1]}`).join(', '));
    }

    // Step 1: planarity test + embedding
    const { planar, embedding } = isPlanarAndEmbed(subgraph);

    if (DEBUG) {
      console.log(`Step 1 – Planarity: ${planar ? '✅ planar' : '❌ non-planar'}`);
      if (embedding) {
        console.log('Embedding (rotation system):');
        for (const [v, rot] of embedding) {
          console.log(`  ${v} → [${rot.join(', ')}]`);
        }
        // Validate embedding
        const validation = validateEmbedding(subgraph, embedding);
        if (!validation.valid) {
          console.warn('⚠️ Embedding validation FAILED:');
          validation.errors.forEach(err => console.warn('  •', err));
        } else {
          console.log('Embedding validation: ✅ passed');
        }
      }
    }

    if (planar && embedding) {
      // Step 2: extract faces from the combinatorial embedding
      const faces = extractFaces(embedding);

      if (DEBUG) {
        console.log(`Step 2 – Faces (${faces.length}):`);
        faces.forEach((f, i) => console.log(`  F${i}: [${f.join(', ')}]  (size ${f.length})`));
        // Euler check: V - E + F should equal 2
        const euler = V - E + faces.length;
        console.log(`Euler check: V(${V}) - E(${E}) + F(${faces.length}) = ${euler}  ${euler === 2 ? '✅' : '⚠️ expected 2'}`);
      }

      if (faces.length >= 1) {
        // Step 3: pick the best outer face
        const parentVirtualEdge = findParentVirtualEdge(comp);
        const storedOuterFace = state.data.componentPoses
          ?.get(comp.id)
          ?.outerFace;
        const storedFaceIsValid = Array.isArray(storedOuterFace)
          && storedOuterFace.length >= 3
          && storedOuterFace.every(vertex => subgraph.has(Number(vertex)));
        const outerFace = storedFaceIsValid
          ? storedOuterFace.map(Number)
          : selectOuterFace(faces, comp, parentVirtualEdge);

        if (DEBUG) {
          console.log(`Step 3 – Parent virtual edge: ${parentVirtualEdge ? parentVirtualEdge.join('-') : 'none (root)'}`);
          console.log(`Step 3 – Outer face: [${outerFace ? outerFace.join(', ') : 'null'}]`);
        }

        if (outerFace && outerFace.length >= 3) {
          // Step 4: compute Tutte embedding
          const tuttePos = tutteEmbedding(subgraph, outerFace);

          if (DEBUG) {
            console.log('Step 4 – Tutte positions (raw):');
            let hasNaN = false;
            for (const [v, {x, y}] of tuttePos) {
              const nan = isNaN(x) || isNaN(y);
              if (nan) hasNaN = true;
              console.log(`  ${v}: (${x.toFixed(4)}, ${y.toFixed(4)})${nan ? ' ⚠️ NaN!' : ''}`);
            }
            if (hasNaN) console.warn('⚠️ Tutte embedding contains NaN values!');
          }

          // Step 5: scale to fit the component box size
          const maxAllowed = 80 + comp.graph.size * 4;
          const scaled = scaleToBox(tuttePos, maxAllowed, maxAllowed, 6);

          // Centre around (0, 0)
          let cx = 0, cy = 0, n = 0;
          for (const { x, y } of scaled.values()) { cx += x; cy += y; n++; }
          cx /= n; cy /= n;

          for (const [v, { x, y }] of scaled) {
            nodeMap.set(Number(v), { x: x - cx, y: y - cy });
          }

          if (DEBUG) {
            console.log(`Step 5 – Final positions (maxAllowed=${maxAllowed}):`);
            for (const [v, {x, y}] of nodeMap) {
              console.log(`  ${v}: (${x.toFixed(2)}, ${y.toFixed(2)})`);
            }
            // Check for coincident vertices
            const pts = [...nodeMap.values()];
            for (let i = 0; i < pts.length; i++) {
              for (let j = i + 1; j < pts.length; j++) {
                const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
                if (dist < 0.5) {
                  const keys = [...nodeMap.keys()];
                  console.warn(`⚠️ Vertices ${keys[i]} and ${keys[j]} are nearly coincident (dist=${dist.toFixed(4)})`);
                }
              }
            }
            console.log(`✅ Tutte embedding used (${nodeMap.size} nodes)`);
            console.groupEnd();
          }
          return nodeMap;
        }
      }
    }

    if (DEBUG) {
      console.warn('⚠️ Tutte pipeline did not complete — falling back to input positions.');
      console.groupEnd();
    }
  } catch (e) {
    console.warn(`R component ${comp.id}: Tutte embedding failed, falling back to input positions.`, e);
    try { console.groupEnd(); } catch(_) {}
  }

  // ── Fallback: use input graph positions (original behaviour) ───
  return computeRComponentPositionsFallback(comp);
}

/**
 * Choose the best outer face for the Tutte embedding.
 *
 * Priority order:
 *   1. **Largest** face containing both endpoints of the **parent** virtual edge
 *      (the edge connecting to the parent in the Reingold-Tilford tree).
 *      This ensures the parent attachment sits on the convex hull.
 *   2. Largest face containing both endpoints of *any* virtual edge.
 *   3. Largest face overall.
 *
 * Using the largest qualifying face avoids cramming many interior
 * vertices into a small triangle.
 */
function selectOuterFace(faces, comp, parentVirtualEdge = null) {
  // Collect virtual edge endpoint pairs
  const virtualPairs = comp.virtualEdgeEntry.map(ve => {
    const [v1, v2] = ve[0];
    return [Number(v1), Number(v2)];
  });

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

  // 1. Prefer a face containing the PARENT virtual edge endpoints
  if (parentVirtualEdge) {
    const [pu, pv] = [Number(parentVirtualEdge[0]), Number(parentVirtualEdge[1])];
    const parentFace = largestFaceWith(pu, pv);
    if (parentFace && parentFace.length >= 3) {
      return parentFace;
    }
  }

  // 2. Largest face containing any virtual edge
  let bestVirtFace = null;
  for (const [u, v] of virtualPairs) {
    const f = largestFaceWith(u, v);
    if (f && (!bestVirtFace || f.length > bestVirtFace.length)) {
      bestVirtFace = f;
    }
  }
  if (bestVirtFace && bestVirtFace.length >= 3) return bestVirtFace;

  // 3. Fallback: largest face
  return findLargestFace(faces);
}

/**
 * Original fallback: position nodes using stored input graph positions.
 */
function computeRComponentPositionsFallback(comp) {
  const nodeMap = new Map();
  const positions = [];

  comp.graph.forEach((_, nodeId) => {
    const pos = state.data.inputNodePositions.get(String(nodeId));
    if (pos) positions.push(pos);
  });

  let centroid = { x: 0, y: 0 };
  if (positions.length > 0) {
    centroid.x = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    centroid.y = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  }

  comp.graph.forEach((_, nodeId) => {
    const pos = state.data.inputNodePositions.get(String(nodeId));
    if (pos) {
      nodeMap.set(Number(nodeId), { x: pos.x - centroid.x, y: pos.y - centroid.y });
    }
  });

  // Scale to fit
  const xs = Array.from(nodeMap.values()).map(p => p.x);
  const ys = Array.from(nodeMap.values()).map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const maxDim = Math.max(maxX - minX, maxY - minY);
  const maxAllowed = 80 + comp.graph.size * 4;
  if (maxDim > maxAllowed) {
    const scale = maxAllowed / maxDim;
    nodeMap.forEach((p, k) => {
      nodeMap.set(k, { x: p.x * scale, y: p.y * scale });
    });
  }

  return nodeMap;
}



// Draw SPQR components at specified positions
function drawSPQRComponentAtPosition(componentPositions) {
  const groupArray = [];
  
  state.data.spqrTree.forEach((comp, index) => {
    let offsetX = 0, offsetY = 0;
    
    if (componentPositions.has(index)) {
      const pos = componentPositions.get(index);
      offsetX = pos.x;
      offsetY = pos.y;
    }

    // Store the default position for this component
    state.data.componentDefaultPositions.set(comp.id, { x: offsetX, y: offsetY });

    const currentGroup = SPQRZoomContainer.append("g")
      .attr("class", "spqr-component spqr-components")
      .attr("data-comp-id", comp.id)
      .attr("id", `spqr-component-${index}`)
      .attr("transform", `translate(${offsetX}, ${offsetY})`);

    // Store initial position as data
    currentGroup.datum({ x: offsetX, y: offsetY, index: index });
    
    SPQRComponentDragAndClickBehaivour(currentGroup, comp, index);
    groupArray.push(currentGroup);
    
    // Draw the component (now properly awaited if needed)
    drawSPQRComponentAsPictogram(currentGroup, comp);
  });
  
  return groupArray;
}

// Run force simulation with improved timing
function runSPQRForceSimulation(groupArray) {
  // Create simulation data for component positioning
  const simulationNodes = groupArray.map((group, index) => {
    const datum = group.datum();
    const { x = 0, y = 0, boundingRect } = datum;

    return {
      id: index,
      x,
      y,
      width: boundingRect?.width || 100,
      height: boundingRect?.height || 100,
      group,
      component: state.data.spqrTree[index]
    };
  });

  // Create links between connected components
  const simulationLinks = [];
  state.data.allVirtualTwinEdgeLinks.forEach(edge => {
    const indexA = state.data.spqrTree.findIndex(c => c.id === edge.compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === edge.compBID);
    
    if (indexA !== -1 && indexB !== -1) {
      simulationLinks.push({
        source: indexA,
        target: indexB,
        edge: edge
      });
    }
  });

  // Run force simulation for component layout
  const simulation = d3.forceSimulation(simulationNodes)
    .force("link", d3.forceLink(simulationLinks)
      .id(d => d.id)
      .distance(40)
      .strength(0.05))
    .force("charge", d3.forceManyBody().strength(-80))
    .force("center", d3.forceCenter(500, 500))
    .force("collision", d3.forceCollide(d => {
      const r = Math.sqrt(d.width ** 2 + d.height ** 2) / 2;
      return r + 10;
    }))
    .alpha(0.8)
    .alphaDecay(0.04);

  // Initial orientation
  orientComponents();
  
  let tickCount = 0;
  const STABLE_TICK_THRESHOLD = 20; // Wait for simulation to stabilize before updating

  // Update component positions during simulation
  simulation.on("tick", () => {
    tickCount++;
    
    simulationNodes.forEach(node => {
      node.group.attr("transform", `translate(${node.x}, ${node.y})`);
      // Update stored position
      node.group.datum().x = node.x;
      node.group.datum().y = node.y;
    });
    
    // Don't update edges during simulation - only at the end
  });

  // Final updates when simulation ends
  simulation.on("end", () => {
    state.ui.spqrReady = true;
    console.log("Force simulation ended, performing final orientation...");
    orientComponents();
    // Use requestAnimationFrame to ensure DOM is settled before drawing virtual edges
    requestAnimationFrame(() => {
      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
      
      // Reapply highlighting after orientations and edge updates complete to maintain it
      if (state.ui.pendingHighlightCompId) {
        const selectedCompId = state.ui.pendingHighlightCompId;
        const selectedComp = state.data.spqrTree.find(c => c.id === selectedCompId);
        if (selectedComp && state.d3selections.nodeInput && state.d3selections.linkInput) {
          console.log(`[Mode Switch] Reapplying highlighting to component ${selectedCompId} after final layout`);
          selectedComp.isSelected = true;
          highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, selectedComp.id);
        }
        state.ui.pendingHighlightCompId = null;
      }
    });
  });
}



function orientComponents() {
  if (
    state.ui_state.spqrDrawingMode !== 'fancy'
    || !state.data.spqrTree
    || state.data.anySPQRComponentCollapsed
  ) {
    return;
  }

  state.data.spqrTree.forEach((comp, index) => {
    const group = d3.select(`#spqr-component-${index}`);
    if (group.empty()) return;

    group.selectAll("*").remove();
    drawSPQRComponentAsPictogram(group, comp);

    if (comp.isSelected) {
      group.select("rect.bounding-box")
        .attr("stroke", "blue")
        .attr("stroke-width", 3);
      group.selectAll("circle.node").attr("fill", "blue");
    }
  });
}

function refreshSPQRPictograms() {
  orientComponents();
  if (state.ui_state.spqrDrawingMode === 'fancy' && SPQRZoomContainer) {
    updateInterComponentVirtualEdges();
  }
}


function orientPComponent(group, comp, componentIndex) {
  group.selectAll("*").remove();
  drawOrientedPComponent(group, comp);
}


function orientSComponent(group, comp, componentIndex) {
  // For S-components, we always want the parent virtual edge to be at the top, horizontal (east-west)
  // So we don't need to calculate a targetAngle based on parent position
  // The edge orientation is fixed in the drawing
  
  const targetAngle = 0; // Parent edge will always be horizontal at the top
  
  // Redraw with calculated rotation
  group.selectAll("*").remove();
  drawOrientedSComponent(
    group,
    comp,
    targetAngle,
    false
  );
}

// Helper function to find the parent component in the tree
function findParentComponent(comp) {
  // Find the virtual edge that connects to a component with a lower tree level
  for (const [, edgeData] of state.data.virtualEdgeData.entries()) {
    if (edgeData.components.includes(comp.id)) {
      const otherComponentId = edgeData.components.find(id => id !== comp.id);
      const otherComponent = state.data.spqrTree.find(c => c.id === otherComponentId);
      
      // If the other component has a lower tree level, it's the parent
      if (otherComponent && otherComponent.treeLevel < comp.treeLevel) {
        return otherComponent;
      }
    }
  }
  return null; // No parent found (root component)
}

function getStoredPChildOrder(comp) {
  if (!Array.isArray(comp?.embeddingOrder)) return [];
  return comp.embeddingOrder.filter(token => token !== P_AXIS_SLOT);
}

/**
 * Assign each colored virtual edge in a P pictogram a signed perpendicular
 * curve offset.
 *
 * The child order produced by the Reingold-Tilford layout is authoritative:
 * reading the child colors from left to right below the P-node must give the
 * same order as reading the corresponding curves from left to right inside its
 * pictogram. The saved axis slot only decides how many of those child curves
 * are placed to either side of the pole axis.
 */
function getPVirtualLinkLayout(comp, virtualLinks, parentVirtualEdgeId) {
  const drawingPose = state.data.componentPoses?.get(comp.id);
  const otherComponentByEdgeId = new Map();

  for (const link of virtualLinks) {
    const edgeData = state.data.virtualEdgeData.get(link.virtualEdgeId);
    const otherId = edgeData?.components?.find(id => id !== comp.id) ?? null;
    otherComponentByEdgeId.set(link.virtualEdgeId, otherId);
  }

  const availableChildIds = new Set(
    virtualLinks
      .filter(link => link.virtualEdgeId !== parentVirtualEdgeId)
      .map(link => otherComponentByEdgeId.get(link.virtualEdgeId))
      .filter(Boolean)
  );

  const childOrder = [];
  const addChildOrder = ids => {
    for (const id of ids || []) {
      if (!availableChildIds.has(id) || childOrder.includes(id)) continue;
      childOrder.push(id);
    }
  };

  // This is the effective side assignment used by drawP after Whitney-flip
  // overrides and zero-depth corrections. It is more authoritative than the
  // raw permutation dialog state.
  addChildOrder(drawingPose?.leftChildIds);
  addChildOrder(drawingPose?.rightChildIds);
  // treeChildOrder is written from the completed Reingold-Tilford tree just
  // before the pictograms are drawn. The stored embedding and skeleton order
  // are fallbacks for other drawing modes and partially initialised states.
  addChildOrder(comp.treeChildOrder);
  addChildOrder(getStoredPChildOrder(comp));
  addChildOrder(
    virtualLinks.map(link => otherComponentByEdgeId.get(link.virtualEdgeId))
  );

  const storedOrder = Array.isArray(comp.embeddingOrder) ? comp.embeddingOrder : [];
  const axisIndex = storedOrder.indexOf(P_AXIS_SLOT);
  const storedLeftCount = axisIndex >= 0
    ? storedOrder
        .slice(0, axisIndex)
        .filter(token => availableChildIds.has(token))
        .length
    : Math.floor(childOrder.length / 2);
  const poseLeftCount = Array.isArray(drawingPose?.leftChildIds)
    ? drawingPose.leftChildIds.filter(id => availableChildIds.has(id)).length
    : null;
  const leftCount = Math.min(
    poseLeftCount ?? storedLeftCount,
    childOrder.length
  );

  const hasRealPoleEdge = !!getPComponentRealEdge(comp);
  const parentUsesOutsideSlot = parentVirtualEdgeId != null && hasRealPoleEdge;
  const leftSlotCount = leftCount + (parentUsesOutsideSlot ? 1 : 0);
  const rightChildCount = childOrder.length - leftCount;
  const leftSpacing = leftSlotCount > 0
    ? spqrParallelCurveControlMax / leftSlotCount
    : 0;
  const rightSpacing = rightChildCount > 0
    ? spqrParallelCurveControlMax / rightChildCount
    : 0;
  const curveOffsetByEdgeId = new Map();

  for (let index = 0; index < childOrder.length; index++) {
    const childId = childOrder[index];
    const link = virtualLinks.find(candidate =>
      otherComponentByEdgeId.get(candidate.virtualEdgeId) === childId
    );
    if (!link) continue;

    const curveOffset = index < leftCount
      ? -leftSpacing * (leftCount - index)
      : rightSpacing * (index - leftCount + 1);
    curveOffsetByEdgeId.set(link.virtualEdgeId, curveOffset);
  }

  if (parentVirtualEdgeId != null) {
    // Without a real pole edge, the parent virtual edge can occupy the pole
    // axis. If a real edge already occupies it, keep the parent curve outside
    // the child sequence so the child colors retain their relative order.
    curveOffsetByEdgeId.set(
      parentVirtualEdgeId,
      parentUsesOutsideSlot ? -spqrParallelCurveControlMax : 0
    );
  }

  const unassignedLinks = virtualLinks.filter(
    link => !curveOffsetByEdgeId.has(link.virtualEdgeId)
  );
  for (let index = 0; index < unassignedLinks.length; index++) {
    const offset = spqrParallelCurveControlMax
      * (index + 1)
      / Math.max(1, unassignedLinks.length);
    curveOffsetByEdgeId.set(unassignedLinks[index].virtualEdgeId, offset);
  }

  return virtualLinks
    .map(link => ({
      ...link,
      connectedComponentId: otherComponentByEdgeId.get(link.virtualEdgeId),
      curveOffset: curveOffsetByEdgeId.get(link.virtualEdgeId) ?? 0
    }))
    .sort((a, b) => a.curveOffset - b.curveOffset);
}

function drawOrientedPComponent(group, comp) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));
  const links = [];
  const virtualLinks = [];

  const compGroup = group.append("g")
    .attr("class", "spqr-component")
    .attr("data-comp-id", comp.id);

  // Create virtual edge set for lookup with IDs
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [nodes, id] = virtEdge;
    const [v1, v2] = nodes.map(String);
    virtualLinks.push({ 
      source: String(v1), 
      target: String(v2),
      virtualEdgeId: id 
    });
  });

  // Extract links and virtual links
  comp.graph.forEach((nbrs, v) => {
    if (nbrs != null) links.push({source: String(v), target: String(nbrs[0])})
  });

  // Create node position mapping
  const nodeMap = new Map();
  const nodes = Array.from(comp.graph.keys())
    .map(String)
    .sort((a, b) => Number(a) - Number(b));

  const spacing = spqrParallelPoleHalfSpan * 2;
  const drawingPose = state.data.componentPoses?.get(comp.id);
  const parentPoleNodes = findParentVirtualEdge(comp);
  const poleNodes = drawingPose?.poleNodes
    ?? parentPoleNodes
    ?? comp.virtualEdgeEntry?.[0]?.[0]
    ?? nodes.slice(0, 2);
  const poleU = Number(poleNodes[0]);
  const poleV = Number(poleNodes[1]);

  nodes.forEach((nodeId, index) => {
    nodeMap.set(Number(nodeId), {
      x: 0,
      y: (index - (nodes.length - 1) / 2) * spacing
    });
  });
  if (nodeMap.has(poleU) && nodeMap.has(poleV)) {
    nodeMap.set(poleU, { x: 0, y: -spqrParallelPoleHalfSpan });
    nodeMap.set(poleV, { x: 0, y: spqrParallelPoleHalfSpan });
    orientNodeMapForComponent(nodeMap, comp, [poleU, poleV]);
  }

  // Draw normal edges
  if (links.length > 1) {
    compGroup.selectAll(".edge-normal")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "edge-normal")
      .attr("x1", d => nodeMap.get(Number(d.source)).x)
      .attr("y1", d => nodeMap.get(Number(d.source)).y)
      .attr("x2", d => nodeMap.get(Number(d.target)).x)
      .attr("y2", d => nodeMap.get(Number(d.target)).y)
      .attr("stroke", spqrComponentPictureEdgeColor)
      .attr("stroke-width", 1.5);
  }

  const parentVirtualEdgeId = virtualLinks.find(vl => {
    const comps = state.data.virtualEdgeData.get(vl.virtualEdgeId)?.components || [];
    const otherComp = comps.find(c => c !== comp.id);
    if (!otherComp) return false;

    const otherComponent = state.data.spqrTree.find(c => c.id === otherComp);
    const currentComponent = state.data.spqrTree.find(c => c.id === comp.id);
    
    return otherComponent && currentComponent && 
          otherComponent.treeLevel < currentComponent.treeLevel;
  })?.virtualEdgeId;



  // Lay out the colored curves in the same order as the tree children.
  const laidOutVirtualLinks = getPVirtualLinkLayout(
    comp,
    virtualLinks,
    parentVirtualEdgeId
  );

  // 🆕 CAPTURE THE VISUAL ORDER HERE
  // Store the exact order before drawing it.
  comp.visualVirtualEdgeOrder = laidOutVirtualLinks.map((vl, visualIdx) => ({
    visualPosition: visualIdx,
    nodes: [vl.source, vl.target],
    virtualEdgeId: vl.virtualEdgeId,
    description: `[${vl.source},${vl.target}]`,
    curveOffset: vl.curveOffset,
    isParentEdge: vl.virtualEdgeId === parentVirtualEdgeId,
    connectedComponentId: vl.connectedComponentId,
    orientation: 'drawing-aligned'
  }));


  // Draw virtual edges with curved paths
  compGroup.selectAll(".edge-virtual")
    .data(laidOutVirtualLinks)
    .enter()
    .append("path")
    .attr("class", "edge-virtual")
    .attr("d", d => {
      const sourcePos = nodeMap.get(Number(d.source));
      const targetPos = nodeMap.get(Number(d.target));
      const midX = (sourcePos.x + targetPos.x) / 2;
      const midY = (sourcePos.y + targetPos.y) / 2;
      const edgeX = targetPos.x - sourcePos.x;
      const edgeY = targetPos.y - sourcePos.y;
      const edgeLength = Math.hypot(edgeX, edgeY) || 1;
      // The skeleton may list its poles in either direction. Choose the
      // perpendicular that points to the visual right, so negative offsets
      // always remain on the visual-left side used by the permutation control.
      const edgeNormal = {
        x: edgeY / edgeLength,
        y: -edgeX / edgeLength
      };
      const rightNormal = edgeNormal.x < 0
        ? { x: -edgeNormal.x, y: -edgeNormal.y }
        : edgeNormal;
      const controlPoint = {
        x: midX + rightNormal.x * d.curveOffset,
        y: midY + rightNormal.y * d.curveOffset
      };

      return `M ${sourcePos.x},${sourcePos.y} ` +
             `Q ${controlPoint.x},${controlPoint.y} ` +
             `${targetPos.x},${targetPos.y}`;
    })
    .attr("stroke", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("data-virtual-color", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("data-virtual-edge-id", d => d.virtualEdgeId)
    .attr("data-source-id", d => d.source)
    .attr("data-target-id", d => d.target)
    .attr("data-connected-component-id", d => d.connectedComponentId ?? "")
    .attr("stroke-width", spqrComponentPictureVirtualStrokeWidth)
    .attr("stroke-dasharray", "5,5")
    .attr("fill", "none")
    .datum(d => ({
      source: { id: d.source },
      target: { id: d.target },
      virtualEdgeId: d.virtualEdgeId
    }));

  // Draw nodes
  compGroup.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("data-node-id", d => d.id)
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("data-base-r", 6)
    .attr("r", zoomAdjustedR(6, "spqr"))
    .attr("fill", "#3498db");

  // Add bounding elements and hover events
  addComponentBoundingElements(compGroup, nodeMap, comp.id);
  addComponentHoverEvents(compGroup, comp.id);
}

function drawOrientedSComponent(group, comp, targetAngle = 0, rotate = true) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));
  const links = [];
  const virtualLinks = [];

  const compGroup = group.append("g")
    .attr("class", "spqr-component")
    .attr("data-comp-id", comp.id);

  // Create virtual edge map for lookup (key -> virtualEdgeId)
  const virtualEdgeMap = new Map();
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [[v1, v2], id] = virtEdge;
    virtualEdgeMap.set(`${v1}-${v2}`, id);
    virtualEdgeMap.set(`${v2}-${v1}`, id);
  });

  comp.graph.forEach((nbrs, v) => {
    if (!nbrs || nbrs.length === 0) {
      let ns = Array.from(comp.graph);
      const [s, t] = [String(ns[0][0]), String(ns[1][0])];
      virtualLinks.push({ source: s, target: t, virtualEdgeId: virtualEdgeMap.get(`${s}-${t}`) });
      return;
    }

    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        const virtualEdgeId = virtualEdgeMap.get(`${src}-${tgt}`);
        if (virtualEdgeId !== undefined) {
          virtualLinks.push({ source: src, target: tgt, virtualEdgeId });
        } else {
          links.push({ source: src, target: tgt });
        }
      }
    });
  });

  const nodeMap = new Map();
  const allNodes = Array.from(comp.graph.keys());
  const nodeCount = allNodes.length;
  const radius = 30;
  const angleStep = nodeCount > 1 ? (2 * Math.PI) / nodeCount : 0;
  
  // Get ordered nodes and position them in a circle
  const storedCycleOrder = state.data.componentPoses?.get(comp.id)?.cycleOrder;
  let ordered = Array.isArray(storedCycleOrder)
    && storedCycleOrder.length === allNodes.length
    ? storedCycleOrder.map(Number)
    : getOrderedNodes(comp).map(Number);
  
  // Find which nodes are part of the virtual edge to parent
  const parentVirtualEdge = findParentVirtualEdge(comp);
  const parentEdgeNodeIds = new Set();
  
  if (parentVirtualEdge) {
    parentEdgeNodeIds.add(parentVirtualEdge[0]);
    parentEdgeNodeIds.add(parentVirtualEdge[1]);
  }
  
  console.log(`=== S Component ${comp.id} ===`);
  console.log("Ordered nodes (before reordering):", ordered);
  console.log("Parent virtual edge:", parentVirtualEdge);
  console.log("Parent edge node IDs:", Array.from(parentEdgeNodeIds));
  console.log("angleStep:", angleStep);
  
  // Reorder nodes: shift array until parent edge nodes are at positions 0 and 1
  if (parentEdgeNodeIds.size === 2) {
    // Shift array circularly until both parent nodes are at the front
    let maxShifts = ordered.length; // Prevent infinite loop
    while (maxShifts > 0) {
      const pos0 = ordered[0];
      const pos1 = ordered[1];
      
      // Check if both positions 0 and 1 contain parent edge nodes
      if (parentEdgeNodeIds.has(pos0) && parentEdgeNodeIds.has(pos1)) {
        break; // Done
      }
      
      // Shift right (modularly): move last element to front
      ordered.unshift(ordered.pop());
      maxShifts--;
    }
    
    console.log("Ordered nodes (after reordering):", ordered);
  }
  
  // Position nodes in circle with parent edge at top
  ordered.forEach((nodeId, i) => {
    let nodeAngle;
    
    if (parentEdgeNodeIds.size === 0) {
      // No parent edge - position all nodes evenly around the circle starting from top
      nodeAngle = targetAngle + (3 * Math.PI / 2) - (angleStep * i);
    } else if (i === 0) {
      // First parent node at top-left (240°)
      nodeAngle = targetAngle + (3 * Math.PI / 2) - (angleStep / 2);
      console.log(`PARENT Node ${nodeId} (index ${i}): angle=${(nodeAngle * 180 / Math.PI).toFixed(1)}° [240°]`);
    } else if (i === 1) {
      // Second parent node at top-right (300°)
      nodeAngle = targetAngle + (3 * Math.PI / 2) + (angleStep / 2);
      console.log(`PARENT Node ${nodeId} (index ${i}): angle=${(nodeAngle * 180 / Math.PI).toFixed(1)}° [300°]`);
    } else {
      // Regular nodes - position in order around the rest of the circle
      // Going counterclockwise from parent2 (at 300°)
      nodeAngle = targetAngle + (3 * Math.PI / 2) + (angleStep / 2) + (angleStep * (i - 1));
      console.log(`REGULAR Node ${nodeId} (index ${i}): angle=${(nodeAngle * 180 / Math.PI).toFixed(1)}°`);
    }
    
    const pos = {
      x: radius * Math.cos(nodeAngle),
      y: radius * Math.sin(nodeAngle)
    };
    console.log(`    → pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})`);
    nodeMap.set(nodeId, pos);
  });

  // The regular polygon remains legible, while its labelled vertices, parent
  // edge, and unfolding side now agree with the displayed graph drawing.
  orientNodeMapForComponent(nodeMap, comp);
  fitNodeMapToPictogram(nodeMap);

  // Draw edges as circular arcs
  compGroup.selectAll(".edge-normal")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "edge-normal")
      .attr("x1", d => nodeMap.get(Number(d.source)).x)
      .attr("y1", d => nodeMap.get(Number(d.source)).y)
      .attr("x2", d => nodeMap.get(Number(d.target)).x)
      .attr("y2", d => nodeMap.get(Number(d.target)).y)
      .attr("stroke", spqrComponentPictureEdgeColor)
      .attr("stroke-width", 1.5);

  // Draw virtual edges as straight lines
  compGroup.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("data-virtual-color", d => state.data.virtualEdgeData?.get(d.virtualEdgeId)?.color ?? virtualEdgeColorPalette[0])
    .attr("stroke-width", spqrComponentPictureVirtualStrokeWidth)
    .attr("stroke-dasharray", "5,5")
    .attr("data-virtual-edge-id", d => d.virtualEdgeId)
    .attr("data-source-id", d => d.source)
    .attr("data-target-id", d => d.target)
    .datum(d => ({
      source: { id: d.source },
      target: { id: d.target },
      virtualEdgeId: d.virtualEdgeId
    }));

  // Draw nodes
  compGroup.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("data-node-id", d => d.id)
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("data-base-r", 6)
    .attr("r", zoomAdjustedR(6, "spqr"))
    .attr("fill", "#3498db");

  // Add bounding elements for the new orientation
  addComponentBoundingElements(compGroup, nodeMap, comp.id);
  addComponentHoverEvents(compGroup, comp.id);
}

// Helper function to find the virtual edge that connects to parent
function findParentVirtualEdge(comp) {
  // Iterate through virtual edges in this component's virtualEdgeEntry
  for (const [edge, virtualEdgeId] of comp.virtualEdgeEntry) {
    // Get the edge data using the virtual edge ID
    const edgeData = state.data.virtualEdgeData.get(virtualEdgeId);
    
    if (edgeData) {
      // Check all components connected to this virtual edge
      const parentComponent = edgeData.components
        .filter(id => id !== comp.id)
        .map(id => state.data.spqrTree.find(c => c.id === id))
        .find(c => c && c.treeLevel < comp.treeLevel);
      
      if (parentComponent) {
        // Found a parent component connected via this virtual edge
        return edge;
      }
    }
  }
  
  return null;
}


function addComponentBoundingElements(group, nodeMap, componentId) {
  const boundingRect = {
    x: -spqrComponentPictogramSize / 2,
    y: -spqrComponentPictogramSize / 2,
    width: spqrComponentPictogramSize,
    height: spqrComponentPictogramSize
  };

  let colorString;
  var transparancy = 0.08;
  switch (componentId.substring(0,1)) {
    case "R": colorString = "rgba(255, 0, 0, " + transparancy +")"; 
      break; // Red for R
    case "S": colorString = "rgba(0, 255, 0, " + transparancy +")"; 
      break; // Green for S
    case "P": colorString = "rgba(0, 0, 255, " + transparancy +")"; 
      break; // Blue for P
    default: colorString = "rgba(128, 128, 128," + transparancy +")"; // Gray for unknown
  }


  group.append("rect")
    .attr("class", "bounding-box")
    .attr("x", boundingRect.x)
    .attr("y", boundingRect.y)
    .attr("width", boundingRect.width)
    .attr("height", boundingRect.height)
    .attr("stroke", "black")
    .attr("fill",colorString)
    .attr("rx", 8);

  // Add label
  const labelStyle = state.ui_state.spqrLabelStyle;
  const labelText = getSpqrComponentLabel(componentId, labelStyle);
  const labelTab = getSpqrLabelTabGeometry(boundingRect, labelText);
  group.append("path")
    .attr("class", "bounding-label-tab")
    .attr("data-comp-id", componentId)
    .attr("d", labelTab.fillPath)
    .attr("fill", "white")
    .attr("stroke", "none")
    .style("pointer-events", "none")
    .style("display", state.ui_state.spqrCompLabelsVisible ? null : "none");

  group.append("path")
    .attr("class", "bounding-label-tab-outline")
    .attr("data-comp-id", componentId)
    .attr("d", labelTab.outlinePath)
    .attr("fill", "none")
    .attr("stroke", "black")
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .style("pointer-events", "none")
    .style("display", state.ui_state.spqrCompLabelsVisible ? null : "none");

  group.append("text")
    .attr("class", "bounding-label")
    .attr("data-comp-id", componentId)
    .attr("data-base-fs", 15)
    .attr("x", labelTab.textX)
    .attr("y", labelTab.textY)
    .text(labelText)
    .attr("font-weight", "bold")
    .style("font-size", "15px")
    .style("pointer-events", "none")
    .style("display", state.ui_state.spqrCompLabelsVisible ? null : "none");

   group.datum({ 
    ...group.datum(), 
    boundingRect, 
    componentId 
  });
  
}
//colors only change in array on reloading server, not on refreshing page
function addComponentHoverEvents(group, componentId) {
  group
    .on("mouseover", () => {
      if(state.ui.spqrReady === false) return;
      let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === componentId)[0];
      console.log("matchingSPQRNode", matchingSPQRNode);
      if (matchingSPQRNode) matchingSPQRNode.isHovered = true;
      let color = "green"
      switch(matchingSPQRNode.type) {
        case "R":
          color = "red";
          break;
        case "S":
          color = "green";
          break;
        case "P":
          color = "blue";
          break;
      }
      highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, componentId, color);
    })
    .on("mouseout", () => {
      if(state.ui.spqrReady === false) return;
      let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === componentId)[0];
      console.log("matchingSPQRNode", matchingSPQRNode);
      if (matchingSPQRNode) matchingSPQRNode.isHovered = false;
      
      // Only unhighlight if the component is NOT selected
      if (matchingSPQRNode && !matchingSPQRNode.isSelected) {
        let color = "green"
        switch(matchingSPQRNode.type) {
          case "R":
            color = "red";
            break;
          case "S":
            color = "green";
            break;
          case "P":
            color = "blue";
            break;
        }
        unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, componentId, state.ui.colors[0]);
      }
    });
}

// Enhanced version of the original drawSPQRComponentAsPictogram that calls the appropriate drawing function
function drawSPQRComponentAsPictogram(group, comp) {
  if (comp.type === "R") {
    return drawRComponentAsSubgraph(group, comp);
  } else if (comp.type === "S") {
    return drawOrientedSComponent(group, comp);
  } else if (comp.type === "P") {
    return drawOrientedPComponent(group, comp);
  }
}


// Event handler functions - refactored to use state
function handleMouseOverInput(event, d, inputSel, spqrSel) {
  if(state.data.inputGraphIsNotBiconnected) {return;}
  highlight(inputSel, d.id);
  highlight(spqrSel, d.id);
  highlightInSPQRDrawing(d.id);
}

function handleMouseOutInput(event, d, inputSel, spqrSel) {
  if(state.data.inputGraphIsNotBiconnected) {return;}
  unhighlight(inputSel, d.id);
  unhighlight(spqrSel, d.id);
  unhighlightInSPQRDrawing(d.id);


}

function handleMouseOverEdgeInput(event, d, nodeSel, linkSel) {
  if(state.data.inputGraphIsNotBiconnected) {return;}

  // Vertices take priority: suppress edge hover when the cursor is within
  // node-hit radius (18px) of any graph node.
  const { x: mx, y: my } = getInputGraphPos(event);
  const nearNode = state.data.graphNodes?.some(n => {
    const dx = mx - n.x, dy = my - n.y;
    return Math.sqrt(dx * dx + dy * dy) < 18;
  });
  if (nearNode) return;
  
  // Check if this edge belongs to any selected component and is virtual
  const componentsWithEdge = (state.data.spqrTree || []).filter(comp => {
    const hasSource = comp.graph.has(Number(d.source.id));
    const hasTarget = comp.graph.has(Number(d.target.id));
    if (!hasSource || !hasTarget) return false;
    return isEdgeInComponent(comp, d.source.id, d.target.id);
  });
  
  const isVirtual = componentsWithEdge.some(comp => isVirtualEdgeInComponent(comp, d.source.id, d.target.id));
  
  // Highlight the edge in input graph
  highlightEdgeWithOpacity(linkSel, d.source.id, d.target.id, "purple");
  
  // Highlight corresponding edge in SPQR drawing
  // For virtual edges, skip highlighting the component bounding box - only highlight the edge in pictograms
  highlightEdgeInSPQRDrawing(d.source.id, d.target.id, "purple", isVirtual);
}

function handleMouseOutEdgeInput(event, d, nodeSel, linkSel) {
  if(state.data.inputGraphIsNotBiconnected) {return;}
  
  // Unhighlight the edge in input graph
  unhighlightEdgeWithOpacity(linkSel, d.source.id, d.target.id, "purple");
  
  // Check if this edge belongs to any selected/hovered component - if so, restore that component's color
  const componentsWithEdge = (state.data.spqrTree || []).filter(comp => {
    const hasSource = comp.graph.has(Number(d.source.id));
    const hasTarget = comp.graph.has(Number(d.target.id));
    if (!hasSource || !hasTarget) return false;
    return isEdgeInComponent(comp, d.source.id, d.target.id);
  });
  
  let restored = false;
  for (const comp of componentsWithEdge) {
    if (comp.isSelected || comp.isHovered) {
      const compColor = comp.type === "R" ? "red" : comp.type === "S" ? "green" : "blue";
      highlightEdgeWithOpacity(linkSel, String(d.source.id), String(d.target.id), compColor, false);
      restored = true;
      break;
    }
  }
  
  // Unhighlight corresponding edge in SPQR drawing
  unhighlightEdgeInSPQRDrawing(d.source.id, d.target.id, "purple");
}

/**
 * Highlight an edge in the SPQR component drawings when hovering over input graph edge
 * @param {string} sourceId - The ID of the source node
 * @param {string} targetId - The ID of the target node
 * @param {string} color - The highlight color
 * @param {boolean} skipComponentHighlight - If true, don't highlight the component node in SPQR tree
 */
function highlightEdgeInSPQRDrawing(sourceId, targetId, color = "orange", skipComponentHighlight = false) {
  console.log("Highlighting edge in SPQR drawing:", sourceId, "->", targetId);

  const spqrTree = state.data.spqrTree;
  if (!Array.isArray(spqrTree)) {
    console.warn(`[highlightEdgeInSPQRDrawing] SPQR tree not ready; skipping edge ${sourceId}-${targetId}`);
    return;
  }
  
  // Find all SPQR components that contain this edge
  const componentsWithEdge = spqrTree.filter(comp => {
    // Check if component contains both nodes
    const hasSource = comp.graph.has(Number(sourceId));
    const hasTarget = comp.graph.has(Number(targetId));
    
    if (!hasSource || !hasTarget) return false;
    
    // Check if there's actually an edge between these nodes in this component
    return isEdgeInComponent(comp, sourceId, targetId);
  });
  
  console.log(`Edge [${sourceId}, ${targetId}] found in components:`, componentsWithEdge.map(c => c.id));
  
  componentsWithEdge.forEach(comp => {
    const compIndex = spqrTree.findIndex(c => c.id === comp.id);
    const compGroup = d3.select(`#spqr-component-${compIndex}`);
    
    if (!compGroup.empty()) {
      // Determine if this is a virtual edge or normal edge
      const isVirtual = isVirtualEdgeInComponent(comp, sourceId, targetId);
      const edgeClass =  ".edge-normal";
      
      console.log(`Highlighting ${isVirtual ? 'virtual' : 'normal'} edge in component ${comp.id}`);
      
      // Highlight the edge in the SPQR component drawing
      compGroup.selectAll(edgeClass)
        .filter(function() {
          const edgeData = d3.select(this).datum();
          if (!edgeData) return false;
          
          const edgeSourceId = edgeData.source?.id || edgeData.source;
          const edgeTargetId = edgeData.target?.id || edgeData.target;
          
          return (edgeSourceId === sourceId && edgeTargetId === targetId) ||
                 (edgeSourceId === targetId && edgeTargetId === sourceId);
        })
        .each(function() {
          const hits = (+this.getAttribute("data-spqr-edge-hit") || 0) + 1;
          this.setAttribute("data-spqr-edge-hit", hits);
          
          d3.select(this)
            .attr("stroke", color)
            .attr("stroke-width", isVirtual ? 4 : 3)
            .attr("stroke-opacity", 0.8)
            .raise();
        });
      
      // Also highlight the connected nodes — skip if this component is already selected/hovered

        [sourceId, targetId].forEach(nodeId => {
          compGroup.selectAll(".node")
            .filter(function() {
              const nodeData = d3.select(this).datum();
              return nodeData && nodeData.id === nodeId;
            })
            .each(function() {
              const hits = (+this.getAttribute("data-spqr-node-hit") || 0) + 1;
              this.setAttribute("data-spqr-node-hit", hits);

              d3.select(this)
                .attr("fill", color)
                .attr("stroke", color)
                .attr("stroke-width", 2)
                .attr("data-base-r", 6)
                .attr("r", zoomAdjustedR(6, "spqr"))
                .raise();
            });
        });
    

      // Also highlight the component in the SPQR drawing, the edge belongs to
      // Skip this if skipComponentHighlight is true (for virtual edges in selected components)
      if (!skipComponentHighlight) {
        highlightSPQRNode(comp.id, color, false);
      }
    }
  });
}

/**
 * Unhighlight an edge in the SPQR component drawings
 * @param {string} sourceId - The ID of the source node
 * @param {string} targetId - The ID of the target node
 * @param {string} color - The original highlight color (for cleanup)
 */
function unhighlightEdgeInSPQRDrawing(sourceId, targetId, color = "orange") {
  console.log("Unhighlighting edge in SPQR drawing:", sourceId, "->", targetId);
  const spqrTree = state.data.spqrTree;
  if (!Array.isArray(spqrTree)) {
    console.warn(`[unhighlightEdgeInSPQRDrawing] SPQR tree not ready; skipping edge ${sourceId}-${targetId}`);
    return;
  }
  
  // Find all SPQR components that contain this edge
  const componentsWithEdge = spqrTree.filter(comp => {
    const hasSource = comp.graph.has(Number(sourceId));
    const hasTarget = comp.graph.has(Number(targetId));
    
    if (!hasSource || !hasTarget) return false;
    
    return isEdgeInComponent(comp, sourceId, targetId);
  });
  
  componentsWithEdge.forEach(comp => {
    const compIndex = spqrTree.findIndex(c => c.id === comp.id);
    const compGroup = d3.select(`#spqr-component-${compIndex}`);
    
    if (!compGroup.empty()) {
      const isVirtual = isVirtualEdgeInComponent(comp, sourceId, targetId);
      const edgeClass = ".edge-normal";
      
      // Unhighlight the edge
      compGroup.selectAll(edgeClass)
        .filter(function() {
          const edgeData = d3.select(this).datum();
          if (!edgeData) return false;
          
          const edgeSourceId = edgeData.source?.id || edgeData.source;
          const edgeTargetId = edgeData.target?.id || edgeData.target;
          
          return (edgeSourceId === sourceId && edgeTargetId === targetId) ||
                 (edgeSourceId === targetId && edgeTargetId === sourceId);
        })
        .each(function() {
          const hits = Math.max(0, (+this.getAttribute("data-spqr-edge-hit") || 1) - 1);
          this.setAttribute("data-spqr-edge-hit", hits);
          
          if (hits === 0) {
            // Always reset to normal-edge style: the selector is ".edge-normal" so these
            // are never virtual edge elements even when isVirtual is true (a P component
            // has a virtual edge between its poles AND a real one; isVirtual would be true
            // but the DOM element is still a normal edge that should reset to gray).
            d3.select(this)
              .attr("stroke", spqrComponentPictureEdgeColor)
              .attr("stroke-width", spqrComponentPictureNormalStrokeWidth)
              .attr("stroke-opacity", 1);
          }
        });
      
      // Unhighlight the connected nodes
      [sourceId, targetId].forEach(nodeId => {
        compGroup.selectAll(".node")
          .filter(function() {
            const nodeData = d3.select(this).datum();
            return nodeData && nodeData.id === nodeId;
          })
          .each(function() {
            const hits = Math.max(0, (+this.getAttribute("data-spqr-node-hit") || 1) - 1);
            this.setAttribute("data-spqr-node-hit", hits);

            if (hits === 0) {
              if (comp.isSelected || comp.isHovered) {
                const compColor = comp.type === "R" ? "red" : comp.type === "S" ? "green" : "blue";
                d3.select(this)
                  .attr("fill", compColor)
                  .attr("stroke", compColor)
                  .attr("stroke-width", 2)
                  .attr("data-base-r", 6)
                  .attr("r", zoomAdjustedR(6, "spqr"));
              } else {
                d3.select(this)
                  .attr("fill", "#3498db")
                  .attr("stroke", null)
                  .attr("stroke-width", null)
                  .attr("data-base-r", 6)
                  .attr("r", zoomAdjustedR(6, "spqr"));
              }
            }
          });
      });
    }

         // Also unhighlight the component in the SPQR drawing, the edge belongs to
      unhighlightSPQRNode(comp.id, color, false);
  });
}

/**
 * Check if an edge exists in a component (either virtual or normal)
 */
function isEdgeInComponent(component, sourceId, targetId) {
  const source = Number(sourceId);
  const target = Number(targetId);
  
  // Check virtual edges
  for (const [edge, _] of component.virtualEdgeEntry) {
    const [u, v] = edge;
    if ((u === source && v === target) || (u === target && v === source)) {
      return true;
    }
  }
  
  // Check normal edges
  const sourceNeighbors = component.graph.get(source);
  if (sourceNeighbors && sourceNeighbors.includes(target)) {
    return true;
  }
  
  const targetNeighbors = component.graph.get(target);
  if (targetNeighbors && targetNeighbors.includes(source)) {
    return true;
  }
  
  return false;
}

/**
 * Check if an edge is virtual in a component
 */
function isVirtualEdgeInComponent(component, sourceId, targetId) {
  const source = Number(sourceId);
  const target = Number(targetId);
  
  // Check if edge is in virtualEdgeEntry
  for (const [edge, _] of component.virtualEdgeEntry) {
    const [u, v] = edge;
    if ((u === source && v === target) || (u === target && v === source)) {
      return true;
    }
  }
  
  return false;
}


/**
 * Highlight a node/edge in the SPQR component drawings when hovering over input graph
 * @param {string} nodeId - The ID of the node in the input graph
 * @param {string} color - The highlight color
 */
function highlightInSPQRDrawing(nodeId, color = "orange") {
  console.log("Highlighting in SPQR drawing:", nodeId);
  const spqrTree = state.data.spqrTree;
  if (!Array.isArray(spqrTree)) {
    console.warn(`[highlightInSPQRDrawing] SPQR tree not ready; skipping node ${nodeId}`);
    return;
  }
  
  // Find all SPQR components that contain this node
  const componentsWithNode = spqrTree.filter(comp => 
    comp.graph.has(Number(nodeId))
  );
  
  console.log(`Node ${nodeId} found in components:`, componentsWithNode.map(c => c.id));
  
  componentsWithNode.forEach(comp => {
    const compIndex = spqrTree.findIndex(c => c.id === comp.id);
    const compGroup = d3.select(`#spqr-component-${compIndex}`);
    
    if (!compGroup.empty()) {
      // Highlight the node in the SPQR component drawing
      compGroup.selectAll(".node")
        .filter(function() {
          const nodeData = d3.select(this).datum();
          return nodeData && nodeData.id === nodeId;
        })
        .each(function() {
          const hits = (+this.getAttribute("data-spqr-hit") || 0) + 1;
          this.setAttribute("data-spqr-hit", hits);
          
          d3.select(this)
            .attr("fill", color)
            .attr("stroke", color)
            .attr("stroke-width", 3)
            .attr("data-base-r", 8 + hits)
            .attr("r", zoomAdjustedR(8 + hits, "spqr"))
            .raise();
        });
      
    }
  });
}

/**
 * Unhighlight a node/edge in the SPQR component drawings
 * @param {string} nodeId - The ID of the node in the input graph
 * @param {string} color - The original highlight color (for cleanup)
 */
function unhighlightInSPQRDrawing(nodeId, color = "orange") {
  console.log("Unhighlighting in SPQR drawing:", nodeId);
  const spqrTree = state.data.spqrTree;
  if (!Array.isArray(spqrTree)) {
    console.warn(`[unhighlightInSPQRDrawing] SPQR tree not ready; skipping node ${nodeId}`);
    return;
  }
  
  // Find all SPQR components that contain this node
  const componentsWithNode = spqrTree.filter(comp => 
    comp.graph.has(Number(nodeId))
  );
  
  componentsWithNode.forEach(comp => {
    const compIndex = spqrTree.findIndex(c => c.id === comp.id);
    const compGroup = d3.select(`#spqr-component-${compIndex}`);
    
    if (!compGroup.empty()) {
      // Unhighlight the node in the SPQR component drawing
      compGroup.selectAll(".node")
        .filter(function() {
          const nodeData = d3.select(this).datum();
          return nodeData && nodeData.id === nodeId;
        })
        .each(function() {
          const hits = Math.max(0, (+this.getAttribute("data-spqr-hit") || 1) - 1);
          this.setAttribute("data-spqr-hit", hits);
          
          if (hits === 0) {
            // Check if THIS component is selected/hovered - if so, restore its color
            if (comp.isSelected || comp.isHovered) {
              const compColor = comp.type === "R" ? "red" : comp.type === "S" ? "green" : "blue";
              d3.select(this)
                .attr("fill", compColor)
                .attr("stroke", compColor)
                .attr("stroke-width", 2)
                .attr("data-base-r", 6)
                .attr("r", zoomAdjustedR(6, "spqr"));
            } else {
              // Reset to default appearance
              d3.select(this)
                .attr("fill", "#3498db") // Default node color
                .attr("stroke", null)
                .attr("stroke-width", null)
                .attr("data-base-r", 6)
                .attr("r", zoomAdjustedR(6, "spqr")); // Default radius
            }
          } else {
            // Reduce size but keep highlighted
            d3.select(this)
              .attr("data-base-r", 6)
              .attr("r", zoomAdjustedR(6 , "spqr"));
          }
        });
      
      // Unhighlight edges connected to this node
      compGroup.selectAll(".edge-normal, .edge-virtual")
        .filter(function() {
          const edgeData = d3.select(this).datum();
          if (!edgeData) return false;
          
          const sourceId = edgeData.source?.id || edgeData.source;
          const targetId = edgeData.target?.id || edgeData.target;
          
          return sourceId === nodeId || targetId === nodeId;
        })
        .each(function() {
          const hits = Math.max(0, (+this.getAttribute("data-spqr-hit") || 1) - 1);
          this.setAttribute("data-spqr-hit", hits);
          
          if (hits === 0) {
            const isVirtual = d3.select(this).classed("edge-virtual");
            const virtualColor = this.getAttribute("data-virtual-color") ?? virtualEdgeColorPalette[0];
            // Reset to default appearance
            d3.select(this)
              .attr("stroke", isVirtual ? virtualColor : spqrComponentPictureEdgeColor)
              .attr("stroke-width", isVirtual ? spqrComponentPictureVirtualStrokeWidth : spqrComponentPictureNormalStrokeWidth)
              .attr("stroke-opacity", 1);
          }
        });
    }
  });
}
/**
 * Highlights a specific element within a D3 selection.
 * 
 * @param {} selection a selection of d3 elements from which the id will be highlighted
 * @param {*} id the id of the element to highlight
 * @param {*} color the color to use for highlighting
 * @returns 
 */
function highlight(selection, id, color = "orange") {
  console.log("Highlighting id:", id, "Type:", typeof id);
  if (!selection) return;
  const idToMatch = String(id);
  console.log("Comparing against nodes with id:", idToMatch);
  selection
    .filter(d => String(d.id) === idToMatch)
    .each(function () {
      console.log("Found node to highlight:", idToMatch);
      const hits = (+this.getAttribute("data-hit") || 0) + 1;
      this.setAttribute("data-hit", hits);

      d3.select(this)
        .style("fill", color)
        .style("stroke", "#fff") // Keep white stroke
        .style("stroke-width", "2.5px")
        .attr("data-base-r", 14)
        .attr("r", zoomAdjustedR(14, "input"))
        .raise();
      
      console.log("Applied styles to node:", idToMatch, "color:", color, "actual fill:", d3.select(this).style("fill"));
    });
}


function unhighlight(selection, id, color = "orange", unhighlightingCompId = null, forceFullUnhighlight = false) {
  if (!selection) return;
  console.log(`[unhighlight] Starting for node ${id}, unhighlightingCompId=${unhighlightingCompId}, forceFullUnhighlight=${forceFullUnhighlight}`);
  const spqrTree = state.data.spqrTree;
  const hasSpqr = Array.isArray(spqrTree);
  if (!hasSpqr) {
    console.warn(`[unhighlight] SPQR tree not ready; skipping component-based color restoration for node ${id}`);
  }
  
  // Check if this is an articulation point - keep it red
  const idStr = String(id);
  if (state.data.articulationPoints && state.data.articulationPoints.has(idStr)) {
    console.log(`[unhighlight] Node ${id} is an articulation point - keeping it red`);
    return; // Don't unhighlight articulation points
  }
  
  // Handle both string and numeric IDs for comparison
  const idToMatch = String(id);
  selection
    .filter(d => String(d.id) === idToMatch)
    .each(function () {
      const n = (+this.getAttribute("data-hit") || 1) - 1;
      this.setAttribute("data-hit", n);
      console.log(`[unhighlight] Node ${id}: old hit count decremented to ${n}`);

      // Always check if this node belongs to any selected/hovered component
      // But skip the component that is being unhighlighted
      const componentsWithNode = hasSpqr
        ? spqrTree.filter(comp => comp.graph.has(Number(id)) && comp.id !== unhighlightingCompId)
        : [];
      if (hasSpqr) {
        console.log(`[unhighlight] Node ${id}: found ${componentsWithNode.length} components with this node (excluding ${unhighlightingCompId})`);
      }
      
      // Find the first selected or hovered component
      let restoredColor = null;
      if (!forceFullUnhighlight) {
        for (const comp of componentsWithNode) {
          console.log(`[unhighlight] Checking comp ${comp.id}: isSelected=${comp.isSelected}, isHovered=${comp.isHovered}, type=${comp.type}`);
          if (comp.isSelected || comp.isHovered) {
            restoredColor = comp.type === "R" ? "red" : comp.type === "S" ? "green" : "blue";
            console.log(`[unhighlight] Restoring node ${id} to color: ${restoredColor} (from ${comp.id})`);
            break;
          }
        }
      }

      if (!restoredColor) {
        console.log(`[unhighlight] full force setting, ${id}  to steelblue`);
        d3.select(this).style("fill", "steelblue").style("stroke", "#fff").style("stroke-width", "1.5px").attr("data-base-r", 10).attr("r", zoomAdjustedR(10, "input"));
      } else {
        console.log(`[unhighlight] applying restored color, ${id} to ${restoredColor}`);
        d3.select(this).style("fill", restoredColor).style("stroke", "#fff").style("stroke-width", "1.5px").attr("data-base-r", 10).attr("r", zoomAdjustedR(10, "input"));
      }

    });
}

/**
 * Clears all highlighting from the input graph and resets SPQR component selection states
 */
function clearAllHighlighting() {
  console.log("Clearing all highlighting and resetting component selection states");
  
  // Deselect and unhighlight all components
  for (const comp of state.data.spqrTree || []) {
    if (comp.isSelected) {
      comp.isSelected = false;
      unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, comp.id, "orange", false, 0, true);
    }
    comp.isHovered = false;
  }
  
  console.log("✅ All highlighting cleared");
  updateEmbeddingSwitchButton();
  updateRerootButton();
}

function highlightComponent(nodeSel, linkSel, compId, color = "orange", fromP = false, highlightLevel = 0, suppressVirtualEdgeHover = false) {
  // Always use fresh selections so newly drawn nodes/edges participate in highlighting.
  // Draw from SPQR adds overlay circles on the input canvas; only target actual graph nodes.
  nodeSel = InputZoomContainer.selectAll(".input-node");
  linkSel = InputZoomContainer.selectAll(".edge-hit-area");

  const comp = state.data.spqrTree.find(c => c.id === compId);

  if (!comp) return;
  console.log(`[highlightComponent] Highlighting component ${compId}, type=${comp.type}, highlightLevel=${highlightLevel}`);
  
  // Determine the original component's color based on its type
  let originalCompColor;
  switch(comp.type) {
    case "R":
      originalCompColor = "red";
      break;
    case "S":
      originalCompColor = "green";
      break;
    case "P":
      originalCompColor = "blue";
      break;
    default:
      originalCompColor = "orange";
  }
  
  // Only highlight the SPQR node if this is not a recursive call from a P component
  if(!fromP) highlightSPQRNode(compId, originalCompColor);

  if (!comp.highlightedEdges) comp.highlightedEdges = [];
  if (!comp.highlightedNodes) comp.highlightedNodes = [];

  const virtualEdgesToHighlight = new Set();
  comp.virtualEdgeEntry.forEach(([edge, _]) => {
    const [u, v] = edge;
    virtualEdgesToHighlight.add(`${u}-${v}`);
    virtualEdgesToHighlight.add(`${v}-${u}`);
  });

    // Special handling for P components
    if (comp.type === 'P' && highlightLevel === 0) {
      const hasRealEdges = Array.from(comp.graph.values()).some(neighbors => neighbors && neighbors.length > 0);
      console.log(`[highlightComponent] P component detected, hasRealEdges=${hasRealEdges}`);

      if (!hasRealEdges) {
        // Pure virtual P: highlight its two attachment nodes AND the virtual edge between them
        comp.graph.forEach((nbrs, v) => {
          const opacity = 1.0;
          console.log(`[highlightComponent] P component (virtual-only): Highlighting node ${v} with color ${originalCompColor}, opacity=${opacity}`);
          highlightWithOpacity(nodeSel, String(v), originalCompColor, opacity);
          comp.highlightedNodes.push(String(v));
        });
        
        // Highlight the virtual edge between the P component nodes
        comp.virtualEdgeEntry.forEach(([edge, _]) => {
          const [u, v] = edge;
          const opacity = 1.0;
          console.log(`[highlightComponent] P component (virtual-only): Highlighting virtual edge [${u}, ${v}]`);
          highlightEdgeWithOpacity(linkSel, String(u), String(v), originalCompColor, true, opacity);
          comp.highlightedEdges.push([String(u), String(v)]);
        });
        
        console.log(`[highlightComponent] Component ${compId} has ${comp.highlightedNodes.length} nodes highlighted`);
        console.log(`[highlightComponent] P component return - exiting early (virtual-only)`);
        return;
      }
      // If it has real edges, continue to normal highlighting below (nodes/edges)
      console.log(`[highlightComponent] P component has real edges; continuing to standard highlighting`);
    }

  // Check if this component has null neighbors (indicating it's a pair component or similar)
  if (comp.graph.entries().next().value[1] == null) {
    comp.virtualEdgeEntry.forEach(([edge, _]) => {
      const [u, v] = edge;
      const opacity = highlightLevel === 0 ? 1.0 : 0.4; // Reduce opacity for neighbors
      highlightWithOpacity(nodeSel, String(u), originalCompColor, opacity);
      highlightWithOpacity(nodeSel, String(v), originalCompColor, opacity);
      comp.highlightedNodes.push(String(u), String(v));
      highlightEdgeWithOpacity(linkSel, String(u), String(v), originalCompColor, true, opacity);
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    console.log(`[highlightComponent] Component ${compId} has ${comp.highlightedNodes.length} nodes highlighted`);
    return;
  }

  console.log(`[highlightComponent] Component ${compId} graph keys:`, Array.from(comp.graph.keys()).map(k => `${k} (${typeof k})`).join(", "));
  console.log(`[highlightComponent] nodeSel.size() = ${nodeSel.size()}, nodeSel data:`, nodeSel.data().map(d => `${d.id} (${typeof d.id})`).join(", "));
  
  comp.graph.forEach((nbrs, v) => {
    const opacity = highlightLevel === 0 ? 1.0 : 0.4; // Reduce opacity for neighbors
    console.log(`[highlightComponent] Highlighting node ${v} with color ${originalCompColor}, opacity=${opacity}`);
    console.log(`[highlightComponent] nodeSel size before filter: ${nodeSel.size()}`);
    console.log(`[highlightComponent] Looking for node with id ${v} (type: ${typeof v})`);
    console.log(`[highlightComponent] All node ids in selection:`, nodeSel.data().map(d => `${d.id} (${typeof d.id})`).join(", "));
        highlightWithOpacity(nodeSel, String(v), originalCompColor, opacity);
    comp.highlightedNodes.push(String(v));
    
    // nbrs can be null for some graph entries (particularly in P components)
    if (nbrs) {
      nbrs.forEach(w => {
        if (comp.graph.has(w)) {
          const edgeKey = `${v}-${w}`;
          const isVirtualEdge = virtualEdgesToHighlight.has(edgeKey) && comp.type != 'P';
          
          // Find the attached component if this is a virtual edge
          let attachedComponentId = null;
          if (isVirtualEdge) {
            console.log(`[highlightComponent] Looking for virtual edge [${v}, ${w}]`);
            const virtualEdgeData = Array.from(state.data.virtualEdgeData.values()).find(ve => {
              const edgeStr = `${ve.nodes[0]}-${ve.nodes[1]}`;
              return edgeStr === `${v}-${w}` || edgeStr === `${w}-${v}`;
            });
            if (virtualEdgeData) {
              attachedComponentId = virtualEdgeData.components.find(id => id !== compId);
              console.log(`[highlightComponent] Found virtual edge, attached component: ${attachedComponentId}`);
            } else {
              console.log(`[highlightComponent] Virtual edge not found in virtualEdgeData, checking all entries...`);
              console.log(`[highlightComponent] Available virtual edges:`, Array.from(state.data.virtualEdgeData.entries()).map(([id, ve]) => ({ id, nodes: ve.nodes, components: ve.components })));
            }
          }
          
          const hoverTargetCompId = (isVirtualEdge && !suppressVirtualEdgeHover) ? attachedComponentId : null;
          highlightEdgeWithOpacity(linkSel, String(v), String(w), originalCompColor, isVirtualEdge, opacity, hoverTargetCompId);
          comp.highlightedEdges.push([String(v), String(w)]);
        }
      });
    }
  });
  console.log(`[highlightComponent] Component ${compId} has ${comp.highlightedNodes.length} nodes highlighted`);

}

/**
 * Draw curved virtual edges from P component nodes to centroids of attached components
 * @param {Object} pComponent - The P component to draw curves for
 * @param {string} color - The color to use for the curves
 */
function drawPComponentAttachmentCurves(pComponent, color) {
  console.log("Drawing P component attachment curves for:", pComponent.id);
  
  // Get ALL nodes of the P component (not just assuming 2)
  const pNodes = Array.from(pComponent.graph.keys()).map(String);
  console.log("P component nodes:", pNodes);
  
  if (pNodes.length < 2) {
    console.warn("P component has less than 2 nodes:", pNodes);
    return;
  }
  
  // For P components with only virtual edges, we need to identify the two main connection points
  // These should be the nodes that appear in the virtual edge entries
  let mainNodes = [];
  
  // Check if this P component has any real edges
  const hasRealEdges = Array.from(pComponent.graph.values()).some(neighbors => neighbors && neighbors.length > 0);
  
  if (!hasRealEdges) {
    // No real edges - find the connection nodes from virtual edges
    console.log("P component has no real edges, finding connection nodes from virtual edges");
    
    // Get unique nodes from all virtual edge entries
    const virtualNodes = new Set();
    pComponent.virtualEdgeEntry.forEach(([edge, virtualEdgeId]) => {
      const [u, v] = edge;
      virtualNodes.add(String(u));
      virtualNodes.add(String(v));
    });
    
    mainNodes = Array.from(virtualNodes);
    console.log("Virtual edge connection nodes:", mainNodes);
    
    if (mainNodes.length !== 2) {
      console.warn("Expected 2 connection nodes for P component, found:", mainNodes.length, mainNodes);
      // Fallback: use first two nodes if we don't have exactly 2
      mainNodes = pNodes.slice(0, 2);
    }
  } else {
    // Has real edges - use the traditional approach
    if (pNodes.length !== 2) {
      console.warn("P component with real edges doesn't have exactly 2 nodes:", pNodes);
      return;
    }
    mainNodes = pNodes;
  }
  
  const [node1, node2] = mainNodes;
  const node1Pos = state.data.inputNodePositions.get(node1);
  const node2Pos = state.data.inputNodePositions.get(node2);

  if (!node1Pos || !node2Pos) {
    console.warn("Could not find positions for P component main nodes:", node1, node2);
    console.warn("Available positions:", Array.from(state.data.inputNodePositions.keys()));
    return;
  }

  console.log("Using main nodes:", node1, "at", node1Pos, "and", node2, "at", node2Pos);

  // Get all attached components through virtual edges
  const attachedComponents = [];
  
  pComponent.virtualEdgeEntry.forEach(([edge, virtualEdgeId]) => {
    // Find the virtual edge data
    const virtualEdgeData = state.data.virtualEdgeData.get(virtualEdgeId);
    if (virtualEdgeData) {
      // Find the other component (not this P component)
      const otherComponentId = virtualEdgeData.components.find(id => id !== pComponent.id);
      if (otherComponentId) {
        const otherComponent = state.data.spqrTree.find(c => c.id === otherComponentId);
        if (otherComponent) {
          attachedComponents.push({
            component: otherComponent,
            virtualEdgeId: virtualEdgeId
          });
        }
      }
    }
  });

  console.log("Found attached components:", attachedComponents.map(ac => ac.component.id));

  // Draw a curved edge for each attached component
  attachedComponents.forEach((attachedComp, index) => {
    // Calculate centroid excluding the P component's main nodes
    const centroid = calculateComponentCentroid(attachedComp.component, mainNodes);
    if (centroid) {
      console.log(`Drawing curve ${index} to centroid:`, centroid);
      drawCurvedVirtualEdge(node1Pos, node2Pos, centroid, color, index, attachedComp.virtualEdgeId, attachedComp.component.id);
    } else {
      console.warn(`Could not calculate centroid for attached component ${attachedComp.component.id}`);
    }
  });
}

/**
 * Calculate the centroid (average position) of nodes in a component, excluding specified nodes
 * @param {Object} component - The component to calculate centroid for
 * @param {Array} excludeNodes - Array of node IDs to exclude from centroid calculation
 * @returns {Object|null} - {x, y} centroid position or null if no positions found
 */
function calculateComponentCentroid(component, excludeNodes = []) {
  let xSum = 0, ySum = 0, count = 0;
  const excludeSet = new Set(excludeNodes.map(String)); // Convert to strings for consistent comparison
  
  component.graph.forEach((_, nodeId) => {
    const nodeIdStr = String(nodeId);
    
    // Skip if this node should be excluded
    if (excludeSet.has(nodeIdStr)) {
      return;
    }
    
    const pos = state.data.inputNodePositions.get(nodeIdStr);
    if (pos) {
      xSum += pos.x;
      ySum += pos.y;
      count++;
    }
  });

  if (count === 0) {
    console.warn("No node positions found for component after excluding nodes:", component.id, excludeNodes);
    return null;
  }

  return {
    x: xSum / count,
    y: ySum / count
  };
}
/**
 * Draw a curved virtual edge from one P component vertex to the other, passing through the attached component centroid
 * @param {Object} node1Pos - Position of first P component node (point A)
 * @param {Object} node2Pos - Position of second P component node (point B)
 * @param {Object} centroid - Centroid position of attached component (point C)
 * @param {string} color - Color for the curve
 * @param {number} index - Index for curve identification
 * @param {string} virtualEdgeId - ID for the virtual edge (for uniqueness)
 * @param {string} attachedComponentId - ID of the attached component this curve represents
 */
function drawCurvedVirtualEdge(node1Pos, node2Pos, centroid, color, index, virtualEdgeId, attachedComponentId) {
  // Create a quadratic Bézier curve that starts at node1, ends at node2, and passes through centroid
  // For a quadratic Bézier curve: P(t) = (1-t)²*P0 + 2*(1-t)*t*P1 + t²*P2
  // Where P0 = start, P1 = control point, P2 = end
  // To pass through point C at t=0.5, we need: C = 0.25*P0 + 0.5*P1 + 0.25*P2
  // Solving for P1: P1 = 2*C - 0.5*P0 - 0.5*P2 = 2*C - 0.5*(P0 + P2)
  
  const controlX = 2 * centroid.x - 0.5 * (node1Pos.x + node2Pos.x);
  const controlY = 2 * centroid.y - 0.5 * (node1Pos.y + node2Pos.y);
  
  // Create the SVG path for the quadratic Bézier curve
  const pathData = `M ${node1Pos.x},${node1Pos.y} ` +
                   `Q ${controlX},${controlY} ` +
                   `${node2Pos.x},${node2Pos.y}`;
  
  // Add the path to the INPUT ZOOM CONTAINER (not elements.svgInput directly)
  const curvePath = InputZoomContainer
    .append("path")
    .attr("d", pathData)
    .attr("stroke", color)
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "8,6") // Dashed line to distinguish from regular edges
    .attr("fill", "none")
    .attr("opacity", 0.7)
    .attr("class", "p-component-attachment-curve")
    .attr("data-virtual-edge-id", virtualEdgeId)
    .attr("data-attached-component-id", attachedComponentId)
    .attr("data-p-component", "true")
    .style("cursor", "pointer");
  
  // Add hover events to highlight the attached component
  curvePath
    .on("mouseover", function() {
      console.log(`[P-curve hover] Hovering attachment curve for component ${attachedComponentId}`);
      highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, attachedComponentId);
      const attachedComp = state.data.spqrTree.find(c => c.id === attachedComponentId);
      if (attachedComp) {
        attachedComp.isHovered = true;
      }
      // Brighten the curve on hover
      d3.select(this).attr("stroke-width", 4).attr("opacity", 1.0);
    })
    .on("mouseout", function() {
      console.log(`[P-curve hover] Left attachment curve for component ${attachedComponentId}`);
      const attachedComp = state.data.spqrTree.find(c => c.id === attachedComponentId);
      if (attachedComp) {
        attachedComp.isHovered = false;
        // Only unhighlight if not selected
        if (!attachedComp.isSelected) {
          unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, attachedComponentId);
        }
      }
      // Return curve to normal state
      d3.select(this).attr("stroke-width", 2).attr("opacity", 0.7);
    });

  console.log(`Drew curved virtual edge for virtual edge ID ${virtualEdgeId} from P component passing through centroid`);
}

function highlightWithOpacity(selection, id, color = "orange", opacity = 1.0) {
  if (!selection) return;
  // Handle both string and numeric IDs for comparison
  const idToMatch = String(id);
  console.log(`[highlightWithOpacity] Looking for node ${idToMatch}, selection size: ${selection.size()}`);
  const filtered = selection.filter(d => {
    const matches = String(d.id) === idToMatch;
    console.log(`[highlightWithOpacity] Checking node ${d.id} (${typeof d.id}): "${String(d.id)}" === "${idToMatch}" -> ${matches}`);
    return matches;
  });
  console.log(`[highlightWithOpacity] After filter, found ${filtered.size()} matching nodes`);
  
  filtered
    .each(function () {
      const hits = (+this.getAttribute("data-hit") || 0) + 1;
      this.setAttribute("data-hit", hits);
      console.log(`[highlightWithOpacity] Node ${id}: hit count incremented to ${hits}, color=${color}, opacity=${opacity}`);

      d3.select(this)
        .style("fill", color)
        .attr("fill-opacity", opacity)
        .attr("stroke", color)
        .attr("stroke-width", 4)
        .attr("stroke-opacity", opacity)
        .attr("data-base-r", 12)
        .attr("r", zoomAdjustedR(12, "input"))
        .raise();
    });
}
function highlightEdgeWithOpacity(linkSel, srcId, tgtId, color = "purple", dashed = false, opacity = 1.0, attachedComponentId = null) {
  const existingEdge = linkSel.filter(d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      ((String(sid) === String(srcId) && String(tid) === String(tgtId))
        || (String(sid) === String(tgtId) && String(tid) === String(srcId))) &&
      !d.temporary
    );
  });

  if (existingEdge.size() > 0) {
    console.log(`[highlightEdgeWithOpacity] Found edge [${srcId}, ${tgtId}], size=${existingEdge.size()}, attachedComponentId=${attachedComponentId}`);
    
    // Only update the visible edge, not the hit area
    const visibleEdge = InputZoomContainer.selectAll(".edge-visible").filter(d => {
      const sid = typeof d.source === "object" ? d.source.id : d.source;
      const tid = typeof d.target === "object" ? d.target.id : d.target;
      return (
        ((String(sid) === String(srcId) && String(tid) === String(tgtId))
          || (String(sid) === String(tgtId) && String(tid) === String(srcId))) &&
        !d.temporary
      );
    });

    // Imported and preset graphs initially use one set of visible lines for
    // both drawing and pointer events. After an SPQR drawing is calculated,
    // linkSel instead contains transparent hit areas and .edge-visible holds
    // the visible line/path. Support both representations.
    const drawableEdge = visibleEdge.size() > 0
      ? visibleEdge
      : existingEdge.filter(function() {
          return !this.classList?.contains("edge-hit-area");
        });

    if (drawableEdge.size() > 0) {
      const currentStroke = drawableEdge.attr("stroke");
      const isTypeColor = c => c === "red" || c === "green" || c === "blue";
      // Block transient (non-type) colors from overriding a selection color, but allow
      // one type color to update to another (e.g. hover-B updates the shared virtual edge).
      if (isTypeColor(currentStroke) && !isTypeColor(color)) return;
      const hK = Math.sqrt(d3.zoomTransform(elements.svgInput.node()).k);
      drawableEdge
        .attr("stroke", color)
        .attr("stroke-opacity", opacity)
        .attr("data-base-sw", 3)
        .attr("stroke-width", 3 / hK)
        .attr("stroke-dasharray", dashed ? "5,5" : null)
        .raise();
    }

    // Keep hit areas transparent - don't modify their appearance
    // existingEdge stays as-is (transparent)
    
    // Add hover handlers for virtual edges to highlight them in SPQR pictograms
    if (dashed && attachedComponentId) {
      existingEdge
        .style("cursor", "pointer")
        .on("mouseover", function() {
          console.log(`[virtual-edge hover] Hovering virtual edge [${srcId}, ${tgtId}] - highlighting in pictograms`);
          highlightEdgeInSPQRDrawing(srcId, tgtId, "purple", true);
        })
        .on("mouseout", function() {
          console.log(`[virtual-edge hover] Left virtual edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
          unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
        });
    }
  } else {
    // Handle temporary edge creation with opacity (similar to existing highlightEdge function)
    const existingTempEdge = d3.select(linkSel.node().parentNode)
      .selectAll(".temporary-edge")
      .filter(d => {
        const sid = d.source.id;
        const tid = d.target.id;
        return (sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId);
      });
    
    if (existingTempEdge.size() > 0) {
      existingTempEdge
        .attr("stroke", color)
        .attr("stroke-opacity", opacity)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", dashed ? "5,5" : null)
        .raise();
      
      // Add hover handlers for virtual edges to highlight them in SPQR pictograms
      if (dashed && attachedComponentId) {
        existingTempEdge
          .style("cursor", "pointer")
          .on("mouseover", function() {
            console.log(`[virtual-edge hover] Hovering virtual temp edge [${srcId}, ${tgtId}] - highlighting in pictograms`);
            highlightEdgeInSPQRDrawing(srcId, tgtId, "purple", true);
          })
          .on("mouseout", function() {
            console.log(`[virtual-edge hover] Left virtual temp edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
            unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
          });
      }
    } else {
      // Create temporary edge with opacity (rest of the logic from highlightEdge)
      const allNodes = InputZoomContainer.selectAll(".input-node").data();
      
      const sourceNode = allNodes.find(d => d.id === srcId);
      const targetNode = allNodes.find(d => d.id === tgtId);
      
      if (sourceNode && targetNode) {
        const newEdgeData = {
          source: sourceNode,
          target: targetNode,
          temporary: true
        };
        
        const tempEdge = d3.select(linkSel.node().parentNode)
          .append("line")
          .datum(newEdgeData)
          .attr("class", "temporary-edge")
          .attr("stroke", color)
          .attr("stroke-opacity", opacity)
          .attr("stroke-width", 3)
          .attr("stroke-dasharray", dashed ? "5,5" : null)
          .attr("x1", sourceNode.x || 0)
          .attr("y1", sourceNode.y || 0)
          .attr("x2", targetNode.x || 0)
          .attr("y2", targetNode.y || 0)
          .raise();
        
        // Add hover handlers for virtual edges to highlight them in SPQR pictograms
        if (dashed && attachedComponentId) {
          tempEdge
            .style("cursor", "pointer")
            .on("mouseover", function() {
              console.log(`[virtual-edge hover] Hovering virtual new edge [${srcId}, ${tgtId}] - highlighting in pictograms`);
              highlightEdgeInSPQRDrawing(srcId, tgtId, "purple", true);
            })
            .on("mouseout", function() {
              console.log(`[virtual-edge hover] Left virtual new edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
              unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
            });
        }
      }
    }
  }
}
function unhighlightComponent(nodeSel, linkSel, compId, color = "orange", fromP = false, highlightLevel = 0, forceFullUnhighlight = false) {
  // Always use fresh selections so newly drawn nodes/edges are correctly unhighlighted.
  // Draw from SPQR adds overlay circles on the input canvas; only target actual graph nodes.
  nodeSel = InputZoomContainer.selectAll(".input-node");
  linkSel = InputZoomContainer.selectAll(".edge-hit-area");

  const comp = state.data.spqrTree.find(c => c.id === compId);
  if (!comp) return;
  
  
  // Determine the original component's color based on its type
  let originalCompColor;
  switch(comp.type) {
    case "R":
      originalCompColor = "red";
      break;
    case "S":
      originalCompColor = "green";
      break;
    case "P":
      originalCompColor = "blue";
      break;
    default:
      originalCompColor = "orange";
  }
  
  if(!fromP) unhighlightSPQRNode(compId);

  // Unhighlight nodes - pass the component ID being unhighlighted so it won't be used for restoration
  const unihighlightedNodeIds = new Set();
  if (comp.highlightedNodes) {

    comp.highlightedNodes.forEach(nodeId => {

      unihighlightedNodeIds.add(nodeId);
      unhighlight(nodeSel, nodeId, originalCompColor, compId, forceFullUnhighlight);
    });
    comp.highlightedNodes = [];
  }

  // Unhighlight edges
  if (comp.highlightedEdges) {
    comp.highlightedEdges.forEach(([srcId, tgtId]) => {
      unhighlightEdgeWithOpacity(linkSel, srcId, tgtId, originalCompColor);
    });
    comp.highlightedEdges = [];
  }
  
  if(forceFullUnhighlight) {
    console.log(`[unhighlightComponent] forceFullUnhighlight is true; skipping re-highlighting of selected components`);
    return;
  }
  // After unhighlighting, re-apply highlighting for any selected components that had nodes unhighlighted
  // BUT skip the component being unhighlighted (compId) even if it's still marked as selected
  for (const otherComp of state.data.spqrTree) {
    // Skip the component being unhighlighted
    if (otherComp.id === compId) continue;
    
    // Only re-highlight if still selected
    if (!otherComp.isSelected) continue;
    
    // Check if this selected component has any nodes that were just unhighlighted
    let hasSharedNodes = false;
    for (const nodeId of unihighlightedNodeIds) {
      if (otherComp.graph && otherComp.graph.has(Number(nodeId))) {
        hasSharedNodes = true;
        break;
      }
    }
    
    if (!hasSharedNodes) continue;
    
    // Determine color for selected component
    let otherColor;
    switch(otherComp.type) {
      case "R":
        otherColor = "red";
        break;
      case "S":
        otherColor = "green";
        break;
      case "P":
        otherColor = "blue";
        break;
      default:
        otherColor = "orange";
    }
    
    console.log(`[unhighlightComponent] Re-highlighting selected component ${otherComp.id} (shared nodes with ${compId})`);
    
    // Re-highlight all nodes of the selected component (not just shared ones)
    if (otherComp.graph) {
      otherComp.graph.forEach((nbrs, v) => {
        highlightWithOpacity(nodeSel, String(v), otherColor, 1.0);
      });
      
      // Re-highlight all edges of the selected component
      const virtualEdgesToHighlight = new Set();
      otherComp.virtualEdgeEntry.forEach(([edge, _]) => {
        const [u, v] = edge;
        virtualEdgesToHighlight.add(`${u}-${v}`);
        virtualEdgesToHighlight.add(`${v}-${u}`);
      });
      
      otherComp.graph.forEach((nbrs, v) => {
        if (nbrs) {
          nbrs.forEach(w => {
            if (otherComp.graph.has(w)) {
              const edgeKey = `${v}-${w}`;
              const isVirtualEdge = virtualEdgesToHighlight.has(edgeKey) && otherComp.type !== 'P';
              highlightEdgeWithOpacity(linkSel, String(v), String(w), otherColor, isVirtualEdge, 1.0);
            }
          });
        }
      });
      
      // For P components without real edges, re-highlight virtual edges
      if (otherComp.type === 'P') {
        const hasRealEdges = Array.from(otherComp.graph.values()).some(neighbors => neighbors && neighbors.length > 0);
        if (!hasRealEdges) {
          otherComp.virtualEdgeEntry.forEach(([edge, _]) => {
            const [u, v] = edge;
            highlightEdgeWithOpacity(linkSel, String(u), String(v), otherColor, true, 1.0);
          });
        }
      }
    }
  }

  // Only unhighlight neighbors at level 0
  if(highlightLevel === 0 && (comp.type === 'P' || comp.type === 'R' || comp.type === 'S')) {
    let colorIndex = 0;
    for (const neighbor of comp.neighbors) {
      // Skip unhighlighting neighbors that are currently selected OR hovered
      const neighborComp = state.data.spqrTree.find(c => c.id === neighbor.id);
      if (neighborComp && (neighborComp.isSelected || neighborComp.isHovered)) {
        continue;
      }
      
      // Use cycling through state.ui.colors for each neighbor, but skip the original component's color
      let neighborColor;
      do {
        neighborColor = state.ui.colors[colorIndex % state.ui.colors.length];
        colorIndex++;
      } while (neighborColor === originalCompColor && state.ui.colors.length > 1);
      
      unhighlightComponent(nodeSel, linkSel, neighbor.id, neighborColor, true, 1);
      unhighlightSPQRNode(neighbor.id);
    }
    
    // Re-highlight any components that are still selected/hovered and share vertices with this one
    for (const otherComp of state.data.spqrTree) {
      if (otherComp.id === compId) continue;
      if (!otherComp.isSelected && !otherComp.isHovered) continue;
      
      // Check if otherComp shares any nodes with the component being unhighlighted
      let sharesNodes = false;
      if (comp.highlightedNodes && comp.highlightedNodes.length > 0) {
        for (const nodeId of comp.highlightedNodes) {
          if (otherComp.graph && otherComp.graph.has(Number(nodeId))) {
            sharesNodes = true;
            break;
          }
        }
      }
      
      if (!sharesNodes) continue;
      
      // Determine color for re-highlighting
      let otherColor;
      switch(otherComp.type) {
        case "R":
          otherColor = "red";
          break;
        case "S":
          otherColor = "green";
          break;
        case "P":
          otherColor = "blue";
          break;
        default:
          otherColor = "orange";
      }
      
      console.log(`[unhighlightComponent] Re-highlighting component ${otherComp.id} (isSelected=${otherComp.isSelected}, isHovered=${otherComp.isHovered})`);
      
      // Determine which edges are virtual edges
      const virtualEdgesToHighlight = new Set();
      otherComp.virtualEdgeEntry.forEach(([edge, _]) => {
        const [u, v] = edge;
        virtualEdgesToHighlight.add(`${u}-${v}`);
        virtualEdgesToHighlight.add(`${v}-${u}`);
      });
      
      // Re-highlight nodes and edges from otherComp
      if (otherComp.graph && otherComp.graph.size > 0) {
        otherComp.graph.forEach((nbrs, v) => {
          highlightWithOpacity(nodeSel, String(v), otherColor, 1.0);
          if (!otherComp.highlightedNodes) otherComp.highlightedNodes = [];
          if (!otherComp.highlightedNodes.includes(String(v))) {
            otherComp.highlightedNodes.push(String(v));
          }
          
          if (nbrs) {
            nbrs.forEach(w => {
              if (otherComp.graph.has(w)) {
                const edgeKey = `${v}-${w}`;
                const isVirtualEdge = virtualEdgesToHighlight.has(edgeKey) && otherComp.type !== 'P';
                highlightEdgeWithOpacity(linkSel, String(v), String(w), otherColor, isVirtualEdge, 1.0);
                if (!otherComp.highlightedEdges) otherComp.highlightedEdges = [];
                const edgeExists = otherComp.highlightedEdges.some(e => 
                  (e[0] === String(v) && e[1] === String(w)) || 
                  (e[0] === String(w) && e[1] === String(v))
                );
                if (!edgeExists) {
                  otherComp.highlightedEdges.push([String(v), String(w)]);
                }
              }
            });
          }
        });
        
        // For P components without real edges, also re-highlight virtual edges
        if (otherComp.type === 'P') {
          const hasRealEdges = Array.from(otherComp.graph.values()).some(neighbors => neighbors && neighbors.length > 0);
          if (!hasRealEdges) {
            otherComp.virtualEdgeEntry.forEach(([edge, _]) => {
              const [u, v] = edge;
              highlightEdgeWithOpacity(linkSel, String(u), String(v), otherColor, true, 1.0);
              if (!otherComp.highlightedEdges) otherComp.highlightedEdges = [];
              const edgeExists = otherComp.highlightedEdges.some(e => 
                (e[0] === String(u) && e[1] === String(v)) || 
                (e[0] === String(v) && e[1] === String(u))
              );
              if (!edgeExists) {
                otherComp.highlightedEdges.push([String(u), String(v)]);
              }
            });
          }
        }
      }
    }
  }

    // Remove P component attachment curves if this is a P component
  if (comp.type === 'P' && highlightLevel === 0) {
    elements.svgInput.selectAll(".p-component-attachment-curve").remove();
    elements.svgInput.selectAll(".p-component-attachment-arrow").remove();
  }
}


function unhighlightEdgeWithOpacity(linkSel, srcId, tgtId, color = "purple") {
  const matchesEdge = d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      (String(sid) === String(srcId) && String(tid) === String(tgtId))
      || (String(sid) === String(tgtId) && String(tid) === String(srcId))
    );
  };

  // Unhighlight hit areas
  linkSel
    .filter(function(d) {
      return this.classList?.contains("edge-hit-area") && matchesEdge(d);
    })
    .attr("stroke", "transparent")
    .attr("stroke-opacity", 1)
    .attr("data-base-sw", 15)
    .attr("stroke-width", 15 / Math.sqrt(d3.zoomTransform(elements.svgInput.node()).k))
    .attr("stroke-dasharray", null);
  
  // Unhighlight visible edges — restore zoom-adjusted width using data-base-sw
  const uK = Math.sqrt(d3.zoomTransform(elements.svgInput.node()).k);

  // Before routing, the hovered selection is itself the visible edge. Restore
  // its normal style instead of accidentally making it a transparent hit area.
  linkSel
    .filter(function(d) {
      return !this.classList?.contains("edge-hit-area") && matchesEdge(d);
    })
    .attr("stroke", "#999")
    .attr("stroke-opacity", 1)
    .attr("data-base-sw", 2)
    .attr("stroke-width", 2 / uK)
    .attr("stroke-dasharray", null);

  // Routed visible edges are kept separate from their hit areas.
  InputZoomContainer.selectAll(".edge-visible")
    .filter(matchesEdge)
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .attr("data-base-sw", 2)
    .attr("stroke-width", 2 / uK)
    .attr("stroke-dasharray", null);
 
  const firstNode = linkSel.node();
  if (firstNode) {
    const svg = firstNode.parentNode.parentNode;
    d3.select(svg).selectAll("line.temporary-edge")
      .filter(d =>
        (d.source.id === srcId && d.target.id === tgtId) ||
        (d.source.id === tgtId && d.target.id === srcId)
      )
      .remove();
  }
}

/** Highlight a SPQR component bounding box in the SPQR drawing
 * @param {string} compId - The ID of the SPQR component
 * @param {string} color - The highlight color
 */

function highlightSPQRNode(compId, color = "orange", nodes = true) {
  const comp = state.data.spqrTree?.find(c => c.id === compId);
  if (comp?.isSelected) return;
  const compGroup = elements.svgSPQR.select(`g.spqr-component[data-comp-id='${compId}']`);
  if (!compGroup.empty()) {
    compGroup.select("rect.bounding-box")
      .attr("stroke", color)
      .attr("stroke-width", 3);

      if(!nodes) return;

    compGroup.selectAll("circle.node")
      .attr("fill", color);
  }
}

function unhighlightSPQRNode(compId) {
  const comp = state.data.spqrTree?.find(c => c.id === compId);
  if (comp?.isSelected) return;
  const compGroup = elements.svgSPQR.select(`g.spqr-component[data-comp-id='${compId}']`);
  if (!compGroup.empty()) {
    compGroup.select("rect.bounding-box")
      .attr("stroke", "#000")        // reset default stroke
      .attr("stroke-width", 1);

    compGroup.selectAll("circle.node")
      .attr("fill", "#3498db");      // reset default node color
  }
}

const toolButtons = document.querySelectorAll(".tool-button");


function setActiveTool(toolName) {
  const activeBtn = document.getElementById(`${toolName}-mode`);
  const isAlreadyActive = activeBtn.classList.contains("active-tool");

  // If already active, deactivate
  if (isAlreadyActive) {
    activeBtn.classList.remove("active-tool");
    state.ui_state.currentTool = null; // no active tool
    return;
  }

  // Otherwise, activate and remove active state from others
  toolButtons.forEach(btn => btn.classList.remove("active-tool"));
  activeBtn.classList.add("active-tool");
  state.ui_state.currentTool = toolName;
}

function setActiveToolOff() {
  toolButtons.forEach(btn => btn.classList.remove("active-tool"));
  state.ui_state.currentTool = null; // no active tool
}

/**
 * Build tree structure from root using BFS with spatial ordering
 */
function buildTreeStructure(root, spqrTree) {
    console.log("  📦 Building adjacency list...");
    const adjacency = {};
    spqrTree.forEach(comp => {
        adjacency[comp.id] = (comp.neighbors || []).map(n => n.id);

    });
    console.log("  Adjacency list:", adjacency);
   
    // Get component positions from input graph
    console.log("  📍 Computing component positions from input graph...");
    const componentPositions = SPQRComponentPositionsFromInputGraph();
   
    const visited = new Set();
    const treeNodes = {};
   
    // Create root node
    console.log("  🌱 Creating root node:", root.id);
    const rootNode = {
        id: root.id,
        component: root,
        children: [],
        parent: null,
        level: 0, // Add level information
        x: 0,
        y: 0,
        mod: 0,
        thread: null,
        ancestor: null,
        change: 0,
        shift: 0,
        prelim: 0
    };
   
    treeNodes[root.id] = rootNode;
    visited.add(root.id);
   
    // BFS to build tree structure with spatial ordering
    console.log("  🔍 Starting BFS to build tree structure...");
    const queue = [rootNode];
    let level = 0;
   
    while (queue.length > 0) {
        const levelSize = queue.length;
        console.log(`    Level ${level}: Processing ${levelSize} nodes`);
       
        for (let i = 0; i < levelSize; i++) {
            const current = queue.shift();
            const neighbors = adjacency[current.id] || [];
            console.log(`      Processing node ${current.id} (level ${current.level}) with neighbors:`, neighbors);
           
            // Filter unvisited neighbors and create child info
            const childCandidates = [];
            for (const neighborId of neighbors) {
                if (!visited.has(neighborId)) {
                    const neighborComp = spqrTree.find(comp => comp.id === neighborId);
                    const neighborIndex = spqrTree.findIndex(comp => comp.id === neighborId);
                    const position = componentPositions.get(neighborIndex);
                   
                    childCandidates.push({
                        id: neighborId,
                        component: neighborComp,
                        position: position,
                        index: neighborIndex
                    });
                }
            }
           
            // Sort children by spatial position relative to parent
            if (childCandidates.length > 0) {
                const sortedChildren = sortChildrenSpatiallyAdvanced(current, childCandidates, componentPositions);
               
                // Create tree nodes for sorted children
                for (const childInfo of sortedChildren) {
                    visited.add(childInfo.id);
                   
                    const childNode = {
                        id: childInfo.id,
                        component: childInfo.component,
                        children: [],
                        parent: current,
                        level: current.level + 1, // Set child level as parent level + 1
                        x: 0,
                        y: 0,
                        mod: 0,
                        thread: null,
                        ancestor: null,
                        change: 0,
                        shift: 0,
                        prelim: 0
                    };
                   
                    current.children.push(childNode);
                    treeNodes[childInfo.id] = childNode;
                    queue.push(childNode);
                    
                    console.log(`      Created child node ${childInfo.id} at level ${childNode.level}`);
                }
            }
        }
        level++;
    }
   
    console.log("  ✅ Tree structure complete. Total nodes:", Object.keys(treeNodes).length);
    console.log("  Tree hierarchy with levels:");
    logTreeHierarchyWithLevels(rootNode, 0);
   
    // Optional: Store level information back to original components for easy access
    Object.values(treeNodes).forEach(node => {
        if (node.component) {
            node.component.treeLevel = node.level;

        }
    });
   
    return { root: rootNode, nodes: treeNodes };
}

/**
 * Log tree hierarchy with level information
 */
function logTreeHierarchyWithLevels(node, depth) {
    const indent = "  ".repeat(depth);
    console.log(`${indent}${node.id} (level: ${node.level}, children: ${node.children.length})`);
    
    for (const child of node.children) {
        logTreeHierarchyWithLevels(child, depth + 1);
    }
}

/**
 * Helper function to get component level by ID
 */
function getComponentLevel(componentId, treeNodes) {
    const node = treeNodes[componentId];
    return node ? node.level : -1;
}

/**
 * Helper function to get all components at a specific level
 */
function getComponentsAtLevel(level, treeNodes) {
    return Object.values(treeNodes).filter(node => node.level === level);
}

/**
 * Helper function to get the maximum level in the tree
 */
function getMaxTreeLevel(treeNodes) {
    return Math.max(...Object.values(treeNodes).map(node => node.level));
}

/**
 * Enhanced version that considers the viewing direction
 */
function sortChildrenSpatiallyAdvanced(parent, childCandidates, componentPositions) {
    const parentIndex = state.data.spqrTree.findIndex(comp => comp.id === parent.id);
    const parentPos = componentPositions.get(parentIndex);
    
    if (!parentPos || childCandidates.length <= 1) {
        return childCandidates;
    }
    
    // For tree layout, we typically want left-to-right ordering
    // Sort primarily by x-coordinate, then by y-coordinate for ties
    const sortedChildren = childCandidates.slice().sort((a, b) => {
        if (!a.position && !b.position) return 0;
        if (!a.position) return 1;
        if (!b.position) return -1;
        
        // Primary sort: x-coordinate (left to right)
        const xDiff = a.position.x - b.position.x;
        if (Math.abs(xDiff) > 5) { // 5px tolerance
            return xDiff;
        }
        
        // Secondary sort: y-coordinate (top to bottom)
        return a.position.y - b.position.y;
    });
    
    console.log(`        Spatially sorted children: ${sortedChildren.map(c => 
        c.position ? `${c.id}(${c.position.x.toFixed(1)},${c.position.y.toFixed(1)})` : `${c.id}(no pos)`
    ).join(', ')}`);
    
    return sortedChildren;
}

function logTreeHierarchy(node, depth) {
    const indent = "    ".repeat(depth);
    console.log(`${indent}${node.id} (${node.children.length} children)`);
    for (const child of node.children) {
        logTreeHierarchy(child, depth + 1);
    }
}




/**
 * Reingold-Tilford layout algorithm with level-wide spacing enforcement
 */
function reingoldTilfordLayout(tree) {
    const nodeSize = 200; // Minimum 200px horizontal spacing
    const levelHeight = 225; // Vertical spacing between levels
    
    
    // First walk: compute preliminary x-coordinates and modifiers
    firstWalk(tree.root, nodeSize);
    
    console.log("  🚶 Second walk: computing final coordinates...");
    // Second walk: compute final coordinates
    secondWalk(tree.root, -tree.root.prelim, 0, levelHeight);
    
    console.log("  🔧 Enforcing level-wide spacing...");
    // NEW: Enforce spacing across entire levels
    enforceLevelWideSpacing(tree, nodeSize);
    
    console.log("  ✅ Layout algorithm complete");
    logNodePositions(tree.root);
    
    return tree;
}

/**
 * Enforce minimum spacing between ALL nodes on the same level
 */
function enforceLevelWideSpacing(tree, minSpacing) {
    // Group nodes by level (y-coordinate)
    const nodesByLevel = {};
    Object.values(tree.nodes).forEach(node => {
        if (!nodesByLevel[node.y]) {
            nodesByLevel[node.y] = [];
        }
        nodesByLevel[node.y].push(node);
    });
    
    // Process each level
    Object.keys(nodesByLevel).forEach(level => {
        const nodes = nodesByLevel[level];
        if (nodes.length <= 1) return;
        
        // Sort nodes by x-coordinate
        nodes.sort((a, b) => a.x - b.x);
        
        // Adjust positions to ensure minimum spacing
        for (let i = 1; i < nodes.length; i++) {
            const prevNode = nodes[i - 1];
            const currentNode = nodes[i];
            const actualSpacing = currentNode.x - prevNode.x;
            
            if (actualSpacing < minSpacing) {
                const adjustment = minSpacing - actualSpacing;
                
                // Shift this node and all nodes to the right
                for (let j = i; j < nodes.length; j++) {
                    nodes[j].x += adjustment;
                }
            }
        }
        
    });
}
function firstWalk(node, nodeSize) {
    
    if (node.children.length === 0) {
        // Leaf node
        if (node.parent && node.parent.children[0] === node) {
            // Leftmost child
            node.prelim = 0;
        } else if (node.parent) {
            // Get previous sibling
            const siblings = node.parent.children;
            const index = siblings.indexOf(node);
            const prevSibling = siblings[index - 1];
            node.prelim = prevSibling.prelim + nodeSize;
        } else {
            // Root leaf node (edge case)
            node.prelim = 0;
        }
    } else {
      console.log("before sort",node.children)
        sortChildrenByVirtualEdgeOrder(node);
        console.log("after sort:", node.children);
        // Internal node
        // Recursively process children
        for (const child of node.children) {
            firstWalk(child, nodeSize); // Increase size for children
        }
        
        // Get leftmost and rightmost children
        const leftmost = node.children[0];
        const rightmost = node.children[node.children.length - 1];
        
        // Position node at midpoint of children
        const midpoint = (leftmost.prelim + rightmost.prelim) / 2;
        
        if (!node.parent) {
            // Root node
            node.prelim = midpoint;
        } else if (node.parent.children[0] === node) {
            // Leftmost child
            node.prelim = midpoint;
        } else {
            // Get previous sibling
            const siblings = node.parent.children;
            const index = siblings.indexOf(node);
            const prevSibling = siblings[index - 1];
            node.prelim = prevSibling.prelim + nodeSize;
            node.mod = node.prelim - midpoint;
        }
        
        // Check for conflicts and adjust (only for non-root nodes)
        if (node.children.length > 0 && node.parent) {
            checkForConflicts(node, nodeSize);
        }
    }
}

function sortChildrenByVirtualEdgeOrder(node) {
    const comp = state.data.spqrTree.find(c => c.id === node.id);
    if (!comp || !comp.virtualEdgeEntry || comp.virtualEdgeEntry.length === 0) return;

    const virtualEdgePositions = new Map();

    if (comp.type === 'P') {
        // If a user-set embeddingOrder exists, use it directly as the authoritative sort key.
        const storedChildOrder = getStoredPChildOrder(comp);
        if (storedChildOrder.length > 0) {
            const orderMap = new Map(storedChildOrder.map((id, pos) => [id, pos]));
            node.children.sort((a, b) =>
                (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity)
            );
            return;
        }

        // Get the visual order from the component's saved order
        const visualOrder = getPComponentVirtualEdgeOrder(comp.id);
        
        console.log(`\nSorting P-component ${node.id} children using visual order:`);
        console.log('Visual order:', visualOrder);
        
        // Map each child to its visual position
        node.children.forEach(child => {
            // Find which virtual edge connects to this child
            const childVirtualEdge = visualOrder.find(ve => {
                const childVE = state.data.virtualEdgeData.get(ve.virtualEdgeId);
                return childVE && childVE.components.includes(child.id);
            });
            
            if (childVirtualEdge) {
                virtualEdgePositions.set(child.id, {
                    visualPosition: childVirtualEdge.visualPosition,
                    curveOffset: childVirtualEdge.curveOffset,
                    virtualEdgeId: childVirtualEdge.virtualEdgeId,
                    isParentEdge: childVirtualEdge.isParentEdge
                });
            }
        });

        console.log('Before sorting:', node.children.map(child => ({
            id: child.id,
            data: virtualEdgePositions.get(child.id)
        })));

        // Sort children by their visual position in the P component
        node.children.sort((a, b) => {
            const posA = virtualEdgePositions.get(a.id);
            const posB = virtualEdgePositions.get(b.id);
            
            // If no position data, keep original order
            if (!posA || !posB) {
                return 0;
            }
            
            // Sort by visual position (which is already sorted by curve offset)
            return posA.visualPosition - posB.visualPosition;
        });

        console.log('After sorting:', node.children.map(child => ({
            id: child.id,
            data: virtualEdgePositions.get(child.id)
        })));
    }
}


function swapVirtualEdgesInPComponent(componentId, pos1, pos2) {
    const comp = state.data.spqrTree.find(c => c.id === componentId);
    
    if (!comp || comp.type !== 'P') {
        console.warn(`Component ${componentId} is not a P component`);
        return false;
    }
    
    // Swap in the actual virtualEdgeEntry array
    [comp.virtualEdgeEntry[pos1], comp.virtualEdgeEntry[pos2]] = 
    [comp.virtualEdgeEntry[pos2], comp.virtualEdgeEntry[pos1]];
    
    // Clear the cached visual order so it gets regenerated on next draw
    comp.visualVirtualEdgeOrder = null;
    
    // Redraw the component
    redrawPComponent(componentId);
    updateInterComponentVirtualEdges();
    
    return true;
}

/**
 * Redraw a specific P component after virtual edge swap
 * @param {string} componentId - The ID of the component to redraw
 */
function redrawPComponent(componentId) {
    const compIndex = state.data.spqrTree.findIndex(c => c.id === componentId);
    if (compIndex === -1) {
        console.warn(`Component ${componentId} not found in SPQR tree`);
        return;
    }
    
    const comp = state.data.spqrTree[compIndex];
    const group = d3.select(`#spqr-component-${compIndex}`);
    
    if (group.empty()) {
        console.warn(`Component group for ${componentId} not found in DOM`);
        return;
    }
    
    // Get current transform to preserve position
    const transform = group.attr("transform");
    const currentData = group.datum();
    
    // Clear existing content
    group.selectAll("*").remove();
    
    // Redraw the component
    drawOrientedPComponent(group, comp, false);
    
    // Restore transform and data
    group.attr("transform", transform);
    group.datum(currentData);
}

/**
 * Get the current visual order of virtual edges in a P component as drawn
 * @param {string} componentId - The ID of the P component
 * @returns {Array} Array of edge descriptions with their visual positions
 */
function getPComponentVirtualEdgeOrder(componentId) {
    const comp = state.data.spqrTree.find(c => c.id === componentId);
    
    if (!comp || comp.type !== 'P') {
        console.warn(`Component ${componentId} is not a P component`);
        return [];
    }
    
    // Get the stored visual order and sort by curveOffset to ensure correct visual order
    const visualOrder = comp.visualVirtualEdgeOrder || [];
    
    // Sort by curveOffset to get the actual visual order from top to bottom (or left to right)
    const sortedOrder = visualOrder.slice().sort((a, b) => {
        // Sort by curve offset - negative offsets appear above/left, positive below/right
        return a.curveOffset - b.curveOffset;
    });
    
    // Re-index the visual positions after sorting
    return sortedOrder.map((edge, index) => ({
        ...edge,
        visualPosition: index
    }));
}
/**
 * Interactive function to help identify which edges to swap
 * @param {string} componentId - The ID of the P component
 */
function analyzePComponentEdgeOrder(componentId) {
    const comp = state.data.spqrTree.find(c => c.id === componentId);
    
    if (!comp || comp.type !== 'P') {
        console.warn(`Component ${componentId} is not a P component`);
        return;
    }
    
    console.log(`\n=== P Component ${componentId} Virtual Edge Analysis ===`);
    
    const edgeOrder = getPComponentVirtualEdgeOrder(componentId);
    edgeOrder.forEach(edge => {
        console.log(`Position ${edge.position}: ${edge.description} (ID: ${edge.virtualEdgeId})`);
    });
    
    // Show connected components
    edgeOrder.forEach(edge => {
        const virtualEdgeData = state.data.virtualEdgeData.get(edge.virtualEdgeId);
        if (virtualEdgeData) {
            const otherComp = virtualEdgeData.components.find(id => id !== componentId);
            console.log(`  ${edge.virtualEdgeId} connects to component: ${otherComp}`);
        }
    });
    
    console.log(`\nTo swap edges, use:`);
    console.log(`swapVirtualEdgesInPComponent("${componentId}", pos1, pos2)`);
    console.log(`or`);
    console.log(`swapVirtualEdgesByNodes("${componentId}", [node1, node2], [node3, node4])`);
}


// Convenience function to swap adjacent edges
function swapAdjacentEdges(componentId, position) {
    return swapVirtualEdgesInPComponent(componentId, position, position + 1);
}

// Example usage functions for the console:


function checkForConflicts(node, nodeSize) {
    const siblings = node.parent.children;
    const nodeIndex = siblings.indexOf(node);
    
    
    if (nodeIndex > 0) {
        const prevSibling = siblings[nodeIndex - 1];
        
        // Check actual distance between siblings
        const actualDistance = node.prelim - prevSibling.prelim;
        
        if (actualDistance < nodeSize) {
            // Enforce minimum distance
            const shift = nodeSize - actualDistance;
            
            // Shift this node and all subsequent siblings
            for (let i = nodeIndex; i < siblings.length; i++) {
                const oldPrelim = siblings[i].prelim;
                siblings[i].prelim += shift;
                siblings[i].mod += shift;
            }
        }
        // Also check subtree conflicts (your original logic)
        const minDistance = getMinDistance(prevSibling, node, nodeSize);
        
        if (minDistance > 0) {
            // Additional shift for subtree conflicts
            const additionalShift = minDistance;
            
            // Shift this node and all subsequent siblings
            for (let i = nodeIndex; i < siblings.length; i++) {
                const oldPrelim = siblings[i].prelim;
                siblings[i].prelim += additionalShift;
                siblings[i].mod += additionalShift;
            }
        }
    }
}
function getMinDistance(left, right, nodeSize) {
    
    // For SPQR components, we need extra spacing to account for the pictogram size
    const componentPadding = 50; // Extra padding around each component
    
    // Simplified conflict detection with better spacing
    const leftRight = getContour(left, 'right', 0, []);
    const rightLeft = getContour(right, 'left', 0, []);
    
    let minDistance = 0;
    const maxLevels = Math.min(leftRight.length, rightLeft.length);
    
    for (let level = 0; level < maxLevels; level++) {
        const distance = leftRight[level] - rightLeft[level] + componentPadding;
        if (distance > minDistance) {
            minDistance = distance;
        }
    }

    return minDistance;
}

function getContour(node, side, level = 0, contour = [], parentMod = 0) {
    const nodePos = node.prelim + node.mod + parentMod;
    
    if (level >= contour.length) {
        contour.push(nodePos);
    } else {
        if (side === 'left') {
            contour[level] = Math.min(contour[level], nodePos);
        } else {
            contour[level] = Math.max(contour[level], nodePos);
        }
    }
    
    for (const child of node.children) {
        getContour(child, side, level + 1, contour, parentMod + node.mod);
    }
    
    return contour;
}

function secondWalk(node, x, y, levelHeight) {
    node.x = node.prelim + x;
    node.y = y;
    
    for (const child of node.children) {
        secondWalk(child, x + node.mod, y + levelHeight, levelHeight);
    }
}

function logNodePositions(node, depth = 0) {
    for (const child of node.children) {
        logNodePositions(child, depth + 1);
    }
}
 
/**
 * Draw the tree with the computed layout
 */
function drawTreeWithLayout(tree, spqrTree) {
    
    // Clear and initialize like your original function
    clearGraph(elements.svgSPQR);
    SPQRZoomContainer = initializeZoomContainer("spqr");
    
    const nodes = Object.values(tree.nodes);
    
    // Create edges data for the tree structure
    const edges = [];
    for (const node of nodes) {
        for (const child of node.children) {
            edges.push({
                source: node,
                target: child
            });
        }
    }
    
    // Draw SPQR components using your existing functions
    const groupArray = [];
    
    spqrTree.forEach((comp, index) => {
        const treeNode = tree.nodes[comp.id];
        
        if (treeNode) {
            
            // Create component group at the calculated position
            const currentGroup = SPQRZoomContainer.append("g")
              .attr("class", "spqr-component spqr-components")
              .attr("data-comp-id", comp.id)
              .attr("id", `spqr-component-${index}`)
              .attr("transform", `translate(${treeNode.x}, ${treeNode.y})`);
            
            // Store position data (like your original function)
            currentGroup.datum({ 
                x: treeNode.x, 
                y: treeNode.y, 
                index: index,
                component: comp 
            });
            
            // Add drag behavior (from your original function)
            SPQRComponentDragAndClickBehaivour(currentGroup, comp, index);
            groupArray.push(currentGroup);
            
            // Draw the component pictogram using your existing function
            drawSPQRComponentAsPictogram(currentGroup, comp);
            
        }
    });
    
    // Draw inter-component virtual edges after all components are positioned
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    
    // Store the group array in case you need it later (like for force simulation updates)
    return groupArray;
}

/**
 * Build an order-independent signature of an edge set, so we can detect whether
 * the input graph has changed since the SPQR tree was last computed. Each edge
 * is normalized (smaller endpoint first) and the sorted list is joined.
 * @param {Array<[number|string, number|string]>} edges
 * @returns {string}
 */
function edgeSetSignature(edges) {
  if (!edges) return "";
  return edges
    .map(([a, b]) => {
      const s = String(a), t = String(b);
      return s <= t ? `${s}-${t}` : `${t}-${s}`;
    })
    .sort()
    .join(",");
}

/**
 * Check if a given undirected graph is biconnected.
 * @param {Object<string, string[]>} graph - adjacency list representation (e.g., { "1": ["2","3"], "2": ["1","3"], "3": ["1","2"] })
 * @returns {boolean} true if the graph is biconnected, false otherwise
 */
function isBiconnected(edges) {
  // Clear previous AP highlights before re-running so stale APs don't persist
  if (state.data.articulationPoints && state.data.articulationPoints.size > 0) {
    const oldAPs = new Set(state.data.articulationPoints);
    state.data.articulationPoints.clear();
    if (state.d3selections.nodeInput) {
      for (const ap of oldAPs) {
        state.d3selections.nodeInput
          .filter(d => String(d.id) === ap)
          .attr("data-hit", 0)
          .style("fill", "steelblue")
          .style("stroke", "#fff")
          .style("stroke-width", "1.5px")
          .attr("data-base-r", 10)
          .attr("r", zoomAdjustedR(10, "input"));
      }
    }
  }

  const graph = buildAdjacencyListForGraph(edges);
  const nodes = Object.keys(graph);
  if (nodes.length <= 1) return true;

  const visited = new Set();
  const disc = {};
  const low = {};
  const parent = {};
  const articulationPoints = new Set(); // Track articulation points
  let time = 0;

  const start = nodes.find(n => graph[n] && graph[n].length > 0) || nodes[0];

  function dfs(u) {
    u = String(u); // normalize
    visited.add(u);
    disc[u] = low[u] = ++time;
    let childCount = 0;

    for (const vRaw of graph[u]) {
      const v = String(vRaw);
      if (v === u) continue;
      if (!visited.has(v)) {
        parent[v] = u;
        childCount++;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        
        // Check for articulation point conditions
        if (parent[u] === undefined && childCount > 1) {
          // Root with more than one child
          articulationPoints.add(u);
        }
        if (parent[u] !== undefined && low[v] >= disc[u]) {
          // Non-root articulation point
          articulationPoints.add(u);
        }
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
  }

  dfs(start);

  const allVisited = visited.size === nodes.length;
  if (!allVisited) {
    console.warn("Graph is not fully connected; missing nodes:", nodes.filter(n => !visited.has(n)));
  }

  const isGraphBiconnected = allVisited && articulationPoints.size === 0;

  // Print articulation points to console
  if (articulationPoints.size > 0) {
    console.log("Articulation points found:", Array.from(articulationPoints));
  } else if (allVisited) {
    console.log("No articulation points found - graph is biconnected");
  }


  for(const ap of articulationPoints) {
    console.log("Marking articulation point:", ap);
    // Store articulation points in state
    if (!state.data.articulationPoints) {
      state.data.articulationPoints = new Set();
    }
    state.data.articulationPoints.add(String(ap));
    
    // Highlight the node
    console.log("Highlighting articulation point:", ap);
    console.log("state.d3selections.nodeInput exists:", !!state.d3selections.nodeInput);
    if (state.d3selections.nodeInput) {
      highlight(state.d3selections.nodeInput, ap, "red");
    } else {
      console.warn("nodeInput selection not available for highlighting articulation point", ap);
    }
  }


  return isGraphBiconnected;
}

function buildAdjacencyListForGraph(edges) {
  const graph = {};
  for (const [uRaw, vRaw] of edges) {
    const u = String(uRaw);
    const v = String(vRaw);
    if (u === v) continue;
    if (!graph[u]) graph[u] = [];
    if (!graph[v]) graph[v] = [];
    if (!graph[u].includes(v)) graph[u].push(v);
    if (!graph[v].includes(u)) graph[v].push(u);
  }
  return graph;
}
