import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
import {DecisionJournal,decisionRecord} from '../public/decision-record.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {Comparison,providerFor} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {Controller,heuristic} from '../public/controller.mjs';
import {providerPolicy} from '../public/provider-policy.mjs';
import {createDecisionBridge} from '../public/decision-bridge.mjs';
const clone=v=>JSON.parse(JSON.stringify(v)),wait=ms=>new Promise(r=>setTimeout(r,ms));
const limits={maxAttempts:10000,maxInputTokens:100000000,maxEstimatedMicros:100000,expiresAt:2000000000000,maxRuns:8,maxEpochs:8,maxPlacements:1000,timeoutMs:1500,reservationTokens:1000000,reservationMicros:1};
function bridgeFixture(){
 let epoch=0,calls=0,hold=null,release=null;const local=heuristic();
 const admission=()=>({mode:'http-fixture',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:null,endpoint:'https://api.openai.com/v1/decisions',protocol:'decisions-http-1',policyDigest:'b'.repeat(64),limits,epoch,placements:calls,attempts:0,completions:calls,uncertain:0,remainingAttempts:10000,actualExternalCalls:0,actualCostUSD:0});
 const grant={capability:'a'.repeat(64),controllerSessionBase:'verifier-fixture',epoch:0,admission:admission()};
 const fetchImpl=async(route,options={})=>{
  const body=options.body?JSON.parse(options.body):{};let value;
  if(route==='/decision/status')value={available:true};else if(route.endsWith('/register'))value={challengeId:'fixture-challenge',expiresAt:Date.now()+60000};else if(route.endsWith('/claim'))value={state:'connected',grant};
  else if(route==='/decision/control'){if(body.action==='runStatus')value=admission();else if(body.action==='advanceEpoch'){epoch=body.epoch;value={epoch,maxEpochs:8,closed:false};}else value={epoch,maxEpochs:8,closed:body.action==='close'};}
  else if(route==='/decision/choice'){
   calls++;if(hold){release=()=>{hold();hold=null;};await new Promise(r=>hold=r);}
   const p=body.packet,choice=await local.decide(p);
   value={choice,receipt:{version:'decision-receipt-2',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:null,requestLatencyMs:0,completions:1,placements:1,actualExternalCalls:0,remainingAllowance:{attempts:10000,reservedInputTokens:100000000,estimatedReservationMicros:100000},completedResponses:0,mode:'http-fixture',runId:'fixture',laneId:'fixture',epoch,lineage:'fixture',policyDigest:'b'.repeat(64),usage:null,estimatedReservationMicros:0,reservedInputTokens:0,requestId:p.requestId,stateRevision:p.stateRevision,selectedCandidateId:choice.selectedCandidateId,attempts:0,actualCostUSD:0,usageProvenance:'fixture response; no API usage'}};
  }else throw new Error(`Unexpected fixture route ${route}`);
  return new Response(JSON.stringify(value),{status:200});
 };
 return {fetchImpl,grant,bridge:createDecisionBridge({grant,fetchImpl}),get calls(){return calls;},hold(){hold=()=>{};},release(){release?.();}};
}
class Element{constructor(){this.children=[];this.listeners={};this.value='local';this.textContent='';this.disabled=false;}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
function mountedSolo(){const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};const doc={getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false};const mounted=mountHarness(doc,{window:{addEventListener(){}}});return {$,mounted};}
async function settle(fn){for(let n=0;n<500;n++){if(fn())return;await wait(2);}throw new Error('fixture did not settle');}

test('all three production exporters emit canonically verifiable successful HTTP bridge records and immutable replay exports',async()=>{
 const fixture=bridgeFixture(),oldFetch=globalThis.fetch;globalThis.fetch=fixture.fetchImpl;const {$,mounted}=mountedSolo();
 try{
  $('h-provider').value='openai';$('h-provider').trigger('change');await $('decision-pairing').children[1].trigger('click');
  for(let n=0;n<8;n++)await $('h-step').trigger('click');const json=mounted.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);assert.equal(JSON.parse(json).lanes[0].policy.transport,'http-fixture');assert(JSON.parse(json).events.some(e=>e.input.receipt?.version==='decision-receipt-2'));
  $('h-replay').trigger('click');await $('h-step').trigger('click');assert.equal(mounted.exportRun(),json);
 }finally{mounted.dispose();globalThis.fetch=oldFetch;}
 const f=bridgeFixture(),c=new Comparison({config:{gravity:false,right:'openai',pieceCap:3},providerFactory:(key,config)=>key==='openai'?f.bridge:providerFor(key,config)});
 try{for(let n=0;n<3;n++)await c.step();const json=c.exportRun(),v=verifyDecisionUIRecord(json);assert.deepEqual(v.outcomes,['capped','capped']);c.replay();c.pause();await c.step();assert.equal(c.exportRun(),json);}finally{c.dispose();await f.bridge.close();}
 const g=bridgeFixture(),v=new HumanVersus({pieceCap:3,providerFactory:()=>g.bridge});
 try{for(let n=0;n<3;n++)await v.stepAlgorithm();v.start();for(let n=0;n<3;n++){for(let t=0;t<10;t++)v.tick(16);v.input('drop');}assert.deepEqual(verifyDecisionUIRecord(v.exportRun()).outcomes,['capped','capped']);}finally{v.dispose();await g.bridge.close();}
});

