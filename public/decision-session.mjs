import { createDecisionBridge } from './decision-bridge.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function createDecisionSession({mode,lane,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,onChange=()=>{},onAccounting=()=>{}}={}) {
 let bridge=null,nonce=null,generation=0,timer=null,gameEpoch=0,publicState={state:'unconfigured',message:'Not configured — Choose a local player.'};
 const publish=value=>{publicState=Object.freeze(value);onChange(publicState);};
 async function post(route,body,proof) {
  const response=await fetchImpl(route,{method:'POST',headers:{'content-type':'application/json',...(proof?{'x-decision-pairing-nonce':proof}:{})},body:JSON.stringify(body),credentials:'same-origin',redirect:'error'});
  const value=await response.text();if(new TextEncoder().encode(value).length>4096)fail('size');
  let result;try{result=JSON.parse(value);}catch{fail('schema');}if(!response.ok)fail(result.error ?? 'unavailable');return result;
 }
 return Object.freeze({
  get state(){return publicState;},get accounting(){return bridge?.runMetadata.accounting??{freshness:'unknown'};},get provider(){if(!bridge)fail('unavailable');return bridge;},
  get binding(){if(!bridge)fail('unavailable');return {sessionId:bridge.controllerBinding.sessionId,gameEpoch};},
  reset(){bridge?.invalidateAccounting();gameEpoch++;return gameEpoch;},
  async availability(){if(bridge||nonce)return;try{const response=await fetchImpl('/decision/status',{credentials:'same-origin',redirect:'error'});const body=await response.text();if(body.length>4096)fail('size');const a=JSON.parse(body);if(bridge||nonce)return;publish({state:a.available?'available':'unconfigured',message:a.available?(a.reason==='fixture-only'?'Offline fixture available — Connect to continue. No external calls.':'Qualified live provider available — Connect to continue.'):'Not configured — Choose a local player.'});}catch{if(!bridge&&!nonce)publish({state:'unconfigured',message:'Not configured — Choose a local player.'});}},
  async connect() {
   if(bridge || nonce)fail('reconciliation_required');const token=++generation;
   const bytes=cryptoImpl.getRandomValues(new Uint8Array(32));nonce=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
   const hash=await cryptoImpl.subtle.digest('SHA-256',bytes),nonceDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
   try {
    const challenge=await post('/decision/pair/register',{nonceDigest,mode,lane});
    if(token!==generation)return;
    publish({state:'waiting',message:'Waiting for local owner approval. Approval expires after 60 seconds; Connect does not start play.',fingerprint:nonceDigest,expiresAt:challenge.expiresAt});
    const poll=async()=>{
     if(token!==generation)return;
     if(Date.now()>=challenge.expiresAt){nonce=null;publish({state:'expired',message:'Pairing expired — Connect again. The owner must reconcile any undelivered grant.'});return;}
     try {
      const result=await post('/decision/pair/claim',{challengeId:challenge.challengeId},nonce);
      if(token!==generation)return;
      if(result.state==='connected') {
       nonce=null;bridge=createDecisionBridge({grant:result.grant,fetchImpl,onAccounting});gameEpoch=result.grant.epoch;
       publish({state:'connected',message:result.grant.admission.mode==='http-fixture'?'Offline fixture connected — No external calls. Start or Step to play.':'Live OpenAI connected. Start or Step to play.',admission:result.grant.admission});return;
      }
      timer=setTimeout(poll,500);
     } catch {nonce=null;publish({state:'rejected',message:'Connection rejected — Check the local owner console. Reconcile the old grant before connecting again.'});}
    };await poll();
   } catch {nonce=null;publish({state:'unavailable',message:'Not configured — Choose a local player or check the local owner console.'});}
  },
  async status(){return bridge?.status();},
  async close(){generation++;clearTimeout(timer);nonce=null;const old=bridge;bridge=null;if(old)await old.close();},
 });
}

