import { createGame, start, move, rotate, softDrop, hardDrop, tick, togglePause, DEFAULT_SEED, RULES } from './engine.mjs';
import { Controller, heuristic, HEURISTIC_WEIGHTS } from './controller.mjs';
import { observe, freeze } from './harness.mjs';

export const VERSUS_VERSION = 'human-local-versus-1';
export const VERSUS_LIMITS = freeze({ pieces: 100, frames: 4000, exportBytes: 8 * 1024 * 1024, deadlineMs: 1500 });
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = value => JSON.parse(JSON.stringify(value));
const snapshot = o => ({ board: o.board.map(row => row.map(c => c ?? '.').join('')), active: o.active,
  next: [...o.next], score: o.score, lines: o.lines, level: o.level, status: o.status, terminalReason: o.terminalReason });
const decision = last => last ? { latencyMs: last.latencyMs, candidate: { piece: last.candidate.piece,
  orientation: last.candidate.orientation, cells: last.candidate.cells, path: last.candidate.path,
  clearedRows: last.candidate.clearedRows, scoreDelta: last.candidate.scoreDelta, linesDelta: last.candidate.linesDelta,
  features: last.candidate.features, featureDeltas: last.candidate.featureDeltas } } : null;
const ACTIONS = { left: s => move(s, -1), right: s => move(s, 1), rotate, down: softDrop, drop: hardDrop };
let instance = 0;

