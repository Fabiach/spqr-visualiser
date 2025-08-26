import {verticesDB, edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia, verticesKindermann, edgesKindermann, factorials} from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree} from './spqr.js';
import {clearGraph, createGraph, createPresetGraph} from './graph.js';

// State management - consolidated
const state = {
  simulation: {
    input: null,
    spqr: null
  },
  d3selections: {
    nodeInput: null,
    linkInput: null,
    labelInput: null,
    nodeSPQR: null,
    linkSPQR: null,
    labelSPQR: null
  },
  data: {
    spqrTree: null,
    spqrRoot: null,
    graphEdges: null,
    graphNodes: null,
    graphLinks: null,
    virtualEdgeData: new Map(),
    allVirtualTwinEdgeLinks: [],
    inputNodePositions: new Map(),
    componentVirtualEdgesMap: new Map(),
    originalGraphEdges: null,
    inputNew: true,
    isPreset: false,
    componentCentroids: new Map(),
    anySPQRComponentCollapsed: false,
    previousSpqrTree: null,
    componentMapping: new Map(), // Maps old component IDs to new ones
    unchangedComponents: new Set(),
    changedComponents: new Set(),
    newComponents: new Set(),
    removedComponents: new Set()
  },
  ui: {
    colors: ["red", "blue", "yellow", "orange", "purple", "green"],
    colorC: 0,  // Added color counter
    spqrReady: true,
    dragUpdateTimer: null,  // For throttling drag updates
    canvasWidth: 800,
    canvasHeight: 800
  },
  ui_state: {
    drawMode: false,
    edgeStart: null,
    deleteMode: false,
    currentTool: null // Track current tool
  }
};

// DOM elements - cached
const elements = {
  svgInput: d3.select("#input-graph"),
  svgSPQR: d3.select("#spqr-graph"),
  form: document.getElementById('input-form'),
  spqrBtn: document.getElementById('spqr-btn'),
  nextCompBtn: document.getElementById('next-comp'),
  drawModeBtn: document.getElementById('draw-mode'),
  deleteModeBtn: document.getElementById('delete-mode'),
  exampleBtns: {
    brown: document.getElementById('example-graph-brown'),
    db: document.getElementById('example-graph-db'),
    wikipedia: document.getElementById('example-graph-wikipedia'),
    kindermann: document.getElementById('example-graph-kindermann'),
  }
};

let expandIconSVG = null;
d3.xml("assets/maximize.svg").then(data => {
  expandIconSVG = data.documentElement;
});

const spqrComponentPictureEdgeColor = "black"; // Color for edges in SPQR component pictures
const spqrComponentPictureNormalStrokeWidth = 1.5;
const spqrComponentPictureVirtualStrokeWidth = 2;

// Initialize zoom container - single initialization
let SPQRZoomContainer = initializeZoomContainer("spqr");

//RESETS STATE OF THE APPLICATION

function resetState() {
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
  state.d3selections.labelInput = null;
  state.d3selections.nodeSPQR = null;
  state.d3selections.linkSPQR = null;
  state.d3selections.labelSPQR = null;
  
  // Clear data
  state.data.spqrTree = null;
  state.data.spqrRoot = null;
  state.data.graphEdges = [];
  state.data.graphNodes = [];
  state.data.graphLinks = [];
  state.data.virtualEdgeData.clear();
  state.data.allVirtualTwinEdgeLinks = [];
  state.data.inputNodePositions.clear();
  state.data.inputNew = true;
  state.data.isPreset = false;
  state.data.anySPQRComponentCollapsed = false;
  state.data.originalGraphEdges = null;
  state.data.componentVirtualEdgesMap = new Map();
  state.data.componentCentroids = new Map();
  
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
  resetState()
  e.preventDefault();
  const { vertices, edges } = parseInput();
  
  console.log('vertices:', vertices);
  console.log('edges   :', edges);
  state.data.originalGraphEdges = edges.map(e => [...e]);
  
  clearBothGraphs();
  drawInputGraph(vertices, edges);
  createSPQRVisualization();
}

function handleExampleGraph(vertices, edges, presetType = null) {
  return () => {
    console.log("Loading example graph:", presetType);
    
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
    
    // Small delay to ensure graph is set up before SPQR
    setTimeout(() => {
      createSPQRVisualization();
    }, 100);
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

// Event listeners - consolidated
function setupEventListeners() {
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.spqrBtn.onclick = function() {
    
    clearGraph(elements.svgSPQR);
    createSPQRVisualization();
  };
  
  elements.exampleBtns.brown.onclick = handleExampleGraph(verticesBrown, edgesBrown);
  elements.exampleBtns.db.onclick = handleExampleGraph(verticesDB, edgesDB, "DiBattista");
  elements.exampleBtns.wikipedia.onclick = handleExampleGraph(verticesWikipedia, edgesWikipedia, "Wikipedia");
  elements.exampleBtns.kindermann.onclick = handleExampleGraph(verticesKindermann, edgesKindermann);
}

// Initialize
setupEventListeners();


// PROCESS AND PARSE INPUT DATA
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

function buildVirtualEdgeData(spqrTree) {
  const virtualEdgeData = new Map();

  for (const component of spqrTree) {
        component.isCollapsed = false
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
    spqr: ".spqr-components"
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

  // Always set up zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .filter(event => !event.target.closest(classMap[canvas]))
    .on("zoom", (event) => {
      container.attr("transform", event.transform);
    });

  chosenSVG.call(zoom);

  return container;
}

// FUNCTIONS TO HANDLE DRAWING AND BUILDING INPUT AND SPQR GRAPH

/**
 * Modified refreshInputGraph to trigger smart SPQR redraw
 */
function refreshInputGraph() {
  // Stop current simulation
  if (state.simulation.input) {
    state.simulation.input
      .force("link", null)
      .force("charge", null)
      .force("center", null)
      .force("collision", null);
    state.simulation.input.stop();
  }

  // Clear the SVG
  clearGraph(elements.svgInput);
  
  // Recreate the graph with updated data
  const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
  state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
    source: idToNode[String(s)],
    target: idToNode[String(t)]
  }));

  // Recreate the graph
  const result = createGraph(
    elements.svgInput, 
    state.data.graphNodes, 
    state.data.graphLinks,
    false
  );
  
  state.simulation.input = result.simulation;
  state.simulation.input
    .force("link", null)
    .force("charge", null)
    .force("center", null)
    .force("collision", null);
  state.d3selections.nodeInput = result.nodeSel;
  state.d3selections.linkInput = result.linkSel;
  state.d3selections.labelInput = result.labelSel;

  // Set up all event handlers
  setupInputEventHandlers();
  
}



