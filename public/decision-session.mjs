import {COST_BASIS,COST_SOURCE} from './test-cost.mjs';
import {BROWSER_BUDGET_LINE,browserBlocked} from './browser-risk-contract.mjs';
import { createDecisionBridge } from './decision-bridge.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const when=expiry=>new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(expiry));
export function browserStatus(a,admission){
 if(a.freshness&&a.freshness!=='current')return 'Current session counts and billing are unavailable. Previous counts are stale. Reset does not refill the allowance.';
 const reason=a.reason;
 if(reason==='session_request_limit'||a.remainingAttempts===0)return 'OpenAI session request limit reached. No new OpenAI requests will be sent. Reset does not refill the allowance. Replay or export this run.';
 if(reason==='session_expired'||Date.now()>=admission.expiresAt)return 'OpenAI session expired. No new OpenAI requests will be sent. Replay or export this run. A new session needs local owner approval.';
 if(reason==='project_budget_limit')return 'OpenAI reports that the project budget limit was reached. No new OpenAI requests will be sent. Reset does not change the project budget. Replay or export this run.';
 if(a.ownerHold||a.reconciliationRequired){if(['request_interrupted','cancelled','completion_unacknowledged','transport_ambiguous'].includes(reason))return 'OpenAI request interrupted. It may still be billable. Local owner reconciliation is required before more OpenAI play.';const plain={authentication:'authentication failed',quota_unknown:'provider quota is unavailable',model_mismatch:'the observed model did not match',pilot_usage_required:'provider usage was missing or invalid',schema:'the provider response was invalid',store_unavailable:'the durable ledger is unavailable'}[reason]??'the session requires reconciliation';return `OpenAI play is stopped: ${plain}. Local owner reconciliation is required. Reset will not resume OpenAI play.`;}
 return `Live OpenAI connected. ${new Intl.NumberFormat().format(a.remainingAttempts)} session requests remain. Session ends ${when(admission.expiresAt)}. Start or Step to play.`;
}
function describeBrowser(a){const n=v=>Number.isSafeInteger(v)?new Intl.NumberFormat().format(v):'Unknown';return `Requested model: ${a.requestedModel}. Observed model: ${a.observedModel??'Unknown'}.\nTransport: Live OpenAI. Authorization: owner-approved browser session with accepted billing-delay risk.\nSession requests: ${n(a.attempts)} used; ${n(a.remainingAttempts)} of 1,000 remain across all games and tabs in this session. Reset, reload and replay do not refill this allowance.\nSession ends: ${when(a.expiresAt)}.\nThis run: ${n(a.runAttempts)} attempted requests; ${n(a.completions)} completed decisions; ${n(a.placements)} placements; ${n(a.uncertain)} uncertain requests.\nProject budget: USD 1.00 per month, shared with earlier usage, including the earlier pilot. Remaining billed budget: Unknown.\nBilling may be delayed and charges can exceed the configured project limit. The token ceiling is unverified. Actual billing: Unknown.\nUsage: ${a.usage?JSON.stringify(a.usage):'Unknown'}. Usage is provider-reported; it is not measured billing.\nGoal: clear 300 lines. The project budget and session limits do not guarantee reaching the goal.\nCurrent + next five; canonical immediate afterstates; no external search.\nCost estimate: ${COST_BASIS}\nPricing: ${COST_SOURCE}`;}
export function createDecisionSession({mode,lane,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,onChange=()=>{},onAccounting=()=>{}}={}) {
 let bridge=null,nonce=null,generation=0,timer=null,expiryTimer=null,browserMode=false,gameEpoch=0,publicState={state:'unconfigured',message:'Not configured — Choose a local player.'};
 const publish=value=>{publicState=Object.freeze(value);onChange(publicState);};
 async function post(route,body,proof) {
  const response=await fetchImpl(route,{method:'POST',headers:{'content-type':'application/json',...(proof?{'x-decision-pairing-nonce':proof}:{})},body:JSON.stringify(body),credentials:'same-origin',redirect:'error'});
  const value=await response.text();if(new TextEncoder().encode(value).length>4096)fail('size');
  let result;try{result=JSON.parse(value);}catch{fail('schema');}if(!response.ok)fail(result.error ?? 'unavailable');return result;
 }
 return Object.freeze({
  get state(){return publicState;},get blocked(){return bridge?.blocked??false;},get accounting(){return bridge?.runMetadata.accounting??{freshness:'unknown'};},get provider(){if(!bridge)fail('unavailable');return bridge;},
  get binding(){if(!bridge)fail('unavailable');return {sessionId:bridge.controllerBinding.sessionId,gameEpoch};},
  reset(){bridge?.invalidateAccounting();gameEpoch++;if(browserMode)void bridge?.status().catch(()=>{});return gameEpoch;},
  async availability(){if(bridge||nonce)return;try{const response=await fetchImpl('/decision/status',{credentials:'same-origin',redirect:'error'});const body=await response.text();if(body.length>4096)fail('size');const a=JSON.parse(body);if(bridge||nonce)return;browserMode=a.mode==='project-limit-browser';publish({mode:a.mode,state:a.available?'available':'unconfigured',message:a.available?(browserMode?'Live OpenAI is available for an owner-approved local session. Connect to request approval.':(a.reason==='fixture-only'?'Offline fixture available — Connect to continue. No external calls.':'Qualified live provider available — Connect to continue.')):(browserMode?(a.reason==='session_expired'?'OpenAI session expired. No new OpenAI requests will be sent. Replay or export this run. A new session needs local owner approval.':a.reason==='session_request_limit'?'OpenAI session request limit reached. No new OpenAI requests will be sent. Reset does not refill the allowance. Replay or export this run.':'OpenAI play is stopped: the session requires reconciliation. Local owner reconciliation is required. Reset will not resume OpenAI play.'):'Not configured — Choose a local player.')});}catch{if(!bridge&&!nonce)publish({state:'unconfigured',message:'Not configured — Choose a local player.'});}},
  async connect() {
   if(bridge || nonce)fail('reconciliation_required');const token=++generation;
   const bytes=cryptoImpl.getRandomValues(new Uint8Array(32));nonce=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
   const hash=await cryptoImpl.subtle.digest('SHA-256',bytes),nonceDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
   try {
    const challenge=await post('/decision/pair/register',{nonceDigest,mode,lane});
    if(token!==generation)return;
    publish({state:'waiting',mode:browserMode?'project-limit-browser':undefined,message:browserMode?'Waiting for local owner approval. Pairing expires after 60 seconds. Connect does not start play.':'Waiting for local owner approval. Approval expires after 60 seconds; Connect does not start play.',fingerprint:nonceDigest,expiresAt:challenge.expiresAt});
    const poll=async()=>{
     if(token!==generation)return;
     if(Date.now()>=challenge.expiresAt){nonce=null;publish({state:'expired',mode:browserMode?'project-limit-browser':undefined,message:browserMode?'Pairing expired. Connect again to request local owner approval.':'Pairing expired — Connect again. The owner must reconcile any undelivered grant.'});return;}
     try {
      const result=await post('/decision/pair/claim',{challengeId:challenge.challengeId},nonce);
      if(token!==generation)return;
      if(result.state==='connected') {
       nonce=null;browserMode=result.grant.admission.mode==='project-limit-browser';bridge=createDecisionBridge({grant:result.grant,fetchImpl,onAccounting:a=>{if(browserMode){publish({...publicState,message:browserStatus(a,result.grant.admission)});}onAccounting(a);}});gameEpoch=result.grant.epoch;
       if(browserMode)expiryTimer=setTimeout(()=>bridge?.status().catch(()=>{}),Math.max(0,result.grant.admission.expiresAt-Date.now()+1));
       publish({state:'connected',mode:result.grant.admission.mode,message:browserMode?browserStatus(result.grant.admission,result.grant.admission):result.grant.admission.mode==='http-fixture'?'Offline fixture connected — No external calls. Start or Step to play.':'Live OpenAI connected. Start or Step to play.',admission:result.grant.admission});return;
      }
      timer=setTimeout(poll,500);
     } catch {nonce=null;publish({state:'rejected',message:'Connection rejected — Check the local owner console. Reconcile the old grant before connecting again.'});}
    };await poll();
   } catch {nonce=null;publish({state:'unavailable',message:'Not configured — Choose a local player or check the local owner console.'});}
  },
  async status(){return bridge?.status();},
  async close(){generation++;clearTimeout(timer);clearTimeout(expiryTimer);nonce=null;const old=bridge;bridge=null;if(old)await old.close();},
 });
}

