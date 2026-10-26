import { providerPolicy, compactReceipt, localSearchReceipt } from './provider-policy.mjs';
import { decisionRecord } from './decision-record.mjs';
import { Controller, heuristic, mockProvider, HEURISTIC_WEIGHTS } from './controller.mjs';
import { createLookaheadProvider, LOOKAHEAD_VERSION } from './lookahead.mjs';
import { freeze, VERSIONS } from './harness.mjs';
import { RULES } from './engine.mjs';

export const COMPARISON_VERSION = 'offline-comparison-2';
export const LIMITS = freeze({ samples: 8, pieceCap: 1000, paceMin: 30, paceMax: 1000,
  nodeCap: 4000, timeMs: 1000, deadlineMs: 1500, placements: 2000, frames: 4000, exportBytes: 8 * 1024 * 1024 });
export const PLAYERS = freeze({ local: 'Local heuristic', look1: 'Lookahead depth 1', look2: 'Lookahead depth 2',
  delay: 'Delayed mock', error: 'Error mock', openai:'OpenAI Decisions' });
export const DEFAULT_CONFIG = freeze({ left: 'local', right: 'look1', samples: 1, pieceCap: 1000, paceMs: 150, nodeCap: 4000, timeMs: 500 });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const copy = value => JSON.parse(JSON.stringify(value));
let instances = 0;
export function validateConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Settings must be an object.');
  const c = { ...DEFAULT_CONFIG, ...input };
  if (Object.keys(c).some(k => !Object.hasOwn(DEFAULT_CONFIG, k))) throw new RangeError('Unknown comparison setting.');
  for (const key of ['left', 'right']) if (!Object.hasOwn(PLAYERS, c[key])) throw new RangeError(`${key} player is unavailable. Choose a local player or mock.`);
  for (const [key, min, max] of [['samples', 1, 8], ['pieceCap', 1, 1000], ['paceMs', 30, 1000], ['nodeCap', 1, 4000], ['timeMs', 1, 1000]]) {
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) throw new RangeError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  if ((c.left==='openai'||c.right==='openai') && (c.left!=='local'||c.right!=='openai'||c.samples!==1)) throw new RangeError('OpenAI comparison requires Local heuristic left, OpenAI right, and one sample.');
  if (2 * c.samples * c.pieceCap > LIMITS.placements) throw new RangeError('Planned placements exceed 2000.');
  return freeze(c);
}
export function providerFor(key, config) {
  if (key==='openai') throw new Error('Connect OpenAI before playing.');
  if (key === 'local') return heuristic();
  if (key === 'delay' || key === 'error') return mockProvider({ mode: key, delayMs: 250 });
  return createLookaheadProvider({ depth: key === 'look2' ? 2 : 1, nodeCap: config.nodeCap, callCap: config.nodeCap, timeMs: config.timeMs });
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

/** Own local controllers and own saved frames only. No transport, import, or canonical replay verifier. */
export class Comparison {
  #config; #factory; #onChange; #lanes = []; #sample = 0; #epoch = 0; #timers = new Set(); #auto = false;
  #state = 'ready'; #locked = false; #frames = []; #frameBytes = 0; #pairs = []; #policies = []; #archiveError = null;
  #decisionElapsedMs = 0; #gameEpoch=0;
  #mode = 'live'; #replayIndex = -1; #replayLanes = []; #id = ++instances;
  #seeds = Array.from({ length: 8 }, (_, i) => (0x51f15e + Math.imul(i + 1, 0x9e3779b9)) >>> 0);
  constructor({ config = {}, onChange = () => {}, providerFactory = providerFor } = {}) {
    this.#config = validateConfig(config); this.#onChange = onChange; this.#factory = providerFactory; this.#setup();
  }
  get view() {
    const lanes = this.#mode === 'replay' ? [...this.#replayLanes] : this.#lanes.map(l => this.#laneView(l));
    return freeze({ version: COMPARISON_VERSION, config: this.#config, locked: this.#locked, state: this.#state, mode: this.#mode,
      sample: this.#sample + 1, lanes, busy: this.#lanes.some(l => l.controller.view.busy), auto: this.#auto,
      frameCount: this.#frames.length, replayIndex: this.#replayIndex, archiveError: this.#archiveError, summary: this.#summary() });
  }
  #laneView(lane) {
    const view = lane.controller.view;
    return freeze({ ...view, status: lane.outcome?.status ?? view.status, outcome: lane.outcome,
      assistance: lane.key.startsWith('look') ? `visible-depth-${lane.key.slice(-1)}-full-occupancy-v1` : 'canonical-afterstates-v1',
      search: compactSearch(lane.provider), policy: lane.policy });
  }
  #emit() { this.#onChange(this.view); }
  #setup() {
    this.#lanes = ['left', 'right'].map((side, index) => {
      const key = this.#config[side], provider = this.#factory(key, this.#config, { sample: this.#sample + 1, lane: index });
      const lane = { key, provider, outcome: null, controller: null, policy: this.#config.right==='openai'?providerPolicy(provider):lanePolicy(provider, key) };
      lane.controller = new Controller({ seed: this.#seeds[this.#sample], sessionId: provider.controllerBinding?.sessionId ?? `compare-${this.#id}-${this.#epoch}-${index}`, gameEpoch:provider.kind==='remote'?this.#gameEpoch:0,
        provider, deadlineMs: LIMITS.deadlineMs, onChange: () => { if (this.#lanes.includes(lane)) this.#emit(); } });
      return lane;
    });
  }
  configure(config) {
    if (this.#locked) throw new Error('Settings are locked until Reset.');
    const next = validateConfig(config); this.#fence(); this.#config = next; this.#setup(); this.#emit();
  }
  #record(index, event) {
    if (this.#archiveError) return;
    const lane = this.#lanes[index], view = this.#laneView(lane);
    const policyId = `sample-${this.#sample + 1}-lane-${index}`;
    if (!this.#policies.some(p => p.id === policyId)) this.#policies.push(freeze({ id: policyId,
      sample: this.#sample + 1, lane: index, player: copy(view.player), policy: lane.policy }));
    const frame = freeze(copy({ version: 1, sample: this.#sample + 1, lane: index, event, status: view.status,
      observation: compactObservation(view.observation), pieces: view.pieces, player: view.player, assistance: view.assistance,
      error: view.error?.slice(0, 500) ?? null, outcome: view.outcome, decision: compactDecision(view.lastDecision,this.#config.right==='openai',lane.provider), search: view.search, policyId }));
    const length = bytes(frame);
    if (this.#frames.length >= LIMITS.frames || this.#frameBytes + length > (this.#config.right==='openai'?16*1024*1024:LIMITS.exportBytes) - 131072) {
      this.#archiveError = 'Saved-frame capacity reached. Play stopped; existing frames and outcomes are retained.';
      this.#fence(); this.#state = 'stopped'; return;
    }
    this.#frames.push(frame); this.#frameBytes += length;
  }
  #lock() {
    if (!this.#locked) { this.#locked = true; this.#record(0, 'initial'); this.#record(1, 'initial'); }
  }
  #fence(status = 'paused') {
    this.#auto = false; this.#epoch++;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const lane of this.#lanes) if (!lane.outcome) lane.controller[status === 'stopped' ? 'stop' : 'pause']();
  }
  #schedule(fn, epoch) {
    const timer = setTimeout(() => { this.#timers.delete(timer); if (epoch === this.#epoch && this.#auto) fn(); }, this.#config.paceMs);
    this.#timers.add(timer);
  }
  #finishPair() {
    if (!this.#lanes.every(l => l.outcome) || this.#pairs.some(p => p.sample === this.#sample + 1)) return;
    const [left, right] = this.#lanes.map(l => l.outcome);
    this.#pairs.push(freeze({ sample: this.#sample + 1, left, right,
      difference: { score: left.score - right.score, lines: left.lines - right.lines, pieces: left.pieces - right.pieces } }));
  }
  #nextSample() {
    this.#fence(); this.#sample++; this.#setup(); this.#record(0, 'initial'); this.#record(1, 'initial');
  }
  #prepare() {
    if (this.#archiveError) throw new Error(this.#archiveError);
    this.#lock();
    if (this.#lanes.every(l => l.outcome)) {
      if (this.#sample + 1 >= this.#config.samples) return false;
      this.#nextSample();
    }
    return true;
  }
  async #one(index, epoch) {
    const lane = this.#lanes[index];
    if (epoch !== this.#epoch || lane.outcome || lane.controller.view.busy) return;
    const started = performance.now();
    await lane.controller.step({ continueRunning: this.#auto });
    if (epoch === this.#epoch) this.#decisionElapsedMs += performance.now() - started;
    if (epoch !== this.#epoch || lane !== this.#lanes[index]) return;
    const v = lane.controller.view;
    if (v.status === 'error' || v.status === 'over' || v.status === 'won' || v.pieces >= this.#config.pieceCap) {
      lane.outcome = freeze({ status: v.status === 'error' ? 'error' : v.status === 'won' ? 'won' : v.status === 'over' ? 'over' : 'capped',
        reason: v.error ?? v.observation.terminalReason ?? 'piece cap', censored: !['over', 'won'].includes(v.status),
        pieces: v.pieces, score: v.observation.score, lines: v.observation.lines });
    }
    this.#record(index, lane.outcome ? 'outcome' : 'placement'); this.#finishPair();
    this.#emit();
  }
  async #loop(index, epoch) {
    if (!this.#auto || epoch !== this.#epoch) return;
    await this.#one(index, epoch);
    if (!this.#auto || epoch !== this.#epoch) return;
    if (this.#lanes.every(l => l.outcome)) {
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
    if (this.#mode === 'replay') { this.#replayNext(); return; }
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
    this.#gameEpoch++;
    this.#fence('stopped'); this.#sample = 0; this.#locked = false; this.#frames = []; this.#frameBytes = 0;
    this.#pairs = []; this.#policies = []; this.#decisionElapsedMs = 0; this.#archiveError = null; this.#mode = 'live'; this.#replayIndex = -1; this.#replayLanes = [];
    this.#state = 'ready'; this.#setup(); this.#emit();
  }
  replay() {
    if (!this.#frames.length) throw new Error('Run or step before replaying saved frames.');
    this.#fence(); this.#mode = 'replay'; this.#state = 'replay'; this.#replayIndex = -1;
    this.#replayLanes = this.#frames.slice(0, 2).map(frame => this.#replayView(frame)); this.#auto = true; this.#playReplay(this.#epoch);
  }
  #replayView(frame) { return freeze({ ...replayView(frame), policy: this.#policies.find(p => p.id === frame.policyId).policy }); }
  #replayNext() {
    if (this.#replayIndex + 1 >= this.#frames.length) { this.#auto = false; this.#emit(); return false; }
    const frame = this.#frames[++this.#replayIndex]; this.#replayLanes[frame.lane] = this.#replayView(frame); this.#emit(); return true;
  }
  #playReplay(epoch) {
    if (epoch !== this.#epoch || !this.#auto) return;
    if (this.#replayNext()) this.#schedule(() => this.#playReplay(epoch), epoch);
  }
  #summary() {
    return freeze({ expectedPairs: this.#config.samples, observedPairs: this.#pairs.length,
      missingPairs: this.#config.samples - this.#pairs.length, pairs: [...this.#pairs],
      scoreDifferenceRange: this.#pairs.length ? [Math.min(...this.#pairs.map(p => p.difference.score)), Math.max(...this.#pairs.map(p => p.difference.score))] : null,
      meaning: 'Descriptive player/assistance comparison. Capped/error runs are censored; no winner or model-quality inference.' });
  }
  exportRun() {
    if(this.#config.right==='openai')return decisionRecord({mode:'comparison',policies:this.#policies,frames:this.#frames,finals:this.#lanes.map(l=>({score:l.controller.view.observation.score,lines:l.controller.view.observation.lines,pieces:l.controller.view.pieces})),reasons:this.#lanes.map(l=>l.outcome?.reason??l.controller.view.status),metadata:{config:{left:this.#config.left,right:this.#config.right,samples:this.#config.samples,pieceCap:this.#config.pieceCap,paceMs:this.#config.paceMs},archiveError:this.#archiveError,accounting:this.#lanes.filter(l=>l.provider.kind==='remote').map(l=>l.provider.runMetadata.accounting)}});
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
