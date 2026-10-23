import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED, BOARD_WIDTH, BOARD_HEIGHT, createGame, start, move, rotate,
  softDrop, hardDrop, tick, togglePause, cells, gravityInterval } from '../public/engine.mjs';

const emptyBoard = () => Array.from({ length: 20 }, () => Array(10).fill(null));
const occupied = board => board.flat().filter(Boolean);
const sortedCells = piece => cells(piece).map(({ x, y }) => `${x},${y}`).sort();
function position(type, { x = 3, y = 0, rotation = 0, board = emptyBoard(), ...rest } = {}) {
  return { ...start(createGame(123)), board, active: { type, x, y, rotation },
    queue: ['T', 'O', 'J', 'L', 'I', 'S', 'Z'], nextType: 'T', ...rest };
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function clearFixture(count, { lines = 0, level = 1, score = 0 } = {}) {
  const board = emptyBoard();
  for (let y = 20 - count; y < 20; y++) board[y] = Array.from({ length: 10 }, (_, x) => x === 5 ? null : 'J');
  return position('I', { x: 3, rotation: 1, board, lines, level, score });
}

test('ready board, fixed seed and visible spawn have truthful initial state', () => {
  const ready = createGame();
  assert.equal(DEFAULT_SEED, 0x6d2b79f5);
  assert.equal(BOARD_WIDTH, 10); assert.equal(BOARD_HEIGHT, 20);
  assert.equal(ready.status, 'ready'); assert.equal(ready.active, null);
  assert.equal(ready.board.length, 20); assert(ready.board.every(row => row.length === 10 && row.every(cell => cell === null)));
  assert.notEqual(ready.board[0], ready.board[1]);
  assert.equal(ready.nextType, ready.queue[0]);
  assert.deepEqual([ready.score, ready.lines, ready.level, ready.gravityElapsed], [0, 0, 1, 0]);
  const playing = start(freeze(ready));
  assert.equal(playing.status, 'playing'); assert.equal(playing.active.type, ready.nextType);
  assert.equal(playing.active.y, 0); assert(cells(playing.active).every(({ x, y }) => x >= 0 && x < 10 && y >= 0 && y < 20));
  assert.deepEqual(cells(null), []);
});

test('seeded bags are deterministic and each successive bag contains all seven pieces', () => {
  assert.deepEqual(createGame(876), createGame(876));
  assert.notDeepEqual(createGame(1), createGame(2));
  assert.deepEqual(createGame(0), createGame(DEFAULT_SEED));
  let a = start(createGame(876)), b = start(createGame(876));
  const types = [];
  for (let i = 0; i < 28; i++) {
    types.push(a.active.type); assert.deepEqual(a, b);
    a = hardDrop({ ...a, board: emptyBoard() });
    b = hardDrop({ ...b, board: emptyBoard() });
  }
  for (let offset = 0; offset < types.length; offset += 7) {
    assert.deepEqual(types.slice(offset, offset + 7).sort(), ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  }
  assert.deepEqual(createGame('876'), createGame(876));
  assert.deepEqual(createGame(1.5), createGame(1));
  assert.deepEqual(createGame(NaN), createGame(DEFAULT_SEED));
});

test('every rotated piece has four distinct occupied squares and a four-turn cycle', () => {
  for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
    let state = position(type, { x: 3, y: 5 });
    const original = sortedCells(state.active);
    for (let turn = 0; turn < 4; turn++) {
      assert.equal(new Set(sortedCells(state.active)).size, 4);
      state = rotate(state);
    }
    assert.equal(state.active.rotation, 0); assert.deepEqual(sortedCells(state.active), original);
  }
  const t = rotate(position('T', { x: 3, y: 5 }));
  assert.deepEqual(sortedCells(t.active), ['4,5', '4,6', '4,7', '5,6']);
});

test('horizontal movement respects both walls and locked-cell collision', () => {
  const left = position('I', { x: 0, y: 3 }); assert.equal(move(left, -1), left);
  const right = position('I', { x: 6, y: 3 }); assert.equal(move(right, 1), right);
  const board = emptyBoard(); board[4][4] = 'J';
  const blocked = position('I', { x: 0, y: 3, board }); assert.equal(move(blocked, 1), blocked);
  const open = position('T', { x: 3, y: 4 });
  assert.equal(move(open, -1).active.x, 2); assert.equal(move(open, 1).active.x, 4);
});

test('clockwise rotation tries ordered horizontal kicks without a vertical escape', () => {
  const board = emptyBoard(); board[7][5] = 'J';
  const ordered = rotate(position('T', { x: 4, y: 5, board }));
  assert.deepEqual(ordered.active, { type: 'T', rotation: 1, x: 3, y: 5 });
  const nearLeft = rotate(position('I', { x: -2, y: 4, rotation: 1 }));
  assert.deepEqual(nearLeft.active, { type: 'I', rotation: 2, x: 0, y: 4 });
  const nearRight = rotate(position('I', { x: 7, y: 4, rotation: 1 }));
  assert.equal(nearRight.active.x, 6);
  const floor = position('T', { x: 3, y: 18 }); assert.equal(rotate(floor), floor);
  const above = position('I', { x: 3, y: -1 }); assert.equal(rotate(above), above);
});

test('failed soft drop locks immediately at floor and spawns the next piece', () => {
  const state = position('O', { x: 4, y: 18, gravityElapsed: 599 });
  const after = softDrop(freeze(state));
  assert.equal(occupied(after.board).length, 4);
  for (const y of [18, 19]) for (const x of [4, 5]) assert.equal(after.board[y][x], 'O');
  assert.equal(after.active.type, 'T'); assert.equal(after.active.y, 0);
  assert.equal(after.gravityElapsed, 0); assert.equal(after.score, 0);
});

test('downward collision locks above an existing stack instead of overwriting it', () => {
  const board = emptyBoard(); board[7][4] = 'J';
  const state = position('T', { x: 3, y: 5, board });
  const after = softDrop(freeze(state));
  assert.equal(after.board[7][4], 'J'); assert.equal(occupied(after.board).filter(x => x === 'T').length, 4);
  assert.equal(after.active.type, 'T'); assert.equal(after.active.y, 0);
});

test('hard drop finds the last legal row, locks immediately and awards no drop points', () => {
  const board = emptyBoard(); board[17][4] = 'J';
  const after = hardDrop(freeze(position('O', { x: 4, board })));
  for (const y of [15, 16]) for (const x of [4, 5]) assert.equal(after.board[y][x], 'O');
  assert.equal(after.board[17][4], 'J'); assert.equal(after.score, 0);
  assert.equal(after.active.y, 0); assert.equal(after.gravityElapsed, 0);
});

for (const [count, points] of [[1, 100], [2, 300], [3, 500], [4, 800]]) {
  test(`simultaneous ${count}-row clear compacts the board and scores ${points}`, () => {
    const state = clearFixture(count), before = structuredClone(state);
    const after = hardDrop(freeze(state));
    assert.equal(after.lines, count); assert.equal(after.score, points); assert.equal(after.level, 1);
    assert.equal(occupied(after.board).length, 4 - count);
    assert(after.board.every(row => row.some(cell => cell === null)));
    assert.deepEqual(state, before);
  });
}

test('nonadjacent completed rows clear together and preserve the order of remaining rows', () => {
  const board = emptyBoard(); board[15][0] = 'Z';
  for (const y of [17, 19]) board[y] = Array.from({ length: 10 }, (_, x) => x === 5 ? null : 'J');
  const after = hardDrop(position('I', { x: 3, rotation: 1, board }));
  assert.equal(after.lines, 2); assert.equal(after.score, 300); assert.equal(after.board[17][0], 'Z');
  assert.equal(occupied(after.board).filter(x => x === 'I').length, 2);
});

test('line thresholds change level after scoring at the pre-clear level', () => {
  const single = hardDrop(clearFixture(1, { lines: 9, level: 1, score: 700 }));
  assert.deepEqual([single.lines, single.level, single.score], [10, 2, 800]);
  const four = hardDrop(clearFixture(4, { lines: 19, level: 2 }));
  assert.deepEqual([four.lines, four.level, four.score], [23, 3, 1600]);
  assert.equal(gravityInterval(1), 800); assert.equal(gravityInterval(2), 680); assert.equal(gravityInterval(100), 100);
});

test('gravity accumulates fractions, processes multiple rows and does not carry time past locking', () => {
  const state = position('O', { x: 4 });
  const before = tick(state, 799.5); assert.equal(before.active.y, 0); assert.equal(before.gravityElapsed, 799.5);
  const one = tick(before, 0.5); assert.equal(one.active.y, 1); assert.equal(one.gravityElapsed, 0);
  assert.equal(tick(state, 2400).active.y, 3);
  const lock = tick(position('O', { x: 4, y: 18 }), 1000000);
  assert.equal(occupied(lock.board).length, 4); assert.equal(lock.active.type, 'T'); assert.equal(lock.active.y, 0); assert.equal(lock.gravityElapsed, 0);
  for (const invalid of [-1, NaN, Infinity]) assert.throws(() => tick(state, invalid));
});

test('pause freezes inputs and time, preserving only the pre-pause remainder', () => {
  const playing = tick(position('T'), 500), paused = togglePause(playing);
  assert.equal(paused.status, 'paused'); assert.equal(paused.gravityElapsed, 500);
  for (const operation of [s => tick(s, 100000), s => move(s, 1), rotate, softDrop, hardDrop]) assert.equal(operation(paused), paused);
  const resumed = togglePause(paused); assert.equal(resumed.status, 'playing');
  const almost = tick(resumed, 299); assert.equal(almost.active.y, 0);
  assert.equal(tick(almost, 1).active.y, 1);
  const ready = createGame(); assert.equal(togglePause(ready), ready); assert.equal(tick(ready, 10000), ready);
});

test('blocked next spawn ends the game without dropping or erasing the locked board', () => {
  const board = emptyBoard(); board[0][4] = 'J';
  const after = hardDrop(position('O', { x: 0, y: 18, board }));
  assert.equal(after.status, 'over'); assert.equal(after.active, null);
  assert.equal(after.board[0][4], 'J'); assert.equal(occupied(after.board).length, 5);
  for (const operation of [s => tick(s, 10000), s => move(s, 1), rotate, softDrop, hardDrop, togglePause]) assert.equal(operation(after), after);
});

test('ordinary repeated hard drops naturally top out and a restart fully resets the seeded game', () => {
  let state = start(createGame(DEFAULT_SEED)), pieces = 0;
  while (state.status === 'playing' && pieces < 100) { state = hardDrop(state); pieces++; }
  assert.equal(state.status, 'over'); assert(pieces > 1 && pieces < 100);
  assert(occupied(state.board).length > 0);
  const restarted = start(freeze(state));
  assert.deepEqual(restarted, start(createGame(DEFAULT_SEED)));
});

test('every reducer preserves its input, including queue/RNG and nested board rows', () => {
  const fixtures = [createGame(654), position('T', { y: 4 }), clearFixture(4), togglePause(position('O'))];
  const operations = [start, s => move(s, -1), rotate, softDrop, hardDrop, s => tick(s, 1600), togglePause];
  for (const state of fixtures) for (const operation of operations) {
    const before = structuredClone(state); freeze(state);
    const first = operation(state), second = operation(state);
    assert.deepEqual(state, before); assert.deepEqual(first, second);
  }
});
