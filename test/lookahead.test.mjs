import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame,start } from '../public/engine.mjs';
import { observe,enumerate,simulate,candidateEvidence } from '../public/harness.mjs';
import { instructionPacket } from '../public/briefing.mjs';
import { Controller,heuristic } from '../public/controller.mjs';
import { evaluateLookahead,createLookaheadProvider,localLeafEvaluator,mockLeafEvaluator } from '../public/lookahead.mjs';
import { runPaired,replayRun } from '../benchmark.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const testPolicy={meaning:'Bounded test heuristic value, not win probability',valueRange:[-1000000,1000000]};
function fixture({seed=2,limit=2,mutate=()=>{}}={}){
 const state=start(createGame(seed));mutate(state);const binding={sessionId:'search-test',revision:0};
 const raw=enumerate(state,binding).slice(0,limit),packet=instructionPacket(observe(state,binding),raw.map(c=>candidateEvidence(state,c,binding)),{requestId:'search-request',deadlineMs:5000});
 return{state,binding,raw,packet};
}
const value=leaf=>leaf.terminalReason?-1000000:-5*leaf.features.holes-.5*leaf.features.aggregateHeight-.2*leaf.features.maxHeight-.2*leaf.features.bumpiness+8*leaf.linesDelta;
test('depth1 matches the local baseline formula and stable root ordering; full occupancy is retained',async()=>{
 const {packet}=fixture({limit:4}),report=await evaluateLookahead(packet,{depth:1,timeMs:2000});assert(report.ok);
 assert.equal(report.stats.nodes,4);assert.equal(report.stats.evaluatorCalls,4);assert.equal(report.stats.pruned,0);
 for(let i=0;i<4;i++){assert.equal(report.roots[i].value,value(report.roots[i].bestLeaf));assert.deepEqual(report.roots[i].bestLeaf.observation.board,packet.candidates[i].afterstate.board);assert.equal(report.roots[i].bestLeaf.observation.next.length,4);}
 const expected=report.roots.reduce((a,b)=>b.value>a.value?b:a);assert.equal(report.selectedRootId,expected.rootId);
 const equal={name:'Equal local values',kind:'mock',version:'constant-1',policy:testPolicy,evaluate:()=>0};
 const tie=await evaluateLookahead(packet,{evaluator:equal});assert.equal(tie.selectedRootId,packet.candidates[0].id);
 assert.match(report.policy.evaluator.policy.meaning,/not win probability/);assert.equal(report.policy.cache,'none');
});
test('depth2 matches a tiny exhaustive canonical reference and never mutates live state/RNG',async()=>{
 const {state,binding,raw,packet}=fixture(),before=JSON.stringify(state),seen=[];
 const evaluator={...localLeafEvaluator(),evaluate(leaf){seen.push(leaf);return value(leaf);}};
 const report=await evaluateLookahead(packet,{depth:2,evaluator,timeMs:5000});assert(report.ok,JSON.stringify(report.error));
 let nodes=raw.length,calls=0;
 for(let i=0;i<raw.length;i++){
  const root=simulate(state,raw[i],binding),childBinding={sessionId:binding.sessionId,revision:1},children=enumerate(root.state,childBinding);
  let best=-Infinity,bestObservation;
  for(const child of children){const leaf=simulate(root.state,child,childBinding),observation=observe(leaf.state,{...childBinding,revision:2,previewLimit:3});
   const v=value({features:leaf.features,linesDelta:leaf.linesDelta,terminalReason:leaf.terminalReason});calls++;nodes++;
   if(v>best){best=v;bestObservation=observation;}}
  assert.equal(report.roots[i].value,8*root.linesDelta+.9*best);assert.deepEqual(report.roots[i].bestLeaf.observation,bestObservation);assert.equal(report.roots[i].leafCount,children.length);
 }
 assert.equal(report.stats.nodes,nodes);assert.equal(report.stats.evaluatorCalls,calls);assert.equal(seen.length,calls);
 for(const leaf of seen){assert.equal(leaf.observation.board.length,20);assert.equal(leaf.observation.next.length,3);assert.equal(leaf.knownPreviewRemaining,3);assert(Object.isFrozen(leaf));assert.deepEqual(leaf.observation.next,packet.observation.next.slice(2));}
 assert.equal(JSON.stringify(state),before);
});
test('private RNG/buffer changes and synthetic refills cannot change public search results or evaluator inputs',async()=>{
 const a=fixture(),b=fixture({mutate:s=>{s.rng=123456789;s.seed=999;s.queue=[...s.queue.slice(0,5),'Z','Z','Z','Z','Z','Z','Z'];}});
 assert.deepEqual(a.packet,b.packet);const inputsA=[],inputsB=[];
 const evaluator=inputs=>({...localLeafEvaluator(),evaluate(leaf){inputs.push(leaf);return value(leaf);}});
 const x=await evaluateLookahead(a.packet,{depth:2,timeMs:5000,evaluator:evaluator(inputsA)}),y=await evaluateLookahead(b.packet,{depth:2,timeMs:5000,evaluator:evaluator(inputsB)});
 assert(x.ok&&y.ok);assert.deepEqual(x.roots,y.roots);assert.equal(x.selectedRootId,y.selectedRootId);assert.deepEqual(inputsA,inputsB);
 for(const leaf of inputsA){const text=JSON.stringify(leaf);for(const key of ['"seed"','"rng"','"queue"'])assert(!text.includes(key));}
});
test('node/call/output/time exhaustion and malformed evaluators execute no move or partial winner',async()=>{
 for(const options of [{depth:2,nodeCap:1},{depth:1,callCap:1},{depth:1,maxOutputBytes:4096},{depth:1,timeMs:1,evaluator:{name:'Slow',kind:'local',version:'slow-1',policy:testPolicy,evaluate(){const end=performance.now()+10;while(performance.now()<end){}return 0;}}},
  {evaluator:mockLeafEvaluator({mode:'invalid'})},{evaluator:mockLeafEvaluator({mode:'error'})},{timeMs:10,evaluator:mockLeafEvaluator({mode:'never'})}]){
  const provider=createLookaheadProvider(options),controller=new Controller({provider,deadlineMs:5000});await controller.step();
  assert.equal(controller.view.pieces,0);assert.equal(controller.view.status,'error');assert.equal(provider.lastSearch.ok,false);assert.equal(provider.lastSearch.selectedRootId,null);assert(!Object.hasOwn(provider.lastSearch,'roots'));
  assert(['budget','timeout','schema','provider_error'].includes(provider.lastReceipt.errorCode));
 }
 for(const options of [{depth:3},{nodeCap:0},{nodeCap:4001},{callCap:4001},{timeMs:5001},{maxOutputBytes:4194305},{discount:Infinity},{live:true},{evaluator:{name:'Remote',version:'r1',kind:'provider',evaluate(){throw new Error('never');}}}])assert.throws(()=>createLookaheadProvider(options));
});
test('cancellation, immediate replacement and ignored late evaluator replies preserve current ownership',async()=>{
 let calls=0,late;
 const evaluator={name:'Controlled mock',kind:'mock',version:'controlled-1',policy:testPolicy,evaluate(){calls++;if(calls===1)return new Promise(r=>{late=()=>r(0);});return 0;}};
 const provider=createLookaheadProvider({evaluator,timeMs:2000}),controller=new Controller({provider,deadlineMs:5000});
 const old=controller.step();await pause(0);controller.reset();const fresh=controller.step();await Promise.all([old,fresh]);
 assert.equal(controller.view.pieces,1);assert.equal(controller.view.status,'paused');const receipt=provider.lastReceipt;assert.equal(receipt.errorCode,null);
 late();await pause(0);assert.equal(controller.view.pieces,1);assert.equal(provider.lastReceipt,receipt);
 const aborted=new AbortController();aborted.abort();const report=await evaluateLookahead(fixture().packet,{signal:aborted.signal});assert.equal(report.ok,false);assert.equal(report.error.code,'cancelled');assert.equal(report.stats.evaluatorCalls,0);
});
test('malformed, stale or private packets fail closed before evaluation',async()=>{
 const original=fixture().packet;
 for(const change of [p=>{p.rng=1;},p=>{p.schemaVersion=99;},p=>{p.candidates[0].afterstate.next.push('I');},p=>{p.candidates[0].revision++;},p=>{p.candidates[0].afterstate.active.type='invalid';},p=>{p.candidates.push(p.candidates[0]);}]){
  const packet=structuredClone(original);change(packet);let calls=0;
  const report=await evaluateLookahead(packet,{evaluator:{name:'Never called',kind:'mock',version:'probe-1',policy:testPolicy,evaluate(){calls++;return 0;}}});
  assert.equal(report.ok,false);assert.equal(report.error.code,'input');assert.equal(calls,0);
 }
 for(const change of [p=>{p.candidates[0].afterstate.API_KEY='secret-sentinel';},p=>{p.candidates[0].afterstate.board[0][0]={hidden:'not a cell'};}]){
  const packet=structuredClone(original);change(packet);const report=await evaluateLookahead(packet);assert.equal(report.ok,false);assert.equal(report.error.code,'input');assert(!JSON.stringify(report).includes('secret-sentinel'));
 }
 const extra=structuredClone(original);extra.candidates[0].afterstate.unrecognized='ignored-root-data';extra.candidates[0].afterstate.active.unrecognized='ignored-active-data';
 const report=await evaluateLookahead(extra);assert(report.ok);assert(!JSON.stringify(report.roots).includes('ignored-root-data'));assert(!JSON.stringify(report.roots).includes('ignored-active-data'));
 assert.throws(()=>createLookaheadProvider({evaluator:{name:'Missing policy',kind:'mock',version:'unknown-1',evaluate:()=>0}}));
});
test('bounded paired depth1/depth2 runs declare algorithm assistance, capture actual results and replay saved decisions',async()=>{
 const policies=[],providers=[];
 const players=[1,2].map(depth=>({create:()=>{const p=createLookaheadProvider({depth,timeMs:3000});policies.push(p.runMetadata);providers.push(p);return p;}}));
 const artifact=await runPaired({options:{runId:'search-comparison',sourceRevision:'8c96745301b7d72293b2ebd89f84fd549b521c79',maxPieces:4,deadlineMs:5000,runWallMs:30000},players,seeds:[2]});
 assert.equal(artifact.aggregate.sampleCount,1);assert.equal(artifact.aggregate.winner,null);
 for(let lane=0;lane<2;lane++){const record=artifact.runs[lane];assert.equal(record.metrics.pieces,4);assert.equal(record.outcome,'piece-cap');assert.equal(record.metrics.censored,true);
  assert.equal(artifact.manifest.players[lane].configuration.search.depth,lane+1);assert.match(artifact.manifest.players[lane].configuration.comparison,/Algorithm\/assistance/);
  assert(providers[lane].lastSearch.stats.evaluatorCalls>0);assert((await replayRun(artifact.manifest,record,2)).verified);}
 assert.deepEqual(artifact.runs[0].metrics.consumedSequence,artifact.runs[1].metrics.consumedSequence);
 assert.deepEqual(policies.map(p=>p.search.pruning),['none; every offered root and reachable child within caps','none; every offered root and reachable child within caps']);
 assert.equal(policies[0].search.modelCalls,0);assert.equal(policies[1].search.spendCapUSD,0);assert.equal(artifact.runs[1].metrics.actualCostUSD,null);
 const local=heuristic();assert.equal(typeof local.decide,'function');
});
test('standalone search aborts timed-out evaluator work without aborting the caller signal',async()=>{
 let cleaned=false,timer;const outer=new AbortController();
 const evaluator={name:'Scoped delayed mock',kind:'mock',version:'scope-1',policy:testPolicy,evaluate(leaf,{signal}){return new Promise((resolve,reject)=>{
  timer=setTimeout(()=>resolve(0),200);signal.addEventListener('abort',()=>{cleaned=true;clearTimeout(timer);reject(new Error('ignored raw mock text'));},{once:true});
 });}};
 try{const report=await evaluateLookahead(fixture().packet,{evaluator,timeMs:5,signal:outer.signal});assert.equal(report.ok,false);assert.equal(report.error.code,'timeout');assert(cleaned);assert.equal(outer.signal.aborted,false);}
 finally{clearTimeout(timer);}
});
test('final report output overflow remains a classified failure after full root evaluation',async()=>{
 const {packet}=fixture({limit:4}),report=await evaluateLookahead(packet,{timeMs:2000});assert(report.ok);
 const payloadBytes=new TextEncoder().encode(JSON.stringify({roots:report.roots,stats:report.stats,policy:report.policy})).length;
 assert(payloadBytes>4096);
 const capped=await evaluateLookahead(packet,{timeMs:2000,maxOutputBytes:payloadBytes+48});
 assert.equal(capped.ok,false);assert.equal(capped.error.code,'budget');assert.equal(capped.selectedRootId,null);assert.equal(capped.complete,false);
});
