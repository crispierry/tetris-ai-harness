import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,chmod,stat,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {qualifiedDecisionPilot,pilotUsage,pilotPublicPolicy} from '../decision-pilot-qualification.mjs';
import {openDecisionStore,digest} from '../decision-store.mjs';
import {createDecisionPilotService,createDecisionService} from '../decision-service.mjs';
import {runDecisionPilot,PILOT_OPENING} from '../decision-pilot-runner.mjs';
import {bootstrapLiveDecisionService,decisionStartupMode} from '../decision-bootstrap.mjs';
import {Controller,heuristic} from '../public/controller.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
const dummy='dummy_pilot_credential_for_offline_fixtures_only';
const keyHash=createHash('sha256').update(dummy).digest('hex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function configuration(now=Date.now()){
 const qualification={kind:'owner-risk-accepted-decisions-pilot-1',model:'gpt-6-luna',endpoint:'https://api.openai.com/v1/decisions',method:'POST',requestSchema:'decisions-create-fixed-1',maxBodyBytes:1048576,maxResponseBytes:65536,pilotStartedAt:now,riskAcceptance:{acceptedBy:'Cris',acceptedAt:now,evidenceReference:'dummy approval',riskCode:'unquantified-project-hard-limit-enforcement-delay'},projectEvidence:{projectId:'proj_dummy_offline_only',keyFingerprint:keyHash,keyProjectBindingVerified:true,thresholdAmountCents:100,currency:'USD',interval:'month',enforcementStatus:'enforcing',checkedAt:now,evidenceReference:'dummy private evidence'}};
 const policy={kind:'risk-accepted-project-pilot-policy-1',qualificationDigest:digest(qualification),maxAttempts:3,maxRuns:1,maxEpochs:1,maxPlacements:3,maxConcurrentUpstream:1,timeoutMs:1500,expiresAt:now+60000,retryLimit:0,fallback:'none'};
 return {qualification,policy};
}
async function directory(t){const dir=await mkdtemp(path.join(await realpath(os.tmpdir()),'decision-pilot-dummy-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function fixture(t,{fetchImpl,config=configuration()}={}){
 const root=await directory(t),directoryPath=path.join(root,'ledger'),store=await openDecisionStore({directory:directoryPath,lineage:'dummy-pilot',policy:config.policy,enroll:true});
 const service=createDecisionPilotService({store,...config,credential:dummy,fetchImpl:fetchImpl??responseFixture()});const grant=await service.owner.issueRun({laneId:'pilot',controllerSessionBase:'pilot'});
 t.after(()=>service.close().catch(()=>{}));return {root,directory:directoryPath,store,service,grant,...config};
}
function responseFixture({usage={input_tokens:10,output_tokens:0,total_tokens:10},status=200,hold,inspect}={}){return async(url,options)=>{inspect?.(url,options);if(hold)await hold();const request=JSON.parse(options.body),ids=request.questions[0].choices.map(c=>c.value);return new Response(JSON.stringify({model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,n)=>({value,probability:n?0:1}))}],...(usage===undefined?{}:{usage})}),{status});};}
async function packet(){let p;const c=new Controller({sessionId:'pilot',provider:{...heuristic(),async decide(packet){p=packet;throw new Error('capture only');}}});await c.step();return p;}

test('pilot qualification exact private project/key/approval binding rejects changed or widened admission; ordinary bootstrap stays strict/off',async()=>{
 const {qualification:q,policy:p}=configuration();assert(qualifiedDecisionPilot(q,p));
 const changes=[x=>x.qualification.kind='owner-qualified-decisions-live-v2',x=>x.qualification.projectEvidence.thresholdAmountCents=101,x=>x.qualification.projectEvidence.keyProjectBindingVerified=false,x=>x.qualification.projectEvidence.currency='EUR',x=>x.qualification.projectEvidence.interval='day',x=>x.qualification.projectEvidence.enforcementStatus='advisory',x=>x.qualification.projectEvidence.checkedAt-=900001,x=>x.qualification.projectEvidence.keyFingerprint='wrong',x=>x.qualification.riskAcceptance.acceptedBy='Other',x=>x.qualification.riskAcceptance.riskCode='none',x=>x.policy.maxAttempts=4,x=>x.policy.timeoutMs=1501,x=>x.policy.maxRuns=2,x=>x.policy.maxEpochs=2,x=>x.policy.maxPlacements=4,x=>x.policy.maxConcurrentUpstream=2,x=>x.policy.retryLimit=1,x=>x.policy.fallback='heuristic',x=>x.policy.expiresAt++,x=>x.policy.qualificationDigest='a'.repeat(64),x=>x.policy.reservationTokens=1];
 for(const change of changes){const x=structuredClone({qualification:q,policy:p});change(x);assert.equal(qualifiedDecisionPilot(x.qualification,x.policy),false);}
 assert.equal(qualifiedDecisionPilot(q,p,p.expiresAt),false);let keyReads=0;assert.equal(await bootstrapLiveDecisionService({args:[],loadCredential:async()=>{keyReads++;return dummy;}}),null);assert.equal(keyReads,0);assert.throws(()=>decisionStartupMode(['--decision-pilot-owner']));
 await assert.rejects(bootstrapLiveDecisionService({args:['--decision-live-owner','--decision-live-config=/dummy'],readConfig:async()=>({directory:'/tmp/dummy',lineage:'dummy',qualification:q,policy:p}),loadCredential:async()=>{keyReads++;return dummy;}}));assert.equal(keyReads,0);
});

