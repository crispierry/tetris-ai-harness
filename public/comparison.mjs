import {RunClock,comparisonPace} from './run-timing.mjs';
import {GravityController} from './gravity-controller.mjs';
import {gravityPolicy} from './ai-gravity.mjs';
import {placementEvent,placementBeforeView,depth2Error} from './placement-motion.mjs';
import { providerPolicy, compactReceipt, localSearchReceipt } from './provider-policy.mjs';
import { DecisionJournal, DECISION_RECORD_LIMITS } from './decision-record.mjs';
import { Controller, heuristic, mockProvider, HEURISTIC_WEIGHTS } from './controller.mjs';
import { createLookaheadProvider, LOOKAHEAD_VERSION } from './lookahead.mjs';
import {createConfigurableLookaheadProvider,BEAM_VERSION} from './beam-lookahead.mjs';
import { freeze, VERSIONS } from './harness.mjs';
import { RULES } from './engine.mjs';

export const COMPARISON_VERSION = 'offline-comparison-2';
export const LIMITS = freeze({ samples: 8, pieceCap: 1000, paceMin: 30, paceMax: 1000,
  nodeCap: 4000, timeMs: 1000, deadlineMs: 1500, placements: 2000, frames: 4000, exportBytes: 8 * 1024 * 1024 });
export const PLAYERS = freeze({ lookahead:'Lookahead',
  delay: 'Delayed mock', error: 'Error mock', openai:'OpenAI Decisions' });
