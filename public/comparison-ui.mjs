import { MARATHON_COPY, linesProgress, outcomeDetail, formatNumber } from './marathon.mjs';
import { Comparison, DEFAULT_CONFIG } from './comparison.mjs';
import { GEOMETRY } from './harness.mjs';
import { briefing } from './briefing.mjs';

const STATUS = { ready: 'Ready', running: 'Running', choosing: 'Choosing…', paused: 'Paused', stopped: 'Stopped',
  over: 'Game over', error: 'Error', completed: 'Run finished', won: MARATHON_COPY.complete, capped: 'Capped', replay: 'Saved replay' };
const SETTINGS = Object.keys(DEFAULT_CONFIG);
function download(json, doc) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = doc.createElement('a'); link.href = url; link.download = 'tetris-offline-comparison.json';
  doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountComparison(doc, { comparisonFactory = options => new Comparison(options), onExport = json => download(json, doc) } = {}) {
  const $ = id => doc.getElementById(id), text = (id, value) => { $(id).textContent = value; };
  const tiles = [0, 1].map(index => Array.from({ length: 200 }, () => {
    const tile = doc.createElement('span'); tile.className = 'comparison-cell'; tile.setAttribute('aria-hidden', 'true');
    $(`c-${index}-board`).append(tile); return tile;
  }));
  let previousAnnouncement = '', previousLaneStates = [];
  function render(view) {
    SETTINGS.forEach(key => { $('c-' + key).disabled = view.locked; });
    const ended = view.mode === 'live' && view.sample >= view.config.samples && view.lanes.every(l => l.outcome);
    $('c-start').disabled = view.auto || view.busy || ended || !!view.archiveError;
    $('c-step').disabled = view.auto || view.busy || ended || !!view.archiveError;
    $('c-pause').disabled = !view.auto && !view.busy; $('c-stop').disabled = !view.locked;
    $('c-replay').disabled = !view.frameCount; $('c-export').disabled = !view.frameCount;
    text('c-start', view.mode === 'replay' ? 'Play saved frames' : view.locked ? 'Resume' : 'Start');
    const progress = view.mode === 'replay'
      ? `Saved visual replay · Frame ${Math.max(0, view.replayIndex + 1)} of ${view.frameCount} · No new decisions or live metrics`
      : `${STATUS[view.state]} · Sample ${view.sample} of ${view.config.samples} · ${view.summary.observedPairs} completed pairs`;
    text('c-progress', progress + (view.config.pieceCap < 1000 ? ' · Abbreviated run' : ''));
    view.lanes.forEach((lane, index) => {
      const prefix = `c-${index}-`, obs = lane.observation;
      text(prefix + 'heading', `${index ? 'Right' : 'Left'} · ${lane.player.name}`);
      text(prefix + 'status', STATUS[lane.status]); text(prefix + 'tier', `${lane.player.kind === 'mock' ? 'Offline test fixture' : 'Local algorithm'} · ${lane.assistance}`);
      for (const key of ['score', 'lines', 'level']) text(prefix + key, key === 'lines' ? linesProgress(obs[key]) : formatNumber(obs[key])); text(prefix + 'pieces', formatNumber(lane.pieces));
      const active = new Map((obs.active?.cells ?? []).map(p => [`${p.x},${p.y}`, obs.active.type]));
      for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) {
        const falling = active.get(`${x},${y}`), type = falling ?? obs.board[y][x];
        const tile = tiles[index][y * 10 + x]; tile.className = `comparison-cell${type ? ' filled' : ''}${falling ? ' active' : ''}`;
        tile.setAttribute('data-type', type ?? '');
      }
      $(prefix + 'board').setAttribute('aria-label', `${index ? 'Right' : 'Left'} board: 10 columns by 20 rows, ${obs.board.flat().filter(Boolean).length} locked cells. ${STATUS[lane.status]}. ${obs.active ? `Falling ${obs.active.type}.` : 'No falling piece.'}`);
      $(prefix + 'next').replaceChildren(); obs.next.forEach((type, ordinal) => {
        const item = doc.createElement('div'); item.className = 'comparison-preview'; item.setAttribute('aria-label', `Next ${ordinal + 1}: ${type}`);
        const mini = doc.createElement('div'); mini.className = 'comparison-mini'; mini.setAttribute('data-type', type); mini.setAttribute('aria-hidden', 'true');
        const cells = new Set(GEOMETRY.find(g => g.type === type).orientations[0].cells.map(p => `${p.x},${p.y}`));
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const dot = doc.createElement('span'); if (cells.has(`${x},${y}`)) dot.className = 'filled'; mini.append(dot); }
        const label = doc.createElement('span'); label.textContent = type; item.append(mini, label); $(prefix + 'next').append(item);
      });
      $(prefix + 'error').hidden = !lane.error; text(prefix + 'error', lane.error ?? '');
      text(prefix + 'outcome', outcomeDetail(lane.recordedStatus ?? lane.status, obs, lane.error));
      text(prefix + 'choice', lane.lastDecision ? `${lane.lastDecision.candidate.piece} · ${Math.round(lane.lastDecision.latencyMs)} ms local decision overhead${view.mode === 'replay' ? ' (recorded)' : ''}` : 'No piece selected yet.');
      text(prefix + 'details', JSON.stringify({ placement: lane.lastDecision?.candidate ?? null, search: lane.search, policy: lane.policy,
        recordedStatus: lane.recordedStatus ?? null, valueMeaning: 'Raw board features; scalar leaf value is not a probability.' }, null, 2));
    });
    const s = view.summary;
    text('c-results', `Expected pairs: ${s.expectedPairs} · Observed: ${s.observedPairs} · Missing: ${s.missingPairs}${s.scoreDifferenceRange ? ` · Left minus right score range: ${s.scoreDifferenceRange.join(' to ')}` : ''}`);
    text('c-pairs', s.pairs.length ? JSON.stringify(s.pairs, null, 2) : 'No completed pairs.');
    const announcement = `${view.mode}/${view.state}/${view.sample}/${view.lanes.map(l => ['choosing','running'].includes(l.status) ? 'active' : l.status).join('/')}/${s.observedPairs}`;
    if (announcement !== previousAnnouncement) {
      const laneStates = view.lanes.map(l => ['running','playing','choosing'].includes(l.status) ? 'active' : l.status);
      const changed = view.lanes.flatMap((lane, i) => laneStates[i] === previousLaneStates[i] ? [] :
        [`["Left", "Right"][i]: ${STATUS[lane.status]}. ${['won','capped','over','error'].includes(lane.status) ? outcomeDetail(lane.status,lane.observation,lane.error) : ''}`]);
      text('c-announcement', `${progress}. ${changed.join(' ')}`);
      previousLaneStates = laneStates; previousAnnouncement = announcement;
    }
    if (view.archiveError) { $('c-error').hidden = false; text('c-error', view.archiveError); }
  }
  const comparison = comparisonFactory({ onChange: render });
  const settings = () => Object.fromEntries(SETTINGS.map(key => [key, ['left', 'right'].includes(key) ? $('c-' + key).value : Number($('c-' + key).value)]));
  const act = fn => async () => {
    try { $('c-error').hidden = true; text('c-error', ''); await fn(); }
    catch (error) { $('c-error').hidden = false; text('c-error', error.message); }
  };
  SETTINGS.forEach(key => $('c-' + key).addEventListener('change', act(() => comparison.configure(settings()))));
  for (const action of ['start', 'step']) $('c-' + action).addEventListener('click', act(async () => {
    if (!comparison.view.locked) comparison.configure(settings()); await comparison[action]();
  }));
  for (const action of ['pause', 'stop', 'reset', 'replay']) $('c-' + action).addEventListener('click', act(() => comparison[action]()));
  $('c-export').addEventListener('click', act(() => { onExport(comparison.exportRun()); text('c-announcement', 'Exported own saved visual frames. Private sequences omitted.'); }));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && (comparison.view.auto || comparison.view.busy)) comparison.pause(); });
  const rules = briefing(), list = doc.createElement('ol');
  rules.instructions.forEach(instruction => { const li = doc.createElement('li'); li.textContent = instruction; list.append(li); });
  const examples = doc.createElement('pre'); examples.textContent = JSON.stringify(rules.examples, null, 2); $('c-rules').append(list, examples);
  render(comparison.view); return comparison;
}
if (typeof document !== 'undefined') mountComparison(document);
