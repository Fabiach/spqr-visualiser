import {verticesDB, edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia, verticesKindermann, edgesKindermann} from './data.js';
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
    graphEdges: null,
    graphNodes: null,
    graphLinks: null,
    virtualEdgeData: new Map(),
    allVirtualTwinEdgeLinks: [],
    inputNodePositions: new Map(),
    inputNew: true,
    isPreset: false,
  },
  ui: {
    colors: ["green", "red", "blue", "yellow", "orange", "purple"],
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
  state.data.graphEdges = [];
  state.data.graphNodes = [];
  state.data.graphLinks = [];
  state.data.virtualEdgeData.clear();
  state.data.allVirtualTwinEdgeLinks = [];
  state.data.inputNodePositions.clear();
  state.data.inputNew = true;
  state.data.isPreset = false;
  
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
  
  // Reset draw mode button text
  
  console.log("State reset complete");
}

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

// Initialize zoom container - single initialization
let SPQRZoomContainer = initializeZoomContainer("spqr");




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


//TODO
//  inspired by https://csacademy.com/app/graph_editor/
//
// Add functionality to add vertices and edges

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
  unhighlight(state.d3selections.nodeInput, state.ui_state.edgeStart);
  state.ui_state.edgeStart = null;
}

function addNewNode(x, y) {
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
    false // Don't run simulation for positioning
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

function setupInputEventHandlers() {
  // Remove any existing event handlers first
  state.d3selections.nodeInput
    .on("mouseover", null)
    .on("mouseout", null)
    .on(".drag", null);

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
      // Update stored positions during drag
      state.data.inputNodePositions.set(d.id, { x: event.x, y: event.y });
    })
    .on("end", function(event, d) {
      if (!event.active && state.simulation.input) {
        state.simulation.input.alphaTarget(0);
      }
      // Keep position fixed after drag in draw mode
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

function createSPQRVisualization() {
  console.log("Creating SPQR visualization...");
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
  SPQRZoomContainer = initializeZoomContainer("spqr");

  // Create force simulation for SPQR tree
  const result = createGraph(SPQRZoomContainer, nodesSPQR, linksSPQR);
  state.simulation.spqr = result.simulation;
  state.d3selections.nodeSPQR = result.nodeSel;
  state.d3selections.linkSPQR = result.linkSel;
  state.d3selections.labelSPQR = result.labelSel;

  // Set up cross-hover events
  setupCrossGraphHoverEvents();


  //TODO alternative drawing method: 
  //spqr tree as rooted tree, with root = p component with lowest depth, then most neighbors as tiebreaker

  
  // Store input node positions
  storeInputNodePositions();

  // Draw SPQR components
  drawAllSPQRComponents();
  drawSPQRTreeReingoldTilford();
  
  // Draw virtual edges between components
  drawSPQRVirtualEdgesBetweenComponents();
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
function drawSPQRTreeReingoldTilford() {
  
    if (!state.data.spqrTree || state.data.spqrTree.length === 0) {
        console.warn("❌ No SPQR tree data available");
        return;
    }
    
    // Find optimal root
    const root = findOptimalRoot(state.data.spqrTree);
    
    if (!root) {
        console.error("❌ No root found, cannot draw tree");
        return;
    }
    
    // Get canvas dimensions
    const svgRect = elements.svgSPQR.node().getBoundingClientRect();
    
    // Build tree structure
    const tree = buildTreeStructure(root, state.data.spqrTree);
    
    // Apply Reingold-Tilford algorithm
    const layout = reingoldTilfordLayout(tree);
    
    // Scale and center the layout
   // const scaledLayout = scaleAndCenterLayout(layout, svgRect.width, svgRect.height);
    
    // Draw the tree using existing functions
    const groupArray = drawTreeWithLayout(layout, state.data.spqrTree);
    
    
    // Return the group array in case you want to add interactions later
    return groupArray;
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
        adjacency[component.id] = component.neighbors || [];
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

      if(centerChoiceLeft.neighbors.length > centerChoiceRight.neighbors.length) {
        return centerChoiceLeft;
      } else if(centerChoiceLeft.neighbors.length < centerChoiceRight.neighbors.length) {
        return centerChoiceRight;
      }
      else {
        if (centerChoiceLeft.type === 'P') return centerChoiceLeft;
        if (centerChoiceRight.type === 'P') return centerChoiceRight;
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


// Simple drag behavior - focused on individual component movement
function addDragBehavior(group, comp, componentIndex) {
  let dragStartX, dragStartY;
  
  const dragBehavior = d3.drag()
    .on("start", function(event) {

      
      // Prevent zoom behavior
      event.sourceEvent.preventDefault();
      event.sourceEvent.stopPropagation();
      
      // Get current position
      const transform = d3.select(this).attr("transform");
      const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
      dragStartX = match ? parseFloat(match[1]) : 0;
      dragStartY = match ? parseFloat(match[2]) : 0;
      

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
      
      // Reset visual feedback
      d3.select(this)
        .style("cursor", "grab")
        .style("opacity", 1);
      orientComponents();
      
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
  
}


function handleFormSubmit(e) {
  resetState()
  e.preventDefault();
  const { vertices, edges } = parseInput();
  
  console.log('vertices:', vertices);
  console.log('edges   :', edges);
  
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

// Updated drawing functions to use state.data instead of global variables

function drawSPQRVirtualEdgesBetweenComponents() {


  for (const [key, { components, nodes }] of state.data.virtualEdgeData.entries()) {
   
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


function drawRComponent(group, comp) {
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
  
  // Redraw with best rotation (convert degree to radians for targetAngle)
  group.selectAll("*").remove();
  drawOrientedSComponent(
    group,
    comp,
    (bestRotation * Math.PI / 180 ), false
  );
}

function drawOrientedSComponent(group, comp, targetAngle = 0, rotate = true) {
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
  if(!rotate) {
  addComponentBoundingElements(group, nodeMap, comp.id);
}
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
    .attr("x", boundingRect.x)
    .attr("y", boundingRect.y)
    .attr("width", boundingRect.width)
    .attr("height", boundingRect.height)
    .attr("stroke", "black")
    .attr("fill",colorString)
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
        adjacency[comp.id] = comp.neighbors || [];
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
            console.log(`      Processing node ${current.id} with neighbors:`, neighbors);
            
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
                }
            }
        }
        level++;
    }
    
    console.log("  ✅ Tree structure complete. Total nodes:", Object.keys(treeNodes).length);
    console.log("  Tree hierarchy:");
    logTreeHierarchy(rootNode, 0);
    
    return { root: rootNode, nodes: treeNodes };
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
            addDragBehavior(currentGroup, comp, index);
            groupArray.push(currentGroup);
            
            // Draw the component pictogram using your existing function
            drawSPQRComponentAsPictogram(currentGroup, comp);
            
        }
    });
    
    
    // Store the group array in case you need it later (like for force simulation updates)
    return groupArray;
}