import { createHash } from 'node:crypto';
import { Controller, heuristic } from './public/controller.mjs';
import { RULES } from './public/engine.mjs';
import { VERSIONS, freeze } from './public/harness.mjs';
import { BRIEF_VERSION } from './public/briefing.mjs';
import { ProviderError } from '../../providers.mjs';
export const BENCHMARK_VERSION = 'offline-benchmark-1';
const plain = value => value !== null && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value));
export function stableJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if(Object.getOwnPropertySymbols(value).length || Object.keys(value).length!==value.length || !Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).every(Boolean))throw new TypeError('Sparse or non-JSON array');
    return `[${value.map(stableJSON).join(',')}]`;
  }
  if (plain(value) && !Object.getOwnPropertySymbols(value).length) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  throw new TypeError('Noncanonical artifact value');
}
export const digest = value => createHash('sha256').update(stableJSON(value)).digest('hex');
const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
const bounded = (x, max) => Number.isInteger(x) && x >= 1 && x <= max;
const errorCodes = new Set(['configuration','unavailable','live_disabled','input','authentication','rate_limit','transport_ambiguous','provider_error','refusal','incomplete','schema','size','timeout','cancelled','budget','model_mismatch']);
function publicMetadata(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert(!['seed','seeds','rng','queue','apiKey','authorization','password','token','secret'].includes(key), 'Private field in provider metadata');
    publicMetadata(item);
  }
}
function identity(provider) {
  assert(provider && ['local','mock'].includes(provider.kind) && typeof provider.name === 'string' && provider.name.length <= 120 &&
    typeof provider.version === 'string' && provider.version.length <= 120 && typeof provider.decide === 'function' &&
    provider.capabilities?.movementMode === 'reachable-paused-gravity-v1' && provider.capabilities?.assistance === 'canonical-afterstates-v1' &&
    bounded(provider.capabilities.maxCandidates,800), 'Incompatible or live provider');
  const meta = { name: provider.name, kind: provider.kind, version: provider.version, capabilities: provider.capabilities, configuration: provider.runMetadata ?? null };
  publicMetadata(meta); assert(Buffer.byteLength(stableJSON(meta)) <= 16384, 'Provider manifest too large');
  return freeze(JSON.parse(stableJSON(meta)));
}
function preflight(options, players, seeds) {
  assert(plain(options) && Object.keys(options).every(k => ['runId','sourceRevision','maxPieces','deadlineMs','runWallMs','fallback','objective','hold','clock','live','budgetUSD'].includes(k)), 'Unknown benchmark configuration');
  if (options.live) { assert(Number.isFinite(options.budgetUSD) && options.budgetUSD > 0, 'Live budget is absent'); throw new Error('Live execution is not implemented or authorized'); }
  assert(options.budgetUSD === undefined || options.budgetUSD === 0, 'Offline budget must be zero');
  assert(options.hold === undefined || options.hold === false, 'Hold is unsupported');
  assert(options.objective === undefined || options.objective === RULES.objective, 'Unsupported objective');
  assert(options.clock === undefined || options.clock === 'step-frozen-game-time', 'Unsupported clock tier');
  assert(typeof options.runId === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(options.runId), 'Bounded run identity required');
  assert(typeof options.sourceRevision === 'string' && /^[a-f0-9]{40}$/.test(options.sourceRevision), 'Pinned source revision required');
  assert(Array.isArray(seeds) && bounded(seeds.length,8) && seeds.every(s => Number.isInteger(s) && s > 0 && s <= 0xffffffff) && new Set(seeds).size===seeds.length, 'Unique private nonzero uint32 seed set required');
  assert(Array.isArray(players) && players.length === 2 && players.every(p => typeof p?.create === 'function'), 'Two provider factories required');
  const config = { maxPieces: options.maxPieces ?? 100, deadlineMs: options.deadlineMs ?? 1500, runWallMs: options.runWallMs ?? 30000, fallback: options.fallback ?? 'none' };
  assert(bounded(config.maxPieces,3000) && config.maxPieces * seeds.length * 2 <= 8000 && bounded(config.deadlineMs,60000) && bounded(config.runWallMs,60000), 'Benchmark resource cap exceeded');
  assert(['none','local-heuristic-explicit'].includes(config.fallback), 'Unsupported fallback policy');
  const instances = seeds.map(() => players.map(p => p.create()));
  const seen = new Set(), identities = instances[0].map(identity);
  for (const pair of instances) pair.forEach((provider,lane) => {
    assert(!seen.has(provider),'Each player/seed needs a fresh provider instance'); seen.add(provider);
    assert(stableJSON(identity(provider)) === stableJSON(identities[lane]),'Provider configuration changed across seed set');
  });
  const manifest = freeze({ version: BENCHMARK_VERSION, codeVersion: BENCHMARK_VERSION, sourceRevision: options.sourceRevision,
    rulesVersion: RULES.version, schemas: VERSIONS, promptVersion: BRIEF_VERSION, runId: options.runId,
    objective: RULES.objective, target: null, hold: false, previewCount: 5, initialBoard: 'empty-10x20', randomizer: 'seven-bag-xorshift32-fisher-yates',
    clock: 'step-frozen-game-time', actions: ['left','right','clockwise','down','drop'], assistance: 'canonical-afterstates-v1',
    seedSetReference: `${options.runId}-private-seeds`, seedCount: seeds.length, players: identities, ...config,
    retryLimit: 0, live: false, budgetUSD: 0, fallbackProvider: identity(heuristic()), maxPlannedPlacements:8000, maxEvents:16032, maxArtifactBytes:33554432,
    limits: 'Endless game; cap is censoring, never victory. Offline fixtures do not establish live model quality or pricing.' });
  validateManifest(manifest);
  return { manifest, instances };
}
function validateManifest(m) {
  assert(plain(m) && m.version===BENCHMARK_VERSION && m.codeVersion===BENCHMARK_VERSION && m.rulesVersion===RULES.version &&
    stableJSON(m.schemas)===stableJSON(VERSIONS) && m.promptVersion===BRIEF_VERSION && /^[a-f0-9]{40}$/.test(m.sourceRevision??'') &&
    typeof m.runId==='string'&&/^[A-Za-z0-9_-]{1,24}$/.test(m.runId) && m.objective===RULES.objective && m.target===null &&
    m.hold===false && m.previewCount===5 && m.initialBoard==='empty-10x20' && m.randomizer==='seven-bag-xorshift32-fisher-yates' &&
    m.clock==='step-frozen-game-time' && m.assistance==='canonical-afterstates-v1' && stableJSON(m.actions)===stableJSON(['left','right','clockwise','down','drop']) &&
    m.live===false && m.budgetUSD===0 && m.retryLimit===0 && ['none','local-heuristic-explicit'].includes(m.fallback) &&
    bounded(m.seedCount,8)&&m.seedSetReference===`${m.runId}-private-seeds` && bounded(m.maxPieces,3000)&&m.maxPieces*m.seedCount*2<=8000 &&
    bounded(m.deadlineMs,60000)&&bounded(m.runWallMs,60000)&&m.maxPlannedPlacements===8000&&m.maxEvents===16032&&m.maxArtifactBytes===33554432 &&
    Array.isArray(m.players)&&m.players.length===2,'Incompatible benchmark manifest');
  for(const p of m.players) {
    assert(plain(p)&&['local','mock'].includes(p.kind)&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=120&&typeof p.version==='string'&&p.version.length>0&&p.version.length<=120&&
      p.capabilities?.movementMode==='reachable-paused-gravity-v1'&&p.capabilities.assistance==='canonical-afterstates-v1'&&bounded(p.capabilities.maxCandidates,800),'Incompatible manifest provider');
    publicMetadata(p);assert(Buffer.byteLength(stableJSON(p))<=16384,'Provider manifest too large');
  }
  if (m.fallbackProvider !== undefined) assert(stableJSON(m.fallbackProvider) === stableJSON(identity(heuristic())), 'Incompatible fallback policy');
}
function validateRecord(record,manifest) {
  validateManifest(manifest);
  assert(record?.version===BENCHMARK_VERSION&&Number.isInteger(record.seedIndex)&&record.seedIndex>=0&&record.seedIndex<manifest.seedCount&&[0,1].includes(record.lane)&&
    record.sessionId===`${manifest.runId}-${record.seedIndex}-${record.lane}`&&record.seedReference===`${manifest.seedSetReference}/${record.seedIndex}`&&
    Array.isArray(record.events)&&record.events.length<=manifest.maxEvents,'Invalid run identity or event bound');
  const expectedSession=`${record.sessionId}-0`;
  const observation=o=>{
    assert(plain(o)&&o.sessionId===expectedSession&&o.schemaVersion===VERSIONS.observation&&o.rulesVersion===RULES.version&&
      ['ready','playing','over'].includes(o.status)&&['score','lines','level','revision'].every(k=>Number.isSafeInteger(o[k])&&o[k]>=0)&&o.level===Math.floor(o.lines/RULES.linesPerLevel)+1&&
      o.width===10&&o.visibleHeight===20&&o.hiddenRows===0&&o.previewCount===5&&Array.isArray(o.next)&&o.next.length===5&&o.next.every(x=>RULES.types.includes(x))&&
      Array.isArray(o.board)&&o.board.length===20&&o.board.every(row=>Array.isArray(row)&&row.length===10&&row.every(x=>x===null||RULES.types.includes(x))),'Invalid observation identity/counters');
  };
  observation(record.initialObservation);observation(record.finalObservation);
  assert(record.initialObservation.status==='ready'&&record.initialObservation.active===null&&record.initialObservation.revision===0&&record.initialObservation.score===0&&record.initialObservation.lines===0&&
    record.initialObservation.board.every(row=>row.every(x=>x===null)),'Initial board is not canonical empty start');
  return observation;
}
const usageOf = (provider, requestId) => {
  if(!requestId || provider.lastReceipt?.requestId!==requestId)return null;
  const out = {}; const usage = provider.lastReceipt?.usage;
  for (const k of ['input_tokens','output_tokens','total_tokens']) if (Number.isSafeInteger(usage?.[k]) && usage[k] >= 0) out[k] = usage[k];
  return Object.keys(out).length ? out : null;
};
const receiptOf = (provider, requestId) => {
  const r=provider.lastReceipt; if(!requestId || r?.requestId!==requestId)return null;
  return {reportedModel:typeof r.reportedModel==='string' && /^(?:gpt-6-(?:astra|luna)(?:-\d{4}-\d{2}-\d{2})?|jev-(?:latest|\d+\.\d+\.\d+))$/.test(r.reportedModel)?r.reportedModel:null,
    reportedServiceTier:['default','flex','priority','scale'].includes(r.reportedServiceTier)?r.reportedServiceTier:null,
    responseSha256:typeof r.responseSha256==='string'&&/^[a-f0-9]{64}$/.test(r.responseSha256)?r.responseSha256:null,
    rawResponseArtifactRef:/^fixture:[A-Za-z0-9_./#-]{1,200}$/.test(r.rawResponseArtifactRef??'')?r.rawResponseArtifactRef:null,
    provenance:'fixture-reported metadata; not live identity/usage/billing qualification'};
};
const failureOf = (provider, view, requestId) => requestId && provider.lastReceipt?.requestId===requestId && errorCodes.has(provider.lastReceipt?.errorCode) ? provider.lastReceipt.errorCode :
  view.error === 'Decision deadline exceeded' ? 'timeout' : view.error === 'Cancelled' ? 'cancelled' : view.error === 'Invalid, stale or unknown decision' ? 'schema' : 'provider_error';
async function runSingle(manifest, seed, seedIndex, lane, primary, signal) {
  const sessionId = `${manifest.runId}-${seedIndex}-${lane}`;
  let selected = primary, role = 'primary', input = null, wallExpired = false, boundaryErrorCode = null;
  const fallback = heuristic();
  const wrap = provider => ({ name: provider.name, kind: provider.kind, version: provider.version, capabilities: provider.capabilities,
    async decide(packet, context) {
      input = packet;
      const decisionStarted=performance.now();
      const expired = () => performance.now()-started >= manifest.runWallMs;
      if(expired()) { wallExpired=true; controller.stop(); throw new ProviderError('timeout'); }
      let result;
      try { result=await provider.decide(packet,context); }
      catch(error) { if(error instanceof ProviderError && errorCodes.has(error.code))boundaryErrorCode=error.code; throw error; }
      // Timers cannot preempt synchronous provider code; discard results that return past the wall bound.
      if(expired()) { wallExpired=true; controller.stop(); throw new ProviderError('timeout'); }
      if(performance.now()-decisionStarted>=packet.deadlineMs) { boundaryErrorCode='timeout'; throw new ProviderError('timeout'); }
      return result;
    } });
  const controller = new Controller({ seed, sessionId, provider: wrap(primary), deadlineMs: manifest.deadlineMs });
  const started = performance.now(), events = [], initialObservation = controller.view.observation;
  const cancel = () => controller.stop(); signal?.addEventListener('abort',cancel);
  const timer = setTimeout(() => { wallExpired = true; controller.stop(); },manifest.runWallMs);
  let outcome, lastFailureCode = null;
  try {
    while (!outcome) {
      if (signal?.aborted) { outcome = 'cancelled'; break; }
      if (wallExpired || performance.now()-started >= manifest.runWallMs) { outcome = 'run-deadline'; break; }
      if (events.length >= manifest.maxEvents) { outcome = 'event-cap'; break; }
      const before = controller.view; input = null; boundaryErrorCode=null; const stepStarted = performance.now();
      const decision = await controller.step(); const after = controller.view;
      const errorCode = decision ? null : signal?.aborted ? 'cancelled' : wallExpired ? 'timeout' : boundaryErrorCode ?? failureOf(selected,after,input?.requestId);
      if(errorCode)lastFailureCode=errorCode;
      const event = freeze({ index: events.length, role, provider: role === 'primary' ? manifest.players[lane] : identity(fallback),
        observationBefore: before.observation, observationAfter: after.observation,
        observationBeforeHash: digest(before.observation), observationAfterHash: digest(after.observation),
        packetHash: input ? digest(input) : null, candidateDigest: input ? digest(input.candidates) : null,
        requestId: input?.requestId ?? null, selectedCandidateId: decision?.candidate.id ?? null,
        piecesBefore: before.pieces, piecesAfter: after.pieces, committed: !!decision, errorCode,
        consumedPiece: decision ? input.observation.active.type : null, latencyMs: performance.now()-stepStarted,
        providerReceipt:receiptOf(selected,input?.requestId), usage: usageOf(selected,input?.requestId), usageProvenance: selected.kind === 'mock' ? 'fixture-reported; not actual API usage' : 'local; no provider usage', actualCostUSD: null });
      events.push(event);
      if (after.status === 'over') outcome = 'game-loss';
      else if (after.pieces >= manifest.maxPieces) outcome = 'piece-cap';
      else if (signal?.aborted) outcome = 'cancelled';
      else if (wallExpired || performance.now()-started >= manifest.runWallMs) outcome = 'run-deadline';
      else if(errorCode==='cancelled')outcome='cancelled';
      else if(errorCode==='timeout')outcome='decision-timeout';
      else if(errorCode==='budget')outcome='budget-stop';
      else if (!decision) {
        if (manifest.fallback === 'local-heuristic-explicit' && role === 'primary' && !['cancelled','timeout','budget'].includes(errorCode)) {
          selected = fallback; role = 'fallback'; controller.setProvider(wrap(fallback));
        } else outcome = 'provider-error';
      } else if (role === 'fallback') { selected = primary; role = 'primary'; controller.setProvider(wrap(primary)); }
    }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); controller.stop(); }
  const record = { version: BENCHMARK_VERSION, seedIndex, seedReference: `${manifest.seedSetReference}/${seedIndex}`, lane, sessionId,
    initialObservation, events, finalObservation: controller.view.observation, outcome, lastFailureCode,
    control:{signalAborted:signal?.aborted===true,wallTimerExpired:wallExpired,wallDeadlineReached:wallExpired||performance.now()-started>=manifest.runWallMs},
    elapsedMs: performance.now()-started, timingProvenance:'measured local wall time; replay does not reproduce latency', metrics: null };
  record.metrics = recomputeRun(record,manifest);
  return freeze(record);
}
const quantile = (values,q) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(q*values.length)-1] : null;
export function recomputeRun(record,manifest) {
  const validateObservation=validateRecord(record,manifest);
  assert(record?.version === BENCHMARK_VERSION && manifest?.version===BENCHMARK_VERSION && Array.isArray(record.events) &&
    ['game-loss','piece-cap','event-cap','cancelled','run-deadline','decision-timeout','budget-stop','provider-error'].includes(record.outcome), 'Unsupported run artifact');
  assert([0,1].includes(record.lane) && manifest.players?.length===2 && ['none','local-heuristic-explicit'].includes(manifest.fallback),'Invalid run policy');
  let observation = record.initialObservation, pieces = 0, failures = 0, assisted = 0; const sequence = [], latencies = [], usage = {}, errorCounts={};
  // Earlier saved manifests did not declare fallback policy metadata. Preserve
  // their exact historical default identity without weakening new manifests.
  let expectedRole='primary';const fallbackIdentity=manifest.fallbackProvider ?? {...identity(heuristic()), configuration:null};
  record.events.forEach((event,index) => {
    validateObservation(event.observationBefore);validateObservation(event.observationAfter);
    assert(observation.status!=='over'&&observation.terminalReason===null&&pieces<manifest.maxPieces&&index<manifest.maxEvents,'Event follows terminal game or exhausted cap');
    assert(event.role===expectedRole && stableJSON(event.provider)===stableJSON(event.role==='primary'?manifest.players[record.lane]:fallbackIdentity),'Fallback role/provider attribution mismatch');
    assert(event.index === index && event.observationBeforeHash === digest(event.observationBefore) && event.observationAfterHash === digest(event.observationAfter) &&
      digest(observation) === event.observationBeforeHash, 'Broken observation chain');
    assert(event.piecesBefore === pieces && event.piecesAfter === pieces + (event.committed ? 1 : 0), 'Inconsistent placement counter');
    assert(typeof event.committed === 'boolean' && Number.isFinite(event.latencyMs) && event.latencyMs >= 0 && ['primary','fallback'].includes(event.role), 'Invalid event metric');
    if (event.committed) { assert(typeof event.selectedCandidateId === 'string' && RULES.types.includes(event.consumedPiece) && !event.errorCode,'Invalid committed event'); pieces++; sequence.push(event.consumedPiece); if(event.role==='fallback') assisted++; }
    else { assert(!event.selectedCandidateId && errorCodes.has(event.errorCode),'Invalid failed event'); failures++;errorCounts[event.errorCode]=(errorCounts[event.errorCode]??0)+1; }
    assert(event.observationAfter.revision===observation.revision+(observation.status==='ready'?1:0)+(event.committed?1:0),'Invalid observation revision transition');
    if(event.committed) {
      const lines=event.observationAfter.lines-observation.lines;
      assert(event.consumedPiece===(observation.active?.type??observation.next[0])&&Number.isInteger(lines)&&lines>=0&&lines<=4&&event.observationAfter.score-observation.score===RULES.clearPoints[lines]*observation.level,'Inconsistent consumed piece or canonical score delta');
    } else assert(event.consumedPiece===null&&digest(event.observationAfter.board)===digest(observation.board)&&['score','lines','level'].every(k=>event.observationAfter[k]===observation[k]),'Failed attempt changed game/consumption');
    if(event.observationAfter.status==='over'||pieces>=manifest.maxPieces||index+1>=manifest.maxEvents)assert(index===record.events.length-1,'Event after terminal transition');
    expectedRole=event.committed?'primary':event.role==='primary'&&manifest.fallback==='local-heuristic-explicit'&&!['cancelled','timeout','budget'].includes(event.errorCode)?'fallback':'terminal';
    if(expectedRole==='terminal')assert(index===record.events.length-1,'Decision after terminal provider stop');
    assert(event.observationAfter.lines >= observation.lines && event.observationAfter.score >= observation.score,'Nonmonotonic game metric');
    for (const [key,value] of Object.entries(event.usage??{})) { assert(['input_tokens','output_tokens','total_tokens'].includes(key) && Number.isSafeInteger(value) && value>=0&&Number.isSafeInteger((usage[key]??0)+value),'Invalid fixture usage'); usage[key]=(usage[key]??0)+value; }
    observation=event.observationAfter; latencies.push(event.latencyMs);
  });
  assert(digest(observation)===digest(record.finalObservation),'Final observation mismatch');
  assert(record.lastFailureCode===(record.events.filter(e=>!e.committed).at(-1)?.errorCode??null),'Last failure code mismatch');
  assert(Number.isFinite(record.elapsedMs) && record.elapsedMs>=0,'Invalid elapsed time');
  const last=record.events.at(-1),over=record.finalObservation.status==='over';
  if(over)assert(record.outcome==='game-loss'&&record.finalObservation.terminalReason==='blocked spawn','Top-out terminal precedence mismatch');
  else if(pieces>=manifest.maxPieces)assert(record.outcome==='piece-cap','Cap terminal precedence mismatch');
  else if(record.outcome==='event-cap')assert(record.events.length>=manifest.maxEvents,'Event cap not exhausted');
  else if(record.outcome==='cancelled')assert(record.control?.signalAborted===true||last?.errorCode==='cancelled','Cancellation evidence absent');
  else if(record.outcome==='run-deadline')assert(record.control?.wallDeadlineReached===true&&(record.control.wallTimerExpired===true||record.elapsedMs>=manifest.runWallMs),'Run deadline evidence absent');
  else if(record.outcome==='decision-timeout')assert(last&&!last.committed&&last.errorCode==='timeout','Decision timeout evidence absent');
  else if(record.outcome==='budget-stop')assert(last&&!last.committed&&last.errorCode==='budget','Budget stop evidence absent');
  else if(record.outcome==='provider-error')assert(last&&!last.committed&&!['cancelled','timeout','budget'].includes(last.errorCode)&&expectedRole==='terminal','Provider failure/fallback sequence mismatch');
  else throw new Error('Unsupported terminal claim');
  return freeze({ pieces,lines:observation.lines,score:observation.score,level:observation.level,failures,errorCounts,invalidOrStaleDecisions:errorCounts.schema??0,assistedPlacements:assisted,
    outcome:record.outcome,censored:['piece-cap','event-cap'].includes(record.outcome),consumedSequence:sequence,
    latency:{count:latencies.length,p50Ms:quantile(latencies,.5),p95Ms:quantile(latencies,.95)},elapsedMs:record.elapsedMs,
    fixtureUsage:Object.keys(usage).length?usage:null,actualCostUSD:null, costStatus:'unknown/not measured; no live requests',winner:null });
}
export function aggregatePairs(runs,manifest) {
  validateManifest(manifest);
  assert(Array.isArray(runs) && runs.length%2===0&&runs.length<=manifest.seedCount*2,'Complete bounded paired runs required');
  const pairs=[],seen=new Set();
  for(let i=0;i<runs.length;i+=2){const a=runs[i],b=runs[i+1];assert(a.seedIndex===b.seedIndex&&a.lane===0&&b.lane===1,'Invalid pair ordering');
    const x=recomputeRun(a,manifest),y=recomputeRun(b,manifest), common=Math.min(x.consumedSequence.length,y.consumedSequence.length);
    assert(!seen.has(a.seedIndex),'Duplicate paired sample');seen.add(a.seedIndex);
    assert(stableJSON(x)===stableJSON(a.metrics)&&stableJSON(y)===stableJSON(b.metrics),'Stored pair metric mismatch');
    assert(x.consumedSequence.slice(0,common).join()===y.consumedSequence.slice(0,common).join(),'Ordinal piece sequence diverged');
    pairs.push({seedIndex:a.seedIndex,scoreDifference:x.score-y.score,linesDifference:x.lines-y.lines,piecesDifference:x.pieces-y.pieces,
      outcomes:[x.outcome,y.outcome],censored:[x.censored,y.censored],assisted:[x.assistedPlacements,y.assistedPlacements],failures:[x.failures,y.failures]});}
  const differences=pairs.map(p=>p.scoreDifference),mean=differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:null;
  return freeze({sampleCount:pairs.length,expectedSampleCount:manifest.seedCount,missingSeedIndices:Array.from({length:manifest.seedCount},(_,i)=>i).filter(i=>!seen.has(i)),completeSampleSet:pairs.length===manifest.seedCount,pairs,meanScoreDifference:mean,scoreDifferenceRange:differences.length?[Math.min(...differences),Math.max(...differences)]:null,
    uncertainty:'Descriptive paired sample only; no significance, winner or superiority claim. Censoring, errors and assistance remain explicit.',winner:null});
}
async function runPaired({ options, players, seeds, signal } = {}) {
  const {manifest,instances}=preflight(options,players,seeds),runs=[];
  for(let seedIndex=0;seedIndex<seeds.length;seedIndex++)for(let lane=0;lane<2;lane++){
    if(signal?.aborted) break;
    runs.push(await runSingle(manifest,seeds[seedIndex],seedIndex,lane,instances[seedIndex][lane],signal));
    assert(Buffer.byteLength(stableJSON({manifest,runs}))<=manifest.maxArtifactBytes,'Artifact byte cap exceeded');
  }
  const pairedRuns=runs.length%2?runs.slice(0,-1):runs;
  const artifact={manifest,runs,aggregate:aggregatePairs(pairedRuns,manifest),partial: runs.length!==seeds.length*2};
  return freeze({...artifact,artifactHash:digest(artifact)});
}
export async function replayRun(manifest, record, privateSeed) {
  validateRecord(record,manifest);
  assert(manifest?.version===BENCHMARK_VERSION && manifest.rulesVersion===RULES.version && manifest.promptVersion===BRIEF_VERSION &&
    stableJSON(manifest.schemas)===stableJSON(VERSIONS) && manifest.live===false && manifest.hold===false && manifest.previewCount===5 &&
    manifest.objective===RULES.objective && manifest.clock==='step-frozen-game-time' && manifest.assistance==='canonical-afterstates-v1' &&
    manifest.initialBoard==='empty-10x20' && bounded(manifest.maxPieces,3000) && bounded(manifest.deadlineMs,60000) &&
    Number.isInteger(privateSeed) && privateSeed>0 && privateSeed<=0xffffffff && Array.isArray(manifest.players) && manifest.players.length===2 &&
    manifest.players.every(p=>['local','mock'].includes(p.kind)) && Number.isInteger(record.seedIndex) && record.seedIndex>=0 && record.seedIndex<manifest.seedCount &&
    [0,1].includes(record.lane) && record.sessionId===`${manifest.runId}-${record.seedIndex}-${record.lane}`,'Incompatible replay manifest');
  const recomputed=recomputeRun(record,manifest);assert(stableJSON(recomputed)===stableJSON(record.metrics),'Saved metric mismatch');
  let current, replayMismatch;
  const replayProvider={...manifest.players[record.lane],async decide(packet){
    if(!(current && digest(packet)===current.packetHash && digest(packet.candidates)===current.candidateDigest && packet.requestId===current.requestId)) {
      replayMismatch='Replay packet mismatch'; throw new Error(replayMismatch);
    }
    if(!current.committed)throw new ProviderError(current.errorCode);
    return {requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:current.selectedCandidateId};
  }};
  const controller=new Controller({seed:privateSeed,sessionId:record.sessionId,provider:replayProvider,deadlineMs:manifest.deadlineMs});
  assert(digest(controller.view.observation)===digest(record.initialObservation),'Replay initial observation mismatch');
  for(const event of record.events){
    current=event; assert(digest(controller.view.observation)===event.observationBeforeHash,'Replay before mismatch');
    controller.setProvider(event.role==='fallback'?{...replayProvider,name:'Local heuristic',kind:'local',version:'heuristic-1',capabilities:heuristic().capabilities}:replayProvider);
    const result=await controller.step();
    assert(!replayMismatch,replayMismatch);
    assert(!!result===event.committed && digest(controller.view.observation)===event.observationAfterHash && controller.view.pieces===event.piecesAfter,'Replay transition mismatch');
  }
  const over=controller.view.status==='over';
  assert(digest(controller.view.observation)===digest(record.finalObservation),'Replay terminal observation mismatch');
  if(over)assert(record.outcome==='game-loss','Top-out terminal precedence mismatch');
  else if(controller.view.pieces>=manifest.maxPieces)assert(record.outcome==='piece-cap','Cap terminal precedence mismatch');
  else assert(['cancelled','run-deadline','decision-timeout','budget-stop','provider-error','event-cap'].includes(record.outcome),'Unsupported terminal claim');
  controller.stop();
  return freeze({verified:true,observationHash:digest(record.finalObservation),outcome:record.outcome,metrics:recomputed,
    providerCalls:0,latencyReproduced:false,hashScope:'public observation and packet, not private engine/RNG state'});
}
