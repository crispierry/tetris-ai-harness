import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,realpath,chmod,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDecisionStore,digest} from '../decision-store.mjs';
import {qualifiedDecisionBrowser} from '../decision-browser-qualification.mjs';
import {createDecisionBrowserService} from '../decision-browser-service.mjs';
import {bootstrapBrowserDecisionService,DEFAULT_BROWSER_DECISION_KEY_FILE} from '../decision-browser-bootstrap.mjs';
import {decisionStartupMode,bootstrapLiveDecisionService} from '../decision-bootstrap.mjs';
import {createDecisionOwner} from '../decision-owner.mjs';
import {createDecisionHandler} from '../decision-http.mjs';
import {createDecisionBridge} from '../public/decision-bridge.mjs';
import {Controller,heuristic} from '../public/controller.mjs';
import {DecisionJournal} from '../public/decision-record.mjs';
import {mountComparison} from '../public/comparison-ui.mjs';
import {DEFAULT_CONFIG} from '../public/comparison.mjs';
import {Comparison,providerFor} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountVersus} from '../public/versus-ui.mjs';
import {providerPolicy} from '../public/provider-policy.mjs';
import {providerProvenance} from '../public/provider-provenance.mjs';
import {browserStatus,connectionSummary} from '../public/decision-session.mjs';
import {BROWSER_BUDGET_LINE,validBrowserAccounting} from '../public/browser-risk-contract.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
const dummy='dummy_browser_key_for_offline_tests_only',fingerprint=createHash('sha256').update(dummy).digest('hex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function config(now=Date.now()){
 const qualification={kind:'owner-risk-accepted-decisions-browser-1',model:'gpt-6-luna',endpoint:'https://api.openai.com/v1/decisions',method:'POST',requestSchema:'decisions-create-fixed-1',maxBodyBytes:1048576,maxResponseBytes:65536,activationStartedAt:now,riskAcceptance:{acceptedBy:'Cris',acceptedAt:now,evidenceReference:'dummy approval',riskCode:'unquantified-project-hard-limit-enforcement-delay'},projectEvidence:{projectId:'proj_dummy_browser',keyFingerprint:fingerprint,keyProjectBindingVerified:true,thresholdAmountCents:100,currency:'USD',interval:'month',enforcementStatus:'enforcing',checkedAt:now,evidenceReference:'dummy private project evidence',keyExpiresAt:now+7200000}};
 const policy={kind:'risk-accepted-project-browser-policy-1',qualificationDigest:digest(qualification),maxAttempts:1000,maxRuns:64,maxEpochs:100,maxPlacements:1000,maxConcurrentUpstream:1,timeoutMs:1500,expiresAt:now+3600000,retryLimit:0,fallback:'none'};return {qualification,policy};
}
async function directory(t){const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'browser-risk-dummy-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function upstream({status=200,usage={input_tokens:100,output_tokens:0,total_tokens:100},hold,inspect,refusal=false,errorCode='insufficient_quota'}={}){return async(url,options)=>{inspect?.(url,options);if(hold)await hold();const body=JSON.parse(options.body),ids=body.questions[0].choices.map(x=>x.value);return new Response(JSON.stringify(status===429?{error:{code:errorCode}}:{model:'gpt-6-luna',answers:[refusal?{name:'placement',type:'refusal'}:{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,n)=>({value,probability:n?0:1}))}],usage}),{status});};}
async function fixture(t,{fetchImpl=upstream(),configuration=config(),httpServer=false}={}){
 const root=await directory(t),store=await openDecisionStore({directory:path.join(root,'ledger'),lineage:'dummy-browser',policy:configuration.policy,enroll:true}),service=await createDecisionBrowserService({store,...configuration,credential:dummy,fetchImpl});
 const grant=await service.owner.issueRun({laneId:'solo',controllerSessionBase:'browser'});grant.admission;const admitted={...grant,admission:await service.control(grant.capability,'runStatus')};let server,owner,origin;
 if(httpServer){owner=createDecisionOwner({service});server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const host=`127.0.0.1:${server.address().port}`;origin=`http://${host}`;server.on('request',createDecisionHandler({service,owner,host,origin}));}
 const fetchHTTP=httpServer?(route,options={})=>fetch(origin+route,{...options,headers:{origin,...options.headers}}):async(route,options)=>{const b=JSON.parse(options.body),cap=options.headers['x-decision-capability'];try{return new Response(JSON.stringify(route==='/decision/choice'?await service.decide(cap,b.packet,{signal:options.signal}):await service.control(cap,b.action,b.epoch,{requestId:b.requestId})));}catch(e){return new Response(JSON.stringify({error:e.code}),{status:400});}};
 const bridge=createDecisionBridge({grant:admitted,fetchImpl:fetchHTTP});t.after(async()=>{await bridge.close().catch(()=>{});await owner?.close().catch(()=>{});await service.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}});
 return {root,store,service,grant:admitted,bridge,owner,origin,fetchHTTP,...configuration};
}
async function packet(base='browser',epoch=0){let p;const c=new Controller({sessionId:base,gameEpoch:epoch,provider:{...heuristic(),async decide(x){p=x;throw new Error('capture');}}});await c.step();return p;}
async function settle(fn){for(let n=0;n<500;n++){if(fn())return;await wait(2);}throw new Error('dummy condition did not settle');}

