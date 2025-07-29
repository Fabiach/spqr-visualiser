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

  const groupArray = [];
  for (let i = 0; i < state.data.spqrTree.length; i++) {
    const offsetY = i * 250;
    const offsetX = i * 250;

    const currentGroup = SPQRZoomContainer.append("g")
      .attr("class", "spqr-components")
      .attr("id", `spqr-component-${i}`)
      .attr("transform", `translate(${offsetX}, ${offsetY})`);

    // Add drag behavior to each component
    addDragBehavior(currentGroup, i);

    groupArray.push(currentGroup);
    drawSPQRComponent(currentGroup, state.data.spqrTree[i]);
  }
}

// Simple drag behavior - focused on individual component movement
function addDragBehavior(group, componentIndex) {
  let dragStartX, dragStartY;
  
  const dragBehavior = d3.drag()
    .on("start", function(event) {
      console.log(`Starting drag on component ${componentIndex}`);
      
      // Prevent zoom behavior
      event.sourceEvent.preventDefault();
      event.sourceEvent.stopPropagation();
      
      // Get current position
      const transform = d3.select(this).attr("transform");
      const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
      dragStartX = match ? parseFloat(match[1]) : 0;
      dragStartY = match ? parseFloat(match[2]) : 0;
      
      console.log(`Component ${componentIndex} start position: (${dragStartX}, ${dragStartY})`);
      
      // Visual feedback
      d3.select(this)
        .style("cursor", "grabbing")
        .style("opacity", 0.8);
    })
    .on("drag", function(event) {
      // Calculate new position from start position + total drag distance
      const newX = dragStartX + event.x - event.subject.x;
      const newY = dragStartY + event.y - event.subject.y;
      
      console.log(`Dragging component ${componentIndex} to: (${newX}, ${newY})`);
      
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
  
  console.log(`Set up drag for component ${componentIndex} at initial position (${initialX}, ${initialY})`);
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

function handleNextComponent() {
  state.ui.currentX += state.ui.stepX;
  state.ui.currentY += state.ui.stepY;

  const timer = d3.timer(() => {
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
  });

  d3.select("#spqr-component-0")
    .transition()
    .duration(500)
    .attr("transform", `translate(${state.ui.currentX}, ${state.ui.currentY})`)
    .on("end", () => {
      timer.stop();
    });
}

// Event listeners - consolidated setup
function setupEventListeners() {
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.spqrBtn.onclick = createSPQRVisualization;
  elements.nextCompBtn.onclick = handleNextComponent;
  
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
  console.log("Updating virtual twin edges...");

  for (const edge of virtualTwinEdges) {
    const { compAID, compBID, u, v } = edge;

    const indexA = state.data.spqrTree.findIndex(c => c.id === compAID);
    const indexB = state.data.spqrTree.findIndex(c => c.id === compBID);
    const compAGroup = d3.select(`#spqr-component-${indexA}`);
    const compBGroup = d3.select(`#spqr-component-${indexB}`);

    console.log("calcing midpoint with", compAGroup, u, v);

    const midA = findMidpoint(compAGroup, u, v);
    const midB = findMidpoint(compBGroup, u, v);

    console.log(`Edge between ${compAID} and ${compBID}`);
    console.log("  midA:", midA);
    console.log("  midB:", midB);

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

function drawSPQRComponent(group, comp) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));

  const links = [];
  const virtualLinks = [];
  comp.graph.forEach((nbrs, v) => {
    if (!nbrs) { 
      let ns = Array.from(comp.graph);
      virtualLinks.push({ source: String(ns[0][0]), target: String(ns[1][0]) });
      return;
    }
    
    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        let isVirtual = false;
        for (const virtEdge of comp.virtualEdgeEntry) {
          if ((virtEdge[0][0] == src && virtEdge[0][1] == tgt) || 
              (virtEdge[0][1] == src && virtEdge[0][0] == tgt)) {
            isVirtual = true;
          }
        }

        if (isVirtual) {
          virtualLinks.push({ source: src, target: tgt });
        } else {
          links.push({ source: src, target: tgt });
        }
      }
    });
  });

  // Force-directed layout
  const layout = d3.forceSimulation(nodeObjs)
    .force("charge", d3.forceManyBody().strength(-200))
    .force("link", d3.forceLink(links).distance(40).id(d => d.id))
    .force("linkVirtual", d3.forceLink(virtualLinks).distance(40).id(d => d.id))
    .force("center", d3.forceCenter(400, 400))
    .stop();

  for (let i = 0; i < 150; i++) layout.tick();

  // Create node map from stored positions
  let nodeMap = new Map();
  comp.graph.forEach((_, n) => {
    const pos = state.data.inputNodePositions.get(String(n));
    if (pos) {
      nodeMap.set(n, { x: pos.x, y: pos.y });
    }
  });

  // Draw normal edges
  group.selectAll(".edge-normal")
    .data(links)
    .enter()
    .append("line")
    .attr("class", "edge-normal")
    .attr("x1", d => nodeMap.get(Number(d.source.id)).x)
    .attr("y1", d => nodeMap.get(Number(d.source.id)).y)
    .attr("x2", d => nodeMap.get(Number(d.target.id)).x)
    .attr("y2", d => nodeMap.get(Number(d.target.id)).y)
    .attr("stroke", "gray");

  // Draw virtual edges
  group.selectAll(".edge-virtual")
    .data(virtualLinks)
    .enter()
    .append("line")
    .attr("class", "edge-virtual")
    .attr("x1", d => nodeMap.get(Number(d.source.id)).x)
    .attr("y1", d => nodeMap.get(Number(d.source.id)).y)
    .attr("x2", d => nodeMap.get(Number(d.target.id)).x)
    .attr("y2", d => nodeMap.get(Number(d.target.id)).y)
    .attr("stroke", "red");

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

  // Bounding box and label
  const bounds = getBoundingBox(nodeMap);
  group.append("rect")
    .attr("x", bounds.minX)
    .attr("y", bounds.minY)
    .attr("width", bounds.maxX - bounds.minX)
    .attr("height", bounds.maxY - bounds.minY)
    .attr("stroke", "black")
    .attr("fill", "none")
    .attr("rx", 8);

  group.append("text")
    .attr("x", bounds.minX)
    .attr("y", bounds.minY - 10)
    .text(comp.id)
    .attr("font-weight", "bold")
    .attr("font-size", "12px");

  // Hover events
  group
    .on("mouseover", () => {
      highlightComponent(state.selections.nodeInput, state.selections.linkInput, comp.id, state.ui.colors[0]);
    })
    .on("mouseout", () => {
      unhighlightComponent(state.selections.nodeInput, state.selections.linkInput, comp.id, state.ui.colors[0]);
    });
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
  highlight(spqrSel, d.id);
  let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === d.id)[0];
  
  highlightComponent(inputSel, state.selections.linkInput, d.id, state.ui.colors[state.ui.colorC++ % state.ui.colors.length]);
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
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
  console.log(`Highlighting edge ${srcId}-${tgtId}, dashed: ${dashed}`);
  
  const existingEdge = linkSel.filter(d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      ((sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId)) &&
      !d.temporary
    );
  });

  if (existingEdge.size() > 0) {
    console.log("existingEdge count:", existingEdge.size());
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
      console.log("Temporary edge already exists, just updating style");
      existingTempEdge
        .attr("stroke", color)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", dashed ? "5,5" : null)
        .raise();
    } else {
      console.log("Creating temporary edge");
      const svg = d3.select("svg");
      const allNodes = svg.selectAll("circle").data();
      
      const sourceNode = allNodes.find(d => d.id === srcId);
      const targetNode = allNodes.find(d => d.id === tgtId);
      
      if (sourceNode && targetNode) {
        console.log(`Source node ${srcId}:`, sourceNode.x, sourceNode.y);
        console.log(`Target node ${tgtId}:`, targetNode.x, targetNode.y);
        
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
          
        console.log("Created temporary edge:", tempEdge.node());
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
  console.log("SERIES NODE", compId);
  const comp = state.data.spqrTree.find(c => c.id === compId);
  if (!comp) return;
  
  console.log("matchingSPQRNode", comp);
  
  if (!comp.highlightedEdges) {
    comp.highlightedEdges = [];
  }
  
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
      highlightEdge(linkSel, String(u), String(v), color, true);
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    return;
  }

  comp.graph.forEach((nbrs, v) => {
    console.log(v);
    highlight(nodeSel, String(v), color);
    
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

  if (comp.graph.entries().next().value[1] == null) {
    comp.virtualEdgeEntry.forEach(([edge, _]) => {
      const [u, v] = edge;
      unhighlight(nodeSel, String(u), color);
      unhighlight(nodeSel, String(v), color);
      unhighlightEdge(linkSel, String(u), String(v), color, true);
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    return;
  }
  
  comp.graph.forEach((nbrs, v) => {
    unhighlight(nodeSel, String(v), color);
  });
  
  if (comp.highlightedEdges) {
    comp.highlightedEdges.forEach(([srcId, tgtId]) => {
      unhighlightEdge(linkSel, srcId, tgtId, color);
    });
    comp.highlightedEdges = [];
  }
}