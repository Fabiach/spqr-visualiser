const COMPONENT_COLORS = Object.freeze({
  R: "red",
  S: "green",
  P: "blue",
});

export function getSPQRComponentColor(componentOrType, fallback = "orange") {
  const type = typeof componentOrType === "object"
    ? componentOrType?.type
    : componentOrType;
  return COMPONENT_COLORS[type] ?? fallback;
}

/**
 * Choose attachment points for a link between two SPQR-node boxes.
 * Tree mode always uses top/bottom ports. Free-positioning mode may switch to
 * left/right ports once the boxes are placed beside one another.
 */
export function getInterComponentEdgePorts(posA, boxA, posB, boxB, freePositioning) {
  if (!posA || !boxA || !posB || !boxB) return null;

  const centerA = {
    x: posA.x + boxA.x + boxA.width / 2,
    y: posA.y + boxA.y + boxA.height / 2,
  };
  const centerB = {
    x: posB.x + boxB.x + boxB.width / 2,
    y: posB.y + boxB.y + boxB.height / 2,
  };
  const deltaX = Math.abs(centerB.x - centerA.x);
  const deltaY = Math.abs(centerB.y - centerA.y);
  const upperBottom = centerA.y <= centerB.y
    ? posA.y + boxA.y + boxA.height
    : posB.y + boxB.y + boxB.height;
  const lowerTop = centerA.y <= centerB.y
    ? posB.y + boxB.y
    : posA.y + boxA.y;
  const boxesOverlapVertically = lowerTop < upperBottom;
  const useHorizontal = freePositioning && deltaX > deltaY && boxesOverlapVertically;

  if (useHorizontal) {
    if (centerA.x < centerB.x) {
      return {
        pointA: { x: posA.x + boxA.x + boxA.width, y: centerA.y },
        pointB: { x: posB.x + boxB.x, y: centerB.y },
      };
    }
    return {
      pointA: { x: posA.x + boxA.x, y: centerA.y },
      pointB: { x: posB.x + boxB.x + boxB.width, y: centerB.y },
    };
  }

  if (centerA.y < centerB.y) {
    return {
      pointA: { x: centerA.x, y: posA.y + boxA.y + boxA.height },
      pointB: { x: centerB.x, y: posB.y + boxB.y },
    };
  }
  return {
    pointA: { x: centerA.x, y: posA.y + boxA.y },
    pointB: { x: centerB.x, y: posB.y + boxB.y + boxB.height },
  };
}

/**
 * Owns one animation timer whose visual state must be completed when the timer
 * ends or is interrupted. D3 timer callbacks do not stop when they return a
 * truthy value, so the owner must explicitly stop the timer.
 */
export function createCompletingAnimationLifecycle() {
  let active = null;

  function stop() {
    if (!active) return false;

    const current = active;
    active = null;
    current.timer?.stop?.();
    current.finish?.();
    return true;
  }

  function start(timer, finish) {
    stop();
    active = { timer, finish };
    return timer;
  }

  function complete(timer) {
    if (!active || active.timer !== timer) return false;
    return stop();
  }

  return {
    start,
    stop,
    complete,
    isActive: () => active !== null,
  };
}