/** Independent manual engine state and local Controller, sharing only explicit lifecycle controls. */
export class HumanVersus {
  #id = ++instance; #session = 0; #human; #revision = 0; #pieces = 0; #humanOutcome = null;
  #ai; #aiOutcome = null; #provider; #factory; #epoch = 0; #timer = null; #state = 'ready';
  #pieceCap; #paceMs; #onChange; #frames = []; #bytes = 0; #recording = false; #archiveError = null;
  #mode = 'live'; #replayLanes = []; #replayIndex = -1; #playback = false;
  constructor({ pieceCap = 100, paceMs = 500, providerFactory = () => heuristic(), onChange = () => {} } = {}) {
    if (!Number.isInteger(pieceCap) || pieceCap < 1 || pieceCap > 100 || !Number.isInteger(paceMs) || paceMs < 150 || paceMs > 1000) throw new RangeError('Bounded piece cap and algorithm pace required.');
    this.#pieceCap = pieceCap; this.#paceMs = paceMs; this.#factory = providerFactory; this.#onChange = onChange; this.#setup();
  }
  #setup() {
    this.#human = createGame(DEFAULT_SEED); this.#revision = 0; this.#pieces = 0;
    this.#humanOutcome = null; this.#aiOutcome = null; this.#provider = this.#factory();
    if (!['local', 'mock'].includes(this.#provider?.kind)) throw new Error('Only local or test-mock algorithms are supported.');
    const controller = new Controller({ seed: DEFAULT_SEED, sessionId: `versus-${this.#id}-${this.#epoch}`,
      provider: this.#provider, deadlineMs: VERSUS_LIMITS.deadlineMs, onChange: () => { if (this.#ai === controller) this.#emit(); } });
    this.#ai = controller;
  }
  #humanView() {
    return freeze({ observation: observe(this.#human, { sessionId: `human-${this.#id}-${this.#session}`, revision: this.#revision }),
      status: this.#humanOutcome?.status ?? (this.#state === 'stopped' && this.#human.status !== 'ready' ? 'stopped' : this.#human.status),
      pieces: this.#pieces, player: { name: 'Human', kind: 'human', version: 'manual-focused-clock-1' },
      outcome: this.#humanOutcome, error: null, lastDecision: null, busy: false });
  }
  #aiView() { return freeze({ ...this.#ai.view, status: this.#aiOutcome?.status ?? this.#ai.view.status, outcome: this.#aiOutcome }); }
  #policies() {
    return freeze([{ version: 'manual-focused-clock-1', kind: 'human', rulesVersion: RULES.version,
      timing: 'Real gravity in focused running play; independent of algorithm choosing; elapsed chunks at most250ms', pieceCap: this.#pieceCap },
    { version: this.#provider.version, kind: this.#provider.kind, rulesVersion: RULES.version,
      assistance: 'canonical-afterstates-v1', weights: this.#provider.kind === 'local' && this.#provider.version === 'heuristic-1' ? HEURISTIC_WEIGHTS : null,
      paceMs: this.#paceMs, deadlineMs: VERSUS_LIMITS.deadlineMs, pieceCap: this.#pieceCap, live: false }]);
  }
  get view() {
    return freeze({ version: VERSUS_VERSION, state: this.#state, mode: this.#mode,
      lanes: this.#mode === 'replay' ? [...this.#replayLanes] : [this.#humanView(), this.#aiView()],
      running: this.#state === 'running', busy: this.#mode === 'live' && this.#ai.view.busy,
      policies: this.#policies(), limits: { ...VERSUS_LIMITS, pieces: this.#pieceCap, paceMs: this.#paceMs },
      frameCount: this.#frames.length, replayIndex: this.#replayIndex, playback: this.#playback, archiveError: this.#archiveError });
  }
  #emit() { this.#onChange(this.view); }
  #fence(stop = false) {
    this.#epoch++; this.#playback = false; clearTimeout(this.#timer); this.#timer = null;
    if (this.#human.status === 'playing') { this.#human = togglePause(this.#human); this.#revision++; }
    if (!this.#aiOutcome) this.#ai[stop ? 'stop' : 'pause']();
  }
  #capacity() {
    if (this.#archiveError) return false;
    if (this.#frames.length >= VERSUS_LIMITS.frames - 4 || this.#bytes >= VERSUS_LIMITS.exportBytes - 163840) {
      this.#haltArchive(); return false;
    }
    return true;
  }
  #haltArchive() {
    this.#archiveError = 'Saved recording capacity reached. Play stopped; replay/export contain only retained frames.';
    this.#state = 'stopped'; this.#fence(true); this.#emit();
  }
  #record(lane, event) {
    if (!this.#recording || this.#archiveError) return;
    const v = lane === 0 ? this.#humanView() : this.#aiView();
    const frame = freeze(clone({ version: 1, lane, event, status: v.status, observation: snapshot(v.observation),
      pieces: v.pieces, player: v.player, outcome: v.outcome, error: v.error?.slice(0, 500) ?? null,
      lastDecision: decision(v.lastDecision), policyIndex: lane }));
    const bytes = size(frame);
    if (this.#frames.length >= VERSUS_LIMITS.frames || this.#bytes + bytes > VERSUS_LIMITS.exportBytes - 131072) { this.#haltArchive(); return; }
    this.#frames.push(frame); this.#bytes += bytes;
  }
  #beginRecording() {
    if (this.#recording) return;
    this.#recording = true; this.#record(0, 'initial'); this.#record(1, 'initial');
  }
  #outcome(view) {
    return freeze({ status: view.status === 'error' ? 'error' : view.observation.status === 'over' ? 'over' : 'completed',
      reason: view.error ?? view.observation.terminalReason ?? 'piece cap', censored: view.observation.status !== 'over',
      score: view.observation.score, lines: view.observation.lines, pieces: view.pieces });
  }
  #finish() { if (this.#humanOutcome && this.#aiOutcome) { this.#state = 'completed'; this.#fence(); } }
  start() {
    if (this.#mode === 'replay') { if (!this.#playback) { this.#playback = true; this.#playReplay(this.#epoch); } return; }
    if (this.#state === 'running' || this.#state === 'completed' || this.#ai.view.busy || !this.#capacity()) return;
    this.#beginRecording();
    if (!this.#humanOutcome) {
      this.#human = this.#human.status === 'ready' ? start(this.#human) : this.#human.status === 'paused' ? togglePause(this.#human) : this.#human;
      this.#revision++;
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
    this.#archiveError = null; this.#mode = 'live'; this.#replayLanes = []; this.#replayIndex = -1;
    this.#state = 'ready'; this.#session++; this.#setup(); this.#emit();
  }
  #applyHuman(next, event) {
    const old = this.#human; if (next === old) return;
    this.#human = next; this.#revision++;
    const visible = next.active !== old.active || next.board !== old.board || next.status !== old.status;
    if (next.board !== old.board) this.#pieces++;
    if (next.status === 'over' || this.#pieces >= this.#pieceCap) {
      this.#humanOutcome = this.#outcome(this.#humanView());
      if (this.#human.status === 'playing') this.#human = togglePause(this.#human);
    }
    if (visible) { this.#record(0, this.#humanOutcome ? 'outcome' : event); this.#finish(); this.#emit(); }
  }
  input(action) {
    if (!Object.hasOwn(ACTIONS, action)) throw new RangeError('Unknown human action.');
    if (this.#mode !== 'live' || this.#state !== 'running' || this.#humanOutcome || !this.#capacity()) return;
    this.#applyHuman(ACTIONS[action](this.#human), action);
  }
  tick(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Nonnegative finite elapsed time required.');
    if (this.#mode !== 'live' || this.#state !== 'running' || this.#humanOutcome || !this.#capacity()) return;
    this.#applyHuman(tick(this.#human, Math.min(250, elapsedMs)), 'gravity');
  }
  async #oneAI(epoch) {
    if (epoch !== this.#epoch || this.#aiOutcome || this.#ai.view.busy || !this.#capacity()) return;
    const controller = this.#ai;
    await controller.step({ continueRunning: this.#state === 'running' });
    if (epoch !== this.#epoch || controller !== this.#ai) return;
    const v = controller.view;
    if (v.status === 'error' || v.status === 'over' || v.pieces >= this.#pieceCap) this.#aiOutcome = this.#outcome(v);
    this.#record(1, this.#aiOutcome ? 'outcome' : 'placement'); this.#finish(); this.#emit();
  }
  async #runAI(epoch) {
    if (this.#mode !== 'live' || this.#state !== 'running' || epoch !== this.#epoch || this.#aiOutcome) return;
    await this.#oneAI(epoch);
    if (epoch === this.#epoch && this.#state === 'running' && !this.#aiOutcome) this.#timer = setTimeout(() => this.#runAI(epoch), this.#paceMs);
  }
  async stepAlgorithm() {
    if (this.#mode === 'replay') { if (!this.#playback) this.#nextReplay(); return; }
    if (this.#state === 'running' || this.#state === 'completed' || this.#ai.view.busy || !this.#capacity()) return;
    this.#beginRecording(); this.#state = 'paused'; this.#fence(); const epoch = this.#epoch;
    await this.#oneAI(epoch);
  }
  #savedView(frame) {
    return freeze({ ...frame, status: 'replay', recordedStatus: frame.status, busy: false,
      observation: { ...frame.observation, board: frame.observation.board.map(row => [...row].map(c => c === '.' ? null : c)) } });
  }
  replay() {
    if (!this.#frames.length) throw new Error('Start or step before replaying saved frames.');
    this.#state = 'replay'; this.#fence(); this.#mode = 'replay'; this.#replayIndex = -1;
    this.#replayLanes = this.#frames.slice(0, 2).map(frame => this.#savedView(frame));
    this.#playback = true; this.#playReplay(this.#epoch);
  }
  #nextReplay() {
    if (this.#replayIndex + 1 >= this.#frames.length) { this.#playback = false; this.#emit(); return false; }
    const f = this.#frames[++this.#replayIndex]; this.#replayLanes[f.lane] = this.#savedView(f); this.#emit(); return true;
  }
  #playReplay(epoch) {
    if (epoch !== this.#epoch || !this.#playback) return;
    if (this.#nextReplay()) this.#timer = setTimeout(() => this.#playReplay(epoch), this.#paceMs);
  }
  exportRun() {
    const record = { version: VERSUS_VERSION, frameVersion: 1, rulesVersion: RULES.version,
      objective: RULES.objective, limits: this.view.limits, policies: this.#policies(), frames: this.#frames,
      outcomes: [this.#humanOutcome, this.#aiOutcome], archiveIncomplete: !!this.#archiveError, archiveError: this.#archiveError,
      provenance: { players: 'Human keyboard and local/mock algorithm only', liveProviders: false, modelCalls: 0, actualCostUSD: null,
        pairing: 'Same private deterministic ordinal sequence; seeds and hidden queue omitted',
        timing: 'Independent human gravity and algorithm pace; descriptive, not a fair race or winner claim',
        replay: 'Own saved visual frames only; no new choices or canonical Node verification' } };
    const json = JSON.stringify(record);
    if (new TextEncoder().encode(json).length > VERSUS_LIMITS.exportBytes) throw new Error('Export exceeds eight MiB; no file created.');
    return json;
  }
  dispose() { this.#onChange = () => {}; this.#state = 'stopped'; this.#fence(true); }
}
