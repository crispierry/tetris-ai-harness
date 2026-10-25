// Node-free provider. Admission exists only in closure memory; no automatic enrollment.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const immutable = v => { if (v && typeof v === 'object') { Object.values(v).forEach(immutable); Object.freeze(v); } return v; };
export function createDecisionBridge({ grant, fetchImpl = globalThis.fetch } = {}) {
  if (!grant || !/^[a-f0-9]{64}$/.test(grant.capability ?? '') || !Number.isInteger(grant.epoch) || typeof grant.controllerSessionBase !== 'string' || typeof fetchImpl !== 'function') fail('configuration');
  const capability = grant.capability, base = grant.controllerSessionBase;
  let epoch = grant.epoch, active = null, serial = 0, receipt = null, receiptSerial = 0;
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
    get runMetadata() { return immutable({mode:'server-bridge',liveEnabled:false,availability:'owner admission required; server status authoritative',actualCostUSD:null}); },
    get lastReceipt() { return receipt; },
    async decide(packet,{signal}={}) {
      const suffix = packet?.observation?.sessionId?.slice(base.length+1), nextEpoch=Number(suffix);
      if (packet?.observation?.sessionId !== `${base}-${nextEpoch}` || !Number.isInteger(nextEpoch) || nextEpoch < epoch || nextEpoch > epoch+1) fail('epoch');
      if (active && !active.signal?.aborted) fail('overlap');
      const job={id:++serial,signal}; active=job;
      const current=()=>{if (signal?.aborted || active!==job) fail('cancelled');};
      try {
        current();
        if (nextEpoch !== epoch) { await post('/decision/control',{action:'advanceEpoch',epoch:nextEpoch},signal); current(); epoch=nextEpoch; }
        if (new TextEncoder().encode(JSON.stringify({packet})).length > 1048576) fail('size');
        const result=await post('/decision/choice',{packet},signal); current();
        const choice=result.choice;
        if (!choice || Object.keys(choice).length!==3 || choice.requestId!==packet.requestId || choice.stateRevision!==packet.stateRevision || !packet.candidates.some(c=>c.id===choice.selectedCandidateId) || new TextEncoder().encode(JSON.stringify(choice)).length>4096) fail('schema');
        if (job.id >= receiptSerial) { receipt=immutable(result.receipt); receiptSerial=job.id; }
        return immutable(choice);
      } finally { if (active===job) active=null; }
    },
  });
}
