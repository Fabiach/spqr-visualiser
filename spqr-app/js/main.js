import {verticesDB, edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia} from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree} from './spqr.js';
import {clearGraph, createGraph, createPresetGraph} from './graph.js';

// State management - consolidated
const state = {
  simulation: {
    input: null,
    spqr: null
  },
  selections: {
    nodeInput: null,
    linkInput: null,
    labelInput: null,
    nodeSPQR: null,
    linkSPQR: null,
    labelSPQR: null
  },
  data: {
    spqrTree: null,
    graphEdges: null,
    graphNodes: null,
    graphLinks: null,
    virtualEdgeData: new Map(),
    allVirtualTwinEdgeLinks: [],
    inputNodePositions: new Map()
  },
  ui: {
    currentX: 0,
    currentY: 0,
    stepX: 500,
    stepY: 200,
    colors: ["green", "red", "blue", "yellow", "orange", "purple"],
    colorC: 0,  // Added color counter
    spqrReady: true,
    dragUpdateTimer: null  // For throttling drag updates
  }
};

// DOM elements - cached
const elements = {
  svgInput: d3.select("#input-graph"),
  svgSPQR: d3.select("#spqr-graph"),
  form: document.getElementById('input-form'),
  spqrBtn: document.getElementById('spqr-btn'),
  nextCompBtn: document.getElementById('next-comp'),
  exampleBtns: {
    brown: document.getElementById('example-graph-brown'),
    db: document.getElementById('example-graph-db'),
    wikipedia: document.getElementById('example-graph-wikipedia')
  }
};

// Initialize zoom container - single initialization
let SPQRZoomContainer = initializeZoomContainer();

function initializeZoomContainer() {
  let container = elements.svgSPQR.select("#spqr-zoom-container");
  if (container.empty()) {
    container = elements.svgSPQR.append("g").attr("id", "spqr-zoom-container");
    
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .filter(function(event) {
        // Only allow zoom on empty areas, not on draggable components
        return !event.target.closest('.spqr-components');
      })
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });
    
    elements.svgSPQR.call(zoom);
  }
  return container;
}

// Utility functions
function parseInput() {
  const raw = document.getElementById('vertices').value.trim();
  const vertices = raw.split(',').map(v => v.trim()).filter(v => v.length > 0);

  const edgesRaw = document.getElementById('edges').value.trim();
  const edgeMatches = edgesRaw.match(/\[(\d+)\s*,\s*(\d+)\]/g) || [];

  const edges = edgeMatches.map(block => {
    const [src, dst] = block
      .replace(/\[|\]/g, '')
      .split(',')
      .map(s => parseInt(s.trim(), 10));
    return [src, dst];
  });

  return { vertices, edges };
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

  // Update embedding count
  document.getElementById('embedding-count').textContent = Math.pow(2, rCounter - 1);
  
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
    spqrTree[idx].neighbors = Array.from(nbrSet).map(i => nodesSPQR[i].id);
  });
}

function buildVirtualEdgeData(spqrTree) {
  const virtualEdgeData = new Map();

  for (const component of spqrTree) {
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

  return { virtualEdgeData, allVirtualTwinEdgeLinks };
}

let currentSDebugIndex = 0;

document.getElementById('next-s-debug').onclick = function() {
  // Find all S components
  const sComponents = state.data.spqrTree
    .map((c, i) => ({ comp: c, index: i }))
    .filter(({ comp }) => comp.type === 'S');

  if (sComponents.length === 0) {
    console.log("No S components found.");
    return;
  }

  // Move to next S component
  currentSDebugIndex = (currentSDebugIndex + 1) % sComponents.length;
  const { comp, index } = sComponents[currentSDebugIndex];

  // Optionally, reset rotation for new S component
  comp._debugRotation = comp._debugRotation || 0;

  // Highlight or log info
  console.log(`Now selected S component: ${comp.id} (index ${index})`);
  // Optionally, visually highlight the group:
  d3.selectAll('.spqr-components').attr('opacity', 1);
  d3.select(`#spqr-component-${index}`).attr('opacity', 0.5);
};

document.getElementById('rotate-s-debug').onclick = function() {
// Use the currently selected S component index
let sComponents = state.data.spqrTree
  .map((c, i) => ({ comp: c, index: i }))
  .filter(({ comp }) => comp.type === 'S');
if (sComponents.length === 0) {
  console.log("No S component found.");
  return;
}
const { comp, index: sIndex } = sComponents[currentSDebugIndex] || sComponents[0];
  const group = d3.select(`#spqr-component-${sIndex}`);

  // Store current rotation in the component (default 0)
  comp._debugRotation = (comp._debugRotation || 0) + 8;
  if (comp._debugRotation >= 360) comp._debugRotation -= 360;

  // Compute node positions for this rotation
  const ordered = getOrderedNodes(comp);
  const nodeCount = ordered.length;
  const radius = 80;
  const theta = comp._debugRotation * Math.PI / 180;
  const angleStep = (2 * Math.PI) / nodeCount;
  const nodeMap = new Map();
  for (let i = 0; i < nodeCount; i++) {
    const angle = theta + (Math.PI / 2) - (angleStep * i);
    nodeMap.set(ordered[i], {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle)
    });
  }

  // Calculate score (sum of distances between virtual edge midpoints and their twins)
  let score = 0;
  const virtualEdges = comp.virtualEdgeEntry;
  const connections = [];
  virtualEdges.forEach(([edge, edgeId]) => {
    const [u, v] = edge;
    state.data.allVirtualTwinEdgeLinks.forEach(link => {
      if ((link.u === u && link.v === v) || (link.u === v && link.v === u)) {
        const otherCompId = link.compAID === comp.id ? link.compBID : link.compAID;
        const otherCompIndex = state.data.spqrTree.findIndex(c => c.id === otherCompId);
        if (otherCompIndex !== -1) {
          connections.push({
            edge: [u, v],
            otherCompIndex
          });
        }
      }
    });
  });

  for (const { edge: [u, v], otherCompIndex } of connections) {
    const p1 = nodeMap.get(u);
    const p2 = nodeMap.get(v);
    const midA = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const otherGroup = d3.select(`#spqr-component-${otherCompIndex}`);
    const midB = findMidpoint(otherGroup, u, v);
    const groupDatum = group.datum();
    const absMidA = {
      x: midA.x + groupDatum.x,
      y: midA.y + groupDatum.y
    };
    if (midB) {
      const dx = absMidA.x - midB.x;
      const dy = absMidA.y - midB.y;
      score += Math.sqrt(dx * dx + dy * dy);
    } else {
      score += 10000;
    }
  }

  // Redraw with this rotation
  group.selectAll("*").remove();
  drawOrientedSComponent(group, comp, (comp._debugRotation * Math.PI / 180));

  // Print debug info
  console.log(`S component ${comp.id} rotated to ${comp._debugRotation}°`);
  console.log("Score:", score);
  console.log("Node positions:", Array.from(nodeMap.entries()));
};

