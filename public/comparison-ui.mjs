import {mountRunClocks} from './run-timing.mjs';
import {mountTestCost} from './test-cost.mjs';
import {compactPlayerName,visibleOutcome} from './arcade-copy.mjs';
import {createPlacementPresenter} from './placement-motion.mjs';
import { providerProvenance } from './provider-provenance.mjs';
import { mountDecisionPairing } from './decision-session.mjs';
import { providerFor } from './comparison.mjs';
import { MARATHON_COPY, linesProgress, levelProgress, outcomeDetail, formatNumber } from './marathon.mjs';
import { Comparison, DEFAULT_CONFIG, validateConfig } from './comparison.mjs';
import { GEOMETRY } from './harness.mjs';
import { briefing } from './briefing.mjs';

const STATUS = { falling:'Falling', queued:'Waiting…', placing:'Placing…',ready: 'Ready', running: 'Running', choosing: 'Choosing…', paused: 'Paused', stopped: 'Stopped',
  over: 'Game over', error: 'Error', completed: 'Run finished', won: MARATHON_COPY.complete, capped: 'Capped', replay: 'Saved replay' };
const SETTINGS = Object.keys(DEFAULT_CONFIG);
function download(json, doc) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = doc.createElement('a'); link.href = url; link.download = 'tetris-offline-comparison.json';
  doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountComparison(doc, { comparisonFactory = options => new Comparison(options), onExport = json => download(json, doc),window:win=globalThis } = {}) {
  const updateCost=mountTestCost(doc);
  const $ = id => doc.getElementById(id), text = (id, value) => { $(id).textContent = value; };
  const tiles = [0, 1].map(index => Array.from({ length: 200 }, () => {
    const tile = doc.createElement('span'); tile.className = 'comparison-cell'; tile.setAttribute('aria-hidden', 'true');
    $(`c-${index}-board`).append(tile); return tile;
  }));
  const visual=new Map(),presenters=[0,1].map(lane=>createPlacementPresenter({window:win,onFrame:observation=>{visual.set(lane,observation);render(comparison.view);},onSettled:()=>{visual.delete(lane);}}));
  let previousAnnouncement = '', previousLaneStates = [], disposed=false,runClocks=null;
  function render(view) {
    if(disposed)return;
    runClocks?.update();
    const speed=$('c-speed-summary'),pace=view.summary?.pace;if(speed){speed.hidden=!pace;if(pace){text('c-speed-heading',pace.title);text('c-speed-text',pace.text);text('c-speed-detail',pace.detail);}}
    const selected=['left','right'].map(side=>$('c-'+side).value),paid=selected.flatMap((key,i)=>key==='openai'?[i]:[]),searching=selected.some(key=>['lookahead','look1','look2'].includes(key));
    const costLanes=paid.map(i=>view.lanes[i]);updateCost({gameId:view.runId,receipts:costLanes.map(l=>l.lastDecision?.receipt).filter(Boolean),error:costLanes.some(l=>!!l.error),busy:costLanes.some(l=>['choosing','queued'].includes(l.status)),replay:view.mode==='replay',openAI:paid.length>0,tracked:costLanes.every(l=>l.policy?.kind==='externalDecisions')});
    const risk=$('decision-budget-risk');if(risk){risk.textContent='$1 monthly project limit. Billing enforcement can be delayed; charges may exceed that limit.';risk.hidden=!paid.some(i=>pairings[i]?.session.state.mode==='project-limit-browser'||pairings[i]?.session.state.admission?.mode==='project-limit-browser');}
    SETTINGS.forEach(key => { $('c-' + key).disabled = view.locked || (!searching && ['nodeCap','timeMs'].includes(key)); });
    ['left','right'].forEach((side,i)=>{const depth=$('c-'+side+'Depth');if(depth){depth.disabled=view.locked||selected[i]!=='lookahead';if(depth.parentNode)depth.parentNode.hidden=selected[i]!=='lookahead';}});
    $('c-reset').disabled=view.mode!=='replay'&&paid.some(i=>pairings[i]?.resetBlocked);
    const ended = view.mode === 'live' && view.sample >= view.config.samples && view.lanes.every(l => l.outcome);
    const pendingOpenAI=index=>view.mode!=='replay'&&paid.includes(index)&&pairings[index]?.session.state.state!=='connected';
    const paidBlocked=view.mode!=='replay'&&paid.some(i=>pendingOpenAI(i)||(pairings[i]?.blocked&&!view.lanes[i].outcome));
    $('c-start').disabled = paidBlocked || view.auto || view.busy || ended || !!view.archiveError;
    $('c-step').disabled = paidBlocked || view.auto || view.busy || ended || !!view.archiveError;
    $('c-pause').disabled = !view.auto && !view.busy; $('c-stop').disabled = !view.locked;
    $('c-replay').disabled = !view.frameCount; $('c-export').disabled = !view.frameCount;
    text('c-start', view.mode === 'replay' ? 'Play saved frames' : view.locked ? 'Resume' : 'Start');
    text('c-step',view.mode==='replay'?'Next frame':'Step');$('c-step').setAttribute('aria-label',view.mode==='replay'?'Next saved frame':'Step one piece in each eligible lane');
    const progress = view.mode === 'replay'
      ? `Saved visual replay · Frame ${Math.max(0, view.replayIndex + 1)} of ${view.frameCount} · No new decisions or live metrics`
      : `${STATUS[view.state]} · Sample ${view.sample} of ${view.config.samples} · ${view.summary.observedPairs} completed pairs`;
    text('c-progress', progress + (view.config.pieceCap < 1000 ? ' · Abbreviated run' : ''));
    if($('c-replay-notice'))$('c-replay-notice').hidden=view.mode!=='replay';
    view.lanes.forEach((canonical, index) => {
      if(view.mode!=='replay'&&paid.includes(index))pairings[index]?.observe(canonical.lastDecision?.receipt);
      const p=canonical.error||canonical.recoveryRequired?null:canonical.presentation,lane=p?{...p.before,policy:canonical.policy,assistance:canonical.assistance,search:canonical.search,status:p.phase==='placing'?'placing':'choosing',observation:visual.get(index)??p.before.observation}:canonical;
      const prefix = `c-${index}-`, obs = lane.observation;
      text(prefix + 'heading',pendingOpenAI(index)?'OpenAI Decisions':compactPlayerName(lane.player.name));
      $(prefix+'heading').title=lane.player.name;
      text(prefix + 'status', lane.status==='falling'&&lane.missedChoice?'Falling · missed choice':STATUS[lane.status]); text(prefix + 'tier', `${providerProvenance(lane.policy, { recorded: view.mode === 'replay', pending: pendingOpenAI(index) })} · ${lane.assistance}`);
      if(pendingOpenAI(index))text(prefix+'tier',pairings[index]?.session.state.message??'Connect to request local owner approval.');
      for (const key of ['score', 'lines', 'level']) text(prefix + key, key === 'lines' ? linesProgress(obs[key]) : key==='level'?levelProgress(obs[key]):formatNumber(obs[key])); text(prefix + 'pieces', formatNumber(lane.pieces));
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
      const outcome=visibleOutcome(lane.recordedStatus ?? lane.status, obs, lane.error);$(prefix+'status').title=outcome;
      text(prefix + 'outcome', canonical.outcome?'':outcome);
      text(prefix + 'choice', lane.lastDecision ? `${lane.lastDecision.candidate.piece} · ${Math.round(lane.lastDecision.latencyMs)} ms decision attempt latency${view.mode === 'replay' ? ' (recorded)' : ''}` : 'No piece selected yet.');
      text(prefix + 'details', JSON.stringify({ receipt:lane.lastDecision?.receipt??null,placement: lane.lastDecision?.candidate ?? null, search: lane.search, policy: lane.policy,
        recordedStatus: lane.recordedStatus ?? null, valueMeaning: 'Raw board features; scalar leaf value is not a probability.' }, null, 2));
    });
    const s = view.summary;
    text('c-results', `Expected pairs: ${s.expectedPairs} · Observed: ${s.observedPairs} · Missing: ${s.missingPairs}${s.scoreDifferenceRange ? ` · Left minus right score range: ${s.scoreDifferenceRange.join(' to ')}` : ''}`);
    text('c-pairs', s.pairs.length ? JSON.stringify(s.pairs, null, 2) : 'No completed pairs.');
    const announcement = `${view.mode}/${view.state}/${view.sample}/${view.lanes.map(l => ['choosing','running'].includes(l.status) ? 'active' : l.status).join('/')}/${s.observedPairs}`;
    if (announcement !== previousAnnouncement) {
      const laneStates = view.lanes.map(l => ['running','playing','choosing'].includes(l.status) ? 'active' : l.status);
      const changed = view.lanes.flatMap((lane, i) => laneStates[i] === previousLaneStates[i] ? [] :
        [`${["Left", "Right"][i]}: ${STATUS[lane.status]}. ${['won','capped','over','error'].includes(lane.status) ? outcomeDetail(lane.status,lane.observation,lane.error) : ''}`]);
      text('c-announcement', `${progress}. ${changed.join(' ')}${s.pace&&view.mode!=='replay'?' '+s.pace.text:''}`);
      previousLaneStates = laneStates; previousAnnouncement = announcement;
    }
    if (view.archiveError) { $('c-error').hidden = false; text('c-error', view.archiveError); }
  }
  let pairings=[];
  const comparison = comparisonFactory({onChange:render,onPlacement:event=>presenters[event.lane].play(event),providerFactory:(key,config,{lane})=>key==='openai'?pairings[lane].session.provider:providerFor(key,config)});
  runClocks=mountRunClocks(doc,{window:win,read:()=>comparison.timing,ids:{0:'c-0-clock',1:'c-1-clock'}});
  const settings=()=>Object.fromEntries(SETTINGS.map(key=>[key,key==='gravity'?$('c-gravity').checked===true:['left','right'].includes(key)?$('c-'+key).value:Number($('c-'+key).value)]));
  const ready=()=>['left','right'].every((side,i)=>settings()[side]!=='openai'||pairings[i]?.session.state.state==='connected');
  pairings=['left','right'].map((side,index)=>mountDecisionPairing(doc,{mode:'comparison',lane:side,window:win,rootId:index?'decision-pairing':'decision-pairing-left',manageBudget:false,title:`${index?'Right':'Left'} · OpenAI`,connectLabel:index?'Connect OpenAI':'Connect left OpenAI',onAvailabilityChange:()=>render(comparison.view),beforeConnect:()=>{validateConfig(settings());if(settings()[side]!=='openai')throw new Error(`Select OpenAI on the ${side} before connecting.`);},onConnected:()=>{try{if(ready())comparison.configure(settings());else render(comparison.view);$('c-error').hidden=true;text('c-error','');}catch(error){text('c-error',error.message);$('c-error').hidden=false;}}}));
  const refresh=()=>Promise.all(pairings.map(p=>p?.refresh()));
  const act = fn => async () => {
    try { $('c-error').hidden = true; text('c-error', ''); await fn(); }
    catch (error) { $('c-error').hidden = false; text('c-error', error.message); render(comparison.view); }
  };
  SETTINGS.forEach(key=>$('c-'+key).addEventListener('change',act(()=>{['left','right'].forEach((side,i)=>pairings[i]?.setEnabled(settings()[side]==='openai'));if(!ready()){render(comparison.view);return;}comparison.configure(settings());})));
  pairings.forEach(p=>p?.setEnabled(false));
  const disposeComparison=comparison.dispose.bind(comparison);
  comparison.dispose=()=>{if(disposed)return;disposed=true;runClocks?.dispose();presenters.forEach(p=>p.dispose());disposeComparison();pairings.forEach(p=>{void p?.session.close().catch(()=>{});});};
  for (const action of ['start', 'step']) $('c-' + action).addEventListener('click', act(async () => {
    if (!comparison.view.locked) comparison.configure(settings()); await comparison[action](); await refresh();
  }));
  for (const action of ['pause', 'stop', 'reset', 'replay']) $('c-' + action).addEventListener('click', act(async() => {comparison[action]();if(action==='reset')await refresh();}));
  $('c-export').addEventListener('click', act(() => { onExport(comparison.exportRun()); text('c-announcement', 'Exported own saved visual frames. Private sequences omitted.'); }));
  win.addEventListener?.('blur',()=>{if(comparison.view.auto||comparison.view.busy)comparison.pause();});
  win.addEventListener?.('pagehide',event=>{if(event?.persisted){if(comparison.view.auto||comparison.view.busy)comparison.pause();}else comparison.dispose();});
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && (comparison.view.auto || comparison.view.busy)) comparison.pause(); });
  const rules = briefing(), list = doc.createElement('ol');
  rules.instructions.forEach(instruction => { const li = doc.createElement('li'); li.textContent = instruction; list.append(li); });
  const examples = doc.createElement('pre'); examples.textContent = JSON.stringify(rules.examples, null, 2); $('c-rules').append(list, examples);
  render(comparison.view); return comparison;
}
if (typeof document !== 'undefined') mountComparison(document);
