import {GravityController} from './gravity-controller.mjs';
import {gravityPolicy} from './ai-gravity.mjs';
import {placementEvent,depth2Error} from './placement-motion.mjs';
import { providerPolicy, compactReceipt, localSearchReceipt } from './provider-policy.mjs';
import { DecisionJournal } from './decision-record.mjs';
import { createGame, start, move, rotate, softDrop, hardDrop, tick, togglePause, DEFAULT_SEED, RULES } from './engine.mjs';
import { Controller, heuristic, HEURISTIC_WEIGHTS } from './controller.mjs';
import { observe, freeze } from './harness.mjs';

export const VERSUS_VERSION = 'human-local-versus-2';
// Finite normal-play envelope: 40 human input/gravity frames per placement,
// one algorithm frame per placement, plus lifecycle headroom. Further corrections
// still consume the same strict shared capacity; no frames are silently discarded.
export const VERSUS_RECORDING_PROFILE = freeze({ version: 'versus-recording-2',
  humanFramesPerPlacement: 40, algorithmFramesPerPlacement: 1, lifecycleFrames: 8000,
  humanFrameBytes: 1024, algorithmFrameBytes: 4096, lifecycleFrameBytes: 2048,
  meaning: 'Normal-play admission estimates, not an unlimited correction or per-frame size guarantee; actual frame/byte guards always apply.' });
export const VERSUS_LIMITS = freeze({ pieces: 1000, frames: 50000, exportBytes: 64 * 1024 * 1024,
  metadataReserveBytes: 160 * 1024, terminalReserveFrames: 4, deadlineMs: 1500,
  recordingProfile: VERSUS_RECORDING_PROFILE });
export function versusRecordingAdmission(pieceCap = VERSUS_LIMITS.pieces) {
  if (!Number.isInteger(pieceCap) || pieceCap < 1 || pieceCap > VERSUS_LIMITS.pieces) throw new RangeError('Bounded piece cap required for recording admission.');
  const p = VERSUS_RECORDING_PROFILE;
  return freeze({ profileVersion: p.version,
    plannedHumanFrames: pieceCap * p.humanFramesPerPlacement,
    plannedAlgorithmFrames: pieceCap * p.algorithmFramesPerPlacement,
    lifecycleFrameAllowance: p.lifecycleFrames,
    plannedFrames: pieceCap * (p.humanFramesPerPlacement + p.algorithmFramesPerPlacement) + p.lifecycleFrames,
    plannedBytes: pieceCap * (p.humanFramesPerPlacement * p.humanFrameBytes + p.algorithmFramesPerPlacement * p.algorithmFrameBytes) +
      p.lifecycleFrames * p.lifecycleFrameBytes + VERSUS_LIMITS.metadataReserveBytes });
}
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = o => ({ board: o.board.map(row => row.map(c => c ?? '.').join('')), active: o.active,
  next: [...o.next], score: o.score, lines: o.lines, level: o.level, status: o.status, terminalReason: o.terminalReason });
const decision = (last,compactPath=false,provider) => last ? { receipt:provider.kind==='remote'?compactReceipt(last.receipt):provider.runMetadata?.search?localSearchReceipt(last.receipt):null, latencyMs: last.latencyMs, candidate: { piece: last.candidate.piece,
  orientation: last.candidate.orientation, cells: last.candidate.cells, path:compactPath?last.candidate.path.map(a=>({left:'L',right:'R',clockwise:'C',down:'D',drop:'H'})[a]).join(''):last.candidate.path,pathEncoding:compactPath?'LRCDH-1':undefined,
  clearedRows: last.candidate.clearedRows, scoreDelta: last.candidate.scoreDelta, linesDelta: last.candidate.linesDelta,
  features: last.candidate.features, featureDeltas: last.candidate.featureDeltas } } : null;
const ACTIONS = { left: s => move(s, -1), right: s => move(s, 1), rotate, down: softDrop, drop: hardDrop };
let instance = 0;

