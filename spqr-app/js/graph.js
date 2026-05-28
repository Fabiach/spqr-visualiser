import {
  fixedPositionsWikipedia, fixedPositionsDiBattista,
  fixedPositionsTutorialS, fixedPositionsTutorialR, fixedPositionsTutorialP,
  fixedPositionsTutorialBasics, fixedPositionsTutorialDisconnected,
  fixedPositionsTutorialConnected, fixedPositionsTutorialNonBiconnected,
  fixedPositionsTutorialBiconnected, fixedPositionsTutorialSPR,
  fixedPositionsTutorialS2,
} from './data.js';

// graph.js
// All force‑directed rendering and drag logic lives here.
// The code assumes D3 v7 is already loaded globally via a <script> tag in index.html.
// Exports:
//   createGraph(svg, nodes, links, width?, height?) → { simulation, linkSel, nodeSel, labelSel }
//   drag(simulation)                                → d3.drag behaviour

const svgInput = d3.select("#input-graph");
const svgSPQR = d3.select("#spqr-graph")

const stdWidth = 1000;
const stdHeight = 1000;


/**
 * Build a force‑directed graph in the supplied <svg> selection.
 * Nothing here mutates the original nodes / links arrays; D3 will add x/y fields in place.
 *
 * @param {d3.Selection} svg     – a d3 selection of an <svg> element
 * @param {Array<Object>} nodes  – [{ id: "1" }, …]
 * @param {Array<Object>} links  – [{ source: "1", target: "2" }, …]
 * @param {number} [width=1000]  – canvas width
 * @param {number} [height=1000] – canvas height
 * @returns {{simulation,nodeSel,linkSel,labelSel}}
 */
export function createGraph(svg, nodes, links, width = stdWidth, height = stdHeight, runSimulation = true) {
  // --- Forces -------------------------------------------------------------
  var simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(50))
    .force("charge", d3.forceManyBody().strength(-400))
    .force("center", d3.forceCenter(width / 2, height / 2));
  
  // --- SVG Elements -------------------------------------------------------
  const linkSel = svg
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 1)
    .attr("data-base-sw", 2)
    .attr("stroke-width", 2);

  const nodeSel = svg
    .append("g")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("class", "input-node")
    .attr("data-base-r", 10)
    .attr("r", 10)
    .attr("fill", "steelblue");
    // Note: Removed .call(drag(simulation)) and mouse events - these will be added by setupInputEventHandlers

  const labelSel = svg
    .append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .attr("data-base-fs", 12)
    .text(d => d.id)
    .attr("x", 12)
    .attr("y", ".31em");

  // --- Tick handler -------------------------------------------------------
  simulation.on("tick", () => {
    linkSel
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
    labelSel.attr("x", d => d.x).attr("y", d => d.y - 14);
  });

  // Control simulation start
  if (!runSimulation) {
    simulation.stop();
  }

  return { simulation, linkSel, nodeSel, labelSel };
}


/**
 * Standard drag behaviour for force‑directed graphs.
 * Keeps the node fixed while dragging and releases it afterwards.
 *
 * @param {d3.Simulation} simulation – the force simulation to nudge
 * @returns {d3.DragBehavior}
 */
export function drag(simulation) {
  return d3
    .drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = event.x;
      d.fy = event.y;
    });
}

export function clearGraph(svg) {
  // Remove everything except the zoom container
  svg.selectAll("*:not(#spqr-zoom-container)").remove();
  
  // Clear the contents of the zoom container if it exists
  const zoomContainer = svg.select("#spqr-zoom-container");
  if (!zoomContainer.empty()) {
    zoomContainer.selectAll("*").remove();
  }
}

const tooltip = d3.select("body")
  .append("div")
  .style("position", "absolute")
  .style("background", "#fff")
  .style("border", "1px solid #ccc")
  .style("padding", "4px 8px")
  .style("pointer-events", "none")
  .style("display", "none");

function handleMouseOver(event, d) {
  d3.select(this)                 // the hovered circle
    .attr("fill", "orange")
    .attr("r", 14);
  if(this)

  tooltip
  .style("display", "block")
  .html(`Node ${d.id}`)
  .style("left",  (event.pageX + 8) + "px")
  .style("top",   (event.pageY + 8) + "px");

}

function handleMouseOut() {
  d3.select(this)
    .attr("fill", "steelblue")
    .attr("r", 10);

  tooltip.style("display", "none");
}

export function createPresetGraph(svg, nodes, links, width = stdWidth, height = stdHeight, type = undefined) {
  var fixedPositions;
  switch(type) {
    case "Wikipedia" : fixedPositions = fixedPositionsWikipedia
                        break;
    case "DiBattista": fixedPositions = fixedPositionsDiBattista
                        break;
    case "TutorialS":              fixedPositions = fixedPositionsTutorialS;              break;
    case "TutorialR":              fixedPositions = fixedPositionsTutorialR;              break;
    case "TutorialP":              fixedPositions = fixedPositionsTutorialP;              break;
    case "TutorialSPR":            fixedPositions = fixedPositionsTutorialSPR;            break;
    case "TutorialS2":             fixedPositions = fixedPositionsTutorialS2;             break;
    case "TutorialBasics":         fixedPositions = fixedPositionsTutorialBasics;         break;
    case "TutorialDisconnected":   fixedPositions = fixedPositionsTutorialDisconnected;   break;
    case "TutorialConnected":      fixedPositions = fixedPositionsTutorialConnected;      break;
    case "TutorialNonBiconnected": fixedPositions = fixedPositionsTutorialNonBiconnected; break;
    case "TutorialBiconnected":    fixedPositions = fixedPositionsTutorialBiconnected;    break;
    default:
      return createGraph(svg, nodes, links, width, height, true)

  }

  // Assign x/y positions to nodes
  nodes.forEach(n => {
    const [fx, fy] = fixedPositions[n.id];
    n.x = (fx  )* width;
    n.y = (fy ) * height;
  });

  const linkSel = svg.append("g")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y)
    .attr("data-base-sw", 2)
    .attr("stroke-width", 2);

  const nodeSel = svg.append("g")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("class", "input-node")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("data-base-r", 10)
    .attr("r", 10)
    .attr("fill", "steelblue");

  const labelSel = svg.append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
    .attr("data-base-fs", 10)
    .text(d => d.id)
    .attr("x", d => d.x + 12)
    .attr("y", d => d.y + 4)
    .attr("font-size", "10px");

  return { nodeSel, linkSel, labelSel };
}
