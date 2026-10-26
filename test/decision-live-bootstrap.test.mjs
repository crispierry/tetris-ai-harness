import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, chmod, symlink, link, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { conservativeReservationMicros, qualifiedDecisions, DECISIONS_SCHEMA } from '../decision-qualification.mjs';
import { readPrivateOwnerFile, readDecisionCredential, parseDecisionCredential, decisionStartupMode, bootstrapLiveDecisionService } from '../decision-bootstrap.mjs';
import { openDecisionStore } from '../decision-store.mjs';
import { createDecisionService } from '../decision-service.mjs';
import { createGame, start } from '../public/engine.mjs';
import { observe, enumerate, candidateEvidence } from '../public/harness.mjs';
import { instructionPacket } from '../public/briefing.mjs';
const dummy = 'dummy_source_fixture_not_a_real_key';
function configuration(now = Date.now()) {
  const tokens = 1050000, reservationMicros = conservativeReservationMicros(tokens);
  const policy = { maxAttempts:20, maxInputTokens:tokens*20, maxEstimatedMicros:10000000, expiresAt:now+240000, maxRuns:8, maxEpochs:8, maxPlacements:1000, timeoutMs:1500, reservationTokens:tokens, reservationMicros };
  // Synthetic evidence exercises the gate; it is not qualification of reality.
  const qualification = { kind:'owner-qualified-decisions-live-v2', model:'gpt-6-luna', endpoint:'https://api.openai.com/v1/decisions', method:'POST', requestSchema:DECISIONS_SCHEMA, maxBodyBytes:1048576, maxResponseBytes:65536, totalBillableInputCeiling:tokens, reservationTokens:tokens,
    ceilingEvidence:{ status:'qualified', model:'gpt-6-luna', endpoint:'https://api.openai.com/v1/decisions', requestSchema:DECISIONS_SCHEMA, totalBillableInputCeiling:tokens, includesQuestionsAndFraming:true, sourceURL:'https://developers.openai.com/api/reference/resources/decisions/methods/create', checkedAt:now-1000, validUntil:now+3600000 },
    inputMicrosPerMillion:100000, cacheWriteMicrosPerMillion:125000, cacheTTL:'30m', longContextMultiplier:2, regionalNumerator:11, regionalDenominator:10, outputBilling:'free', outputMicrosPerMillion:0, reservationMicros, pilotStartedAt:now-1000 };
  return { policy, qualification };
}
async function directory(t) { const d = await mkdtemp(path.join(await realpath(os.tmpdir()), 'decision-live-dummy-')); await chmod(d,0o700); t.after(()=>rm(d,{recursive:true,force:true})); return d; }
function packet(base) { const state=start(createGame()), binding={sessionId:base+'-0',revision:1}; return instructionPacket(observe(state,binding),enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),{requestId:base+'-request',deadlineMs:1500}); }
function answer(body) { const ids=body.questions[0].choices.map(c=>c.value);return { model:'gpt-6-luna', usage:{input_tokens:100,output_tokens:0,total_tokens:100,input_tokens_details:{cached_tokens:70,cache_write_tokens:20,private:'discard'}},answers:[{name:'placement',type:'choice',choice:ids[0],confidence:1,probabilities:ids.map((value,i)=>({value,probability:i?0:1}))}] }; }

test('Decisions v2 free output, applicable fresh complete-input evidence and exact conservative integer reservation',()=>{
  const now=Date.now(), c=configuration(now);assert.equal(conservativeReservationMicros(1050000),519750);assert.equal(conservativeReservationMicros(922000),456390);assert.equal(conservativeReservationMicros(1),1);
  assert.equal(qualifiedDecisions(c.qualification,c.policy,now),true);
  for(const mutate of [q=>q.outputMicrosPerMillion=1,q=>q.maxOutputTokens=4096,q=>q.framingTokenBound=1024,q=>q.ceilingEvidence.status='hold',q=>delete q.ceilingEvidence,q=>q.ceilingEvidence.includesQuestionsAndFraming=false,q=>q.ceilingEvidence.requestSchema='different',q=>q.ceilingEvidence.validUntil=now,q=>q.ceilingEvidence.checkedAt=now+1,q=>q.ceilingEvidence.totalBillableInputCeiling=922000,q=>q.cacheTTL='12h',q=>q.reservationMicros--,q=>q.totalBillableInputCeiling=NaN,q=>q.endpoint='https://evil.test',q=>q.ceilingEvidence.extra=true]) {
    const q=structuredClone(c.qualification);mutate(q);assert.equal(qualifiedDecisions(q,c.policy,now),false);
  }
  for(const patch of [{maxAttempts:21},{expiresAt:now+300001},{maxEstimatedMicros:10000001},{reservationTokens:1049600},{reservationMicros:1},{maxInputTokens:1}]) assert.equal(qualifiedDecisions(c.qualification,{...c.policy,...patch},now),false);
  assert.equal(qualifiedDecisions(c.qualification,c.policy,now+3600001),false);
});

