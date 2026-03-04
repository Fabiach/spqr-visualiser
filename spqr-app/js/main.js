import {verticesDB, edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia, verticesKindermann, edgesKindermann, factorials, verticesTutorialP, edgesTutorialP, edgesTutorialR, edgesTutorialS, verticesTutorialR, verticesTutorialS, fixedPositionsWikipedia, fixedPositionsDiBattista, fixedPositionsTutorialS, fixedPositionsTutorialR, fixedPositionsTutorialP} from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree} from './spqr.js';
import {clearGraph, createGraph, createPresetGraph} from './graph.js';
import Tutorial from './tutorial.js';
import {isPlanarAndEmbed, validateEmbedding} from './planarity.js';
import {tutteEmbedding, extractFaces, findLargestFace, scaleToBox} from './tutte.js';
import {computeGraphDrawing} from './spqrDrawing.js';

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
    graphEdges: null, //edges of the input graph
    graphNodes: null, //nodes of the input graph
    graphLinks: null, //links of the input graph
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
    pendingHighlightCompId: null  // For reapplying highlighting after mode switch
  },
  ui_state: {
    drawMode: false,
    edgeStart: null,
    deleteMode: false,
    currentTool: null, // Track current tool
    spqrDrawingMode: 'fancy' // Track SPQR drawing mode: 'fancy' or 'simple'
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
  resetInputBtn: document.getElementById('reset-input'),
  tutorialBtn: document.getElementById('tutorial-btn'),
  tutorialBtn: document.getElementById('tutorial-btn'),
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

// Track zoom behaviors so we can apply transforms programmatically without fighting user interactions
const zoomBehaviors = { spqr: null, input: null };

// Initialize zoom container - single initialization
let SPQRZoomContainer = initializeZoomContainer("spqr");
let InputZoomContainer = initializeZoomContainer("input");

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
  state.data.inputGraphIsNotBiconnected = false;
  state.data.articulationPoints.clear();  // Clear articulation points
  
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
      if(presetType!=null) {
      createSPQRVisualization();
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

// Event listeners - consolidated
function setupEventListeners() {
  elements.form.addEventListener('submit', handleFormSubmit);
  elements.spqrBtn.onclick = function() {

    var biconnected = isBiconnected(state.data.graphEdges);
    const statusBox = d3.select("#biconnected-status");

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
  
  // Wire up SPQR visualization mode buttons
  const simpleBtn = document.getElementById('simple-unordered-mode');
  const fancyBtn = document.getElementById('fancy-ordered-mode');
  
  simpleBtn.onclick = function() {
    simpleBtn.classList.add('active-tool');
    fancyBtn.classList.remove('active-tool');
    state.ui_state.spqrDrawingMode = 'simple';
    console.log("Switched to simple SPQR mode");
    // Redraw with simple mode if SPQR tree exists
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
            state.d3selections.nodeSPQR
              .style("fill", node => {
                const nodeComp = state.data.spqrTree.find(c => c.id === node.id);
                return nodeComp && nodeComp.isSelected ? "orange" : "steelblue";
              });
          }
        });
      }
    }
  };
  
  fancyBtn.onclick = function() {
    fancyBtn.classList.add('active-tool');
    simpleBtn.classList.remove('active-tool');
    state.ui_state.spqrDrawingMode = 'fancy';
    console.log("Switched to fancy SPQR mode");
    // Redraw with fancy mode if SPQR tree exists
    if (state.data.spqrTree && state.data.spqrTree.length > 0) {
      const selectedCompId = state.data.spqrTree.find(c => c.isSelected)?.id;
      // Store a flag to reapply highlighting after rendering completes
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
          }
        });
      }
    }
  };
  
  // Set fancy mode as default
  fancyBtn.classList.add('active-tool');
  state.ui_state.spqrDrawingMode = 'fancy';

  // Wire up "Draw from SPQR" button
  const drawFromSPQRBtn = document.getElementById('draw-from-spqr-btn');
  if (drawFromSPQRBtn) {
    drawFromSPQRBtn.onclick = function() {
      if (!state.data.spqrTree || state.data.spqrTree.length === 0) {
        console.warn("No SPQR tree available — calculate one first.");
        return;
      }
      if (!state.data.spqrRoot) {
        console.warn("No SPQR root — calculate SPQR tree first.");
        return;
      }
      drawInputGraphFromSPQR();
    };
  }
}