test('compact connection copy preserves complete blocking messages and stale accounting',()=>{
 const state={state:'connected',message:'Live OpenAI connected. Full session details.'},accounting={mode:'project-limit-browser',freshness:'current',remainingAttempts:972,expiresAt:Date.now()+60000};
 assert.equal(connectionSummary(state,accounting),'Connected · 972 requests left');
 for(const message of ['OpenAI session expired. No new OpenAI requests will be sent.','OpenAI request interrupted. It may still be billable. Local owner reconciliation is required before more OpenAI play.','Current session counts and billing are unavailable. Previous counts are stale.'])assert.equal(connectionSummary({...state,message},accounting),message);
 for(const changed of [{freshness:'stale'},{ownerHold:true},{remainingAttempts:0},{expiresAt:Date.now()-1}])assert.equal(connectionSummary(state,{...accounting,...changed}),state.message);
});

test('cached page restoration keeps the same grant and counters, authenticates accounting, and never dispatches or re-pairs',async t=>{
 const oldFetch=globalThis.fetch;
 for(const [mode,prefix,mount]of [['solo','h',mountHarness],['comparison','c',mountComparison],['versus','v',mountVersus]]){
  let calls=0,registrations=0,holdRead=false,releaseRead,enteredRead;
  const f=await fixture(t,{httpServer:true,fetchImpl:upstream({inspect:()=>calls++})}),nodes=new Map(),listeners=new Map(),frames=new Map();let serial=0;
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  for(const [k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);
  const win={addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);},requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}};
  const emit=(name,event)=>listeners.get(name)?.forEach(fn=>fn(event));
  globalThis.fetch=async(route,o={})=>{
   if(route.startsWith('http'))return oldFetch(route,o);
   if(holdRead&&route==='/decision/control'&&JSON.parse(o.body).action==='runStatus'){enteredRead();await new Promise(r=>releaseRead=r);}
   const response=await oldFetch(f.origin+route,{...o,headers:{origin:f.origin,...o.headers}});
   if(route==='/decision/pair/register'&&response.ok){registrations++;const challenge=await response.clone().json();await f.owner.command({action:'approve',challengeId:challenge.challengeId,...JSON.parse(o.body)});}
   return response;
  };
  const mounted=mount({getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false,hasFocus:()=>true},{window:win});
  try{
   const select=$(mode==='comparison'?'c-right':prefix+'-provider');select.value='openai';await select.trigger('change');
   await $('decision-pairing').children[1].trigger('click');await $(prefix+'-step').trigger('click');assert.equal(calls,1);
   const before=f.store.snapshot(),json=mounted.exportRun?.()??mounted.runner.exportRun();
   emit('pagehide',{persisted:true});
   assert(Object.values(f.store.snapshot().runs).filter(r=>r.controllerSessionBase!=='browser').every(r=>!r.closed));
   const waiting=new Promise(r=>enteredRead=r);holdRead=true;emit('pageshow',{persisted:true});await waiting;
   assert.equal($(prefix+'-step').disabled,true);assert.match($('decision-pairing').children[2].textContent,/unavailable|stale/);
   holdRead=false;releaseRead();await settle(()=>!$(prefix+'-step').disabled);
   assert.equal(calls,1);assert.equal(registrations,1);assert.deepEqual(f.store.snapshot().used,before.used);
   assert.equal(mounted.exportRun?.()??mounted.runner.exportRun(),json);
   assert.match($('decision-pairing').children[2].textContent,/999 requests left/);
   emit('pagehide',{persisted:true});
   await f.store.transact(s=>{s.browserSession={version:1,ownerHold:true,reconciliationRequired:true,reason:'request_interrupted'};});
   emit('pageshow',{persisted:true});await settle(()=>/request interrupted/.test($('decision-pairing').children[2].textContent));
   assert.equal($(prefix+'-step').disabled,true);assert.equal(calls,1);assert.equal(registrations,1);
  }finally{releaseRead?.();mounted.dispose();globalThis.fetch=oldFetch;}
 }
});