function refreshInputGraphSmooth() {
  
  // Helper functions first
  function updatePositions() {
    state.d3selections.nodeInput
      .attr("cx", d => d.x)
      .attr("cy", d => d.y);

    state.d3selections.labelInput
      .attr("x", d => d.x + 12)
      .attr("y", d => d.y + 4);

    updateEdgePositions();
  }

  function updateEdgePositions() {
    state.d3selections.linkInput
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
  }

  // === NODES ===
  const nodeSel = elements.svgInput
    .selectAll("circle")
    .data(state.data.graphNodes, d => d.id);


  nodeSel.exit().remove();

  const nodeEnter = nodeSel.enter()
    .append("circle")
    .attr("r", 10)
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .style("fill", "steelblue")
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

  state.d3selections.nodeInput = nodeSel.merge(nodeEnter);

  // === LABELS ===
  const labelSel = elements.svgInput
    .selectAll("text")
    .data(state.data.graphNodes, d => d.id);


  labelSel.exit().remove();

  const labelEnter = labelSel.enter()
    .append("text")
    .attr("x", 12)
    .attr("y", ".31em")
    .text(d => d.id);

  state.d3selections.labelInput = labelSel.merge(labelEnter);


  // === LINKS ===
  
  const linkSel = elements.svgInput
    .selectAll("line")
    .data(state.data.graphLinks, d => `${d.source.id}-${d.target.id}`);

  // Log what's being removed
  linkSel.exit().each(function(d) {
  });
  linkSel.exit().remove();

  // Log what's being added
  const linkEnterSel = linkSel.enter();

  const linkEnter = linkEnterSel
    .append("line")
    .attr("stroke-opacity", 0.6)
    .attr("stroke", "#999")
    .attr("stroke-width", 2)
    .attr("x1", d => {
      return d.source.x;
    })
    .attr("y1", d => {
      return d.source.y;
    })
    .attr("x2", d => {
      return d.target.x;
    })
    .attr("y2", d => {
      return d.target.y;
    });

  state.d3selections.linkInput = linkSel.merge(linkEnter);


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

function setupInputEventHandlers() {
  // Remove any existing event handlers first
  state.d3selections.nodeInput
    .on("mouseover", null)
    .on("mouseout", null)
    .call(d3.drag().on("start", null).on("drag", null).on("end", null));

  // Mouse hover events for cross-highlighting
  state.d3selections.nodeInput
    .on("mouseover", (evt, d) => handleMouseOverInput(evt, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
    .on("mouseout", (evt, d) => handleMouseOutInput(evt, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));

  // Add drag behavior to all nodes
  const dragBehavior = d3.drag()
    .on("start", function(event, d) {
      if (!event.active && state.simulation.input) {
        state.simulation.input.alphaTarget(0.3).restart();
      }
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
      
      // Update edge positions
      state.d3selections.linkInput
        .attr("x1", l => l.source.id === d.id ? d.x : l.source.x)
        .attr("y1", l => l.source.id === d.id ? d.y : l.source.y)
        .attr("x2", l => l.target.id === d.id ? d.x : l.target.x)
        .attr("y2", l => l.target.id === d.id ? d.y : l.target.y);
    })
    .on("end", function(event, d) {
      if (!event.active && state.simulation.input) {
        state.simulation.input.alphaTarget(0);
      }
      if (state.ui_state.drawMode) {
        d.fx = d.x;
        d.fy = d.y;
      } else {
        d.fx = null;
        d.fy = null;
      }
      storeInputNodePositions();
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
  
  console.log("Graphs cleared");
}

function drawInputGraph(nodes = state.data.graphNodes, edges = state.data.graphEdges, presetType = null) {
  console.log("Setting graph with nodes:", nodes, "edges:", edges, "preset:", presetType);
  
  try {
    state.data.graphEdges = edges.map(e => [...e]); // Deep copy edges
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

    const result = createPresetGraph(
      elements.svgInput, 
      state.data.graphNodes, 
      state.data.graphLinks, 
      undefined, 
      undefined, 
      presetType
    );
    
    if (!result) {
      throw new Error("createPresetGraph returned null");
    }
    
    state.simulation.input = result.simulation;
    state.d3selections.nodeInput = result.nodeSel;
    state.d3selections.linkInput = result.linkSel;
    state.d3selections.labelInput = result.labelSel;

    // Use the centralized event handler setup
    setupInputEventHandlers();

    // Handle simulation end events
    if (presetType == null && state.data.isPreset === false) {
      state.simulation.input
        .on("end", () => {
          storeInputNodePositions();
          if(state.data.inputNew) {
            state.data.inputNew = false;
            createSPQRVisualization();
          }
          console.log("Initial layout complete, stopping simulation.");
          state.simulation.input
            .force("link", null)
            .force("charge", null)
            .force("center", null)
            .force("collision", null);
            refreshInputGraph();
        });
    } else if (state.data.isPreset === false) {
      state.simulation.input.on("end", storeInputNodePositions);
    }
    
    console.log("Graph setup complete");
  } catch (error) {
    console.error("Error in setGraph:", error);
    // Reset state if there's an error
    resetState();
  }
}

/**
 * Modified createSPQRVisualization to support smart redraw
 */
function createSPQRVisualization() {
  console.log("Creating SPQR visualization...");
  
  // Regular full redraw for first time or when no previous tree exists
  const edgesMap = generateEdgesMap(state.data.graphEdges);
  console.log("With edges:", edgesMap);
  state.data.spqrTree = calculateSPQRTree(edgesMap);
  
  const nodesSPQR = buildSPQRNodes(state.data.spqrTree);
  const linksSPQR = buildSPQRLinks(state.data.spqrTree, nodesSPQR);
  
  buildAdjacencyList(state.data.spqrTree, nodesSPQR, linksSPQR);
  
  const { virtualEdgeData, allVirtualTwinEdgeLinks, componentVirtualEdgesMap } = buildVirtualEdgeData(state.data.spqrTree);
  state.data.virtualEdgeData = virtualEdgeData;
  state.data.allVirtualTwinEdgeLinks = allVirtualTwinEdgeLinks;
  state.data.componentVirtualEdgesMap = componentVirtualEdgesMap;

  clearGraph(elements.svgSPQR);
  SPQRZoomContainer = initializeZoomContainer("spqr");

  const result = createGraph(SPQRZoomContainer, nodesSPQR, linksSPQR);
  state.simulation.spqr = result.simulation;
  state.d3selections.nodeSPQR = result.nodeSel;
  state.d3selections.linkSPQR = result.linkSel;
  state.d3selections.labelSPQR = result.labelSel;

    calculateAndStoreComponentCentroids();

    // Update embedding count
  var embeddingCount = 1;
  for(const c of state.data.spqrTree) {
    if (c.type == 'P') {
      console.log(c)
      embeddingCount *= factorials[c.graph.values().next!= null ? c.neighbors.length : c.neighbors.length-1];
    }
    if(c.type == 'R') {
      embeddingCount *= 2;
    }
  }
  console.log("EMBEDDING COUNT:", embeddingCount);
  document.getElementById('embedding-count').textContent = embeddingCount;

  setupCrossGraphHoverEvents();
  storeInputNodePositions();
  drawAllSPQRComponents();
  drawSPQRTreeReingoldTilford();
  drawSPQRVirtualEdgesBetweenComponents();
  
  // Store this tree for future comparisons
  state.data.previousSpqrTree = structuredClone(state.data.spqrTree);
}

function setupCrossGraphHoverEvents() {
  state.d3selections.nodeInput
    .on("mouseover", (e, d) => handleMouseOverInput(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutInput(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));

  state.d3selections.nodeSPQR
    .on("mouseover", (e, d) => handleMouseOverSPQR(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutSPQR(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));
}

function storeInputNodePositions() {
  elements.svgInput.selectAll("circle").each(function(d) {
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

      updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    })
    .on("end", function(event) {
      d3.select(this)
        .style("cursor", "grab")
        .style("opacity", 1);
      orientComponents();
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
  if(!comp.isCollapsed) {
    console.log("Collapsing tree from root:", comp);
    assignTreeLevelsFromRoot(comp); // recompute levels relative to clicked comp
    await collapseSpqrTreeRecursivelyToRootLevelByLevel(comp);
  } else {
    // Find path to an expanded component and expand along that path
    await expandPathToComponent(comp);
  }
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
    console.log("📈 Current graphNodes count:", state.data.graphNodes.length);
    console.log("📈 Current graphEdges count:", state.data.graphEdges.length);
    console.log("📈 Current graphLinks count:", state.data.graphLinks.length);

    const compGroup = elements.svgSPQR
      .selectAll(".spqr-component")
      .filter(function () {
        return d3.select(this).attr("data-comp-id") === String(component.id);
      });

    compGroup.classed("highlighted", true);

    const movingNodeIds = componentNodeIds.filter(id => id !== srcId && id !== tgtId);
    const componentNodes = state.data.graphNodes.filter(n => movingNodeIds.includes(n.id));

    console.log("🏃 Moving nodes:", movingNodeIds);
    console.log("🏃 Moving node objects count:", componentNodes.length);

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

    console.log("🎯 Source node:", source);
    console.log("🎯 Target node:", target);

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
      
      // Check for existing virtual edge BEFORE modifications
      let existingLink = state.data.graphLinks.find(
        l =>
          (l.source.id === srcId && l.target.id === tgtId) ||
          (l.source.id === tgtId && l.target.id === srcId)
      );

      console.log("🔍 Existing virtual edge link found:", !!existingLink);
      
      if (existingLink) {
        console.log("🔍 Existing link details:", {
          sourceId: existingLink.source.id,
          targetId: existingLink.target.id,
          sourceType: typeof existingLink.source,
          targetType: typeof existingLink.target
        });
      }

      // Add virtual edge if it doesn't exist
      if (!existingLink) {
        console.log("➕ Adding new virtual edge to graphEdges");
        console.log("📊 Before adding - graphEdges:", state.data.graphEdges.length);

        state.data.graphEdges.push([Number(srcId), Number(tgtId)]);
        console.log("📊 After adding - graphEdges:", state.data.graphEdges.length);
        console.log("📊 New edge added:", [srcId, tgtId]);
        
        // Rebuild ALL graphLinks from graphEdges to ensure consistency
        console.log("🔄 Rebuilding graphLinks from graphEdges...");
        const idToNode = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
        console.log("🗂️ idToNode mapping has", Object.keys(idToNode).length, "entries");
        
        const newGraphLinks = state.data.graphEdges.map(([s, t]) => {
          const sourceNode = idToNode[String(s)];
          const targetNode = idToNode[String(t)];
          
          if (!sourceNode) console.warn(`❌ Source node ${s} not found in idToNode`);
          if (!targetNode) console.warn(`❌ Target node ${t} not found in idToNode`);
          
          return {
            source: sourceNode,
            target: targetNode
          };
        }).filter(link => link.source && link.target);
        
        console.log("📊 New graphLinks count:", newGraphLinks.length);
        console.log("📊 Filtered out", state.data.graphEdges.length - newGraphLinks.length, "invalid links");
        
        state.data.graphLinks = newGraphLinks;
        
        // Verify the new virtual edge was created
        const newVirtualEdge = state.data.graphLinks.find(
          l => (l.source.id === srcId && l.target.id === tgtId) ||
               (l.source.id === tgtId && l.target.id === srcId)
        );
        console.log("✅ New virtual edge created:", !!newVirtualEdge);
        if (newVirtualEdge) {
          console.log("✅ Virtual edge details:", {
            sourceId: newVirtualEdge.source.id,
            targetId: newVirtualEdge.target.id,
            sourceX: newVirtualEdge.source.x,
            sourceY: newVirtualEdge.source.y,
            targetX: newVirtualEdge.target.x,
            targetY: newVirtualEdge.target.y
          });
        }
      }

      // Remove moving nodes from data
      console.log("🗑️ Removing moving nodes from graphNodes...");
      console.log("📊 Before removal - graphNodes:", state.data.graphNodes.length);
      
      state.data.graphNodes = state.data.graphNodes.filter(
        n => n.id === srcId || n.id === tgtId || !componentNodeIds.includes(n.id)
      );
      
      console.log("📊 After removal - graphNodes:", state.data.graphNodes.length);
      
      // Remove edges that reference removed nodes
      console.log("🗑️ Cleaning up edges...");
      console.log("📊 Before cleanup - graphEdges:", state.data.graphEdges.length);
      
      state.data.graphEdges = state.data.graphEdges.filter(
        e => e.every(id => state.data.graphNodes.find(n => n.id === String(id)))
      );
      
      console.log("📊 After cleanup - graphEdges:", state.data.graphEdges.length);
      
      // Rebuild graphLinks again after node removal
      console.log("🔄 Final graphLinks rebuild...");
      const idToNodeFinal = Object.fromEntries(state.data.graphNodes.map(n => [n.id, n]));
      state.data.graphLinks = state.data.graphEdges.map(([s, t]) => ({
        source: idToNodeFinal[String(s)],
        target: idToNodeFinal[String(t)]
      })).filter(link => link.source && link.target);
      
      console.log("📊 Final graphLinks count:", state.data.graphLinks.length);

      // Final verification - check if virtual edge still exists
      const finalVirtualEdge = state.data.graphLinks.find(
        l => (l.source.id === srcId && l.target.id === tgtId) ||
             (l.source.id === tgtId && l.target.id === srcId)
      );
      console.log("🎯 Final virtual edge check:", !!finalVirtualEdge);
      
      if (finalVirtualEdge) {
        console.log("🎯 Final virtual edge is valid:", {
          hasSource: !!finalVirtualEdge.source,
          hasTarget: !!finalVirtualEdge.target,
          sourceId: finalVirtualEdge.source?.id,
          targetId: finalVirtualEdge.target?.id
        });
      } else {
        console.error("❌ Virtual edge was lost during processing!");
      }

      collapseSpqrComponent(component);
      console.log("🔄 Calling refreshInputGraphSmooth...");
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
// Optional: Clear cached data when component is no longer needed
function clearComponentCache(component) {
  if (component.cachedData) {
    component.cachedData = null;
    console.log(`Cleared cache for component ${component.id}`);
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

  console.log("Draw mode:", state.ui_state.drawMode);
  elements.svgInput.selectAll("circle")
    .attr("fill", "steelblue");
};

elements.deleteModeBtn.onclick = function() {
  setActiveTool('delete');
  state.ui_state.deleteMode = !state.ui_state.deleteMode;
  endOfDrawHandleSelectedNode();
  state.ui_state.drawMode = false; // Disable draw mode when entering delete mode
  console.log("Delete mode:", state.ui_state.deleteMode);
};


elements.svgInput.on("click", function(event) {
  if (!state.ui_state.drawMode && !state.ui_state.deleteMode) return;
  var mode;

  if(state.ui_state.deleteMode) {
    mode = "delete";
  }
 if(state.ui_state.drawMode) {
    mode = "draw";
  }

  const [mouseX, mouseY] = d3.pointer(event, this);
  console.log("Click at:", mouseX, mouseY);

  // Check if click is on a node
  let clickedNodeId = null;
  elements.svgInput.selectAll("circle").each(function(d) {
    if (!d) return;
    const dx = mouseX - d.x;
    const dy = mouseY - d.y;
    if (Math.sqrt(dx * dx + dy * dy) < 18) {
      clickedNodeId = d.id;
      console.log("Clicked on node:", d.id);
    }
  });

    let clickedEdgeId = null;
    let closestEdge = null;
    let closestDist = Infinity;
    let edgeSelectionLeniency = 6; // Distance threshold for edge selection
    elements.svgInput.selectAll("line").each(function(d) {
        if (!d || clickedNodeId != null) return;
        
        const dist = pointToSegmentDistance(mouseX, mouseY, d.source.x, d.source.y, d.target.x, d.target.y);
        
        if (dist < edgeSelectionLeniency && dist < closestDist) {
            closestDist = dist;
            closestEdge = d;
        }
    });
    if (closestEdge && mode === "delete") {
        clickedEdgeId = `${closestEdge.source.id}-${closestEdge.target.id}`; // Use closestEdge, not d
        console.log("Clicked on edge:", clickedEdgeId);
        console.log("Deleting edge:", clickedEdgeId);
        
        // Remove from edges array
        state.data.graphEdges = state.data.graphEdges.filter(e => 
            !(e[0] === Number(closestEdge.source.id) && e[1] === Number(closestEdge.target.id))
        );
        
        // Remove from links as well
        state.data.graphLinks = state.data.graphLinks.filter(link => 
            !(link.source.id === closestEdge.source.id && link.target.id === closestEdge.target.id)
        );
        
        console.log("Updated graph edges:", state.data.graphEdges);
        console.log("Updated graph links:", state.data.graphLinks);
        
        // Refresh the graph
        refreshInputGraph();
        console.log("Edge deleted:", clickedEdgeId);
        return
    }

    
  if (clickedNodeId) {
    if(mode === "delete") { 
      // Delete node and associated edges
      console.log("Deleting node:", clickedNodeId);
      console.log("Current graph nodes:", state.data.graphNodes);
      console.log("Current graph edges:", state.data.graphEdges);
      console.log("Current graph links:", state.data.graphLinks);
      state.data.graphNodes = state.data.graphNodes.filter(n => n.id !== clickedNodeId);
      state.data.graphEdges = state.data.graphEdges.filter(e => e[0] !== Number(clickedNodeId) && e[1] !== Number(clickedNodeId));
      console.log("Updated graph nodes:", state.data.graphNodes);
      console.log("Updated graph edges:", state.data.graphEdges);
      
      // Remove from links as well
      state.data.graphLinks = state.data.graphLinks.filter(link => link.source.id !== clickedNodeId && link.target.id !== clickedNodeId);
      console.log("Updated graph links:", state.data.graphLinks);
      // Refresh the graph
      refreshInputGraph();
      return

    }

    if (!state.ui_state.edgeStart) {
      // Start edge drawing
      state.ui_state.edgeStart = clickedNodeId;
      highlight(state.d3selections.nodeInput, clickedNodeId);
      console.log("Starting edge from:", clickedNodeId);
      elements.svgInput.selectAll("circle")
        .attr("fill", d => d.id === clickedNodeId ? "orange" : "steelblue");
    } else if (state.ui_state.edgeStart !== clickedNodeId) {
      // Complete edge - add to both data structures
      console.log("Completing edge:", state.ui_state.edgeStart, "->", clickedNodeId);
      const newEdge = [Number(state.ui_state.edgeStart), Number(clickedNodeId)];
      
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

      // Refresh the entire graph to ensure consistency
      refreshInputGraph();

      // Reset edge drawing state
      state.ui_state.edgeStart = null;
    }
  } else if (state.ui_state.drawMode) {
    if (state.ui_state.edgeStart) {
      // Cancel edge drawing
      console.log("Canceling edge drawing");
      state.ui_state.edgeStart = null;
      elements.svgInput.selectAll("circle")
        .attr("fill", "steelblue");
      return;
    }

    // Add new node
    addNewNode(mouseX, mouseY);
  }
});

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

  // Refresh the entire graph to ensure all behaviors are applied
  refreshInputGraph();
  
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

/**
 * Draw SPQR tree using Reingold-Tilford algorithm (replaces drawAllSPQRComponents)
 */
function drawSPQRTreeReingoldTilford(givenRoot = null) {
  
    if (!state.data.spqrTree || state.data.spqrTree.length === 0) {
        console.warn("❌ No SPQR tree data available");
        return;
    }

    var root;

    if(givenRoot == null) {
    
    // Find optimal root
     root = findOptimalRoot(state.data.spqrTree);
    state.data.spqrRoot = root;

    } else {
      // Use the given root if provided 
       root = givenRoot;
    }

    if(!root) {
        console.warn("❌ No valid root found for SPQR tree"); 
        return;
    } 

    // Get canvas dimensions
    const svgRect = elements.svgSPQR.node().getBoundingClientRect();
    
    // Build tree structure
    const tree = buildTreeStructure(root, state.data.spqrTree);
    
    // Apply Reingold-Tilford algorithm
    const layout = reingoldTilfordLayout(tree);
    orientComponents();
    
    // Scale and center the layout
   // const scaledLayout = scaleAndCenterLayout(layout, svgRect.width, svgRect.height);
    
    // Draw the tree using existing functions
    const groupArray = drawTreeWithLayout(layout, state.data.spqrTree);

   // Add this new centering code
    centerSPQRView();
    
    
    // Return the group array in case you want to add interactions later
    return groupArray;
}
function centerSPQRView() {
    // Get the SVG dimensions
    const svgWidth = elements.svgSPQR.node().getBoundingClientRect().width;
    const svgHeight = elements.svgSPQR.node().getBoundingClientRect().height;

    // Calculate bounds of all components
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    SPQRZoomContainer.selectAll('.spqr-components').each(function() {
        const transform = d3.select(this).attr("transform");
        const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
        if (match) {
            const x = parseFloat(match[1]);
            const y = parseFloat(match[2]);
            const bbox = this.getBBox();
            
            minX = Math.min(minX, x + bbox.x);
            minY = Math.min(minY, y + bbox.y);
            maxX = Math.max(maxX, x + bbox.x + bbox.width);
            maxY = Math.max(maxY, y + bbox.y + bbox.height);
        }
    });

    // Calculate center points and scale
    const treeWidth = maxX - minX;
    const treeHeight = maxY - minY;
    const treeCenterX = minX + treeWidth / 2;
    const treeCenterY = minY + treeHeight / 2;
    const scale = Math.min(
        0.95 * svgWidth / treeWidth,
        0.95 * svgHeight / treeHeight
    ) * 0.95; // Additional 5% zoom out

    // Calculate translation to center
    const translateX = svgWidth / 2 - treeCenterX * scale;
    const translateY = svgHeight / 2 - treeCenterY * scale;

    // Apply the transform
    const zoom = d3.zoom().on("zoom", event => {
        SPQRZoomContainer.attr("transform", event.transform);
    });
    
    elements.svgSPQR.call(zoom);
    elements.svgSPQR.call(zoom.transform, d3.zoomIdentity
        .translate(translateX, translateY)
        .scale(scale)
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
    var centerIndex;
    if (diameterPath.length % 2 == 1) centerIndex = Math.floor(diameterPath.length / 2);
    else {
      let centerChoiceLeft = spqrTree.find(comp => comp.id === diameterPath[Math.floor(diameterPath.length / 2)])
      let centerChoiceRight = spqrTree.find(comp => comp.id === diameterPath[Math.ceil(diameterPath.length / 2)])
        if (centerChoiceLeft.type === 'P') return centerChoiceLeft;
        if (centerChoiceRight.type === 'P') return centerChoiceRight;

      if(centerChoiceLeft.neighbors.length > centerChoiceRight.neighbors.length) {
        return centerChoiceLeft;
      } else if(centerChoiceLeft.neighbors.length < centerChoiceRight.neighbors.length) {
        return centerChoiceRight;
      }
      else {
        if (centerChoiceLeft.type === 'R') return centerChoiceLeft;
        if (centerChoiceRight.type === 'R') return centerChoiceRight;
        return centerChoiceLeft; // Default to left if both are equal
      }
    }

    const centerId = diameterPath[centerIndex];
    
    // Return the center component
    return spqrTree.find(comp => comp.id === centerId);
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
    console.log(`\nProcessing virtual edge ${key}:`);
    console.log("  Components:", components);
    console.log("  Nodes:", nodes);
    
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
    console.log(`  Edge connects components ${compAID} and ${compBID}`);
    console.log(`  Through nodes ${u} and ${v}`);

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
    console.log(`  Component A: ${compA.type} (index ${indexA})`);
    console.log(`  Component B: ${compB.type} (index ${indexB})`);

    // Find midpoints considering component types
    console.log("  Finding midpoints...");
    const midA = findVirtualEdgeMidpoint(compAGroup, compA, u, v);
    const midB = findVirtualEdgeMidpoint(compBGroup, compB, u, v);

    if (midA && midB) {
      console.log(`  ✓ Midpoints found:`);
      console.log(`    A: (${midA.x}, ${midA.y})`);
      console.log(`    B: (${midB.x}, ${midB.y})`);

      // Create or update the virtual edge
      // Use the actual virtual edge key from our data structure
      const edgeKey = key; // This is the key from virtualEdgeData
      console.log(`  Drawing virtual edge with key ${edgeKey}`);
      
      // Get the specific virtual edge IDs used in each component
      const compAVirtualId = compA.type === 'P' ? 
        compA.virtualEdgeEntry.find(([nodes, id]) => 
          (nodes[0] == u && nodes[1] == v) || (nodes[0] == v && nodes[1] == u)
        )?.[1] : null;
        
      const compBVirtualId = compB.type === 'P' ? 
        compB.virtualEdgeEntry.find(([nodes, id]) => 
          (nodes[0] == u && nodes[1] == v) || (nodes[0] == v && nodes[1] == u)
        )?.[1] : null;
      
      console.log(`  Virtual edge IDs - CompA: ${compAVirtualId}, CompB: ${compBVirtualId}`);
      
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
          .attr("data-target-virtual-id", compBVirtualId);
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
  console.log(`\n  Finding midpoint for component ${component.id} (${component.type}):`);
  console.log(`    Looking for edge between nodes ${u} and ${v}`);

  if (component.type === 'P') {
    console.log("    Using path-based approach for P component");
    console.log("    Component virtual edges:", component.virtualEdgeEntry);
    
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
    
    console.log("    Selected virtual edge ID:", virtualEdgeEntry[1]);
    
    const virtualEdgeId = virtualEdgeEntry[1];
    console.log(`    Looking for path with virtual edge ID: ${virtualEdgeId}`);

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
    console.log(`    Component offset: (${offsetX}, ${offsetY})`);

    const pathLength = virtualPath.getTotalLength();
    const midPoint = virtualPath.getPointAtLength(pathLength / 2);
    console.log(`    Path midpoint: (${midPoint.x}, ${midPoint.y})`);

    const result = {
      x: midPoint.x + offsetX,
      y: midPoint.y + offsetY
    };
    console.log(`    Final position: (${result.x}, ${result.y})`);
    return result;
  } else {
    console.log("    Using line-based approach for non-P component");
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
    console.log(`    Component offset: (${offsetX}, ${offsetY})`);

    const x1 = parseFloat(edge.getAttribute("x1"));
    const y1 = parseFloat(edge.getAttribute("y1"));
    const x2 = parseFloat(edge.getAttribute("x2"));
    const y2 = parseFloat(edge.getAttribute("y2"));
    console.log(`    Edge points: (${x1}, ${y1}) -> (${x2}, ${y2})`);

    const result = {
      x: (x1 + x2) / 2 + offsetX,
      y: (y1 + y2) / 2 + offsetY
    };
    console.log(`    Final position: (${result.x}, ${result.y})`);
    return result;
  }
}

function updateInterComponentVirtualEdges() {
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

    // Pass the id so P-components can disambiguate
    const midA = findMidpoint(compAGroup, u, v, id);
    const midB = findMidpoint(compBGroup, u, v, id);

    if (midA && midB) {
      SPQRZoomContainer.append("line")
        .attr("x1", midA.x)
        .attr("y1", midA.y)
        .attr("x2", midB.x)
        .attr("y2", midB.y)
        .attr("stroke", "orange")
        .attr("stroke-width", 1.3)
        .attr("class", "inter-component-virtual-edge");
    } else {
      console.warn(`Skipping edge draw — midA or midB missing for id=${id}`);
    }
  }
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
    const pathLength = edge.getTotalLength();
    const midPoint = edge.getPointAtLength(pathLength / 2);
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


function drawRComponent(group, comp) {
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));

  const links = [];
  const virtualLinks = [];

  const compGroup = group.append("g")
    .attr("class", "spqr-component")
    .attr("data-comp-id", comp.id);

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
    .attr("stroke-width", spqrComponentPictureNormalStrokeWidth);

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
    .attr("stroke", "red")
    .attr("stroke-width", spqrComponentPictureVirtualStrokeWidth)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({ source: { id: d.source }, target: { id: d.target } }));

  // Draw nodes
  compGroup.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
    .attr("fill", "#3498db");

  // Add bounding box and hover
  addComponentBoundingElements(compGroup, nodeMap, comp.id);
  addComponentHoverEvents(compGroup, comp.id);
}


function SPQRComponentPositionsFromInputGraph() {
  const componentPositions = new Map();
  const allCentroids = [];

  // First pass: calculate bounding box center for each component
  state.data.spqrTree.forEach((comp, index) => {
    const xVals = [];
    const yVals = [];

    var xSum = 0;
    var ySum = 0; 

    comp.graph.forEach((_, nodeId) => {
      const pos = state.data.inputNodePositions.get(String(nodeId));
      if (pos) {
        xVals.push(pos.x);
        yVals.push(pos.y);
        xSum += pos.x;
        ySum += pos.y;
      }
    });

    if (xVals.length > 0 && yVals.length > 0) {
      const minX = Math.min(...xVals);
      const maxX = Math.max(...xVals);
      const minY = Math.min(...yVals);
      const maxY = Math.max(...yVals);

      const center = {
        x: xSum / xVals.length,
        y: ySum / yVals.length
      };

      componentPositions.set(index, center);
      allCentroids.push(center);
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


function drawSPQRComponentAtPosition(componentPositions) {
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


    // Store initial position as data
    currentGroup.datum({ x: offsetX, y: offsetY, index: index });
    
    SPQRComponentDragAndClickBehaivour(currentGroup, comp, index);
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
      .distance(40) // distance between components
      .strength(0.05)) // weak link strength
    .force("charge", d3.forceManyBody().strength(-80)) // repulsion between components
    .force("center", d3.forceCenter(500, 500))
    .force("collision", d3.forceCollide(d => {
      const r = Math.sqrt(d.width ** 2 + d.height ** 2) / 2;
      return r + 10; // +20 padding between components
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
    

    orientTickCounter++;
    if (orientTickCounter === 1) {
      orientComponents();
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
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
    if (state.data.anySPQRComponentCollapsed) return;
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
  const [u, v] = comp.virtualEdgeEntry[0][0];  
  const posU = state.data.inputNodePositions.get(String(u));
  const posV = state.data.inputNodePositions.get(String(v));
  var useHorizontal = false;
  
  if (Math.abs(posU.x-posV.x)> Math.abs(posU.y-posV.y)) {
    useHorizontal = true;
  }

    
    // Redraw P component with chosen orientation
    group.selectAll("*").remove();
    drawOrientedPComponent(group, comp, false);
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
  
  // Redraw with best rotation (convert degree to radians for targetAngle)
  group.selectAll("*").remove();
  drawOrientedSComponent(
    group,
    comp,
    (bestRotation * Math.PI / 180 ), false
  );
}

function drawOrientedPComponent(group, comp, useHorizontal = false) {

  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));
  const links = [];
  const virtualLinks = [];

  const compGroup = group.append("g")
    .attr("class", "spqr-component")
    .attr("data-comp-id", comp.id);

     var backup;
  // Create virtual edge set for lookup with IDs
  comp.virtualEdgeEntry.forEach(virtEdge => {
    const [nodes, id] = virtEdge;
    const [v1, v2] = nodes.map(String);
    virtualLinks.push({ 
            source: String(v1), 
            target: String(v2),
            virtualEdgeId: id 
          });
    backup = {source: String(v1), target: String(v2)}
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

  const spacing = 80;
  nodes.forEach((nodeId, index) => {
    nodeMap.set(Number(nodeId), {
      x: useHorizontal ? (index - (nodes.length - 1) / 2) * spacing : 0,
      y: useHorizontal ? 0 : (index - (nodes.length - 1) / 2) * spacing
    });
  });

  var i = 0;
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
    // Find the other component connected by this virtual edge
    const otherComp = comps.find(c => c !== comp.id);
    if (!otherComp) return false;

    // Find both components in the SPQR tree
    const otherComponent = state.data.spqrTree.find(c => c.id === otherComp);
    const currentComponent = state.data.spqrTree.find(c => c.id === comp.id);
    
    // Check if other component has lower tree level (is parent)
    return otherComponent && currentComponent && 
          otherComponent.treeLevel < currentComponent.treeLevel;
  })?.virtualEdgeId;

  console.log(virtualLinks)

  var centerComp;

  // Sort virtual links based on connected component centroids

virtualLinks.sort((a, b) => {
  // Get connected component IDs
  const compAId = state.data.virtualEdgeData.get(a.virtualEdgeId)?.components.find(id => id !== comp.id);
  const compBId = state.data.virtualEdgeData.get(b.virtualEdgeId)?.components.find(id => id !== comp.id);

  if (!compAId || !compBId) return 0;

  // Get pre-calculated centroids
  const centroidA = state.data.componentCentroids.get(compAId);
  const centroidB = state.data.componentCentroids.get(compBId);

  if (!centroidA || !centroidB) return 0;

  // Sort based on orientation
  return useHorizontal ? centroidA.y - centroidB.y : centroidA.x - centroidB.x;
});

  console.log(virtualLinks)

// Draw virtual edges with curved paths
compGroup.selectAll(".edge-virtual")
  .data(virtualLinks)
  .enter()
  .append("path")
  .attr("class", "edge-virtual")
  .attr("d", (d, idx) => {
    const sourcePos = nodeMap.get(Number(d.source));
    const targetPos = nodeMap.get(Number(d.target));
    const midX = (sourcePos.x + targetPos.x) / 2;
    const midY = (sourcePos.y + targetPos.y) / 2;
    const pathOffset = 30;

    let curveOffset = 0;

    if (d.virtualEdgeId === parentVirtualEdgeId && links.length <= 1) {
      // Always draw parent edge in the middle
      curveOffset = 0;
    } else {
      // Fan out the rest around the parent edge
      // Use idx but shift so that the "parent" doesn't count
      const filteredIdx = (idx > 0 && d.virtualEdgeId !== parentVirtualEdgeId)
        ? idx
        : idx; // adjust if you want symmetry
      curveOffset = pathOffset * (Math.pow(-1, filteredIdx)) * Math.ceil((filteredIdx + 1) / 2);
    }

    const controlPoint = useHorizontal
      ? { x: midX, y: sourcePos.y + curveOffset }
      : { x: sourcePos.x + curveOffset, y: midY };

    return `M ${sourcePos.x},${sourcePos.y} ` +
           `Q ${controlPoint.x},${controlPoint.y} ` +
           `${targetPos.x},${targetPos.y}`;
  })
  .attr("stroke", "red")
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
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
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
  compGroup.selectAll(".edge-normal")
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
    .attr("stroke", "red")
    .attr("stroke-width", spqrComponentPictureVirtualStrokeWidth)
    .attr("stroke-dasharray", "5,5")
    .datum(d => ({ source: { id: d.source }, target: { id: d.target } }));

  // Draw nodes
  compGroup.selectAll(".node")
    .data(nodeObjs)
    .enter()
    .append("circle")
    .attr("class", "node")
    .attr("cx", d => nodeMap.get(Number(d.id)).x)
    .attr("cy", d => nodeMap.get(Number(d.id)).y)
    .attr("r", 6)
    .attr("fill", "#3498db");

  // Remove old bounding box and label if present
  compGroup.selectAll("rect").remove();
  compGroup.selectAll("text").remove();

  // Add bounding elements for the new orientation

  addComponentBoundingElements(compGroup, nodeMap, comp.id);
  addComponentHoverEvents(compGroup, comp.id);
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
  var paddingX = 15;
  if (componentId.substring(0,1) == 'P') {
    paddingX += state.data.spqrTree.filter(c => c.id === componentId)[0].virtualEdgeEntry.length/2 * 5;
  }
  
  const boundingRect = {
    x: bounds.minX - paddingX,
    y: bounds.minY - padding,
    width: (bounds.maxX - bounds.minX) + (2 * paddingX),
    height: (bounds.maxY - bounds.minY) + (1.8 * padding)
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
  group.append("text")
  .attr("class", "bounding-label")
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
//colors only change in array on reloading server, not on refreshing page
function addComponentHoverEvents(group, componentId) {
  group
    .on("mouseover", () => {
      if(state.ui.spqrReady === false) return;
      highlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, componentId, state.ui.colors[0]);
    })
    .on("mouseout", () => {
      if(state.ui.spqrReady === false) return;
      unhighlightComponent(state.d3selections.nodeInput, state.d3selections.linkInput, componentId, state.ui.colors[0]);
    });
}

// Enhanced version of the original drawSPQRComponentAsPictogram that calls the appropriate drawing function
function drawSPQRComponentAsPictogram(group, comp) {
  if (comp.type === "R") {
    return drawRComponent(group, comp);
  } else if (comp.type === "S") {
    return drawOrientedSComponent(group, comp, 0); // Initial orientation
  } else if (comp.type === "P") {
    return drawOrientedPComponent(group, comp, false); // Initial horizontal orientation
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
  highlightComponent(inputSel, state.d3selections.linkInput, d.id, state.ui.colors[state.ui.colorC++ % state.ui.colors.length]);
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
  if (!state.ui.spqrReady) return;
  unhighlight(spqrSel, d.id);
  let matchingSPQRNode = state.data.spqrTree.filter(c => c.id === d.id)[0];
  unhighlightComponent(inputSel, state.d3selections.linkInput, d.id);
}
// Highlighting functions - refactored
function highlight(selection, id, color = "orange") {
  if (!selection) return;
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
  if (!selection) return;
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

  const virtualEdgesToHighlight = new Set();
  comp.virtualEdgeEntry.forEach(([edge, _]) => {
    const [u, v] = edge;
    virtualEdgesToHighlight.add(`${u}-${v}`);
    virtualEdgesToHighlight.add(`${v}-${u}`);
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
        if (virtualEdgesToHighlight.has(edgeKey) && comp.type != 'P') {
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
    const levelHeight = 175; // Vertical spacing between levels
    
    
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
        const parentVirtualEdgeId = comp.virtualEdgeEntry.find(([edge, id]) => {
            const comps = state.data.virtualEdgeData.get(id)?.components || [];
            const otherComp = comps.find(c => c !== comp.id);
            if (!otherComp) return false;

            const otherComponent = state.data.spqrTree.find(c => c.id === otherComp);
            const currentComponent = state.data.spqrTree.find(c => c.id === comp.id);
            
            return otherComponent && currentComponent && 
                   otherComponent.treeLevel < currentComponent.treeLevel;
        })?.[1];

        // Combine curve offsets and centroids
        comp.virtualEdgeEntry.forEach(([edge, id], idx) => {
            const childComp = node.children.find(child => {
                const childVE = state.data.virtualEdgeData.get(id);
                return childVE && childVE.components.includes(child.id);
            });
            
            if (childComp) {
                let curveOffset;
                if (id === parentVirtualEdgeId) {
                    curveOffset = 0;
                } else {
                    const filteredIdx = (idx > 0 && id !== parentVirtualEdgeId) ? idx : idx;
                    curveOffset = (Math.pow(-1, filteredIdx)) * Math.ceil((filteredIdx + 1) / 2);
                }
                
                // Get centroid position
                const centroid = state.data.componentCentroids.get(childComp.id);
                virtualEdgePositions.set(childComp.id, {
                    curveOffset,
                    centroid
                });
            }
        });

        console.log(`\nSorting P-component ${node.id} children:`);
        console.log('Before sorting:', node.children.map(child => ({
            id: child.id,
            data: virtualEdgePositions.get(child.id)
        })));

        node.children.sort((a, b) => {
            const posA = virtualEdgePositions.get(a.id);
            const posB = virtualEdgePositions.get(b.id);
            
            // If no centroid data, fall back to curve offset
            if (!posA?.centroid || !posB?.centroid) {
                return (posA?.curveOffset || 0) - (posB?.curveOffset || 0);
            }

            // Primary sort by x-coordinate of centroids
            const xDiff = posA.centroid.x - posB.centroid.x;
            if (Math.abs(xDiff) > 5) { // 5px tolerance
                return xDiff;
            }
            
            // Secondary sort by curve offset if x positions are similar
            return posA.curveOffset - posB.curveOffset;
        });

        console.log('After sorting:', node.children.map(child => ({
            id: child.id,
            data: virtualEdgePositions.get(child.id)
        })));
    }
}


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
                .attr("class", "spqr-components")
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
    
    
    // Store the group array in case you need it later (like for force simulation updates)
    return groupArray;
}


//REDRAW SPQR TREE AFTER CHANGES IN INPUT GRAPH
/**
 * Smart SPQR redraw that preserves layout when possible
 */
function smartRedrawSPQR() {
  console.log("🔄 Smart SPQR redraw initiated");
  
  const oldTree = state.data.previousSpqrTree;
  console.log("old tree actual", state.data.spqrTree);
  console.log("📜 Old SPQR tree:", oldTree);
  
  // Generate new SPQR tree
  const edgesMap = generateEdgesMap(state.data.graphEdges);
  console.log("📊 Edges map generated:", edgesMap);
  const newTree = calculateSPQRTree(edgesMap);
  let newNodes = buildSPQRNodes(newTree);
  let newLinks = buildSPQRLinks(newTree, newNodes);
  buildAdjacencyList(newTree, newNodes, newLinks);
  console.log("📊 New SPQR tree generated:", newTree) ;

  
  if (!oldTree || oldTree.length === 0) {
    // No previous tree, do full redraw
    console.log("📝 No previous tree, doing full redraw");
    return createSPQRVisualization();
  }
  
  // Compare trees and create mapping
  const treeComparison = compareSpqrTrees(oldTree, newTree);
  console.log("🔍 Tree comparison result:", treeComparison);
  
  // Update state with new tree and comparison data
  state.data.spqrTree = newTree;
  state.data.componentMapping = treeComparison.mapping;
  state.data.unchangedComponents = treeComparison.unchanged;
  state.data.changedComponents = treeComparison.changed;
  state.data.newComponents = treeComparison.newComponents;
  state.data.removedComponents = treeComparison.removed;
  
  // Build SPQR data structures
  const nodesSPQR = buildSPQRNodes(newTree);
  const linksSPQR = buildSPQRLinks(newTree, nodesSPQR);
  buildAdjacencyList(newTree, nodesSPQR, linksSPQR);
  
  const { virtualEdgeData, allVirtualTwinEdgeLinks, componentVirtualEdgesMap } = buildVirtualEdgeData(newTree);
  state.data.virtualEdgeData = virtualEdgeData;
  state.data.allVirtualTwinEdgeLinks = allVirtualTwinEdgeLinks;
  state.data.componentVirtualEdgesMap = componentVirtualEdgesMap;

  // Perform selective redraw
  selectiveRedrawComponents(treeComparison);
  
  // Update virtual edges
  drawSPQRVirtualEdgesBetweenComponents();
  
  // Store this tree for next comparison
  state.data.previousSpqrTree = structuredClone(newTree);
}

/**
 * 
 * @param {*} oldTree 
 * @param {*} newTree 
 * @returns   return {
    mapping,
    unchanged,
    changed,
    newComponents,
    removed
  };
 */

function compareSpqrTrees(oldTree, newTree) {
  const mapping = new Map();
  const unchanged = new Set();
  const changed = new Set();
  const newComponents = new Set();
  const removed = new Set(oldTree.map(c => c.id));

  console.log("🔍 Comparing trees...");
  console.log("old tree", oldTree);
  console.log("new tree", newTree);

  // Keep track of empty P's we will resolve later
  const pendingEmptyPs = [];

  // --- Phase 1: Normal comparison ---
  for (const newComp of newTree) {
    if (isEmptyP(newComp)) {
      console.log(`⏭️ Skipping empty P component ${newComp.id} for later check`);
      pendingEmptyPs.push(newComp);
      continue;
    }

    let bestMatch = null;
    let bestScore = -1;

    for (const oldComp of oldTree) {
      if (removed.has(oldComp.id)) {
        const score = calculateComponentSimilarity(oldComp, newComp);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = oldComp;
          if (bestScore >= 0.99) {
            unchanged.add(newComp.id);
            mapping.set(oldComp.id, newComp.id);
            removed.delete(oldComp.id);
            
            // **PRESERVE TREE LEVEL**
            if (oldComp.treeLevel !== undefined) {
              newComp.treeLevel = oldComp.treeLevel;
              console.log(`🔄 Preserved tree level ${oldComp.treeLevel} for unchanged: ${oldComp.id} → ${newComp.id}`);
            }
            
            console.log(`✅ Exact match: ${oldComp.id} → ${newComp.id}`);
            break;
          }
        }
      }
    }
    
    if (bestScore > 0.99) {
      // Exact match found, no need to do anything else
      continue;
    } 
    else if (bestMatch && bestScore > 0.7) {
      mapping.set(bestMatch.id, newComp.id);
      removed.delete(bestMatch.id);
      changed.add(newComp.id);
      
      // **PRESERVE TREE LEVEL FOR CHANGED COMPONENTS**
      if (bestMatch.treeLevel !== undefined) {
        newComp.treeLevel = bestMatch.treeLevel;
        console.log(`🔄 Preserved tree level ${bestMatch.treeLevel} for changed: ${bestMatch.id} → ${newComp.id}`);
      }
      
      console.log(`🔄 Changed: ${bestMatch.id} → ${newComp.id} (score: ${bestScore.toFixed(2)})`);
    } else {
      newComponents.add(newComp.id);
      console.log(`🆕 New component: ${newComp.id}`);
    }
  }

  // --- Phase 2: Special-case empty P's ---
  console.log("🔄 Resolving empty P components...");
  console.log("Pending empty P's:", pendingEmptyPs.map(p => p.id));
  
  for (const newP of pendingEmptyPs) {
    const candidateOldPs = oldTree.filter(c => isEmptyP(c) && removed.has(c.id));

    for (const oldP of candidateOldPs) {
      // Count how many neighbors are shared between old and new P
      const sharedNeighbors = newP.neighbors.filter(n => oldP.neighbors.includes(n)).length;

      if (sharedNeighbors >= 2) {
        unchanged.add(newP.id);
        mapping.set(oldP.id, newP.id);
        removed.delete(oldP.id);
        
        // **PRESERVE TREE LEVEL FOR EMPTY P's**
        if (oldP.treeLevel !== undefined) {
          newP.treeLevel = oldP.treeLevel;
          console.log(`🔄 Preserved tree level ${oldP.treeLevel} for empty P: ${oldP.id} → ${newP.id}`);
        }
        
        console.log(`✅ Empty P treated as unchanged: ${oldP.id} → ${newP.id} (shared neighbors: ${sharedNeighbors})`);
        break; // stop after first match
      }
    }
  }

  console.log(`📊 Summary: ${unchanged.size} unchanged, ${changed.size} changed, ${newComponents.size} new, ${removed.size} removed`);

  return {
    mapping,
    unchanged,
    changed,
    newComponents,
    removed
  };
}

function isEmptyP(comp) {
  if (comp.type !== "P" || !(comp.graph instanceof Map)) return false;
  if (comp.graph.size === 0) return true; // trivial case
  for (const val of comp.graph.values()) {
    if (val !== null) return false; // not empty if any real value exists
  }
  return true;
}


/**
 * Calculate similarity score between two SPQR components
 */
function calculateComponentSimilarity(comp1, comp2) {
  let score = 0;

  // Type must match
  if (comp1.type !== comp2.type) return 0;
  score += 0.3; // Base score for same type
  
  // Compare node sets
  const nodes1 = new Set(comp1.graph.keys());
  const nodes2 = new Set(comp2.graph.keys());
  const intersection = new Set([...nodes1].filter(x => nodes2.has(x)));
  const union = new Set([...nodes1, ...nodes2]);
  
  if (union.size > 0) {
    const jaccardIndex = intersection.size / union.size;
    score += 0.4 * jaccardIndex; // Weight node similarity heavily
  }
  
  // Compare edges - FIXED VERSION
  const edges1 = getComponentEdges(comp1);
  const edges2 = getComponentEdges(comp2);
  
  console.log(`Edges for ${comp1.id}:`, Array.from(edges1).sort());
  console.log(`Edges for ${comp2.id}:`, Array.from(edges2).sort());
  
  // Calculate edge similarity using proper set intersection
  const edgeIntersectionSize = getSetIntersectionSize(edges1, edges2);
  const edgeUnionSize = edges1.size + edges2.size - edgeIntersectionSize;
  
  if (edgeUnionSize > 0) {
    const edgeJaccard = edgeIntersectionSize / edgeUnionSize;
    score += 0.2 * edgeJaccard;
    console.log(`Edge Jaccard for ${comp1.id} vs ${comp2.id}: ${edgeJaccard} (intersection: ${edgeIntersectionSize}, union: ${edgeUnionSize})`);
  }
  
  // Compare virtual edges
  const virtEdges1 = new Set(comp1.virtualEdgeEntry.map(ve => normalizeEdge(ve[0][0], ve[0][1])));
  const virtEdges2 = new Set(comp2.virtualEdgeEntry.map(ve => normalizeEdge(ve[0][0], ve[0][1])));
  const virtIntersectionSize = getSetIntersectionSize(virtEdges1, virtEdges2);
  const virtUnionSize = virtEdges1.size + virtEdges2.size - virtIntersectionSize;
  
  if (virtUnionSize > 0) {
    const virtJaccard = virtIntersectionSize / virtUnionSize;
    score += 0.1 * virtJaccard;
  }
  
  console.log(`Final similarity score for ${comp1.id} vs ${comp2.id}: ${score.toFixed(3)}`);
  return Math.min(score, 1.0);
}

/**
 * Get edges from a component as a Set of normalized edge strings - FIXED VERSION
 */
function getComponentEdges(comp) {
  const edges = new Set();
  comp.graph.forEach((neighbors, node) => {
    if (neighbors) {
      neighbors.forEach(neighbor => {
        const edge = normalizeEdge(node, neighbor);
        edges.add(edge);
      });
    }
  });
  return edges;
}

/**
 * Normalize edge to ensure consistent ordering (smaller node first)
 */
function normalizeEdge(node1, node2) {
  // Convert to strings for consistent comparison, then sort
  const str1 = String(node1);
  const str2 = String(node2);
  return str1 <= str2 ? `${str1}-${str2}` : `${str2}-${str1}`;
}

/**
 * Calculate intersection size between two sets efficiently
 */
function getSetIntersectionSize(set1, set2) {
  let intersectionSize = 0;
  // Iterate through the smaller set for efficiency
  const smallerSet = set1.size <= set2.size ? set1 : set2;
  const largerSet = set1.size <= set2.size ? set2 : set1;
  
  for (const item of smallerSet) {
    if (largerSet.has(item)) {
      intersectionSize++;
    }
  }
  
  return intersectionSize;
}

/**
 * Selectively redraw components based on comparison results
 */
function selectiveRedrawComponents(treeComparison) {
  console.log("🎨 Starting selective redraw...");
  
  // Remove components that no longer exist
  treeComparison.removed.forEach(oldCompId => {
    const oldIndex = state.data.previousSpqrTree.findIndex(c => c.id === oldCompId);
    if (oldIndex !== -1) {
      d3.select(`#spqr-component-${oldIndex}`).remove();
      console.log(`🗑️ Removed component: ${oldCompId}`);
    }
  });
  
  // Process each component in the new tree
  state.data.spqrTree.forEach((comp, newIndex) => {
    const compId = comp.id;
    
    if (treeComparison.unchanged.has(compId)) {
      // Keep unchanged component in place
      preserveUnchangedComponent(comp, newIndex, treeComparison);
      
    } else if (treeComparison.changed.has(compId)) {
      // Update changed component in place
      updateChangedComponent(comp, newIndex, treeComparison);
      
    } else if (treeComparison.newComponents.has(compId)) {
      // Create new component
      createNewComponent(comp, newIndex);
    }
  });
  
  // Highlight changes
  highlightTreeChanges(treeComparison);
}

/**
 * Preserve an unchanged component by updating its ID and index references
 */
function preserveUnchangedComponent(comp, newIndex, treeComparison) {
  // Find the old component ID that maps to this one
  let oldCompId = null;
  for (const [old, newId] of treeComparison.mapping) {
    if (newId === comp.id) {
      oldCompId = old;
      break;
    }
  }
  
  if (!oldCompId) return;
  
  const oldIndex = state.data.previousSpqrTree.findIndex(c => c.id === oldCompId);
  if (oldIndex === -1) return;
  
  // Update the group's ID and data
  const existingGroup = d3.select(`#spqr-component-${oldIndex}`);
  if (!existingGroup.empty()) {
    existingGroup.attr("id", `spqr-component-${newIndex}`);
    
    // Update stored data
    const currentData = existingGroup.datum();
    existingGroup.datum({
      ...currentData,
      index: newIndex,
      component: comp,
      treeLevel: comp.treeLevel
    });
    
    // Update drag behavior with new index
    existingGroup.call(d3.drag().on("start", null).on("drag", null).on("end", null));
    SPQRComponentDragAndClickBehaivour(existingGroup, comp, newIndex);
    
    console.log(`✅ Preserved unchanged component: ${oldCompId} → ${comp.id} (index ${oldIndex} → ${newIndex})`);
  }
}

/**
 * Update a changed component by redrawing it in place
 */
function updateChangedComponent(comp, newIndex, treeComparison) {
  // Find the old component and its position
  let oldCompId = null;
  for (const [old, newId] of treeComparison.mapping) {
    if (newId === comp.id) {
      oldCompId = old;
      break;
    }
  }
  
  if (!oldCompId) return;
  
  const oldIndex = state.data.previousSpqrTree.findIndex(c => c.id === oldCompId);
  if (oldIndex === -1) return;
  
  const existingGroup = d3.select(`#spqr-component-${oldIndex}`);
  if (!existingGroup.empty()) {
    // Get current position
    const transform = existingGroup.attr("transform");
    const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
    const currentX = match ? parseFloat(match[1]) : 0;
    const currentY = match ? parseFloat(match[2]) : 0;
    
    // Clear existing content but keep position
    existingGroup.selectAll("*").remove();
    existingGroup.attr("id", `spqr-component-${newIndex}`);
    
    // Redraw component with new data
    drawSPQRComponentAsPictogram(existingGroup, comp);
    
    // Update stored data
    existingGroup.datum({
      x: currentX,
      y: currentY,
      index: newIndex,
      component: comp,
      treeLevel: comp.treeLevel
    });
    
    // Re-add drag behavior
    SPQRComponentDragAndClickBehaivour(existingGroup, comp, newIndex);
    
    console.log(`🔄 Updated changed component: ${oldCompId} → ${comp.id} at (${currentX}, ${currentY})`);
  }
}

/**
 * Enhanced createNewComponent function that considers tree hierarchy
 */
function createNewComponent(comp, newIndex) {
  console.log(`🆕 Creating new component: ${comp.id}`);
  console.log("  New component data:", comp, newIndex);

  var parentNode;
  if (comp.neighbors.length == 1) {
    parentNode = comp.neighbors[0];
  } else if (comp.neighbors.length > 1) {
    // Find the parent node with the highest degree
    parentNode = comp.neighbors.reduce((max, curr) => {
      const currLevel = state.data.spqrTree.find(c => c.id === curr).treeLevel;
      const maxLevel = state.data.spqrTree.find(c => c.id === max).treeLevel;
      return currLevel > maxLevel ? curr : max;
    });
  }
  console.log("  Parent node for new component:", parentNode);  

}
/**
 * Add visual highlighting to show what changed
 */
function highlightTreeChanges(treeComparison) {
  console.log("🎨 Highlighting tree changes...");
  
  // Add glow effect for changed components
  state.data.changedComponents.forEach(compId => {
    const compIndex = state.data.spqrTree.findIndex(c => c.id === compId);
    if (compIndex !== -1) {
      const group = d3.select(`#spqr-component-${compIndex}`);
      
      // Add a temporary glow effect
      group.select("rect")
        .style("filter", "drop-shadow(0 0 8px orange)")
        .transition()
        .duration(3000)
        .style("filter", null);
    }
  });
  
  // Add glow effect for new components
  state.data.newComponents.forEach(compId => {
    const compIndex = state.data.spqrTree.findIndex(c => c.id === compId);
    if (compIndex !== -1) {
      const group = d3.select(`#spqr-component-${compIndex}`);
      
      // Add a temporary glow effect
      group.select("rect")
        .style("filter", "drop-shadow(0 0 8px green)")
        .transition()
        .duration(3000)
        .style("filter", null);
    }
  });
  
  // Subtle highlight for unchanged components
  state.data.unchangedComponents.forEach(compId => {
    const compIndex = state.data.spqrTree.findIndex(c => c.id === compId);
    if (compIndex !== -1) {
      const group = d3.select(`#spqr-component-${compIndex}`);
      
      // Very subtle highlight
      group.select("rect")
        .style("stroke-width", "3px")
        .style("stroke", "#28a745")
        .transition()
        .duration(2000)
        .style("stroke-width", "1px")
        .style("stroke", "black");
    }
  });
}

/**
 * Animate component transitions for better visual feedback
 */
function animateComponentTransition(group, fromPos, toPos, duration = 500) {
  group
    .transition()
    .duration(duration)
    .ease(d3.easeQuadInOut)
    .attr("transform", `translate(${toPos.x}, ${toPos.y})`)
    .on("end", () => {
      // Update stored position after animation
      group.datum().x = toPos.x;
      group.datum().y = toPos.y;
    });
}

/**
 * Batch update virtual edges efficiently during transitions
 */
let virtualEdgeUpdateTimer = null;

function scheduleVirtualEdgeUpdate() {
  if (virtualEdgeUpdateTimer) {
    clearTimeout(virtualEdgeUpdateTimer);
  }
  
  virtualEdgeUpdateTimer = setTimeout(() => {
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    virtualEdgeUpdateTimer = null;
  }, 50); // Throttle updates to every 50ms
}

/**
 * Enhanced logging for debugging tree comparisons
 */
function logTreeComparison(oldTree, newTree, comparison) {
  console.group("🔍 SPQR Tree Comparison Details");
  
  console.log("📊 Old Tree Structure:");
  oldTree.forEach((comp, i) => {
    console.log(`  ${i}: ${comp.id}(${comp.type}) - nodes: [${Array.from(comp.graph.keys()).join(', ')}]`);
  });
  
  console.log("📊 New Tree Structure:");
  newTree.forEach((comp, i) => {
    console.log(`  ${i}: ${comp.id}(${comp.type}) - nodes: [${Array.from(comp.graph.keys()).join(', ')}]`);
  });
  
  console.log("🔗 Component Mappings:");
  comparison.mapping.forEach((newId, oldId) => {
    const status = comparison.unchanged.has(newId) ? "UNCHANGED" :
                   comparison.changed.has(newId) ? "CHANGED" : "UNKNOWN";
    console.log(`  ${oldId} → ${newId} (${status})`);
  });
  
  console.log("📈 Summary:");
  console.log(`  ✅ Unchanged: ${comparison.unchanged.size}`);
  console.log(`  🔄 Changed: ${comparison.changed.size}`);
  console.log(`  🆕 New: ${comparison.newComponents.size}`);
  console.log(`  🗑️ Removed: ${comparison.removed.size}`);
  
  console.groupEnd();
}

/**
 * Memory cleanup for removed components
 */
function cleanupRemovedComponents(removedComponentIds) {
  removedComponentIds.forEach(compId => {
    // Remove from any cached references
    if (state.data.virtualEdgeData) {
      for (const [edgeId, edgeData] of state.data.virtualEdgeData.entries()) {
        edgeData.components = edgeData.components.filter(id => id !== compId);
        if (edgeData.components.length === 0) {
          state.data.virtualEdgeData.delete(edgeId);
        }
      }
    }
    
    // Clean up virtual twin edge links
    state.data.allVirtualTwinEdgeLinks = state.data.allVirtualTwinEdgeLinks.filter(
      link => link.compAID !== compId && link.compBID !== compId
    );
  });
}