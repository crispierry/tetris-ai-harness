import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDecisionStore} from '../decision-store.mjs';
import {createDecisionService} from '../decision-service.mjs';
import {createDecisionHandler} from '../decision-http.mjs';
import {createDecisionOwner} from '../decision-owner.mjs';
import {createDecisionSession} from '../public/decision-session.mjs';
import {Controller} from '../public/controller.mjs';
import {providerPolicy} from '../public/provider-policy.mjs';
import {decisionRecord} from '../public/decision-record.mjs';
test('source Connect → owned HTTP → exact owner → once claim → Controller → two Resets → stored replay; negative admission',async()=>{
 const directory=await mkdtemp(path.join(await realpath(os.tmpdir()),'owner-test-'));
 const policy={maxAttempts:4,maxInputTokens:20000000,maxEstimatedMicros:100000,expiresAt:Date.now()+60000,maxRuns:8,maxEpochs:8,maxPlacements:1000,timeoutMs:1500,reservationTokens:1049600,reservationMicros:1000};
 const store=await openDecisionStore({directory,lineage:'owner-test',policy,enroll:true});let calls=0;
 const transport=Object.assign(async request=>{calls++;const ids=request.body.questions[0].choices.map(c=>c.value);return {status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,i)=>({value,probability:i?0:1}))}]}};},{mode:'fixture'});
 const service=createDecisionService({enabled:true,store,policy,transport}),owner=createDecisionOwner({service});
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`,handler=createDecisionHandler({service,owner,host,origin});server.on('request',handler);
 const fetchImpl=(route,options={})=>fetch(origin+route,{...options,headers:{origin,...options.headers}});let session;
 try {
  assert.equal(Object.keys(store.snapshot().runs).length,0);assert.equal(calls,0);
  const nonce=randomBytes(32).toString('hex'),nonceDigest=createHash('sha256').update(Buffer.from(nonce,'hex')).digest('hex');
  await assert.rejects(owner.register({nonceDigest,mode:'comparison',lane:'left'}));
  assert.equal((await fetchImpl('/decision/pair/register',{method:'POST',headers:{origin:'http://evil','content-type':'application/json'},body:JSON.stringify({nonceDigest,mode:'solo',lane:'solo'})})).status,403);
  const c=await owner.register({nonceDigest,mode:'solo',lane:'solo'});assert.equal(calls,0);assert.equal(Object.keys(store.snapshot().runs).length,0);
  await assert.rejects(owner.claim({challengeId:c.challengeId},'0'.repeat(64)));await assert.rejects(owner.command({action:'approve',challengeId:c.challengeId,nonceDigest,mode:'solo',lane:'right'}));
  await owner.command({action:'approve',challengeId:c.challengeId,nonceDigest,mode:'solo',lane:'solo'});
  const lost=await owner.claim({challengeId:c.challengeId},nonce);await assert.rejects(owner.claim({challengeId:c.challengeId},nonce));assert.equal(calls,0);await owner.command({action:'close',challengeId:c.challengeId,nonceDigest,mode:'solo',lane:'solo'});assert.equal(Object.values(store.snapshot().runs)[0].closed,true);
  session=createDecisionSession({mode:'solo',lane:'solo',fetchImpl});await session.connect();
  const pending=(await owner.command({action:'list'})).pending.find(p=>p.state==='pending');await owner.command({action:'approve',challengeId:pending.challengeId,nonceDigest:pending.nonceDigest,mode:pending.mode,lane:pending.lane});
  for(let i=0;i<100&&session.state.state!=='connected';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(session.state.state,'connected');assert.equal(calls,0);
  const controller=new Controller({...session.binding,provider:session.provider});assert.ok(await controller.step());
  const frame=controller.view;const json=decisionRecord({mode:'solo',policies:[providerPolicy(session.provider)],frames:[frame],finals:[{score:frame.observation.score,lines:frame.observation.lines}],reasons:['paused']});
  assert.ok(!json.includes(lost.grant.capability));assert.ok(!json.includes(nonce));assert.equal(JSON.parse(json).frames[0].lastDecision.receipt.actualExternalCalls,0);
  controller.pause();controller.stop();assert.equal(controller.view.observation.sessionId,`${session.binding.sessionId}-0`);
  controller.reset();controller.reset();assert.ok(await controller.step());assert.equal(controller.view.observation.sessionId,`${session.binding.sessionId}-2`);assert.equal(calls,2);
  const before=calls;for(const f of JSON.parse(json).frames)assert.ok(f.observation.board);assert.equal(calls,before);
  const status=await session.status();assert.equal(status.remainingAttempts,2);assert.equal(status.actualExternalCalls,0);
 } finally {await session?.close();await owner.close();await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});

test('owner pairing TTL, pending bound, exact command, failed close hold',async()=>{
 let at=1,issued=0,closed=0,failClose=false;
 const service={status:()=>({available:true}),owner:{issueRun:async()=>{issued++;return {capability:'a'.repeat(64)};}},control:async(cap,action)=>{if(action==='close'){if(failClose)throw new Error('injected');closed++;return {closed:true};}return {mode:'http-fixture'};}};
 const owner=createDecisionOwner({service,now:()=>at}),nonce=randomBytes(32).toString('hex'),nonceDigest=createHash('sha256').update(Buffer.from(nonce,'hex')).digest('hex');
 const first=await owner.register({nonceDigest,mode:'solo',lane:'solo'});
 assert.equal((await owner.claim({challengeId:first.challengeId},nonce)).state,'pending');assert.equal(issued,0);
 await owner.command({action:'approve',challengeId:first.challengeId,nonceDigest,mode:'solo',lane:'solo'});assert.equal(issued,1);
 at=60002;await assert.rejects(owner.claim({challengeId:first.challengeId},nonce));assert.equal(closed,1);
 for(let i=0;i<8;i++)await owner.register({nonceDigest,mode:'solo',lane:'solo'});
 await assert.rejects(owner.register({nonceDigest,mode:'solo',lane:'solo'}),{code:'rate_limit'});assert.equal(issued,1);
 await owner.close();
 const held=createDecisionOwner({service,now:()=>at}),c=await held.register({nonceDigest,mode:'versus',lane:'algorithm'});await held.command({action:'approve',challengeId:c.challengeId,nonceDigest,mode:'versus',lane:'algorithm'});failClose=true;at+=60001;
 await assert.rejects(held.register({nonceDigest,mode:'solo',lane:'solo'}),{code:'unavailable'});assert.equal((await held.command({action:'list'})).ownerHold,true);failClose=false;await held.close();
});

test('inherited owner stdin accepts only bounded exact JSON commands and never prints a capability',async()=>{
 const {PassThrough}=await import('node:stream');const {attachOwnerInput}=await import('../decision-owner.mjs');
 const input=new PassThrough(),outputs=[],commands=[];
 const detach=attachOwnerInput(input,{command:async body=>{commands.push(body);return {state:'pending'};}},value=>outputs.push(value));
 input.write('{bad}\n');input.write(JSON.stringify({action:'list'})+'\n');input.write('x'.repeat(4097)+'\n');await detach();input.destroy();
 assert.deepEqual(commands,[{action:'list'}]);assert.equal(outputs.length,3);assert.ok(outputs.every(value=>!JSON.stringify(value).includes('capability')));
});
