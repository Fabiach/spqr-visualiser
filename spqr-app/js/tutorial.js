/**
 * Tutorial Module for SPQR Trees
 * Provides an interactive tutorial explaining SPQR tree decomposition
 */

export class Tutorial {
  constructor(state, elements, callbacks) {
    this.state = state;
    this.elements = elements;
    this.callbacks = callbacks;
    
    this.currentStep = 0;
    this.isActive = false;
    
    // Tutorial steps will be defined here
    this.steps = this.createTutorialSteps();
    
    // DOM elements
    this.overlay = null;
    this.contentDiv = null;
    this.textDiv = null;
    this.prevBtn = null;
    this.nextBtn = null;
    this.exitBtn = null;
    this.progressSpan = null;
    
    this.initializeDOMElements();
  }
  
  initializeDOMElements() {
    this.panel = document.getElementById('tutorial-panel');
    this.contentDiv = document.getElementById('tutorial-content');
    this.textDiv = document.getElementById('tutorial-text');
    this.prevBtn = document.getElementById('tutorial-prev');
    this.nextBtn = document.getElementById('tutorial-next');
    this.exitBtn = document.getElementById('tutorial-exit');
    this.progressSpan = document.getElementById('tutorial-progress');

    // Set up event listeners
    this.prevBtn.addEventListener('click', () => this.previousStep());
    this.nextBtn.addEventListener('click', () => this.nextStep());
    this.exitBtn.addEventListener('click', () => this.exit());

    // Delegated handler for in-content step links (e.g. TOC)
    this.textDiv.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-step]');
      if (link) {
        e.preventDefault();
        this.goToStep(parseInt(link.dataset.step, 10));
      }
    });
  }
  
  createTutorialSteps() {
    return [
      // ─────────────────────────────────────────────────────────────────────
      // STEP 1 – Welcome
      // ─────────────────────────────────────────────────────────────────────
      {
        showSPQR: false,
        title: "What are SPQR trees?",
        content: `
          <h2>What are SPQR trees?</h2>
          <p>This interactive tutorial will give you a basic understanding of
          SPQR trees, a useful data structure for decomposing graphs.</p>

          Feel free to skip ahead if you are already familiar with the basics.

          <h3>Table of Contents</h3>

          <h4 class="toc-section-label">Graph Basics</h4>
          <ol class="toc-list">
            <li><a href="/tutorial/2" data-step="1">What is a graph? (vertices &amp; edges)</a></li>
            <li><a href="/tutorial/3" data-step="2">What is a connected graph?</a></li>
            <li><a href="/tutorial/4" data-step="3">What is a biconnected graph?</a></li>
          </ol>

          <h4 class="toc-section-label">SPQR Trees</h4>
          <ol class="toc-list" start="4">
            <li><a href="/tutorial/5" data-step="4">Introduction to SPQR trees</a></li>
            <li><a href="/tutorial/6" data-step="5">Deconstructing a graph step by step</a></li>
            <li>
              The three component types:
              <ul class="toc-sublist">
                <li><a href="/tutorial/7" data-step="6"><strong>S</strong> — Series components</a></li>
                <li><a href="/tutorial/8" data-step="7"><strong>P</strong> — Parallel components</a></li>
                <li><a href="/tutorial/9" data-step="8"><strong>R</strong> — Rigid components</a></li>
              </ul>
            </li>
            <li><a href="/tutorial/10" data-step="9">How components connect into a tree</a></li>
            <li><a href="/tutorial/11" data-step="10">Try it yourself</a></li>
          </ol>

        `,
        action: (tutorial) => {
          if (tutorial.callbacks.clearGraph) {
            tutorial.callbacks.clearGraph();
          }
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // STEP 2 – What is a graph?
      // ─────────────────────────────────────────────────────────────────────
      {
        showSPQR: false,
        title: "What is a Graph?",
        content: `
          <h2>What is a Graph?</h2>
          <p>A <strong>graph</strong> G = (V, E) consists of two objects:</p>
          <ul>
            <li><strong>Vertices</strong> (V) — the points of the graph.</li>
            <li><strong>Edges</strong> (E) — edges connecting pairs of vertices.</li>
          </ul>

          <h3>Key vocabulary</h3>
          <ul>
            <li>Two vertices connected by an edge are called <em>neighbours</em>.</li>
            <li>The <em>degree</em> of a vertex is the number of edges incident to it.</li>
          </ul>

          <p>In this tool the left canvas shows the graph.
          Load the example below to see a small graph with 4 vertices and 4 edges.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showGraphBasics">Show Example</button>
          </div>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showGraphBasics', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4],
              edges: [[1, 2], [2, 3], [3, 4], [4, 1]],
              type: 'TutorialBasics',
            });
          });
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // STEP 3 – Connected graphs
      // ─────────────────────────────────────────────────────────────────────
      {
        showSPQR: false,
        title: "Connected Graphs",
        content: `
          <h2>Connected Graphs</h2>
          <p>A graph is <strong>connected</strong> if there is path between
          every pair of vertices. Meaning you can reach any vertex from any other vertex by
          following edges.</p>

          <h3>Counterexample</h3>
          <p>The opposite of a connected graph is a disconnected graph. The graph below has two isolated parts: vertices 1–2 form one component,
          and vertices 3–4 form another. There is no path from vertex 1 to vertex 3.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showDisconnected">Show Example</button>
          </div>

          <h3>Connected example</h3>
          <p>Adding a single edge between the two parts makes the whole graph connected.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showConnected">Show Example</button>
          </div>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showDisconnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4],
              edges: [[1, 2], [3, 4]],
              type: 'TutorialDisconnected',
            });
          });
          tutorial.setupExampleButton('showConnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4],
              edges: [[1, 2], [3, 4], [1, 3]],
              type: 'TutorialConnected',
            });
          });
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // STEP 4 – Biconnected graphs (cut vertices)
      // ─────────────────────────────────────────────────────────────────────
      {
        showSPQR: false,
        title: "Biconnected Graphs",
        content: `
          <h2>Biconnected Graphs</h2>
          <p>A connected graph is <strong>biconnected</strong> if it stays connected
          even after removing <strong>any one vertex</strong> (along with its edges).</p>

          <p>A vertex whose removal disconnects the graph is called a
          <strong>cut vertex</strong>.</p>

          <h3>Not biconnected — has a cut vertex</h3>
          <p>In the path 1 – 2 – 3, vertex 2 is a cut vertex:
          removing it leaves vertices 1 and 3 disconnected.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showNonBiconnected">Show Example</button>
          </div>

          <h3>Biconnected — no cut vertex</h3>
          <p>A triangle (cycle 1 – 2 – 3 – 1) has no cut vertex:
          removing any vertex still leaves the other two connected via the remaining edge.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showBiconnected">Show Example</button>
          </div>

          <p><strong>SPQR trees are a data structure only defined on biconnected graphs.</strong></p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showNonBiconnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3],
              edges: [[1, 2], [2, 3]],
              type: 'TutorialNonBiconnected',
            });
          });
          tutorial.setupExampleButton('showBiconnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3],
              edges: [[1, 2], [2, 3], [1, 3]],
              type: 'TutorialBiconnected',
            });
          });
        }
      },
      
      {
        showSPQR: true,
        title: "SPQR trees",
        content: `
          <h2>SPQR Tree Decomposition</h2>
          <p>An SPQR tree decomposes any biconnected graph into one of three different <strong>nodes</strong>.</p>

          <h3>The Three Node Types:</h3>
          <ul>
            <li><strong>Series nodes</strong> (S): Edges arranged in a cycle</li>
            <li><strong>Parallel nodes</strong> (P): Multiple parallel paths between two vertices</li>
            <li><strong>Rigid nodes</strong> (R): Any parts of the graph that cannot be decomposed into series or parallel components</li>
          </ul>

          <p>Load the example below to see a graph that contains all three node types at once,
          then click <em>Calculate SPQR Tree</em> to see its decomposition.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSPRExample">Show Example</button>
          </div>

            <p>Hover over vertices and edges of the graph to see what node of the SPQR tree they belong to.</p>

          <p>Hover over nodes in the SPQR tree to see their<strong> skeleton </strong>in the original graph highlighted.</p>

          <p>Click on nodes to highlight them in the graph. Then hover over connected nodes to see their relations to other SPQR nodes.</p>

          <p> Note how neighboring SPQR tree nodes always share an edge, this shared edge is called a <strong> virtual edge </strong>.</p>

        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showSPRExample', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5],
              edges: [[1,5],[1,2],[2,3],[2,4],[2,5],[3,4],[3,5],[4,5]],
              type: 'TutorialSPR',
            });
          });
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // STEP – Deconstructing a graph
      // ─────────────────────────────────────────────────────────────────────
      {
        showSPQR: true,
        title: "Deconstructing a Graph",
        content: `
          <h2>Deconstructing a Graph</h2>
          <p>Load the example and click <em>Calculate SPQR Tree</em> to see the decomposition live.
          The diagram below shows exactly how the graph is split.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showDeconstructExample">Show Example</button>
          </div>

          <!-- ── Visual decomposition diagram ── -->
          <!-- Colors: P=#4682e6 (blue)  S=#32b450 (green)  R=#c86432 (orange-red)  attachment=#444 -->
          <div class="decomp-diagram">

            <!-- Full graph -->
            <div class="decomp-top">
              <p class="decomp-caption">The full graph — separation pair <strong style="color:#444">{2, 5}</strong> highlighted in orange</p>
              <svg class="decomp-svg" width="210" height="180" viewBox="0 0 210 180">
                <!-- edges not on the separation pair -->
                <line x1="36" y1="90" x2="90" y2="14"  stroke="#666" stroke-width="1.5"/>
                <line x1="36" y1="90" x2="90" y2="158" stroke="#666" stroke-width="1.5"/>
                <line x1="90" y1="14" x2="170" y2="90" stroke="#666" stroke-width="1.5"/>
                <line x1="90" y1="14" x2="130" y2="90" stroke="#666" stroke-width="1.5"/>
                <line x1="170" y1="90" x2="130" y2="90" stroke="#666" stroke-width="1.5"/>
                <line x1="170" y1="90" x2="90" y2="158" stroke="#666" stroke-width="1.5"/>
                <line x1="130" y1="90" x2="90" y2="158" stroke="#666" stroke-width="1.5"/>
                <!-- separation pair edge — shown dashed to indicate split point -->
                <line x1="90" y1="14" x2="90" y2="158" stroke="#666" stroke-width="1.5"/>
                <!-- attachment nodes (2 and 5) — dark neutral -->
                <circle cx="90"  cy="14"  r="11" fill="orange"/>
                <circle cx="90"  cy="158" r="11" fill="orange"/>
                <!-- other vertices coloured by which component they fall into -->
                <circle cx="36"  cy="90"  r="11" fill="#444"/><!-- 1 → S -->
                <circle cx="170" cy="90"  r="11" fill="#444"/><!-- 3 → R -->
                <circle cx="130" cy="90"  r="11" fill="#444"/><!-- 4 → R -->
                <text x="90"  y="14"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">2</text>
                <text x="90"  y="158" text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">5</text>
                <text x="36"  y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">1</text>
                <text x="170" y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">3</text>
                <text x="130" y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">4</text>
              </svg>
            </div>

            <div class="decomp-arrow">↓ &nbsp; split at {2, 5} &nbsp; ↓</div>

            <!-- Three pieces: S – P – R -->
            <div class="decomp-pieces">

              <!-- S component: matches full graph — 2 top-right, 1 left, 5 bottom-right -->
              <div class="decomp-piece">
                <svg class="decomp-svg" width="105" height="180" viewBox="0 0 105 180">
                  <!-- real edges -->
                  <line x1="80" y1="15"  x2="15" y2="90"  stroke="#666" stroke-width="2"/>
                  <line x1="15" y1="90"  x2="80" y2="162" stroke="#666" stroke-width="2"/>
                  <!-- virtual edge 2–5 (vertical, right side) -->
                  <line x1="80" y1="15"  x2="80" y2="162" stroke="#888" stroke-width="1.5" stroke-dasharray="5,3"/>
                  <circle cx="80" cy="15"  r="11" fill="#444"/>
                  <circle cx="15" cy="90"  r="11" fill="#32b450"/>
                  <circle cx="80" cy="162" r="11" fill="#444"/>
                  <text x="80" y="15"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">2</text>
                  <text x="15" y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">1</text>
                  <text x="80" y="162" text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">5</text>
                </svg>
                <p class="decomp-type-label decomp-type-s">Series node</p>
                <p class="decomp-caption">path 2–1–5<br><span class="decomp-virtual">— — virtual edge 2–5</span></p>
              </div>

              <!-- R component -->
              <div class="decomp-piece">
                <svg class="decomp-svg" width="90" height="180" viewBox="0 0 90 180">
                  <!-- two virtual edges (curved dashed) -->
                  <path d="M 45 15 Q 5 90 45 162"  stroke="#888" stroke-width="1.5" stroke-dasharray="5,3" fill="none"/>
                  <path d="M 45 15 Q 85 90 45 162" stroke="#888" stroke-width="1.5" stroke-dasharray="5,3" fill="none"/>
                  <!-- one real edge (solid) -->
                  <line x1="45" y1="15" x2="45" y2="162" stroke="#666" stroke-width="2"/>
                  <circle cx="45" cy="15"  r="11" fill="#4682e6"/>
                  <circle cx="45" cy="162" r="11" fill="#4682e6"/>
                  <text x="45" y="15"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">2</text>
                  <text x="45" y="162" text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">5</text>
                </svg>
                <p class="decomp-type-label decomp-type-p">Parallel node</p>
                <p class="decomp-caption">real edge 2-5 + 2 virtual edges<br>between 2 and 5</p>
              </div>

              <!-- Rigid node: matches full graph — 2 top, 5 bottom, 4 mid-right, 3 far right -->
              <!-- proportions: 4 is 41px right of 2/5 axis, 3 is 82px right (mirrors full graph ratios) -->
              <div class="decomp-piece">
                <svg class="decomp-svg" width="155" height="180" viewBox="0 0 155 180">
                  <!-- real edges -->
                  <line x1="55" y1="15"  x2="96"  y2="90" stroke="#666" stroke-width="2"/>
                  <line x1="55" y1="15"  x2="137" y2="90" stroke="#666" stroke-width="2"/>
                  <line x1="96"  y1="90" x2="137" y2="90" stroke="#666" stroke-width="2"/>
                  <line x1="96"  y1="90" x2="55"  y2="162" stroke="#666" stroke-width="2"/>
                  <line x1="137" y1="90" x2="55"  y2="162" stroke="#666" stroke-width="2"/>
                  <!-- virtual edge 2–5 -->
                  <line x1="55" y1="15"  x2="55"  y2="162" stroke="#888" stroke-width="1.5" stroke-dasharray="5,3"/>
                  <circle cx="55"  cy="15"  r="11" fill="#444"/>
                  <circle cx="55"  cy="162" r="11" fill="#444"/>
                  <circle cx="96"  cy="90"  r="11" fill="red"/>
                  <circle cx="137" cy="90"  r="11" fill="red"/>
                  <text x="55"  y="15"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">2</text>
                  <text x="55"  y="162" text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">5</text>
                  <text x="96"  y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">4</text>
                  <text x="137" y="90"  text-anchor="middle" dominant-baseline="central" fill="white" font-weight="bold">3</text>
                </svg>
                <p class="decomp-type-label decomp-type-r">Rigid node</p>
                <p class="decomp-caption">K₄ on {2,3,4,5}<br><span class="decomp-virtual">— — virtual edge 2–5</span></p>
              </div>

            </div><!-- .decomp-pieces -->
          </div><!-- .decomp-diagram -->

          <p>The <strong>P-node</strong> skeleton has just two vertices (the separation pair {2, 5}) connected
          by three parallel edges: the one real edge 2–5 and one virtual edge per child (S and R).
          The S-node and R-node each carry their own virtual edge 2–5 as a placeholder for the rest of the graph.
          Click <em>Calculate SPQR Tree</em> to see this tree live and hover over each component.</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showDeconstructExample', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5],
              edges: [[1,5],[1,2],[2,3],[2,4],[2,5],[3,4],[3,5],[4,5]],
              type: 'TutorialSPR',
            });
          });
        }
      },

      {
        showSPQR: true,
        title: "Series nodes (S)",
        content: `
          <h2>Series nodes (S)</h2>
          <p>A <strong>series (S) node</strong> contains vertices arranged in a cycle with edges or rigid/parallel components between those vertices. The cycle of vertices can have any length of 3 or more. The first example shows a simple graph, a 5-cycle, that decomposes into one S component.</p>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSeriesExample">Show Example</button>
          </div>

          <h3>Series node containing P and R children</h3>
          <p>The skeleton of a series node doesn't have to connect only single edges — each "slot" in the
          series can itself be a P or R node. Here the edge between vertices 1 and 2
          is replaced by two parallel paths (P), and the edge between 3 and 4 is replaced
          by a triconnected sub-graph on vertices 3, 4, 7, 8 (R).</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSeriesExample2">Show Example</button>
          </div>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showSeriesExample', () => {
            tutorial.callbacks.loadPreset('tutorialS');
          });
          tutorial.setupExampleButton('showSeriesExample2', () => {
            tutorial.callbacks.setPreferSRoot();
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
              edges: [
                [2,3],[4,5],[5,1],           // S backbone (no direct 1-2 or 3-4)
                [1,6],[6,2],[1,7],[7,2],      // P component between 1 and 2
                [3,8],[3,9],[4,8],[4,9],[8,9] // R component between 3 and 4
              ],
              type: 'TutorialS2',
            });
          });
        }
      },
      
      {
        showSPQR: true,
        title: "Parallel nodes (P)",
        content: `
          <h2>Parallel nodes (P)</h2>
          <p>A <strong>parallel (P) node</strong> is created when, after splitting along a separation pair, the graph breaks
          into three or more subgraphs*. Another view on this is: There are multiple paths between the separation pair.</p>
          

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showParallelExample">Show Example</button>
          </div>

          
          <p>Load the example and calculate its SPQR tree to see the parallel structure!</p>

          * if there is a real edge between the two vertices, that edge counts as one component - so the example graph splits
          into 4 subgraphs (3x Series + real edge)
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showParallelExample', () => {
            tutorial.callbacks.loadPreset('tutorialP');
          });
        }
      },
      
      {
        showSPQR: true,
        title: "Rigid nodes (R)",
        content: `
          <h2>Rigid nodes (R)</h2>
          <p>A <strong>rigid (R) nodes</strong> represents a <em>triconnected</em> component that cannot be broken down further into series or parallel components. Think of
          rigid nodes as fundamental building blocks of biconnected graphs, similar to the prime numbers in algebra or atoms in molecules.
      
          </p>
          
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showRigidExample">Show Example</button>
          </div>

          <h3>Rigid nodes as building blocks</h3>
          <p>Here, four distinct triconnected subgraphs are arranged in a 4-cycle — vertices 1–4 are the separation pairs
          and each slot between consecutive pair vertices is its own rigid nodes. Look at each R skeleton and try to
          find a separation pair not containing two of {1, 2, 3, 4}, you won't find one.</p>

          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showRigidSeriesExample">Show Example</button>
          </div>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showRigidExample', () => {
            tutorial.callbacks.loadPreset('tutorialR');
          });
          tutorial.setupExampleButton('showRigidSeriesExample', () => {
            tutorial.callbacks.setPreferSRoot();
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
              edges: [
                // R₁ between 1 and 2: wheel W₄, hub=6, outer cycle 1-5-2-7-1
                [1,5],[5,2],[2,7],[7,1],[6,1],[5,6],[6,2],[6,7],
                // R₂ between 2 and 3: K₅ (on {2,3,8,9,10})
                [2,3],[2,8],[2,9],[2,10],[3,8],[3,9],[3,10],[8,9],[8,10],[9,10],
                // R₃ between 3 and 4: K₄ (on {3,4,11,12})
                [3,4],[3,11],[3,12],[4,11],[4,12],[11,12],
                // R₄ between 4 and 1: K₃,₃ ({4,1,13} vs {14,15,16})
                [4,14],[4,15],[4,16],[1,14],[1,15],[1,16],[13,14],[13,15],[13,16],
              ],
              type: 'TutorialRSeries',
            });
          });
        }
      },

            {
        showSPQR: true,
        title: "What's the Q in SPQR?",
        content: `
          <h2>What's the Q in SPQR?</h2>
          <p>Series, parallel and rigid (SPR) nodes have been introduced by now, so what about Q in SPQR? Q nodes
          represent single edges. You can imagine a 3-cycle (triangle) being broken down further, until only three edges
          - 3 Q nodes, remain. Every node of the SPQR tree has as many Q node children as it has edges in its skeleton
          . Clearly Q nodes are always leaf nodes of the tree.</p>

                    <h2>Why weren't they mentioned before?</h2>
          <p>In many practical applications (embedding counting, proofs) Q nodes can be safely ignored/are trivial to handle.
          You will see them in few papers that make use of SPQR trees. Thus, they are also ignored on this website, apart from this one slide.</p>
          
        `,
        action: (tutorial) => {
          // Keep current example
        }
      },

      {
        showSPQR: true,
        title: "How Components Connect",
        content: `
          <h2>Virtual Edges and Tree Structure</h2>
          <p>Nodes in an SPQR tree are connected by <strong>virtual edges</strong>. Two SPQR nodes only share this edge if
          they were produced in the same splitting operation.</p>
      
                    <h3>How this website visualizes them:</h3>
          <p>Open the example below, calculate the SPQR tree, then follow these instructions:</p>
          <ul>
            <li>Click on the rigid node</li>
            <li>Notice the dotted red line - this the singular virtual edge of this rigid node</li>
            <li>Hover over the parallel node</li>
            <li>The red dotted line turned into a solid blue line! It is blue to signal it belongs to a parallel node
            and it is solid because the edge 2-5 exists in the original graph and belongs to the skeleton of the parallel node!</li>
            <li>Click on the parallel node!</li>
            <li>Hover over the series node. Now the line is green and dotted again, signaling that it is also belongs to the series node.</li>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSPRExample">Show Example</button>
          </div>

           <p>In general it is useful to click on nodes and hover neighboring nodes to see where they interface and how they
           connect. It is easier to understand the structure of both the graph and the SPQR decomposition like this!</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showSPRExample', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5],
              edges: [[1,5],[1,2],[2,3],[2,4],[2,5],[3,4],[3,5],[4,5]],
              type: 'TutorialSPR',
            });
          });
        }
      },
      
      {
        showSPQR: true,
        title: "Try It Yourself!",
        content: `
          <h2>Interactive Exploration</h2>
          <p>Now you understand the basics! Try these activities:</p>
          
          <h3>Experiments to Try:</h3>
          <ul>
            <li><strong>Draw your own graph:</strong> Use the "Draw" button to create a biconnected graph</li>
            <li><strong>Load examples:</strong> Try the Brown, Wikipedia, or Kindermann examples (outside of the tutorial)</li>
            <li><strong>Observe patterns:</strong> What makes a graph have more S vs P vs R components?</li>
            <li><strong>Modify graphs:</strong> Add or remove edges and see how the SPQR tree changes</li>
          </ul>
          
         <p>Advanced features:</p>
                   <ul>
            <li><strong>Generate a drawing of your graph:</strong> Use the "Draw from SPQR" button to get a drawing of the graph matching the SPQR tree structure. Planarity (if possible) is guaranteed.</li>
            <li><strong>Switch through embeddings:</strong> This drawing algorithm let's you swap through embeddings by clicking "Reorder children" on parallel nodes and "Flip" on rigid nodes.</li>
            <li><strong>Change settings:</strong> The small gear button lets you enable/disable vertex and node annotations.</li>
            <li><strong>Reroot a tree:</strong> Reroot the SPQR tree on another node, this will also impact the drawing from "Draw from SPQR".</li>
          </ul>

        `,
        action: (tutorial) => {
          // Leave in exploration mode
        }
      },
      
      {
        showSPQR: true,
        title: "Tutorial Complete!",
        content: `
          <h2>Congratulations! 🎉</h2>
          <p>You've completed the SPQR tree tutorial!</p>
          
          <h3>What You've Learned:</h3>
          <ul>
            <li>✓ Graphs: vertices and edges</li>
            <li>✓ Connected graphs and paths</li>
            <li>✓ Biconnected graphs and cut vertices</li>
            <li>✓ S-components (series composition)</li>
            <li>✓ P-components (parallel composition)</li>
            <li>✓ R-components (rigid/triconnected)</li>
            <li>✓ How SPQR trees represent graph structure</li>
          </ul>
          
          <h3>Continue Exploring:</h3>
          <p>Feel free to experiment with the tool! You can:</p>
          <ul>
            <li>Create custom graphs using the input form or draw tool</li>
            <li>Explore the example graphs in the sidebar</li>
            <li>Observe how different graph structures lead to different decompositions</li>
          </ul>
          
          <p><strong>Exit the tutorial to continue using the tool freely.</strong></p>
        `,
        action: (tutorial) => {
          // Final step
        }
      }
    ];
  }
  
  start(initialStep = 0) {
    this.isActive = true;
    this.currentStep = initialStep;
    this.panel.style.display = 'flex';

    // Hide the sidebar to make more space
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.display = 'none';
    }

    // Add class to layout for styling
    const layout = document.querySelector('.layout');
    if (layout) {
      layout.classList.add('tutorial-active');
    }

    this.showStep(initialStep);
  }
  
  exit() {
    this.isActive = false;
    this.panel.style.display = 'none';
    this.currentStep = 0;

    // Restore the SPQR canvas
    const spqrWrapper = document.getElementById('spqr-canvas-wrapper');
    if (spqrWrapper) {
      spqrWrapper.style.display = 'inline-block';
    }

    // Show the sidebar again
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.style.display = 'flex';
    }

    // Remove tutorial-active class from layout
    const layout = document.querySelector('.layout');
    if (layout) {
      layout.classList.remove('tutorial-active');
    }

    // Reset URL back to root
    history.pushState(null, '', '/');
  }

  nextStep() {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      this.showStep(this.currentStep);
    }
  }

  previousStep() {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.showStep(this.currentStep);
    }
  }

  goToStep(stepIndex) {
    const clamped = Math.max(0, Math.min(stepIndex, this.steps.length - 1));
    this.currentStep = clamped;
    this.showStep(clamped);
  }
  
  showStep(stepIndex) {
    const step = this.steps[stepIndex];

    // Sync URL to the current step (1-indexed)
    history.pushState(null, '', `/tutorial/${stepIndex + 1}`);

    // Clear the graph when navigating between steps
    if (this.callbacks.clearGraph) {
      this.callbacks.clearGraph();
    }

    // Show or hide the SPQR canvas depending on the step
    const spqrWrapper = document.getElementById('spqr-canvas-wrapper');
    if (spqrWrapper) {
      spqrWrapper.style.display = step.showSPQR ? 'inline-block' : 'none';
    }

    // Update content
    this.textDiv.innerHTML = step.content;

    // Update progress
    this.progressSpan.textContent = `Step ${stepIndex + 1} of ${this.steps.length}`;

    // Update button states
    this.prevBtn.disabled = stepIndex === 0;
    this.nextBtn.textContent = stepIndex === this.steps.length - 1 ? 'Finish' : 'Next';

    // Execute step action
    if (step.action) {
      step.action(this);
    }

    // Scroll to top of tutorial content
    this.contentDiv.scrollTop = 0;
  }
  
  setupExampleButton(action, callback) {
    // Find button with matching data-action attribute
    // Use requestAnimationFrame for better reliability
    requestAnimationFrame(() => {
      const button = this.textDiv.querySelector(`[data-action="${action}"]`);
      if (button) {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          console.log(`Tutorial: Executing action '${action}'`);
          callback();
        });
        console.log(`Tutorial: Button '${action}' attached`);
      } else {
        console.warn(`Tutorial: Button with action '${action}' not found`);
      }
    });
  }
}

// Export default for easy import
export default Tutorial;