test('strict bounded owner dummy file and parser reject modes, links, duplicates and interpolation with sanitized diagnostics',async t=>{
  const d=await directory(t), file=path.join(d,'dummy.env');await writeFile(file,'OPENAI_API_KEY='+dummy+'\n',{mode:0o600});
  assert.equal(await readDecisionCredential({file}),dummy);
  const realGetuid=process.getuid;try { process.getuid=()=>realGetuid()+1;await assert.rejects(readDecisionCredential({file}),/decision_live_startup_rejected/); } finally { process.getuid=realGetuid; }
  for(const value of ['OPENAI_API_KEY='+dummy+'\nOPENAI_API_KEY=another','export OPENAI_API_KEY='+dummy,'OPENAI_API_KEY=$(echo private)','OPENAI_API_KEY="'+dummy+'"','OPENAI_API_KEY='+dummy+'\nOTHER=1','OPENAI_API_KEY='+dummy+'\r\n','OPENAI_API_KEY='+dummy+'\n\n']) assert.throws(()=>parseDecisionCredential(value),/decision_live_startup_rejected/);
  await chmod(file,0o644);await assert.rejects(readDecisionCredential({file}),/decision_live_startup_rejected/);await chmod(file,0o600);
  await chmod(d,0o755);await assert.rejects(readDecisionCredential({file}),/decision_live_startup_rejected/);await chmod(d,0o700);
  const symbolic=path.join(d,'symbolic');await symlink(file,symbolic);await assert.rejects(readDecisionCredential({file:symbolic}),/decision_live_startup_rejected/);
  const hard=path.join(d,'hard');await link(file,hard);await assert.rejects(readDecisionCredential({file}),/decision_live_startup_rejected/);await rm(hard);
  const parentLink=d+'-link';await symlink(d,parentLink);try { await assert.rejects(readDecisionCredential({file:path.join(parentLink,'dummy.env')}),/decision_live_startup_rejected/); } finally { await rm(parentLink); }
  await writeFile(file,'x'.repeat(1025));await assert.rejects(readDecisionCredential({file}),/decision_live_startup_rejected/);
  await writeFile(file,Buffer.from([0xff]));await assert.rejects(readPrivateOwnerFile(file,1024),/decision_live_startup_rejected/);
  await assert.rejects(readDecisionCredential({file:path.join(d,'missing')}),error=>error.message==='decision_live_startup_rejected'&&!JSON.stringify(error).includes(d));
});

test('OFF/fixture/conflicting flags and unqualified owner configuration never invoke dummy credential loader',async()=>{
  let reads=0, configs=0; const loadCredential=async()=>{reads++;return dummy;}, readConfig=async()=>{configs++;return {...configuration(),directory:'/unused/dummy',lineage:'dummy'};};
  for(const args of [[],['--decision-fixture-owner'],['--decision-fixture-owner','--enroll-decision-fixture']]) assert.equal(await bootstrapLiveDecisionService({args,loadCredential,readConfig}),null);
  for(const args of [['--decision-live-owner'],['--decision-live-owner','--decision-fixture-owner'],['--enroll-decision-live'],['--decision-live-owner','--decision-live-owner'],['--decision-live-owner','--decision-live-config=/dummy','--enroll-decision-fixture'],['--decision-secret-value=forbidden'],['--decision-live-config=']]) await assert.rejects(bootstrapLiveDecisionService({args,loadCredential,readConfig}),/decision_live_startup_rejected/);
  assert.equal(reads,0);assert.equal(configs,0);
  await assert.rejects(bootstrapLiveDecisionService({args:['--decision-live-owner','--decision-live-config=/dummy'],loadCredential,readConfig:async()=>{const c=await readConfig();c.qualification.ceilingEvidence.status='hold';return c;}}),/decision_live_startup_rejected/);
  assert.equal(reads,0);
});

test('injected owner startup, fixed issuer/no redirect, nested subset usage, unknown billing and durable shutdown/reopen',async t=>{
  const d=await directory(t), ledger=path.join(d,'ledger'), c={...configuration(),directory:ledger,lineage:'dummy-live-only'};let reads=0, calls=0;
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/decisions');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+dummy);const body=JSON.parse(options.body);assert.equal(Object.hasOwn(body,'max_output_tokens'),false);return new Response(JSON.stringify(answer(body)),{status:200});};
  let service;
  try {
    const configFile=path.join(d,'dummy-owner.json');await writeFile(configFile,JSON.stringify(c),{mode:0o600});
    service=await bootstrapLiveDecisionService({args:['--decision-live-owner','--decision-live-config='+configFile,'--enroll-decision-live'],loadCredential:async()=>{reads++;return dummy;}});
    assert.equal(reads,1);assert.equal(service.status().available,true);
    const grant=await service.owner.issueRun({laneId:'dummy',controllerSessionBase:'dummy'}), result=await service.decide(grant.capability,packet('dummy'));
    assert.equal(calls,1);assert.deepEqual(result.receipt.usage,{input_tokens:100,output_tokens:0,total_tokens:100,input_tokens_details:{cached_tokens:70,cache_write_tokens:20}});
    assert.equal(result.receipt.actualCostUSD,null);assert.equal(result.receipt.estimatedReservationMicros,519750);assert.equal(result.receipt.reservedInputTokens,1050000);assert.equal(Object.isFrozen(result.receipt.usage.input_tokens_details),true);
    assert.equal(JSON.stringify(result).includes(dummy),false);assert.equal(JSON.stringify(service.status()).includes(dummy),false);
    await service.close();service=null;
    const store=await openDecisionStore({directory:ledger,lineage:c.lineage,policy:c.policy});assert.equal(store.snapshot().used.attempts,1);assert.equal(store.snapshot().used.estimatedMicros,519750);await store.close();
    assert.equal((await readFile(path.join(ledger,'ledger.json'),'utf8')).includes(dummy),false);
  } finally { globalThis.fetch=oldFetch;await service?.close(); }
});