export function mountDecisionPairing(doc,{mode,lane,window:win=globalThis,onConnected=()=>{},beforeConnect=()=>{},onAvailabilityChange=()=>{}}) {
 const root=doc.getElementById('decision-pairing');if(!root)return null;
 root.className='decision-pairing';
 const heading=doc.createElement('h3');heading.textContent='OpenAI Decisions';
 const connect=doc.createElement('button');connect.className='button button-secondary';connect.textContent='Connect OpenAI';
 const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Not configured — Choose a local player, or Connect for owner-approved offline fixture play.';
 const fingerprint=doc.createElement('p');fingerprint.className='decision-fingerprint';
 const copy=doc.createElement('button');copy.className='button button-secondary';copy.textContent='Copy pairing fingerprint';copy.hidden=true;
 const details=doc.createElement('details'),summary=doc.createElement('summary'),facts=doc.createElement('pre');summary.textContent='Provider and request details';details.append(summary,facts);facts.textContent='Requested model: gpt-6-luna. Observed model: Unknown. Usage and cost: Not measured. Reset does not refill allowance.';
 const budget=doc.getElementById('decision-budget-risk')??doc.createElement('p');budget.textContent=BROWSER_BUDGET_LINE;budget.hidden=true;root.append(heading,connect,status,fingerprint,copy,details);if(!budget.parentNode)root.append(budget);
 let fullFingerprint='',lastObservedRequest=null,connectedOnce=false,enabled=false;
 const stale=()=>session.state.admission?.mode==='project-limit-browser'?`Current session counts and billing are unavailable. Previous counts are stale. Reset does not refill the allowance.\nSession ends: ${when(session.state.admission.expiresAt)}.\nProject budget: USD 1.00 per month, shared with earlier usage, including the earlier pilot. Remaining billed budget: Unknown.\nBilling may be delayed and charges can exceed the configured project limit. The token ceiling is unverified. Actual billing: Unknown.`:'Current accounting is unknown — reconciliation pending or unavailable. Previous counts are stale; Reset does not refill allowance.';
 const describe=a=>{if(a.mode==='project-limit-browser')return describeBrowser(a);const n=new Intl.NumberFormat().format;return `Requested model: ${a.requestedModel}. Observed model: ${a.observedModel??'Unknown'}.\nTransport: ${a.mode==='http-fixture'?'Offline HTTP fixture — No external calls':'Qualified live OpenAI'}.\nRemaining aggregate request allowance: ${n(a.remainingAttempts)}. Reset does not refill this allowance.\nThis run: ${n(a.attempts)} reserved attempts; ${n(a.completions)} completed decisions; ${n(a.placements)} placements in this game; ${n(a.uncertain)} uncertain dispatches.\nRemaining conservative input-token reservation: ${n(a.remainingReservedInputTokens)}.\nRemaining estimated reservation: USD ${(a.remainingEstimatedMicros/1000000).toFixed(6)}. This is a reservation, not measured billing.\nActual external calls: ${a.actualExternalCalls===null?'Unknown':n(a.actualExternalCalls)}. Actual billing: ${a.actualCostUSD===null?'Unknown':`USD ${a.actualCostUSD.toFixed(2)}`}.\nCurrent + next five; canonical immediate afterstates; no external search.`;};
 const session=createDecisionSession({mode,lane,onAccounting:a=>{budget.hidden=!enabled||session.state.admission?.mode!=='project-limit-browser';facts.textContent=a.freshness==='current'?describe(a):stale();onAvailabilityChange(a);},onChange:state=>{
  budget.hidden=!enabled||(state.mode!=='project-limit-browser'&&state.admission?.mode!=='project-limit-browser');status.textContent=state.message;fullFingerprint=state.fingerprint??'';fingerprint.textContent=fullFingerprint?`Pairing fingerprint: ${fullFingerprint}`:'';copy.hidden=!fullFingerprint;connect.disabled=['waiting','connected'].includes(state.state);
  if(state.admission)facts.textContent=describe(state.admission);
  if(state.state==='connected'&&!connectedOnce){connectedOnce=true;onConnected(session);}onAvailabilityChange(session.accounting);
 }});
 connect.addEventListener('click',async()=>{try{beforeConnect();await session.connect();}catch(error){status.textContent=error.message==='reconciliation_required'?'Owner reconciliation required before another Connect.':error.message;}});
 copy.addEventListener('click',()=>globalThis.navigator?.clipboard?.writeText(fullFingerprint));
 // A cached page retains its in-memory grant and recording. Restoring it must
 // authenticate fresh accounting before any further play; it never re-pairs.
 win.addEventListener?.('pagehide',event=>{if(!event?.persisted)void session.close().catch(()=>{});});
 win.addEventListener?.('pageshow',event=>{if(event.persisted&&session.state.state==='connected'){session.provider.invalidateAccounting();void session.status().catch(()=>{});}});
 return Object.freeze({session,get blocked(){return session.blocked;},get resetBlocked(){const a=session.accounting;return session.state.admission?.mode==='project-limit-browser'&&(a.freshness!=='current'||a.resetDisposition!=='settled-safe');},async refresh(){try{const a=await session.status();if(a)facts.textContent=session.accounting.freshness==='current'?describe(session.accounting):stale();}catch{facts.textContent=session.accounting.freshness==='current'?describe(session.accounting):stale();}},observe(receipt){if(receipt?.requestId && receipt.requestId!==lastObservedRequest){lastObservedRequest=receipt.requestId;this.refresh();}},setEnabled(value){enabled=value;root.hidden=!enabled;budget.hidden=!enabled||(session.state.mode!=='project-limit-browser'&&session.state.admission?.mode!=='project-limit-browser');if(enabled)session.availability();}});
}