// Historical keys remain readable by offline fixtures and saved-run tooling, not player menus.
const LEGACY_PLAYERS=freeze({local:true,look1:true,look2:true});
export const DEFAULT_CONFIG = freeze({ left:'lookahead', right:'lookahead', leftDepth:1, rightDepth:2, gravity:true, samples:1, pieceCap:1000, paceMs:150, nodeCap:4000, timeMs:500 });
const bytes = value => new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
const copy = value => JSON.parse(JSON.stringify(value));
let instances = 0;
export function validateConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object.');
  const c = { ...DEFAULT_CONFIG, ...input };
  if (Object.keys(c).some(k => !Object.hasOwn(DEFAULT_CONFIG, k))) throw new RangeError('Unknown comparison setting.');
  for (const key of ['left', 'right']) if (!Object.hasOwn(PLAYERS,c[key])&&!Object.hasOwn(LEGACY_PLAYERS,c[key])) throw new RangeError(`${key} player is unavailable. Choose Lookahead, OpenAI, or a test player.`);
  for (const [key, min, max] of [['leftDepth',1,6],['rightDepth',1,6],['samples', 1, 8], ['pieceCap', 1, 1000], ['paceMs', 30, 1000], ['nodeCap', 1, 4000], ['timeMs', 1, 1000]]) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new RangeError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  if(typeof c.gravity!=='boolean')throw new TypeError('Gravity must be on or off.');
  if (2 * c.samples * c.pieceCap > LIMITS.placements) throw new RangeError('Planned placements exceed 2000.');
  return freeze(c);
}
export function providerFor(key, config) {
  if (key==='openai') throw new Error('Connect OpenAI before playing.');
  if(key==='lookahead')return createConfigurableLookaheadProvider({depth:config.depth??2,nodeCap:config.nodeCap??4000,callCap:config.nodeCap??4000,timeMs:config.timeMs??500});
  if (key === 'local') return heuristic();
  if (key === 'delay' || key === 'error') return mockProvider({ mode: key, delayMs: 250 });
  if (key === 'look1' || key === 'look2') return createLookaheadProvider({ depth: key === 'look2' ? 2 : 1, nodeCap: config.nodeCap, callCap: config.nodeCap, timeMs: config.timeMs });
  throw new RangeError('Unknown comparison player.');
}
function compactObservation(o) {
  return { rulesVersion: o.rulesVersion, board: o.board.map(row => row.map(c => c ?? '.').join('')),
    active: o.active ? { type: o.active.type, rotation: o.active.rotation, x: o.active.x, y: o.active.y, cells: o.active.cells.map(p => ({ x: p.x, y: p.y })) } : null,
    next: [...o.next], score: o.score, lines: o.lines, level: o.level, status: o.status, terminalReason: o.terminalReason };
}
function compactDecision(last, compactPath=false, provider) {
  if (!last) return null;
  const c = last.candidate;
  return { receipt:provider.kind==='remote'?compactReceipt(last.receipt):provider.runMetadata?.search?localSearchReceipt(last.receipt):null, latencyMs: last.latencyMs, candidate: { piece: c.piece, orientation: c.orientation, cells: c.cells,
    bounds: c.bounds, path: compactPath?c.path.map(a=>({left:'L',right:'R',clockwise:'C',down:'D',drop:'H'})[a]).join(''):c.path, pathEncoding:compactPath?'LRCDH-1':undefined, clearedRows: c.clearedRows, scoreDelta: c.scoreDelta, linesDelta: c.linesDelta,
    features: c.features, featureDeltas: c.featureDeltas } };
}
function compactSearch(provider) {
  const r = provider.lastSearch;
  return r ? { version: r.version, ok: r.ok, complete: r.complete, error: r.error ?? null, stats: r.stats,
    tier: provider.runMetadata.search.tier, limits: { nodeCap: provider.runMetadata.search.nodeCap, timeMs: provider.runMetadata.search.timeMs } } : null;
}
function lanePolicy(provider, key) {
  if(provider.kind==='remote') return providerPolicy(provider);
  const p = provider.runMetadata?.search;
  if(p?.version===BEAM_VERSION)return providerPolicy(provider);
  if (!p) return freeze({ version: provider.version, kind: provider.kind, assistance: 'canonical-afterstates-v1',
    weights: HEURISTIC_WEIGHTS, tieOrder: 'Original candidate order', terminalPenalty: -1000000000, completionReward: 1000000000,
    fixture: key === 'delay' || key === 'error' ? { mode: key, delayMs: 250 } : null,
    meaning: 'Deterministic local board heuristic, not a probability', live: false });
  // Copy only the accepted public policy contract, never roots, responses or private engine state.
  return freeze(copy({ version: p.version, rulesVersion: p.rulesVersion, featureVersion: p.featureVersion,
    objective: p.objective, tier: p.tier, depth: p.depth, nodeCap: p.nodeCap, callCap: p.callCap,
    timeMs: p.timeMs, maxOutputBytes: p.maxOutputBytes, discount: p.discount,
    evaluator: { name: p.evaluator.name, kind: p.evaluator.kind, version: p.evaluator.version,
      policy: { weights: p.evaluator.policy.weights, terminalPenalty: p.evaluator.policy.terminalPenalty, completionReward: p.evaluator.policy.completionReward,
        valueRange: p.evaluator.policy.valueRange, meaning: p.evaluator.policy.meaning } },
    rootReward: p.rootReward, terminalOrder: p.terminalOrder, tieOrder: p.tieOrder, pruning: p.pruning, cache: p.cache,
    reachabilityBounds: p.reachabilityBounds, horizon: p.horizon, live: p.live, modelCalls: p.modelCalls, spendCapUSD: p.spendCapUSD }));
}
function replayView(frame) {
  return freeze({ ...frame, status: 'replay', recordedStatus: frame.status, busy: false,
    observation: { ...frame.observation, board: frame.observation.board.map(row => [...row].map(c => c === '.' ? null : c)) },
    lastDecision: frame.decision });
}

