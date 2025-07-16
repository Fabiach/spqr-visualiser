import {verticesDB,edgesDB, edgesBrown, verticesBrown}     from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree}       from './spqr.js';
import {clearGraph, createGraph}            from './graph.js';

let simulationInput, nodeSelInput, linkSelInput, labelSelInput;
let simulationSPQR,  nodeSelSPQR,  linkSelSPQR,  labelSelSPQR;

const svgInput = d3.select("#input-graph");
const svgSPQR = d3.select("#spqr-graph")

var highlightedSet;
// once, right after linkSel is created
var highlightLayer;


var SPQRTREE;
let graphEdges = undefined
let graphNodes = undefined
let graphLinks = undefined
let colors = ["green", "red", "blue", "yellow", "orange", "purple"];

/*({ simulation:  simulationInput,
   nodeSel:     nodeSelInput,
   linkSel:     linkSelInput,
   labelSel:    labelSelInput } = createGraph(svgInput, graphNodes, graphLinks));

nodeSelInput
  .on("mouseover", (evt,d)=>handleMouseOverInput(evt,d, nodeSelInput, nodeSelSPQR))
  .on("mouseout",  (evt,d)=>handleMouseOutInput(evt,d,  nodeSelInput, nodeSelSPQR));*/



const form = document.getElementById('input-form');

form.addEventListener('submit', e => {
  e.preventDefault();

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

  console.log('vertices:', vertices);
  console.log('edges   :', edges);
  
  // Clear both graphs
  clearGraph(svgInput); 
  clearGraph(svgSPQR);
  
  // Set the graph data and create the input graph
  setGraph(vertices, edges);
  
  // Create SPQR graph
  document.getElementById('spqr-btn').click();
});

document.getElementById('spqr-btn').onclick = () => {
  const edgesMap = generateEdgesMap(graphEdges);
  SPQRTREE = calculateSPQRTree(edgesMap);
  console.log(SPQRTREE)

  let pCounter = 1, sCounter = 1, rCounter = 1;
  const nodesSPQR = [];

  for (const c of SPQRTREE) {
    const label =
      c.type === 'P' ? 'P' + pCounter++ :
      c.type === 'S' ? 'S' + sCounter++ :
                       'R' + rCounter++;
      c.id = label
    nodesSPQR.push({ id: label });
  }


  // 1. Build lookup …
  const idToComps = new Map();
  SPQRTREE.forEach((comp, idx) => {
    for (const [, id] of comp.virtualEdgeEntry) {
      if (!idToComps.has(id)) idToComps.set(id, []);
      idToComps.get(id).push(idx);
    }
  });

  // 2. Produce links …
  const linksSPQR = [];
  for (const arr of idToComps.values()) {
    if (arr.length < 2) continue;
    const src = nodesSPQR[arr[0]].id;
    for (let k = 1; k < arr.length; k++) {
      linksSPQR.push({ source: src, target: nodesSPQR[arr[k]].id });
    }
  }

  // ---------------------------------------------------------------------------
// 2½.  Build component‑level adjacency list
// ---------------------------------------------------------------------------
const adj = new Map();                // idx → Set of neighbour‑indices

// initialise
SPQRTREE.forEach( (_ , i) => adj.set(i, new Set()) );

// for each link we just created, add both directions
for (const { source, target } of linksSPQR) {
  const srcIdx = nodesSPQR.findIndex(n => n.id === source);
  const tgtIdx = nodesSPQR.findIndex(n => n.id === target);

  if (srcIdx !== -1 && tgtIdx !== -1) {
    adj.get(srcIdx).add(tgtIdx);
    adj.get(tgtIdx).add(srcIdx);
  }
}

// save neighbours back into each component
adj.forEach( (nbrSet, idx) => {
  SPQRTREE[idx].neighbors = Array.from(nbrSet).map(i => nodesSPQR[i].id);

});

// TODO calculate number of possible embeddings
  let pEmbeddingCount = 1;
  for (const comp of SPQRTREE) {

  }
  document.getElementById('embedding-count').textContent = Math.pow(2, rCounter);

clearGraph(svgSPQR);

  // 3. Render in the second SVG
   ({ simulation:  simulationSPQR,
     nodeSel:     nodeSelSPQR,
     linkSel:     linkSelSPQR,
     labelSel:    labelSelSPQR } = createGraph(svgSPQR, nodesSPQR, linksSPQR));

/* -- 1. attach cross‑hover from input → SPQR -- */
nodeSelInput
  .on("mouseover", (e,d)=>handleMouseOverInput(e,d, nodeSelInput, nodeSelSPQR))
  .on("mouseout",  (e,d)=>handleMouseOutInput (e,d, nodeSelInput, nodeSelSPQR));

/* -- 2. attach symmetric hover from SPQR → input -- */
nodeSelSPQR
  .on("mouseover", (e,d)=>handleMouseOverSPQR(e,d, nodeSelInput, nodeSelSPQR))
  .on("mouseout",  (e,d)=>handleMouseOutSPQR (e,d, nodeSelInput, nodeSelSPQR))

  console.log("SVG INPUT NODES", nodeSelInput)
  console.log("SVG SPQR NODES",nodeSelSPQR)
  console.log("SVG INPUT LINKS", linkSelInput)
  console.log("SVG SPQR LINKS",linkSelSPQR)
};

