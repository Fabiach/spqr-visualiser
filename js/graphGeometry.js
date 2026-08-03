/**
 * Keep every SVG representation of a straight-link set on the same geometry.
 * Graphs use a visible line plus a wider transparent hit area for each link.
 */
export function updateStraightLinkSelections(...selections) {
  const updated = new Set();

  for (const selection of selections) {
    if (!selection || typeof selection.attr !== 'function' || updated.has(selection)) continue;
    updated.add(selection);
    selection
      .attr('x1', link => link.source.x)
      .attr('y1', link => link.source.y)
      .attr('x2', link => link.target.x)
      .attr('y2', link => link.target.y);
  }
}
