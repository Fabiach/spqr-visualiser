// graph.js
// All force‑directed rendering and drag logic lives here.
// The code assumes D3 v7 is already loaded globally via a <script> tag in index.html.
// Exports:
//   createGraph(svg, nodes, links, width?, height?) → { simulation, linkSel, nodeSel, labelSel }
//   drag(simulation)                                → d3.drag behaviour

const svgInput = d3.select("#input-graph");
const svgSPQR = d3.select("#spqr-graph")


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
export function createGraph(svg, nodes, links, width = 800, height = 1000) {
  // --- Forces -------------------------------------------------------------
  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(15))
    .force("charge", d3.forceManyBody().strength(-250))
    .force("center", d3.forceCenter(width / 2, height / 2));

  // --- SVG Elements -------------------------------------------------------
const linkSel = svg
  .append("g")
  .selectAll("line")
  .data(links)
  .join("line")
  .attr("stroke", "#999")  // Your desired color here
  .attr("stroke-opacity", 0.6)
  .attr("stroke-width", 2);

  const nodeSel = svg
    .append("g")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5)
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", 10)
    .attr("fill", "steelblue")
    .call(drag(simulation))
    .on("mouseover", handleMouseOver)
    .on("mouseout", handleMouseOut);

  const labelSel = svg
    .append("g")
    .selectAll("text")
    .data(nodes)
    .join("text")
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
      d.fx = null;
      d.fy = null;
    });
}

export function clearGraph(svg) {
  svg.selectAll("*").remove();  // Remove all child elements
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