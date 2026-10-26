import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {openDecisionStore} from '../decision-store.mjs';
import {createDecisionService} from '../decision-service.mjs';
import {createDecisionHandler} from '../decision-http.mjs';
import {createDecisionOwner} from '../decision-owner.mjs';
import {createDecisionBridge} from '../public/decision-bridge.mjs';
import {Comparison,providerFor,validateConfig} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {decisionRecord} from '../public/decision-record.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<500;n++){if(fn())return;await wait(2);}throw new Error('fixture gate not entered');}
async function fixture(t,{mode,lane,hold=false,maxAttempts=8}={}) {
 const directory=await mkdtemp(path.join(await realpath(os.tmpdir()),'p8020-facade-'));
 const policy={maxAttempts,maxInputTokens:20000000,maxEstimatedMicros:100000,expiresAt:Date.now()+60000,maxRuns:8,maxEpochs:8,maxPlacements:1000,timeoutMs:1500,reservationTokens:1049600,reservationMicros:1000};
 const store=await openDecisionStore({directory,lineage:'facade-test',policy,enroll:true});let calls=0,release;
 const transport=Object.assign(async request=>{calls++;if(hold&&calls===1)await new Promise(r=>release=r);const ids=request.body.questions[0].choices.map(c=>c.value);return {status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,i)=>({value,probability:i?0:1}))}]}};},{mode:'fixture'});
 const service=createDecisionService({enabled:true,store,policy,transport}),owner=createDecisionOwner({service}),server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`;server.on('request',createDecisionHandler({service,owner,host,origin}));
 const nonce=randomBytes(32).toString('hex'),nonceDigest=createHash('sha256').update(Buffer.from(nonce,'hex')).digest('hex'),c=await owner.register({nonceDigest,mode,lane});await owner.command({action:'approve',challengeId:c.challengeId,nonceDigest,mode,lane});const {grant}=await owner.claim({challengeId:c.challengeId},nonce);
 const bridge=createDecisionBridge({grant,fetchImpl:(route,options)=>fetch(origin+route,{...options,headers:{origin,...options.headers}})});
 t.after(async()=>{release?.();await bridge.close();await owner.close();await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
 return {bridge,store,grant,get calls(){return calls;},get release(){return release;}};
}
test('external comparison enforces single right lane; delayed fixture leaves local peer independent and replay makes zero requests',async t=>{
 assert.throws(()=>validateConfig({left:'openai',right:'openai'}));assert.throws(()=>validateConfig({left:'look1',right:'openai'}));assert.throws(()=>validateConfig({right:'openai',samples:2}));
 const f=await fixture(t,{mode:'comparison',lane:'right',hold:true});const c=new Comparison({config:{left:'local',right:'openai',pieceCap:3,paceMs:30},providerFactory:(key,config)=>key==='openai'?f.bridge:providerFor(key,config)});t.after(()=>c.dispose());
 c.start();await until(()=>f.release);await until(()=>c.view.lanes[0].pieces>=2);assert.equal(c.view.lanes[1].pieces,0);assert.equal(c.view.lanes[0].policy.kind,'localHeuristic');assert.equal(c.view.lanes[1].policy.kind,'externalDecisions');assert.ok(!JSON.stringify(c.view.lanes[1].policy).includes('weights'));
 c.pause();f.release();await wait(5);assert.equal(c.view.lanes[1].pieces,0);assert.equal(c.view.lanes[1].recoveryRequired,true);
 c.reset();c.reset();await c.step();assert.equal(c.view.lanes[1].pieces,1);assert.ok(c.view.lanes[1].observation.sessionId.endsWith('-2'));assert.equal(f.calls,2);
 const record=JSON.parse(c.exportRun());assert.equal(record.version,'decision-ui-record-1');assert.equal(record.mode,'comparison');assert.equal(record.objective.targetLines,300);assert.ok(!JSON.stringify(record).includes(f.grant.capability));
 const count=f.calls;c.replay();c.pause();await c.step();assert.equal(f.calls,count);assert.equal(c.view.lanes[1].status,'replay');
});
test('external versus human continues during wait; shared pause cancels, repeated Reset recovers same grant and no replay call',async t=>{
 const f=await fixture(t,{mode:'versus',lane:'algorithm',hold:true});const v=new HumanVersus({providerFactory:()=>f.bridge});t.after(()=>v.dispose());
 v.start();await until(()=>f.release);v.input('drop');assert.equal(v.view.lanes[0].pieces,1);assert.equal(v.view.lanes[1].pieces,0);v.pause();f.release();await wait(5);assert.equal(v.view.lanes[1].pieces,0);assert.equal(v.view.lanes[1].recoveryRequired,true);
 v.reset();v.reset();await v.stepAlgorithm();assert.equal(v.view.lanes[0].pieces,0);assert.equal(v.view.lanes[1].pieces,1);assert.ok(v.view.lanes[1].observation.sessionId.endsWith('-2'));
 assert.equal(v.view.policies[1].transport,'http-fixture');assert.ok(!Object.hasOwn(v.view.policies[1],'weights'));const record=JSON.parse(v.exportRun());assert.equal(record.mode,'versus');assert.ok(record.frames.some(f=>f.lastDecision?.receipt?.version==='decision-receipt-2'));
 const calls=f.calls;v.replay();v.pause();await v.stepAlgorithm();v.input('drop');v.tick(250);assert.equal(f.calls,calls);
});
test('request cap consumes no retry/refill; run status is authenticated and read-only',async t=>{
 const f=await fixture(t,{mode:'comparison',lane:'right',maxAttempts:1});const c=new Comparison({config:{left:'local',right:'openai',pieceCap:3},providerFactory:(key,config)=>key==='openai'?f.bridge:providerFor(key,config)});t.after(()=>c.dispose());
 await c.step();await c.step();assert.equal(f.calls,1);assert.equal(c.view.lanes[1].pieces,1);assert.match(c.view.lanes[1].error,/budget/);const before=f.store.snapshot();const status=await f.bridge.status();assert.equal(status.remainingAttempts,0);assert.deepEqual(f.store.snapshot(),before);
 c.reset();await c.step();assert.equal(f.calls,1);assert.equal((await f.bridge.status()).remainingAttempts,0);
});
test('finite record envelope admits worst-case 1000 receipts and 2000 paired placement profile, rejects over-cap bytes/frames',()=>{
 const receipt={version:'decision-receipt-2',padding:'x'.repeat(4000)},frame={lane:1,observation:{board:Array.from({length:20},()=>'.'.repeat(10)),active:null,next:['I','O','T','S','Z'],score:999999,lines:300,level:30},decision:{receipt,candidate:{path:'C'.repeat(800),pathEncoding:'LRCDH-1',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}]}}};
 const frames=Array.from({length:2002},(_,i)=>i%2?frame:{...frame,lane:0,decision:{candidate:frame.decision.candidate}});
 const json=decisionRecord({mode:'comparison',policies:[],frames,finals:[],reasons:['piece cap']});assert.ok(Buffer.byteLength(json)<16*1024*1024);
 assert.throws(()=>decisionRecord({mode:'solo',policies:[],frames:Array(2003).fill({}),finals:[],reasons:[]}));
 assert.throws(()=>decisionRecord({mode:'solo',policies:[],frames:[{padding:'x'.repeat(16*1024*1024)}],finals:[],reasons:[]}));
});