function clearBothGraphs() {
  clearGraph(elements.svgInput);
  clearGraph(elements.svgSPQR);
}

function setGraph(nodes, edges, presetType = null) {
  state.data.graphEdges = edges;
  state.data.graphNodes = nodes.map(v => ({ id: String(v) }));
  const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));

  state.data.graphLinks = edges.map(([s, t]) => ({
    source: idToNode[String(s)],
    target: idToNode[String(t)]
  }));

  const result = createPresetGraph(
    elements.svgInput, 
    state.data.graphNodes, 
    state.data.graphLinks, 
    undefined, 
    undefined, 
    presetType
  );

  state.simulation.input = result.simulation;
  if (presetType == null) { state.simulation.input.on("end", () => {
  // Store final node positions
  storeInputNodePositions();
  // Now create the SPQR visualization with correct node positions
  createSPQRVisualization();
});
  }
  state.selections.nodeInput = result.nodeSel;
  state.selections.linkInput = result.linkSel;
  state.selections.labelInput = result.labelSel;

  // Set up hover events
  state.selections.nodeInput
    .on("mouseover", (evt, d) => handleMouseOverInput(evt, d, state.selections.nodeInput, state.selections.nodeSPQR))
    .on("mouseout", (evt, d) => handleMouseOutInput(evt, d, state.selections.nodeInput, state.selections.nodeSPQR));
}

function createSPQRVisualization() {
  const edgesMap = generateEdgesMap(state.data.graphEdges);
  state.data.spqrTree = calculateSPQRTree(edgesMap);
  
  const nodesSPQR = buildSPQRNodes(state.data.spqrTree);
  const linksSPQR = buildSPQRLinks(state.data.spqrTree, nodesSPQR);
  
  buildAdjacencyList(state.data.spqrTree, nodesSPQR, linksSPQR);
  
  const { virtualEdgeData, allVirtualTwinEdgeLinks } = buildVirtualEdgeData(state.data.spqrTree);
  state.data.virtualEdgeData = virtualEdgeData;
  state.data.allVirtualTwinEdgeLinks = allVirtualTwinEdgeLinks;

  // Clear and setup zoom container
  clearGraph(elements.svgSPQR);
  SPQRZoomContainer = initializeZoomContainer();

  // Create force simulation for SPQR tree
  const result = createGraph(SPQRZoomContainer, nodesSPQR, linksSPQR);
  state.simulation.spqr = result.simulation;
  state.selections.nodeSPQR = result.nodeSel;
  state.selections.linkSPQR = result.linkSel;
  state.selections.labelSPQR = result.labelSel;

  // Set up cross-hover events
  setupCrossHoverEvents();

  // Store input node positions
  storeInputNodePositions();

  // Draw SPQR components
  drawAllSPQRComponents();
  
  // Draw virtual edges between components
  drawSPQRVirtualEdgesBetweenComponents();
}