function resetStats() {
  
  document.getElementById('r-count').textContent = "-";
  document.getElementById('s-count').textContent = "-";
  document.getElementById('p-count').textContent = "-";
  document.getElementById('q-count').textContent = "-";
  document.getElementById('embedding-count').textContent = "-";
}

// Initialize
setupEventListeners();

// Initialize Tutorial System
function initializeTutorial() {
  const tutorialCallbacks = {
    clearGraph: () => {
      clearGraph(elements.svgInput);
      clearGraph(elements.svgSPQR);
      resetStats();
    },
    loadGraph: (graphData) => {
      console.log("Tutorial: Loading custom graph", graphData);
      const { vertices, edges } = graphData;
      
      // Force stop any running simulations
      if (state.simulation.input) {
        state.simulation.input.stop();
      }
      if (state.simulation.spqr) {
        state.simulation.spqr.stop();
      }
      
      // Reset state
      resetState();
      state.data.isPreset = false;
      
      // Clear both graphs
      clearBothGraphs();
      
      // Draw the graph using the same approach as example graphs
      const freshVertices = vertices.map(v => typeof v === "object" ? {...v} : v);
      const freshEdges = edges.map(e => [...e]);
      
      drawInputGraph(freshVertices, freshEdges, null);
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
    }
  };
  
  tutorial = new Tutorial(state, elements, tutorialCallbacks);
  
  // Add tutorial button event listener
  if (elements.tutorialBtn) {
    elements.tutorialBtn.onclick = () => {
      tutorial.start();
    };
  }
}

