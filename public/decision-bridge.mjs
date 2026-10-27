import {validDecisionDiagnostic,decisionErrorMessage} from './decision-errors.mjs';
import {validBrowserAccounting,browserBlocked} from './browser-risk-contract.mjs';
import { compactReceipt } from './provider-policy.mjs';
// Node-free provider. Admission exists only in closure memory; no automatic enrollment.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const immutable = v => { if (v && typeof v === 'object') { Object.values(v).forEach(immutable); Object.freeze(v); } return v; };
export function createDecisionBridge({ grant, fetchImpl = globalThis.fetch, onAccounting = () => {} } = {}) {
  if (!grant || !/^[a-f0-9]{64}$/.test(grant.capability ?? '') || !Number.isInteger(grant.epoch) || typeof grant.controllerSessionBase !== 'string' || typeof fetchImpl !== 'function') fail('configuration');
  const capability=grant.capability,base=grant.controllerSessionBase,browser=grant.admission?.mode==='project-limit-browser';
  let epoch = grant.epoch, active = null, serial = 0, receipt = null, receiptSerial = 0, closed=false, status=grant.admission ?? null, requiresReset=false,confirmationUncertain=false;
  const statusReads=new Set(),statusAborts=new Set();
  let accountingRevision=0,statusSerial=0,statusFlight=null,freshness=status?'current':'unknown';
  const accounting=()=>freshness==='current'?immutable({...status,freshness:'current'}):immutable({freshness,attempts:null,remainingAttempts:null,reason:'Current accounting is unknown until authenticated reconciliation settles.'});
  const notify=()=>{try{onAccounting(accounting());}catch{}};
  const invalidate=()=>{accountingRevision++;for(const abort of statusAborts)abort.abort();freshness='stale';notify();};
  function refreshStatus(){
    // A panel refresh and a decision may need the same current accounting.
    // Share that read; Reset/Stop still invalidate it through the revision fence.
    if(statusFlight?.revision===accountingRevision)return statusFlight.operation;
    const operation=readStatus(),flight={revision:accountingRevision,operation};statusFlight=flight;statusReads.add(operation);
    const settled=()=>{statusReads.delete(operation);if(statusFlight===flight)statusFlight=null;};
    operation.then(settled,settled);return operation;
  }
  async function readStatus(){if(closed)fail('cancelled');if(active)fail('accounting_pending');const revision=accountingRevision,serial=++statusSerial,abort=new AbortController();statusAborts.add(abort);try{const value=immutable(await post('/decision/control',{action:'runStatus'},abort.signal));if(browser&&!validBrowserAccounting(value))fail('schema');if(closed||active||revision!==accountingRevision||serial!==statusSerial)fail('accounting_stale');status=value;freshness='current';notify();return status;}catch(error){if(!closed&&revision===accountingRevision&&serial===statusSerial){freshness='unknown';notify();}throw error;}finally{statusAborts.delete(abort);}}
  async function post(route,body,signal) {
    const response = await fetchImpl(route,{method:'POST',headers:{'content-type':'application/json','x-decision-capability':capability},body:JSON.stringify(body),signal,redirect:'error',credentials:'same-origin'});
    let bytes=0, chunks=[];
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 65536) { await response.body.cancel?.().catch(()=>{}); fail('size'); } chunks.push(chunk); }
    const data = new Uint8Array(bytes); let offset=0; for (const chunk of chunks) { data.set(chunk,offset); offset+=chunk.length; }
    let result; try { result=JSON.parse(new TextDecoder().decode(data)); } catch { fail('schema'); }
    if (!response.ok){const code=typeof result.error === 'string'&&/^[a-z_]{1,40}$/.test(result.error)?result.error:'unavailable';throw Object.assign(new Error(decisionErrorMessage(code,result.diagnostic)),{code,responseReceived:true,...(validDecisionDiagnostic(result.diagnostic)?{diagnostic:result.diagnostic}:{})});}return result;
  }
  async function boundedControl(work){const abort=new AbortController();let timer;try{return await Promise.race([work(abort.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Object.assign(new Error('confirmation_timeout'),{code:'confirmation_timeout'}));},1500);})]);}finally{clearTimeout(timer);abort.abort();}}
  async function confirmCommitted(requestId,gravityResult){
    const job=active;if(!browser||!job?.awaitingCommit||!job.committed||job.requestId!==requestId)fail('confirmation_state');
    try{
      await boundedControl(async signal=>{const accepted=await post('/decision/control',gravityResult?{action:'settleGravity',requestId,...gravityResult}:{action:'acceptDecision',requestId},signal);if(accepted.accepted!==true||active!==job||closed)fail('confirmation_state');active=null;invalidate();const value=immutable(await post('/decision/control',{action:'runStatus'},signal));if(!validBrowserAccounting(value)||closed)fail('schema');status=value;freshness='current';notify();});
    }catch(error){confirmationUncertain=true;requiresReset=true;if(active===job)active=null;invalidate();await boundedControl(signal=>post('/decision/control',{action:'interrupt',requestId},signal)).catch(()=>{});throw error;}
  }
  return Object.freeze({name:'OpenAI Decisions (server bridge)',kind:'remote',version:'decisions-http-1',
    capabilities: immutable({maxCandidates:255,movementMode:'reachable-paused-gravity-v1',assistance:'canonical-afterstates-v1'}),
    get runMetadata() { return immutable({mode:status?.mode ?? 'unverified',liveEnabled:status?.mode==='live'||browser,admission:browser?grant.admission:status,accounting:accounting(),actualCostUSD:status?.actualCostUSD ?? null}); },
    get controllerBinding() {return immutable({sessionId:base,gameEpoch:grant.epoch});},
    status:refreshStatus,
    confirmCommitted:browser?confirmCommitted:undefined,
    confirmGravity:browser?(requestId,result)=>confirmCommitted(requestId,result):undefined,
    invalidateAccounting:invalidate,
    async close() {closed=true;active=null;receipt=null;invalidate();const result=await post('/decision/control',{action:'close'});await Promise.allSettled([...statusReads]);return result;},
    get requiresReset(){return requiresReset||active?.dispatched===true;},
    get blocked(){return browser&&(confirmationUncertain||!!active||freshness!=='current'||browserBlocked(status));},
    get lastReceipt() { return receipt; },
    async decide(packet,{signal,gravity=false}={}) {
      if(closed)fail('cancelled');
      if(gravity&&!browser)fail('gravity_unsupported');
      if(browser&&(confirmationUncertain||active))fail('reconciliation_required');
      if(browser&&freshness!=='current')await refreshStatus();
      if(browser&&browserBlocked(status))fail('reconciliation_required');
      receipt=null;invalidate();
      const suffix = packet?.observation?.sessionId?.slice(base.length+1), nextEpoch=Number(suffix);
      if (packet?.observation?.sessionId !== `${base}-${nextEpoch}` || !Number.isSafeInteger(nextEpoch) || nextEpoch < epoch || nextEpoch < 0 || nextEpoch >= 100) fail('epoch');
      if (active && !active.signal?.aborted) fail('overlap');
      const job={id:++serial,signal,safeFailure:false,requestId:packet.requestId};active=job;
      if(browser)signal?.addEventListener('abort',()=>{if(signal.reason==='placement-committed'){job.committed=true;return;}if(job.dispatched&&!job.safeFailure&&!job.responseReceived){requiresReset=true;job.awaitingCommit=false;if(active===job)active=null;invalidate();void post('/decision/control',{action:'interrupt',requestId:job.requestId}).then(()=>refreshStatus(),()=>{}).catch(()=>{});}},{once:true});
      const current=()=>{if (signal?.aborted || active!==job) fail('cancelled');};
      try {
        current();
        // Reconcile only control identity, never retry a decision or an ambiguous advance.
        // A lost advance reply can leave the durable server ahead of this closure.
        const durable = await post('/decision/control',{action:'currentEpoch'},signal); current();
        if (!Number.isInteger(durable.maxEpochs) || durable.maxEpochs < 1 || durable.maxEpochs > 100 ||
            !Number.isInteger(durable.epoch) || durable.epoch < epoch || durable.epoch > nextEpoch || nextEpoch >= durable.maxEpochs) fail('epoch');
        if(browser&&durable.ownerHold)fail('reconciliation_required');
        epoch = durable.epoch;
        // UI resets may skip sessions; every durable mutation still advances exactly one.
        while (epoch < nextEpoch) {
          const target = epoch + 1;
          const advanced = await post('/decision/control',{action:'advanceEpoch',epoch:target},signal); current();
          if (advanced.epoch !== target || advanced.closed !== false) fail('epoch');
          epoch = target;requiresReset=false;
        }
        if (new TextEncoder().encode(JSON.stringify({packet})).length > 1048576) fail('size');
        job.dispatched=true;let result;try{result=await post('/decision/choice',{packet,...(gravity?{gravity:true}:{})},signal);current();
        const choice=result.choice;if(/^decision-browser-forced-receipt-[12]$/.test(result.receipt?.version)&&(packet.candidates.length!==1||choice?.selectedCandidateId!==packet.candidates[0].id||result.receipt.placements!==(gravity?0:1)))fail('schema');
        if (!choice || Object.keys(choice).length!==3 || choice.requestId!==packet.requestId || choice.stateRevision!==packet.stateRevision || !packet.candidates.some(c=>c.id===choice.selectedCandidateId) || new TextEncoder().encode(JSON.stringify(choice)).length>4096) fail('schema');
        if (job.id >= receiptSerial) { receipt=compactReceipt(result.receipt); receiptSerial=job.id; }
        if(browser)job.awaitingCommit=true;
        return immutable(choice);
        }catch(error){job.responseReceived=error.responseReceived===true;if(browser&&error.code==='refusal')job.safeFailure=true;if(active===job)requiresReset=true;throw error;}
      } finally { if(active===job){if(browser&&job.awaitingCommit){invalidate();}else{active=null;invalidate();if(grant.admission){if(browser)await refreshStatus().catch(()=>{});else void refreshStatus().catch(()=>{});}}} }
    },
  });
}
