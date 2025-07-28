import {verticesDB,edgesDB, edgesBrown, verticesBrown, verticesWikipedia, edgesWikipedia}     from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree}       from './spqr.js';
import {clearGraph, createGraph, createPresetGraph}            from './graph.js';

let simulationInput, nodeSelInput, linkSelInput, labelSelInput;
let simulationSPQR,  nodeSelSPQR,  linkSelSPQR,  labelSelSPQR;

const svgInput = d3.select("#input-graph");
const svgSPQR = d3.select("#spqr-graph")
const componentLayer = svgSPQR.append("g").attr("class", "spqr-components");

var highlightedSet;
// once, right after linkSel is created
var highlightLayer;


var SPQRTREE;
let graphEdges = undefined
let graphNodes = undefined
let graphLinks = undefined
let colors = ["green", "red", "blue", "yellow", "orange", "purple"];
let colorC = 0;

const inputNodePositions = new Map();


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

  d3.select("#input-graph").selectAll("circle").each(function(d) {
    inputNodePositions.set(d.id, { x: d.x, y: d.y });
  });

  clearGraph(svgSPQR);
  const group = svgSPQR.append("g").attr("class", "spqr-components");
  drawSPQRComponent(group, SPQRTREE[2]);


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
  setGraph(verticesDB, edgesDB, "DiBattista");  // Remove duplicate createGraph call
  document.getElementById('spqr-btn').click();
}

document.getElementById('example-graph-wikipedia').onclick = () => {
  clearGraph(svgInput); 
  clearGraph(svgSPQR);

  setGraph(verticesWikipedia, edgesWikipedia, "Wikipedia");

 document.getElementById('spqr-btn').click();
};

