import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaired, replayRun, recomputeRun, aggregatePairs, preflight, stableJSON, digest } from '../benchmark.mjs';
import { heuristic, mockProvider } from '../public/controller.mjs';
import { ProviderError } from '../providers.mjs';
const sourceRevision='f90ec403f7a3e48b9485003a5140fe8f9a65c7e7';
const options=extra=>({runId:'paired-test',sourceRevision,maxPieces:12,deadlineMs:100,runWallMs:10000,...extra});
const players=()=>[{create:()=>heuristic()},{create:()=>mockProvider({mode:'delay',delayMs:0})}];
const clone=x=>JSON.parse(JSON.stringify(x));
test('policy identity distinguishes custom weights and detects factory changes across seeds',()=>{
 const a=preflight(options(),[{create:()=>heuristic()},{create:()=>heuristic({aggregateHeight:1,maxHeight:10})}],[1]);
 assert.notEqual(stableJSON(a.manifest.players[0]),stableJSON(a.manifest.players[1]));
 assert.equal(a.manifest.players[1].configuration.policy.weights.aggregateHeight,1);
 const b=preflight(options(),[{create:()=>heuristic({holes:-5})},{create:()=>heuristic()}],[1]);assert.equal(stableJSON(b.manifest.players[0]),stableJSON(b.manifest.players[1]));
 let n=0;assert.throws(()=>preflight(options(),[{create:()=>heuristic({holes:++n===1?-5:-100})},{create:()=>heuristic()}],[1,2]),/configuration changed/);
 let delay=0;assert.throws(()=>preflight(options(),[{create:()=>mockProvider({delayMs:delay++})},{create:()=>heuristic()}],[1,2]),/configuration changed/);
});
test('new fallback policy is bound while historical null-metadata fallback replay remains compatible',async()=>{
 const a=await runPaired({options:options({maxPieces:1,fallback:'local-heuristic-explicit'}),players:[{create:()=>mockProvider({mode:'error',delayMs:0})},{create:()=>heuristic()}],seeds:[1]});
 assert.equal(a.manifest.fallbackProvider.configuration.policy.weights.holes,-5);
 const run=a.runs[0],fallback=run.events.find(e=>e.role==='fallback');assert.deepEqual(fallback.provider,a.manifest.fallbackProvider);
 const altered=clone(run);altered.events.find(e=>e.role==='fallback').provider.configuration=null;
 assert.throws(()=>recomputeRun(altered,a.manifest),/attribution/);
 const legacyManifest=clone(a.manifest);delete legacyManifest.fallbackProvider;
 assert.deepEqual(recomputeRun(altered,legacyManifest),run.metrics);assert((await replayRun(legacyManifest,altered,1)).verified);
 const tampered=clone(a.manifest);tampered.fallbackProvider.configuration.policy.weights.holes=999;assert.throws(()=>recomputeRun(run,tampered),/fallback policy/);
});
test('paired runs isolate games/providers, preserve ordinal sequences across delays, and expose recomputable metrics',async()=>{
 const artifact=await runPaired({options:options(),players:players(),seeds:[1,2]});
 assert.equal(artifact.runs.length,4);assert.equal(artifact.aggregate.sampleCount,2);assert.equal(artifact.partial,false);
 assert.equal(artifact.manifest.objective,'clear 300 lines');assert.equal(artifact.manifest.hold,false);
 for(const run of artifact.runs){
  assert.equal(run.outcome,'piece-cap');assert.equal(run.metrics.pieces,12);assert.equal(run.metrics.censored,true);
  assert.deepEqual(recomputeRun(clone(run),artifact.manifest),run.metrics);assert.equal(run.metrics.winner,null);assert.equal(run.metrics.actualCostUSD,null);
  for(const event of run.events){assert.equal(event.piecesAfter-event.piecesBefore,1);assert.equal(event.observationAfter.next.length,5);assert.equal(event.packetHash.length,64);}
 }
 assert.deepEqual(aggregatePairs(clone(artifact.runs),artifact.manifest),artifact.aggregate);
 const a=artifact.runs[0],b=artifact.runs[1];assert.notEqual(a.sessionId,b.sessionId);assert.deepEqual(a.metrics.consumedSequence,b.metrics.consumedSequence);
 const {artifactHash,...content}=artifact;assert.equal(artifactHash,digest(content));
 const text=JSON.stringify(artifact);for(const field of ['"seed":','"seeds":','"rng":','"queue":','"apiKey":','"authorization":'])assert(!text.includes(field),field);
 assert(!text.includes('winning probability'));assert.match(artifact.aggregate.uncertainty,/no significance/);
});
test('saved decisions replay identical public observation hashes and outcomes without fresh provider decisions',async()=>{
 let calls=0;const create=()=>{const p=heuristic();return{...p,async decide(packet,context){calls++;return p.decide(packet,context);}};};
 const artifact=await runPaired({options:options({maxPieces:8}),players:[{create},{create}],seeds:[47]});
 const before=calls;
 for(const record of artifact.runs){const replay=await replayRun(artifact.manifest,clone(record),47);assert(replay.verified);assert.equal(replay.observationHash,digest(record.finalObservation));assert.equal(replay.outcome,record.outcome);assert.equal(replay.providerCalls,0);assert.equal(replay.latencyReproduced,false);}
 assert.equal(calls,before);
});
test('replay rejects tampered choice, packets, candidates, observation chain, metrics, event order and terminal claims',async()=>{
 const artifact=await runPaired({options:options({maxPieces:3}),players:players(),seeds:[3]});
 for(const mutate of [r=>{r.events[0].selectedCandidateId='invented';},r=>{r.events[0].packetHash='f'.repeat(64);},r=>{r.events[0].candidateDigest='f'.repeat(64);},
  r=>{r.events[0].observationAfterHash='f'.repeat(64);},r=>{r.metrics.pieces++;},r=>{r.events.reverse();},r=>{r.outcome='game-loss';r.metrics.outcome='game-loss';r.metrics.censored=false;}]){
  const record=clone(artifact.runs[0]);mutate(record);await assert.rejects(replayRun(artifact.manifest,record,3));
 }
 await assert.rejects(replayRun({...artifact.manifest,hold:true},artifact.runs[0],3),/Incompatible/);
 await assert.rejects(replayRun({...artifact.manifest,objective:'40-line sprint'},artifact.runs[0],3),/Incompatible/);
 await assert.rejects(replayRun(artifact.manifest,artifact.runs[0],4),/mismatch/);
});
test('preflight rejects unsupported mechanics/configuration/live/missing budgets before provider invocation',()=>{
 let factories=0;const p=[{create:()=>{factories++;return heuristic();}},{create:()=>{factories++;return heuristic();}}];
 for(const change of [{hold:true},{objective:'40-line sprint'},{clock:'realtime'},{live:true},{live:true,budgetUSD:1},{maxPieces:3001},{maxPieces:3000},{sourceRevision:'unversioned'},{fallback:'automatic'},{unknown:true}]){
  assert.throws(()=>preflight(options(change),p,[1,2]));
 }
 assert.equal(factories,0);
 const reused=heuristic();assert.throws(()=>preflight(options(),[{create:()=>reused},{create:()=>reused}],[1]),/fresh provider/);
 assert.throws(()=>preflight(options(),[{create:()=>({...heuristic(),kind:'live'})},{create:()=>heuristic()}],[1]),/live provider/);
 assert.throws(()=>preflight(options(),players(),[0]),/seed/);
 assert.throws(()=>stableJSON({bad:Infinity}),/Noncanonical/);assert.equal(digest({b:1,a:2}),digest({a:2,b:1}));
});
test('primary failures and explicit fallback remain separate, replayable and attributed; no fallback after timeout',async()=>{
 const p=[{create:()=>mockProvider({mode:'error',delayMs:0})},{create:()=>heuristic()}];
 const failed=await runPaired({options:options({maxPieces:4}),players:p,seeds:[2]});
 assert.equal(failed.runs[0].outcome,'provider-error');assert.equal(failed.runs[0].metrics.pieces,0);assert.equal(failed.runs[0].metrics.failures,1);
 assert.equal(failed.runs[1].metrics.pieces,4);
 const tampered=clone(failed.runs[0]);tampered.events[0].packetHash='f'.repeat(64);await assert.rejects(replayRun(failed.manifest,tampered,2),/packet mismatch/);
 const assisted=await runPaired({options:options({maxPieces:4,fallback:'local-heuristic-explicit'}),players:p,seeds:[2]});
 const run=assisted.runs[0];assert.equal(run.metrics.assistedPlacements,4);assert.equal(run.metrics.failures,4);assert.equal(run.events.length,8);
 assert.deepEqual(run.events.map(e=>e.role),['primary','fallback','primary','fallback','primary','fallback','primary','fallback']);
 assert((await replayRun(assisted.manifest,run,2)).verified);
 const hung=await runPaired({options:options({maxPieces:2,deadlineMs:5,fallback:'local-heuristic-explicit'}),players:[{create:()=>mockProvider({mode:'never'})},{create:()=>heuristic()}],seeds:[2]});
 assert.equal(hung.runs[0].metrics.assistedPlacements,0);assert.equal(hung.runs[0].events[0].errorCode,'timeout');
});
test('cancelled and wall-deadline runs commit no late result or fallback',async()=>{
 let late;const control=new AbortController();
 const delayed=()=>({...heuristic(),decide:packet=>new Promise(resolve=>{late=()=>resolve({requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:packet.candidates[0].id});})});
 const pending=runPaired({options:options({fallback:'local-heuristic-explicit'}),players:[{create:delayed},{create:()=>heuristic()}],seeds:[4],signal:control.signal});
 await new Promise(r=>setTimeout(r,0));control.abort();const result=await pending;
 assert.equal(result.runs.length,1);assert.equal(result.runs[0].outcome,'cancelled');assert.equal(result.runs[0].metrics.pieces,0);assert.equal(result.runs[0].metrics.assistedPlacements,0);assert.equal(result.partial,true);
 late();await new Promise(r=>setTimeout(r,0));assert.equal(result.runs[0].metrics.pieces,0);
 assert((await replayRun(result.manifest,result.runs[0],4)).verified);
 const wall=await runPaired({options:options({runWallMs:2,deadlineMs:100,fallback:'local-heuristic-explicit'}),players:[{create:()=>mockProvider({mode:'never'})},{create:()=>heuristic()}],seeds:[2]});
 assert.equal(wall.runs[0].outcome,'run-deadline');assert.equal(wall.runs[0].metrics.pieces,0);assert.equal(wall.runs[0].metrics.assistedPlacements,0);
 const slow=()=>({...heuristic(),async decide(packet){const end=performance.now()+8;while(performance.now()<end){}return{requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:packet.candidates[0].id};}});
 const expired=await runPaired({options:options({runWallMs:2,deadlineMs:100}),players:[{create:slow},{create:slow}],seeds:[2]});
 for(const run of expired.runs){assert.equal(run.outcome,'run-deadline');assert.equal(run.metrics.pieces,0);}
});
test('top-out on the exact cap-reaching placement remains game loss, never censoring or victory',async()=>{
 const first=()=>({...heuristic(),async decide(p){return{requestId:p.requestId,stateRevision:p.stateRevision,selectedCandidateId:p.candidates[0].id};}});
 const players=[{create:first},{create:first}];
 const baseline=await runPaired({options:options({maxPieces:1000}),players,seeds:[2]});
 const exactCap=baseline.runs[0].metrics.pieces;assert(exactCap>1 && exactCap<1000);
 const artifact=await runPaired({options:options({maxPieces:exactCap}),players,seeds:[2]});
 for(const run of artifact.runs){assert.equal(run.metrics.pieces,exactCap);assert.equal(run.outcome,'game-loss');assert.equal(run.metrics.censored,false);assert.equal(run.finalObservation.terminalReason,'blocked spawn');}
 assert((await replayRun(artifact.manifest,artifact.runs[0],2)).verified);
});
test('per-decision fixture metadata and usage belong to the current request and exclude raw secrets',async()=>{
 const create=()=>{const local=heuristic();let receipt=null;return{...local,kind:'mock',get lastReceipt(){return receipt;},async decide(packet){
  const choice=await local.decide(packet);receipt={requestId:packet.requestId,reportedModel:'gpt-6-luna',reportedServiceTier:'default',responseSha256:'a'.repeat(64),rawResponseArtifactRef:'fixture:test/benchmark.test.mjs#metadata',usage:{input_tokens:10,output_tokens:2,total_tokens:12},apiKey:'secret-sentinel'};return choice;
 }};};
 const artifact=await runPaired({options:options({maxPieces:2}),players:[{create},{create}],seeds:[2]});
 for(const run of artifact.runs){assert.equal(run.metrics.fixtureUsage.total_tokens,24);for(const e of run.events){assert.equal(e.providerReceipt.reportedModel,'gpt-6-luna');assert.equal(e.providerReceipt.responseSha256,'a'.repeat(64));}}
 assert(!JSON.stringify(artifact).includes('secret-sentinel'));
});
test('synchronous decisions past the per-move deadline never commit or receive fallback',async()=>{
 const create=()=>({...heuristic(),async decide(packet){const end=performance.now()+20;while(performance.now()<end){}return{requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:packet.candidates[0].id};}});
 const artifact=await runPaired({options:options({maxPieces:1,deadlineMs:1,runWallMs:1000,fallback:'local-heuristic-explicit'}),players:[{create},{create}],seeds:[2]});
 for(const run of artifact.runs){assert.equal(run.metrics.pieces,0);assert.equal(run.outcome,'decision-timeout');assert.equal(run.events[0].errorCode,'timeout');assert.equal(run.metrics.assistedPlacements,0);assert((await replayRun(artifact.manifest,run,2)).verified);}
});
test('typed timeout, cancelled and budget errors survive the controller boundary and never fallback',async()=>{
 for(const [code,outcome] of [['timeout','decision-timeout'],['cancelled','cancelled'],['budget','budget-stop']]){
  const create=()=>({...heuristic(),async decide(){throw new ProviderError(code);}});
  const artifact=await runPaired({options:options({fallback:'local-heuristic-explicit'}),players:[{create},{create}],seeds:[2]});
  for(const run of artifact.runs){assert.equal(run.outcome,outcome);assert.equal(run.events[0].errorCode,code);assert.equal(run.metrics.pieces,0);assert.equal(run.metrics.assistedPlacements,0);assert((await replayRun(artifact.manifest,run,2)).verified);}
 }
});
test('reducers and replay reject invented terminal caps and fallback attribution/policy changes',async()=>{
 const bad=[{create:()=>mockProvider({mode:'error',delayMs:0})},{create:()=>heuristic()}];
 const plain=await runPaired({options:options(),players:bad,seeds:[2]});
 for(const outcome of ['event-cap','cancelled','run-deadline','decision-timeout','budget-stop']){
  const r=clone(plain.runs[0]);r.outcome=outcome;
  assert.throws(()=>recomputeRun(r,plain.manifest));await assert.rejects(replayRun(plain.manifest,r,2));
 }
 const artifact=await runPaired({options:options({maxPieces:1,fallback:'local-heuristic-explicit'}),players:bad,seeds:[2]});
 const changed=clone(artifact.runs[0]);changed.events[1].role='primary';changed.events[1].provider=artifact.manifest.players[0];
 assert.throws(()=>recomputeRun(changed,artifact.manifest),/attribution/);await assert.rejects(replayRun(artifact.manifest,changed,2),/attribution/);
 const noFallback={...artifact.manifest,fallback:'none'};
 assert.throws(()=>recomputeRun(artifact.runs[0],noFallback));await assert.rejects(replayRun(noFallback,artifact.runs[0],2));
 const identity=clone(artifact.runs[0]);identity.events[1].provider.name='False primary';assert.throws(()=>recomputeRun(identity,artifact.manifest),/attribution/);
});
test('artifact validation rejects events appended after natural game loss and piece-cap exhaustion',async()=>{
 const first=()=>({...heuristic(),async decide(p){return{requestId:p.requestId,stateRevision:p.stateRevision,selectedCandidateId:p.candidates[0].id};}});
 const p=[{create:first},{create:first}];
 for(const cap of [100,2]){
  const artifact=await runPaired({options:options({maxPieces:cap}),players:p,seeds:[2]});const record=clone(artifact.runs[0]);
  assert.equal(record.outcome,cap===100?'game-loss':'piece-cap');
  const observation=record.finalObservation,pieces=record.metrics.pieces;
  record.events.push({...clone(record.events.at(-1)),index:record.events.length,role:'primary',provider:artifact.manifest.players[0],
    observationBefore:clone(observation),observationAfter:clone(observation),observationBeforeHash:digest(observation),observationAfterHash:digest(observation),
    packetHash:null,candidateDigest:null,requestId:null,selectedCandidateId:null,piecesBefore:pieces,piecesAfter:pieces,committed:false,errorCode:'provider_error',consumedPiece:null,latencyMs:0,usage:null,providerReceipt:null});
  record.lastFailureCode='provider_error';
  assert.throws(()=>recomputeRun(record,artifact.manifest),/terminal|cap/);await assert.rejects(replayRun(artifact.manifest,record,2),/terminal|cap/);
 }
});
test('aggregation rejects duplicate/out-of-range samples, wrong identities and inconsistent stored metrics',async()=>{
 const artifact=await runPaired({options:options({maxPieces:2}),players:players(),seeds:[1,2]});
 assert.throws(()=>aggregatePairs([...artifact.runs.slice(0,2),...artifact.runs.slice(0,2)],artifact.manifest),/Duplicate/);
 const outside=clone(artifact.runs.slice(0,2));outside.forEach(r=>{r.seedIndex=999;});assert.throws(()=>aggregatePairs(outside,artifact.manifest),/identity/);
 const stale=clone(artifact.runs);stale[0].metrics.pieces++;assert.throws(()=>aggregatePairs(stale,artifact.manifest),/metric mismatch/);
 for(const mutate of [r=>{r.sessionId='wrong';},r=>{r.seedReference='wrong';},r=>{r.events[0].consumedPiece=r.events[0].consumedPiece==='I'?'Z':'I';},r=>{r.lastFailureCode='budget';},
  r=>{r.events[0].observationAfter.score=-1;},r=>{r.events[0].observationAfter.level=Infinity;}]){
  const r=clone(artifact.runs[0]);mutate(r);assert.throws(()=>recomputeRun(r,artifact.manifest));await assert.rejects(replayRun(artifact.manifest,r,1));
 }
 const partial=aggregatePairs(artifact.runs.slice(0,2),artifact.manifest);assert.equal(partial.sampleCount,1);assert.equal(partial.expectedSampleCount,2);assert.deepEqual(partial.missingSeedIndices,[1]);assert.equal(partial.completeSampleSet,false);
 let factories=0;assert.throws(()=>preflight(options(),[{create:()=>{factories++;return heuristic();}},{create:()=>{factories++;return heuristic();}}],[1,1]),/Unique/);assert.equal(factories,0);
});
test('all artifact entry points reject incompatible manifests and invalid JSON hashing values',async()=>{
 const artifact=await runPaired({options:options({maxPieces:2}),players:players(),seeds:[3]});
 for(const change of [{version:'old'},{codeVersion:'old'},{rulesVersion:'old'},{promptVersion:'old'},{schemas:{...artifact.manifest.schemas,features:99}},{hold:true},{live:true},{budgetUSD:1},{maxPieces:0},{seedCount:9},{deadlineMs:NaN},{sourceRevision:'unset'}]){
  const m={...artifact.manifest,...change};assert.throws(()=>recomputeRun(artifact.runs[0],m));assert.throws(()=>aggregatePairs(artifact.runs,m));await assert.rejects(replayRun(m,artifact.runs[0],3));
 }
 for(const value of [new Date(),new Map(),new Set(),new Number(1),new Array(2)])assert.throws(()=>stableJSON(value));
 const extra=[1];extra.extra='not JSON';assert.throws(()=>stableJSON(extra));
 const overflow=clone(artifact.runs[0]);overflow.events.forEach(e=>{e.usage={total_tokens:Number.MAX_SAFE_INTEGER};});assert.throws(()=>recomputeRun(overflow,artifact.manifest),/usage/);
 const failed=await runPaired({options:options({maxPieces:2}),players:[{create:()=>mockProvider({mode:'error',delayMs:0})},{create:()=>heuristic()}],seeds:[3]});
 const changed=clone(failed.runs[0]);changed.events[0].observationAfter.score=100;changed.events[0].observationAfterHash=digest(changed.events[0].observationAfter);changed.finalObservation=changed.events[0].observationAfter;
 assert.throws(()=>recomputeRun(changed,failed.manifest),/Failed attempt/);
});