test('browser flags are explicit exclusive and OFF reads no key; qualification/key/expiry/digest mismatches reject',async t=>{
 let loads=0;assert.equal(await bootstrapBrowserDecisionService({args:[],loadCredential:async()=>{loads++;return dummy;}}),null);assert.equal(loads,0);assert(DEFAULT_BROWSER_DECISION_KEY_FILE.endsWith('/openai.browser.env'));
 for(const args of [['--decision-browser-owner'],['--decision-browser-owner','--decision-browser-config=/x','--decision-live-owner'],['--enroll-decision-browser'],['--decision-browser-config=/x'],['--decision-browser-owner','--decision-browser-config=/x','--decision-fixture-owner']])assert.throws(()=>decisionStartupMode(args));
 assert.equal(decisionStartupMode(['--decision-browser-owner','--decision-browser-config=/x']).mode,'browser');assert.equal(await bootstrapLiveDecisionService({args:['--decision-browser-owner','--decision-browser-config=/x'],loadCredential:async()=>{loads++;return dummy;}}),null);assert.equal(loads,0);
 const c=config();assert(qualifiedDecisionBrowser(c.qualification,c.policy));for(const mutate of [x=>x.qualification.projectEvidence.keyExpiresAt=x.policy.expiresAt-1,x=>x.qualification.projectEvidence.checkedAt-=900001,x=>x.qualification.projectEvidence.keyProjectBindingVerified=false,x=>x.qualification.projectEvidence.thresholdAmountCents=200,x=>x.qualification.riskAcceptance.acceptedBy='Other',x=>x.policy.maxAttempts=1001,x=>x.policy.maxConcurrentUpstream=2,x=>x.policy.expiresAt++,x=>x.policy.qualificationDigest='a'.repeat(64)]){const x=structuredClone(c);mutate(x);assert(!qualifiedDecisionBrowser(x.qualification,x.policy));}
 const root=await directory(t);await assert.rejects(bootstrapBrowserDecisionService({args:['--decision-browser-owner','--decision-browser-config=/dummy','--enroll-decision-browser'],readConfig:async()=>({...c,directory:path.join(root,'ledger'),lineage:'wrong-key'}),loadCredential:async()=>{loads++;return 'wrong_dummy';}}));assert.equal(loads,1);
});

test('browser bridge actual choice/receipt/ack/reset retains aggregate across epochs and grants; 1001st blocked without dispatch',async t=>{
 let calls=0,f;f=await fixture(t,{fetchImpl:upstream({inspect:(url,o)=>{calls++;assert.equal(url,'https://api.openai.com/v1/decisions');assert.equal(o.headers['OpenAI-Project'],'proj_dummy_browser');assert.equal(f.store.snapshot().used.attempts,calls);}})});
 const c=new Controller({sessionId:'browser',provider:f.bridge});await c.step();assert.equal(c.view.pieces,1);assert.equal(calls,1);assert.equal(f.store.snapshot().browserSession.ownerHold,false);assert.equal(Object.values(f.store.snapshot().requests)[0].deliveryPending,false);c.reset();await c.step();assert.equal(c.view.pieces,1);assert.equal(calls,2);assert.equal((await f.service.control(f.grant.capability,'runStatus')).attempts,2);
 const other=await f.service.owner.issueRun({laneId:'other',controllerSessionBase:'other'});assert.equal((await f.service.control(other.capability,'runStatus')).attempts,2);
 // Fast-forward the private aggregate to the real upper boundary without issuing paid calls.
 await f.store.transact(s=>{s.used.attempts=1000;});await assert.rejects(f.service.decide(other.capability,await packet('other')),{code:'session_request_limit'});assert.equal(calls,2);await f.service.control(other.capability,'advanceEpoch',1);assert.equal((await f.service.control(other.capability,'runStatus')).remainingAttempts,0);
 await f.bridge.close();await f.service.close();const reopened=await openDecisionStore({directory:path.join(f.root,'ledger'),lineage:'dummy-browser',policy:f.policy});const service=await createDecisionBrowserService({store:reopened,...{policy:f.policy,qualification:f.qualification},credential:dummy,fetchImpl:upstream()});assert.equal(service.status().available,false);await assert.rejects(service.owner.issueRun({laneId:'new',controllerSessionBase:'new'}));await service.close();
});

test('an overlapping UI accounting refresh cannot reject the first browser decision',async t=>{
 let calls=0,release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++})});let reads=0;
 const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,options)=>{
  if(JSON.parse(options.body).action==='runStatus'&&++reads===1){entered();await gate;}
  return f.fetchHTTP(route,options);
 }});
 t.after(()=>bridge.close().catch(()=>{}));
 const controller=new Controller({sessionId:'browser',provider:bridge}),step=controller.step();await waiting;
 // Start returns while its first decision is choosing; the mounted UI then
 // refreshes the same authenticated accounting for its status panel.
 const refresh=bridge.status();release();await Promise.all([step,refresh]);
 assert.equal(controller.view.error,null);assert.equal(controller.view.pieces,1);assert.equal(calls,1);
 assert.equal(Object.values(f.store.snapshot().requests)[0].deliveryPending,false);
 assert.equal(bridge.runMetadata.accounting.freshness,'current');
});

test('one actual global fetch: overlap does not cancel peer; POST cancellation holds reads and Reset/new grants/restart cannot clear uncertainty',async t=>{
 let release,entered,calls=0;const gate=new Promise(r=>entered=r);const f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++,hold:()=>new Promise(r=>{release=r;entered();})})});const other=await f.service.owner.issueRun({laneId:'other',controllerSessionBase:'other'}),abort=new AbortController(),work=f.service.decide(f.grant.capability,await packet(),{signal:abort.signal});await gate;
 await assert.rejects(f.service.decide(other.capability,await packet('other')),{code:'overlap'});assert.equal(abort.signal.aborted,false);assert.equal(calls,1);abort.abort();await assert.rejects(work);const a=await f.service.control(f.grant.capability,'runStatus');assert.equal(a.ownerHold,true);assert.equal(a.uncertain,1);assert(validBrowserAccounting(a));await assert.rejects(f.service.control(f.grant.capability,'advanceEpoch',1));await assert.rejects(f.service.owner.issueRun({laneId:'new',controllerSessionBase:'new'}));await assert.rejects(f.service.close(),{code:'drain_pending'});await assert.rejects(openDecisionStore({directory:path.join(f.root,'ledger'),lineage:'dummy-browser',policy:f.policy}));release();await wait(10);await f.service.close();await assert.rejects(openDecisionStore({directory:path.join(f.root,'ledger'),lineage:'dummy-browser',policy:f.policy,enroll:true}),{code:'reconciliation_required'});
});

