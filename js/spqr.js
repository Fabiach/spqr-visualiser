import {cloneGraph,dfsWithCount,removeVertex,addValue, setsAreEqual, addNeighbour} from './utils.js';
import {edgesDB} from './data.js';

var virtualEdgeIDCounter = 0;

export function spqr_tree(graph){
    virtualEdgeIDCounter = 0;
    var startingComponent = new SPQRComponent(graph, null, [])
    var workingComponents = new Array();
    var splitComponents = new Array();
    workingComponents.push(startingComponent)
    while (workingComponents.length > 0 ) {
        //console.log("in SPQR - current components ", workingComponents)
        var componentToProcess = workingComponents.pop()
        var graphOfComponentToProcess =componentToProcess.graph;
        if (graphOfComponentToProcess == undefined || graphOfComponentToProcess.size == 2) {
          //console.log("SPLIT PAIR COMPONENT, CONTINUE")
          if(graphOfComponentToProcess == undefined) {
            console.log("UNDEFINED: ", componentToProcess, graphOfComponentToProcess)
            let newGraphMap = new Map()
            newGraphMap.set(componentToProcess.virtualEdgeEntry[0][0][0], null)
            newGraphMap.set(componentToProcess.virtualEdgeEntry[0][0][1], null)
            graphOfComponentToProcess = newGraphMap;
          }
          splitComponents.push(new SPQRComponent(graphOfComponentToProcess, "P", componentToProcess.virtualEdgeEntry))
          continue;

        }
        if (graphOfComponentToProcess.size == 3 && isSingleCycle(graphOfComponentToProcess) ) {
          //console.log("TRIANGLE COMPONENT, CONTINUE")
          splitComponents.push(new SPQRComponent(graphOfComponentToProcess, "S", componentToProcess.virtualEdgeEntry))
          continue;

        }
        var splitResult = splitComponentIntoSmallerComponents(componentToProcess)
        if(splitResult == false) {
            splitComponents.push(new SPQRComponent(graphOfComponentToProcess, "R", componentToProcess.virtualEdgeEntry))
        }
        if (splitResult.length > 1) {
          if (splitResult.length > 3) {
            }
          for (const res of splitResult) {
            workingComponents.push(res);
          }
        }

    }
    //console.log(splitComponents)
    let mergedComponents = mergeSplitComponents(splitComponents)
    console.log("COMPONENT GROUPS (TO MERGE): ", mergedComponents)
    return mergedComponents
} 