/** Two independent player controllers; connections and accounting belong to their providers. */
export class Comparison {
  #clock; #config; #factory; #onChange; #lanes = []; #sample = 0; #epoch = 0; #timers = new Set(); #auto = false;
  #state = 'ready'; #locked = false; #frames = []; #frameBytes = 0; #pairs = []; #policies = []; #archiveError = null;
  #onPlacement; #motion=new Map(); #remoteTail=Promise.resolve(); #waiting=new Set(); #history=[]; #decisionElapsedMs = 0; #gameEpoch=0; #journal=null; #savedExport=null;
  #run=0; #mode = 'live'; #replayIndex = -1; #replayLanes = []; #id = ++instances;
  #seeds = Array.from({ length: 8 }, (_, i) => (0x51f15e + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
  constructor({ clock, config = {}, onChange = () => {}, providerFactory = providerFor, onPlacement=null } = {}) {
    this.#clock=clock;this.#config = validateConfig(config); this.#onChange = onChange; this.#factory = providerFactory;this.#onPlacement=onPlacement; this.#setup();
  }
  get timing(){return freeze({replay:this.#mode==='replay',lanes:this.#lanes.map((l,lane)=>({lane,...this.#laneTiming(l),pieces:l.pieces??0}))});}
  #laneTiming(lane){const current=lane.timer.view,side=lane.index?'right':'left',prior=this.#pairs.filter(p=>p.sample<this.#sample+1).map(p=>p[side+'Timing']);return freeze({...current,elapsedMs:current.elapsedMs+prior.reduce((n,t)=>n+t.elapsedMs,0),decisionMs:current.decisionMs+prior.reduce((n,t)=>n+t.decisionMs,0),decisions:current.decisions+prior.reduce((n,t)=>n+t.decisions,0),started:current.started||prior.length>0});}
  get #external(){return this.#lanes.some(l=>l.provider.kind==='remote');}
  get view() {
    const lanes = this.#mode === 'replay' ? [...this.#replayLanes] : this.#lanes.map(l => this.#laneView(l));
    return freeze({runId:`comparison-${this.#id}-${this.#run}`, version: COMPARISON_VERSION, config: this.#config, locked: this.#locked, state: this.#state, mode: this.#mode,
      sample: this.#sample + 1, lanes, busy: this.#lanes.some(l => l.controller.view.busy)||this.#motion.size>0||this.#waiting.size>0, auto: this.#auto,
      frameCount: this.#frames.length, replayIndex: this.#replayIndex, archiveError: this.#archiveError, summary: this.#summary() });
  }
  #laneView(lane) {
    const view = lane.controller.view;
    return freeze({ ...view,presentation:lane.presentation??null,error:depth2Error(lane.provider,view.error,'comparison'), status: this.#waiting.has(lane)?'queued':lane.outcome?.status ?? view.status, outcome: lane.outcome,
      assistance: lane.provider.runMetadata?.search?.tier??'canonical-afterstates-v1',
      timing:this.#laneTiming(lane),search: compactSearch(lane.provider), policy: lane.policy });
  }
  #emit() { this.#onChange(this.view); }
  #setup() {
    const providers=['left','right'].map((side,index)=>this.#factory(this.#config[side],{...this.#config,depth:this.#config[side+'Depth']},{sample:this.#sample+1,lane:index})),canonical=providers.some(p=>p.kind==='remote');
    this.#lanes = ['left', 'right'].map((side, index) => {
      const key = this.#config[side], provider = providers[index];
      const lane = { index,timer:new RunClock({now:this.#clock?.now??(()=>performance.now())}),pieces:0,key, provider, outcome: null, controller: null, presentation:null,capturing:false,before:null,policy:this.#config.gravity?gravityPolicy(providerPolicy(provider)):canonical?providerPolicy(provider):lanePolicy(provider, key) };
      lane.controller = new (this.#config.gravity?GravityController:Controller)({ seed: this.#seeds[this.#sample], sessionId: provider.controllerBinding?.sessionId ?? `compare-${this.#id}-${this.#epoch}-${index}`, gameEpoch:provider.kind==='remote'?this.#gameEpoch:0,
        provider,pieceCap:this.#config.pieceCap,...(this.#clock?{clock:this.#clock}:{}), deadlineMs: LIMITS.deadlineMs, onTransition:({input,view})=>{if(this.#journal&&(!this.#journal.incomplete||['computer','spawn'].includes(input.kind))&&this.#mode==='live')this.#journal.append(index,input,view);}, onChange:view => {if(this.#lanes.includes(lane)){lane.pieces=view.pieces;lane.timer.record(view.lastDecision);}if(lane.capturing&&view.busy&&!lane.before){const before=this.#config.gravity?placementBeforeView(view):view;if(before){lane.before=before;lane.presentation={phase:before.status==='placing'?'placing':'choosing',before};}} if(this.#lanes.includes(lane))this.#emit();} });
      return lane;
    });
    // Finished samples consume the same recording allowance as the active one.
    const limits=DECISION_RECORD_LIMITS.comparison;
    this.#journal=(this.#external||this.#config.gravity)?new DecisionJournal({mode:'comparison',pieceCap:this.#config.pieceCap,
      eventLimit:limits.frames-this.#history.reduce((n,r)=>n+r.events.length,0),
      byteLimit:limits.bytes-this.#history.reduce((n,r)=>n+bytes(r),0)-1024}):null;
    this.#savedExport=null;
    this.#lanes.forEach((lane,i)=>this.#journal?.addLane(i,'computer',lane.controller.view,lane.policy));
  }
  configure(config) {
    if (this.#locked) throw new Error('Settings are locked until Reset.');
    const next = validateConfig(config);this.#run++; this.#history=[]; this.#fence(); this.#config = next; this.#setup(); this.#emit();
  }
  #record(index, event) {
    if (this.#archiveError) return;
    const lane = this.#lanes[index], view = this.#laneView(lane);
    const policyId = `sample-${this.#sample + 1}-lane-${index}`;
    if (!this.#policies.some(p => p.id === policyId)) this.#policies.push(freeze({ id: policyId,
      sample: this.#sample + 1, lane: index, player: copy(view.player), policy: lane.policy }));
    const frame = freeze(copy({ version: 1, sample: this.#sample + 1, lane: index, event, status: view.status,
      observation: compactObservation(view.observation), pieces: view.pieces, player: view.player, assistance: view.assistance,
      error: view.error?.slice(0, 500) ?? null, outcome: view.outcome, decision: compactDecision(view.lastDecision,this.#external,lane.provider), search: view.search, policyId }));
    const length = bytes(frame);
    if (this.#frames.length >= LIMITS.frames || this.#frameBytes + length > (this.#external?16*1024*1024:LIMITS.exportBytes) - 131072) {
      this.#journal?.censor();this.#archiveError = 'Saved-frame capacity reached. Play stopped; existing frames and outcomes are retained.';
      this.#fence(); this.#state = 'stopped'; return;
    }
    this.#frames.push(frame); this.#frameBytes += length;
  }
  #lock() {
    if (!this.#locked) { this.#locked = true; this.#record(0, 'initial'); this.#record(1, 'initial'); }
  }
  #fence(status = 'paused') {
    this.#auto = false; this.#epoch++;for(const lane of this.#lanes){if(lane.outcome)lane.timer.finish();else lane.timer.pause();}this.#waiting.clear();for(const lane of this.#lanes){lane.presentation=null;lane.capturing=false;}for(const job of this.#motion.values())job.abort();this.#motion.clear();this.#replayLanes=this.#replayLanes.map(l=>l?.presentation?freeze({...l,presentation:null}):l);
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const lane of this.#lanes) if (!lane.outcome) lane.controller[status === 'stopped' ? 'stop' : 'pause']();
    this.#finishPair();
  }
  #schedule(fn, epoch) {
    const timer = setTimeout(() => { this.#timers.delete(timer); if (epoch === this.#epoch && this.#auto) fn(); }, this.#mode==='live'&&this.#config.gravity?0:this.#config.paceMs);
    this.#timers.add(timer);
  }
  #finishPair() {
    if (!this.#lanes.every(l => l.outcome) || this.#pairs.some(p => p.sample === this.#sample + 1)) return;
    const [left, right] = this.#lanes.map(l => l.outcome);
    this.#pairs.push(freeze({ sample: this.#sample + 1, left, right,leftTiming:this.#lanes[0].timer.view,rightTiming:this.#lanes[1].timer.view,
      difference: { score: left.score - right.score, lines: left.lines - right.lines, pieces: left.pieces - right.pieces } }));
  }
  #nextSample() {
    if(this.#journal)this.#history.push(JSON.parse(this.#exportCurrent()));
    this.#fence(); this.#gameEpoch++;this.#sample++; this.#setup(); this.#record(0, 'initial'); this.#record(1, 'initial');
  }
  #prepare() {
    if (this.#archiveError) throw new Error(this.#archiveError);
    this.#lock();
    if (this.#lanes.every(l => l.outcome)) {
      if(this.#motion.size)return;
      if (this.#sample + 1 >= this.#config.samples) return false;
      this.#nextSample();
    }
    return true;
  }
  async #admit(lane,signal){
    const previous=this.#remoteTail;let release;const gate=new Promise(r=>release=r);this.#remoteTail=previous.then(()=>gate);this.#waiting.add(lane);this.#emit();let abort;
    try{await Promise.race([previous,new Promise((_,reject)=>{abort=()=>reject(new Error('Cancelled'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});})]);if(signal.aborted)throw new Error('Cancelled');return release;}catch(error){release();throw error;}finally{signal.removeEventListener('abort',abort);this.#waiting.delete(lane);this.#emit();}
  }
  async #one(index,epoch){
    const lane=this.#lanes[index];
    if(!lane.outcome)lane.timer.start();
    if(this.#config.gravity||lane.provider.kind!=='remote')return this.#place(index,epoch);
    if(epoch!==this.#epoch||lane.outcome||lane.controller.view.busy||this.#waiting.has(lane))return;
    const previous=this.#remoteTail;let release;this.#remoteTail=new Promise(r=>release=r);
    this.#waiting.add(lane);this.#emit();
    try{await previous;this.#waiting.delete(lane);if(epoch!==this.#epoch||lane!==this.#lanes[index])return;await this.#place(index,epoch);}finally{this.#waiting.delete(lane);release();}
  }
  async #place(index, epoch) {
    const lane = this.#lanes[index];
    if (epoch !== this.#epoch || lane.outcome || lane.controller.view.busy) return;
    lane.capturing=!!this.#onPlacement;lane.before=null;
    const previousPieces=lane.controller.view.pieces,started = performance.now();
    await lane.controller.step({ continueRunning: this.#auto,admitDecision:this.#config.gravity&&lane.provider.kind==='remote'?signal=>this.#admit(lane,signal):null });
    if (epoch === this.#epoch) this.#decisionElapsedMs += performance.now() - started;
    if (epoch !== this.#epoch || lane !== this.#lanes[index]) return;
    const v = lane.controller.view;lane.capturing=false;
    if(this.#journal?.incomplete){this.#archiveError=this.#journal.archiveError;this.#fence('stopped');this.#state='stopped';this.#emit();return;}
    if (v.status === 'error' || v.status === 'over' || v.status === 'won' || v.pieces >= this.#config.pieceCap) {
      lane.outcome = freeze({ status: v.status === 'error' ? 'error' : v.status === 'won' ? 'won' : v.status === 'over' ? 'over' : 'capped',
        reason: v.error ?? v.observation.terminalReason ?? 'piece cap', censored: !['over', 'won'].includes(v.status),
        pieces: v.pieces, score: v.observation.score, lines: v.observation.lines });
    }
    this.#record(index, lane.outcome ? 'outcome' : 'placement');
    if(this.#onPlacement&&lane.before&&v.pieces===previousPieces+1&&!v.error&&!v.recoveryRequired){const job=new AbortController();this.#motion.set(index,job);lane.presentation={phase:'placing',before:lane.before};this.#emit();try{await Promise.race([Promise.resolve(this.#onPlacement(placementEvent(lane.before,v,{lane:index,generation:epoch,signal:job.signal}))),new Promise(r=>job.signal.addEventListener('abort',r,{once:true}))]);}catch{}finally{if(this.#motion.get(index)===job)this.#motion.delete(index);}if(epoch!==this.#epoch||lane!==this.#lanes[index])return;}
    lane.presentation=null;lane.before=null;if(lane.outcome)lane.timer.finish();else if(!this.#auto)lane.timer.pause();this.#finishPair();
    this.#emit();
  }
  async #loop(index, epoch) {
    if (!this.#auto || epoch !== this.#epoch) return;
    await this.#one(index, epoch);
    if (!this.#auto || epoch !== this.#epoch) return;
    if (this.#lanes.every(l => l.outcome)) {
      if(this.#motion.size)return;
      if (this.#sample + 1 >= this.#config.samples) { this.#auto = false; this.#state = 'completed'; this.#emit(); }
      else { this.#nextSample(); this.#startLive(); }
    } else if (!this.#lanes[index].outcome) this.#schedule(() => this.#loop(index, epoch), epoch);
  }
  #startLive() {
    this.#auto = true; this.#state = 'running'; const epoch = this.#epoch;
    // Each lane owns its loop. A slow or failed lane never paces/stops its peer.
    this.#loop(0, epoch); this.#loop(1, epoch); this.#emit();
  }
  start() {
    if (this.#auto || this.view.busy) return;
    if (this.#mode === 'replay') { this.#auto = true; this.#state = 'replay'; this.#playReplay(this.#epoch); return; }
    if (this.#prepare()) this.#startLive();
  }
  async step() {
    if (this.#auto || this.view.busy) return;
    if (this.#mode === 'replay') { await this.#replayNext(); return; }
    if (!this.#prepare()) return;
    this.#state = 'paused'; const epoch = this.#epoch;
    await Promise.all([this.#one(0, epoch), this.#one(1, epoch)]);
    if (epoch !== this.#epoch) return;
    if (this.#lanes.every(l => l.outcome) && this.#sample + 1 >= this.#config.samples) this.#state = 'completed';
    this.#emit();
  }
  pause() { if (this.#state === 'completed' && this.#mode === 'live') return; this.#fence(); this.#state = this.#mode === 'replay' ? 'replay' : 'paused'; this.#emit(); }
  stop() { if (this.#state === 'completed' && this.#mode === 'live') return; this.#fence('stopped'); this.#state = this.#mode === 'replay' ? 'replay' : 'stopped'; this.#emit(); }
  reset() {
    this.#run++;this.#gameEpoch++;
    this.#fence('stopped');this.#history=[]; this.#sample = 0; this.#locked = false; this.#frames = []; this.#frameBytes = 0;
    this.#pairs = []; this.#policies = []; this.#decisionElapsedMs = 0; this.#archiveError = null; this.#mode = 'live'; this.#replayIndex = -1; this.#replayLanes = [];
    this.#state = 'ready'; this.#setup(); this.#emit();
  }
  replay() {
    if (!this.#frames.length) throw new Error('Run or step before replaying saved frames.');
    this.#savedExport=this.exportRun();this.#fence(); this.#mode = 'replay'; this.#state = 'replay'; this.#replayIndex = -1;
    this.#replayLanes = this.#frames.slice(0, 2).map(frame => this.#replayView(frame)); this.#auto = true; this.#playReplay(this.#epoch);
  }
  #replayView(frame) { return freeze({ ...replayView(frame), policy: this.#policies.find(p => p.id === frame.policyId).policy }); }
  async #replayNext() {
    if (this.#replayIndex + 1 >= this.#frames.length) { this.#auto = false; this.#emit(); return false; }
    const frame=this.#frames[++this.#replayIndex],before=this.#replayLanes[frame.lane],after=this.#replayView(frame),epoch=this.#epoch;
    if(!this.#config.gravity&&this.#onPlacement&&before?.observation.active&&after.pieces===before.pieces+1&&after.lastDecision?.candidate?.path){const job=new AbortController();this.#motion.set(frame.lane,job);this.#replayLanes[frame.lane]=freeze({...after,presentation:{phase:'placing',before}});this.#emit();try{await Promise.race([Promise.resolve(this.#onPlacement(placementEvent(before,after,{lane:frame.lane,generation:epoch,replay:true,signal:job.signal}))),new Promise(r=>job.signal.addEventListener('abort',r,{once:true}))]);}catch{}finally{if(this.#motion.get(frame.lane)===job)this.#motion.delete(frame.lane);}if(epoch!==this.#epoch)return false;}
    this.#replayLanes[frame.lane]=after;this.#emit();return true;
  }
  async #playReplay(epoch) {
    if (epoch !== this.#epoch || !this.#auto) return;
    if (await this.#replayNext()&&epoch===this.#epoch&&this.#auto) this.#schedule(() => this.#playReplay(epoch), epoch);
  }
  #summary() {
    return freeze({ expectedPairs: this.#config.samples, observedPairs: this.#pairs.length,
      missingPairs: this.#config.samples - this.#pairs.length, pairs: [...this.#pairs],
      pace:comparisonPace(this.#pairs,this.#lanes.map(l=>l.provider.name),{expectedPairs:this.#config.samples,complete:this.#pairs.length===this.#config.samples,archiveError:this.#archiveError}),
      scoreDifferenceRange: this.#pairs.length ? [Math.min(...this.#pairs.map(p => p.difference.score)), Math.max(...this.#pairs.map(p => p.difference.score))] : null,
      meaning: 'Descriptive player/assistance comparison. Capped/error runs are censored; no winner or model-quality inference.' });
  }
  #exportCurrent(){return this.#journal.exportRun({metadata:{accounting:this.#external?this.#lanes.filter(l=>l.provider.kind==='remote').map(l=>l.provider.runMetadata.accounting):null}});}
  exportRun() {
    if(this.#mode==='replay'&&this.#savedExport)return this.#savedExport;
    if(this.#journal){const current=this.#exportCurrent();if(!this.#history.length)return current;const series=JSON.stringify({version:'decision-ui-comparison-series-1',plannedSamples:this.#config.samples,records:[...this.#history,JSON.parse(current)]});if(bytes(series)>16*1024*1024)throw new Error('Comparison recording byte limit reached');return series;}
    const record = freeze({ version: COMPARISON_VERSION, frameVersion: 1, rulesVersion: RULES.version, schemas: VERSIONS,
      config: this.#config, admission: {
        plannedPlacements: 2 * this.#config.samples * this.#config.pieceCap,
        maximumDecisionWaitMs: 2 * this.#config.samples * this.#config.pieceCap * LIMITS.deadlineMs,
        maximumPaceWaitMs: 2 * this.#config.samples * this.#config.pieceCap * this.#config.paceMs,
        maxFrames: LIMITS.frames, maxExportBytes: LIMITS.exportBytes,
        observedDecisionAttemptMs: this.#decisionElapsedMs,
        meaning: 'Planned waits are conservative aggregate bounds, not measured wall time. Observed lane attempts include preparation and async waiting and may overlap. Paused time has no expiry.' }, policy: { deadlineMs: LIMITS.deadlineMs, plannedPlacements: 2 * this.#config.samples * this.#config.pieceCap,
        lookaheadVersion: LOOKAHEAD_VERSION, pairing: 'Private paired sequences omitted', liveProviders: false, modelCalls: 0,
        actualCostUSD: null, replay: 'Saved visual frames only; not canonical Node verification' },
      summary: this.#summary(), archiveError: this.#archiveError, policies: [...this.#policies], frames: [...this.#frames] });
    const json = JSON.stringify(record);
    if (new TextEncoder().encode(json).length > LIMITS.exportBytes) throw new Error('Export exceeds eight MiB; no file created.');
    return json;
  }
  dispose() { this.#fence('stopped'); this.#onChange = () => {}; }
}