test('predispatch cancellation is settled-safe Reset; explicit native refusal safe; unknown quota and malformed usage globally persist hold',async t=>{
 const f=await fixture(t);const abort=new AbortController();abort.abort();await assert.rejects(f.service.decide(f.grant.capability,await packet(),{signal:abort.signal}));let a=await f.service.control(f.grant.capability,'runStatus');assert.equal(a.attempts,0);assert.equal(a.ownerHold,false);assert.equal(a.resetDisposition,'settled-safe');await f.service.control(f.grant.capability,'advanceEpoch',1);const result=await f.service.decide(f.grant.capability,await packet('browser',1));await f.service.control(f.grant.capability,'acceptDecision',undefined,{requestId:result.choice.requestId});assert.equal((await f.service.control(f.grant.capability,'runStatus')).attempts,1);
 for(const mode of ['refusal','quota','usage','project','organization','legacyBilling']){const quota=['quota','project','organization','legacyBilling'].includes(mode);const x=await fixture(t,{fetchImpl:upstream(mode==='refusal'?{refusal:true}:quota?{status:429,errorCode:({project:'project_spend_limit_exceeded',organization:'organization_spend_limit_exceeded',legacyBilling:'billing_hard_limit_reached'})[mode]??'insufficient_quota'}:{usage:null})});await assert.rejects(x.service.decide(x.grant.capability,await packet()));a=await x.service.control(x.grant.capability,'runStatus');assert.equal(a.ownerHold,mode!=='refusal');if(mode==='refusal')await x.service.control(x.grant.capability,'advanceEpoch',1);else{await assert.rejects(x.service.owner.issueRun({laneId:'another',controllerSessionBase:'another'}));assert.equal(browserStatus(a,x.grant.admission).includes('budget limit was reached'),mode==='project');if(mode==='quota'){await x.bridge.close();await x.service.close();const reopened=await openDecisionStore({directory:path.join(x.root,'ledger'),lineage:'dummy-browser',policy:x.policy});const held=await createDecisionBrowserService({store:reopened,policy:x.policy,qualification:x.qualification,credential:dummy,fetchImpl:upstream()});assert.equal(held.status().available,false);assert.equal((await held.control(x.grant.capability,'runStatus')).ownerHold,true);await assert.rejects(held.owner.issueRun({laneId:'new',controllerSessionBase:'new'}));await held.close();}}}
});

