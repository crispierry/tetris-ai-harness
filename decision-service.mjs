import { randomBytes, randomUUID } from 'node:crypto';
import { digest } from './decision-store.mjs';
import { packetCheck, requestFor, parse } from './choice-protocol.mjs';
import { createGame, cells } from './public/engine.mjs';
import { observe, enumerate, candidateEvidence, freeze } from './public/harness.mjs';
import { instructionPacket } from './public/briefing.mjs';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a,b) => digest(a) === digest(b);
const config = Object.freeze({ model: 'gpt-6-luna', maxCandidates: 255, maxInputBytes: 1048576 });
export function canonicalPacket(packet) {
  packetCheck(packet, config);
  const o = packet.observation, p = o.active;
  if (!p || !['rotation','x','y'].every(k => Number.isInteger(p[k])) || p.rotation < 0 || p.rotation > 3 || Math.abs(p.x) > 20 || p.y < -4 || p.y > 20 || o.score > 10000000 || o.gravityElapsedMs !== 0 || o.revision < 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(o.sessionId)) fail('input');
  const active = { type: p.type, rotation: p.rotation, x: p.x, y: p.y };
  if (!cells(active).every(({x,y}) => x >= 0 && x < 10 && y >= 0 && y < 20 && o.board[y][x] === null)) fail('input');
  // Refill is private synthetic machinery; candidateEvidence exposes only the real known prefix.
  const state = { ...createGame(1), board: o.board, active, queue: [...o.next], nextType: o.next[0], status: 'playing', score: o.score, lines: o.lines, level: o.level, gravityElapsed: 0 };
  const binding = { sessionId: o.sessionId, revision: o.revision };
  const candidates = enumerate(state, binding).map(c => candidateEvidence(state, c, binding));
  const rebuilt = instructionPacket(observe(state, binding), candidates, { requestId: packet.requestId, deadlineMs: packet.deadlineMs });
  if (!same(packet, rebuilt)) fail('input'); return rebuilt;
}
function checkPolicy(p) {
  if (!p || Object.keys(p).some(k => !['maxAttempts','maxInputTokens','maxEstimatedMicros','expiresAt','maxRuns','maxEpochs','maxPlacements','timeoutMs','reservationTokens','reservationMicros'].includes(k)) ||
      Object.values(p).some(v => !Number.isSafeInteger(v) || v < 1) || p.maxEstimatedMicros > 10000000 || p.maxAttempts > 10000 || p.maxRuns > 64 || p.maxEpochs > 100 || p.maxPlacements > 1000 || p.timeoutMs > 60000 || p.reservationTokens < 1049600 || p.reservationMicros > p.maxEstimatedMicros || p.expiresAt <= Date.now()) fail('configuration');
  for (const k of ['maxAttempts','maxInputTokens','maxEstimatedMicros','expiresAt','maxRuns','maxEpochs','maxPlacements','timeoutMs','reservationTokens','reservationMicros']) if (!Number.isSafeInteger(p[k])) fail('configuration');
}
export function createDecisionService({ enabled = false, store, policy, qualification, transport, credential, hosted = false } = {}) {
  let available = false, reason = 'disabled', closing = false;
  if (enabled) {
    policy = freeze(structuredClone(policy)); checkPolicy(policy);
    const fixture = transport?.mode === 'fixture';
    // A fixture never attests live qualification. Live must be explicitly qualified by the owner.
    const q = qualification;
    const qualified = q?.kind === 'owner-qualified-live-v1' && q.model === config.model && q.endpoint === 'https://api.openai.com/v1/decisions' &&
      ['maxInputTokens','maxOutputTokens','framingTokenBound','inputMicrosPerMillion','outputMicrosPerMillion','maxCostMicros'].every(k => Number.isSafeInteger(q[k]) && q[k] > 0) &&
      q.maxInputTokens === policy.reservationTokens && q.framingTokenBound >= 1024 && q.maxInputTokens >= 1048576 + q.framingTokenBound && q.maxOutputTokens >= 4096 &&
      q.maxCostMicros >= Math.ceil((q.maxInputTokens * q.inputMicrosPerMillion + q.maxOutputTokens * q.outputMicrosPerMillion) / 1000000) &&
      q.maxCostMicros <= policy.reservationMicros && q.maxBodyBytes === 1048576 && typeof q.evidence === 'string' && q.evidence.length > 0;
    if (!hosted && store && (fixture || (!store.fixtureOnly && !transport && qualified && typeof credential === 'string' && credential.length > 0))) { available = true; reason = fixture ? 'fixture-only' : 'owner-qualified-live'; }
    else reason = hosted ? 'host_unqualified' : 'qualification_required';
  }
  const mode = reason === 'fixture-only' ? 'http-fixture' : 'live';
  const pending = new Map(), operations = new Set(), upstreamOperations = new Set();
  const status = () => Object.freeze({ available: available && (!store || store.sound) && !closing && Date.now() < policy?.expiresAt, reason: closing ? 'shutdown' : store && !store.sound ? 'store_unavailable' : available && Date.now() >= policy.expiresAt ? 'expired' : reason });
  function ready() { if (!status().available) fail('unavailable'); }
  function authenticate(capability, snapshot, allowTerminal = false) {
    ready(); if (typeof capability !== 'string' || !/^[a-f0-9]{64}$/.test(capability)) fail('unauthorized');
    const run = Object.values(snapshot.runs).find(r => r.capabilityDigest === digest(capability));
    if (!run || run.closed || (!allowTerminal && (run.terminal || run.interrupted)) || run.expiresAt <= Date.now()) fail('unauthorized'); return run;
  }
  async function control(capability, action, epoch) {
    const run = authenticate(capability, store.snapshot(), true);
    // Authenticated read waits for already-admitted writes and never cancels lane work.
    if (action === 'currentEpoch') {
      if (epoch !== undefined) fail('input');
      const current = authenticate(capability, await store.inspect(), true);
      return { epoch:current.epoch, maxEpochs:policy.maxEpochs };
    }
    if (!['advanceEpoch','close'].includes(action)) fail('input');
    if (action === 'advanceEpoch' && (epoch !== run.epoch + 1 || epoch >= policy.maxEpochs)) fail('epoch');
    const old = pending.get(run.laneId); old?.abort.abort();
    const result = await store.transact(s => {
      const r = authenticate(capability, s, true);
      if (action === 'close') r.closed = true;
      else { if (epoch !== r.epoch + 1 || epoch >= policy.maxEpochs) fail('epoch'); r.epoch = epoch; r.expected = null; r.placements = 0; r.terminal = false; r.interrupted = false; }
      return { epoch: r.epoch, closed: r.closed };
    });
    if (pending.get(run.laneId) === old) pending.delete(run.laneId);
    return result;
  }
  async function decide(capability, packet, { signal } = {}) {
    const run = authenticate(capability, store.snapshot());
    if (pending.has(run.laneId)) fail('overlap');
    const job = { abort: new AbortController(), epoch: run.epoch }; pending.set(run.laneId, job);
    let timer, listener, key, reserved = false, sent = false, completed = false;
    const deadline = Date.now() + Math.min(policy.timeoutMs, packet?.deadlineMs ?? policy.timeoutMs, run.expiresAt - Date.now());
    const work = (async () => {
      try {
        if (signal?.aborted) fail('cancelled');
        listener = () => job.abort.abort(); signal?.addEventListener('abort', listener, { once: true });
        timer = setTimeout(() => job.abort.abort(), Math.min(policy.timeoutMs, packet?.deadlineMs ?? policy.timeoutMs, run.expiresAt - Date.now()));
        const p = canonicalPacket(packet), session = `${run.controllerSessionBase}-${run.epoch}`;
        if (p.observation.sessionId !== session) fail('epoch');
        const current = () => { if (job.abort.signal.aborted || Date.now() >= deadline || Date.now() >= policy.expiresAt || closing || store.snapshot().runs[run.id]?.epoch !== job.epoch || (store.snapshot().runs[run.id]?.closed || (!completed && store.snapshot().runs[run.id]?.terminal))) fail('cancelled'); };
        current();
        key = `${run.id}:${run.epoch}:${p.requestId}`;
        const request = requestFor('decisions', p, config);
        if (Buffer.byteLength(JSON.stringify(request.body)) > 1048576) fail('input');
        const upstream = p.candidates.length > 1;
        await store.transact(s => {
          const r = authenticate(capability, s); current();
          if (s.requests[key]) fail(s.requests[key].digest === digest(p) ? 'duplicate' : 'collision');
          if (r.epoch !== job.epoch || r.placements >= policy.maxPlacements) fail('limit');
          if (!r.expected) { if (p.stateRevision !== 1) fail('revision'); }
          else {
            const expected = r.expected, observed = p.observation;
            if (p.stateRevision !== expected.revision || !same(observed.board, expected.board) || !same(observed.active, expected.active) || observed.score !== expected.score || observed.lines !== expected.lines || observed.level !== expected.level || !same(observed.next.slice(0,4), expected.next)) fail('continuity');
          }
          if (upstream && (s.used.attempts + 1 > policy.maxAttempts || s.used.inputTokens + policy.reservationTokens > policy.maxInputTokens || s.used.estimatedMicros + policy.reservationMicros > policy.maxEstimatedMicros)) fail('budget');
          if (Object.keys(s.requests).length >= Math.min(10000, policy.maxRuns * policy.maxEpochs * policy.maxPlacements)) fail('limit');
          if (upstream) { s.used.attempts++; s.used.inputTokens += policy.reservationTokens; s.used.estimatedMicros += policy.reservationMicros; }
          s.requests[key] = { digest: digest(p), status: 'reserved', upstream, deadline: Date.now() + Math.min(p.deadlineMs, policy.timeoutMs), runId: run.id, epoch: run.epoch };
        });
        reserved = true; current(); let decoded, responseUsage = null;
        if (!upstream) decoded = { choice: { requestId: p.requestId, stateRevision: p.stateRevision, selectedCandidateId: p.candidates[0].id } };
        else {
          await store.transact(s => { current(); s.requests[key].status = 'dispatch-intent'; }); current(); sent = true;
          const cancel = new Promise((_, reject) => { if (job.abort.signal.aborted) reject(Object.assign(new Error('cancelled'), {code:'cancelled'})); else job.abort.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {code:'cancelled'})), {once:true}); });
          const fetchResult = async () => {
            if (transport) return transport(request, { signal: job.abort.signal });
            const response = await fetch('https://api.openai.com/v1/decisions', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request.body), signal: job.abort.signal });
            let bytes = 0, chunks = []; for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 65536) { job.abort.abort(); fail('size'); } chunks.push(chunk); }
            let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('schema'); } return { status: response.status, body };
          };
          const dispatched = Promise.resolve().then(fetchResult); upstreamOperations.add(dispatched);
          dispatched.then(() => upstreamOperations.delete(dispatched), () => upstreamOperations.delete(dispatched));
          let result; try { result = await Promise.race([dispatched, cancel]); } catch (e) { if (e.code === 'cancelled') throw e; fail('transport_ambiguous'); }
          current(); decoded = parse('decisions', result, p);
          const rawUsage = result.body?.usage, usage = {};
          for (const key of ['input_tokens','output_tokens','total_tokens']) if (Number.isSafeInteger(rawUsage?.[key]) && rawUsage[key] >= 0) usage[key] = rawUsage[key];
          for (const key of ['cached_input_tokens','cache_read_input_tokens','cache_write_input_tokens']) if (Number.isSafeInteger(rawUsage?.[key]) && rawUsage[key] >= 0 && rawUsage[key] <= usage.input_tokens) usage[key] = rawUsage[key];
          responseUsage = Object.keys(usage).length ? usage : null;
        }
        current(); const selected = p.candidates.find(c => c.id === decoded.choice.selectedCandidateId);
        await store.transact(s => { current(); const r = s.runs[run.id]; r.expected = selected.afterstate; r.placements++; r.terminal = selected.afterstate.status !== 'playing'; s.requests[key].status = 'completed'; });
        completed = true; current();
        return freeze({ choice: decoded.choice, receipt: { mode, runId:run.id, laneId:run.laneId, epoch:run.epoch, lineage:store.snapshot().lineage, policyDigest:store.snapshot().policyDigest, usage:responseUsage, estimatedReservationMicros:upstream ? policy.reservationMicros : 0, reservedInputTokens:upstream ? policy.reservationTokens : 0, requestId: p.requestId, stateRevision: p.stateRevision, selectedCandidateId: decoded.choice.selectedCandidateId, attempts: upstream ? 1 : 0, actualCostUSD: null, usageProvenance: transport ? 'fixture response; no API usage' : 'provider response; billing unverified' } });
      } catch (error) {
        if (reserved && key && !completed && store.snapshot().requests[key]) await store.transact(s => { s.requests[key].status = sent ? 'uncertain' : 'rejected'; if (sent && s.runs[run.id].epoch === job.epoch) s.runs[run.id].interrupted = true; }).catch(() => { available = false; reason = 'store_unavailable'; });
        if (error.code === 'store_unavailable') { available = false; reason = 'store_unavailable'; }
        throw Object.assign(new Error(error.code ?? 'input'), { code: error.code ?? 'input' });
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', listener); job.abort.abort(); if (pending.get(run.laneId) === job) pending.delete(run.laneId); }
    })();
    operations.add(work); try { return await work; } finally { operations.delete(work); }
  }
  return Object.freeze({ status, decide, control,
    owner: Object.freeze({ async issueRun({ laneId, controllerSessionBase } = {}) {
      ready(); if (!/^[A-Za-z0-9_-]{1,60}$/.test(laneId ?? '') || !/^[A-Za-z0-9_-]{1,60}$/.test(controllerSessionBase ?? '')) fail('configuration');
      const capability = randomBytes(32).toString('hex'), id = randomUUID();
      await store.transact(s => {
        if (!same(s.policy, policy) || Object.keys(s.runs).length >= policy.maxRuns || Object.values(s.runs).some(r => r.laneId === laneId && !r.closed) || s.used.attempts >= policy.maxAttempts || Date.now() >= policy.expiresAt) fail('limit');
        s.runs[id] = { id, laneId, controllerSessionBase, capabilityDigest: digest(capability), expiresAt: policy.expiresAt, epoch: 0, placements: 0, expected: null, closed: false, terminal: false, interrupted: false };
      }); return freeze({ capability, runId: id, epoch: 0, expiresAt: policy.expiresAt, controllerSessionBase });
    } }),
    async close() {
      closing = true; for (const job of pending.values()) job.abort.abort(); await Promise.allSettled([...operations]);
      if (upstreamOperations.size) {
        let timer; try { await Promise.race([Promise.allSettled([...upstreamOperations]), new Promise((_,reject) => { timer = setTimeout(() => reject(Object.assign(new Error('drain_pending'), {code:'drain_pending'})), 1000); })]); } finally { clearTimeout(timer); }
      }
      // An abort-ignoring transport holds the ledger lock until it positively settles.
      await store?.close();
    },
  });
}
