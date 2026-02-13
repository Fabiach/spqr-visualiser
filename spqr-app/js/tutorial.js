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
  }
  
  createTutorialSteps() {
    return [
      {
        title: "Welcome to SPQR Trees!",
        content: `
          <h2>Welcome to the SPQR Tree Tutorial!</h2>
          <p>This interactive tutorial will guide you through understanding SPQR trees - 
          a powerful data structure for representing the structure of biconnected graphs.</p>
          
          <h3>What You'll Learn:</h3>
          <ul>
            <li>What biconnected graphs are and why they matter</li>
            <li>The three types of components: <strong>S</strong> (Series), <strong>P</strong> (Parallel), and <strong>R</strong> (Rigid)</li>
            <li>How SPQR trees decompose graphs into these components</li>
            <li>Interactive examples using this tool</li>
          </ul>
          
          <p><em>Assumption: This tutorial assumes you're familiar with basic graph theory 
          (vertices, edges, neighbors), but no prior knowledge of graph decompositions is required.</em></p>
        `,
        action: (tutorial) => {
          // Clear both canvases
          if (tutorial.callbacks.clearGraph) {
            tutorial.callbacks.clearGraph();
          }
        }
      },
      
      {
        title: "Biconnected Graphs",
        content: `
          <h2>What is a Biconnected Graph?</h2>
          <p>A graph is <strong>biconnected</strong> if:</p>
          <ul>
            <li>It remains connected even after removing any single vertex</li>
            <li>It has no <em>cut vertices</em> (also called articulation points)</li>
          </ul>
          
          <h3>Why Biconnected?</h3>
          <p>SPQR trees are only defined for biconnected graphs. This ensures the decomposition 
          is well-defined and unique.</p>
          
          <h3>Example - Not Biconnected:</h3>
          <p>Draw a simple path graph in the left canvas: three vertices connected in a line (1-2-3).
          Notice that vertex 2 is a cut vertex - removing it disconnects the graph.</p>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showNonBiconnected">Show Example</button>
          </div>
        `,
        action: (tutorial) => {
          // Set up example action
          tutorial.setupExampleButton('showNonBiconnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3],
              edges: [[1, 2], [2, 3]]
            });
          });
        }
      },
      
      {
        title: "Biconnected Graph Example",
        content: `
          <h2>A Biconnected Graph</h2>
          <p>Now let's look at a biconnected graph. Consider a triangle (cycle of length 3).</p>
          
          <p>In this graph, you can remove any vertex and the remaining two vertices are still connected.
          There are no cut vertices!</p>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showBiconnected">Show Triangle</button>
          </div>
          
          <p>This is the simplest biconnected graph. All SPQR decompositions work on graphs like this.</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showBiconnected', () => {
            tutorial.callbacks.loadGraph({
              vertices: [1, 2, 3],
              edges: [[1, 2], [2, 3], [1, 3]]
            });
          });
        }
      },
      
      {
        title: "Introduction to SPQR Decomposition",
        content: `
          <h2>SPQR Tree Decomposition</h2>
          <p>An SPQR tree decomposes a biconnected graph into simpler pieces called <strong>components</strong>.</p>
          
          <h3>The Three Component Types:</h3>
          <ul>
            <li><strong>S-components</strong> (Series): Edges in series - a simple path</li>
            <li><strong>P-components</strong> (Parallel): Edges in parallel - multiple edges between two vertices</li>
            <li><strong>R-components</strong> (Rigid): Triconnected graphs that can't be decomposed further</li>
          </ul>
          
          <p><em>Note: Q-components (single edges) also exist but are less important for understanding the structure.</em></p>
          
          <p>Let's explore each type with examples!</p>
        `,
        action: (tutorial) => {
          if (tutorial.callbacks.clearGraph) {
            tutorial.callbacks.clearGraph();
          }
        }
      },
      
      {
        title: "S-Components (Series)",
        content: `
          <h2>S-Components: Series Composition</h2>
          <p>An <strong>S-component</strong> represents edges arranged in <em>series</em> - like a simple path.</p>
          
          <h3>Key Properties:</h3>
          <ul>
            <li>A sequence of vertices connected in a line</li>
            <li>Each internal vertex has degree 2</li>
            <li>Represents parts of the graph where edges form a chain</li>
          </ul>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showSeriesExample">Load S-Component Example</button>
          </div>
          
          <p>Click the button to load an example, then click "Recalculate SPQR-Tree" to see the decomposition!</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showSeriesExample', () => {
            tutorial.callbacks.loadPreset('tutorialS');
          });
        }
      },
      
      {
        title: "P-Components (Parallel)",
        content: `
          <h2>P-Components: Parallel Composition</h2>
          <p>A <strong>P-component</strong> represents edges arranged in <em>parallel</em> - 
          multiple paths between the same two vertices.</p>
          
          <h3>Key Properties:</h3>
          <ul>
            <li>Multiple edges (or paths) connecting the same two vertices</li>
            <li>Represents alternative routes between two points</li>
            <li>Common in graphs with redundancy</li>
          </ul>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showParallelExample">Load P-Component Example</button>
          </div>
          
          <p>Load the example and calculate its SPQR tree to see parallel structure!</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showParallelExample', () => {
            tutorial.callbacks.loadPreset('tutorialP');
          });
        }
      },
      
      {
        title: "R-Components (Rigid)",
        content: `
          <h2>R-Components: Rigid Composition</h2>
          <p>An <strong>R-component</strong> is a <em>triconnected</em> graph - the most rigid structure.</p>
          
          <h3>Key Properties:</h3>
          <ul>
            <li>Cannot be decomposed further into S or P components</li>
            <li>Remains connected after removing any two vertices</li>
            <li>Represents the "core structure" that can't be simplified</li>
            <li>Example: K₄ (complete graph on 4 vertices)</li>
          </ul>
          
          <div class="tutorial-action">
            <button class="tutorial-example-btn" data-action="showRigidExample">Load R-Component Example</button>
          </div>
          
          <p>R-components are where the interesting structure lives!</p>
        `,
        action: (tutorial) => {
          tutorial.setupExampleButton('showRigidExample', () => {
            tutorial.callbacks.loadPreset('tutorialR');
          });
        }
      },
      
      {
        title: "How Components Connect",
        content: `
          <h2>Virtual Edges and Tree Structure</h2>
          <p>Components in an SPQR tree are connected by <strong>virtual edges</strong>.</p>
          
          <h3>Key Concepts:</h3>
          <ul>
            <li>Each virtual edge appears in exactly two components</li>
            <li>Virtual edges represent shared "connection points" between components</li>
            <li>The SPQR tree shows how components are hierarchically organized</li>
          </ul>
          
          <h3>Tree Structure:</h3>
          <p>The right canvas shows the SPQR tree itself, where:</p>
          <ul>
            <li>Each node is a component (S, P, or R)</li>
            <li>Edges connect components that share virtual edges</li>
            <li>The tree structure reveals the graph's decomposition</li>
          </ul>
        `,
        action: (tutorial) => {
          // Keep current example
        }
      },
      
      {
        title: "Try It Yourself!",
        content: `
          <h2>Interactive Exploration</h2>
          <p>Now you understand the basics! Try these activities:</p>
          
          <h3>Experiments to Try:</h3>
          <ol>
            <li><strong>Draw your own graph:</strong> Use the "Draw" button to create a biconnected graph</li>
            <li><strong>Load examples:</strong> Try the Brown, Wikipedia, or Kindermann examples</li>
            <li><strong>Observe patterns:</strong> What makes a graph have more S vs P vs R components?</li>
            <li><strong>Modify graphs:</strong> Add or remove edges and see how the SPQR tree changes</li>
          </ol>
          
          <h3>Things to Notice:</h3>
          <ul>
            <li>How adding triangles creates R-components</li>
            <li>How parallel paths create P-components</li>
            <li>How long chains create S-components</li>
          </ul>
        `,
        action: (tutorial) => {
          // Leave in exploration mode
        }
      },
      
      {
        title: "Tutorial Complete!",
        content: `
          <h2>Congratulations! 🎉</h2>
          <p>You've completed the SPQR tree tutorial!</p>
          
          <h3>What You've Learned:</h3>
          <ul>
            <li>✓ Biconnected graphs and their importance</li>
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
  
  start() {
    this.isActive = true;
    this.currentStep = 0;
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
    
    this.showStep(0);
  }
  
  exit() {
    this.isActive = false;
    this.panel.style.display = 'none';
    this.currentStep = 0;
    
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
  
  showStep(stepIndex) {
    const step = this.steps[stepIndex];
    
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