function setupCrossHoverEvents() {
  state.selections.nodeInput
    .on("mouseover", (e, d) => handleMouseOverInput(e, d, state.selections.nodeInput, state.selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutInput(e, d, state.selections.nodeInput, state.selections.nodeSPQR));

  state.selections.nodeSPQR
    .on("mouseover", (e, d) => handleMouseOverSPQR(e, d, state.selections.nodeInput, state.selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutSPQR(e, d, state.selections.nodeInput, state.selections.nodeSPQR));
}

function storeInputNodePositions() {
  elements.svgInput.selectAll("circle").each(function(d) {
    state.data.inputNodePositions.set(d.id, { x: d.x, y: d.y });
  });
}

function drawAllSPQRComponents() {
  clearGraph(elements.svgSPQR);
  SPQRZoomContainer = initializeZoomContainer();

  // Step 1: Position all components at their input graph centroids, then spread them out
  const componentPositions = positionAllComponents();
  
  // Step 2: Create initial component groups with calculated positions
  const groupArray = createInitialComponentGroups(componentPositions);
  
  // Step 3: Run force simulation for overall SPQR tree layout
  runSPQRForceSimulation(groupArray);
}

// Simple drag behavior - focused on individual component movement
function addDragBehavior(group, comp, componentIndex) {
  let dragStartX, dragStartY;
  
  const dragBehavior = d3.drag()
    .on("start", function(event) {
      console.log(`Starting drag on component ${comp.id}`);
      
      // Prevent zoom behavior
      event.sourceEvent.preventDefault();
      event.sourceEvent.stopPropagation();
      
      // Get current position
      const transform = d3.select(this).attr("transform");
      const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
      dragStartX = match ? parseFloat(match[1]) : 0;
      dragStartY = match ? parseFloat(match[2]) : 0;
      
      console.log(`Component ${componentIndex} start position: (${dragStartX}, ${dragStartY})`);

        SPQRZoomContainer  // Or whatever SVG container you're using
        .append("circle")
        .attr("cx", dragStartX)
        .attr("cy", dragStartY)
        .attr("r", 4)
        .attr("fill", "red")
        .attr("class", "drag-start-marker");
      
      // Visual feedback
      d3.select(this)
        .style("cursor", "grabbing")
        .style("opacity", 0.8);
    })
    .on("drag", function(event) {
      // Calculate new position from start position + total drag distance
      const newX = dragStartX + event.x - event.subject.x;
      const newY = dragStartY + event.y - event.subject.y;
      
      
      // Apply new position
      d3.select(this).attr("transform", `translate(${newX}, ${newY})`);
      
      // Update connecting edges
      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    })
    .on("end", function(event) {
      console.log(`Ended drag on component ${componentIndex}`);
      
      // Reset visual feedback
      d3.select(this)
        .style("cursor", "grab")
        .style("opacity", 1);
      
      // Final edge update
      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    });

  // Apply drag behavior and set up the component
  group.call(dragBehavior);
  group.style("cursor", "grab");
  
  // Store initial drag subject position
  const transform = group.attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  const initialX = match ? parseFloat(match[1]) : 0;
  const initialY = match ? parseFloat(match[2]) : 0;
  
  group.datum({ x: initialX, y: initialY });
  
  console.log(`Set up drag for component ${comp.id} at initial position (${initialX}, ${initialY})`);
}


function handleFormSubmit(e) {
  e.preventDefault();
  const { vertices, edges } = parseInput();
  
  console.log('vertices:', vertices);
  console.log('edges   :', edges);
  
  clearBothGraphs();
  setGraph(vertices, edges);
  createSPQRVisualization();
}

function handleExampleGraph(vertices, edges, presetType = null) {
  return () => {
    clearBothGraphs();
    setGraph(vertices, edges, presetType);
    createSPQRVisualization();
  };
}


// Event listeners - consolidated
function setupEventListeners() {
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.spqrBtn.onclick = createSPQRVisualization;
  
  elements.exampleBtns.brown.onclick = handleExampleGraph(verticesBrown, edgesBrown);
  elements.exampleBtns.db.onclick = handleExampleGraph(verticesDB, edgesDB, "DiBattista");
  elements.exampleBtns.wikipedia.onclick = handleExampleGraph(verticesWikipedia, edgesWikipedia, "Wikipedia");
}

// Initialize
setupEventListeners();

// Updated drawing functions to use state.data instead of global variables

function drawSPQRVirtualEdgesBetweenComponents() {
  console.log("Drawing virtual edges between components...");

  for (const [key, { components, nodes }] of state.data.virtualEdgeData.entries()) {
    console.log("Processing virtual edge:", key, "with components:", components, "and nodes:", nodes);

    if (components.length !== 2) {
      console.warn("Skipping virtual edge", key, "— not connected to exactly 2 components:", components);
      continue;
    }

    const [compAID, compBID] = components;
    const [u, v] = nodes;

    const indexA = state.data.spqrTree.findIndex(c => c.id === compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === compBID);

    if (indexA === -1 || indexB === -1) {
      console.error("Component ID not found in SPQRTREE:", compAID, compBID);
      continue;
    }

    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);

    console.log(`Component group A [${compAID}] is #spqr-component-${indexA}`, compAGroup);
    console.log(`Component group B [${compBID}] is #spqr-component-${indexB}`, compBGroup);

    const midA = findMidpoint(compAGroup, u, v);
    const midB = findMidpoint(compBGroup, u, v);

    console.log("Midpoint in component A:", midA, "Midpoint in component B:", midB);

    if (midA && midB) {
      console.log(`Drawing line between midpoints of ${compAID} and ${compBID}`);
      SPQRZoomContainer.append("line")
        .attr("x1", midA.x)
        .attr("y1", midA.y)
        .attr("x2", midB.x)
        .attr("y2", midB.y)
        .attr("stroke", "orange")
        .attr("stroke-dasharray", "4 2")
        .attr("stroke-width", 2)
        .attr("class", "inter-component-virtual-edge")
        .attr("data-link-id", `${compAID}-${compBID}-${u}-${v}`);
    } else {
      console.warn("Skipping line draw — one or both midpoints missing.");
    }
  }
}

function updateInterComponentVirtualEdges(virtualTwinEdges) {
  // First, remove old lines
  d3.selectAll(".inter-component-virtual-edge").remove();

  for (const edge of virtualTwinEdges) {
    const { compAID, compBID, u, v } = edge;

    const indexA = state.data.spqrTree.findIndex(c => c.id === compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === compBID);
    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);


    const midA = findMidpoint(compAGroup, u, v);
    const midB = findMidpoint(compBGroup, u, v);

    if (midA && midB) {
      SPQRZoomContainer.append("line")
        .attr("x1", midA.x)
        .attr("y1", midA.y)
        .attr("x2", midB.x)
        .attr("y2", midB.y)
        .attr("stroke", "orange")
        .attr("stroke-dasharray", "4 2")
        .attr("stroke-width", 2)
        .attr("class", "inter-component-virtual-edge");
    } else {
      console.warn(`Skipping edge draw — midA or midB missing for ${compAID}, ${compBID}`);
    }
  }
}