document.getElementById('input-form').onsubmit = e=>{
  e.preventDefault();
  // re‑implement inputToGraph using the imported helpers
};

document.getElementById('example-graph-brown').onclick = () => {
  clearGraph(svgInput); 
  clearGraph(svgSPQR);
  setGraph(verticesBrown, edgesBrown);  // Remove duplicate createGraph call
  document.getElementById('spqr-btn').click();
}

document.getElementById('example-graph-db').onclick = () => {
  clearGraph(svgInput); 
  clearGraph(svgSPQR);
  setGraph(verticesDB, edgesDB);  // Remove duplicate createGraph call
  document.getElementById('spqr-btn').click();
}

function setGraph(nodes, edges) {
  graphEdges = edges;
  graphNodes = nodes.map(v=>({id:String(v)}));
  graphLinks = edges.map(([s,t])=>({source:String(s),target:String(t)}));

  // Only create the graph once here
  ({ simulation:  simulationInput,
     nodeSel:     nodeSelInput,
     linkSel:     linkSelInput,
     labelSel:    labelSelInput } = createGraph(svgInput, graphNodes, graphLinks));
     
  nodeSelInput
    .on("mouseover", (evt,d)=>handleMouseOverInput(evt,d, nodeSelInput, nodeSelSPQR))
    .on("mouseout",  (evt,d)=>handleMouseOutInput(evt,d,  nodeSelInput, nodeSelSPQR));
}

function handleMouseOverInput(event, d, inputSel, spqrSel) {
  highlight(inputSel, d.id);

  highlight(spqrSel,  d.id);
}

function handleMouseOutInput(event, d, inputSel, spqrSel) {
  unhighlight(inputSel, d.id);
  unhighlight(spqrSel,  d.id);
}

function handleMouseOverSPQR(event, d, inputSel, spqrSel) {
  highlight(spqrSel,  d.id);
  let matchingSPQRNode = SPQRTREE.filter(c => c.id === d.id)[0]
  if (d.id.includes("P")) {
    console.log("PARALLEL NODE", d)
    let i= 0;
    let neighborCount = matchingSPQRNode.neighbors.length;
    for(const neighbor of  matchingSPQRNode.neighbors ) {
      if(neighbor.includes("S")) {
      highlightSComponent(inputSel, linkSelInput, neighbor,colors[i++ % colors.length])
      }
      if(neighbor.includes("R")) {
      highlightRComponent(inputSel, linkSelInput, neighbor,colors[i++ % colors.length])
      }
    }
  }
  if (d.id.includes("S")) {
    highlightSComponent(inputSel,linkSelInput, d.id)

  }
  if (d.id.includes("R")) {
    highlightRComponent(inputSel, linkSelInput, d.id)

  }
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
  unhighlight(spqrSel,  d.id);
  let matchingSPQRNode = SPQRTREE.filter(c => c.id === d.id)[0]
  if (d.id.includes("P")) {
    console.log("PARALLEL NODE", d)
    let i= 0;
    for(const neighbor of  matchingSPQRNode.neighbors ) {
      unhighlightSComponent(inputSel, linkSelInput, neighbor)
    }
  }
  if (d.id.includes("S")) {
    unhighlightSComponent(inputSel, linkSelInput, d.id)

  }

  if (d.id.includes("R")) {
    unhighlightRComponent(inputSel, linkSelInput, d.id)

  }
}

function highlight(selection, id, color = "orange") {
  selection
    .filter(d => d.id === id)
    .each(function () {
      const hits = (+this.getAttribute("data-hit") || 0) + 1;
      this.setAttribute("data-hit", hits);

      d3.select(this)
        .attr("fill", color)
        .attr("r", 10)
        .attr("stroke", color)          // ring colour
        .attr("stroke-width", 4)            // ring thickness
        .attr("r", 10 + 2 * 1)           // enlarge if you like
        .raise();                           // optional: bring to front
    });
}


function unhighlight(selection, id, color = "orange") {
  selection
    .filter(d => d.id === id)
    .each(function () {
      const n = (+this.getAttribute("data-hit") || 1) - 1;
      this.setAttribute("data-hit", n);

      if (n === 0) {
        // completely un‑highlighted
        d3.select(this).attr("fill", "steelblue").attr("r", 10);
      } else {
        // still highlighted by other component(s)
        d3.select(this).attr("r", 10 + 4 * n);
      }
    });
}

