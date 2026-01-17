
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
