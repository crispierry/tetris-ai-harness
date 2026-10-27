import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,chmod,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {openDecisionStore,digest} from '../decision-store.mjs';
import {reconcileAbandonedBrowserRequest,prepareBrowserSuccessor} from '../decision-recovery.mjs';
import {createDecisionBrowserService} from '../decision-browser-service.mjs';
const key='dummy_recovery_key_only',sha=b=>createHash('sha256').update(b).digest('hex');
function config(root,lineage,now=Date.now()){
 const qualification={kind:'owner-risk-accepted-decisions-browser-1',model:'gpt-6-luna',endpoint:'https://api.openai.com/v1/decisions',method:'POST',requestSchema:'decisions-create-fixed-1',maxBodyBytes:1048576,maxResponseBytes:65536,activationStartedAt:now,riskAcceptance:{acceptedBy:'Cris',acceptedAt:now,evidenceReference:'dummy owner recovery request',riskCode:'unquantified-project-hard-limit-enforcement-delay'},projectEvidence:{projectId:'proj_dummy_recovery',keyFingerprint:sha(key),keyProjectBindingVerified:true,thresholdAmountCents:100,currency:'USD',interval:'month',enforcementStatus:'enforcing',checkedAt:now,evidenceReference:'dummy project check',keyExpiresAt:now+7200000}};
 const policy={kind:'risk-accepted-project-browser-policy-1',qualificationDigest:digest(qualification),maxAttempts:1000,maxRuns:64,maxEpochs:100,maxPlacements:1000,maxConcurrentUpstream:1,timeoutMs:1500,expiresAt:now+3600000,retryLimit:0,fallback:'none'};
 return {directory:path.join(root,lineage),lineage,policy,qualification};
}
async function fixture(t){const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'tetris-owner-recovery-'));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));const previous=config(root,'old'),next=config(root,'next');const store=await openDecisionStore({...previous,enroll:true});
 await store.transact(s=>{s.used.attempts=28;s.browserSession={version:1,ownerHold:true,reconciliationRequired:true,reason:'request_interrupted'};s.runs.run={id:'run',capabilityDigest:'b'.repeat(64),epoch:1,placements:26,expected:null,closed:true,terminal:false,interrupted:true,expiresAt:previous.policy.expiresAt};s.requests.old={digest:'d'.repeat(64),status:'completed',upstream:true,runId:'run',epoch:0,requestId:'previous',deadline:Date.now()-1000,deliveryPending:false};s.requests.target={digest:'c'.repeat(64),status:'uncertain',upstream:true,runId:'run',epoch:1,requestId:'abandoned',deadline:Date.now()-1000,deliveryPending:false};});await store.close();
 const bytes=await readFile(path.join(previous.directory,'ledger.json')),expectedLedgerSHA256=sha(bytes),authorizationReference=path.join(root,'authority.json'),drainReference=path.join(root,'drain.json');
 const child=spawnSync(process.execPath,['-e','']);assert.equal(child.status,0);
 await writeFile(authorizationReference,JSON.stringify({actor:'Cris',request:'Resolve disclosed unknown outcome and reconnect under same $1 limit'}),{mode:0o600});const drain={supervisedExitCode:0,localFetchAndResponseStreamSettled:true,ledgerOwnerLockReleased:true,serverPID:child.pid,afterDrainLedgerSHA256:expectedLedgerSHA256};await writeFile(drainReference,JSON.stringify(drain),{mode:0o600});
 return {root,previous,next,bytes,drain,options:{config:previous,expectedLedgerSHA256,requestKey:'target',authorizationReference,drainReference,successorLineage:'next'}};
}
test('owner recovery blocks active lock, stale bytes and missing drain without modifying or refunding ledger',async t=>{
 const f=await fixture(t);await assert.rejects(openDecisionStore(f.previous),{code:'reconciliation_required'});
 const held=await openDecisionStore({...f.previous,ownerRecovery:{expectedLedgerSHA256:f.options.expectedLedgerSHA256}});
 await assert.rejects(reconcileAbandonedBrowserRequest(f.options),{code:'EEXIST'});await held.close();
 await assert.rejects(reconcileAbandonedBrowserRequest({...f.options,expectedLedgerSHA256:'0'.repeat(64)}),{code:'recovery_evidence'});
 await writeFile(f.options.drainReference,JSON.stringify({...f.drain,localFetchAndResponseStreamSettled:false}),{mode:0o600});await assert.rejects(reconcileAbandonedBrowserRequest(f.options),{code:'recovery_evidence'});
 assert.deepEqual(await readFile(path.join(f.previous.directory,'ledger.json')),f.bytes);
});
test('owner abandonment preserves original uncertainty, policy, attempts and exact bytes; old game remains retired',async t=>{
 const f=await fixture(t),before=JSON.parse(f.bytes),result=await reconcileAbandonedBrowserRequest(f.options);assert.equal(result.usedAttempts,28);assert.equal(result.providerOutcome,'unknown');assert.deepEqual(await readFile(result.backupFile),f.bytes);
 const old=await openDecisionStore(f.previous),s=old.snapshot();assert.deepEqual(s.used,before.used);assert.deepEqual(s.policy,before.policy);assert.equal(s.lineage,before.lineage);assert.deepEqual(s.requests.old,before.requests.old);assert.deepEqual(s.ownerReconciliations[result.reconciliationId].originalEntry,before.requests.target);assert.equal(s.requests.target.status,'reconciled-abandoned');assert.equal(s.browserSession.ownerHold,true);assert.equal(s.browserSession.reason,'owner_abandoned_retired');assert.equal(s.runs.run.closed,true);
 const service=await createDecisionBrowserService({store:old,...f.previous,credential:key,fetchImpl:()=>{throw Error('must not dispatch');}});assert.equal(service.status().available,false);await assert.rejects(service.owner.issueRun({laneId:'new',controllerSessionBase:'new'}));await service.close();
 await assert.rejects(reconcileAbandonedBrowserRequest(f.options));
});
test('new successor carries debits exactly once and preserves monthly/project/key boundary without loading a credential',async t=>{
 const f=await fixture(t);await reconcileAbandonedBrowserRequest(f.options);
 await assert.rejects(prepareBrowserSuccessor({previousConfig:f.previous,nextConfig:{...f.next,lineage:'another'}}),{code:'successor_state'});
 const result=await prepareBrowserSuccessor({previousConfig:f.previous,nextConfig:f.next});assert.equal(result.inheritedAttempts,28);assert.equal(result.remainingAttempts,972);
 let next=await openDecisionStore(f.next);assert.equal(next.snapshot().used.attempts,28);assert.equal(next.snapshot().predecessor.usedAttempts,28);await next.transact(s=>{s.used.attempts++;});await next.close();
 const again=await prepareBrowserSuccessor({previousConfig:f.previous,nextConfig:f.next});assert.equal(again.remainingAttempts,971);
 next=await openDecisionStore(f.next);const service=await createDecisionBrowserService({store:next,...f.next,credential:key,fetchImpl:()=>{throw Error('must not dispatch');}});const grant=await service.owner.issueRun({laneId:'new',controllerSessionBase:'new'}),a=await service.control(grant.capability,'runStatus');assert.equal(a.attempts,29);assert.equal(a.remainingAttempts,971);assert.equal(a.actualCostUSD,null);await service.close();
 const wrong=structuredClone(f.next);wrong.qualification.projectEvidence.projectId='proj_other';wrong.policy.qualificationDigest=digest(wrong.qualification);await assert.rejects(prepareBrowserSuccessor({previousConfig:f.previous,nextConfig:wrong}),{code:'successor_configuration'});
});
test('ordinary reopen rejects forged disposition/history and successor counter regression',async t=>{
 const f=await fixture(t);await reconcileAbandonedBrowserRequest(f.options);const file=path.join(f.previous.directory,'ledger.json'),bytes=await readFile(file),s=JSON.parse(bytes);s.requests.target.digest='e'.repeat(64);await writeFile(file,JSON.stringify(s),{mode:0o600});await assert.rejects(openDecisionStore(f.previous),{code:'damaged_store'});await writeFile(file,bytes,{mode:0o600});await prepareBrowserSuccessor({previousConfig:f.previous,nextConfig:f.next});const nextFile=path.join(f.next.directory,'ledger.json'),n=JSON.parse(await readFile(nextFile));n.used.attempts=0;await writeFile(nextFile,JSON.stringify(n),{mode:0o600});await assert.rejects(openDecisionStore(f.next),{code:'damaged_store'});
});
test('another unresolved request refuses abandonment; recovery handles cannot enable browser service',async t=>{
 const f=await fixture(t),held=await openDecisionStore({...f.previous,ownerRecovery:{expectedLedgerSHA256:f.options.expectedLedgerSHA256}});await assert.rejects(createDecisionBrowserService({store:held,...f.previous,credential:key}),{code:'browser_configuration'});await held.transact(s=>{s.requests.second={...s.requests.target,requestId:'other'};});await held.close();const bytes=await readFile(path.join(f.previous.directory,'ledger.json')),hash=sha(bytes);await writeFile(f.options.drainReference,JSON.stringify({...f.drain,afterDrainLedgerSHA256:hash}),{mode:0o600});await assert.rejects(reconcileAbandonedBrowserRequest({...f.options,expectedLedgerSHA256:hash}),{code:'recovery_state'});assert.deepEqual(await readFile(path.join(f.previous.directory,'ledger.json')),bytes);
});

