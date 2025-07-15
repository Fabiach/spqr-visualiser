import {verticesDB,edgesDB, edgesBrown, verticesBrown}     from './data.js';
import {generateEdgesMap, spqr_tree as calculateSPQRTree}       from './spqr.js';
import {clearGraphs, createGraph}            from './graph.js';

let simulationInput, nodeSelInput, linkSelInput, labelSelInput;
let simulationSPQR,  nodeSelSPQR,  linkSelSPQR,  labelSelSPQR;

const svgInput = d3.select("#input-graph");
const svgSPQR = d3.select("#spqr-graph")
var SPQRTREE;
let graphEdges = edgesDB
let graphNodes = verticesDB.map(v=>({id:String(v)}));
let graphLinks = edgesDB.map(([s,t])=>({source:String(s),target:String(t)}));

({ simulation:  simulationInput,
   nodeSel:     nodeSelInput,
   linkSel:     linkSelInput,
   labelSel:    labelSelInput } = createGraph(svgInput, graphNodes, graphLinks));

nodeSelInput
  .on("mouseover", (evt,d)=>handleMouseOverInput(evt,d, nodeSelInput, nodeSelSPQR))
  .on("mouseout",  (evt,d)=>handleMouseOutInput(evt,d,  nodeSelInput, nodeSelSPQR));



const form = document.getElementById('input-form');

form.addEventListener('submit', e => {
  e.preventDefault();                // stop page reload

  // ✧ Option 1: via IDs
  const raw = document.getElementById('vertices').value.trim();
  const vertices = raw.split(',').map(v => v.trim()).filter(v => v.length > 0);

  const edgesRaw = document.getElementById('edges').value.trim();

  // Grab every “[number,number]” block
  const edgeMatches = edgesRaw.match(/\[(\d+)\s*,\s*(\d+)\]/g) || [];

  const edges = edgeMatches.map(block => {
    const [src, dst] = block
      .replace(/\[|\]/g, '')   // drop brackets
      .split(',')
      .map(s => parseInt(s.trim(), 10));  // → numbers
    return [src, dst]; // keep as numeric pair
  });

// Result: [[1,2], [2,3], [3,4]]


  // ✧ Option 2: via the form’s elements collection
  // const verticesVal = e.target.elements.vertices.value.trim();
  // const edgesVal    = e.target.elements.edges.value.trim();

  console.log('vertices:', vertices);
  console.log('edges   :', edges);
  clearGraphs()
  setGraph(vertices, edges)
  createGraph(svgInput, graphNodes, graphLinks)
  document.getElementById('spqr-btn').click();

  // … parse / update your graph here …
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
};

document.getElementById('input-form').onsubmit = e=>{
  e.preventDefault();
  // re‑implement inputToGraph using the imported helpers
};

document.getElementById('example-graph-brown').onclick = () => {
  clearGraphs()
  setGraph(verticesBrown, edgesBrown)
  createGraph(svgInput, graphNodes, graphLinks)
  document.getElementById('spqr-btn').click();
}

document.getElementById('example-graph-db').onclick = () => {
  clearGraphs()
  setGraph(verticesDB, edgesDB)
  createGraph(svgInput, graphNodes, graphLinks)
  document.getElementById('spqr-btn').click();
}

function setGraph(nodes, edges) {
  graphEdges = edges
  graphNodes = nodes.map(v=>({id:String(v)}));
  graphLinks = edges.map(([s,t])=>({source:String(s),target:String(t)}));

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

  highlight(spqrSel,  "P1");
}

function handleMouseOutInput(event, d, inputSel, spqrSel) {
  unhighlight(inputSel, d.id);
  unhighlight(spqrSel,  d.id);
}

function handleMouseOverSPQR(event, d, inputSel, spqrSel) {
  highlight(spqrSel,  d.id);
  if (d.id.includes("P")) {
    console.log("PARALLEL NODE")
  }
  if (d.id.includes("S")) {
    console.log("SERIES NODE", d.id)
    let matchingSPQRNode = SPQRTREE.filter(c => c.id === d.id)[0]
    console.log("matchingSPQRNode",matchingSPQRNode)
    for(const keyNode of matchingSPQRNode.graph.keys()) {
      console.log(keyNode)
      highlight(inputSel, String(keyNode));
    }

  }
}

function handleMouseOutSPQR(event, d, inputSel, spqrSel) {
  unhighlight(spqrSel,  d.id);
  unhighlight(inputSel, d.id);
}

function highlight(selection, id) {
  console.log("in highlight with: ", selection, id)
  if (!selection) return;
  selection
    .filter(d => d.id === id)
    .attr("fill", "orange")
    .attr("r", 14);
}

function unhighlight(selection, id) {
  if (!selection) return;
  selection
    .filter(d => d.id === id)
    .attr("fill", "steelblue")
    .attr("r", 10);
}
