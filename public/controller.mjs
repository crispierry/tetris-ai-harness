import { createGame, start, DEFAULT_SEED, isTerminal } from './engine.mjs';
import { observe, enumerate, execute, candidateEvidence, freeze } from './harness.mjs';
import { instructionPacket, validateChoice } from './briefing.mjs';
export const HEURISTIC_WEIGHTS = Object.freeze({ holes: -5, aggregateHeight: -0.5, maxHeight: -0.2, bumpiness: -0.2, lines: 8 });
export function heuristic(weights = HEURISTIC_WEIGHTS, name = 'Local heuristic') {
  const w = { ...HEURISTIC_WEIGHTS, ...weights };
  if (Object.values(w).some(v => !Number.isFinite(v))) throw new TypeError('Finite heuristic weights required');
  const policy = freeze({ weights: Object.fromEntries(Object.keys(HEURISTIC_WEIGHTS).map(key => [key, w[key]])), terminalPenalty: -1e9, completionReward: 1e9, terminalOrder: 'completion, survival, blocked spawn; then score', tieBreak: 'first offered candidate with maximum score' });
  const runMetadata = freeze({ mode: 'local', policyVersion: 'heuristic-score-2', policy, liveEnabled: false });
  return Object.freeze({ name, kind: 'local', version: 'heuristic-2', runMetadata,
    capabilities: Object.freeze({ movementMode: 'reachable-paused-gravity-v1', assistance: 'canonical-afterstates-v1', maxCandidates: 800 }),
    async decide(packet) {
      let selected = null, best = -Infinity, bestRank = -Infinity;
      for (const c of packet.candidates) {
        const f = c.features, score = c.afterstate?.status === 'won' ? 1e9 : c.terminalReason ? -1e9 :
          w.holes * f.holes + w.aggregateHeight * f.aggregateHeight + w.maxHeight * f.maxHeight + w.bumpiness * f.bumpiness + w.lines * c.linesDelta;
        const rank = c.afterstate?.status === 'won' ? 1 : c.terminalReason ? -1 : 0;
        if (rank > bestRank || (rank === bestRank && score > best)) { selected = c; best = score; bestRank = rank; }
      }
      if (!selected) throw new Error('No legal candidate');
      return { requestId: packet.requestId, stateRevision: packet.stateRevision, selectedCandidateId: selected.id };
    } });
}
export function mockProvider({ mode = 'delay', delayMs = 350 } = {}) {
  if (!['delay', 'error', 'stale', 'invalid', 'never'].includes(mode) || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new TypeError('Invalid mock settings');
  const local = heuristic();
  return Object.freeze({ ...local, name: mode === 'delay' ? 'Delayed mock' : `${mode[0].toUpperCase() + mode.slice(1)} mock`, kind: 'mock', version: 'mock-2',
    runMetadata: freeze({ ...local.runMetadata, mode: 'offline-mock', mockMode: mode, delayMs }),
    async decide(packet, { signal } = {}) {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Cancelled'));
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Cancelled')); };
        const timer = mode === 'never' ? null : setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delayMs);
        signal?.addEventListener('abort', abort, { once: true });
      });
      if (mode === 'error') throw new Error('Deliberate offline mock error. Reset or choose another local player.');
      const response = await local.decide(packet);
      if (mode === 'stale') return { ...response, requestId: 'old-request' };
      if (mode === 'invalid') return { ...response, selectedCandidateId: 'not-a-candidate' };
      return response;
    } });
}
let sessionCounter = 0;
/** No timers/gravity mutate the game while waiting. Only a revalidated current response commits a piece. */
export class Controller {
  #recovery=false; #state; #seed; #revision = 0; #epoch = 0; #serial = 0; #pending = null; #provider; #status = 'ready'; #pieces = 0; #error = null; #last = null; #id; #deadline; #onChange;
  constructor({ seed = DEFAULT_SEED, sessionId = `local-${++sessionCounter}`, provider = heuristic(), deadlineMs = 1500, gameEpoch = 0, onChange = () => {} } = {}) {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(sessionId) || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000) throw new TypeError('Invalid controller configuration');
    if (!Number.isInteger(gameEpoch) || gameEpoch < 0 || gameEpoch >= 100) throw new TypeError('Invalid game epoch');
    this.#epoch=gameEpoch; this.#seed = seed; this.#state = createGame(seed); this.#id = sessionId; this.#deadline = deadlineMs; this.#onChange = onChange; this.setProvider(provider);
  }
  get #binding() { return { sessionId: `${this.#id}-${this.#epoch}`, revision: this.#revision }; }
  get view() { return freeze({ observation: observe(this.#state, this.#binding), status: this.#status, pieces: this.#pieces,
    error: this.#error, recoveryRequired:this.#recovery, lastDecision: this.#last, player: { name: this.#provider.name, kind: this.#provider.kind, version: this.#provider.version }, busy: !!this.#pending }); }
  #emit() { this.#onChange(this.view); }
  setProvider(provider) {
    if (this.#pending || this.#status === 'running') throw new Error('Pause before changing player');
    if (!provider || typeof provider.decide !== 'function' || typeof provider.name !== 'string' || !provider.name || !Number.isInteger(provider.capabilities?.maxCandidates) || provider.capabilities.maxCandidates < 1 || provider.capabilities.maxCandidates > 800 || provider.capabilities?.movementMode !== 'reachable-paused-gravity-v1' || provider.capabilities?.assistance !== 'canonical-afterstates-v1') throw new Error('Unsupported provider capability');
    this.#provider = provider;
  }
  #cancel(status) { const pending = this.#pending; this.#pending = null; pending?.abort.abort();if(pending && this.#provider.kind==='remote'){this.#recovery=true;this.#error='Cancelled — Reset required. Allowance is not refilled.';this.#last=null;} this.#status = isTerminal(this.#state.status) ? this.#state.status : this.#recovery?'error':status; this.#emit(); }
  pause() { this.#cancel('paused'); }
  stop() { this.#cancel('stopped'); }
  reset() { this.#cancel('stopped'); this.#epoch++; this.#recovery=false; this.#revision = 0; this.#state = createGame(this.#seed); this.#pieces = 0; this.#last = null; this.#error = null; this.#status = 'ready'; this.#emit(); }
  start() {if(this.#recovery)return; if (this.#pending) throw new Error('Decision already in progress'); if (isTerminal(this.#state.status)) return; this.#error = null; this.#status = 'running'; this.#emit(); }
  async step({ continueRunning = false } = {}) {
    if(this.#recovery){this.#emit();return null;}
    if (this.#pending) throw new Error('Decision already in progress');
    if (isTerminal(this.#state.status)) return null;
    if (this.#state.status === 'ready') { this.#state = start(this.#state); this.#revision++; }
    const binding = this.#binding, current = this.#state, abort = new AbortController();
    const job = { abort, requestId: `${binding.sessionId}:${binding.revision}:${++this.#serial}` };
    this.#last=null;this.#pending = job; this.#status = 'choosing'; this.#error = null; this.#emit();
    let timer, abortListener;
    try {
      const candidates = enumerate(current, binding);
      if (!candidates.length) throw new Error('No reachable placements');
      if (candidates.length > this.#provider.capabilities.maxCandidates) throw new Error('Provider candidate limit exceeded; no placements were discarded');
      const packet = instructionPacket(observe(current, binding), candidates.map(c => candidateEvidence(current, c, binding)), { requestId: job.requestId, deadlineMs: this.#deadline });
      if (new TextEncoder().encode(JSON.stringify(packet)).length > 1048576) throw new Error('Decision packet exceeds one MiB limit');
      const started = performance.now();
      const guard = new Promise((_, reject) => {
        abortListener = () => reject(new Error('Cancelled'));
        abort.signal.addEventListener('abort', abortListener, { once: true });
        timer = setTimeout(() => reject(new Error('Decision deadline exceeded')), this.#deadline);
      });
      const response = await Promise.race([Promise.resolve().then(() => this.#provider.decide(packet, { signal: abort.signal })), guard]);
      if (this.#pending !== job || abort.signal.aborted || this.#revision !== binding.revision) return null;
      if (performance.now() - started >= this.#deadline) throw new Error('Decision deadline exceeded');
      if (new TextEncoder().encode(JSON.stringify(response)).length > 4096) throw new Error('Decision response exceeds size limit');
      const id = validateChoice(packet, response), candidate = candidates.find(c => c.id === id);
      const next = execute(current, candidate, binding), evidence = packet.candidates.find(c => c.id === id);
      this.#state = next; this.#revision++; this.#pieces++;
      this.#last = freeze({ candidate: evidence, latencyMs: performance.now() - started, requestId: job.requestId, player: this.#provider.name, receipt: this.#provider.lastReceipt ?? null });
      this.#status = isTerminal(next.status) ? next.status : continueRunning ? 'running' : 'paused';
      return this.#last;
    } catch (error) {
      if (this.#pending !== job) return null;
      this.#status = 'error';this.#recovery=this.#provider.kind==='remote' && this.#provider.requiresReset===true; this.#error = error.message+(this.#recovery?' — Reset required. Allowance is not refilled.':''); return null;
    } finally {
      clearTimeout(timer); if (abortListener) abort.signal.removeEventListener('abort', abortListener);
      abort.abort(); if (this.#pending === job) this.#pending = null; this.#emit();
    }
  }
}
