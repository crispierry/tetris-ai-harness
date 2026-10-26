import {
  DEFAULT_SEED, createGame, start, move, rotate, softDrop, hardDrop,
  tick, togglePause, cells,
} from './engine.mjs';

import { MARATHON_COPY, linesProgress, levelProgress, outcomeDetail, formatNumber } from './marathon.mjs';

// Player-facing copy stays together; HTML supplies the document structure.
const COPY = {
  eyebrow: 'LOCAL ARCADE', title: 'Tetris', intro: MARATHON_COPY.intro,
  playfield: 'Playfield', start: 'Start game', pause: 'Pause', resume: 'Resume',
  newGame: 'New game', score: 'Score', lines: 'Lines', level: 'Level', next: 'Up next',
  controls: 'Keyboard controls', move: 'Move', softDrop: 'Soft drop', rotate: 'Rotate clockwise',
  hardDrop: 'Hard drop', pauseResume: 'Pause / resume', or: 'or', space: 'Space',
  focusHelp: 'Click the board to focus. Leaving the game pauses play.',
  helpNote: 'Desktop keyboard play. Clear full rows to reach the 300-line target.',
  status: { ready: 'Ready', playing: 'Playing', paused: 'Paused', over: 'Game over', won: MARATHON_COPY.complete },
  overlay: {
    ready: ['Ready?', 'Start a game to begin.'],
    paused: ['Paused', 'Choose Resume when you’re ready.'],
    over: ['Game over', 'Blocked spawn. Start a new game to try again.'],
    won: [MARATHON_COPY.complete, ''],
  },
  piece: type => `${type} piece`,
  board: (state, count) => `20 rows by 10 columns. ${count} locked cells. ${state.active ? `Falling ${state.active.type} piece, row ${state.active.y + 1}, column ${state.active.x + 1}.` : 'No falling piece.'}`,
  progress: state => `Score ${formatNumber(state.score)}. Lines ${formatNumber(state.lines)}. Level ${levelProgress(state.level)}.`,
  lineClear: count => `${formatNumber(count)} ${count === 1 ? 'line' : 'lines'} cleared.`,
};

for (const node of document.querySelectorAll('[data-copy]')) {
  node.textContent = COPY[node.dataset.copy];
}

const element = id => document.getElementById(id);
const surface = element('game');
const board = element('board');
const overlay = element('board-overlay');
const startButton = element('start');
const pauseButton = element('pause');
const newButton = element('new-game');
const status = element('status');
const announcement = element('announcement');
const boardDescription = element('board-description');
const preview = element('next-piece');
const score = element('score');
const lines = element('lines');
const level = element('level');
const nextDescription = element('next-description');
const boardCells = [];
const previewCells = [];
let state = createGame(DEFAULT_SEED);
let lastFrame = null;
let pointerPauseAction = null;

for (let row = 0; row < 20; row += 1) {
  for (let col = 0; col < 10; col += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.row = String(row);
    cell.dataset.col = String(col);
    cell.setAttribute('aria-hidden', 'true');
    board.append(cell);
    boardCells.push(cell);
  }
}
for (let index = 0; index < 16; index += 1) {
  const cell = document.createElement('div');
  cell.className = 'preview-cell';
  preview.append(cell);
  previewCells.push(cell);
}

function paintCell(cell, type, active = false) {
  cell.classList.toggle('occupied', Boolean(type));
  cell.classList.toggle('active', active);
  if (type) cell.dataset.type = type;
  else delete cell.dataset.type;
}