/** Independent manual engine state and local Controller, sharing only explicit lifecycle controls. */
export class HumanVersus {
  #id = ++instance; #session = 0; #human; #revision = 0; #pieces = 0; #humanOutcome = null;
  #externalPolicy=null; #ai; #aiOutcome = null; #provider; #factory; #epoch = 0; #timer = null; #state = 'ready';
  #clock; #gravity; #pieceCap; #paceMs; #onChange; #frames = []; #bytes = 0; #recording = false; #archiveError = null;
  #onPlacement; #presentation=null; #capture=false; #before=null; #motion=null; #algorithmElapsedMs = 0; #humanGravityMs = 0; #journal=null; #savedExport=null;
  #mode = 'live'; #replayLanes = []; #replayIndex = -1; #playback = false;
  constructor({ clock, gravity=false, pieceCap = 1000, paceMs = 500, providerFactory = () => heuristic(), onChange = () => {},onPlacement=null } = {}) {
    if (!Number.isInteger(pieceCap) || pieceCap < 1 || pieceCap > 1000 || !Number.isInteger(paceMs) || paceMs < 150 || paceMs > 1000) throw new RangeError('Bounded piece cap and algorithm pace required.');
    if(typeof gravity!=='boolean')throw new TypeError('Gravity must be on or off.');this.#clock=clock;this.#gravity=gravity;this.#pieceCap = pieceCap; this.#paceMs = paceMs; this.#factory = providerFactory; this.#onChange = onChange;this.#onPlacement=onPlacement; this.#setup();
  }
  #setup() {
    this.#human = createGame(DEFAULT_SEED); this.#revision = 0; this.#pieces = 0;
    this.#humanOutcome = null; this.#aiOutcome = null; this.#provider = this.#factory();this.#externalPolicy=this.#provider.kind==='remote'?providerPolicy(this.#provider):null;
    if (!['local', 'mock', 'remote'].includes(this.#provider?.kind)) throw new Error('Only local or test-mock algorithms are supported.');
    const controller = new (this.#gravity?GravityController:Controller)({ seed: DEFAULT_SEED, sessionId: this.#provider.controllerBinding?.sessionId ?? `versus-${this.#id}-${this.#epoch}`,gameEpoch:this.#provider.kind==='remote'?this.#session:0,
      provider: this.#provider,pieceCap:this.#pieceCap,...(this.#clock?{clock:this.#clock}:{}), deadlineMs: VERSUS_LIMITS.deadlineMs, onTransition:({input,view})=>{if(this.#journal&&(!this.#journal.incomplete||['computer','spawn'].includes(input.kind))&&this.#mode==='live')this.#journal.append(1,input,view);}, onChange:view=>{if(this.#capture&&view.busy&&!this.#before){this.#before=view;this.#presentation={phase:'choosing',before:view};}if(this.#ai===controller)this.#emit();} });
    this.#ai = controller;
    this.#journal=(this.#provider.kind==='remote'||this.#gravity)?new DecisionJournal({mode:'versus',pieceCap:this.#pieceCap}):null;this.#savedExport=null;
    this.#journal?.addLane(0,'human',this.#humanView(),this.#policies()[0]);
    this.#journal?.addLane(1,'computer',this.#ai.view,this.#policies()[1]);
  }
  configure(providerFactory,{gravity=this.#gravity}={}) {if(this.#recording)throw new Error('Settings are locked until Reset.');if(typeof gravity!=='boolean')throw new TypeError('Gravity must be on or off.');this.#gravity=gravity;this.#factory=providerFactory;this.#setup();this.#emit();}
  #humanView() {
    return freeze({ observation: observe(this.#human, { sessionId: `human-${this.#id}-${this.#session}`, revision: this.#revision }),
      status: this.#humanOutcome?.status ?? (this.#state === 'stopped' && this.#human.status !== 'ready' ? 'stopped' : this.#human.status),
      pieces: this.#pieces, player: { name: 'Human', kind: 'human', version: 'manual-focused-clock-1' },
      outcome: this.#humanOutcome, error: null, lastDecision: null, busy: false });
  }
  #aiView() { return freeze({ ...this.#ai.view,presentation:this.#presentation,error:depth2Error(this.#provider,this.#ai.view.error,'versus'), status: this.#aiOutcome?.status ?? this.#ai.view.status, outcome: this.#aiOutcome }); }
  #policies() {
    return freeze([{ version: 'manual-focused-clock-1', kind: 'human', rulesVersion: RULES.version,
      timing: 'Real gravity in focused running play; independent of algorithm choosing; elapsed chunks at most250ms', pieceCap: this.#pieceCap },
    this.#gravity?gravityPolicy(providerPolicy(this.#provider)):this.#provider.kind==='remote'?this.#externalPolicy:this.#provider.runMetadata?.search?.version==='visible-beam-search-1'?providerPolicy(this.#provider):{ version: this.#provider.version, kind: this.#provider.kind, rulesVersion: RULES.version,
      assistance: 'canonical-afterstates-v1', weights: this.#provider.kind === 'local' && this.#provider.version === 'heuristic-2' ? HEURISTIC_WEIGHTS : null,
      paceMs: this.#paceMs, deadlineMs: VERSUS_LIMITS.deadlineMs, pieceCap: this.#pieceCap, live: false }]);
  }
  get view() {
    return freeze({ version: VERSUS_VERSION, gravity:this.#gravity, state: this.#state, mode: this.#mode,
      lanes: this.#mode === 'replay' ? [...this.#replayLanes] : [this.#humanView(), this.#aiView()],
      running: this.#state === 'running', busy: (this.#mode === 'live'&&this.#ai.view.busy)||!!this.#motion,
      policies: this.#policies(), limits: { ...VERSUS_LIMITS, pieces: this.#pieceCap, paceMs: this.#paceMs },
      frameCount: this.#frames.length, replayIndex: this.#replayIndex, playback: this.#playback, archiveError: this.#archiveError });
  }
  #emit() { this.#onChange(this.view); }
  #recordHuman(next,input,{pieces=this.#pieces,status=next.status,revision=this.#revision+1}={}) {
    if(!this.#journal||this.#journal.incomplete||this.#mode!=='live')return true;
    try{this.#journal.append(0,input,{observation:observe(next,{sessionId:`human-${this.#id}-${this.#session}`,revision}),pieces,status});return true;}
    catch{this.#haltArchive();return false;}
  }
  #fence(stop = false) {
    this.#epoch++;this.#presentation=null;this.#capture=false;this.#before=null;this.#motion?.abort();this.#motion=null;this.#replayLanes=this.#replayLanes.map(l=>l?.presentation?freeze({...l,presentation:null}):l); this.#playback = false; clearTimeout(this.#timer); this.#timer = null;
    if (this.#human.status === 'playing') { const next=togglePause(this.#human);if(this.#recordHuman(next,{kind:stop?'stop':'pause'},{status:stop?'stopped':'paused'})){this.#human=next;this.#revision++;} }
    if (!this.#aiOutcome) this.#ai[stop ? 'stop' : 'pause']();
  }
  #capacity() {
    if (this.#archiveError) return false;
    if(this.#journal?.incomplete){this.#haltArchive();return false;}
    if (this.#frames.length >= VERSUS_LIMITS.frames - VERSUS_LIMITS.terminalReserveFrames || this.#bytes >= VERSUS_LIMITS.exportBytes - VERSUS_LIMITS.metadataReserveBytes) {
      this.#haltArchive(); return false;
    }
    return true;
  }
  #haltArchive() {
    this.#journal?.censor();
    this.#archiveError = 'Saved recording capacity reached. Play stopped; unfinished lanes are censored, not Marathon completions. Replay/export contain only retained frames.';
    this.#state = 'stopped'; this.#fence(true); this.#emit();
  }
  #record(lane, event) {
    if (!this.#recording || this.#archiveError) return;
    const v = lane === 0 ? this.#humanView() : this.#aiView();
    const frame = freeze(clone({ version: 1, lane, event, status: v.status, observation: snapshot(v.observation),
      pieces: v.pieces, player: v.player, outcome: v.outcome, error: v.error?.slice(0, 500) ?? null,
      lastDecision: decision(v.lastDecision,this.#provider.kind==='remote',this.#provider), policyIndex: lane }));
    const bytes = size(frame);
    if (this.#frames.length >= VERSUS_LIMITS.frames || this.#bytes + bytes > VERSUS_LIMITS.exportBytes - VERSUS_LIMITS.metadataReserveBytes) { this.#haltArchive(); return; }
    this.#frames.push(frame); this.#bytes += bytes;
  }
  #beginRecording() {
    if (this.#recording) return;
    this.#recording = true; this.#record(0, 'initial'); this.#record(1, 'initial');
  }
  #outcome(view) {
    return freeze({ status: view.status === 'error' ? 'error' : view.observation.status === 'won' ? 'won' : view.observation.status === 'over' ? 'over' : 'capped',
      reason: view.error ?? view.observation.terminalReason ?? 'piece cap', censored: !['over', 'won'].includes(view.observation.status),
      score: view.observation.score, lines: view.observation.lines, pieces: view.pieces });
  }
  #finish() { if (this.#humanOutcome && this.#aiOutcome) { this.#state = 'completed'; this.#fence(); } }
  start() {
    if(this.#motion)return;
    if (this.#mode === 'replay') { if (!this.#playback) { this.#playback = true; this.#playReplay(this.#epoch); } return; }
    if (this.#state === 'running' || this.#state === 'completed' || (this.#ai.view.busy||this.#motion) || !this.#capacity()) return;
    this.#beginRecording();
    if (!this.#humanOutcome) {
      const next=this.#human.status==='ready'?start(this.#human):this.#human.status==='paused'?togglePause(this.#human):this.#human;
      if(!this.#recordHuman(next,{kind:'resume'}))return;this.#human=next;this.#revision++;
    }
    this.#state = 'running'; this.#record(0, 'resume'); this.#emit();
    if (!this.#aiOutcome) this.#runAI(this.#epoch);
  }
  pause() {
    if (this.#state === 'completed') return;
    this.#state = this.#mode === 'replay' ? 'replay' : 'paused'; this.#fence();
    if (this.#mode === 'live') { this.#record(0, 'pause'); this.#record(1, 'pause'); } this.#emit();
  }
  stop() {
    if (this.#state === 'completed') return;
    this.#state = this.#mode === 'replay' ? 'replay' : 'stopped'; this.#fence(true);
    if (this.#mode === 'live') { this.#record(0, 'stop'); this.#record(1, 'stop'); } this.#emit();
  }
  reset() {
    this.#state = 'stopped'; this.#fence(true); this.#frames = []; this.#bytes = 0; this.#recording = false;
    this.#archiveError = null; this.#algorithmElapsedMs = 0; this.#humanGravityMs = 0; this.#mode = 'live'; this.#replayLanes = []; this.#replayIndex = -1;
    this.#state = 'ready'; this.#session++; this.#setup(); this.#emit();
  }
  #applyHuman(next, event) {
    const old = this.#human; if (next === old) return;
    const pieces=this.#pieces+(next.board!==old.board?1:0);
    const capped=pieces>=this.#pieceCap&&next.status==='playing';
    const retained=capped?togglePause(next):next;
    if(!this.#recordHuman(retained,event,{pieces,status:capped?'capped':next.status}))return;
    this.#human = next; this.#revision++;
    const visible = next.active !== old.active || next.board !== old.board || next.status !== old.status;
    if (next.board !== old.board) this.#pieces++;
    if (next.status === 'over' || next.status === 'won' || this.#pieces >= this.#pieceCap) {
      this.#humanOutcome = this.#outcome(this.#humanView());
      if (this.#human.status === 'playing') this.#human = togglePause(this.#human);
    }
    if (visible) { this.#record(0, this.#humanOutcome ? 'outcome' : event.kind==='tick'?'gravity':event.action); this.#finish(); this.#emit(); }
  }
  input(action) {
    if (!Object.hasOwn(ACTIONS, action)) throw new RangeError('Unknown human action.');
    if (this.#mode !== 'live' || this.#state !== 'running' || this.#humanOutcome || !this.#capacity()) return;
    this.#applyHuman(ACTIONS[action](this.#human), {kind:'human',action});
  }
  tick(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Nonnegative finite elapsed time required.');
    if (this.#mode !== 'live' || this.#state !== 'running' || this.#humanOutcome || !this.#capacity()) return;
    this.#humanGravityMs += Math.min(250, elapsedMs);
    this.#applyHuman(tick(this.#human, Math.min(250, elapsedMs)), {kind:'tick',elapsedMs:Math.min(250,elapsedMs)});
  }
  async #oneAI(epoch) {
    if (epoch !== this.#epoch || this.#aiOutcome || (this.#ai.view.busy||this.#motion) || !this.#capacity()) return;
    const controller = this.#ai;
    this.#capture=!!this.#onPlacement&&!this.#gravity;this.#before=null;const previousPieces=controller.view.pieces;
    const started = performance.now();
    await controller.step({ continueRunning: this.#state === 'running' });
    if (epoch === this.#epoch) this.#algorithmElapsedMs += performance.now() - started;
    if (epoch !== this.#epoch || controller !== this.#ai) return;
    const v = controller.view;this.#capture=false;
    if(this.#journal?.incomplete){this.#haltArchive();return;}
    if (v.status === 'error' || v.status === 'over' || v.status === 'won' || v.pieces >= this.#pieceCap) this.#aiOutcome = this.#outcome(v);
    this.#record(1, this.#aiOutcome ? 'outcome' : 'placement');
    if(this.#onPlacement&&this.#before&&v.pieces===previousPieces+1&&!v.error&&!v.recoveryRequired){const job=new AbortController();this.#motion=job;this.#presentation={phase:'placing',before:this.#before};this.#emit();try{await Promise.race([Promise.resolve(this.#onPlacement(placementEvent(this.#before,v,{lane:1,generation:epoch,signal:job.signal}))),new Promise(r=>job.signal.addEventListener('abort',r,{once:true}))]);}catch{}finally{if(this.#motion===job)this.#motion=null;}if(epoch!==this.#epoch||controller!==this.#ai)return;}
    this.#presentation=null;this.#before=null;this.#finish(); this.#emit();
  }
  async #runAI(epoch) {
    if (this.#mode !== 'live' || this.#state !== 'running' || epoch !== this.#epoch || this.#aiOutcome) return;
    await this.#oneAI(epoch);
    if (epoch === this.#epoch && this.#state === 'running' && !this.#aiOutcome) this.#timer = setTimeout(() => this.#runAI(epoch), this.#gravity?0:this.#paceMs);
  }
  async stepAlgorithm() {
    if(this.#motion)return;
    if (this.#mode === 'replay') { if (!this.#playback) await this.#nextReplay(); return; }
    if (this.#state === 'running' || this.#state === 'completed' || (this.#ai.view.busy||this.#motion) || !this.#capacity()) return;
    this.#beginRecording(); this.#state = 'paused'; this.#fence(); const epoch = this.#epoch;
    await this.#oneAI(epoch);
  }
  #savedView(frame) {
    return freeze({ ...frame, status: 'replay', recordedStatus: frame.status, busy: false,
      observation: { ...frame.observation, board: frame.observation.board.map(row => [...row].map(c => c === '.' ? null : c)) } });
  }
  replay() {
    if (!this.#frames.length) throw new Error('Start or step before replaying saved frames.');
    this.#savedExport=this.exportRun();this.#state = 'replay'; this.#fence(); this.#mode = 'replay'; this.#replayIndex = -1;
    this.#replayLanes = this.#frames.slice(0, 2).map(frame => this.#savedView(frame));
    this.#playback = true; this.#playReplay(this.#epoch);
  }
  async #nextReplay() {
    if (this.#replayIndex + 1 >= this.#frames.length) { this.#playback = false; this.#emit(); return false; }
    const f=this.#frames[++this.#replayIndex],before=this.#replayLanes[f.lane],after=this.#savedView(f),epoch=this.#epoch;
    if(!this.#gravity&&this.#onPlacement&&f.lane===1&&before?.observation.active&&after.pieces===before.pieces+1&&after.lastDecision?.candidate?.path){const job=new AbortController();this.#motion=job;this.#replayLanes[f.lane]=freeze({...after,presentation:{phase:'placing',before}});this.#emit();try{await Promise.race([Promise.resolve(this.#onPlacement(placementEvent(before,after,{lane:1,generation:epoch,replay:true,signal:job.signal}))),new Promise(r=>job.signal.addEventListener('abort',r,{once:true}))]);}catch{}finally{if(this.#motion===job)this.#motion=null;}if(epoch!==this.#epoch)return false;}
    this.#replayLanes[f.lane]=after;this.#emit();return true;
  }
  async #playReplay(epoch) {
    if (epoch !== this.#epoch || !this.#playback) return;
    if (await this.#nextReplay()&&epoch===this.#epoch&&this.#playback) this.#timer = setTimeout(() => this.#playReplay(epoch), this.#paceMs);
  }
  exportRun() {
    if(this.#mode==='replay'&&this.#savedExport)return this.#savedExport;
    if(this.#journal)return this.#mode==='replay'?this.#savedExport:this.#journal.exportRun({metadata:{accounting:this.#provider.kind==='remote'?this.#provider.runMetadata.accounting:null}});
    const record = { version: VERSUS_VERSION, frameVersion: 1, rulesVersion: RULES.version,
      objective: RULES.objective, admission: { recording: versusRecordingAdmission(this.#pieceCap), plannedPlacements: 2 * this.#pieceCap,
        maximumAlgorithmDecisionWaitMs: this.#pieceCap * VERSUS_LIMITS.deadlineMs,
        maximumAlgorithmPaceWaitMs: this.#pieceCap * this.#paceMs,
        maxFrames: VERSUS_LIMITS.frames, maxExportBytes: VERSUS_LIMITS.exportBytes, metadataReserveBytes: VERSUS_LIMITS.metadataReserveBytes,
        observedAlgorithmAttemptMs: this.#algorithmElapsedMs, observedHumanGravityMs: this.#humanGravityMs,
        meaning: 'Planned waits bound algorithm work, not human wall time. Human input/gravity recording shares finite frame/byte capacity. Paused time has no expiry.' }, limits: this.view.limits, policies: this.#policies(), frames: this.#frames,
      outcomes: [this.#humanOutcome, this.#aiOutcome], archiveIncomplete: !!this.#archiveError, archiveCensored: !!this.#archiveError, archiveError: this.#archiveError,
      provenance: { players: 'Human keyboard and local/mock algorithm only', liveProviders: false, modelCalls: 0, actualCostUSD: null,
        pairing: 'Same private deterministic ordinal sequence; seeds and hidden queue omitted',
        timing: 'Independent human gravity and algorithm pace; descriptive, not a fair race or winner claim',
        replay: 'Own saved visual frames only; no new choices or canonical Node verification' } };
    const json = JSON.stringify(record);
    if (new TextEncoder().encode(json).length > VERSUS_LIMITS.exportBytes) throw new Error('Export exceeds 64 MiB; no file created.');
    return json;
  }
  dispose() { this.#onChange = () => {}; this.#state = 'stopped'; this.#fence(true); }
}