export function mountDecisionPairing(doc,{mode,lane,onConnected=()=>{},beforeConnect=()=>{}}) {
 const root=doc.getElementById('decision-pairing');if(!root)return null;
 root.className='decision-pairing';
 const heading=doc.createElement('h3');heading.textContent='OpenAI Decisions';
 const connect=doc.createElement('button');connect.className='button button-secondary';connect.textContent='Connect OpenAI';
 const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='Not configured — Choose a local player, or Connect for owner-approved offline fixture play.';
 const fingerprint=doc.createElement('p');fingerprint.className='decision-fingerprint';
 const copy=doc.createElement('button');copy.className='button button-secondary';copy.textContent='Copy pairing fingerprint';copy.hidden=true;
 const details=doc.createElement('details'),summary=doc.createElement('summary'),facts=doc.createElement('pre');summary.textContent='Provider and request details';details.append(summary,facts);facts.textContent='Requested model: gpt-6-luna. Observed model: Unknown. Usage and cost: Not measured. Reset does not refill allowance.';
 root.append(heading,connect,status,fingerprint,copy,details);
 let fullFingerprint='',lastObservedRequest=null;
 const describe=a=>{const n=new Intl.NumberFormat().format;return `Requested model: ${a.requestedModel}. Observed model: ${a.observedModel??'Unknown'}.\nTransport: ${a.mode==='http-fixture'?'Offline HTTP fixture — No external calls':'Qualified live OpenAI'}.\nRemaining aggregate request allowance: ${n(a.remainingAttempts)}. Reset does not refill this allowance.\nThis run: ${n(a.attempts)} reserved attempts; ${n(a.completions)} completed decisions; ${n(a.placements)} placements in this game; ${n(a.uncertain)} uncertain dispatches.\nRemaining conservative input-token reservation: ${n(a.remainingReservedInputTokens)}.\nRemaining estimated reservation: USD ${(a.remainingEstimatedMicros/1000000).toFixed(6)}. This is a reservation, not measured billing.\nActual external calls: ${a.actualExternalCalls===null?'Unknown':n(a.actualExternalCalls)}. Actual billing: ${a.actualCostUSD===null?'Unknown':`USD ${a.actualCostUSD.toFixed(2)}`}.\nCurrent + next five; canonical immediate afterstates; no external search.`;};
 const session=createDecisionSession({mode,lane,onAccounting:a=>{facts.textContent=a.freshness==='current'?describe(a):'Current accounting is unknown — reconciliation pending or unavailable. Previous counts are stale; Reset does not refill allowance.';},onChange:state=>{
  status.textContent=state.message;fullFingerprint=state.fingerprint??'';fingerprint.textContent=fullFingerprint?`Pairing fingerprint: ${fullFingerprint}`:'';copy.hidden=!fullFingerprint;connect.disabled=['waiting','connected'].includes(state.state);
  if(state.admission)facts.textContent=describe(state.admission);
  if(state.state==='connected')onConnected(session);
 }});
 connect.addEventListener('click',async()=>{try{beforeConnect();await session.connect();}catch(error){status.textContent=error.message==='reconciliation_required'?'Owner reconciliation required before another Connect.':error.message;}});
 copy.addEventListener('click',()=>globalThis.navigator?.clipboard?.writeText(fullFingerprint));
 globalThis.addEventListener?.('pagehide',()=>session.close().catch(()=>{}));
 return Object.freeze({session,async refresh(){try{const a=await session.status();if(a)facts.textContent=session.accounting.freshness==='current'?describe(session.accounting):'Current accounting is unknown — previous counts are stale.';}catch{facts.textContent=session.accounting.freshness==='current'?describe(session.accounting):'Current accounting is unknown — reconciliation pending or unavailable. Previous counts are stale; Reset does not refill allowance.';}},observe(receipt){if(receipt?.requestId && receipt.requestId!==lastObservedRequest){lastObservedRequest=receipt.requestId;this.refresh();}},setEnabled(enabled){root.hidden=!enabled;if(enabled)session.availability();}});
}