test('lost completed delivery and acknowledged stale response cause owner hold instead of a silent further dispatch',async t=>{
 const f=await fixture(t);const r=await f.service.decide(f.grant.capability,await packet());assert.equal(f.service.status().available,false);await assert.rejects(f.service.control(f.grant.capability,'advanceEpoch',1));await f.service.control(f.grant.capability,'acceptDecision',undefined,{requestId:r.choice.requestId});assert.equal(f.service.status().available,true);await f.service.control(f.grant.capability,'interrupt',undefined,{requestId:r.choice.requestId});assert.equal((await f.service.control(f.grant.capability,'runStatus')).ownerHold,true);await assert.rejects(f.service.control(f.grant.capability,'advanceEpoch',1));
});
class Element{constructor(){this.children=[];this.listeners={};this.value='local';this.textContent='';this.disabled=false;this.hidden=false;}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
test('mounted browser comparison Start survives concurrent status refresh and completes two acknowledged placements',async t=>{
 const oldFetch=globalThis.fetch,oldAdd=globalThis.addEventListener,pagehide=[];
 globalThis.addEventListener=(name,fn)=>{if(name==='pagehide')pagehide.push(fn);};
 let calls=0;const f=await fixture(t,{httpServer:true,fetchImpl:upstream({inspect:()=>calls++})}),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 globalThis.fetch=async(route,o={})=>{
  if(route==='/decision/control'&&JSON.parse(o.body).action==='runStatus')await wait(20);
  const response=await oldFetch(f.origin+route,{...o,headers:{origin:f.origin,...o.headers}});
  if(route==='/decision/pair/register'&&response.ok){const challenge=await response.clone().json();await f.owner.command({action:'approve',challengeId:challenge.challengeId,...JSON.parse(o.body)});}
  return response;
 };
 for(const [k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);
 $('c-pieceCap').value='2';
 const mounted=mountComparison({getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false},{window:{}});
 try{
  $('c-right').value='openai';await $('c-right').trigger('change');await $('decision-pairing').children[1].trigger('click');
  assert.equal(calls,0);await $('c-start').trigger('click');await settle(()=>mounted.view.lanes[1].outcome);
  assert.equal(mounted.view.lanes[1].error,null);assert.equal(mounted.view.lanes[1].pieces,2);assert.equal(calls,2);
  assert.equal(f.store.snapshot().browserSession.ownerHold,false);
  assert(Object.values(f.store.snapshot().requests).every(r=>r.status==='completed'&&!r.deliveryPending));
  assert.equal(verifyDecisionUIRecord(mounted.exportRun()).ok,true);
 }finally{mounted.dispose();await Promise.allSettled(pagehide.map(fn=>fn()));globalThis.fetch=oldFetch;if(oldAdd)globalThis.addEventListener=oldAdd;else delete globalThis.addEventListener;}
});
test('all three actual browser-provider exporters verify canonical receipts/nulls/privacy; Connect stays paused with persistent risk line; replay zero calls',async t=>{
 let calls=0;const f=await fixture(t,{httpServer:true,fetchImpl:upstream({inspect:()=>calls++})});const c=new Comparison({config:{right:'openai',pieceCap:2},providerFactory:(key,config)=>key==='openai'?f.bridge:providerFor(key,config)});await c.step();let json=c.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);assert.equal(JSON.parse(json).metadata.accounting[0].actualCostUSD,null);assert.match(providerProvenance(providerPolicy(f.bridge)),/^Owner-approved live OpenAI/);const before=calls;c.replay();c.pause();await c.step();assert.equal(calls,before);assert.equal(c.exportRun(),json);c.dispose();
 const g=await fixture(t,{httpServer:true});const v=new HumanVersus({providerFactory:()=>g.bridge});await v.stepAlgorithm();v.start();v.tick(20);v.input('drop');v.pause();await settle(()=>!v.view.busy);json=v.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);v.dispose();
 const h=await fixture(t,{httpServer:true,fetchImpl:upstream({inspect:()=>calls++})}),oldFetch=globalThis.fetch,nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 globalThis.fetch=async(route,o={})=>{const response=await oldFetch(h.origin+route,{...o,headers:{origin:h.origin,...o.headers}});if(route==='/decision/pair/register'&&response.ok){const challenge=await response.clone().json(),body=JSON.parse(o.body);await h.owner.command({action:'approve',challengeId:challenge.challengeId,...body});}return response;};
 const mounted=mountHarness({getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false},{window:{addEventListener(){}}});try{$('h-provider').value='openai';$('h-provider').trigger('change');await $('decision-pairing').children[1].trigger('click');assert.equal(mounted.controller.view.pieces,0);assert.equal($('decision-budget-risk').textContent,BROWSER_BUDGET_LINE);assert.equal($('decision-budget-risk').hidden,false);assert.match($('decision-pairing').children[2].textContent,/1,000 requests left/);await $('h-step').trigger('click');json=mounted.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);for(const secret of [dummy,fingerprint,'proj_dummy_browser','dummy private project evidence','dummy approval'])assert(!json.includes(secret));const r=JSON.parse(json);assert.equal(r.events.find(e=>e.input.receipt).input.receipt.reservedInputTokens,null);const mutate=structuredClone(r);mutate.lanes[0].policy.spendControl.riskAccepted=false;assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(mutate)));}finally{mounted.dispose();globalThis.fetch=oldFetch;}
});


test('commit-confirmed ACK gates other grants before commit and keeps Pause/Reset safe during confirmation',async t=>{
 for(const action of ['pause','reset']){
  let release,entered,ackCount=0,calls=0;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
  const f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++})}),other=await f.service.owner.issueRun({laneId:'other',controllerSessionBase:'other'});
  const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,o)=>{const b=JSON.parse(o.body);if(b.action==='acceptDecision'){ackCount++;assert.equal(c.view.pieces,1);assert.equal(c.view.busy,true);}if(b.action==='runStatus'&&ackCount){entered();await gate;}return f.fetchHTTP(route,o);}});
  const c=new Controller({sessionId:'browser',provider:bridge}),first=c.step();await waiting;assert.equal(c.view.pieces,1);assert.equal(c.view.busy,true);const last=c.view.lastDecision;c[action]();assert.equal(f.store.snapshot().browserSession.ownerHold,false);assert.equal(c.view.busy,true);await assert.rejects(c.step(),/already in progress/);
  if(action==='pause'){assert.equal(c.view.lastDecision,last);assert.equal(c.view.status,'paused');}else{assert.equal(c.view.pieces,0);assert.equal(c.view.status,'ready');assert.equal(c.view.lastDecision,null);}
  const second=await f.service.decide(other.capability,await packet('other'));await f.service.control(other.capability,'acceptDecision',undefined,{requestId:second.choice.requestId});assert.equal(calls,2);release();await first;assert.equal(c.view.busy,false);assert.equal(c.view.status,action==='reset'?'ready':'paused');assert.equal(c.view.pieces,action==='reset'?0:1);assert.equal(f.store.snapshot().browserSession.ownerHold,false);await bridge.close();
 }
});