test('shared $10 final reservation allows 19 and rejects concurrent twentieth without refund or dispatch',async t=>{
  const d=await directory(t), c=configuration(), store=await openDecisionStore({directory:path.join(d,'ledger'),lineage:'reserve-dummy',policy:c.policy,enroll:true});
  const service=createDecisionService({enabled:true,store,...c,credential:dummy});let calls=0;const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls++;return new Response(JSON.stringify(answer(JSON.parse(options.body))),{status:200});};
  try {
    // Model 18 prior conservatively retained attempts without creating fake responses.
    await store.transact(s=>{s.used={attempts:18,inputTokens:18*1050000,estimatedMicros:18*519750};});
    const a=await service.owner.issueRun({laneId:'a',controllerSessionBase:'a'}),b=await service.owner.issueRun({laneId:'b',controllerSessionBase:'b'});
    const results=await Promise.allSettled([service.decide(a.capability,packet('a')),service.decide(b.capability,packet('b'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'budget');assert.equal(calls,1);
    assert.deepEqual(store.snapshot().used,{attempts:19,inputTokens:19950000,estimatedMicros:9875250});
    await service.control(a.capability,'advanceEpoch',1);assert.equal(store.snapshot().used.attempts,19);
  } finally {globalThis.fetch=oldFetch;await service.close();}
});


test('qualification is immutable and stale evidence disables the service before a further admission',async t=>{
  const d=await directory(t), c=configuration();c.qualification.ceilingEvidence.validUntil=Date.now()+100;
  const store=await openDecisionStore({directory:path.join(d,'ledger'),lineage:'expiry-dummy',policy:c.policy,enroll:true});
  const service=createDecisionService({enabled:true,store,...c,credential:dummy});
  try {
    assert.equal(service.status().available,true);c.qualification.ceilingEvidence.status='hold';assert.equal(service.status().available,true);
    await new Promise(r=>setTimeout(r,110));assert.deepEqual(service.status(),{available:false,reason:'qualification_required'});
    await assert.rejects(service.owner.issueRun({laneId:'late',controllerSessionBase:'late'}),{code:'unavailable'});assert.equal(store.snapshot().used.attempts,0);
  } finally {await service.close();}
});

test('dummy loader failures are sanitized and release the newly opened durable store without copying the dummy value',async t=>{
  const d=await directory(t), c={...configuration(),directory:path.join(d,'ledger'),lineage:'failure-dummy'};
  await assert.rejects(bootstrapLiveDecisionService({args:['--decision-live-owner','--decision-live-config=/dummy','--enroll-decision-live'],readConfig:async()=>c,loadCredential:async()=>{throw Error(dummy);}}),e=>e.message==='decision_live_startup_rejected'&&!JSON.stringify(e).includes(dummy));
  const store=await openDecisionStore({directory:c.directory,lineage:c.lineage,policy:c.policy});assert.equal(store.snapshot().used.attempts,0);await store.close();
  assert.equal((await readFile(path.join(c.directory,'ledger.json'),'utf8')).includes(dummy),false);
});


test('observed input above the asserted ceiling holds further dispatch and retains the full uncertain reservation',async t=>{
  const d=await directory(t), c=configuration(), store=await openDecisionStore({directory:path.join(d,'ledger'),lineage:'counterexample-dummy',policy:c.policy,enroll:true});
  const service=createDecisionService({enabled:true,store,...c,credential:dummy});let calls=0;const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls++;const body=answer(JSON.parse(options.body));body.usage.input_tokens=1050001;return new Response(JSON.stringify(body),{status:200});};
  try {
    const grant=await service.owner.issueRun({laneId:'counterexample',controllerSessionBase:'counterexample'});
    await assert.rejects(service.decide(grant.capability,packet('counterexample')),{code:'qualification_required'});
    assert.deepEqual(service.status(),{available:false,reason:'qualification_required'});assert.equal(store.snapshot().used.attempts,1);assert.equal(store.snapshot().used.estimatedMicros,519750);
    assert.equal(Object.values(store.snapshot().requests)[0].status,'uncertain');
    await assert.rejects(service.decide(grant.capability,packet('counterexample')),{code:'unavailable'});assert.equal(calls,1);
  } finally {globalThis.fetch=oldFetch;await service.close();}
});
