/**
 * Pure geometry helpers for fitting the input drawing and defining semantic
 * zoom. Keeping these calculations independent from D3 makes the two canvas
 * coordinate systems explicit and testable.
 */

const DEFAULT_MIN_SPAN = 1;

function finitePoint(point) {
  return point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y));
}

function includePoint(bounds, point) {
  if (!finitePoint(point)) return;
  const x = Number(point.x);
  const y = Number(point.y);
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

export function boundsFromPoints(points) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
  for (const point of points || []) includePoint(bounds, point);
  if (!Number.isFinite(bounds.minX)) return null;
  return bounds;
}

/** Include vertices and every supported routed-edge control point. */
export function getInputDrawingBounds(positions, edgeRoutes = new Map()) {
  const points = [];
  for (const point of positions?.values?.() || []) points.push(point);

  for (const route of edgeRoutes?.values?.() || []) {
    if (Array.isArray(route?.points)) points.push(...route.points);
    if (route?.control) points.push(route.control);
    if (route?.cp1) points.push(route.cp1);
    if (route?.cp2) points.push(route.cp2);
  }

  return boundsFromPoints(points);
}

/**
 * Fit drawing-coordinate bounds into an SVG viewBox-coordinate viewport.
 * D3 zoom translations are expressed in viewBox units, not CSS client pixels.
 */
export function fitBoundsToViewport(
  bounds,
  viewport,
  { padding = 50, minSpan = DEFAULT_MIN_SPAN } = {}
) {
  if (!bounds || !viewport || !(viewport.width > 0) || !(viewport.height > 0)) {
    return null;
  }

  const safePadding = Math.max(
    0,
    Math.min(Number(padding) || 0, viewport.width / 2 - 0.5, viewport.height / 2 - 0.5)
  );
  const spanX = Math.max(minSpan, bounds.maxX - bounds.minX);
  const spanY = Math.max(minSpan, bounds.maxY - bounds.minY);
  const availableWidth = Math.max(1, viewport.width - 2 * safePadding);
  const availableHeight = Math.max(1, viewport.height - 2 * safePadding);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const drawingCenterX = (bounds.minX + bounds.maxX) / 2;
  const drawingCenterY = (bounds.minY + bounds.maxY) / 2;
  const viewportCenterX = (viewport.x || 0) + viewport.width / 2;
  const viewportCenterY = (viewport.y || 0) + viewport.height / 2;

  return {
    scale,
    translateX: viewportCenterX - drawingCenterX * scale,
    translateY: viewportCenterY - drawingCenterY * scale
  };
}

/**
 * Pick a zoom range large enough to make even the smallest allocated SPQR
 * component region fill the viewport. The result is relative to the fitted
 * input view, so it remains stable if the drawing-coordinate canvas changes.
 */
export function getAdaptiveInputMaxZoomRatio(
  componentPoses,
  viewport,
  referenceScale,
  {
    padding = 60,
    minimum = 64,
    maximum = 32768,
    overscan = 1.25
  } = {}
) {
  if (!(referenceScale > 0) || !viewport) return minimum;

  let requiredRatio = minimum;
  for (const pose of componentPoses?.values?.() || []) {
    const bounds = boundsFromPoints(pose?.regionPoints);
    if (!bounds) continue;
    const fit = fitBoundsToViewport(bounds, viewport, {
      padding,
      minSpan: 1e-6
    });
    if (!fit || !(fit.scale > 0)) continue;
    requiredRatio = Math.max(requiredRatio, (fit.scale / referenceScale) * overscan);
  }

  return Math.max(minimum, Math.min(maximum, requiredRatio));
}

/**
 * Convert a visual size at the fitted view into drawing coordinates.
 * Visual growth follows the app's existing sqrt(zoom) cue up to the legacy
 * 10x range, then stays bounded so deep zoom cannot create enormous nodes,
 * labels, strokes, or hit areas.
 */
export function getInputZoomAdjustedLength(
  baseLength,
  zoomScale,
  referenceScale,
  { maxVisualZoomRatio = 10 } = {}
) {
  const base = Number(baseLength);
  const zoom = Number(zoomScale);
  const reference = Number(referenceScale);
  if (!Number.isFinite(base) || !(zoom > 0) || !(reference > 0)) return base;

  const relativeZoom = zoom / reference;
  const visualGrowth = Math.sqrt(Math.min(relativeZoom, maxVisualZoomRatio));
  return (base * visualGrowth) / zoom;
}