function drawSPQRComponent(group, comp) {
  console.log("IN DRAWSPQRCOMPONENT WITH: ", group, comp)
  const nodeObjs = Array.from(comp.graph.keys()).map(id => ({ id: String(id) }));

  const links = [];
  const virtualLinks = [];
  comp.graph.forEach((nbrs, v) => {
    if (!nbrs){ 
      let ns = Array.from(comp.graph)
      console.log("NEW ARRAY", ns)
      links.push({ source: String(ns[0][0]), target: String(ns[1][0])});
      return;
      } // Skip if neighbors list is null
    nbrs.forEach(w => {
      const src = String(v), tgt = String(w);
      if (src < tgt && comp.graph.has(w)) {
        let isVirtual = false;
        for(const virtEdge of comp.virtualEdgeEntry) {
          console.log(virtEdge)
          if (virtEdge[0][0] == src && virtEdge[0][1] == tgt || virtEdge[0][1] == src && virtEdge[0][0] == tgt ) {
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

  // Force-directed layout centered at (400, 400)
  const layout = d3.forceSimulation(nodeObjs)
    .force("charge", d3.forceManyBody().strength(-200))
    .force("link", d3.forceLink(links).distance(40).id(d => d.id))
    .force("linj´k", d3.forceLink(virtualLinks).distance(40).id(d => d.id))
    .force("center", d3.forceCenter(400, 400))
    .stop();

  for (let i = 0; i < 150; i++) layout.tick();

  // Assume globalInputNodeMap is from the main graph
  let nodeMap = new Map();

  comp.graph.forEach((_, n) => {
      const pos = inputNodePositions.get(String(n)); // `n` is the node ID like "1"
      if (pos) {
          nodeMap.set(n, { x: pos.x, y: pos.y });
      }
  });
  console.log("input node positions:", inputNodePositions);
  console.log("Mapped SPQR component node positions:", nodeMap);


  console.log("nodeMap", nodeMap);
  console.log("links", links);
  console.log("virtual links", virtualLinks)


  // Normal edges
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

  // Virtual edges
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

  // Bounding box
  const bounds = getBoundingBox(nodeMap);
  group.append("rect")
    .attr("x", bounds.minX )
    .attr("y", bounds.minY )
    .attr("width", bounds.maxX - bounds.minX )
    .attr("height", bounds.maxY - bounds.minY )
    .attr("stroke", "black")
    .attr("fill", "none")
    .attr("rx", 8);

  // Add component type label
  group.append("text")
    .attr("x", bounds.minX)
    .attr("y", bounds.minY - 10)
    .text(comp.type)
    .attr("font-weight", "bold")
    .attr("font-size", "12px");

  group
  .on("mouseover", () => {
    console.log("Hovered over the group!");
    highlightComponent(nodeSelInput, linkSelInput, comp.id, colors[0])
  })
  .on("mouseout",  ()=> {
    unhighlightComponent(nodeSelInput, linkSelInput, comp.id, colors[0])
  });

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

function setGraph(nodes, edges, presetType = null) {
  graphEdges = edges;
  graphNodes = nodes.map(v=>({id:String(v)}));
 const idToNode = Object.fromEntries(graphNodes.map(n => [n.id, n]));

graphLinks = edges.map(([s, t]) => ({
  source: idToNode[String(s)],
  target: idToNode[String(t)]
}));

  // Only create the graph once here
  ({ simulation:  simulationInput,
     nodeSel:     nodeSelInput,
     linkSel:     linkSelInput,
     labelSel:    labelSelInput } = createPresetGraph(svgInput, graphNodes, graphLinks, undefined, undefined, presetType));
     
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

    highlightComponent(inputSel,linkSelInput, d.id, colors[colorC++ % colors.length])
  
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
  unhighlight(spqrSel,  d.id);
  let matchingSPQRNode = SPQRTREE.filter(c => c.id === d.id)[0]

    unhighlightComponent(inputSel, linkSelInput, d.id)

  
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
function highlightEdge(linkSel, srcId, tgtId, color = "purple", dashed = false) {
  console.log(`Highlighting edge ${srcId}-${tgtId}, dashed: ${dashed}`);
  
  // First, try to find existing edge
  const existingEdge = linkSel
  .filter(d => {
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    return (
      ((sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId)) &&
      !d.temporary // <- skip lines you created temporarily
    );
  });

  
  if (existingEdge.size() > 0) {
    console.log("existingEdge count:", existingEdge.size());

    // Edge exists, just highlight it
    existingEdge
      .attr("stroke", color)
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", dashed ? "5,5" : null)
      .raise();
  } else {
    // Check if temporary edge already exists (to avoid duplicates)
    const existingTempEdge = d3.select(linkSel.node().parentNode)
      .selectAll(".temporary-edge")
      .filter(d => {
        const sid = d.source.id;
        const tid = d.target.id;
        return (sid === srcId && tid === tgtId) || (sid === tgtId && tid === srcId);
      });
    
    if (existingTempEdge.size() > 0) {
      console.log("Temporary edge already exists, just updating style");
      // Update existing temporary edge
      existingTempEdge
        .attr("stroke", color)
        .attr("stroke-width", 3)
        .attr("stroke-dasharray", dashed ? "5,5" : null)
        .raise();
    } else {
      console.log("Creating temporary edge");
      // Edge doesn't exist, create it
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
/** Remove highlighted edges, including temporary ones */
function unhighlightEdge(linkSel, srcId, tgtId) {
  // Unhighlight existing edges
  linkSel
    .filter(d =>
      (d.source.id === srcId && d.target.id === tgtId) ||
      (d.source.id === tgtId && d.target.id === srcId)
    )
    .attr("stroke", "#999")  // Reset to default color
    .attr("stroke-width", 2)   // Reset to default width
    .attr("stroke-dasharray", null);  // Reset to solid line
 
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


/** Enhanced component highlighting with temporary edge support */
function highlightComponent(nodeSel, linkSel, compId, color = "orange") {
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

    if (comp.graph.entries().next().value[1] == null) {
    comp.virtualEdgeEntry.forEach(([edge, _]) => {
      const [u, v] = edge;
      highlight(nodeSel, String(u), color);
      highlight(nodeSel, String(v), color);
      highlightEdge(linkSel, String(u), String(v), color, true); // dashed
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    return;
  }

  // Core vertices
  comp.graph.forEach((nbrs, v) => {
    console.log(v);
    highlight(nodeSel, String(v), color);
    
    // Highlight every incident edge inside this series component
    nbrs.forEach(w => {
      if (comp.graph.has(w)) { // w is inside same component
        // Check if this edge is a virtual edge
        const edgeKey = `${v}-${w}`;
        if (virtualEdges.has(edgeKey)) {
          highlightEdge(linkSel, String(v), String(w), color, true); // dashed for virtual
        } else {
          highlightEdge(linkSel, String(v), String(w), color, false); // solid for normal
        }
        // Track this edge for cleanup
        comp.highlightedEdges.push([String(v), String(w)]);
      }
    });
  });
}



/** Unhighlight component */
function unhighlightComponent(nodeSel, linkSel, compId, color = "orange") {
  const comp = SPQRTREE.find(c => c.id === compId);
  if (!comp) return;

     if (comp.graph.entries().next().value[1] == null) {
    comp.virtualEdgeEntry.forEach(([edge, _]) => {
      const [u, v] = edge;
      unhighlight(nodeSel, String(u), color);
      unhighlight(nodeSel, String(v), color);
      unhighlightEdge(linkSel, String(u), String(v), color, true); // dashed
      comp.highlightedEdges.push([String(u), String(v)]);
    });
    return;
  }
  
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