function render(previous) {
  let lockedCount = 0;
  const falling = new Set(cells(state.active).map(({ x, y }) => `${x},${y}`));
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const locked = state.board[row][col];
      if (locked) lockedCount += 1;
      const active = falling.has(`${col},${row}`);
      paintCell(boardCells[row * 10 + col], active ? state.active.type : locked, active);
    }
  }

  const nextType = state.nextType;
  const nextCells = nextType ? cells({ type: nextType, rotation: 0, x: 0, y: 0 }) : [];
  const left = nextCells.length ? Math.min(...nextCells.map(cell => cell.x)) : 0;
  const top = nextCells.length ? Math.min(...nextCells.map(cell => cell.y)) : 0;
  const width = nextCells.length ? Math.max(...nextCells.map(cell => cell.x)) - left + 1 : 0;
  const height = nextCells.length ? Math.max(...nextCells.map(cell => cell.y)) - top + 1 : 0;
  const offsetX = Math.floor((4 - width) / 2);
  const offsetY = Math.floor((4 - height) / 2);
  const occupiedPreview = new Set(nextCells.map(cell => `${cell.x - left + offsetX},${cell.y - top + offsetY}`));
  previewCells.forEach((cell, index) => paintCell(cell, occupiedPreview.has(`${index % 4},${Math.floor(index / 4)}`) ? nextType : null));
  nextDescription.textContent = nextType ? COPY.piece(nextType) : '';
  score.textContent = formatNumber(state.score);
  lines.textContent = linesProgress(state.lines);
  level.textContent = levelProgress(state.level);
  status.textContent = COPY.status[state.status];
  status.dataset.state = state.status;
  surface.dataset.state = state.status;
  boardDescription.textContent = COPY.board(state, lockedCount);
  board.setAttribute('aria-label', boardDescription.textContent);
  startButton.hidden = state.status !== 'ready';
  pauseButton.hidden = ['ready','over','won'].includes(state.status);
  pauseButton.disabled = ['over','won'].includes(state.status);
  pauseButton.textContent = state.status === 'paused' ? COPY.resume : COPY.pause;
  newButton.hidden = state.status === 'ready';
  overlay.hidden = state.status === 'playing';
  if (!overlay.hidden) {
    const [title, detail] = COPY.overlay[state.status];
    element('overlay-title').textContent = title;
    element('overlay-detail').textContent = state.status === 'won' ? outcomeDetail('won', state) : detail;
  }

  // Announce meaningful changes only, never gravity/movement frames.
  const messages = [];
  if (!previous || previous.status !== state.status) messages.push((state.status === 'won' ? 'Manual: ' : '') + COPY.status[state.status] + '.');
  if (previous && state.lines > previous.lines) messages.push(COPY.lineClear(state.lines - previous.lines));
  if (!previous || previous.score !== state.score || previous.lines !== state.lines || previous.level !== state.level || previous.status !== state.status) {
    messages.push(COPY.progress(state));
  }
  if (messages.length) announcement.textContent = messages.join(' ');
}

function update(nextState) {
  const previous = state;
  state = nextState;
  if (previous.status !== state.status) lastFrame = null;
  if (state !== previous) render(previous);
}
function focusGame() { surface.focus({ preventScroll: true }); }
function pauseForDeparture() {
  if (state.status === 'playing') update(togglePause(state));
  lastFrame = null;
}
function beginFreshGame() {
  update(start(createGame(DEFAULT_SEED)));
  lastFrame = null;
  focusGame();
}

startButton.addEventListener('click', beginFreshGame);
newButton.addEventListener('click', beginFreshGame);
// Pointer focus leaves the board before click. Preserve intent so automatic
// blur-pause cannot turn a click on Pause into an accidental Resume.
pauseButton.addEventListener('pointerdown', () => {
  pointerPauseAction = state.status === 'playing' ? 'pause' : 'resume';
});
pauseButton.addEventListener('pointercancel', () => { pointerPauseAction = null; });
pauseButton.addEventListener('click', event => {
  const currentAction = state.status === 'playing' ? 'pause' : 'resume';
  const action = event.detail === 0 ? currentAction : (pointerPauseAction ?? currentAction);
  pointerPauseAction = null;
  if (action === 'pause') {
    if (state.status === 'playing') update(togglePause(state));
  } else if (state.status === 'paused') {
    update(togglePause(state));
    focusGame();
  }
});
surface.addEventListener('blur', pauseForDeparture);
window.addEventListener('blur', pauseForDeparture);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseForDeparture();
});
surface.addEventListener('click', focusGame);
surface.addEventListener('keydown', event => {
  if (document.activeElement !== surface || event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  const handled = ['arrowleft', 'arrowright', 'arrowdown', 'arrowup', 'x', ' ', 'p'].includes(key);
  if (!handled) return;
  event.preventDefault();
  if (event.repeat && ['arrowup', 'x', ' ', 'p'].includes(key)) return;
  if (key === 'p') {
    if (state.status === 'playing' || state.status === 'paused') update(togglePause(state));
    return;
  }
  if (state.status !== 'playing') return;
  switch (key) {
    case 'arrowleft': update(move(state, -1)); break;
    case 'arrowright': update(move(state, 1)); break;
    case 'arrowdown': update(softDrop(state)); break;
    case 'arrowup':
    case 'x': update(rotate(state)); break;
    case ' ': update(hardDrop(state)); break;
  }
});

function frame(now) {
  if (state.status === 'playing' && !document.hidden && document.hasFocus() && document.activeElement === surface) {
    if (lastFrame !== null) update(tick(state, Math.min(250, Math.max(0, now - lastFrame))));
    lastFrame = now;
  } else {
    lastFrame = null;
  }
  requestAnimationFrame(frame);
}
render(null);
requestAnimationFrame(frame);
