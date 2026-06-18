/**
 * Tutorial Module for SPQR Trees
 * Provides an interactive tutorial explaining SPQR tree decomposition
 */

import DecompositionAnimation from './decompositionAnimation.js';

export class Tutorial {
  constructor(state, elements, callbacks) {
    this.state = state;
    this.elements = elements;
    this.callbacks = callbacks;
    
    this.currentStep = 0;
    this.isActive = false;

    // Bespoke decomposition animation ("Deconstructing a Graph" slide); created on demand.
    this.decompAnimation = null;

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

  // Build a base-path-aware in-app URL (e.g. "tutorial/5"). Falls back to a
  // root-absolute path if no buildAppUrl callback was provided.
  appUrl(route = '') {
    if (this.callbacks && this.callbacks.buildAppUrl) {
      return this.callbacks.buildAppUrl(route);
    }
    return '/' + String(route).replace(/^\/+/, '');
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
            <li><a href="${this.appUrl('tutorial/2')}" data-step="1">What is a graph? (vertices &amp; edges)</a></li>
            <li><a href="${this.appUrl('tutorial/3')}" data-step="2">What is a connected graph?</a></li>
            <li><a href="${this.appUrl('tutorial/4')}" data-step="3">What is a biconnected graph?</a></li>
          </ol>

          <h4 class="toc-section-label">SPQR Trees</h4>
          <ol class="toc-list" start="4">
            <li><a href="${this.appUrl('tutorial/5')}" data-step="4">Introduction &amp; decomposing a graph</a></li>
            <li><a href="${this.appUrl('tutorial/6')}" data-step="5">How components connect into a tree</a></li>
            <li>
              The three component types:
              <ul class="toc-sublist">
                <li><a href="${this.appUrl('tutorial/7')}" data-step="6"><strong>S</strong> — Series components</a></li>
                <li><a href="${this.appUrl('tutorial/8')}" data-step="7"><strong>P</strong> — Parallel components</a></li>
                <li><a href="${this.appUrl('tutorial/9')}" data-step="8"><strong>R</strong> — Rigid components</a></li>
              </ul>
            </li>
            <li><a href="${this.appUrl('tutorial/11')}" data-step="10">Embeddings &amp; swapping between them</a></li>
            <li><a href="${this.appUrl('tutorial/12')}" data-step="11">Try it yourself</a></li>
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
          removing any vertex still leaves the other two connected via the remaining edge. You would need to remove two vertices - a separation pair - to split this graph apart.</p>

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
          <p>An SPQR tree decomposes any biconnected graph into its triconnected (need to remove three vertices for the graph to split) components. Each resulting triconnected component
              falls into one of the following three types (that give SPQR trees their name):</p>

          <h3>The Three Component Types:</h3>
          <ul>
            <li><strong>Series component</strong> (S): The triconnected component is a cycle graph (triangle, rectangle etc.)</li>
            <li><strong>Parallel nodes</strong> (P): The triconnected component consists of multiple edges between two vertices</li>
            <li><strong>Rigid nodes</strong> (R): Any parts of the graph that cannot be decomposed into series or parallel components</li>
          </ul>

          <p>The SPQR tree is the generalisation of the SP(Q) tree, that you may recognise from series-parallel graphs. SPQR trees function equivalently to SP(Q) trees on series-parallel graphs, with the
          introduction of rigid components allowing them to handle all biconnected graphs (superset of series-parallel graphs).</p>

          s
          <h2>Decomposing the Graph</h2>
          <p>Step through the animation below at your own pace to see how the SPQR decomposition works: a
          graph is taken apart into its series, parallel and rigid components by splitting the graph at its separation
          pairs. Separation pairs are pairs of two vertices whose combined removal splits the graph ({2,&nbsp;5} in this case).</p>

          <div id="decomp-anim-container" class="decomp-anim-container"></div>
        `,
        action: (tutorial) => {
          tutorial.mountDecompositionAnimation();
        }
      },

      {
        showSPQR: true,
        title: "How Components Connect",
        content: `
          <h2>Virtual Edges and Tree Structure</h2>
          <p>Nodes in an SPQR tree are connected by <strong>virtual edges</strong>. Two SPQR nodes only share this edge if
          they were produced in the same splitting operation. If glue all nodes of the SPQR tree together at their virtual edge interfaces, you end up with the original graph.</p>

          <p>To each node of the SPQR tree belongs its <strong>skeleton</strong>, the graph of the component corresponding to this node.
          It consists of all vertices of the component (including splitting spair) and the edges between them. The edges of the skeleton are <em>real edge</em> (one that exists in
          the original graph) combined with its <em>virtual edges</em> (a placeholder that stands for the neighbouring component). In the SPQR tree nodes on this page you see the skeleton of the corresponding component in a little pictogram.</p>

                    <h3>How this website visualises SPQE trees:</h3>
          <p>Open the example below, calculate the SPQR tree, then follow these instructions:</p>
          <ul>
            <li>Click on the rigid node (red, labelled with R) in the SPQR tree</li>
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
        title: "Series nodes (S)",
        content: `
          <h2>Series nodes (S)</h2>
          <p>A <strong>series (S) node</strong> contains vertices arranged in a cycle with edges or rigid/parallel components between those vertices. The cycle of vertices can have any length of 3 or more. The first example shows a simple graph, a 5-cycle, that decomposes into one S component.</p>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSeriesExample">Show Example</button>
          </div>

          <h3>Series node containing P and R children</h3>
          <p>The path between vertices of a series component does not have to be a single edges — each edge in the
          skeleton may be a virtual edge, standing for a P or R component. In this second example, the edge between vertices 1 and 2
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
          into 4 subgraphs (3x series components + real edge)
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
          You will see them in few papers that make use of SPQR trees. Thus they are also ignored on this website, apart from this one slide.</p>
          
        `,
        action: (tutorial) => {
          // Keep current example
        }
      },

      {
        showSPQR: true,
        title: "Embeddings",
        toolPhase: 'embeddings',
        content: `
          <h2>Embeddings: an example of the utility of SPQR trees</h2>
          <p>A <strong>(combinatorial) embedding</strong> of a planar graph is a way of drawing it in the plane
          without edge crossings. Concretely, it is fixed by the <em>cyclic order</em> of the edges around each
          vertex. The same graph can usually be drawn without crossings in several combinatorially different ways —
          each such way is a different embedding.</p>

          <h3>Where SPQR trees come in</h3>
          <p>An SPQR tree captures <strong>all</strong> planar embeddings of a biconnected
          graph at once in its parallel and rigid nodes:</p>
          <ul>
            <li><strong>Parallel nodes</strong>: the parallel components between a separation pair may be permutated arbitrarily,
             so each P node lets you <em>reorder its neighbors</em>.</li>
            <li><strong>Rigid nodes</strong>: the skeleton of the rigid node has exactly one embedding up to a
            <em>flip</em> (mirror), so each rigid component may be embedded in two ways.</li>
          </ul>
          <p>Combining the choices for all component gives the total number of embeddings of the graph.  The
          <strong>#embeddings</strong> count of this tool provides this.</p>

                    <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showEmbeddingExample">Show Example</button>
          </div>

          <h3>Try swapping between embeddings</h3>
          <p>Load the example, then:</p>
          <ul>
            <li>Click <em>Calculate SPQR Tree</em>, then <em>Draw from SPQR</em> to get a crossing-free drawing
            built from the decomposition.</li>
            <li>Select a <strong style="color:#4682e6">P node</strong> and use <em>Switch Embedding</em> →
            <em>Reorder children</em> to change the order of its parts.</li>
            <li>Select an <strong style="color:#e0492f">R-node</strong> and use <em>Switch Embedding</em> →
            <em>Flip</em> to mirror it.</li>
          </ul>
          <p>Each action keeps the drawing planar but produces a different embedding — you are walking through
          the very choices the SPQR tree encodes.</p>

        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showEmbeddingExample', () => {
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
        toolPhase: 'tryit',
        content: `
          <h2>Interactive Exploration</h2>
          <h4>Try these features:</h4>
  
          <ul>
            <li><strong>Draw your own graph:</strong> Use the "Draw" button to create a biconnected graph</li>
            <li><strong>Load predefined graphs:</strong> Try the Brown, Wikipedia, or Kindermann examples (outside of the tutorial)</li>
            <li><strong>Observe patterns:</strong> What makes a graph have more S vs P vs R components?</li>
            <li><strong>Modify graphs:</strong> Add or remove edges and see how the SPQR tree changes</li>
          </ul>
          
         <h4>More advanced features:</h4>
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
        title: "End of tutorial",
        toolPhase: 'tryit',
        content: `
          <h2>End of tutorial</h2>
          <p>That covers the basics of SPQR trees. Exit the tutorial to use the tool freely.</p>

          <h3>Further reading</h3>
          <ul>
            <li><a href="https://www.youtube.com/watch?v=n2Hqjphak3s" target="_blank" rel="noopener noreferrer">Talk by Philipp Kindermann on SPQR trees</a> (video)</li>
            <li><a href="https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/planarity.pdf" target="_blank" rel="noopener noreferrer">“Planarity Testing and Embedding”</a> — chapter from the Handbook of Graph Drawing and Visualization (PDF)</li>
            <li><a href="https://en.wikipedia.org/wiki/SPQR_tree" target="_blank" rel="noopener noreferrer">SPQR tree</a> — Wikipedia article</li>
          </ul>
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

    this.destroyDecompositionAnimation();

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

    // Remove tutorial-active and any phase class from layout
    const layout = document.querySelector('.layout');
    if (layout) {
      layout.classList.remove(
        'tutorial-active',
        'tut-phase-base', 'tut-phase-embeddings', 'tut-phase-tryit'
      );
    }

    // Reset URL back to the app root (base-path aware)
    history.pushState(null, '', this.appUrl(''));
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

    // Tear down any animation from the previous step before re-rendering.
    this.destroyDecompositionAnimation();

    // Sync URL to the current step (1-indexed), base-path aware.
    history.pushState(null, '', this.appUrl(`tutorial/${stepIndex + 1}`));

    // Clear the graph when navigating between steps
    if (this.callbacks.clearGraph) {
      this.callbacks.clearGraph();
    }

    // Show or hide the SPQR canvas depending on the step
    const spqrWrapper = document.getElementById('spqr-canvas-wrapper');
    if (spqrWrapper) {
      spqrWrapper.style.display = step.showSPQR ? 'inline-block' : 'none';
    }

    // Apply the canvas-button phase for this step (defaults to 'base').
    // CSS uses .tut-phase-<name> to reveal an allow-list of toolbar buttons.
    const layout = document.querySelector('.layout');
    if (layout) {
      layout.classList.remove('tut-phase-base', 'tut-phase-embeddings', 'tut-phase-tryit');
      layout.classList.add(`tut-phase-${step.toolPhase || 'base'}`);
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

  // Mount the bespoke SPQR decomposition animation into the current slide.
  // Waits a frame so the step's HTML (and its container) is in the DOM.
  mountDecompositionAnimation() {
    this.destroyDecompositionAnimation();
    requestAnimationFrame(() => {
      const container = this.textDiv.querySelector('#decomp-anim-container');
      if (container) {
        this.decompAnimation = new DecompositionAnimation(container, {
          // Final animation step: load the example graph and calculate its
          // SPQR tree on the main canvases.
          onLoadExample: () => {
            this.callbacks.loadGraph({
              vertices: [1, 2, 3, 4, 5],
              edges: [[1, 5], [1, 2], [2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]],
              type: 'TutorialSPR',
            });
            if (this.callbacks.calculateSPQR) {
              this.callbacks.calculateSPQR();
            }
          },
        });
      }
    });
  }

  destroyDecompositionAnimation() {
    if (this.decompAnimation) {
      this.decompAnimation.destroy();
      this.decompAnimation = null;
    }
  }
}

// Export default for easy import
export default Tutorial;
