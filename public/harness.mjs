import { RULES, cells, move, rotate, softDrop, hardDrop } from './engine.mjs';

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

const bindings = new WeakMap();
const MOVES = Object.freeze({ left: s => move(s, -1), right: s => move(s, 1), clockwise: rotate, down: softDrop, drop: hardDrop });
const poseKey = p => `${p.type}/${p.rotation}/${p.x}/${p.y}`;
const cellKey = points => points.map(p => `${p.x},${p.y}`).sort().join(';');
function landing(state) {
  let at = state;
  for (let n = 0; n <= RULES.height; n++) {
    const next = softDrop(at);
    if (next.board !== at.board) return { pose: at.active, outcome: next };
    at = next;
  }
  throw new Error('Downward transition did not lock within board bound');
}
/** Complete reachability for the declared paused-gravity action mode. Never silently prunes. */
export function enumerate(state, binding, { maxPoses = 800, maxTransitions = 4000 } = {}) {
  const observation = observe(state, binding);
  if (state.status !== 'playing' || !state.active) return [];
  if (!Number.isInteger(maxPoses) || maxPoses < 1 || maxPoses > 800 || !Number.isInteger(maxTransitions) || maxTransitions < 1 || maxTransitions > 4000) throw new RangeError('Invalid reachability bound');
  const original = JSON.stringify(state), visited = new Set([poseKey(state.active)]);
  const frontier = [{ state, path: [] }], result = [], outcomes = new Set(); let transitions = 0;
  const count = () => { if (++transitions > maxTransitions) throw new Error('Reachability transition limit exceeded'); };
  function add(at, path, pose, outcome) {
    const placed = cells(pose), key = cellKey(placed);
    // With no spin/hold/bonus history, the same locked cells have the same canonical consequence.
    if (outcomes.has(key)) return;
    outcomes.add(key);
    const candidate = freeze({ schemaVersion: VERSIONS.candidate, id: `${observation.sessionId}:${observation.revision}:${result.length}`,
      sessionId: observation.sessionId, revision: observation.revision, rulesVersion: RULES.version,
      movementMode: 'reachable-paused-gravity-v1', piece: pose.type, orientation: pose.rotation,
      x: pose.x, y: pose.y, cells: placed, bounds: bounds(placed), path,
      terminalReason: outcome.status === 'over' ? 'blocked spawn' : null });
    bindings.set(candidate, { signature: original, path: [...path], pose: { ...pose } }); result.push(candidate);
  }
  for (let index = 0; index < frontier.length; index++) {
    const at = frontier[index]; count(); const final = landing(at.state);
    add(at.state, [...at.path, 'drop'], final.pose, final.outcome);
    for (const action of ['left', 'right', 'clockwise', 'down']) {
      count(); const next = MOVES[action](at.state);
      if (next.board !== at.state.board) { add(at.state, [...at.path, action], at.state.active, next); continue; }
      if (next === at.state) continue;
      const key = poseKey(next.active);
      if (visited.has(key)) continue;
      if (visited.size >= maxPoses) throw new Error('Reachability pose limit exceeded');
      visited.add(key); frontier.push({ state: next, path: [...at.path, action] });
    }
  }
  return Object.freeze(result);
}
/** Execute only a locally generated bound candidate, never a provider-authored route. */
export function execute(state, candidate, { sessionId, revision } = {}) {
  const record = bindings.get(candidate);
  if (!record || candidate.sessionId !== sessionId || candidate.revision !== revision || JSON.stringify(state) !== record.signature) throw new Error('Unknown, stale or state-mismatched candidate');
  let at = structuredClone(state), locked = false;
  for (let i = 0; i < record.path.length; i++) {
    const action = record.path[i], next = MOVES[action](at);
    if (next === at) throw new Error('Candidate route no longer executable');
    if (next.board !== at.board) {
      if (i !== record.path.length - 1 || locked) throw new Error('Candidate route locks more than once');
      if (cellKey(cells(landing(at).pose)) !== cellKey(candidate.cells)) throw new Error('Candidate placed cells mismatch');
      locked = true;
    }
    at = next;
  }
  if (!locked) throw new Error('Candidate route did not lock');
  return at;
}
