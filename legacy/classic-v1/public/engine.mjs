/** Pure, simplified local falling-block rules. No timers, DOM, storage or I/O. */
export const DEFAULT_SEED = 0x6d2b79f5;
export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const RULES = Object.freeze({
  version: 'local-classic-1', width: BOARD_WIDTH, height: BOARD_HEIGHT, hiddenRows: 0,
  types: Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']),
  kicks: Object.freeze([0, -1, 1, -2, 2]), clearPoints: Object.freeze([0, 100, 300, 500, 800]),
  linesPerLevel: 10, gravityStartMs: 800, gravityFactor: 0.85, minimumGravityMs: 100,
  previewCount: 5, rotation: 'clockwise square matrix', immediateLock: true,
  objective: 'endless score and survival', randomizer: 'seeded seven-bag',
  hold: false, ghost: false, spins: false, combos: false, lockDelayMs: 0,
});
const TYPES = RULES.types;
const SHAPES = {
  I: ['0000', '1111', '0000', '0000'],
  O: ['11', '11'],
  T: ['010', '111', '000'],
  S: ['011', '110', '000'],
  Z: ['110', '011', '000'],
  J: ['100', '111', '000'],
  L: ['001', '111', '000']
};
const emptyRow = () => Array(BOARD_WIDTH).fill(null);

// xorshift32 (13,17,5), then descending Fisher–Yates over I,O,T,S,Z,J,L.
function shuffledBag(rng) {
  const queue = [...TYPES];
  for (let i = queue.length - 1; i > 0; i--) {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    const j = Math.floor((rng / 0x100000000) * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return { queue, rng };
}

/** Occupied board coordinates, including the square-matrix rotation offsets. */
export function cells(piece) {
  if (!piece) return [];
  const shape = SHAPES[piece.type];
  if (!shape) throw new TypeError('Unknown piece type');
  const turns = ((piece.rotation % 4) + 4) % 4;
  const result = [];
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape.length; x++) {
      if (shape[y][x] !== '1') continue;
      let rx = x, ry = y;
      for (let turn = 0; turn < turns; turn++) [rx, ry] = [shape.length - 1 - ry, rx];
      result.push({ x: piece.x + rx, y: piece.y + ry });
    }
  }
  return result;
}

function fits(board, piece) {
  return cells(piece).every(({ x, y }) =>
    x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT && board[y][x] === null);
}

export function gravityInterval(level) {
  return Math.max(RULES.minimumGravityMs, Math.floor(RULES.gravityStartMs * RULES.gravityFactor ** (level - 1)));
}

export function createGame(seed = DEFAULT_SEED) {
  seed = (Number(seed) >>> 0) || DEFAULT_SEED;
  const bag = shuffledBag(seed);
  return {
    board: Array.from({ length: BOARD_HEIGHT }, emptyRow),
    active: null,
    queue: bag.queue,
    nextType: bag.queue[0],
    rng: bag.rng,
    seed,
    status: 'ready',
    score: 0,
    lines: 0,
    level: 1,
    gravityElapsed: 0
  };
}

function spawn(state) {
  const type = state.queue[0];
  let queue = state.queue.slice(1), rng = state.rng;
  // Refill early without changing the ordinal piece sequence. Only observe() exposes previewCount.
  while (queue.length < RULES.previewCount) {
    const bag = shuffledBag(rng); queue = [...queue, ...bag.queue]; rng = bag.rng;
  }
  const active = { type, rotation: 0, x: Math.floor((BOARD_WIDTH - SHAPES[type].length) / 2), y: 0 };
  const playable = fits(state.board, active);
  return { ...state, queue, rng, nextType: queue[0], active: playable ? active : null,
    status: playable ? 'playing' : 'over', gravityElapsed: 0 };
}

export function start(state) {
  if (state.status === 'over') return spawn(createGame(state.seed));
  return state.status === 'ready' ? spawn(state) : state;
}

function lock(state) {
  const board = state.board.map(row => [...row]);
  for (const { x, y } of cells(state.active)) board[y][x] = state.active.type;
  const remaining = board.filter(row => row.some(cell => cell === null));
  const cleared = BOARD_HEIGHT - remaining.length;
  while (remaining.length < BOARD_HEIGHT) remaining.unshift(emptyRow());
  const lines = state.lines + cleared;
  return spawn({ ...state, board: remaining, lines, level: 1 + Math.floor(lines / RULES.linesPerLevel),
    score: state.score + RULES.clearPoints[cleared] * state.level,
    gravityElapsed: 0 });
}

export function move(state, dx) {
  if (state.status !== 'playing') return state;
  if (dx !== -1 && dx !== 1) throw new RangeError('Move must be one column left or right');
  const active = { ...state.active, x: state.active.x + dx };
  return fits(state.board, active) ? { ...state, active } : state;
}

export function rotate(state) {
  if (state.status !== 'playing') return state;
  const turned = { ...state.active, rotation: (state.active.rotation + 1) % 4 };
  for (const kick of RULES.kicks) {
    const active = { ...turned, x: turned.x + kick };
    if (fits(state.board, active)) return { ...state, active };
  }
  return state;
}

export function softDrop(state) {
  if (state.status !== 'playing') return state;
  const active = { ...state.active, y: state.active.y + 1 };
  return fits(state.board, active) ? { ...state, active } : lock(state);
}

export function hardDrop(state) {
  if (state.status !== 'playing') return state;
  let active = { ...state.active };
  while (fits(state.board, { ...active, y: active.y + 1 })) active = { ...active, y: active.y + 1 };
  return lock({ ...state, active });
}

export function tick(state, elapsedMs) {
  if (state.status !== 'playing') return state;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Elapsed time must be finite and nonnegative');
  if (elapsedMs === 0) return state;
  let current = { ...state, gravityElapsed: state.gravityElapsed + elapsedMs };
  const interval = gravityInterval(state.level);
  while (current.gravityElapsed >= interval) {
    const active = { ...current.active, y: current.active.y + 1 };
    if (!fits(current.board, active)) return lock(current);
    current = { ...current, active, gravityElapsed: current.gravityElapsed - interval };
  }
  return current;
}

export function togglePause(state) {
  if (state.status === 'playing') return { ...state, status: 'paused' };
  if (state.status === 'paused') return { ...state, status: 'playing' };
  return state;
}
