export const verticesDB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

export const edgesDB = [
                    [1, 2], [1, 17],[1, 10],[1, 11],[2, 3],[3, 4],[3, 6],[4, 5],[4, 7],[5, 6],[6, 7],[7, 8],[8, 17],
        	        [1, 9], [9, 17], [10, 12], [11, 12], [11, 13], [11, 14], [12, 15], [12, 16], 
                    [12, 17],[13, 15],[14, 15],[15, 16],[16, 17]
                ];

export const edgesBrown =  [
                        [1,2],[1,4],[2,3],[3,4],[3,5],[3,6],[3,8],[3,9],[4,5],[4,7],[6,7],[6,8],[7,8],[8,9]
                    ];


export const verticesBrown =  [
                        1,2,3,4,5,6,7,8,9
                    ];

export const edgesWikipedia =  [
                        [1,2],[1,3],[1,7],[2,4],[2,8],[3,4],[3,5],[4,6],[5,6],[5,7],[6,8],[7,12],[8,9],[8,10],[9,10],[10,11],[11,13],[11,14],[12,13],[12,15],[12,16],[13,14],[13,15],[13,16],[15,16], [9,14]
                    ];


export const verticesWikipedia =  [
                        1,2,3,4,5,6,7,8,9, 10, 11, 12, 13, 14, 15, 16
                    ];

export const edgesKindermann =  [
                        [1,2],[2,3],[2,4],[2,5],[3,4],[4,5],[4,6], [5,6],[6,7],[3,7],[7,8],[7,9],[8,10],[9,10],
                        [1,11],[1,12],[11,12], [11,13],[12,13],[13,14],[13,15],[14,15],[14,16],[15,16],
                        [1,17],[17,18],[17,19],[17,20],[19,20],
                        [1,21],[21,22],[21,23],[22,23],
                        [10,24],[14,24],[16,24],[17,24],[18,24],[19,24],[20,24],[23,24],
                        [1,24]

                    ];


export const verticesKindermann =  [
                        1,2,3,4,5,6,7,8,9, 10, 11, 12, 13, 14, 15, 16,17,18,19,20,21,22,23,24
                    ];



export  const fixedPositionsWikipedia = {
    1: [0.25, 0.05],  2: [0.55, 0.05],  
    3: [0.35, 0.15],  4: [0.45, 0.15],
    5: [0.35, 0.25],  6: [0.45, 0.25],  
    7: [0.25, 0.35],  8: [0.55, 0.35], 9: [0.75, 0.35], 
    10: [0.65, 0.45], 
    11: [0.65, 0.55], 
    12: [0.25, 0.65], 13: [0.55, 0.65], 14: [0.75, 0.65], 
    15: [0.40, 0.75], 
    16: [0.40, 0.95],
  };

  
export  const fixedPositionsDiBattista = {
    1: [0.50, 0.95],  
    2: [0.38, 0.85],  
    3: [0.28, 0.75],  4: [0.18, 0.63],
    5: [0.26, 0.61],  6: [0.37, 0.49],  
    7: [0.24, 0.35],  8: [0.322, 0.23], 
    9: [0.56, 0.61], 
    10: [0.64, 0.77], 
    11: [0.78, 0.75], 
    12: [0.70, 0.59], 13: [0.78, 0.61], 14: [0.88, 0.62], 
    15: [0.84, 0.51], 
    16: [0.74, 0.29],
    17: [0.45, 0.10],
  };

// ── Tutorial basic-concept graphs ────────────────────────────────────────────

// Step 2 – "What is a graph?" : 4-cycle  1-2-3-4-1
export const fixedPositionsTutorialBasics = {
  "1": [0.35, 0.35],
  "2": [0.65, 0.35],
  "3": [0.65, 0.65],
  "4": [0.35, 0.65],
};

// Step 3 – disconnected : two separate edges  {1-2}  {3-4}
export const fixedPositionsTutorialDisconnected = {
  "1": [0.25, 0.40],
  "2": [0.25, 0.60],
  "3": [0.75, 0.40],
  "4": [0.75, 0.60],
};

// Step 3 – connected : same layout as disconnected, bridge edge 1-3 added
export const fixedPositionsTutorialConnected = {
  "1": [0.25, 0.40],
  "2": [0.25, 0.60],
  "3": [0.75, 0.40],
  "4": [0.75, 0.60],
};

// Step 4 – not biconnected : path  1-2-3
export const fixedPositionsTutorialNonBiconnected = {
  "1": [0.25, 0.50],
  "2": [0.50, 0.50],
  "3": [0.75, 0.50],
};

// Step 4 – biconnected : triangle  1-2-3
export const fixedPositionsTutorialBiconnected = {
  "1": [0.50, 0.30],
  "2": [0.32, 0.62],
  "3": [0.68, 0.62],
};