test('human clocks retain ordered per-call arguments including invisible ticks, pause/resume and soft-drop/gravity locks',async()=>{
 const f=bridgeFixture(),v=new HumanVersus({providerFactory:()=>f.bridge});
 try{
  await v.stepAlgorithm();v.start();v.tick(20);v.tick(30);v.input('left');v.tick(250);v.tick(250);v.tick(250);v.pause();v.start();
  for(let n=0;n<22;n++)v.input('down');for(let n=0;n<100;n++)v.tick(250);v.stop();
  const json=v.exportRun(),record=JSON.parse(json);assert.equal(verifyDecisionUIRecord(json).ok,true);const clocks=record.events.filter(e=>e.input.kind==='ticks');assert(clocks.some(e=>e.input.elapsedMs.length>1));assert.deepEqual(clocks[0].input.elapsedMs,[20,30]);assert(record.events.some(e=>e.input.action==='down'));
 }finally{v.dispose();await f.bridge.close();}
});

test('actual solo exporter tamper matrix rejects changes to facts, binding, ordering, paths, finals, schema and unknown/private fields',async()=>{
 const {$,mounted}=mountedSolo();try{
  await $('h-step').trigger('click');await $('h-step').trigger('click');const original=JSON.parse(mounted.exportRun()),placement=original.events.findIndex(e=>e.input.kind==='computer');
  const mutations=[r=>r.version='future',r=>r.rulesVersion='other',r=>r.schemas.candidate++,r=>r.objective.targetLines=301,r=>r.pieceCap=0,r=>r.events[placement].observation.board[19]='I.........',r=>r.events[placement].observation.score++,r=>r.events[placement].observation.lines++,r=>r.events[placement].observation.level++,r=>r.events[placement].pieces++,r=>r.events[placement].observation.active.x++,r=>r.events[placement].input.path=['left','drop'],r=>r.events[placement].input.cells[0].x++,r=>r.events[placement].input.orientation=3,r=>r.events[placement].input.selectedCandidateId='foreign:1:0',r=>r.events[placement].input.requestId='foreign:1:1',r=>r.events[placement].input.revision++,r=>r.events[placement].observation.next[0]='O',r=>r.events.reverse(),r=>r.events.splice(placement,1),r=>r.finals[0].outcome='won',r=>r.finals[0].censored=false,r=>r.finals[0].pieces++,r=>r.events.push(clone(r.events.at(-1))),r=>r.lanes[0].policy.secret='private',r=>r.metadata.accounting={capability:'private'},r=>r.events[placement].input.path=Array(801).fill('left'),r=>r.assurance='unconditional'];
  for(const [n,mutation]of mutations.entries()){const r=clone(original);mutation(r);assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(r)),`mutation ${n}`);}
 }finally{mounted.dispose();}
});

test('clock tampering, vectors crossing locks and post-cap actions fail while a retained archive prefix verifies',async()=>{
 const f=bridgeFixture(),v=new HumanVersus({pieceCap:1,providerFactory:()=>f.bridge});
 try{
  await v.stepAlgorithm();v.start();v.tick(20);v.tick(30);v.input('drop');const r=JSON.parse(v.exportRun()),at=r.events.findIndex(e=>e.input.kind==='ticks');
  for(const ms of [[251],[-1],[NaN],[20],[20,31],Array(257).fill(1)]){const x=clone(r);x.events[at].input.elapsedMs=ms;assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(x)));}
  const x=clone(r),last=clone(x.events.at(-1));last.seq=x.events.length;x.events.push(last);assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(x)),/terminal/);
 }finally{v.dispose();await f.bridge.close();}
 let journal;const controller=new Controller({onTransition:({input,view})=>{if(!journal.incomplete||!['pause','stop'].includes(input.kind))journal.append(0,input,view);}});journal=new DecisionJournal({mode:'solo',eventLimit:2});journal.addLane(0,'computer',controller.view,providerPolicy(heuristic()));await controller.step();const before=controller.view.observation;await controller.step();assert.equal(journal.incomplete,true);assert.deepEqual(controller.view.observation,before);assert.equal(verifyDecisionUIRecord(journal.exportRun()).archiveIncomplete,true);
});