test('pilot count-only admission commits before exact project-scoped POST; three calls, no refill, no public numeric reservation',async t=>{
 let f,calls=0;f=await fixture(t,{fetchImpl:responseFixture({inspect:(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/decisions');assert.equal(options.headers['OpenAI-Project'],'proj_dummy_offline_only');assert.equal(options.headers.authorization,`Bearer ${dummy}`);assert.equal(f.store.snapshot().used.attempts,calls);assert.equal(Object.values(f.store.snapshot().requests).at(-1).status,'dispatch-intent');}})});
 let receipt;const controller=new Controller({sessionId:'pilot',provider:{...heuristic(),kind:'pilot',async decide(p,{signal}){const r=await f.service.decide(f.grant.capability,p,{signal});receipt=r.receipt;return r.choice;}}});
 for(let n=0;n<3;n++)await controller.step();assert.equal(controller.view.pieces,3);assert.equal(calls,3);assert.equal(receipt.reservedInputTokens,null);assert.equal(receipt.estimatedReservationMicros,null);assert.equal(receipt.actualCostUSD,null);assert.equal(receipt.remainingAllowance.attempts,0);assert.deepEqual(f.store.snapshot().used,{attempts:3,inputTokens:0,estimatedMicros:0});
 await controller.step();assert.equal(calls,3);assert.equal(f.store.snapshot().runs[f.grant.runId].interrupted,true);await assert.rejects(f.service.owner.issueRun({laneId:'other',controllerSessionBase:'other'}));
 const publicPolicy=pilotPublicPolicy(f.policy,f.store.snapshot().policyDigest);assert.equal(publicPolicy.actualCostUSD,null);assert.equal(publicPolicy.spendControl.enforcementDelayOvershoot,'unquantified');
});

test('every authenticated predispatch/schema/provider/usage failure durably stops without retries or fallback',async t=>{
 for(const mode of ['predispatch','usage','authentication','rate','model','refusal','size']){
  let calls=0;const fetchImpl=async(...args)=>{calls++;if(mode==='size')return new Response('x'.repeat(65537));if(mode==='refusal')return new Response(JSON.stringify({model:'gpt-6-luna',answers:[{name:'placement',type:'refusal'}],usage:{input_tokens:1,output_tokens:0,total_tokens:1}}));if(mode==='model'){const r=await responseFixture()(...args);return new Response((await r.text()).replace('gpt-6-luna','wrong-model'));}return responseFixture({status:mode==='authentication'?401:mode==='rate'?429:200,usage:mode==='usage'?null:{input_tokens:1,output_tokens:0,total_tokens:1}})(...args);};
  const f=await fixture(t,{fetchImpl});const p=structuredClone(await packet());if(mode==='predispatch')p.stateRevision=100;
  await assert.rejects(f.service.decide(f.grant.capability,p));assert.equal(f.store.snapshot().runs[f.grant.runId].interrupted,true);const before=calls;await assert.rejects(f.service.decide(f.grant.capability,await packet()));assert.equal(calls,before);assert.equal(calls,mode==='predispatch'?0:1);
 }
 for(const raw of [null,{}, {input_tokens:1,output_tokens:-1,total_tokens:0},{input_tokens:1,output_tokens:1,total_tokens:1},{input_tokens:1,output_tokens:0,total_tokens:1,cached_input_tokens:2},{input_tokens:1,output_tokens:0,total_tokens:1,input_tokens_details:{cached_tokens:-1}}])assert.throws(()=>pilotUsage(raw));
});

test('abort-ignoring actual upstream retains slot and ledger lock after cancellation until settlement; reopening cannot refill uncertain lineage',async t=>{
 let release,entered;const gate=new Promise(r=>entered=r);const f=await fixture(t,{fetchImpl:responseFixture({hold:()=>new Promise(r=>{release=r;entered();})})});const abort=new AbortController();const work=f.service.decide(f.grant.capability,await packet(),{signal:abort.signal});await gate;abort.abort();await assert.rejects(work);assert.equal(f.store.snapshot().used.attempts,1);await assert.rejects(f.service.decide(f.grant.capability,await packet()));await assert.rejects(f.service.close(),{code:'drain_pending'});
 await assert.rejects(openDecisionStore({directory:f.directory,lineage:'dummy-pilot',policy:f.policy}));release();await wait(10);await f.service.close();await assert.rejects(openDecisionStore({directory:f.directory,lineage:'dummy-pilot',policy:f.policy,enroll:true}),{code:'reconciliation_required'});
});

test('foreground dummy pilot produces real Controller→Journal→saved-byte verification with public null costs, private manifest and no identifiers',async t=>{
 const root=await directory(t),config={...configuration(),directory:path.join(root,'ledger'),lineage:'dummy-runner',recordFile:path.join(root,'record.json'),manifestFile:path.join(root,'manifest.json')},configFile=path.join(root,'config.json');await writeFile(configFile,JSON.stringify(config),{mode:0o600});let openings,loads=0,calls=0;
 const result=await runDecisionPilot({configFile,enroll:true,loadCredential:async()=>{loads++;return dummy;},fetchImpl:responseFixture({inspect:()=>calls++}),onOpening:x=>openings=x});assert.equal(result.ok,true);assert.equal(result.stopReason,'placement_cap');assert.equal(loads,1);assert.equal(calls,3);assert.deepEqual(openings,PILOT_OPENING);
 const bytes=await readFile(config.recordFile),r=JSON.parse(bytes);assert.equal(verifyDecisionUIRecord(bytes.toString()).ok,true);assert.equal(r.finals[0].pieces,3);assert.equal(r.metadata.accounting.actualCostUSD,null);assert.equal(r.metadata.accounting.reservedInputTokens,null);assert.equal(r.events.filter(e=>e.input.receipt).length,3);
 const text=bytes.toString();for(const privateValue of [dummy,keyHash,config.qualification.projectEvidence.projectId,'dummy private evidence','dummy approval'])assert(!text.includes(privateValue));
 const manifest=JSON.parse(await readFile(config.manifestFile,'utf8'));assert.equal(manifest.attempts,3);assert.equal(manifest.completedResponses,3);assert.equal(manifest.uncertain,0);assert.equal(manifest.actualCostUSD,null);assert.equal(manifest.recordSHA256,createHash('sha256').update(bytes).digest('hex'));assert.equal((await stat(config.recordFile)).mode&0o777,0o600);
 for(const mutate of [x=>x.lanes[0].policy.actualCostUSD=0,x=>x.lanes[0].policy.limits.maxAttempts=4,x=>x.lanes[0].policy.spendControl.enforcementDelayOvershoot='none',x=>x.lanes[0].policy.projectId='secret',x=>x.metadata.accounting.actualCostUSD=0,x=>x.metadata.accounting.reservedInputTokens=0,x=>x.events.find(e=>e.input.receipt).input.receipt.usage=null,x=>x.events.find(e=>e.input.receipt).input.receipt.selectedCandidateId='wrong']){const x=structuredClone(r);mutate(x);assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(x)));}
});

test('pilot startup refuses wrong key and stale/digest-mismatched policy before dispatch, qualification before credential load',async t=>{
 for(const mode of ['qualification','key','digest']){
  const root=await directory(t),config={...configuration(),directory:path.join(root,'ledger'),lineage:'dummy-reject',recordFile:path.join(root,'record.json'),manifestFile:path.join(root,'manifest.json')};if(mode==='qualification')config.qualification.projectEvidence.enforcementStatus='hold';if(mode==='digest')config.policy.qualificationDigest='a'.repeat(64);let loads=0,calls=0;
  const r=await runDecisionPilot({configFile:'/unused',enroll:true,readConfig:async()=>config,loadCredential:async()=>{loads++;return 'wrong_dummy_key';},fetchImpl:async()=>{calls++;throw new Error(dummy);}});assert.equal(r.ok,false);assert.equal(calls,0);assert.equal(loads,mode==='key'?1:0);assert(!JSON.stringify(r).includes(dummy));
 }
});
