import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, realpath, readFile, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDecisionStore } from '../decision-store.mjs';
import { createDecisionService, canonicalPacket } from '../decision-service.mjs';
import { createDecisionHandler } from '../decision-http.mjs';
import { createDecisionBridge } from '../public/decision-bridge.mjs';
import { Controller } from '../public/controller.mjs';
import { createGame, start } from '../public/engine.mjs';
import { observe, enumerate, candidateEvidence } from '../public/harness.mjs';
import { instructionPacket } from '../public/briefing.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
function packet(base='controller',epoch=0) {
  const state=start(createGame()), binding={sessionId:`${base}-${epoch}`,revision:1};
  return instructionPacket(observe(state,binding),enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),{requestId:`${base}-${epoch}:1:1`,deadlineMs:2000});
}
function answer(request) { const ids=request.body.questions[0].choices.map(c=>c.value); return {status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,i)=>({value,probability:i?0:1}))}]}}; }
async function fixture(t,{transport, maxAttempts=4, timeoutMs=1000, faultInjection}={}) {
  const directory=await mkdtemp(path.join(await realpath(os.tmpdir()),'decision-test-'));
  const policy={maxAttempts,maxInputTokens:20000000,maxEstimatedMicros:10000000,expiresAt:Date.now()+60000,maxRuns:8,maxEpochs:8,maxPlacements:1000,timeoutMs,reservationTokens:1049600,reservationMicros:1000};
  const store=await openDecisionStore({directory,lineage:'offline-test',policy,enroll:true,faultInjection});
  let calls=0, aborted=0;
  const fake=Object.assign(async(request,options)=>{calls++; options.signal.addEventListener('abort',()=>aborted++,{once:true}); return transport?transport(request,options):answer(request);},{mode:'fixture'});
  const service=createDecisionService({enabled:true,store,policy,transport:fake});
  const server=http.createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`, handler=createDecisionHandler({service,host,origin});
  server.on('request',async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});
  const grant=await service.owner.issueRun({laneId:'one',controllerSessionBase:'controller'});
  const fetchImpl=(route,options={})=>fetch(`${origin}${route}`,{...options,headers:{origin,...options.headers}});
  const bridge=createDecisionBridge({grant,fetchImpl});
  t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return {directory,policy,store,service,server,grant,bridge,fetchImpl,host,origin,get calls(){return calls;},get aborted(){return aborted;}};
}
test('actual HTTP: complete healthy body remains alive during slow native response and Controller commits twice',async t=>{
  const f=await fixture(t,{transport:async req=>{await wait(40);return answer(req);}});
  const controller=new Controller({provider:f.bridge,sessionId:'controller',deadlineMs:2000});
  assert.ok(await controller.step()); assert.ok(await controller.step());
  assert.equal(controller.view.pieces,2); assert.equal(f.calls,2); assert.equal(f.bridge.lastReceipt.mode,'http-fixture');
  const ledger=await readFile(path.join(f.directory,'ledger.json'),'utf8'); assert.ok(!ledger.includes(f.grant.capability));
});
test('actual HTTP: real socket disconnect aborts owned upstream; ambiguous reservation is retained',async t=>{
  let started;const began=new Promise(r=>started=r);
  const f=await fixture(t,{transport:async(req,{signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return answer(req);}});
  const req=http.request(`${f.origin}/decision/choice`,{method:'POST',headers:{origin:f.origin,'content-type':'application/json','x-decision-capability':f.grant.capability}});
  req.on('error',()=>{});req.end(JSON.stringify({packet:packet()}));await began;req.destroy();
  for(let n=0;n<30&&!f.aborted;n++)await wait(5);
  assert.equal(f.aborted,1);assert.equal(f.store.snapshot().used.attempts,1);
  for(let n=0;n<500&&Object.values(f.store.snapshot().requests)[0].status!=='uncertain';n++)await wait(2);
  assert.equal(Object.values(f.store.snapshot().requests)[0].status,'uncertain');
});
test('canonical reconstruction rejects evidence/path/briefing/active/rules/candidate omission and unknown fields',()=>{
  const p=packet();assert.deepEqual(canonicalPacket(p),p);
  for(const alter of [p=>p.candidates.pop(),p=>p.candidates[0].path=['right','drop'],p=>p.rulesBrief.instructions.push('cheat'),p=>p.observation.active.x++,p=>p.extra=true,p=>p.objective='endless']) {
    const copy=structuredClone(p);alter(copy);assert.throws(()=>canonicalPacket(copy));
  }
});
test('actual HTTP: default off, boundary rejection, owner capability, duplicates/collision, atomic shared final allowance',async t=>{
  assert.equal(createDecisionService().status().available,false);
  const f=await fixture(t,{maxAttempts:1});
  const p=packet();
  const send=(route,options)=>f.fetchImpl(route,options);
  assert.equal((await send('/decision/status')).status,200);
  assert.equal((await send('/decision/choice',{method:'GET'})).status,405);
  assert.equal((await send('/decision/choice',{method:'POST',headers:{'content-type':'text/plain'}})).status,415);
  assert.equal((await send('/decision/choice',{method:'POST',headers:{origin:'http://evil','content-type':'application/json'}})).status,403);
  assert.equal((await send('/decision/choice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packet:p})})).status,403);
  const other=await f.service.owner.issueRun({laneId:'two',controllerSessionBase:'other'});
  const outcomes=await Promise.allSettled([f.service.decide(f.grant.capability,p),f.service.decide(other.capability,packet('other'))]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls,1);assert.equal(f.store.snapshot().used.attempts,1);
  await assert.rejects(f.service.decide(f.grant.capability,p),{code:'duplicate'});
  const changed=structuredClone(p);changed.deadlineMs=1999;await assert.rejects(f.service.decide(f.grant.capability,changed),{code:'collision'});
  assert.equal(Object.values(f.store.snapshot().requests).filter(r=>r.status==='completed').length,1);
});
test('actual HTTP: Reset immediately advances epoch and fences abort-ignoring old result/receipt without refilling cap',async t=>{
  let first, count=0;const f=await fixture(t,{transport:async req=>{if(++count===1)await new Promise(r=>first=r);return answer(req);}});
  const controller=new Controller({provider:f.bridge,sessionId:'controller',deadlineMs:2000});
  const old=controller.step();while(!first)await wait(2);
  controller.reset();const fresh=controller.step();await wait(15);first();
  await old;assert.ok(await fresh);assert.equal(controller.view.pieces,1);assert.equal(controller.view.observation.sessionId,'controller-1');
  assert.equal(f.bridge.lastReceipt.requestId,'controller-1:1:2');assert.equal(f.store.snapshot().used.attempts,2);
});
test('deadline includes preparation; cancellation never falls back, retries or commits',async t=>{
  // Thirty milliseconds can expire before dispatch under concurrent canonical/IO work.
  // Observe rejection immediately and do not require an upstream entry to occur.
  const f=await fixture(t,{timeoutMs:30,transport:async(req,{signal})=>{
    if(!signal.aborted)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return answer(req);
  }});
  await assert.rejects(f.service.decide(f.grant.capability,packet()),{code:'cancelled'});
  assert.ok(f.calls<=1);assert.equal(f.store.snapshot().runs[f.grant.runId].placements,0);
  assert.ok(f.store.snapshot().used.attempts>=f.calls);assert.ok(f.store.snapshot().used.attempts<=1);
  const requests=Object.values(f.store.snapshot().requests);
  if(f.calls)assert.equal(requests[0].status,'uncertain');else if(requests.length)assert.equal(requests[0].status,'rejected');
});
test('gated dispatched request rejects overlap and abort retains ambiguous reservation without late commit',async t=>{
  let release;const abort=new AbortController();
  const f=await fixture(t,{transport:async req=>{await new Promise(r=>release=r);return answer(req);}});
  const p=packet(),promise=f.service.decide(f.grant.capability,p,{signal:abort.signal});
  const rejected=assert.rejects(promise,{code:'cancelled'});
  try {
    for(let n=0;n<500&&!release;n++)await wait(1);assert.ok(release,'transport entered within fixture bound');
    await assert.rejects(f.service.decide(f.grant.capability,p),{code:'overlap'});
    abort.abort();await rejected;assert.equal(f.calls,1);assert.equal(f.store.snapshot().used.attempts,1);
    assert.equal(Object.values(f.store.snapshot().requests)[0].status,'uncertain');
    const again=structuredClone(p);again.requestId='new-id-after-abort';again.responseSchema.properties.requestId.const=again.requestId;
    await assert.rejects(f.service.decide(f.grant.capability,again),{code:'unauthorized'});
  } finally {abort.abort();release?.();await rejected;await wait(1);}
  assert.equal(f.store.snapshot().runs[f.grant.runId].placements,0);assert.equal(f.calls,1);
});
test('private ledger retains aggregate on clean reopen and fails closed on unresolved dispatch and second lifetime owner',async t=>{
  const f=await fixture(t);await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'EEXIST'});
  await f.service.decide(f.grant.capability,packet());await f.service.close();
  const reopened=await openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy});assert.equal(reopened.snapshot().used.attempts,1);
  await reopened.transact(s=>{s.requests.unresolved={status:'dispatch-intent'};});await reopened.close();
  await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'reconciliation_required'});
});
test('owner qualification is fail-closed; hosted activation unsupported and immutable policy cannot be raised',async t=>{
 const f=await fixture(t,{maxAttempts:1});
 const unavailable=createDecisionService({enabled:true,store:f.store,policy:f.policy,qualification:{kind:'owner-qualified-live-v1'},credential:'fixture-placeholder-never-used'});
 assert.deepEqual(unavailable.status(),{available:false,reason:'qualification_required'});
 assert.equal(createDecisionService({enabled:true,store:f.store,policy:f.policy,transport:Object.assign(()=>{}, {mode:'fixture'}),hosted:true}).status().available,false);
 f.policy.maxAttempts=999;
 await f.service.decide(f.grant.capability,packet());
 // Store binds a cloned immutable policy; caller mutation cannot increase its limits.
 await assert.rejects(f.service.owner.issueRun({laneId:'three',controllerSessionBase:'third'}),{code:'limit'});
});
test('shutdown refuses to report drain or release lifetime lock while injected upstream ignores cancellation',async t=>{
 let release;const f=await fixture(t,{transport:async req=>{await new Promise(r=>release=r);return answer(req);}});
 const request=f.service.decide(f.grant.capability,packet());while(!release)await wait(1);
 const rejected=assert.rejects(request,{code:'cancelled'});
 await assert.rejects(f.service.close(),{code:'drain_pending'});await rejected;
 await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'EEXIST'});
 release();await wait(5);await f.service.close();
});
test('durable write failures before reserve/intent/result and after rename fail closed without duplicate dispatch',async t=>{
 for(const status of ['reserved','dispatch-intent','completed']) {
  await t.test(status,async t=>{
   const faultInjection=Object.assign((stage,next)=>{if(stage==='before-rename'&&Object.values(next.requests).some(r=>r.status===status))throw new Error('injected filesystem failure');},{mode:'fixture'});
   const f=await fixture(t,{faultInjection});
   await assert.rejects(f.service.decide(f.grant.capability,packet()),{code:'store_unavailable'});
   assert.equal(f.calls,status==='completed'?1:0);assert.equal(f.service.status().available,false);
   await assert.rejects(f.service.decide(f.grant.capability,packet()));assert.equal(f.calls,status==='completed'?1:0);
  });
 }
 await t.test('after durable rename',async t=>{
  const faultInjection=Object.assign((stage,next)=>{if(stage==='after-rename'&&Object.values(next.requests).some(r=>r.status==='dispatch-intent'))throw new Error('injected directory fsync failure');},{mode:'fixture'});
  const f=await fixture(t,{faultInjection});await assert.rejects(f.service.decide(f.grant.capability,packet()),{code:'store_unavailable'});assert.equal(f.calls,0);
  await f.service.close();await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'reconciliation_required'});
 });
});
test('missing enrolled ledger cannot be silently recreated; permissions and symlinks are rejected',async t=>{
 const f=await fixture(t);await f.service.close();
 await chmod(f.directory,0o755);await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'unsafe_store'});await chmod(f.directory,0o700);
 const link=f.directory+'-link';await symlink(f.directory,link);try { await assert.rejects(openDecisionStore({directory:link,lineage:'offline-test',policy:f.policy}),{code:'unsafe_store'}); } finally { await rm(link); }
 await rm(path.join(f.directory,'ledger.json'));
 await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy}),{code:'ENOENT'});
 await assert.rejects(openDecisionStore({directory:f.directory,lineage:'offline-test',policy:f.policy,enroll:true}),{code:'EEXIST'});
});
test('sanitized provider failures never execute a Controller move or retry',async t=>{
 for(const kind of ['auth','rate','server','refusal','schema','model','oversize']) {
  await t.test(kind,async t=>{
   const f=await fixture(t,{transport:async req=>{
    const result=answer(req);
    if(kind==='auth')result.status=401;if(kind==='rate')result.status=429;if(kind==='server')result.status=503;
    if(kind==='refusal')result.body.answers[0].type='refusal';if(kind==='schema')result.body.answers[0].choice='unknown';
    if(kind==='model')result.body.model='wrong';if(kind==='oversize')result.body.padding='x'.repeat(65536);
    return result;
   }});
   const controller=new Controller({provider:f.bridge,sessionId:'controller',deadlineMs:2000});assert.equal(await controller.step(),null);
   assert.equal(controller.view.pieces,0);assert.equal(f.calls,1);assert.equal(f.store.snapshot().used.attempts,1);assert.equal(f.bridge.lastReceipt,null);
  });
 }
});
test('known terminal Marathon overshoot closes its lane durably; old grant cannot resume or dispatch',async t=>{
 const f=await fixture(t,{transport:async req=>{
  const result=answer(req), semantic=JSON.parse(req.body.input), winner=semantic.candidates.find(c=>c.afterstate.status==='won');assert.ok(winner);
  result.body.answers[0].choice=winner.id;result.body.answers[0].probabilities=req.body.questions[0].choices.map(({value})=>({value,probability:value===winner.id?1:0}));return result;
 }});
 const state=start(createGame(2));state.lines=299;state.level=30;state.score=1234;state.active={type:'I',rotation:1,x:3,y:0};
 for(let y=16;y<20;y++)state.board[y]=Array.from({length:10},(_,x)=>x===5?null:'J');
 const binding={sessionId:'controller-0',revision:1};
 const p=instructionPacket(observe(state,binding),enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),{requestId:'terminal-choice',deadlineMs:2000});
 const result=await f.service.decide(f.grant.capability,p),selected=p.candidates.find(c=>c.id===result.choice.selectedCandidateId);
 assert.equal(selected.afterstate.lines,303);assert.equal(selected.afterstate.level,30);assert.equal(selected.afterstate.score,25234);assert.equal(selected.afterstate.active,null);assert.deepEqual(selected.afterstate.next,p.observation.next);
 assert.equal(f.store.snapshot().runs[f.grant.runId].terminal,true);
 await assert.rejects(f.service.decide(f.grant.capability,p),{code:'unauthorized'});await assert.rejects(f.service.control(f.grant.capability,'advanceEpoch',0),{code:'epoch'});assert.equal(f.calls,1);
 await f.service.control(f.grant.capability,'advanceEpoch',1);assert.equal(f.store.snapshot().runs[f.grant.runId].terminal,false);assert.equal(f.store.snapshot().used.attempts,1);
});
test('expired capability and changed state/revision cannot dispatch; post-delivery cancellation requires Reset recovery',async t=>{
 const f=await fixture(t);await f.service.decide(f.grant.capability,packet());
 const changed=structuredClone(packet());changed.requestId='different-request';changed.responseSchema.properties.requestId.const=changed.requestId;
 await assert.rejects(f.service.decide(f.grant.capability,changed),{code:'continuity'});assert.equal(f.calls,1);
 await f.service.control(f.grant.capability,'advanceEpoch',1);await f.service.decide(f.grant.capability,packet('controller',1));assert.equal(f.calls,2);
 await f.store.transact(s=>{s.runs[f.grant.runId].expiresAt=Date.now()-1;});await assert.rejects(f.service.decide(f.grant.capability,packet('controller',1)),{code:'unauthorized'});assert.equal(f.calls,2);
});
test('actual raw HTTP rejects wrong Host, duplicate critical raw headers, malformed JSON and chunked oversize before dispatch',async t=>{
 const f=await fixture(t);
 const raw=(headers,body)=>new Promise((resolve,reject)=>{
  const req=http.request(f.origin+'/decision/choice',{method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',e=>e.code==='ECONNRESET'?resolve('reset'):reject(e));req.end(body);
 });
 const headers={origin:f.origin,'content-type':'application/json','x-decision-capability':f.grant.capability};
 assert.equal(await raw({...headers,host:'evil:123'},'{}'),403);
 assert.equal(await raw(['Host',f.host,'Origin',f.origin,'Origin',f.origin,'Content-Type','application/json'],'{}'),400);
 assert.equal(await raw(headers,'{bad'),400);
 // No content-length: Node sends this explicit transfer-encoding request as chunked.
 const oversized=await raw({...headers,'transfer-encoding':'chunked'},'x'.repeat(1048577));assert.ok([413,'reset'].includes(oversized));assert.equal(f.calls,0);
});
test('canonical single legal option selects locally with no upstream attempt and preserves terminal fence',async t=>{
 const f=await fixture(t);
 const state=start(createGame());state.board=Array.from({length:20},()=>Array.from({length:10},(_,x)=>x<2?null:'J'));state.active={type:'O',rotation:0,x:0,y:0};
 const binding={sessionId:'controller-0',revision:1},raw=enumerate(state,binding);assert.equal(raw.length,1);
 const p=instructionPacket(observe(state,binding),raw.map(c=>candidateEvidence(state,c,binding)),{requestId:'single-native',deadlineMs:2000});
 const result=await f.service.decide(f.grant.capability,p);assert.equal(result.receipt.attempts,0);assert.equal(f.calls,0);assert.equal(f.store.snapshot().used.attempts,0);assert.equal(result.choice.selectedCandidateId,p.candidates[0].id);
 await assert.rejects(f.service.decide(f.grant.capability,p));assert.equal(f.calls,0);
});
test('complete candidate ceiling rejects 256 without pruning, and fabricated 255-set fails canonical legality before transport',async t=>{
 const f=await fixture(t),p=packet();
 for(const count of [255,256]) {
  const fake=structuredClone(p);fake.candidates=Array.from({length:count},(_,i)=>({...fake.candidates[0],id:`fabricated-${i}`}));
  await assert.rejects(f.service.decide(f.grant.capability,fake),{code:count===256?'unsupported_candidates':'input'});assert.equal(f.calls,0);
 }
});
test('actual HTTP: two Resets before Step reconcile and advance sequential exact-next epochs without refilling allowance',async t=>{
 const f=await fixture(t),controls=[];
 const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,options)=>{
  if(route==='/decision/control')controls.push(JSON.parse(options.body));
  return f.fetchImpl(route,options);
 }});
 const controller=new Controller({provider:bridge,sessionId:'controller',deadlineMs:2000});
 controller.reset();controller.reset();assert.equal(f.calls,0);
 const before=f.store.snapshot().used;assert.deepEqual(before,{attempts:0,inputTokens:0,estimatedMicros:0});
 assert.ok(await controller.step());assert.equal(controller.view.observation.sessionId,'controller-2');assert.equal(controller.view.pieces,1);
 assert.deepEqual(controls,[{action:'currentEpoch'},{action:'advanceEpoch',epoch:1},{action:'advanceEpoch',epoch:2}]);
 assert.equal(f.store.snapshot().runs[f.grant.runId].epoch,2);assert.equal(f.store.snapshot().used.attempts,1);assert.equal(f.calls,1);assert.equal(bridge.lastReceipt.epoch,2);
});
test('actual HTTP: committed advance with lost or aborted reply recovers on explicit Reset without decision retry',async t=>{
 for(const kind of ['lost','aborted'])await t.test(kind,async t=>{
  const f=await fixture(t),controls=[];let dropped=false,controller;
  const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,options)=>{
   const body=route==='/decision/control'?JSON.parse(options.body):null;if(body)controls.push(body);
   const response=await f.fetchImpl(route,options);
   if(body?.action==='advanceEpoch'&&!dropped){
    dropped=true;await response.arrayBuffer(); // Real HTTP response confirms the durable advance already committed.
    if(kind==='aborted')controller.pause();
    throw Object.assign(new Error('injected lost control delivery'),{name:kind==='aborted'?'AbortError':'Error'});
   }
   return response;
  }});
  controller=new Controller({provider:bridge,sessionId:'controller',deadlineMs:2000});controller.reset();
  assert.equal(await controller.step(),null);assert.equal(f.store.snapshot().runs[f.grant.runId].epoch,1);
  assert.equal(f.calls,0);assert.deepEqual(f.store.snapshot().used,{attempts:0,inputTokens:0,estimatedMicros:0});assert.equal(bridge.lastReceipt,null);
  controller.reset();assert.ok(await controller.step());assert.equal(controller.view.pieces,1);assert.equal(controller.view.observation.sessionId,'controller-2');
  assert.equal(f.calls,1);assert.equal(f.store.snapshot().used.attempts,1);assert.equal(bridge.lastReceipt.epoch,2);
  assert.deepEqual(controls,[{action:'currentEpoch'},{action:'advanceEpoch',epoch:1},{action:'currentEpoch'},{action:'advanceEpoch',epoch:2}]);
 });
});
test('authenticated epoch reconciliation is read-only, bounded, and cannot abort current work or enroll a run',async t=>{
 let release,upstreamSignal;const f=await fixture(t,{transport:async(req,{signal})=>{upstreamSignal=signal;await new Promise(r=>release=r);return answer(req);}});
 const pending=f.service.decide(f.grant.capability,packet());while(!release)await wait(1);
 const before=f.store.snapshot(),bytes=await readFile(path.join(f.directory,'ledger.json'),'utf8');
 const metadata=await f.service.control(f.grant.capability,'currentEpoch');assert.deepEqual(metadata,{epoch:0,maxEpochs:8});
 assert.deepEqual(f.store.snapshot(),before);assert.equal(await readFile(path.join(f.directory,'ledger.json'),'utf8'),bytes);assert.equal(upstreamSignal.aborted,false);
 await assert.rejects(f.service.control('0'.repeat(64),'currentEpoch'),{code:'unauthorized'});
 await assert.rejects(f.service.control(f.grant.capability,'currentEpoch',1),{code:'input'});assert.equal(upstreamSignal.aborted,false);
 release();await pending;
 const controller=new Controller({provider:f.bridge,sessionId:'controller',deadlineMs:2000});for(let i=0;i<8;i++)controller.reset();
 assert.equal(await controller.step(),null);assert.equal(f.store.snapshot().runs[f.grant.runId].epoch,0);assert.equal(f.calls,1);assert.equal(f.store.snapshot().used.attempts,1);
});
test('actual HTTP: lost advance reply also recovers on the next explicit Step in the same UI epoch',async t=>{
 const f=await fixture(t);let lost=false;const actions=[];
 const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,options)=>{
  const body=route==='/decision/control'?JSON.parse(options.body):null;if(body)actions.push(body);
  const response=await f.fetchImpl(route,options);
  if(body?.action==='advanceEpoch'&&!lost){lost=true;await response.arrayBuffer();throw new Error('injected lost reply');}return response;
 }});
 const controller=new Controller({provider:bridge,sessionId:'controller',deadlineMs:2000});controller.reset();
 assert.equal(await controller.step(),null);assert.equal(f.calls,0);assert.equal(f.store.snapshot().used.attempts,0);
 assert.ok(await controller.step());assert.equal(f.calls,1);assert.equal(controller.view.pieces,1);
 assert.deepEqual(actions,[{action:'currentEpoch'},{action:'advanceEpoch',epoch:1},{action:'currentEpoch'}]);assert.equal(bridge.lastReceipt.epoch,1);
});
test('actual HTTP: cancelled late epoch read cannot rewind a newer decision epoch or overwrite its receipt',async t=>{
 const f=await fixture(t);let release,held=false;
 const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,options)=>{
  const body=route==='/decision/control'?JSON.parse(options.body):null;
  const response=await f.fetchImpl(route,options);
  if(body?.action==='currentEpoch'&&!held){held=true;const text=await response.text();await new Promise(r=>release=r);return new Response(text,{status:200});}
  return response;
 }});
 const controller=new Controller({provider:bridge,sessionId:'controller',deadlineMs:2000});
 const old=controller.step();while(!release)await wait(1);controller.reset();assert.ok(await controller.step());
 const receipt=bridge.lastReceipt;release();assert.equal(await old,null);assert.equal(bridge.lastReceipt,receipt);
 assert.equal(receipt.epoch,1);assert.equal(controller.view.pieces,1);assert.ok(await controller.step());assert.equal(f.calls,2);assert.equal(bridge.lastReceipt.epoch,1);
});

test('authenticated status and compact receipt preserve actual dated model identity separately from requested alias',async t=>{
 const f=await fixture(t,{transport:async req=>{const result=answer(req);result.body.model='gpt-6-luna-2026-10-01';return result;}});
 const c=new Controller({provider:f.bridge,sessionId:'controller',deadlineMs:2000});assert.ok(await c.step());
 assert.equal(f.bridge.lastReceipt.requestedModel,'gpt-6-luna');assert.equal(f.bridge.lastReceipt.observedModel,'gpt-6-luna-2026-10-01');
 assert.equal((await f.bridge.status()).observedModel,'gpt-6-luna-2026-10-01');assert.ok(Buffer.byteLength(JSON.stringify(f.bridge.lastReceipt))<=4096);
});