function findMidpoint(groupSelection, u, v) {
  const edge = groupSelection.selectAll(".edge-virtual")
    .filter(d => {
      // Either direction: (u -> v) or (v -> u)
      return (d.source.id == u && d.target.id == v) ||
             (d.source.id == v && d.target.id == u);
    })
    .node();

  if (!edge) {
    console.warn(`Virtual edge (${u}, ${v}) not found in group`, groupSelection.attr("id"));
    return null;
  }

  // Get group's translation
  const transform = groupSelection.attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  const offsetX = match ? parseFloat(match[1]) : 0;
  const offsetY = match ? parseFloat(match[2]) : 0;

  // Get local line coordinates
  const x1 = parseFloat(edge.getAttribute("x1"));
  const y1 = parseFloat(edge.getAttribute("y1"));
  const x2 = parseFloat(edge.getAttribute("x2"));
  const y2 = parseFloat(edge.getAttribute("y2"));

  // Apply group transform to get absolute position
  return {
    x: (x1 + x2) / 2 + offsetX,
    y: (y1 + y2) / 2 + offsetY
  };
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


function drawSPQRComponent(group, comp) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));

  const links = [];
  const virtualLinks = [];

  // Create virtual edge set for lookup
  const virtualEdgeSet = new Set();
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [v1, v2] = virtEdge[0];
    virtualEdgeSet.add(`${v1}-${v2}`);
    virtualEdgeSet.add(`${v2}-${v1}`);
  });

  // Extract links
  comp.graph.forEach((nbrs, v) => {
    if (!nbrs || nbrs.length === 0) {
      const ns = Array.from(comp.graph.keys());
      if (ns.length >= 2) {
        virtualLinks.push({ source: String(ns[0]), target: String(ns[1]) });
      }
      return;
    }

    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        const isVirtual = virtualEdgeSet.has(`${src}-${tgt}`);
        (isVirtual ? virtualLinks : links).push({ source: src, target: tgt });
      }
    });
  });

  // Get stored node positions
  const nodeMap = new Map();
  const positions = [];
  comp.graph.forEach((_, nodeId) => {
    const pos = state.data.inputNodePositions.get(String(nodeId));
    if (pos) {
      positions.push(pos);
    }
  });

  // Compute centroid
  let centroid = { x: 0, y: 0 };
  if (positions.length > 0) {
    centroid.x = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    centroid.y = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  }

  // Store node positions relative to centroid
  comp.graph.forEach((_, nodeId) => {
    const pos = state.data.inputNodePositions.get(String(nodeId));
    if (pos) {
      nodeMap.set(Number(nodeId), { x: pos.x - centroid.x, y: pos.y - centroid.y });
    }
  });

  // --- SCALE TO FIT MAX SIZE ---
  // Compute bounding box
  const xs = Array.from(nodeMap.values()).map(p => p.x);
  const ys = Array.from(nodeMap.values()).map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const maxDim = Math.max(width, height);
  const maxAllowed = 80;
  let scale = 1;
  if (maxDim > maxAllowed) {
    scale = maxAllowed / maxDim;
    // Scale all node positions
    nodeMap.forEach((p, k) => {
      nodeMap.set(k, { x: p.x * scale, y: p.y * scale });
    });
  }
  // --- END SCALE ---

  // Draw normal edges
  group.selectAll(".edge-normal")
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
  group.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", "red")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({ source: { id: d.source }, target: { id: d.target } }));

  // Draw nodes
  group.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
    .attr("fill", "#3498db");

  // Add bounding box and hover
  addComponentBoundingElements(group, nodeMap, comp.id);
  addComponentHoverEvents(group, comp.id);
}