export function splits_graph(splitNode1, splitNode2, componentToProcess){
    var graph = componentToProcess.graph;
    //console.log("in splits_graph with node1:", node1, "node2:", node2, "component: ",  JSON.stringify(Object.fromEntries(graph), null, 2));
    let node1entry = graph.get(splitNode1) ? [...graph.get(splitNode1)] : [];
    let node2entry = graph.get(splitNode2)? [...graph.get(splitNode2)] : [];

    // Remove potential split pair
    removeVertex(graph, splitNode1)
    removeVertex(graph, splitNode2)

    let splitComponents = [];
    for(const node1Neighbor of node1entry) {
        let foundSet = dfsWithCount(graph, node1Neighbor);
        let setNew = true;
        for (const alreadyFoundSplitComponent of splitComponents) {
          if(setsAreEqual(foundSet, alreadyFoundSplitComponent)) {
            setNew = false;
          }
        }
        if (setNew) {
          if(foundSet.has(splitNode2)) foundSet.add(splitNode1)
          splitComponents.push(foundSet)
        }
    }
    // Final result: was the graph split?
    var finalPostSplitSPQRComponents = new Array()

    // calculates new, split components
    for (const comp of splitComponents) {
        let compMap = new Map();
        var node1NeighborsInComp = new Array();
        var node2NeighborsInComp = new Array();


        // Fill the compMap with actual vertices
        for (const vertex of comp) {
          if (vertex === splitNode1 || vertex === splitNode2) continue;
          const neighbors = graph.get(vertex) ? [...graph.get(vertex)] : [];
          compMap.set(vertex, neighbors);

          if (node1entry.includes(vertex)) {
            node1NeighborsInComp.push(vertex);
            compMap.get(vertex).push(splitNode1);
          }
          if (node2entry.includes(vertex)) {
            node2NeighborsInComp.push(vertex);
            compMap.get(vertex).push(splitNode2);
          }
        }

        // Make sure the virtual edge is bidirectional
        if (!node1NeighborsInComp.includes(splitNode2)) {
          node1NeighborsInComp.push(splitNode2);
        }
        if (!node2NeighborsInComp.includes(splitNode1)) {
          node2NeighborsInComp.push(splitNode1);
        }

        
        compMap.set(splitNode1, node1NeighborsInComp);
        compMap.set(splitNode2, node2NeighborsInComp);

        finalPostSplitSPQRComponents.push(new SPQRComponent(compMap, null, []));
    }

    

    graph.set(splitNode1, node1entry);
    graph.set(splitNode2, node2entry);
      
    for (const n of node1entry) addNeighbour(graph, n, splitNode1);
    for (const n of node2entry) addNeighbour(graph, n, splitNode2);

    if (splitComponents.length > 2 || (!node1entry.includes(splitNode2) && splitComponents.length == 2)) {
        //console.log("✅ Graph was split by removing edge", splitNode1, "-", splitNode2);
        //console.log(finalPostSplitSPQRComponents)
    } else {
       // console.log("❌ Graph is still connected after removing edge", splitNode1, "-", splitNode2);
        return false;
    }
        //TODO: IN CASE PARALLEL: MAKE PARALLEL COMPONENT SPECIAL AND CONNECT
        // SEPARATE VIRTUAL EDGES TO EACH DIFFERENT COMPONENT TO IT

        if (finalPostSplitSPQRComponents.length >= 3) {
            var parallel = finalPostSplitSPQRComponents.filter(
                            comp => comp.graph && comp.graph.size === 2
                            );
            let newParallel = false;
            if (parallel.length == 0) {
                newParallel = true
                parallel = [new SPQRComponent(undefined,null, [])]
            }
            for (const finalComponent of finalPostSplitSPQRComponents) {
                if (finalComponent.graph.size != 2) {
                    finalComponent.virtualEdgeEntry = [[[splitNode1, splitNode2], virtualEdgeIDCounter]]
                    parallel[0].virtualEdgeEntry.push([[splitNode1, splitNode2], virtualEdgeIDCounter++])
                }
            }
            if (newParallel) {
                //console.log("NEW PARALLEL: ", parallel)
                finalPostSplitSPQRComponents.push(parallel[0])
            }
        }
        else {
            for(const finalComponent of finalPostSplitSPQRComponents ) {
                  finalComponent.virtualEdgeEntry = [[[splitNode1, splitNode2], virtualEdgeIDCounter]]
            }

        }

        //console.log("PARENT COMPONENT: ", componentToProcess    )

        for (const finalComponent of finalPostSplitSPQRComponents) {
            if(finalComponent.graph == undefined) continue;
            const parentVirtualEdgeEntry    = componentToProcess.virtualEdgeEntry;

            for (let i = 0; i < parentVirtualEdgeEntry.length; i++) {
                const [a, b] = parentVirtualEdgeEntry[i][0];

                if (finalComponent.graph.has(a) && finalComponent.graph.has(b)) {
                finalComponent.virtualEdgeEntry.push([[a, b], parentVirtualEdgeEntry[i][1]]);
                }
            }   
        }

   // console.log("FinalPostSPLIT:", (finalPostSplitSPQRComponents))
    //console.log("componentSets: ", splitComponents)
    virtualEdgeIDCounter++;
    return finalPostSplitSPQRComponents;
}

export class SPQRComponent {
    constructor(graph, type, virtualEdgeEntry, id = null) {
        this.id = id;
        this.type = type;
        this.graph = graph;
        this.virtualEdgeEntry = virtualEdgeEntry
    }
}

export function generateEdgesMap(db) {
  const map = new Map();
  for (const [a, b] of db) {           // edge → edges
    addValue(map, a, b);               // both directions
    addValue(map, b, a);
  }
  return map;
}

/**
 * Incrementally merges SPQRComponents that:
 *   – have the same .type
 *   – share a virtualEdgeID at the same position
 *
 * Returns a new list of merged (and unmerged) components.
 *
 * @param {SPQRComponent[]} components
 * @returns {SPQRComponent[]} merged components
 */
export function mergeSplitComponents(components) {
  const queue = [...components]; // work list
  const result = [];

  while (queue.length > 0) {
    let current = queue.shift(); // take first

    let didMerge = false;

    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      let sharedVirtualEdgeId = canMerge(current, candidate)
      if (sharedVirtualEdgeId != false) {
        // Merge and re-check from beginning
        const merged = mergeComponents(current, candidate, sharedVirtualEdgeId);
        queue.splice(i, 1);  // remove candidate
        queue.unshift(merged); // put merged back for further testing
        didMerge = true;
        break;
      }
    }

    if (!didMerge) {
      result.push(current); // no match — keep it
    }
  }

  return result;
}

/**
 * Checks if two components can be merged.
 * Same type + same virtual edge ID at same index.
 */
