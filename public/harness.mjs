import { RULES, cells } from './engine.mjs';

export const VERSIONS = Object.freeze({ observation: 1, candidate: 1, features: 1, decision: 1 });
export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export function bounds(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
}
export function geometry(type) {
  if (!RULES.types.includes(type)) throw new TypeError('Unknown piece type');
  return freeze({ type, matrixSize: type === 'I' ? 4 : type === 'O' ? 2 : 3,
    reference: 'top-left of square rotation matrix',
    orientations: Array.from({ length: 4 }, (_, rotation) => {
      const occupied = cells({ type, rotation, x: 0, y: 0 }), extent = bounds(occupied);
      return { rotation, cells: occupied, bounds: extent,
        normalized: occupied.map(({ x, y }) => ({ x: x - extent.minX, y: y - extent.minY })) };
    }) });
}
export const GEOMETRY = freeze(RULES.types.map(geometry));
export function observe(state, { sessionId, revision, previewLimit = RULES.previewCount } = {}) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(sessionId) ||
      !Number.isSafeInteger(revision) || revision < 0 || !Number.isInteger(previewLimit) || previewLimit < 0 || previewLimit > RULES.previewCount) {
    throw new TypeError('Explicit session, revision and bounded preview required');
  }
  const active = state.active ? { ...state.active, cells: cells(state.active), bounds: bounds(cells(state.active)) } : null;
  // Deliberate allowlist: never spread private engine state into a provider packet.
  return freeze({ schemaVersion: VERSIONS.observation, sessionId, revision, rulesVersion: RULES.version,
    board: state.board.map(row => [...row]), width: RULES.width, visibleHeight: RULES.height, hiddenRows: RULES.hiddenRows,
    coordinates: 'x right, y down, visible top-left (0,0)', active,
    next: state.queue.slice(0, previewLimit), previewCount: previewLimit,
    score: state.score, lines: state.lines, level: state.level, status: state.status,
    gravityElapsedMs: state.gravityElapsed, objective: RULES.objective,
    terminalReason: state.status === 'over' ? 'blocked spawn' : null,
    capabilities: { hold: false, ghost: false, spins: false, combos: false, lockDelayMs: 0 },
  });
}