test('precommit delivery gate retains pending completion and cancellation sends no ACK',async t=>{
 let release,entered,acks=0,calls=0;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r),f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++})}),other=await f.service.owner.issueRun({laneId:'other',controllerSessionBase:'other'});
 const bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,o)=>{const b=JSON.parse(o.body);if(b.action==='acceptDecision')acks++;const r=await f.fetchHTTP(route,o);if(route==='/decision/choice'){entered();await gate;}return r;}}),c=new Controller({sessionId:'browser',provider:bridge}),first=c.step();await waiting;assert.equal(c.view.pieces,0);assert.equal(c.view.busy,true);assert.equal(f.service.status().available,false);await assert.rejects(f.service.decide(other.capability,await packet('other')));assert.equal(calls,1);c.pause();release();await first;await settle(()=>f.store.snapshot().browserSession.ownerHold);assert.equal(c.view.pieces,0);assert.equal(acks,0);await bridge.close();
});

test('lost ACK reply retains one committed placement and canonical prefix without duplicate failed request',async t=>{
 let acks=0;const f=await fixture(t),bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,o)=>{const b=JSON.parse(o.body),r=await f.fetchHTTP(route,o);if(b.action==='acceptDecision'){acks++;throw new Error('dummy lost ACK reply');}return r;}});let journal;const c=new Controller({sessionId:'browser',provider:bridge,onTransition:({input,view})=>journal.append(0,input,view)});journal=new DecisionJournal({mode:'solo'});journal.addLane(0,'computer',c.view,providerPolicy(bridge));await c.step();assert.equal(c.view.pieces,1);assert.equal(c.view.busy,false);assert.equal(c.view.status,'error');assert(c.view.lastDecision);assert.equal(acks,1);assert.equal(bridge.blocked,true);const accounting=await f.service.control(f.grant.capability,'runStatus');assert.equal(accounting.ownerHold,true);c.pause();c.stop();const json=journal.exportRun({metadata:{accounting}});assert.equal(verifyDecisionUIRecord(json).ok,true);assert.equal(JSON.parse(json).events.filter(e=>e.input.kind==='computer').length,1);assert.equal(JSON.parse(json).events.filter(e=>e.input.kind==='error').length,0);await bridge.close();
});

test('invalid receipt or journal capacity prevents commit and ACK',async t=>{
 for(const mode of ['receipt','capacity']){let acks=0;const f=await fixture(t),bridge=createDecisionBridge({grant:f.grant,fetchImpl:async(route,o)=>{const b=JSON.parse(o.body);if(b.action==='acceptDecision')acks++;const r=await f.fetchHTTP(route,o);if(mode==='receipt'&&route==='/decision/choice'){const x=await r.json();x.receipt.version='wrong';return new Response(JSON.stringify(x));}return r;}});let journal;const c=new Controller({sessionId:'browser',provider:bridge,onTransition:({input,view})=>journal.append(0,input,view)});journal=new DecisionJournal({mode:'solo',eventLimit:mode==='capacity'?1:10});journal.addLane(0,'computer',c.view,providerPolicy(bridge));await c.step();await settle(()=>f.store.snapshot().browserSession.ownerHold);assert.equal(c.view.pieces,0);assert.equal(acks,0);await bridge.close();}
});

test('solo Choosing retains Pause/Stop while paid controls are fenced; comparison pending selection is truthful',async t=>{
 let release,entered;const waiting=new Promise(r=>entered=r),f=await fixture(t,{httpServer:true,fetchImpl:upstream({hold:()=>new Promise(r=>{release=r;entered();})})}),oldFetch=globalThis.fetch,nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 globalThis.fetch=async(route,o={})=>{const r=await oldFetch(f.origin+route,{...o,headers:{origin:f.origin,...o.headers}});if(route==='/decision/pair/register'&&r.ok){const x=await r.clone().json();await f.owner.command({action:'approve',challengeId:x.challengeId,...JSON.parse(o.body)});}return r;};
 const doc={getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false},mounted=mountHarness(doc,{window:{addEventListener(){}}});try{$('h-provider').value='openai';$('h-provider').trigger('change');assert.match($('player-heading').textContent,/OpenAI Decisions/);await $('decision-pairing').children[1].trigger('click');const step=$('h-step').trigger('click');await waiting;assert.equal($('h-pause').disabled,false);assert.equal($('h-stop').disabled,false);assert.equal($('h-start').disabled,true);assert.equal($('h-step').disabled,true);assert.equal($('h-reset').disabled,true);$('h-pause').trigger('click');release();await step;assert.equal(mounted.controller.view.pieces,0);}finally{release?.();mounted.dispose();globalThis.fetch=oldFetch;}
 for(const [file,prefix]of [['harness.html','h'],['comparison.html','c'],['versus.html','v']]){const html=await readFile(new URL('../public/'+file,import.meta.url),'utf8');assert.equal((html.match(/id="decision-budget-risk"/g)??[]).length,1);assert(html.indexOf('id="decision-budget-risk"')<html.indexOf(`id="${prefix}-start"`));}
 const n=new Map(),get=id=>{if(!n.has(id))n.set(id,new Element());return n.get(id);};for(const [k,v]of Object.entries(DEFAULT_CONFIG))get('c-'+k).value=String(v);const comparison=mountComparison({getElementById:get,createElement:()=>new Element(),addEventListener(){},hidden:false});try{get('c-right').value='openai';await get('c-right').trigger('change');assert.equal(get('c-start').disabled,true);assert.equal(get('c-step').disabled,true);assert.match(get('c-1-heading').textContent,/OpenAI Decisions/);assert.doesNotMatch(get('c-1-heading').textContent,/Lookahead/);assert.equal(get('c-error').hidden,true);}finally{comparison.dispose();}
});


