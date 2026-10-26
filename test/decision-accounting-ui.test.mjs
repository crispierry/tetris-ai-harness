import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
import {mountHarness} from '../public/harness-ui.mjs';
import {mountVersus} from '../public/versus-ui.mjs';
import {mountComparison} from '../public/comparison-ui.mjs';
import {DEFAULT_CONFIG} from '../public/comparison.mjs';
import {createDecisionBridge} from '../public/decision-bridge.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<500;n++){if(fn())return;await wait(2);}throw new Error('Accounting fixture did not settle');}
class Element{focus(){}constructor(){this.children=[];this.listeners={};this.value='';this.textContent='';this.disabled=false;}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=[...v];}setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}trigger(k){return this.listeners[k]?.({target:this});}}
const admission=attempts=>({mode:'http-fixture',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:null,endpoint:'https://api.openai.com/v1/decisions',protocol:'decisions-http-1',policyDigest:'b'.repeat(64),limits:{maxAttempts:8},epoch:0,placements:0,attempts,completions:0,uncertain:attempts,remainingAttempts:8-attempts,remainingReservedInputTokens:8000000-attempts*1000000,remainingEstimatedMicros:8000-attempts*1000,actualExternalCalls:0,actualCostUSD:0});
for(const mode of ['comparison','versus','solo'])for(const action of mode==='comparison'?['failure','stop','focus']:['failure'])test(`mounted ${mode} automatic external ${action} reconciles consumed allowance without receipt/retry`,async()=>{
 const nodes=new Map(),events={},$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};for(const[k,v]of Object.entries(DEFAULT_CONFIG))$('c-'+k).value=String(v);
 const doc={activeElement:null,hasFocus:()=>true,getElementById:$,createElement:()=>new Element(),addEventListener:(k,fn)=>events[k]=fn,hidden:false};
 const oldFetch=globalThis.fetch,oldAdd=globalThis.addEventListener;let attempts=0,statusReads=0,choices=0,exported;
 const grant={capability:'a'.repeat(64),controllerSessionBase:'accounting',epoch:0,admission:admission(0)};
 globalThis.addEventListener=(k,fn)=>events[k]=fn;
 globalThis.fetch=async(route,options={})=>{
  const body=options.body?JSON.parse(options.body):{};let value;
  if(route==='/decision/status')value={available:true,reason:'fixture-only'};
  if(route.endsWith('/register'))value={challengeId:'fixture-challenge',expiresAt:Date.now()+60000};
  if(route.endsWith('/claim'))value={state:'connected',grant};
  if(route==='/decision/control'){if(body.action==='runStatus'){statusReads++;value=admission(attempts);}else value={epoch:0,maxEpochs:8,closed:body.action==='close'};}
  if(route==='/decision/choice'){
   choices++;attempts++;if(action==='failure')await wait(20);else await new Promise(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true});});
   return new Response(JSON.stringify({error:action==='failure'?'provider_error':'cancelled'}),{status:400});
  }
  return new Response(JSON.stringify(value),{status:200});
 };
 let c,mounted;const prefix=mode==='comparison'?'c':mode==='versus'?'v':'h';const win={addEventListener(){},requestAnimationFrame(){return 1;},cancelAnimationFrame(){}};
 try{
  if(mode==='comparison'){c=mountComparison(doc,{onExport:json=>exported=JSON.parse(json)});$('c-left').value='local';$('c-right').value='openai';$('c-pieceCap').value='2';await $('c-right').trigger('change');}else{const options={window:win,onExport:json=>exported=JSON.parse(json)};$(prefix+'-provider').value='local';mounted=mode==='solo'?mountHarness(doc,options):mountVersus(doc,options);$(prefix+'-provider').value='openai';await $(prefix+'-provider').trigger('change');}
  const provenance=()=>$(mode==='comparison'?'c-1-tier':mode==='versus'?'v-1-provenance':'h-provenance').textContent;
  assert.match(provenance(),/Not configured/);assert.doesNotMatch(provenance(),/Independent local choices/);
  await $('decision-pairing').children[1].trigger('click');
  assert.match(provenance(),/^Offline HTTP fixture via local server · No external provider calls/);
  assert.match(provenance(),/Current \+ next five/);
  if(mode!=='comparison')c=mode==='solo'?mounted.controller:mounted.runner;await $(prefix+'-start').trigger('click');await until(()=>attempts===1);
  const accounting=record=>mode==='comparison'?record.metadata.accounting[0]:record.metadata.accounting;const exportRun=()=>mode==='solo'?mounted.exportRun():c.exportRun();const pending=accounting(JSON.parse(exportRun()));assert.notEqual(pending.freshness,'current');assert.equal(pending.attempts,null);
  if(action==='stop')await $('c-stop').trigger('click');if(action==='focus')events.blur();
  const facts=$('decision-pairing').children[5].children[1];await until(()=>/1 reserved attempts/.test(facts.textContent));
  assert.match(facts.textContent,/allowance: 7/);assert.equal(choices,1);assert.ok(statusReads>=1);assert.equal(mode==='solo'?c.view.lastDecision:c.view.lanes[1].lastDecision,null);
  await $(prefix+'-export').trigger('click');assert.equal(verifyDecisionUIRecord(JSON.stringify(exported)).ok,true);assert.equal(accounting(exported).freshness,'current');assert.equal(accounting(exported).attempts,1);assert.equal(accounting(exported).remainingAttempts,7);await $(prefix+'-pause').trigger('click');await $(prefix+'-stop').trigger('click');assert.equal(verifyDecisionUIRecord(exportRun()).ok,true);
  await $(prefix+'-replay').trigger('click');await $(prefix+'-pause').trigger('click');
  assert.match(provenance(),/^Recorded · Offline HTTP fixture via local server/);
  assert.equal(choices,1);
  await $(prefix+'-reset').trigger('click');
  assert.match(provenance(),/^Offline HTTP fixture via local server/);assert.doesNotMatch(provenance(),/^Recorded/);
  assert.equal(choices,1);
 }finally{if(mounted)mounted.dispose();else c?.dispose();await events.pagehide?.();globalThis.fetch=oldFetch;if(oldAdd)globalThis.addEventListener=oldAdd;else delete globalThis.addEventListener;}
});
test('late authenticated accounting read cannot overwrite Reset or close; unavailable accounting is explicit',async()=>{
 let release;const grant={capability:'a'.repeat(64),controllerSessionBase:'status-race',epoch:0,admission:admission(0)};
 const bridge=createDecisionBridge({grant,fetchImpl:async(route,options)=>{const body=JSON.parse(options.body);if(body.action==='runStatus'){await new Promise(r=>release=r);return new Response(JSON.stringify(admission(0)));}return new Response(JSON.stringify({closed:true}));}});
 const old=bridge.status();bridge.invalidateAccounting();release();await assert.rejects(old,{code:'accounting_stale'});assert.notEqual(bridge.runMetadata.accounting.freshness,'current');assert.equal(bridge.runMetadata.accounting.attempts,null);await bridge.close();
});