function positionAllComponents() {
  const componentPositions = new Map();
  const allCentroids = [];

  // First pass: calculate bounding box center for each component
  state.data.spqrTree.forEach((comp, index) => {
    const xVals = [];
    const yVals = [];

    comp.graph.forEach((_, nodeId) => {
      const pos = state.data.inputNodePositions.get(String(nodeId));
      if (pos) {
        xVals.push(pos.x);
        yVals.push(pos.y);
      }
    });

    if (xVals.length > 0 && yVals.length > 0) {
      const minX = Math.min(...xVals);
      const maxX = Math.max(...xVals);
      const minY = Math.min(...yVals);
      const maxY = Math.max(...yVals);

      const center = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
      };

      componentPositions.set(index, center);
      allCentroids.push(center);
      console.log("POSITION COMPONENT AT: ", comp.id, center)
    }
  });

  // If no centroids, nothing to do
  if (allCentroids.length === 0) return componentPositions;

  // Compute global center of all component bounding box centers
  const globalCenter = {
    x: allCentroids.reduce((sum, p) => sum + p.x, 0) / allCentroids.length,
    y: allCentroids.reduce((sum, p) => sum + p.y, 0) / allCentroids.length
  };

  // Spread components away from the global center

  return componentPositions;
}


function createInitialComponentGroups(componentPositions) {
  const groupArray = [];
  
  state.data.spqrTree.forEach((comp, index) => {
    let offsetX, offsetY;
    
    if (componentPositions.has(index)) {
      // Use calculated component position (already spread out)
      const pos = componentPositions.get(index);
      offsetX = pos.x;
      offsetY = pos.y;
    }

    const currentGroup = SPQRZoomContainer.append("g")
      .attr("class", "spqr-components")
      .attr("id", `spqr-component-${index}`)
      .attr("transform", `translate(${offsetX}, ${offsetY})`);

    console.log(`Group ${comp.id} created at transform: translate(${offsetX}, ${offsetY})`)

    // Store initial position as data
    currentGroup.datum({ x: offsetX, y: offsetY, index: index });
    
    addDragBehavior(currentGroup, comp, index);
    groupArray.push(currentGroup);
    
    // Draw the component
    drawSPQRComponentAsPictogram(currentGroup, comp);
  });
  
  return groupArray;
}

function runSPQRForceSimulation(groupArray) {
  // Create simulation data for component positioning
  const simulationNodes = groupArray.map((group, index) => {
    const datum = group.datum();
    const { x = 0, y = 0, boundingRect } = datum;

    return {
      id: index,
      x,
      y,
      width: boundingRect?.width || 100,   // fallback if not found
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
      .distance(100)
      .strength(0.1))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(500, 500))
    .force("collision", d3.forceCollide(d => {
      const r = Math.sqrt(d.width ** 2 + d.height ** 2) / 2;
      return r + 20; // +20 padding between components
    }))
    .alpha(0.8)
    .alphaDecay(0.04);


  orientComponents();
  let orientTickCounter = 0; 
  // Update component positions during simulation
  simulation.on("tick", () => {
    simulationNodes.forEach(node => {
      node.group.attr("transform", `translate(${node.x}, ${node.y})`);
      // Update stored position
      node.group.datum().x = node.x;
      node.group.datum().y = node.y;
    });
    
    // Update virtual edges between components
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);

    orientTickCounter++;
    if (orientTickCounter % 6 === 0) {
      orientComponents();
    }

  });

  // After simulation stabilizes, orient components
  simulation.on("end", () => {
  state.ui.spqrReady = true;
  console.log("Force simulation ended, orienting components...");
  orientComponents(); // <--- This ensures best orientation after layout
  updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
});
}

function orientComponents() {
  state.data.spqrTree.forEach((comp, index) => {
    const group = d3.select(`#spqr-component-${index}`);
    
    if (comp.type === 'S') {
      orientSComponent(group, comp, index);
    } else if (comp.type === 'P') {
      orientPComponent(group, comp, index);
    }
  });
}


function orientPComponent(group, comp, componentIndex) {
  // Find connected components
  const connectedComponents = [];
  console.log("PPPPPPPPPPPPPPPP ORIENTTTTTTTTTTTTTTTTT:", group, comp, state.data.inputNodePositions)
  const [u, v] = comp.virtualEdgeEntry[0][0];  
  const posU = state.data.inputNodePositions.get(String(u));
  const posV = state.data.inputNodePositions.get(String(v));
  var useHorizontal = false;
  
  if (Math.abs(posU.x-posV.x)> Math.abs(posU.y-posV.y)) {
    useHorizontal = true;
  }

    
    // Redraw P component with chosen orientation
    group.selectAll("*").remove();
    drawOrientedPComponent(group, comp, useHorizontal);
  }