test('versus pending OpenAI does not configure an unavailable provider and successful pairing clears the fulfilled message',async t=>{
 const oldAdd=globalThis.addEventListener,pagehide=[];globalThis.addEventListener=(name,fn)=>{if(name==='pagehide')pagehide.push(fn);};
 let calls=0;const f=await fixture(t,{httpServer:true,fetchImpl:upstream({inspect:()=>calls++})}),oldFetch=globalThis.fetch,nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 globalThis.fetch=async(route,o={})=>{const response=await oldFetch(f.origin+route,{...o,headers:{origin:f.origin,...o.headers}});if(route==='/decision/pair/register'&&response.ok){const challenge=await response.clone().json();await f.owner.command({action:'approve',challengeId:challenge.challengeId,...JSON.parse(o.body)});}return response;};
 $('v-provider').value='local';$('v-message').hidden=true;
 const mounted=mountVersus({getElementById:$,createElement:()=>new Element(),addEventListener(){},hasFocus:()=>true,hidden:false},{window:{addEventListener(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){}}});
 try{
  $('v-provider').value='openai';await $('v-provider').trigger('change');assert.equal($('v-start').disabled,true);assert.equal($('v-step').disabled,true);assert.match($('v-1-heading').textContent,/OpenAI Decisions/);assert.doesNotMatch($('v-1-heading').textContent,/Local heuristic|Lookahead/);assert.equal($('v-message').hidden,true);assert.equal(calls,0);
  $('v-message').hidden=false;$('v-message').textContent='unavailable';await $('decision-pairing').children[1].trigger('click');assert.equal($('v-message').hidden,true);assert.equal($('v-message').textContent,'');assert.equal(mounted.runner.view.state,'ready');assert.equal(mounted.runner.view.lanes[1].pieces,0);assert.equal(calls,0);assert.match($('v-1-provenance').textContent,/Owner-approved live OpenAI/);
  await $('v-step').trigger('click');assert.equal(mounted.runner.view.lanes[1].pieces,1);assert.equal(calls,1);
 }finally{mounted.dispose();await Promise.allSettled(pagehide.map(fn=>fn()));globalThis.fetch=oldFetch;if(oldAdd)globalThis.addEventListener=oldAdd;else delete globalThis.addEventListener;}
});


test('browser held recovery copy refers to authenticated provider status while strict fixture keeps Reset wording',async t=>{
 const f=await fixture(t,{fetchImpl:upstream({status:429,errorCode:'project_spend_limit_exceeded'})}),c=new Controller({sessionId:'browser',provider:f.bridge});await c.step();assert.equal(c.view.recoveryRequired,true);assert.match(c.view.error,/See provider status before continuing/);assert.doesNotMatch(c.view.error,/Reset required/);assert.equal((await f.service.control(f.grant.capability,'runStatus')).ownerHold,true);
 let entered,release;const waitForStart=new Promise(r=>entered=r),base=heuristic(),provider={...base,kind:'remote',requiresReset:true,runMetadata:{mode:'http-fixture'},decide:()=>new Promise(r=>{release=r;entered();})},strict=new Controller({provider});const pending=strict.step();await waitForStart;strict.pause();assert.match(strict.view.error,/Reset required/);release({});await pending;
});

for(const local of ['local','look1','look2','lookahead','delay','error'])for(const side of [0,1])test(`${local} can oppose live-shaped OpenAI on either side (${side}) with canonical export and zero-call replay`,async t=>{
 let calls=0;const f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++})}),config={left:side===0?'openai':local,right:side===1?'openai':local,leftDepth:6,rightDepth:6,pieceCap:1,timeMs:1000},c=new Comparison({config,providerFactory:(key,settings)=>key==='openai'?f.bridge:providerFor(key,settings)});
 try{
  await c.step();assert.equal(c.view.lanes[side].pieces,1);assert.equal(c.view.lanes[1-side].pieces,local==='error'?0:1);assert.equal(calls,1);
  const json=c.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);
  if(local.startsWith('look')){const record=JSON.parse(json);const receipt=record.events.find(e=>e.lane===1-side&&e.input.kind==='computer').input.receipt;assert.equal(receipt.errorCode,null);const bad=structuredClone(record);bad.lanes[1-side].policy.search.modelCalls=1;assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(bad)));const badReceipt=structuredClone(record);badReceipt.events.find(e=>e.lane===1-side&&e.input.kind==='computer').input.receipt.requestId='foreign';assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(badReceipt)));}
  if(local.startsWith('look'))for(const mutate of [q=>q.nodes=0,q=>q.evaluatorCalls=0,q=>q.childrenEnumerated++,q=>q.leavesEvaluated=0]){const bad=JSON.parse(json);mutate(bad.events.find(e=>e.lane===1-side&&e.input.kind==='computer').input.receipt.search);assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(bad)),/search/);}
  c.replay();c.pause();for(let n=0;n<c.view.frameCount;n++)await c.step();assert.equal(calls,1);assert.equal(c.exportRun(),json);
 }finally{c.dispose();}
});