// Step 5 – intro: graph containing an S, P, and R component
// K4 on {2,3,4,5} plus vertex 1 bridging 2↔5 (path 2-1-5).
// Separation pair {2,5} → P node with three branches:
//   Q (direct edge 2-5), S (series path 2-1-5), R (K4 sub-graph)
export const fixedPositionsTutorialSPR = {
  "5": [0.45, 0.88],  // Top of diamond (K4)
  "3": [0.85, 0.50],  // Left of diamond (K4)
  "4": [0.65, 0.50],  // Right of diamond (K4)
  "2": [0.45, 0.08],  // Bottom of diamond (K4)
  "1": [0.18, 0.50],  // Far right – the S-path vertex
};

// Step 6 – S-component with P and R children
// Pentagon 1-2-3-4-5-1 as the S backbone.
//   Vertex 6 adds a parallel path 1-6-2 → P component at {1,2}
//   Vertices 7,8 complete K4 on {3,4,7,8} → R component at {3,4}
export const fixedPositionsTutorialS2 = {
  "1": [0.50, 0.18],  // Top of pentagon
  "2": [0.76, 0.40],  // Right-upper of pentagon
  "3": [0.66, 0.72],  // Right-lower of pentagon
  "4": [0.34, 0.72],  // Left-lower of pentagon
  "5": [0.24, 0.40],  // Left-upper of pentagon
  "6": [0.73, 0.21],  // P parallel vertex A between 1 and 2 (outside)
  "7": [0.56, 0.38],  // P parallel vertex B — mirror of 6 across edge 1-2 (inside)
  "8": [0.57, 0.84],  // R (K4-minus-one-edge) vertex, below 3
  "9": [0.43, 0.84],  // R (K4-minus-one-edge) vertex, below 4
};

// Step 8 – four different R-components in a series 4-cycle
// 1-4: series skeleton corners; R₁=W₄ (top), R₂=K₅ (right), R₃=K₄ (bottom), R₄=K₃,₃ (left)
export const fixedPositionsTutorialRSeries = {
  // series skeleton corners
  "1":  [0.30, 0.30],
  "2":  [0.70, 0.30],
  "3":  [0.70, 0.70],
  "4":  [0.30, 0.70],
  // R₁ W₄ between 1-2 (top): hub=6, outer cycle 1-5-2-7-1
  "5":  [0.50, 0.06],
  "6":  [0.50, 0.15],
  "7":  [0.50, 0.24],
  // R₂ K₅ between 2-3 (right): internal vertices 8, 9, 10
  "8":  [0.86, 0.38],
  "9":  [0.94, 0.50],
  "10": [0.86, 0.62],
  // R₃ K₄ between 3-4 (bottom): internal vertices 11, 12
  "11": [0.50, 0.79],
  "12": [0.50, 0.94],
  // R₄ K₃,₃ between 4-1 (left): side A={4,1,13}, side B={14,15,16}
  "13": [0.30, 0.50],
  "14": [0.06, 0.30],
  "15": [0.06, 0.50],
  "16": [0.06, 0.70],
};

// ── Tutorial SPQR component graphs ───────────────────────────────────────────
export const fixedPositionsTutorialS = {
    1: [0.50, 0.375],  // Top
    2: [0.62, 0.46],   // Right upper
    3: [0.575, 0.60],  // Right lower
    4: [0.425, 0.60],  // Left lower
    5: [0.38, 0.46],   // Left upper
  };

export const fixedPositionsTutorialR = {
    1: [0.50, 0.40],  // Top
    2: [0.59, 0.45],  // Upper right
    3: [0.59, 0.55],  // Lower right
    4: [0.50, 0.60],  // Bottom
    5: [0.41, 0.55],  // Lower left
    6: [0.41, 0.45],  // Upper left
  };

export const fixedPositionsTutorialP = {
    1: [0.50, 0.30],  // Top attachment point
    2: [0.65, 0.50],  // Right path node
    3: [0.5375, 0.50],  // Middle path node (25% toward node 2)
    4: [0.35, 0.50],  // Left path node
    5: [0.50, 0.70],  // Bottom attachment point
  };

export const factorials = [1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800, 479001600, 6227020800, 87178291200, 1307674368000]

export const verticesTutorialP = [1, 2, 3, 4, 5];

export const edgesTutorialP = [
                    [1, 2], [2,5], [1,3], [3,5], [1,4],[4,5], [1,5]
                ];

export const verticesTutorialS = [1, 2, 3, 4, 5];

export const edgesTutorialS = [
                    [1, 2], [2,3], [3,4], [4,5], [1,5]
                ];

export const verticesTutorialR = [1, 2, 3, 4, 5, 6];

export const edgesTutorialR = [
                    [1, 2], [1,3], [1,4], [1,5], [1,6], [2,3], [2,4], [2,5], [2,6], [3,4], [3,5], [3,6], [4,5], [4,6], [5,6]
                ];

                
export const verticesTutorialPAndR = [1, 2, 3, 4, 5];

export const edgesTutorialPAndR = [
                    [1,5], [1,2], [2,3], [2,4], [2,5],[3,4], [3,5],[4,5]
                ];