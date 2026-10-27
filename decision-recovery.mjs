// Explicit OS-owner recovery only. No credentials, provider calls or HTTP route.
import {readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openDecisionStore,digest} from './decision-store.mjs';
import {readPrivateOwnerFile} from './decision-bootstrap.mjs';
import {qualifiedDecisionBrowser} from './decision-browser-qualification.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function proof(reference){const bytes=await readPrivateOwnerFile(reference,65536);return {reference,sha256:sha(bytes),value:JSON.parse(bytes)};}
async function backup(file,bytes){let h;try{h=await open(file,'wx',0o600);await h.writeFile(bytes);await h.sync();}catch(e){if(e.code!=='EEXIST'||!Buffer.from(await readPrivateOwnerFile(file,16000000)).equals(bytes))throw e;}finally{await h?.close();}const d=await open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}
export async function reconcileAbandonedBrowserRequest({config,expectedLedgerSHA256,requestKey,authorizationReference,drainReference,successorLineage}={}){
 if(config?.policy?.kind!=='risk-accepted-project-browser-policy-1'||digest(config.qualification)!==config.policy.qualificationDigest||!/^[A-Za-z0-9_-]{1,80}$/.test(successorLineage??'')||successorLineage===config.lineage)fail('recovery_input');
 const authority=await proof(authorizationReference),drain=await proof(drainReference),d=drain.value;
 if(authority.value.actor!=='Cris'||d.supervisedExitCode!==0||d.localFetchAndResponseStreamSettled!==true||d.ledgerOwnerLockReleased!==true||d.afterDrainLedgerSHA256!==expectedLedgerSHA256||!Number.isSafeInteger(d.serverPID)||d.serverPID<=1)fail('recovery_evidence');
 try{process.kill(d.serverPID,0);fail('recovery_server_alive');}catch(e){if(e.code!=='ESRCH')throw e;}
 const store=await openDecisionStore({...config,ownerRecovery:{expectedLedgerSHA256}});
 try{
  const before=await store.inspect(),entry=before.requests[requestKey];
  if(before.successor||before.browserSession?.ownerHold!==true||before.browserSession.reason!=='request_interrupted'||!entry||entry.status!=='uncertain'||entry.deliveryPending!==false||Object.values(before.runs).some(r=>!r.closed)||Object.values(before.requests).filter(r=>r.status==='uncertain').length!==1||Object.values(before.requests).some(r=>r.deliveryPending||['reserved','dispatch-intent'].includes(r.status)))fail('recovery_state');
  const bytes=await readFile(path.join(config.directory,'ledger.json'));if(sha(bytes)!==expectedLedgerSHA256)fail('recovery_conflict');
  const backupFile=path.join(config.directory,`before-recovery-${expectedLedgerSHA256}.json`);await backup(backupFile,bytes);
  const body={version:1,resolution:'owner-abandon-no-retry',actor:'Cris',recordedAt:Date.now(),upstreamOutcome:'unknown',actualCostUSD:null,requestKey,originalEntry:structuredClone(entry),beforeLedgerSHA256:expectedLedgerSHA256,backupFile,authorization:{reference:authority.reference,sha256:authority.sha256},drain:{reference:drain.reference,sha256:drain.sha256,localFetchAndResponseStreamSettled:true,supervisedExitCode:0,ledgerOwnerLockReleased:true},successorLineage};const id=digest(body),event={id,...body};
  await store.transact(s=>{if(digest(s)!==digest(before))fail('recovery_conflict');s.ownerReconciliations={...(s.ownerReconciliations??{}),[id]:event};s.requests[requestKey]={...s.requests[requestKey],status:'reconciled-abandoned',reconciliationId:id};for(const r of Object.values(s.runs)){r.closed=true;r.interrupted=true;}s.browserSession={version:1,ownerHold:true,reconciliationRequired:true,reason:'owner_abandoned_retired'};});
  return {reconciliationId:id,backupFile,usedAttempts:before.used.attempts,providerOutcome:'unknown',actualCostUSD:null,retired:true};
 }finally{await store.close();}
}
export async function prepareBrowserSuccessor({previousConfig,nextConfig}={}){
 const a=previousConfig?.qualification?.projectEvidence,b=nextConfig?.qualification?.projectEvidence;
 if(!qualifiedDecisionBrowser(nextConfig?.qualification,nextConfig?.policy)||!a||digest(previousConfig.qualification)!==previousConfig.policy.qualificationDigest||a.projectId!==b.projectId||a.keyFingerprint!==b.keyFingerprint||b.thresholdAmountCents!==100||b.currency!=='USD'||b.interval!=='month'||previousConfig.directory===nextConfig.directory||previousConfig.lineage===nextConfig.lineage)fail('successor_configuration');
 const old=await openDecisionStore(previousConfig);let next;
 try{
  const before=await old.inspect(),events=Object.values(before.ownerReconciliations??{}),event=events.at(-1);
  if(before.browserSession?.reason!=='owner_abandoned_retired'||!before.browserSession.ownerHold||!event||event.successorLineage!==nextConfig.lineage||Object.values(before.runs).some(r=>!r.closed)||before.used.attempts>=nextConfig.policy.maxAttempts)fail('successor_state');
  const binding={lineage:nextConfig.lineage,directory:nextConfig.directory,policyDigest:digest(nextConfig.policy),reconciliationId:event.id};
  if(before.successor&&digest(before.successor)!==digest(binding))fail('successor_conflict');
  if(!before.successor)await old.transact(s=>{s.successor=binding;});
  const oldBytes=await readFile(path.join(previousConfig.directory,'ledger.json'));
  const predecessor={version:1,lineage:previousConfig.lineage,ledgerSHA256:sha(oldBytes),reconciliationId:event.id,usedAttempts:before.used.attempts};
  // Inherited debits are in the first durable ledger write; a failed carry can
  // never expose an ordinary zero-allowance-history enrollment artifact.
  next=await openDecisionStore({...nextConfig,enroll:true,successorSeed:{used:before.used,predecessor}});const snapshot=await next.inspect();
  if(!snapshot.predecessor||digest(snapshot.predecessor)!==digest(predecessor))fail('successor_conflict');
  return {lineage:nextConfig.lineage,inheritedAttempts:before.used.attempts,remainingAttempts:nextConfig.policy.maxAttempts-(await next.inspect()).used.attempts,expiresAt:nextConfig.policy.expiresAt};
 }finally{await next?.close();await old.close();}
}