test('two OpenAI lanes use separate grants and serialize actual upstreams without overlap, then retain two-sample canonical history',async t=>{
 let active=0,calls=0;const f=await fixture(t,{fetchImpl:upstream({inspect:()=>{assert.equal(active,0);active++;calls++;},hold:async()=>{await wait(20);active--;}})});
 const run=await f.service.owner.issueRun({laneId:'second',controllerSessionBase:'second'}),grant={...run,admission:await f.service.control(run.capability,'runStatus')},second=createDecisionBridge({grant,fetchImpl:f.fetchHTTP});
 const c=new Comparison({config:{left:'openai',right:'openai',samples:2,pieceCap:1},providerFactory:(key,settings,{lane})=>lane?second:f.bridge});
 try{
  await c.step();assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal(calls,2);assert.equal(f.store.snapshot().browserSession.ownerHold,false);
  await c.step();assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal(calls,4);assert.equal(f.store.snapshot().used.attempts,4);const json=c.exportRun(),r=JSON.parse(json);assert.equal(r.version,'decision-ui-comparison-series-1');assert.equal(r.records.length,2);assert.equal(verifyDecisionUIRecord(json).samples,2);
  const reused=structuredClone(r);reused.records[1]=reused.records[0];assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(reused)),/session reuse/);
  c.replay();c.pause();for(let n=0;n<c.view.frameCount;n++)await c.step();assert.equal(calls,4);assert.equal(c.exportRun(),json);
  c.reset();await c.step();assert.equal(calls,6);assert.equal(f.store.snapshot().used.attempts,6);assert.equal(verifyDecisionUIRecord(c.exportRun()).ok,true);
 }finally{c.dispose();await second.close();}
});

test('cancelling a pair with one queued paid lane never dispatches that lane or clears the first lane hold',async t=>{
 let release,entered,calls=0;const waiting=new Promise(r=>entered=r),f=await fixture(t,{fetchImpl:upstream({inspect:()=>calls++,hold:()=>new Promise(r=>{release=r;entered();})})});
 const run=await f.service.owner.issueRun({laneId:'queued',controllerSessionBase:'queued'}),second=createDecisionBridge({grant:{...run,admission:await f.service.control(run.capability,'runStatus')},fetchImpl:f.fetchHTTP}),c=new Comparison({config:{left:'openai',right:'openai'},providerFactory:(key,settings,{lane})=>lane?second:f.bridge});
 try{const work=c.step();await waiting;assert.equal(c.view.lanes[1].status,'queued');c.pause();release();await work;await settle(()=>f.store.snapshot().browserSession.ownerHold);assert.equal(calls,1);assert.equal(c.view.lanes[1].pieces,0);assert.equal(f.store.snapshot().used.attempts,1);assert.equal(verifyDecisionUIRecord(c.exportRun()).ok,true);}finally{release?.();c.dispose();await second.close();}
});

test('actual selectors independently pair both OpenAI lanes and keep lookahead settings available',async t=>{
 const original=globalThis.fetch;let calls=0;const f=await fixture(t,{httpServer:true,fetchImpl:upstream({usage:{input_tokens:1000,output_tokens:0,total_tokens:1000},inspect:()=>calls++})}),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};for(const [k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);
 globalThis.fetch=async(route,o={})=>{if(route.startsWith('http'))return original(route,o);const response=await original(f.origin+route,{...o,headers:{origin:f.origin,...o.headers}});if(route==='/decision/pair/register'&&response.ok){const challenge=await response.clone().json();await f.owner.command({action:'approve',challengeId:challenge.challengeId,...JSON.parse(o.body)});}return response;};
 const c=mountComparison({getElementById:$,createElement:()=>new Element(),addEventListener(){},hidden:false},{window:{}});
 try{
  $('c-samples').value='2';$('c-pieceCap').value='1';$('c-left').value='openai';await $('c-left').trigger('change');$('c-right').value='openai';await $('c-right').trigger('change');
  await $('decision-pairing-left').children[1].trigger('click');assert.equal($('c-start').disabled,true);await $('decision-pairing').children[1].trigger('click');assert.equal($('c-start').disabled,false);assert.equal($('decision-budget-risk').hidden,false);
  assert.equal($('decision-pairing').children[1].hidden,true);assert.equal($('decision-pairing-left').children[1].hidden,true);assert.match($('decision-pairing').children[5].children[1].textContent,/Session ends:/);
  await $('c-step').trigger('click');assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal(calls,2);assert.match($('decision-cost').textContent,/0\.0002/);assert.equal(verifyDecisionUIRecord(c.exportRun()).ok,true);
  await $('c-step').trigger('click');assert.equal(calls,4);assert.match($('decision-cost').textContent,/0\.0004/);assert.equal(verifyDecisionUIRecord(c.exportRun()).samples,2);
  await $('c-reset').trigger('click');$('c-left').value='look2';await $('c-left').trigger('change');assert.equal($('c-nodeCap').disabled,false);assert.equal($('c-timeMs').disabled,false);assert.equal($('c-start').disabled,false);
 }finally{c.dispose();globalThis.fetch=original;}
});