// Call tutorial initialization
initializeTutorial();


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
      return !event.target.closest(classMap[canvas]);
    })
    .on("zoom", (event) => {
      container.attr("transform", event.transform);
    });

  chosenSVG.call(zoom);
  // Store zoom behavior for programmatic transforms
  if (canvas === "spqr") {
    zoomBehaviors.spqr = zoom;
  } else if (canvas === "input") {
    zoomBehaviors.input = zoom;
  }
  
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
  
  // Helper to calculate edge endpoints at node radius
  function getEdgeEndpoints(source, target, nodeRadius = 10) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
    
    const ratio = nodeRadius / dist;
    return {
      x1: source.x + dx * ratio,
      y1: source.y + dy * ratio,
      x2: target.x - dx * ratio,
      y2: target.y - dy * ratio
    };
  }
  
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
  
  const visibleLinkEnter = visibleLinkSel.enter()
    .append("line")
    .attr("class", "edge-visible")
    .attr("stroke-opacity", 0.6)
    .attr("stroke", "#999")
    .attr("stroke-width", 2)
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
    .attr("stroke-width", 15)
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
    .selectAll("circle")
    .data(state.data.graphNodes, d => d.id);


  nodeSel.exit().remove();

  const nodeEnter = nodeSel.enter()
    .append("circle")
    .attr("r", 10)
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

  state.d3selections.nodeInput = nodeSel.merge(nodeEnter);

  // === LABELS === (Create labels LAST so they're always on top)
  const labelSel = InputZoomContainer
    .selectAll("text")
    .data(state.data.graphNodes, d => d.id);


  labelSel.exit().remove();

  const labelEnter = labelSel.enter()
    .append("text")
    .attr("x", 12)
    .attr("y", ".31em")
    .text(d => d.id);

  state.d3selections.labelInput = labelSel.merge(labelEnter);

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
      
      // Update edge positions (both hit areas and visible edges) with radius-aware endpoints
      const computeEndpoints = edge => {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ratio = 10 / dist; // node radius = 10
        return {
          x1: edge.source.x + dx * ratio,
          y1: edge.source.y + dy * ratio,
          x2: edge.target.x - dx * ratio,
          y2: edge.target.y - dy * ratio
        };
      };

      state.d3selections.linkInput.each(function(edge) {
        const e = computeEndpoints(edge);
        d3.select(this)
          .attr("x1", e.x1)
          .attr("y1", e.y1)
          .attr("x2", e.x2)
          .attr("y2", e.y2);
      });

      if (state.d3selections.linkInputVisible) {
        state.d3selections.linkInputVisible.each(function(edge) {
          const e = computeEndpoints(edge);
          d3.select(this)
            .attr("x1", e.x1)
            .attr("y1", e.y1)
            .attr("x2", e.x2)
            .attr("y2", e.y2);
        });
      }

      // Update virtual edges connected to this dragged node (dashed edges)
      // These can be either .edge-visible or .temporary-edge elements
      const draggedNodeId = String(d.id);
      const allEdges = InputZoomContainer.selectAll("line").filter(function() {
        const isDashed = d3.select(this).attr("stroke-dasharray") === "5,5";
        return isDashed;
      });
      
      // Find edges connected to this node
      const connectedDashedEdges = allEdges.filter(function(edge) {
        const srcId = String(typeof edge.source === "object" ? edge.source.id : edge.source);
        const tgtId = String(typeof edge.target === "object" ? edge.target.id : edge.target);
        return srcId === draggedNodeId || tgtId === draggedNodeId;
      });
      
      console.log(`DRAG node ${d.id}: Found ${connectedDashedEdges.size()} connected dashed virtual edges to update`);
      
      connectedDashedEdges.each(function(edge) {
        const e = computeEndpoints(edge);
        const srcId = typeof edge.source === "object" ? edge.source.id : edge.source;
        const tgtId = typeof edge.target === "object" ? edge.target.id : edge.target;
        console.log(`  -> Updating virtual edge [${srcId}, ${tgtId}]`);
        d3.select(this)
          .attr("x1", e.x1)
          .attr("y1", e.y1)
          .attr("x2", e.x2)
          .attr("y2", e.y2);
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

     InputZoomContainer = initializeZoomContainer("input");

    const result = createPresetGraph(
      InputZoomContainer, 
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
 * Draw the input graph using positions computed from the SPQR decomposition.
 * This replaces the force-directed layout with a composed embedding that
 * respects the tree structure: R → Tutte, S → ellipse, P → lanes.
 */
function drawInputGraphFromSPQR() {
  console.log("🎨 Drawing input graph from SPQR tree...");

  const root = state.data.spqrRoot;
  const tree = state.data.spqrTree;
  const vedData = state.data.virtualEdgeData;
  const canvasW = state.ui.canvasWidth;
  const canvasH = state.ui.canvasHeight;

  try {
    const { positions, edges, tree: composedTree } = computeGraphDrawing(
      root, tree, vedData, canvasW, canvasH
    );

    console.log(`✅ Computed positions for ${positions.size} vertices, ${edges.length} edges`);

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

      // Update visual positions — nodes
      state.d3selections.nodeInput
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      // Update visual positions — edges (both hit-area and visible)
      // Uses the same edge-endpoint-at-node-radius pattern as refreshInputGraphSmooth
      function getEdgeEndpointsSPQR(source, target, nodeRadius = 10) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
        const ratio = nodeRadius / dist;
        return {
          x1: source.x + dx * ratio,
          y1: source.y + dy * ratio,
          x2: target.x - dx * ratio,
          y2: target.y - dy * ratio
        };
      }

      // Update hit-area links
      state.d3selections.linkInput.each(function(d) {
        const ep = getEdgeEndpointsSPQR(d.source, d.target);
        d3.select(this)
          .attr("x1", ep.x1).attr("y1", ep.y1)
          .attr("x2", ep.x2).attr("y2", ep.y2);
      });

      // Update visible links
      if (state.d3selections.linkInputVisible) {
        state.d3selections.linkInputVisible.each(function(d) {
          const ep = getEdgeEndpointsSPQR(d.source, d.target);
          d3.select(this)
            .attr("x1", ep.x1).attr("y1", ep.y1)
            .attr("x2", ep.x2).attr("y2", ep.y2);
        });
      }

      // Update labels
      state.d3selections.labelInput
        .attr("x", d => d.x + 12)
        .attr("y", d => d.y + 4);

      // Update stored positions
      storeInputNodePositions();

      // Zoom to fit the input graph
      zoomToFitInputGraphFromPositions(positions);

      console.log("✅ Input graph redrawn from SPQR tree");
    } else {
      console.warn("No input graph selections available to update.");
    }
  } catch (error) {
    console.error("Error drawing graph from SPQR:", error);
  }
}


/**
 * Modified createSPQRVisualization to support smart redraw
 */
function createSPQRVisualization() {
  console.log("Creating SPQR visualization...");
  
  // Reset per-component drag tracking when creating new SPQR visualization
  state.data.componentDefaultPositions.clear();
  state.data.draggedComponents.clear();
  
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

  // Update embedding count
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
    createSPQRVisualizationFancy(nodesSPQR, linksSPQR);
  }
  
  // Store this tree for future comparisons
  state.data.previousSpqrTree = structuredClone(state.data.spqrTree);
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
function createSPQRVisualizationFancy(nodesSPQR, linksSPQR) {
  console.log("Creating fancy SPQR visualization with component drawings");
  
  const result = createGraph(SPQRZoomContainer, nodesSPQR, linksSPQR);
  state.simulation.spqr = result.simulation;
  state.d3selections.nodeSPQR = result.nodeSel;
  state.d3selections.linkSPQR = result.linkSel;
  state.d3selections.labelSPQR = result.labelSel;

  calculateAndStoreComponentCentroids();

  setupCrossGraphHoverEvents();
  storeInputNodePositions();
  drawAllSPQRComponents();
  drawSPQRTreeReingoldTilford();
  // DISABLED: drawSPQRVirtualEdgesBetweenComponents() - this is replaced by updateInterComponentVirtualEdges() in drawTreeWithLayout()
}

function setupCrossGraphHoverEvents() {
  state.d3selections.nodeInput
    .on("mouseover", (e, d) => handleMouseOverInput(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutInput(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));

  state.d3selections.nodeSPQR
    .on("mouseover", (e, d) => handleMouseOverSPQR(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR))
    .on("mouseout", (e, d) => handleMouseOutSPQR(e, d, state.d3selections.nodeInput, state.d3selections.nodeSPQR));
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
  resetState();
  clearBothGraphs();
  resetStats();
  // Clear form fields
  const verticesInput = document.getElementById('vertices');
  const edgesInput = document.getElementById('edges');
  if (verticesInput) verticesInput.value = "";
  if (edgesInput) edgesInput.value = "";
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
  let edgeSelectionLeniency = 6; // Distance threshold for edge selection
  
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
    
    refreshInputGraph();
    
    restoreZoomState("input", zoomState);
    return;
  }

    if (!state.ui_state.edgeStart) {
      // Start edge drawing
      state.ui_state.edgeStart = clickedNodeId;
      highlight(state.d3selections.nodeInput, clickedNodeId);
      console.log("Starting edge from:", clickedNodeId);
      InputZoomContainer.selectAll("circle")
        .style("fill", d => d.id === clickedNodeId ? "orange" : "steelblue");
    } else if (state.ui_state.edgeStart !== clickedNodeId) {
      // Complete edge - add to both data structures
      const zoomState = saveZoomState("input"); // Save zoom before refresh
      
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
  }).style("fill", "steelblue").style("stroke", "#fff").style("stroke-width", "1.5px").attr("r", 10);
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
    // Note: orientComponents() will be called later when the force simulation ends,
    // so we skip calling it here to avoid redundant redraws
    
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
// Calculate bounds of all components
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

SPQRZoomContainer.selectAll("g.spqr-components").each(function () {
  const transform = d3.select(this).attr("transform");
  const match = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  if (!match) return;

  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  const bbox = this.getBBox();

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

    let pointA, pointB;

    // Decide connection strategy based on whether components have been manually dragged
    // If neither component has been dragged, default to vertical (top/bottom) connections
    // If at least one has been dragged, use horizontal (left/right) only if horizontal separation dominates
    const anyDragged = state.data.draggedComponents.has(compAID) || state.data.draggedComponents.has(compBID);
    const useHorizontal = anyDragged && deltaX > deltaY;

    if (!useHorizontal) {
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
    } else {
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
      SPQRZoomContainer.append("line")
        .attr("x1", pointA.x)
        .attr("y1", pointA.y)
        .attr("x2", pointB.x)
        .attr("y2", pointB.y)
        .attr("stroke", "orange")
        .attr("stroke-width", 1.3)
        .attr("class", "inter-component-virtual-edge")
        .style("cursor", "pointer")
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


function drawRComponentAsSubgraph(group, comp) {
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

  // ── Try Tutte embedding (for planar subgraphs) ──────────────
  const nodeMap = computeRComponentPositions(comp);

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
    .attr("stroke", "red")
    .attr("stroke-width", 1.5)
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
        const outerFace = selectOuterFace(faces, comp, parentVirtualEdge);

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
      .attr("class", "spqr-components")
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
    const otherComp = comps.find(c => c !== comp.id);
    if (!otherComp) return false;

    const otherComponent = state.data.spqrTree.find(c => c.id === otherComp);
    const currentComponent = state.data.spqrTree.find(c => c.id === comp.id);
    
    return otherComponent && currentComponent && 
          otherComponent.treeLevel < currentComponent.treeLevel;
  })?.virtualEdgeId;



  // Sort virtual links based on connected component centroids
  virtualLinks.sort((a, b) => {
    const compAId = state.data.virtualEdgeData.get(a.virtualEdgeId)?.components.find(id => id !== comp.id);
    const compBId = state.data.virtualEdgeData.get(b.virtualEdgeId)?.components.find(id => id !== comp.id);

    if (!compAId || !compBId) return 0;

    const centroidA = state.data.componentCentroids.get(compAId);
    const centroidB = state.data.componentCentroids.get(compBId);

    if (!centroidA || !centroidB) return 0;

    return useHorizontal ? centroidA.y - centroidB.y : centroidA.x - centroidB.x;
  });

  // 🆕 CAPTURE THE VISUAL ORDER HERE
  // Store the visual order after sorting but before drawing
  comp.visualVirtualEdgeOrder = virtualLinks.map((vl, visualIdx) => {
    let curveOffset = 0;
    const hasRealEdges = links.length > 1;

    if (vl.virtualEdgeId === parentVirtualEdgeId && !hasRealEdges) {
      curveOffset = 0; // Parent edge in the middle
    } else {
      const pathOffset = 30;
      const filteredIdx = (visualIdx > 0 && vl.virtualEdgeId !== parentVirtualEdgeId) 
        ? visualIdx 
        : visualIdx;
      curveOffset = pathOffset * (Math.pow(-1, filteredIdx)) * Math.ceil((filteredIdx + 1) / 2);
    }

    return {
      visualPosition: visualIdx,
      nodes: [vl.source, vl.target],
      virtualEdgeId: vl.virtualEdgeId,
      description: `[${vl.source},${vl.target}]`,
      curveOffset: curveOffset,
      isParentEdge: vl.virtualEdgeId === parentVirtualEdgeId,
      orientation: useHorizontal ? 'horizontal' : 'vertical'
    };
  });


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
        curveOffset = 0;
      } else {
        const filteredIdx = (idx > 0 && d.virtualEdgeId !== parentVirtualEdgeId)
          ? idx
          : idx;
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
  
  // Get ordered nodes and position them in a circle
  let ordered = getOrderedNodes(comp);
  
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
    return drawOrientedSComponent(group, comp, 0); // Initial orientation
  } else if (comp.type === "P") {
    return drawOrientedPComponent(group, comp, false); // Initial horizontal orientation
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
  
  // Check if this edge belongs to any selected component and is virtual
  const componentsWithEdge = state.data.spqrTree.filter(comp => {
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
  const componentsWithEdge = state.data.spqrTree.filter(comp => {
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
      
      // Also highlight the connected nodes
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
              .attr("r", 8)
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
            // Reset to default appearance
            d3.select(this)
              .attr("stroke", isVirtual ? "red" : spqrComponentPictureEdgeColor)
              .attr("stroke-width", isVirtual ? spqrComponentPictureVirtualStrokeWidth : spqrComponentPictureNormalStrokeWidth)
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
              // Reset to default appearance
              d3.select(this)
                .attr("fill", "#3498db")
                .attr("stroke", null)
                .attr("stroke-width", null)
                .attr("r", 6);
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
            .attr("r", 8 + hits) // Make it slightly larger
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
                .attr("r", 8);
            } else {
              // Reset to default appearance
              d3.select(this)
                .attr("fill", "#3498db") // Default node color
                .attr("stroke", null)
                .attr("stroke-width", null)
                .attr("r", 6); // Default radius
            }
          } else {
            // Reduce size but keep highlighted
            d3.select(this)
              .attr("r", 6 + hits);
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
            
            // Reset to default appearance
            d3.select(this)
              .attr("stroke", isVirtual ? "red" : spqrComponentPictureEdgeColor)
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
        .attr("r", 14)
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
        d3.select(this).style("fill", "steelblue").style("stroke", "#fff").style("stroke-width", "1.5px").attr("r", 10);
      } else {
        console.log(`[unhighlight] applying restored color, ${id} to ${restoredColor}`);
        d3.select(this).style("fill", restoredColor).style("stroke", "#fff").style("stroke-width", "1.5px").attr("r", 10);
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
}

function highlightComponent(nodeSel, linkSel, compId, color = "orange", fromP = false, highlightLevel = 0, suppressVirtualEdgeHover = false) {
  // Always use fresh selections so newly drawn nodes/edges participate in highlighting
  nodeSel = InputZoomContainer.selectAll("circle");
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
        .attr("r", 10)
        .attr("stroke", color)
        .attr("stroke-width", 4)
        .attr("stroke-opacity", opacity)
        .attr("r", 10 + 2 * 1)
        .raise();
    });
}
function highlightEdgeWithOpacity(linkSel, srcId, tgtId, color = "purple", dashed = false, opacity = 1.0, attachedComponentId = null) {
  const existingEdge = linkSel.filter(d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      ((sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId)) &&
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
        ((sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId)) &&
        !d.temporary
      );
    });
    
    if (visibleEdge.size() > 0) {
      visibleEdge
        .attr("stroke", color)
        .attr("stroke-opacity", opacity)
        .attr("stroke-width", 3)
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
          // Highlight this virtual edge in all SPQR component pictograms that contain it
          highlightEdgeInSPQRDrawing(srcId, tgtId, "purple", true);
          d3.select(this).attr("stroke-width", 5).attr("opacity", 1.0);
        })
        .on("mouseout", function() {
          console.log(`[virtual-edge hover] Left virtual edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
          // Unhighlight the virtual edge in SPQR pictograms
          unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
          d3.select(this).attr("stroke-width", 3).attr("stroke-opacity", opacity);
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
            d3.select(this).attr("stroke-width", 5).attr("opacity", 1.0);
          })
          .on("mouseout", function() {
            console.log(`[virtual-edge hover] Left virtual temp edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
            unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
            d3.select(this).attr("stroke-width", 3).attr("stroke-opacity", opacity);
          });
      }
    } else {
      // Create temporary edge with opacity (rest of the logic from highlightEdge)
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
              d3.select(this).attr("stroke-width", 5).attr("opacity", 1.0);
            })
            .on("mouseout", function() {
              console.log(`[virtual-edge hover] Left virtual new edge [${srcId}, ${tgtId}] - unhighlighting in pictograms`);
              unhighlightEdgeInSPQRDrawing(srcId, tgtId, "purple");
              d3.select(this).attr("stroke-width", 3).attr("stroke-opacity", opacity);
            });
        }
      }
    }
  }
}
function unhighlightComponent(nodeSel, linkSel, compId, color = "orange", fromP = false, highlightLevel = 0, forceFullUnhighlight = false) {
  // Always use fresh selections so newly drawn nodes/edges are correctly unhighlighted
  nodeSel = InputZoomContainer.selectAll("circle");
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
  // Unhighlight hit areas
  linkSel
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    )
    .attr("stroke", "transparent")
    .attr("stroke-opacity", 1)
    .attr("stroke-width", 15)
    .attr("stroke-dasharray", null);
  
  // Unhighlight visible edges
  InputZoomContainer.selectAll(".edge-visible")
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    )
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
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

/** Highlight a SPQR component bounding box in the SPQR drawing
 * @param {string} compId - The ID of the SPQR component
 * @param {string} color - The highlight color
 */

function highlightSPQRNode(compId, color = "orange", nodes = true) {
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
    
    // Draw inter-component virtual edges after all components are positioned
    updateInterComponentVirtualEdges(state.data.allVirtualTwinEdgeLinks);
    
    // Store the group array in case you need it later (like for force simulation updates)
    return groupArray;
}

/**
 * Check if a given undirected graph is biconnected.
 * @param {Object<string, string[]>} graph - adjacency list representation (e.g., { "1": ["2","3"], "2": ["1","3"], "3": ["1","2"] })
 * @returns {boolean} true if the graph is biconnected, false otherwise
 */
function isBiconnected(edges) {
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