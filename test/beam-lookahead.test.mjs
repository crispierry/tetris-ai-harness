import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start} from '../public/engine.mjs';
import {observe,enumerate,candidateEvidence} from '../public/harness.mjs';
import {instructionPacket} from '../public/briefing.mjs';
import {Controller} from '../public/controller.mjs';
import {localLeafEvaluator,evaluateLookahead} from '../public/lookahead.mjs';
import {createConfigurableLookaheadProvider,evaluateVisibleBeam,BEAM_VERSION} from '../public/beam-lookahead.mjs';
import {DecisionJournal} from '../public/decision-record.mjs';
import {providerPolicy} from '../public/provider-policy.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';

function packetFor(state=start(createGame(2)),limit=800){const binding={sessionId:'visible-beam-test',revision:1},raw=enumerate(state,binding).slice(0,limit);return instructionPacket(observe(state,binding),raw.map(c=>candidateEvidence(state,c,binding)),{requestId:'visible-beam-test:1:1',deadlineMs:5000});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
for(const depth of [1,2,3,4,5,6])test(`depth ${depth} reaches the selected visible horizon and exports a canonical decision`,async()=>{
 const provider=createConfigurableLookaheadProvider({depth,timeMs:2000});let journal;const c=new Controller({provider,deadlineMs:5000,onTransition:({input,view})=>journal.append(0,input,view)});
 journal=new DecisionJournal({mode:'solo'});journal.addLane(0,'computer',c.view,providerPolicy(provider));await c.step();
 assert.equal(c.view.error,null);assert.equal(c.view.pieces,1);const r=provider.lastSearch;assert.equal(r.version,BEAM_VERSION);assert.equal(r.complete,true);assert.equal(r.stats.depthRequested,depth);assert.equal(r.stats.depthReached,depth);assert.equal(r.stats.selectedDepth,depth);assert.equal(r.stats.nodes,r.stats.evaluatorCalls);assert(r.stats.nodes<=4000);assert.equal(r.policy.live,false);assert.equal(r.policy.modelCalls,0);assert.equal(r.policy.spendCapUSD,0);
 assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
 if(depth===6){assert.equal(r.bestLeaf.observation.status,'horizon');assert.equal(r.bestLeaf.observation.active,null);assert.deepEqual(r.bestLeaf.observation.next,[]);assert.equal(r.bestLeaf.horizon,true);}
 for(const mutate of [x=>x.lanes[0].policy.search.beamWidth=0,x=>x.events.find(e=>e.input.kind==='computer').input.receipt.search.depthRequested=7,x=>x.events.find(e=>e.input.kind==='computer').input.receipt.search.nodes=0]){const x=JSON.parse(journal.exportRun());mutate(x);assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(x)));}
});
test('a wide depth2 beam matches the existing tiny exhaustive reference',async()=>{
 const p=packetFor(undefined,2),legacy=await evaluateLookahead(p,{depth:2,timeMs:5000}),beam=await evaluateVisibleBeam(p,{depth:2,beamWidth:16,timeMs:5000});
 assert(legacy.ok&&beam.ok);assert.equal(beam.selectedRootId,legacy.selectedRootId);assert.equal(beam.value,legacy.value);assert.deepEqual(beam.bestLeaf.observation,legacy.roots.find(r=>r.rootId===legacy.selectedRootId).bestLeaf.observation);assert.equal(beam.stats.pruned,0);
});
test('depth6 evaluator inputs depend only on the visible current/next pieces, never hidden RNG/refill',async()=>{
 const a=start(createGame(2)),b=structuredClone(a);b.rng=987654;b.seed=444;b.queue=[...b.queue.slice(0,5),'Z','Z','Z','Z'];const pa=packetFor(a,2),pb=packetFor(b,2);assert.deepEqual(pa,pb);
 const leaves=[],other=[],probe=seen=>({...localLeafEvaluator(),evaluate(leaf){seen.push(leaf);return localLeafEvaluator().evaluate(leaf);}});
 const x=await evaluateVisibleBeam(pa,{depth:6,timeMs:5000,evaluator:probe(leaves)}),y=await evaluateVisibleBeam(pb,{depth:6,timeMs:5000,evaluator:probe(other)});
 assert(x.ok&&y.ok);assert.equal(x.selectedRootId,y.selectedRootId);assert.deepEqual(x.roots,y.roots);assert.deepEqual(leaves,other);assert(leaves.some(l=>l.depth===6));
 for(const leaf of leaves.filter(l=>l.depth===6)){assert.deepEqual(leaf.observation.next,[]);assert.equal(leaf.observation.active,null);assert.equal(leaf.observation.status,'horizon');}
 const scan=v=>{if(v&&typeof v==='object')for(const[k,item]of Object.entries(v)){assert(!['seed','rng','queue','apikey','capability','secret'].includes(k.toLowerCase()));scan(item);}};scan(x);assert.equal(JSON.stringify(a),JSON.stringify(start(createGame(2))));
});
test('bounded depth6 exhaustion returns no shallower winner or committed placement',async()=>{
 const p=createConfigurableLookaheadProvider({depth:6,nodeCap:40,timeMs:5000}),c=new Controller({provider:p,deadlineMs:5000});await c.step();assert.equal(c.view.pieces,0);assert.equal(c.view.status,'error');assert.equal(p.lastSearch.ok,false);assert.equal(p.lastSearch.selectedRootId,null);assert.equal(p.lastSearch.complete,false);assert.equal(p.lastSearch.error.code,'budget');assert(p.lastSearch.stats.depthReached<6);
 for(const options of [{depth:0},{depth:7},{depth:1.5},{beamWidth:0},{beamWidth:17},{nodeCap:4001}])assert.throws(()=>createConfigurableLookaheadProvider(options));
});
test('cancellation during a deeper layer closes work and ignored replies cannot select a piece',async()=>{
 let entered,release;const reached=new Promise(r=>entered=r),outer=new AbortController();const evaluator={...localLeafEvaluator(),evaluate(leaf){if(leaf.depth===3){entered();return new Promise(r=>release=r);}return 0;}};
 const work=evaluateVisibleBeam(packetFor(undefined,2),{depth:6,timeMs:5000,evaluator,signal:outer.signal});await reached;outer.abort();const r=await work;assert.equal(r.ok,false);assert.equal(r.error.code,'cancelled');assert.equal(r.selectedRootId,null);release(0);await wait(0);
 const stopped=new AbortController();stopped.abort();const pre=await evaluateVisibleBeam(packetFor(undefined,2),{depth:6,signal:stopped.signal});assert.equal(pre.error.code,'cancelled');assert.equal(pre.stats.nodes,0);
});
test('canonical victory ends a depth6 branch immediately without consuming future previews',async()=>{
 const state=start(createGame(2));state.active={type:'I',rotation:1,x:3,y:0};state.lines=299;state.level=30;for(let y=16;y<20;y++)state.board[y]=Array.from({length:10},(_,x)=>x===5?null:'J');
 const binding={sessionId:'beam-win',revision:1},candidates=enumerate(state,binding),winner=candidates.map(c=>candidateEvidence(state,c,binding)).find(c=>c.afterstate.status==='won');assert(winner);
 const p=instructionPacket(observe(state,binding),[winner],{requestId:'beam-win:1:1',deadlineMs:5000}),r=await evaluateVisibleBeam(p,{depth:6});
 assert(r.ok);assert.equal(r.stats.depthReached,1);assert.equal(r.stats.selectedDepth,1);assert.equal(r.stats.earlyTerminal,1);assert.equal(r.stats.expandedStates,0);assert.deepEqual(r.bestLeaf.observation.next,p.observation.next);assert.equal(r.bestLeaf.observation.status,'won');
});
test('malformed/private input is rejected before any deeper evaluator work and failure output stays bounded',async()=>{
 const p=structuredClone(packetFor(undefined,2));p.secret='private-sentinel';const r=await evaluateVisibleBeam(p,{depth:6,maxOutputBytes:4096});assert.equal(r.error.code,'input');assert.equal(r.selectedRootId,null);assert.equal(r.stats.nodes,0);assert(!JSON.stringify(r).includes('private-sentinel'));assert(Buffer.byteLength(JSON.stringify(r))<=4096);
});
