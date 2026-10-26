import { compactReceipt } from './provider-policy.mjs';
// Node-free provider. Admission exists only in closure memory; no automatic enrollment.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const immutable = v => { if (v && typeof v === 'object') { Object.values(v).forEach(immutable); Object.freeze(v); } return v; };
export function createDecisionBridge({ grant, fetchImpl = globalThis.fetch, onAccounting = () => {} } = {}) {
  if (!grant || !/^[a-f0-9]{64}$/.test(grant.capability ?? '') || !Number.isInteger(grant.epoch) || typeof grant.controllerSessionBase !== 'string' || typeof fetchImpl !== 'function') fail('configuration');
  const capability = grant.capability, base = grant.controllerSessionBase;
  let epoch = grant.epoch, active = null, serial = 0, receipt = null, receiptSerial = 0, closed=false, status=grant.admission ?? null, requiresReset=false;
  const statusReads=new Set(),statusAborts=new Set();
  let accountingRevision=0,statusSerial=0,freshness=status?'current':'unknown';
  const accounting=()=>freshness==='current'?immutable({...status,freshness:'current'}):immutable({freshness,attempts:null,remainingAttempts:null,reason:'Current accounting is unknown until authenticated reconciliation settles.'});
  const notify=()=>{try{onAccounting(accounting());}catch{}};
  const invalidate=()=>{accountingRevision++;for(const abort of statusAborts)abort.abort();freshness='stale';notify();};
  function refreshStatus(){const operation=readStatus();statusReads.add(operation);operation.then(()=>statusReads.delete(operation),()=>statusReads.delete(operation));return operation;}
  async function readStatus(){if(closed)fail('cancelled');if(active)fail('accounting_pending');const revision=accountingRevision,serial=++statusSerial,abort=new AbortController();statusAborts.add(abort);try{const value=immutable(await post('/decision/control',{action:'runStatus'},abort.signal));if(closed||active||revision!==accountingRevision||serial!==statusSerial)fail('accounting_stale');status=value;freshness='current';notify();return status;}catch(error){if(!closed&&revision===accountingRevision&&serial===statusSerial){freshness='unknown';notify();}throw error;}finally{statusAborts.delete(abort);}}
  async function post(route,body,signal) {
    const response = await fetchImpl(route,{method:'POST',headers:{'content-type':'application/json','x-decision-capability':capability},body:JSON.stringify(body),signal,redirect:'error',credentials:'same-origin'});
    let bytes=0, chunks=[];
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 65536) { await response.body.cancel?.().catch(()=>{}); fail('size'); } chunks.push(chunk); }
    const data = new Uint8Array(bytes); let offset=0; for (const chunk of chunks) { data.set(chunk,offset); offset+=chunk.length; }
    let result; try { result=JSON.parse(new TextDecoder().decode(data)); } catch { fail('schema'); }
    if (!response.ok) fail(typeof result.error === 'string' && /^[a-z_]{1,40}$/.test(result.error) ? result.error : 'unavailable'); return result;
  }
  return Object.freeze({name:'OpenAI Decisions (server bridge)',kind:'remote',version:'decisions-http-1',
    capabilities: immutable({maxCandidates:255,movementMode:'reachable-paused-gravity-v1',assistance:'canonical-afterstates-v1'}),
    get runMetadata() { return immutable({mode:status?.mode ?? 'unverified',liveEnabled:status?.mode==='live',admission:status,accounting:accounting(),actualCostUSD:status?.actualCostUSD ?? null}); },
    get controllerBinding() {return immutable({sessionId:base,gameEpoch:grant.epoch});},
    status:refreshStatus,
    invalidateAccounting:invalidate,
    async close() {closed=true;active=null;receipt=null;invalidate();const result=await post('/decision/control',{action:'close'});await Promise.allSettled([...statusReads]);return result;},
    get requiresReset(){return requiresReset||active?.dispatched===true;},
    get lastReceipt() { return receipt; },
    async decide(packet,{signal}={}) {
      if(closed)fail('cancelled');
      receipt=null;invalidate();
      const suffix = packet?.observation?.sessionId?.slice(base.length+1), nextEpoch=Number(suffix);
      if (packet?.observation?.sessionId !== `${base}-${nextEpoch}` || !Number.isSafeInteger(nextEpoch) || nextEpoch < epoch || nextEpoch < 0 || nextEpoch >= 100) fail('epoch');
      if (active && !active.signal?.aborted) fail('overlap');
      const job={id:++serial,signal}; active=job;
      const current=()=>{if (signal?.aborted || active!==job) fail('cancelled');};
      try {
        current();
        // Reconcile only control identity, never retry a decision or an ambiguous advance.
        // A lost advance reply can leave the durable server ahead of this closure.
        const durable = await post('/decision/control',{action:'currentEpoch'},signal); current();
        if (!Number.isInteger(durable.maxEpochs) || durable.maxEpochs < 1 || durable.maxEpochs > 100 ||
            !Number.isInteger(durable.epoch) || durable.epoch < epoch || durable.epoch > nextEpoch || nextEpoch >= durable.maxEpochs) fail('epoch');
        epoch = durable.epoch;
        // UI resets may skip sessions; every durable mutation still advances exactly one.
        while (epoch < nextEpoch) {
          const target = epoch + 1;
          const advanced = await post('/decision/control',{action:'advanceEpoch',epoch:target},signal); current();
          if (advanced.epoch !== target || advanced.closed !== false) fail('epoch');
          epoch = target;requiresReset=false;
        }
        if (new TextEncoder().encode(JSON.stringify({packet})).length > 1048576) fail('size');
        job.dispatched=true;let result;try{result=await post('/decision/choice',{packet},signal);current();
        const choice=result.choice;
        if (!choice || Object.keys(choice).length!==3 || choice.requestId!==packet.requestId || choice.stateRevision!==packet.stateRevision || !packet.candidates.some(c=>c.id===choice.selectedCandidateId) || new TextEncoder().encode(JSON.stringify(choice)).length>4096) fail('schema');
        if (job.id >= receiptSerial) { receipt=compactReceipt(result.receipt); receiptSerial=job.id; }
        return immutable(choice);
        }catch(error){if(active===job)requiresReset=true;throw error;}
      } finally { if (active===job){active=null;invalidate();if(grant.admission)void refreshStatus().catch(()=>{});} }
    },
  });
}
