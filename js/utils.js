export function addValue(map, key, value) {
  if (!map.has(key)) map.set(key, []); // create list once
  map.get(key).push(value);            // append neighbour
}

export function removeVertex(graph, vertex) {
  // Remove the vertex itself from the map
  graph.delete(vertex);

  // Remove it from all other adjacency lists
  for (const [node, neighbors] of graph.entries()) {
    graph.set(node, neighbors.filter(n => n !== vertex));
  }
}

export function setsAreEqual(set1, set2) {
  if (set1.size !== set2.size) return false;
  for (const elem of set1) {
    if (!set2.has(elem)) return false;
  }
  return true;
}

export function addNeighbour(maps, from, to) {
  if (!maps.has(from)) {
    maps.set(from, [to]);          // first neighbour
  } else {
    const list = maps.get(from);
    if (!list.includes(to)) list.push(to); // add only if absent
  }
}

export function cloneGraph(src) {
  const dst = new Map();
  for (const [v, adj] of src) dst.set(v, [...adj]);
  return dst;
}

export function dfsWithCount(graph, start, visited = new Set()) {
    if (visited.has(start)) return;

    visited.add(start);
    const neighbors = graph.get(start) || [];

    for (const neighbor of neighbors) {
        dfsWithCount(graph, neighbor, visited);
    }

    return visited;
}