/** highlight a single undirected edge; add if it doesn't exist yet */
/** highlight a single undirected edge; add if it doesn't exist yet */
function highlightEdge(linkSel, srcId, tgtId, color = "purple") {
  // First, try to find existing edge
  const existingEdge = linkSel
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    );
  
  if (existingEdge.size() > 0) {
    // Edge exists, just highlight it
    existingEdge
      .attr("stroke", color)
      .attr("stroke-width", 3)
      .raise();
  } else {
    // Edge doesn't exist, create it
    // Get the nodes data from the simulation
    const svg = d3.select("svg"); // or however you reference your main SVG
    const allNodes = svg.selectAll("circle").data();
    
    const sourceNode = allNodes.find(d => d.id === srcId);
    const targetNode = allNodes.find(d => d.id === tgtId);
    
    if (sourceNode && targetNode) {
      // Create new edge data that matches D3's link format
      const newEdgeData = {
        source: sourceNode,  // D3 expects actual node objects
        target: targetNode,
        temporary: true
      };
      
      // Simply append to the same parent as linkSel
      d3.select(linkSel.node().parentNode)
        .append("line")
        .datum(newEdgeData)
        .attr("class", "temporary-edge")
        .attr("stroke", color)
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 0.8)
        .attr("x1", sourceNode.x || 0)
        .attr("y1", sourceNode.y || 0)
        .attr("x2", targetNode.x || 0)
        .attr("y2", targetNode.y || 0);
    }
  }
}

/** Remove highlighted edges, including temporary ones */
function unhighlightEdge(linkSel, srcId, tgtId) {
  // Unhighlight existing edges
  linkSel
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    )
    .attr("stroke", "#999")  // Reset to default color
    .attr("stroke-width", 2);   // Reset to default width
  
  // Remove temporary edges - need to check if linkSel has nodes first
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

/** Remove all temporary edges */
function clearTemporaryEdges(svg) {
  svg.selectAll("line.temporary-edge").remove();
}

/** Enhanced R-component highlighting with temporary edge support */
function highlightRComponent(nodeSel, linkSel, compId, color = "purple") {
  const comp = SPQRTREE.find(c => c.id === compId);
  if (!comp) return;
  
  // Store highlighted edges for cleanup
  if (!comp.highlightedEdges) {
    comp.highlightedEdges = [];
  }
  
  // Core vertices
  comp.graph.forEach((nbrs, v) => {
    highlight(nodeSel, String(v), color);
    
    // Highlight every incident edge inside this rigid component
    nbrs.forEach(w => {
      if (comp.graph.has(w)) {          // w is inside same component
        highlightEdge(linkSel, String(v), String(w), color);
        // Track this edge for cleanup
        comp.highlightedEdges.push([String(v), String(w)]);
      }
    });
  });
}

/** Unhighlight R-component */
function unhighlightRComponent(nodeSel, linkSel, compId, color = "purple") {
  const comp = SPQRTREE.find(c => c.id === compId);
  if (!comp) return;
  
  // Unhighlight vertices
  comp.graph.forEach((nbrs, v) => {
    unhighlight(nodeSel, String(v), color);
  });
  
  // Unhighlight edges
  if (comp.highlightedEdges) {
    comp.highlightedEdges.forEach(([srcId, tgtId]) => {
      unhighlightEdge(linkSel, srcId, tgtId, color);
    });
    comp.highlightedEdges = [];
  }
}




/** Enhanced S-component highlighting with temporary edge support */
function highlightSComponent(nodeSel, linkSel, compId, color = "orange") {
  console.log("SERIES NODE", compId);
  const comp = SPQRTREE.find(c => c.id === compId);
  if (!comp) return;
  
  console.log("matchingSPQRNode", comp);
  
  // Store highlighted edges for cleanup
  if (!comp.highlightedEdges) {
    comp.highlightedEdges = [];
  }
  
// Create a Set of virtual edges for fast lookup
const virtualEdges = new Set();
comp.virtualEdgeEntry.forEach(([edge, _]) => {
  const [u, v] = edge;
  // Add both directions since edges are undirected
  virtualEdges.add(`${u}-${v}`);
  virtualEdges.add(`${v}-${u}`);
});

// Core vertices
comp.graph.forEach((nbrs, v) => {
  console.log(v);
  highlight(nodeSel, String(v), color);
  
  // Highlight every incident edge inside this series component
  nbrs.forEach(w => {
    if (comp.graph.has(w)) { // w is inside same component
      // Check if this edge is NOT a virtual edge
      const edgeKey = `${v}-${w}`;
      if (!virtualEdges.has(edgeKey)) {
        highlightEdge(linkSel, String(v), String(w), color);
        // Track this edge for cleanup
        comp.highlightedEdges.push([String(v), String(w)]);
      }
    }
  });
});
}

/** Unhighlight S-component */
function unhighlightSComponent(nodeSel, linkSel, compId, color = "orange") {
  console.log("SERIES NODE", compId);
  const comp = SPQRTREE.find(c => c.id === compId);
  if (!comp) return;
  
  console.log("matchingSPQRNode", comp);
  
  // Unhighlight vertices
  comp.graph.forEach((nbrs, v) => {
    console.log(v);
    unhighlight(nodeSel, String(v), color);
  });
  
  // Unhighlight edges
  if (comp.highlightedEdges) {
    comp.highlightedEdges.forEach(([srcId, tgtId]) => {
      unhighlightEdge(linkSel, srcId, tgtId, color);
    });
    comp.highlightedEdges = [];
  }
}

 