function orientSComponent(group, comp, componentIndex) {
  // 1. Gather virtual edges and their connected component positions
  const virtualEdges = comp.virtualEdgeEntry;
  const connections = [];
  virtualEdges.forEach(([edge, edgeId]) => {
    const [u, v] = edge;
    state.data.allVirtualTwinEdgeLinks.forEach(link => {
      if ((link.u === u && link.v === v) || (link.u === v && link.v === u)) {
        const otherCompId = link.compAID === comp.id ? link.compBID : link.compAID;
        const otherCompIndex = state.data.spqrTree.findIndex(c => c.id === otherCompId);
        if (otherCompIndex !== -1) {
          connections.push({
            edge: [u, v],
            otherCompIndex
          });
        }
      }
    });
  });

  // 2. Try all 360 possible rotations (one per degree)
  const ordered = getOrderedNodes(comp);
  let bestRotation = 0;
  let bestScore = Infinity;
  const nodeCount = ordered.length;
  const radius = 80;

  for (let rot = 0; rot < 360; rot+=4) {
    const theta = rot * Math.PI / 180;
    // Compute node positions for this rotation
    const nodeMap = new Map();
    const angleStep = (2 * Math.PI) / nodeCount;
    for (let i = 0; i < nodeCount; i++) {
      const angle = theta + (Math.PI / 2) - (angleStep * i);
      nodeMap.set(ordered[i], {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle)
      });
    }

    let score = 0;
    for (const { edge: [u, v], otherCompIndex } of connections) {
      // Midpoint of virtual edge in this S component (local coords)
      const p1 = nodeMap.get(u);
      const p2 = nodeMap.get(v);
      const midA = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      // Midpoint in the neighbor component (absolute coords)
      const otherGroup = d3.select(`#spqr-component-${otherCompIndex}`);
      const midB = findMidpoint(otherGroup, u, v);

      // Transform midA to absolute coords
      const groupDatum = group.datum();
      const absMidA = {
        x: midA.x + groupDatum.x,
        y: midA.y + groupDatum.y
      };

      if (midB) {
        const dx = absMidA.x - midB.x;
        const dy = absMidA.y - midB.y;
        score += Math.sqrt(dx * dx + dy * dy);
      } else {
        // Penalize missing midB
        score += 10000;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestRotation = rot;
    }
  }
  console.log(`Best rotation for component ${comp.id} is ${bestRotation} degrees with score ${bestScore}`);
  // Redraw with best rotation (convert degree to radians for targetAngle)
  group.selectAll("*").remove();
  drawOrientedSComponent(
    group,
    comp,
    (bestRotation * Math.PI / 180 )
  );
}

function drawOrientedSComponent(group, comp, targetAngle = 0) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));
  const links = [];
  const virtualLinks = [];

  // Create virtual edge set for lookup
  const virtualEdgeSet = new Set();
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [v1, v2] = virtEdge[0];
    virtualEdgeSet.add(`${v1}-${v2}`);
    virtualEdgeSet.add(`${v2}-${v1}`);
  });

  comp.graph.forEach((nbrs, v) => {
    if (!nbrs || nbrs.length === 0) { 
      let ns = Array.from(comp.graph);
      virtualLinks.push({ source: String(ns[0][0]), target: String(ns[1][0]) });
      return;
    }
    
    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        const edgeKey = `${src}-${tgt}`;
        const isVirtual = virtualEdgeSet.has(edgeKey);

        if (isVirtual) {
          virtualLinks.push({ source: src, target: tgt });
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
  
  // Get ordered nodes and position them in a circle, oriented towards target
  const ordered = getOrderedNodes(comp);
  ordered.forEach((nodeId, i) => {
    const angle = targetAngle + (Math.PI / 2) - (angleStep * i);
    nodeMap.set(nodeId, {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle)
    });
  });

  // Draw edges as circular arcs
  group.selectAll(".edge-normal")
    .data(links)
    .enter()
    .append("path")
    .attr("class", "edge-normal")
    .attr("d", d => {
      const p1 = nodeMap.get(Number(d.source));
      const p2 = nodeMap.get(Number(d.target));
      return createCircularArc(p1, p2, radius);
    })
    .attr("fill", "none")
    .attr("stroke", "gray")
    .attr("stroke-width", 1.5);

  // Draw virtual edges as straight lines
  group.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", "red")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({ source: { id: d.source }, target: { id: d.target } }));

  // Draw nodes
  group.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
    .attr("fill", "#3498db");

  // Remove old bounding box and label if present
  group.selectAll("rect").remove();
  group.selectAll("text").remove();

  // Add bounding elements for the new orientation
  addComponentBoundingElements(group, nodeMap, comp.id);
  addComponentHoverEvents(group, comp.id);
}

function drawOrientedPComponent(group, comp, useHorizontal = true) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));
  const links = [];
  const virtualLinks = [];

  // Create virtual edge set for lookup
  const virtualEdgeSet = new Set();
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [v1, v2] = virtEdge[0];
    virtualEdgeSet.add(`${v1}-${v2}`);
    virtualEdgeSet.add(`${v2}-${v1}`);
  });

  comp.graph.forEach((nbrs, v) => {
    if (!nbrs || nbrs.length === 0) { 
      let ns = Array.from(comp.graph);
      virtualLinks.push({ source: String(ns[0][0]), target: String(ns[1][0]) });
      return;
    }
    
    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        const edgeKey = `${src}-${tgt}`;
        const isVirtual = virtualEdgeSet.has(edgeKey);

        if (isVirtual) {
          virtualLinks.push({ source: src, target: tgt });
        } else {
          links.push({ source: src, target: tgt });
        }
      }
    });
  });

  const nodeMap = new Map();
  const allNodes = Array.from(comp.graph.keys());
  
  // Position nodes in a line (horizontal or vertical)
  allNodes.forEach((nodeId, i) => {
    const spacing = 40;
    if (useHorizontal) {
      nodeMap.set(nodeId, {
        x: (i - (allNodes.length - 1) / 2) * spacing,
        y: 0
      });
    } else {
      nodeMap.set(nodeId, {
        x: 0,
        y: (i - (allNodes.length - 1) / 2) * spacing
      });
    }
  });

  // Draw normal edges as straight lines
  group.selectAll(".edge-normal")
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
  group.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source)).x)
    .attr("y1", d => nodeMap.get(Number(d.source)).y)
    .attr("x2", d => nodeMap.get(Number(d.target)).x)
    .attr("y2", d => nodeMap.get(Number(d.target)).y)
    .attr("stroke", "red")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({ source: { id: d.source }, target: { id: d.target } }));

  // Draw nodes
  group.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
    .attr("fill", "#3498db");

  // Add bounding elements
  addComponentBoundingElements(group, nodeMap, comp.id);
  addComponentHoverEvents(group, comp.id);
}