test('pending delivery, mismatched on-disk bytes and persistence failure remain closed with preserved evidence',async t=>{
 const f=await fixture(t);await writeFile(f.options.drainReference,JSON.stringify({...f.drain,afterDrainLedgerSHA256:'0'.repeat(64)}),{mode:0o600});await assert.rejects(reconcileAbandonedBrowserRequest({...f.options,expectedLedgerSHA256:'0'.repeat(64)}),{code:'recovery_conflict'});
 await writeFile(f.options.drainReference,JSON.stringify(f.drain),{mode:0o600});const fault=Object.assign(phase=>{if(phase==='before-rename')throw Error('dummy disk failure');},{mode:'fixture'});await assert.rejects(reconcileAbandonedBrowserRequest({...f.options,config:{...f.previous,faultInjection:fault}}),{code:'store_unavailable'});assert.deepEqual(await readFile(path.join(f.previous.directory,'ledger.json')),f.bytes);
 const held=await openDecisionStore({...f.previous,ownerRecovery:{expectedLedgerSHA256:f.options.expectedLedgerSHA256}});await held.transact(s=>{s.requests.old.deliveryPending=true;});await held.close();const bytes=await readFile(path.join(f.previous.directory,'ledger.json')),hash=sha(bytes);await writeFile(f.options.drainReference,JSON.stringify({...f.drain,afterDrainLedgerSHA256:hash}),{mode:0o600});await assert.rejects(reconcileAbandonedBrowserRequest({...f.options,expectedLedgerSHA256:hash}),{code:'reconciliation_required'});assert.deepEqual(await readFile(path.join(f.previous.directory,'ledger.json')),bytes);
});
