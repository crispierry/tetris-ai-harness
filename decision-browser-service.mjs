import {replayGravityProof,stateFromObservation} from './public/ai-gravity.mjs';
import {recordedObservation} from './public/decision-record.mjs';
import {observe} from './public/harness.mjs';
// Local owner-paired browser risk session. Strict and pilot services are separate.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {digest} from './decision-store.mjs';
import {canonicalPacket} from './decision-service.mjs';
import {requestFor,parse} from './choice-protocol.mjs';
import {pilotUsage} from './decision-pilot-qualification.mjs';
import {qualifiedDecisionBrowser,BROWSER_MODE,BROWSER_LIMITS,BROWSER_SPEND,BROWSER_QUALIFICATION_KIND} from './decision-browser-qualification.mjs';
import {freeze} from './public/harness.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const same=(a,b)=>digest(a)===digest(b);
export async function createDecisionBrowserService({store,policy,qualification,credential,fetchImpl=globalThis.fetch}={}){
 policy=freeze(structuredClone(policy));qualification=freeze(structuredClone(qualification));
 if(!store||store.fixtureOnly||store.recoveryOnly||!qualifiedDecisionBrowser(qualification,policy)||typeof credential!=='string'||createHash('sha256').update(credential,'utf8').digest('hex')!==qualification.projectEvidence.keyFingerprint||typeof fetchImpl!=='function'||store.snapshot().policyDigest!==digest(policy))fail('browser_configuration');
 if(!store.snapshot().browserSession){await store.transact(s=>{if(Object.keys(s.runs).length||s.used.attempts)fail('reconciliation_required');s.browserSession={version:1,ownerHold:false,reconciliationRequired:false,reason:null};});}
 const initial=store.snapshot().browserSession;
 if(initial.version!==1||typeof initial.ownerHold!=='boolean'||typeof initial.reconciliationRequired!=='boolean'||(initial.reason!==null&&typeof initial.reason!=='string'))fail('reconciliation_required');
 let closing=false,broken=false,slot=null;const operations=new Set(),operationRuns=new Map(),upstreams=new Set();
 const session=()=>store.snapshot().browserSession;
 const expired=()=>Date.now()>=policy.expiresAt;
 const pendingDelivery=(includeGravity=true)=>Object.values(store.snapshot().requests).some(r=>r.deliveryPending&&(includeGravity||!r.gravity));
 const status=()=>freeze({available:!closing&&!broken&&store.sound&&!expired()&&!session().ownerHold&&!pendingDelivery(false)&&store.snapshot().used.attempts<1000&&qualifiedDecisionBrowser(qualification,policy),reason:closing?'shutdown':broken||!store.sound?'store_unavailable':expired()?'session_expired':session().ownerHold?session().reason:pendingDelivery(false)?'completion_unacknowledged':store.snapshot().used.attempts>=1000?'session_request_limit':'owner-risk-accepted-browser',mode:BROWSER_MODE});
 const auth=(capability,s,{read=false}={})=>{if(typeof capability!=='string'||!/^[a-f0-9]{64}$/.test(capability))fail('unauthorized');const r=Object.values(s.runs).find(r=>r.capabilityDigest===digest(capability));if(!r||(!read&&(r.closed||r.terminal||r.interrupted)))fail('unauthorized');return r;};
 const hold=async(reason)=>{try{await store.transact(s=>{s.browserSession.ownerHold=true;s.browserSession.reconciliationRequired=true;s.browserSession.reason??=reason;});}catch{broken=true;}};
 async function settledRead(runId){await Promise.allSettled([...operations].filter(work=>operationRuns.get(work)===runId));if(expired()&&!session().ownerHold)await hold('session_expired');return store.inspect();}
 function accounting(s,r){const requests=Object.values(s.requests).filter(x=>x.runId===r.id),global=s.browserSession,pending=Object.values(s.requests).some(x=>x.deliveryPending&&(!x.gravity||x.runId===r.id));
  return freeze({version:r.gravityMode?'decision-browser-gravity-accounting-1':'decision-browser-accounting-1',mode:BROWSER_MODE,provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel:requests.findLast(x=>x.status==='completed')?.observedModel??null,endpoint:'https://api.openai.com/v1/decisions',protocol:'decisions-http-1',qualificationKind:BROWSER_QUALIFICATION_KIND,accountingMode:'project-hard-limit-delay-risk',policyDigest:s.policyDigest,limits:BROWSER_LIMITS,spendControl:BROWSER_SPEND,expiresAt:policy.expiresAt,epoch:r.epoch,attempts:s.used.attempts,remainingAttempts:Math.max(0,1000-s.used.attempts),runAttempts:requests.filter(x=>x.upstream).length,completions:requests.filter(x=>x.status==='completed').length,placements:r.placements,uncertain:requests.filter(x=>['uncertain','dispatch-intent'].includes(x.status)).length,usage:requests.findLast(x=>x.status==='completed')?.usage??null,ownerHold:global.ownerHold||broken||pending,reconciliationRequired:global.reconciliationRequired||broken||pending,reason:pending?'completion_unacknowledged':broken?'store_unavailable':global.reason??(s.used.attempts>=1000?'session_request_limit':r.reason??null),resetDisposition:global.ownerHold||broken||requests.some(x=>x.deliveryPending)||slot?'reconciliation-required':'settled-safe',interrupted:r.interrupted,terminal:r.terminal,reservedInputTokens:null,estimatedReservationMicros:null,remainingReservedInputTokens:null,remainingEstimatedMicros:null,actualExternalCalls:null,actualCostUSD:null});
 }
 async function control(capability,action,epoch,{requestId,proof,observation}={}){
  let s=await store.inspect(),r=auth(capability,s,{read:true});
  if(action!=='settleGravity'&&(proof!==undefined||observation!==undefined))fail('input');
  if(action==='runStatus'){if(epoch!==undefined||requestId!==undefined)fail('input');s=await settledRead(r.id);return accounting(s,s.runs[r.id]);}
  if(action==='currentEpoch'){if(epoch!==undefined||requestId!==undefined)fail('input');return {epoch:r.epoch,maxEpochs:100,ownerHold:s.browserSession.ownerHold,resetDisposition:s.browserSession.ownerHold||slot||Object.values(s.requests).some(x=>x.runId===r.id&&x.deliveryPending)?'reconciliation-required':'settled-safe'};}
  if(action==='settleGravity'){
   if(epoch!==undefined||typeof requestId!=='string'||requestId.length>200)fail('input');
   await store.transact(next=>{const run=auth(capability,next,{read:true}),entry=Object.values(next.requests).find(x=>x.runId===run.id&&x.requestId===requestId);
    if(!entry?.gravity||entry.status!=='completed'||!entry.deliveryPending||next.browserSession.ownerHold||expired())fail('reconciliation_required');
    try{const initial=stateFromObservation(entry.gravity.observation,observation?.next?.[4]),binding={sessionId:entry.gravity.observation.sessionId,revision:entry.gravity.observation.revision};
     const turn=replayGravityProof(initial,binding,proof,{selectedCandidateId:entry.gravity.selectedCandidateId}),actual=recordedObservation(observe(turn.state,{sessionId:binding.sessionId,revision:binding.revision+1}));
     if(!same(actual,observation)||turn.proof.placementLimit>1000-run.placements)fail('input');run.gravityExpected=actual;run.expected=null;run.placements+=turn.locks;run.terminal=['over','won'].includes(actual.status);entry.deliveryPending=false;entry.gravitySettled={locked:turn.locked,missed:turn.missed};
    }catch{fail('input');}
   });return {accepted:true};
  }
  if(action==='acceptDecision'){
   if(epoch!==undefined||typeof requestId!=='string'||requestId.length>200)fail('input');
   await store.transact(next=>{const run=auth(capability,next,{read:true}),entry=Object.values(next.requests).find(x=>x.runId===run.id&&x.requestId===requestId);if(!entry||entry.gravity||entry.status!=='completed'||!entry.deliveryPending||next.browserSession.ownerHold||expired())fail('reconciliation_required');entry.deliveryPending=false;});return {accepted:true};
  }
  if(action==='interrupt'){
   slot?.runId===r.id&&slot.abort.abort();
   const dispatched=Object.values(s.requests).some(x=>x.runId===r.id&&(!requestId||x.requestId===requestId)&&(x.deliveryPending||['dispatch-intent','uncertain','completed'].includes(x.status)));
   if(dispatched)await hold('request_interrupted');
   await store.transact(next=>{next.runs[r.id].interrupted=true;next.runs[r.id].reason='request_interrupted';});return {interrupted:true};
  }
  if(action==='close'){if(epoch!==undefined)fail('input');if(slot?.runId===r.id)slot.abort.abort();if(Object.values(s.requests).some(x=>x.runId===r.id&&x.deliveryPending))await hold('completion_unacknowledged');await store.transact(next=>{next.runs[r.id].closed=true;});return {closed:true,epoch:r.epoch};}
  if(action!=='advanceEpoch'||!Number.isInteger(epoch)||epoch!==r.epoch+1||epoch>=100)fail('epoch');
  if(slot?.runId===r.id||s.browserSession.ownerHold||Object.values(s.requests).some(x=>x.runId===r.id&&x.deliveryPending)||expired())fail('reconciliation_required');
  await store.transact(next=>{const run=auth(capability,next,{read:true});if(next.browserSession.ownerHold||run.closed||epoch!==run.epoch+1)fail('reconciliation_required');run.epoch=epoch;run.expected=null;delete run.gravityExpected;delete run.gravityMode;run.placements=0;run.terminal=false;run.interrupted=false;run.reason=null;});return {epoch,closed:false};
 }
 async function decide(capability,packet,{signal,gravity=false}={}){
  const run=auth(capability,store.snapshot(),{read:true});
  // Another grant never cancels the current actual upstream.
  if(slot)fail('overlap');
  if(!status().available){if(expired())await hold('session_expired');fail(status().reason==='session_request_limit'?'session_request_limit':'reconciliation_required');}
  auth(capability,store.snapshot());let job={abort:new AbortController(),runId:run.id,epoch:run.epoch},key=null,sent=false,completed=false,safeFailure=false,responseSettled=false,responseStatus=null,timer,listener;slot=job;
  const started=performance.now();
  const work=(async()=>{try{
   if(signal?.aborted)fail('cancelled');listener=()=>job.abort.abort();signal?.addEventListener('abort',listener,{once:true});
   const remaining=Math.min(1500,policy.expiresAt-Date.now(),packet?.deadlineMs??1500),deadline=Date.now()+remaining;if(remaining<=0)fail('session_expired');timer=setTimeout(()=>job.abort.abort(),remaining);
   const current=()=>{const s=store.snapshot(),r=s.runs[run.id];if(job.abort.signal.aborted||Date.now()>=deadline||expired()||closing||broken||s.browserSession.ownerHold||r.closed||r.epoch!==job.epoch||(!completed&&r.interrupted))fail('cancelled');};
   const p=canonicalPacket(packet,{gravity});if(p.observation.sessionId!==`${run.controllerSessionBase}-${run.epoch}`)fail('epoch');const request=requestFor('decisions',p,{model:'gpt-6-luna'});if(Buffer.byteLength(JSON.stringify(request.body))>1048576)fail('input');key=`${run.id}:${run.epoch}:${p.requestId}`;
   await store.transact(s=>{current();const r=auth(capability,s);if(s.browserSession.ownerHold||s.used.attempts>=1000)fail('session_request_limit');if(s.requests[key])fail('duplicate');if(r.placements>=1000)fail('limit');if(r.gravityMode!==undefined&&r.gravityMode!==gravity)fail('continuity');if(Object.values(s.requests).some(x=>x.runId===r.id&&x.deliveryPending))fail('reconciliation_required');if(gravity&&r.gravityExpected){if(!same(recordedObservation(p.observation),r.gravityExpected))fail('continuity');}else if(!r.expected){if(p.stateRevision!==1)fail('revision');}else{const e=r.expected,o=p.observation;if(p.stateRevision!==e.revision||!same(o.board,e.board)||!same(o.active,e.active)||o.score!==e.score||o.lines!==e.lines||o.level!==e.level||!same(o.next.slice(0,4),e.next))fail('continuity');}r.gravityMode=gravity;
    s.used.attempts++;s.requests[key]={digest:digest(p),status:'reserved',upstream:true,deadline,runId:run.id,epoch:run.epoch,requestId:p.requestId,deliveryPending:false};});current();
   await store.transact(s=>{current();s.requests[key].status='dispatch-intent';});current();sent=true;
   const dispatched=Promise.resolve().then(async()=>{const response=await fetchImpl('https://api.openai.com/v1/decisions',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${credential}`,'OpenAI-Project':qualification.projectEvidence.projectId},body:JSON.stringify(request.body),signal:job.abort.signal});let bytes=0,chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>65536){job.abort.abort();fail('size');}chunks.push(chunk);}let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('schema');}return {status:response.status,body};});job.dispatched=dispatched;upstreams.add(dispatched);
   const settled=()=>{upstreams.delete(dispatched);job.settled=true;if(job.finished&&slot===job)slot=null;};dispatched.then(settled,settled);
   const cancelled=new Promise((_,reject)=>{const abort=()=>reject(Object.assign(new Error('cancelled'),{code:'cancelled'}));if(job.abort.signal.aborted)abort();else job.abort.signal.addEventListener('abort',abort,{once:true});});
   const result=await Promise.race([dispatched,cancelled]);responseSettled=true;responseStatus=result.status;current();
   // Only an explicit native refusal is a definite safe lane failure. Generic quota is not a budget assertion.
   if(result.status===200&&typeof result.body?.model==='string'&&/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(result.body.model)&&Array.isArray(result.body.answers)&&result.body.answers.length===1&&result.body.answers[0].name==='placement'&&result.body.answers[0].type==='refusal'){pilotUsage(result.body?.usage);safeFailure=true;fail('refusal');}
   if(result.status===429){const code=result.body?.error?.code;fail(code==='project_spend_limit_exceeded'?'project_budget_limit':'quota_unknown');}
   const decoded=parse('decisions',result,p),usage=pilotUsage(result.body?.usage),observedModel=result.body.model,selected=p.candidates.find(c=>c.id===decoded.choice.selectedCandidateId);
   await store.transact(s=>{current();const r=s.runs[run.id];const entry=s.requests[key];if(gravity){entry.gravity={observation:p.observation,selectedCandidateId:decoded.choice.selectedCandidateId};}else{r.expected=selected.afterstate;r.placements++;r.terminal=selected.afterstate.status!=='playing';}entry.status='completed';entry.observedModel=observedModel;entry.usage=usage;entry.deliveryPending=true;});completed=true;current();
   return freeze({choice:decoded.choice,receipt:{version:gravity?'decision-browser-gravity-receipt-1':'decision-browser-receipt-1',provider:'OpenAI',requestedModel:'gpt-6-luna',observedModel,requestLatencyMs:performance.now()-started,completions:1,placements:gravity?0:1,actualExternalCalls:null,remainingAllowance:{attempts:Math.max(0,1000-store.snapshot().used.attempts)},completedResponses:1,mode:BROWSER_MODE,runId:run.id,laneId:run.laneId,epoch:run.epoch,lineage:store.snapshot().lineage,policyDigest:store.snapshot().policyDigest,usage,estimatedReservationMicros:null,reservedInputTokens:null,requestId:p.requestId,stateRevision:p.stateRevision,selectedCandidateId:decoded.choice.selectedCandidateId,attempts:1,actualCostUSD:null,usageProvenance:'Provider-reported usage; actual billing unknown; project-limit enforcement delay risk accepted',accountingMode:'project-hard-limit-delay-risk',qualificationKind:BROWSER_QUALIFICATION_KIND}});
  }catch(error){
   const code=['cancelled','session_expired','refusal','project_budget_limit','quota_unknown','authentication','rate_limit','model_mismatch','schema','size','pilot_usage_required','input','epoch','continuity','revision','duplicate','limit','session_request_limit','store_unavailable'].includes(error.code)?error.code:'transport_ambiguous';
   try{await store.transact(s=>{const r=s.runs[run.id];r.interrupted=true;r.reason=code;if(key&&s.requests[key]&&s.requests[key].status!=='completed')s.requests[key].status=sent&&!safeFailure&&(!responseSettled||responseStatus===200)?'uncertain':'rejected';});}catch{broken=true;}
   if((sent&&!safeFailure)||['session_expired','authentication','model_mismatch','pilot_usage_required','schema','quota_unknown','project_budget_limit','store_unavailable'].includes(code))await hold(code==='cancelled'?'request_interrupted':code);
   throw Object.assign(new Error(code),{code});
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',listener);job.abort.abort();job.finished=true;if(slot===job&&(!job.dispatched||job.settled))slot=null;}})();operations.add(work);operationRuns.set(work,run.id);try{return await work;}finally{operations.delete(work);operationRuns.delete(work);}
 }
 return Object.freeze({browserRisk:true,status,control,decide,owner:Object.freeze({async issueRun({laneId,controllerSessionBase}={}){
  if(!status().available||!/^[A-Za-z0-9_-]{1,60}$/.test(laneId??'')||!/^[A-Za-z0-9_-]{1,60}$/.test(controllerSessionBase??''))fail('unavailable');const capability=randomBytes(32).toString('hex'),id=randomUUID();await store.transact(s=>{if(!status().available||Object.keys(s.runs).length>=64)fail('limit');s.runs[id]={id,laneId,controllerSessionBase,capabilityDigest:digest(capability),expiresAt:policy.expiresAt,epoch:0,placements:0,expected:null,closed:false,terminal:false,interrupted:false,reason:null};});return freeze({capability,runId:id,epoch:0,expiresAt:policy.expiresAt,controllerSessionBase});
 }}),async close(){closing=true;slot?.abort.abort();await Promise.allSettled([...operations]);if(pendingDelivery())await hold('completion_unacknowledged');if(upstreams.size){let timer;try{await Promise.race([Promise.allSettled([...upstreams]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('drain_pending'),{code:'drain_pending'})),1000);})]);}finally{clearTimeout(timer);}}await store.close();}});
}