function createCircularArc(p1, p2, radius) {
  const centerX = 0, centerY = 0;
  
  const angle1 = Math.atan2(p1.y - centerY, p1.x - centerX);
  const angle2 = Math.atan2(p2.y - centerY, p2.x - centerX);
  
  let deltaAngle = angle2 - angle1;
  if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
  if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
  
  const largeArcFlag = Math.abs(deltaAngle) > Math.PI ? 1 : 0;
  const sweepFlag = deltaAngle > 0 ? 1 : 0;
  
  // Use slightly smaller radius for the arc to create a more natural curve
  const arcRadius = radius * 0.95;
  
  return `M ${p1.x},${p1.y} A ${arcRadius},${arcRadius} 0 ${largeArcFlag},${sweepFlag} ${p2.x},${p2.y}`;
}

function addComponentBoundingElements(group, nodeMap, componentId) {
  const bounds = getBoundingBox(nodeMap);
  const padding = 15;
  
  const boundingRect = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: (bounds.maxX - bounds.minX) + (2 * padding),
    height: (bounds.maxY - bounds.minY) + (1.8 * padding)
  };

  group.append("rect")
    .attr("x", boundingRect.x)
    .attr("y", boundingRect.y)
    .attr("width", boundingRect.width)
    .attr("height", boundingRect.height)
    .attr("stroke", "black")
    .attr("fill", "none")
    .attr("rx", 8);

  // Add label
  group.append("text")
    .attr("x", boundingRect.x + 10)
    .attr("y", boundingRect.y + 15)
    .text(componentId.substring(0,2)) //TODO: CHANGE TO (0,1) BEFORE RELEASE
    .attr("font-weight", "bold")
    .style("font-size", "15px");

   group.datum({ 
    ...group.datum(), 
    boundingRect, 
    componentId 
  });
  
}

function addComponentHoverEvents(group, componentId) {
  group
    .on("mouseover", () => {
      if(state.ui.spqrReady === false) return;
      highlightComponent(state.selections.nodeInput, state.selections.linkInput, componentId, state.ui.colors[0]);
    })
    .on("mouseout", () => {
      if(state.ui.spqrReady === false) return;
      unhighlightComponent(state.selections.nodeInput, state.selections.linkInput, componentId, state.ui.colors[0]);
    });
}

// Enhanced version of the original drawSPQRComponentAsPictogram that calls the appropriate drawing function
function drawSPQRComponentAsPictogram(group, comp) {
  if (comp.type === "R") {
    return drawSPQRComponent(group, comp);
  } else if (comp.type === "S") {
    return drawOrientedSComponent(group, comp, 0); // Initial orientation
  } else if (comp.type === "P") {
    return drawOrientedPComponent(group, comp, true); // Initial horizontal orientation
  }
}


// Event handler functions - refactored to use state
function handleMouseOverInput(event, d, inputSel, spqrSel) {
  highlight(inputSel, d.id);
  highlight(spqrSel, d.id);
}