function canMerge(a, b) {
  if (a.type !== b.type) return false;



  for (const [edgeA, idA] of a.virtualEdgeEntry) {
    for (const [edgeB, idB] of b.virtualEdgeEntry) {
      if (idA === idB) {
        return edgeA; // shared edge, e.g., [u, v]
      }
    }
  }

  return false;
}


/**
 * Dummy merge — replace with your actual logic.
 * Merges graphs and virtual edge entries.
 */
function mergeComponents(a, b, sharedEdgeID) {
    //console.log("MERGING COMPONENTS: ", a, b)
  const mergedGraph = new Map(a.graph);

  // Merge b.graph into a.graph
  for (const [node, neighbors] of b.graph.entries()) {
    if (!mergedGraph.has(node)) {
      mergedGraph.set(node, [...neighbors]);
    } else {
      const mergedNeighbors = new Set([...mergedGraph.get(node), ...neighbors]);
      mergedGraph.set(node, [...mergedNeighbors]);
    }
  }

    // Remove the real edge from mergedGraph if it's present
  if (sharedEdgeID) {
    const [u, v] = sharedEdgeID;
    if (mergedGraph.has(u)) {
      mergedGraph.set(u, mergedGraph.get(u).filter(n => n !== v));
    }
    if (mergedGraph.has(v)) {
      mergedGraph.set(v, mergedGraph.get(v).filter(n => n !== u));
    }
  }

  // Merge edge entries
  const mergedVirtualEdgeEntry = [];

  const seenIDs = new Set();
  seenIDs.add(sharedEdgeID)
  for (const entry of [...a.virtualEdgeEntry, ...b.virtualEdgeEntry]) {
    const id = entry[1];
    if (!seenIDs.has(id) && id != sharedEdgeID) {
      seenIDs.add(id);
      mergedVirtualEdgeEntry.push(entry);
    }
  }

  var mergedResult = new SPQRComponent(
    mergedGraph,
    a.type, // type is the same
    mergedVirtualEdgeEntry
  );
  // console.log("RESULT OF MERGER: ", mergedResult)
  return mergedResult
}






export function splitComponentIntoSmallerComponents(componentToProcess){
    var componentGraph = componentToProcess.graph;
   // console.log("TRYING TO BREAK THIS DOWN: ", JSON.stringify(Object.fromEntries(componentGraph), null, 2))
    const nodes = [...componentGraph.keys()];
    for (const [node, neighbors] of componentGraph.entries()) {
        for (const neighbor of neighbors) {
            let splitComponents = splits_graph(node, neighbor, cloneComponent(componentToProcess))
            if (splitComponents == false) {
              continue;
            }
            //parallel components
            if (splitComponents.length >= 3) {
             // console.log("parallel component: ", splitComponents )
              return splitComponents;

            }
            else {
             // console.log("non-parallel component: ", splitComponents)
              return splitComponents;
            }
        }   
    }
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const u = nodes[i], v = nodes[j];
            if (componentGraph.get(u).includes(v)) continue;    // already tested above
            const split = splits_graph(u, v, cloneComponent(componentToProcess));
            if (split && split.length >= 2) return split;
        }
    }   
    //no split pair found -> R component
    return false;
}

/**
 * Returns true iff the graph is a single simple cycle
 * (a.k.a. an “n‑cycle”, Cₙ, n ≥ 3).
 * Assumes undirected, no multi‑edges, no self‑loops.
 */
export function isSingleCycle(graph) {
  const n = graph.size;                // # vertices
  if (n < 3) return false;             // need at least 3

  // 1. every vertex must have degree 2
  for (const [, nbrs] of graph) {
    if (nbrs.length !== 2) return false;
  }

  // 2. the graph must be connected
  //    (DFS/BFS should reach all n vertices)
  const start = graph.keys().next().value;   // any vertex
  const visited = new Set();
  const stack = [start];

  while (stack.length) {
    const v = stack.pop();
    if (visited.has(v)) continue;
    visited.add(v);
    for (const w of graph.get(v)) {
      if (!visited.has(w)) stack.push(w);
    }
  }
  if (visited.size !== n) return false;

  // 3. #edges must equal #vertices
  //    (follows from degree‑2 + connected, but we can double‑check)
  let edgeCount = 0;
  for (const [, nbrs] of graph) edgeCount += nbrs.length;
  edgeCount /= 2;                       // each edge counted twice
  return edgeCount === n;
}

export function cloneComponent(comp) {
  return new SPQRComponent(
    cloneGraph(comp.graph),
    comp.type,
    [...(comp.virtualEdgeEntry || [])]
  );
}

