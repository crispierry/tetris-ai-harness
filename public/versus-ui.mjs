import {mountRunClocks} from './run-timing.mjs';
import {mountTestCost} from './test-cost.mjs';
import {compactPlayerName,visibleOutcome} from './arcade-copy.mjs';
import {createPlacementPresenter} from './placement-motion.mjs';
import { providerProvenance } from './provider-provenance.mjs';
import { mountDecisionPairing } from './decision-session.mjs';
import { providerFor } from './comparison.mjs';
import { MARATHON_COPY, linesProgress, levelProgress, outcomeDetail, formatNumber } from './marathon.mjs';
import { HumanVersus } from './versus.mjs';
import { GEOMETRY } from './harness.mjs';
const STATUS = { falling:'Falling', placing:'Placing…',ready: 'Ready', playing: 'Playing', running: 'Running', choosing: 'Choosing…', paused: 'Paused',
  stopped: 'Stopped', over: 'Game over', error: 'Error', completed: 'Run finished', won: MARATHON_COPY.complete, capped: 'Capped', replay: 'Saved replay' };
const KEYS = { arrowleft: 'left', arrowright: 'right', arrowdown: 'down', arrowup: 'rotate', x: 'rotate', ' ': 'drop' };
function download(json, doc) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = doc.createElement('a'); link.href = url; link.download = 'tetris-human-local-run.json';
  doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountVersus(doc, { window: win, runnerFactory = options => new HumanVersus(options), onExport = json => download(json, doc) } = {}) {
  const updateCost=mountTestCost(doc);
  const $ = id => doc.getElementById(id), text = (id, value) => { $(id).textContent = value; };
  const surface = $('v-human-game');
  const tiles = [0, 1].map(i => Array.from({ length: 200 }, () => { const e = doc.createElement('span'); e.className = 'comparison-cell'; e.setAttribute('aria-hidden', 'true'); $(`v-${i}-board`).append(e); return e; }));
  let visual=null;const presenter=createPlacementPresenter({window:win,onFrame:observation=>{visual=observation;render(runner.view);},onSettled:()=>{visual=null;}});
  let previousAnnouncement = '', previousLaneStates = [], lastFrame = null, frameHandle = null, disposed = false,runClocks=null;
  function render(view) {
    if(disposed)return;
    runClocks?.update();
    const costLane=view.lanes[1];if(costLane)updateCost({gameId:costLane.observation.sessionId,receipt:costLane.lastDecision?.receipt,error:!!costLane.error,busy:costLane.status==='choosing',replay:view.mode==='replay',openAI:$('v-provider')?.value==='openai',tracked:view.policies?.[1]?.kind==='externalDecisions'});
    $('v-reset').disabled=view.mode!=='replay'&&!!pairing?.resetBlocked;
    if($('v-provider'))$('v-provider').disabled=view.frameCount>0;
    if($('v-gravity'))$('v-gravity').disabled=view.frameCount>0;
    const depth=$('v-depth');if(depth){depth.disabled=view.frameCount>0||$('v-provider')?.value!=='lookahead';if(depth.parentNode)depth.parentNode.hidden=$('v-provider')?.value!=='lookahead';}
    const pendingOpenAI=view.mode!=='replay'&&!!pairing&&$('v-provider')?.value==='openai'&&pairing.session.state.state!=='connected';
    if($('v-1-heading'))text('v-1-heading',pendingOpenAI?'OpenAI Decisions':compactPlayerName(view.lanes[1].player.name));
    if($('v-1-heading'))$('v-1-heading').title=view.lanes[1].player.name;
    const unavailable=view.mode!=='replay'&&$('v-provider')?.value==='openai'&&(pairing?.session.state.state!=='connected'||(pairing?.blocked&&!view.lanes[1].outcome));
    text('v-1-provenance', providerProvenance(view.policies?.[1], { recorded: view.mode === 'replay', pending: unavailable && (pairing?.session.state.message ?? true) }));
    const replay = view.mode === 'replay', finished = view.state === 'completed', archiveBlocked = !replay && !!view.archiveError;
    if($('v-replay-notice'))$('v-replay-notice').hidden=!replay;
    $('v-start').disabled = finished || view.running || view.busy || view.playback || archiveBlocked || unavailable;
    text('v-start', replay ? 'Play saved frames' : view.state === 'ready' ? 'Start' : 'Resume');
    $('v-pause').disabled = !view.running && !view.busy && !view.playback;
    $('v-stop').disabled = view.state === 'ready' || view.state === 'stopped' || finished;
    $('v-step').disabled = view.running || view.busy || view.playback || archiveBlocked || (!replay && !!view.lanes[1].outcome) || unavailable;
    text('v-step', replay ? 'Next saved frame' : 'Step');
    $('v-step').setAttribute('aria-label',replay?'Next saved frame':'Step computer');
    $('v-replay').disabled = !view.frameCount; $('v-export').disabled = !view.frameCount;
    const algorithm=view.lanes[1],algorithmPresentation=algorithm.error||algorithm.recoveryRequired?null:algorithm.presentation,algorithmPieces=algorithmPresentation?.before.pieces??algorithm.pieces;
    const progress = replay ? `Saved visual replay · Frame ${Math.max(0, view.replayIndex + 1)} of ${view.frameCount} · No new choices`
      : `${STATUS[view.state]} · Human ${view.lanes[0].pieces}/${view.limits.pieces} pieces · Algorithm ${algorithmPieces}/${view.limits.pieces} pieces`;
    text('v-progress', progress + (view.limits.pieces < 1000 ? ' · Abbreviated run' : '')); text('v-recording', `${view.frameCount} saved frames${view.archiveError ? ' · Incomplete recording' : ''}. Reset clears this run.`);
    view.lanes.forEach((canonical, i) => {
      if(view.mode!=='replay')pairing?.observe(canonical.lastDecision?.receipt);
      const p=canonical.error||canonical.recoveryRequired?null:canonical.presentation,lane=p?{...p.before,status:p.phase==='placing'?'placing':'choosing',observation:visual??p.before.observation}:canonical;
      const prefix = `v-${i}-`, obs = lane.observation;
      text(prefix + 'status', lane.status==='falling'&&lane.missedChoice?'Falling · missed choice':STATUS[lane.status]);
      for (const key of ['score', 'lines', 'level']) text(prefix + key, key === 'lines' ? linesProgress(obs[key]) : key==='level'?levelProgress(obs[key]):formatNumber(obs[key])); text(prefix + 'pieces', formatNumber(lane.pieces));
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
      text(prefix + 'outcome', visibleOutcome(lane.recordedStatus ?? lane.status, obs, lane.error));
      $(prefix + 'error').hidden = !lane.error; text(prefix + 'error', lane.error ?? '');
      text(prefix + 'details', JSON.stringify({ policy: view.policies[i], recordedStatus: lane.recordedStatus ?? null,
        receipt:lane.lastDecision?.receipt??null,placement: lane.lastDecision?.candidate ?? null, outcome: lane.outcome }, null, 2));
    });
    const last = view.lanes[1].lastDecision;
    text('v-choice', last ? `${last.candidate.piece} · ${Math.round(last.latencyMs)} ms decision attempt latency${replay ? ' (recorded)' : ''}` : 'No algorithm piece selected yet.');
    const announcement = `${view.mode}/${view.state}/${view.lanes.map(l => ['running','playing','choosing'].includes(l.status) ? 'active' : l.status).join('/')}`;
    if (announcement !== previousAnnouncement) {
      const laneStates = view.lanes.map(l => ['running','playing','choosing'].includes(l.status) ? 'active' : l.status);
      const changed = view.lanes.flatMap((lane, i) => laneStates[i] === previousLaneStates[i] ? [] :
        [`${["Human", "Algorithm"][i]}: ${STATUS[lane.status]}. ${['won','capped','over','error'].includes(lane.status) ? outcomeDetail(lane.status,lane.observation,lane.error) : ''}`]);
      text('v-announcement', `${progress}. ${changed.join(' ')}`);
      previousLaneStates = laneStates; previousAnnouncement = announcement;
    }
    if (view.archiveError) { $('v-message').hidden = false; text('v-message', view.archiveError); }
    if (!view.running) lastFrame = null;
  }
  const runner = runnerFactory({ onChange: render,onPlacement:event=>presenter.play(event) });
  runClocks=mountRunClocks(doc,{window:win,read:()=>runner.timing,ids:{1:'v-1-clock'}});
  const select=$('v-provider'),depth=$('v-depth');if(depth&&!/^[1-6]$/.test(depth.value))depth.value='2';let pairing;
  const configure=()=>{if(select.value==='openai'&&pairing?.session.state.state!=='connected'){render(runner.view);return;}runner.configure(()=>select.value==='openai'?pairing.session.provider:providerFor(select.value,{depth:Number(depth?.value??2),nodeCap:4000,timeMs:500}),{gravity:$('v-gravity')?.checked===true});$('v-message').hidden=true;text('v-message','');};
  pairing=mountDecisionPairing(doc,{mode:'versus',lane:'algorithm',window:win,onAvailabilityChange:()=>render(runner.view),beforeConnect:()=>{if(select.value!=='openai')throw new Error('Select OpenAI before connecting.');},onConnected:()=>{if(select?.value==='openai'){try{configure();}catch(error){$('v-message').hidden=false;text('v-message',error.message);render(runner.view);}}}});
  select?.addEventListener('change',()=>{pairing?.setEnabled(select.value==='openai');try{configure();}catch(error){$('v-message').hidden=false;text('v-message',error.message);render(runner.view);}});
  $('v-gravity')?.addEventListener('change',()=>{try{configure();}catch(error){$('v-message').hidden=false;text('v-message',error.message);}});
  depth?.addEventListener('change',()=>{try{configure();}catch(error){$('v-message').hidden=false;text('v-message',error.message);}});
  pairing?.setEnabled(false);
  const act = fn => async () => { try { $('v-message').hidden = true; text('v-message', ''); await fn();await pairing?.refresh(); } catch (error) { $('v-message').hidden = false; text('v-message', error.message); } };
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
  const dispose = () => { if(disposed)return;disposed = true;runClocks?.dispose(); win.cancelAnimationFrame(frameHandle);presenter.dispose(); runner.dispose();void pairing?.session.close().catch(()=>{}); };
  win.addEventListener('pagehide',event=>{if(event?.persisted){pause();presenter.cancel();win.cancelAnimationFrame(frameHandle);frameHandle=null;}else dispose();});
  win.addEventListener('pageshow',event=>{if(event.persisted&&!disposed&&frameHandle===null){lastFrame=null;frameHandle=win.requestAnimationFrame(frame);}});
  if(select?.value==='lookahead'||$('v-gravity')?.checked)configure();else render(runner.view); frameHandle = win.requestAnimationFrame(frame);
  return { runner, dispose };
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') mountVersus(document, { window });
