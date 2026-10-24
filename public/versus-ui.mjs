import { HumanVersus } from './versus.mjs';
import { GEOMETRY } from './harness.mjs';
const STATUS = { ready: 'Ready', playing: 'Playing', running: 'Running', choosing: 'Choosing…', paused: 'Paused',
  stopped: 'Stopped', over: 'Game over', error: 'Error', completed: 'Completed', replay: 'Saved replay' };
const KEYS = { arrowleft: 'left', arrowright: 'right', arrowdown: 'down', arrowup: 'rotate', x: 'rotate', ' ': 'drop' };
function download(json, doc) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = doc.createElement('a'); link.href = url; link.download = 'tetris-human-local-run.json';
  doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountVersus(doc, { window: win, runnerFactory = options => new HumanVersus(options), onExport = json => download(json, doc) } = {}) {
  const $ = id => doc.getElementById(id), text = (id, value) => { $(id).textContent = value; };
  const surface = $('v-human-game');
  const tiles = [0, 1].map(i => Array.from({ length: 200 }, () => { const e = doc.createElement('span'); e.className = 'comparison-cell'; e.setAttribute('aria-hidden', 'true'); $(`v-${i}-board`).append(e); return e; }));
  let previousAnnouncement = '', lastFrame = null, frameHandle = null, disposed = false;
  function render(view) {
    const replay = view.mode === 'replay', finished = view.state === 'completed', archiveBlocked = !replay && !!view.archiveError;
    $('v-start').disabled = finished || view.running || view.busy || view.playback || archiveBlocked;
    text('v-start', replay ? 'Play saved frames' : view.state === 'ready' ? 'Start' : 'Resume');
    $('v-pause').disabled = !view.running && !view.busy && !view.playback;
    $('v-stop').disabled = view.state === 'ready' || view.state === 'stopped' || finished;
    $('v-step').disabled = view.running || view.busy || view.playback || archiveBlocked || (!replay && !!view.lanes[1].outcome);
    text('v-step', replay ? 'Next saved frame' : 'Step algorithm');
    $('v-replay').disabled = !view.frameCount; $('v-export').disabled = !view.frameCount;
    const progress = replay ? `Saved visual replay · Frame ${Math.max(0, view.replayIndex + 1)} of ${view.frameCount} · No new choices`
      : `${STATUS[view.state]} · Human ${view.lanes[0].pieces}/${view.limits.pieces} pieces · Algorithm ${view.lanes[1].pieces}/${view.limits.pieces} pieces`;
    text('v-progress', progress); text('v-recording', `${view.frameCount} saved frames${view.archiveError ? ' · Incomplete recording' : ''}. Reset clears this run.`);
    view.lanes.forEach((lane, i) => {
      const prefix = `v-${i}-`, obs = lane.observation;
      text(prefix + 'status', STATUS[lane.status]);
      for (const key of ['score', 'lines', 'level']) text(prefix + key, String(obs[key])); text(prefix + 'pieces', String(lane.pieces));
      const active = new Map((obs.active?.cells ?? []).map(p => [`${p.x},${p.y}`, obs.active.type]));
      for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) {
        const falling = active.get(`${x},${y}`), type = falling ?? obs.board[y][x], tile = tiles[i][y * 10 + x];
        tile.className = `comparison-cell${type ? ' filled' : ''}${falling ? ' active' : ''}`; tile.setAttribute('data-type', type ?? '');
      }
      $(prefix + 'board').setAttribute('aria-label', `${i ? 'Algorithm' : 'Human'} board: 10 columns by 20 rows, ${obs.board.flat().filter(Boolean).length} locked cells. ${STATUS[lane.status]}. ${obs.active ? `Falling ${obs.active.type} at column ${obs.active.x + 1}, row ${obs.active.y + 1}.` : 'No falling piece.'}`);
      $(prefix + 'next').replaceChildren(); obs.next.forEach((type, ordinal) => {
        const item = doc.createElement('div'); item.className = 'comparison-preview'; item.setAttribute('aria-label', `Next ${ordinal + 1}: ${type}`);
        const mini = doc.createElement('div'); mini.className = 'comparison-mini'; mini.setAttribute('data-type', type); mini.setAttribute('aria-hidden', 'true');
        const occupied = new Set(GEOMETRY.find(g => g.type === type).orientations[0].cells.map(p => `${p.x},${p.y}`));
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const dot = doc.createElement('span'); if (occupied.has(`${x},${y}`)) dot.className = 'filled'; mini.append(dot); }
        const label = doc.createElement('span'); label.textContent = type; item.append(mini, label); $(prefix + 'next').append(item);
      });
      text(prefix + 'outcome', lane.outcome ? `${lane.outcome.reason}. ${lane.outcome.censored ? 'Censored outcome.' : 'Natural game over.'} The other board can continue.` : 'Endless score and survival. No winning threshold.');
      $(prefix + 'error').hidden = !lane.error; text(prefix + 'error', lane.error ?? '');
      text(prefix + 'details', JSON.stringify({ policy: view.policies[i], recordedStatus: lane.recordedStatus ?? null,
        placement: lane.lastDecision?.candidate ?? null, outcome: lane.outcome }, null, 2));
    });
    const last = view.lanes[1].lastDecision;
    text('v-choice', last ? `${last.candidate.piece} · ${Math.round(last.latencyMs)} ms local algorithm decision overhead${replay ? ' (recorded)' : ''}` : 'No algorithm piece selected yet.');
    const announcement = `${view.mode}/${view.state}/${view.lanes.map(l => ['running','playing','choosing'].includes(l.status) ? 'active' : l.status).join('/')}`;
    if (announcement !== previousAnnouncement) { text('v-announcement', `${progress}. Human ${STATUS[view.lanes[0].status]}. Algorithm ${STATUS[view.lanes[1].status]}${view.lanes[1].error ? '. ' + view.lanes[1].error : ''}.`); previousAnnouncement = announcement; }
    if (view.archiveError) { $('v-message').hidden = false; text('v-message', view.archiveError); }
    if (!view.running) lastFrame = null;
  }
  const runner = runnerFactory({ onChange: render });
  const act = fn => async () => { try { $('v-message').hidden = true; text('v-message', ''); await fn(); } catch (error) { $('v-message').hidden = false; text('v-message', error.message); } };
  const pause = () => { lastFrame = null; if (runner.view.running || runner.view.busy || runner.view.playback) runner.pause(); };
  $('v-start').addEventListener('click', act(() => { runner.start(); lastFrame = null; if (runner.view.mode === 'live' && runner.view.running) surface.focus({ preventScroll: true }); }));
  $('v-pause').addEventListener('click', act(() => runner.pause()));
  $('v-stop').addEventListener('click', act(() => runner.stop()));
  $('v-reset').addEventListener('click', act(() => { lastFrame = null; runner.reset(); }));
  $('v-step').addEventListener('click', act(() => runner.stepAlgorithm()));
  $('v-replay').addEventListener('click', act(() => runner.replay()));
  $('v-export').addEventListener('click', act(() => { onExport(runner.exportRun()); text('v-announcement', 'Exported own saved visual frames; private sequence omitted.'); }));
  surface.addEventListener('click', () => surface.focus({ preventScroll: true })); surface.addEventListener('blur', pause);
  surface.addEventListener('keydown', event => {
    if (doc.activeElement !== surface || event.altKey || event.ctrlKey || event.metaKey || runner.view.mode !== 'live') return;
    const key = event.key.toLowerCase(); if (!Object.hasOwn(KEYS, key) && key !== 'p') return;
    event.preventDefault(); if (event.repeat && ['arrowup','x',' ','p'].includes(key)) return;
    if (key === 'p') { if (runner.view.running) runner.pause(); else if (['paused','stopped'].includes(runner.view.state)) { runner.start(); lastFrame = null; } }
    else runner.input(KEYS[key]);
  });
  win.addEventListener('blur', pause); doc.addEventListener('visibilitychange', () => { if (doc.hidden) pause(); });
  function frame(now) {
    if (disposed) return;
    if (runner.view.running && !doc.hidden && doc.hasFocus() && doc.activeElement === surface) {
      if (lastFrame !== null) runner.tick(Math.min(250, Math.max(0, now - lastFrame))); lastFrame = now;
    } else lastFrame = null;
    frameHandle = win.requestAnimationFrame(frame);
  }
  const dispose = () => { disposed = true; win.cancelAnimationFrame(frameHandle); runner.dispose(); };
  win.addEventListener('pagehide', dispose); render(runner.view); frameHandle = win.requestAnimationFrame(frame);
  return { runner, dispose };
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') mountVersus(document, { window });