test('bounded exact clock vectors preserve a full >750-placement Marathon export within existing limits',async()=>{
 // Real versus exporter plus canonical manual events; cap stops the AI after one decision.
 const f=bridgeFixture(),v=new HumanVersus({pieceCap:1000,providerFactory:()=>f.bridge});
 try{
  // Keep a deterministic safe manual board using the same public heuristic routes.
  await v.stepAlgorithm();v.start();const local=heuristic();
  for(let n=0;n<1000;n++){
   for(let k=0;k<10;k++)v.tick(1); // Many exact invisible clock calls, with a bounded total per placement
   const obs=v.view.lanes[0].observation;
   const {enumerate,candidateEvidence}=await import('../public/harness.mjs');const {start,createGame}=await import('../public/engine.mjs');
   // Obtain the canonical selected route from public state only. No hidden queue is needed for geometry.
   const s={...start(createGame()),board:obs.board.map(r=>[...r]),active:{type:obs.active.type,rotation:obs.active.rotation,x:obs.active.x,y:obs.active.y},queue:[...obs.next,'I'],score:obs.score,lines:obs.lines,level:obs.level,gravityElapsed:obs.gravityElapsedMs,status:'playing'};
   const binding={sessionId:obs.sessionId,revision:obs.revision},candidates=enumerate(s,binding),evidence=candidates.map(c=>candidateEvidence(s,c,binding)),choice=await local.decide({requestId:'test',stateRevision:obs.revision,candidates:evidence});
   const chosen=candidates.find(c=>c.id===choice.selectedCandidateId);for(const action of chosen.path)v.input(({clockwise:'rotate',drop:'drop',left:'left',right:'right',down:'down'})[action]);
   if(v.view.lanes[0].outcome)break;
  }
  v.pause();const record=JSON.parse(v.exportRun());assert(v.view.lanes[0].pieces>750);assert.equal(v.view.lanes[0].status,'won');const human=record.events.filter(e=>e.lane===0),last=human.at(-1),before=human.at(-2);assert.deepEqual(last.observation.next,before.observation.next);assert.equal(last.observation.active,null);assert(last.observation.lines>=300);assert(record.events.length<50000);assert(Buffer.byteLength(v.exportRun())<64*1024*1024);assert.equal(verifyDecisionUIRecord(v.exportRun()).ok,true);
 }finally{v.dispose();await f.bridge.close();}
});

test('Node CLI hashes exact saved bytes, preserves bad input and reports explicit legacy assurance',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'decision-verify-'));try{const file=path.join(directory,'record.json'),json=decisionRecord({mode:'solo',policies:[],frames:[],finals:[],reasons:[]});await writeFile(file,json);assert.equal(verifyDecisionUIRecord(json).assurance,'legacy-visual-only');await assert.rejects(promisify(execFile)(process.execPath,['verify-decision-record.mjs',file]),e=>e.code===2&&JSON.parse(e.stdout).sha256.length===64);assert.equal(await readFile(file,'utf8'),json);await writeFile(file,'{bad');await assert.rejects(promisify(execFile)(process.execPath,['verify-decision-record.mjs',file]),e=>e.code===1&&/invalid JSON/.test(e.stderr));assert.equal(await readFile(file,'utf8'),'{bad');}finally{await rm(directory,{recursive:true,force:true});}
});

test('comparison samples share one canonical event budget and preserve a verifiable censored prefix',async()=>{
 const f=bridgeFixture(),c=new Comparison({config:{gravity:false,left:'local',right:'openai',samples:2,pieceCap:1},providerFactory:(key,settings)=>key==='openai'?f.bridge:providerFor(key,settings)});
 try{
  for(let n=0;n<1997;n++)c.pause();await c.step();await c.step();
  const record=JSON.parse(c.exportRun());assert.equal(record.version,'decision-ui-comparison-series-1');
  assert(record.records.reduce((n,r)=>n+r.events.length,0)<=4000);assert(c.view.archiveError);assert.equal(c.view.auto,false);assert.equal(f.calls,1);
  const verified=verifyDecisionUIRecord(JSON.stringify(record));assert.equal(verified.archiveIncomplete,true);assert.equal(verified.samples,2);
 }finally{c.dispose();await f.bridge.close();}
});

test('comparison series reject sessions reused on the opposite lane',async()=>{
 const f=bridgeFixture(),c=new Comparison({config:{gravity:false,left:'local',right:'openai',pieceCap:1},providerFactory:(key,settings)=>key==='openai'?f.bridge:providerFor(key,settings)});
 try{
  await c.step();const first=JSON.parse(c.exportRun()),mirrored=clone(first);
  mirrored.lanes.reverse().forEach((l,i)=>l.id=i);mirrored.events.forEach(e=>e.lane=1-e.lane);mirrored.finals.reverse().forEach((f,i)=>f.lane=i);
  assert.equal(verifyDecisionUIRecord(JSON.stringify(mirrored)).ok,true);
  assert.throws(()=>verifyDecisionUIRecord(JSON.stringify({version:'decision-ui-comparison-series-1',plannedSamples:2,records:[first,mirrored]})),/session reuse/);
 }finally{c.dispose();await f.bridge.close();}
});