function handleMouseOutInput(event, d, inputSel, spqrSel) {
  unhighlight(inputSel, d.id);
  unhighlight(spqrSel, d.id);
}

function handleMouseOverSPQR(event, d, inputSel, spqrSel) {
  if (!state.ui.spqrReady) return;
  highlight(spqrSel, d.id);
  let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === d.id)[0];
  highlightComponent(inputSel, state.selections.linkInput, d.id, state.ui.colors[state.ui.colorC++ % state.ui.colors.length]);
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
  if (!state.ui.spqrReady) return;
  unhighlight(spqrSel, d.id);
  let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === d.id)[0];
  unhighlightComponent(inputSel, state.selections.linkInput, d.id);
}
// Highlighting functions - refactored
function highlight(selection, id, color = "orange") {
  selection
    .filter(d => d.id === id)
    .each(function () {
      const hits = (+this.getAttribute("data-hit") || 0) + 1;
      this.setAttribute("data-hit", hits);

      d3.select(this)
        .attr("fill", color)
        .attr("r", 10)
        .attr("stroke", color)
        .attr("stroke-width", 4)
        .attr("r", 10 + 2 * 1)
        .raise();
    });
}

function unhighlight(selection, id, color = "orange") {
  selection
    .filter(d => d.id === id)
    .each(function () {
      const n = (+this.getAttribute("data-hit") || 1) - 1;
      this.setAttribute("data-hit", n);

      if (n === 0) {
        d3.select(this).attr("fill", "steelblue").attr("r", 10);
      } else {
        d3.select(this).attr("r", 10 + 4 * n);
      }
    });
}

function highlightEdge(linkSel, srcId, tgtId, color = "purple", dashed = false) {
  
  const existingEdge = linkSel.filter(d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      ((sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId)) &&
      !d.temporary
    );
  });

  if (existingEdge.size() > 0) {
    existingEdge
      .attr("stroke", color)
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", dashed ? "5,5" : null)
      .raise();
  } else {
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
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", dashed ? "5,5" : null)
        .raise();
    } else {
      const svg = d3.select("svg");
      const allNodes = svg.selectAll("circle").data();
      
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
          .attr("stroke-width", 3)
          .attr("stroke-opacity", 0.8)
          .attr("stroke-dasharray", dashed ? "5,5" : null)
          .attr("x1", sourceNode.x || 0)
          .attr("y1", sourceNode.y || 0)
          .attr("x2", targetNode.x || 0)
          .attr("y2", targetNode.y || 0)
          .raise();
          
      } else {
        console.log("Could not find nodes:", srcId, tgtId, sourceNode, targetNode);
      }
    }
  }
}


function unhighlightEdge(linkSel, srcId, tgtId) {
  linkSel
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    )
    .attr("stroke", "#999")
    .attr("stroke-width", 2)
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

function clearTemporaryEdges(svg) {
  svg.selectAll("line.temporary-edge").remove();
}

function highlightComponent(nodeSel, linkSel, compId, color = "orange") {
  const comp = state.data.spqrTree.find(c => c.id === compId);
  if (!comp) return;

  if (!comp.highlightedEdges) comp.highlightedEdges = [];
  if (!comp.highlightedNodes) comp.highlightedNodes = [];

  const virtualEdges = new Set();
  comp.virtualEdgeEntry.forEach(([edge, _]) => {
    const [u, v] = edge;
    virtualEdges.add(`${u}-${v}`);
    virtualEdges.add(`${v}-${u}`);
  });

  if (comp.graph.entries().next().value[1] == null) {
    comp.virtualEdgeEntry.forEach(([edge, _]) => {
      const [u, v] = edge;
      highlight(nodeSel, String(u), color);
      highlight(nodeSel, String(v), color);
      comp.highlightedNodes.push(String(u), String(v));
      highlightEdge(linkSel, String(u), String(v), color, true);
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    return;
  }

  comp.graph.forEach((nbrs, v) => {
    highlight(nodeSel, String(v), color);
    comp.highlightedNodes.push(String(v));
    nbrs.forEach(w => {
      if (comp.graph.has(w)) {
        const edgeKey = `${v}-${w}`;
        if (virtualEdges.has(edgeKey)) {
          highlightEdge(linkSel, String(v), String(w), color, true);
        } else {
          highlightEdge(linkSel, String(v), String(w), color, false);
        }
        comp.highlightedEdges.push([String(v), String(w)]);
      }
    });
  });
}

function unhighlightComponent(nodeSel, linkSel, compId, color = "orange") {
  const comp = state.data.spqrTree.find(c => c.id === compId);
  if (!comp) return;

  // Unhighlight nodes
  if (comp.highlightedNodes) {
    comp.highlightedNodes.forEach(nodeId => {
      unhighlight(nodeSel, nodeId, color);
    });
    comp.highlightedNodes = [];
  }

  // Unhighlight edges
  if (comp.highlightedEdges) {
    comp.highlightedEdges.forEach(([srcId, tgtId]) => {
      unhighlightEdge(linkSel, srcId, tgtId, color);
    });
    comp.highlightedEdges = [];
  }
}