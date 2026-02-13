# Tutorial System - Quick Start Guide

## How to Use the Tutorial

### Starting the Tutorial
1. Open your SPQR app in a browser
2. Look for the **"Start Tutorial"** button at the top of the sidebar
3. Click it to begin the interactive tutorial

### Navigating the Tutorial
- **Next button**: Move to the next step
- **Previous button**: Go back to previous step (disabled on first step)
- **Exit Tutorial button**: Leave tutorial mode at any time
- **Progress indicator**: Shows "Step X of Y"

### Interactive Features
- **Example buttons**: Click blue buttons in the tutorial content to load example graphs
- **Live demonstrations**: Examples appear directly in the canvas
- **Try it yourself**: The tutorial encourages you to experiment

## Tutorial Content Overview

### Current Tutorial Steps:

1. **Welcome** - Overview of what you'll learn
2. **Non-Biconnected Example** - Understanding cut vertices
3. **Biconnected Example** - Valid graphs for SPQR decomposition
4. **SPQR Decomposition Intro** - S, P, R component types
5. **S-Components** - Series composition with example
6. **P-Components** - Parallel composition with example
7. **R-Components** - Rigid/triconnected with example
8. **Virtual Edges** - How components connect
9. **Try It Yourself** - Guided exploration
10. **Completion** - Summary and congratulations

## How to Extend the Tutorial

### Adding a New Step

Edit `js/tutorial.js` and add a new step object to the `steps` array in `createTutorialSteps()`:

```javascript
{
  title: "Your Step Title",
  content: `
    <h2>Step Heading</h2>
    <p>Your explanation text here.</p>
    
    <h3>Subheading</h3>
    <ul>
      <li>Bullet point 1</li>
      <li>Bullet point 2</li>
    </ul>
    
    <div class="tutorial-action">
      <button class="tutorial-example-btn" data-action="yourAction">
        Load Example
      </button>
    </div>
  `,
  action: (tutorial) => {
    // Optional: Execute code when step is shown
    tutorial.setupExampleButton('yourAction', () => {
      tutorial.callbacks.loadGraph({
        vertices: [1, 2, 3],
        edges: [[1, 2], [2, 3]]
      });
    });
  }
}
```

### Adding Interactive Examples

#### Load a Preset Graph:
```javascript
tutorial.setupExampleButton('myAction', () => {
  tutorial.callbacks.loadPreset('tutorialP');
});
```

Available presets:
- `'tutorialP'` - P-component example
- `'tutorialS'` - S-component example
- `'tutorialR'` - R-component example
- `'brown'` - Brown graph
- `'wikipedia'` - Wikipedia example
- `'db'` - DiBattista graph
- `'kindermann'` - Kindermann graph

#### Load a Custom Graph:
```javascript
tutorial.setupExampleButton('myAction', () => {
  tutorial.callbacks.loadGraph({
    vertices: [1, 2, 3, 4],
    edges: [[1, 2], [2, 3], [3, 4], [4, 1]]
  });
});
```

#### Clear Canvases:
```javascript
tutorial.callbacks.clearGraph();
```

#### Trigger SPQR Calculation:
```javascript
tutorial.callbacks.calculateSPQR();
```

### HTML Content Formatting

Use these HTML elements in your `content` strings:

- `<h2>` - Main heading (styled with blue underline)
- `<h3>` - Subheading (smaller, darker)
- `<p>` - Paragraph text
- `<ul>` / `<ol>` - Lists
- `<strong>` - Bold/important text
- `<em>` - Italic/emphasis
- `<div class="tutorial-action">` - Highlighted action box
- `<button class="tutorial-example-btn" data-action="...">` - Interactive button

### CSS Classes Available

#### Tutorial-specific:
- `.tutorial-action` - Highlighted box for actions
- `.tutorial-example-btn` - Blue button for examples
- `.tutorial-nav-btn` - Navigation buttons (styled automatically)
- `.tutorial-exit-btn` - Red exit button (styled automatically)

## Customizing the Tutorial

### Change Tutorial Overlay Position
Edit `css/styles.css`, find `#tutorial-overlay` and modify positioning.

### Modify Colors
Update these CSS rules:
- `.tutorial-example-btn` - Example button color
- `.tutorial-nav-btn` - Navigation button color
- `.tutorial-exit-btn` - Exit button color
- `#tutorial-text h2` - Heading color and border

### Adjust Tutorial Width
By default, the overlay covers the full input canvas. Modify:
```css
#tutorial-overlay {
  width: 100%; /* Change to adjust width */
}
```

## Tips for Writing Tutorial Content

### Good Practices:
1. **Start with the "why"** - Explain why something matters
2. **Use examples** - Show, don't just tell
3. **Progressive complexity** - Build on previous steps
4. **Interactive elements** - Let users try things
5. **Keep it concise** - One main concept per step
6. **Use visuals** - Load examples to demonstrate

### Content Guidelines:
- Assume basic graph theory knowledge (vertices, edges)
- Define technical terms when first used
- Use bullet points for lists of properties
- Include examples for each concept
- Provide "Try it yourself" opportunities

## Troubleshooting

### Tutorial button doesn't appear
- Check that `index.html` has `id="tutorial-btn"` on the button
- Verify button is in the sidebar `<section class="panel">`

### Tutorial overlay doesn't show
- Check browser console for JavaScript errors
- Verify `tutorial.js` is imported in `main.js`
- Check that `#tutorial-overlay` is in `index.html`

### Example buttons don't work
- Ensure `data-action` attribute matches the action name in `setupExampleButton()`
- Check that the callback is defined in `action` function
- Verify tutorial callbacks are properly configured

### Styling looks wrong
- Clear browser cache
- Check that `styles.css` includes tutorial styles
- Inspect elements with browser DevTools

## Advanced Features

### Add Step Conditions
You can add logic to skip or require certain conditions:

```javascript
action: (tutorial) => {
  // Only proceed if graph is loaded
  if (!tutorial.state.data.graphNodes) {
    alert("Please load a graph first!");
    return;
  }
  // Continue with step...
}
```

### Add Step Validation
Before allowing Next, validate user actions:

```javascript
// In tutorial.js nextStep() method, add:
if (this.currentStep === 5 && !this.validateStep5()) {
  alert("Please complete the example first!");
  return;
}
```

### Track User Progress
Store progress in localStorage:

```javascript
// When step changes
localStorage.setItem('tutorialProgress', this.currentStep);

// On tutorial start
const savedProgress = localStorage.getItem('tutorialProgress');
if (savedProgress) {
  this.currentStep = parseInt(savedProgress);
}
```

## Testing Your Changes

After making changes:

1. **Refresh the browser** (Ctrl+Shift+R to hard refresh)
2. **Check browser console** for errors
3. **Test navigation** - Go through all steps
4. **Test examples** - Click all example buttons
5. **Test exit** - Ensure exit button works
6. **Test responsiveness** - Try different window sizes

## Need Help?

Common issues and solutions are in the main `TUTORIAL_FRAMEWORK.md` file.
