import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const contexts = {solo:'solo', comparison:'right', versus:'algorithm'};
const exact = (body, keys) => body && !Array.isArray(body) && Object.keys(body).sort().join(',') === [...keys].sort().join(',');
export function createDecisionOwner({service, now = Date.now} = {}) {
  const pending = new Map(), delivered = new Map(); let registrations = [], held = false;
  async function expire() {
    for (const [id,p] of pending) if (p.expiresAt <= now()) {
      if (p.grant) { try { await service.control(p.grant.capability,'close'); } catch { held = true; p.state='owner-hold'; continue; } }
      if(p.state==='delivered')continue;
      pending.delete(id);
    }
  }
  return Object.freeze({
    async register(body) {
      await expire();
      if (held || !service.status().available) fail('unavailable');
      if (!exact(body,['nonceDigest','mode','lane']) || !hex(body.nonceDigest) || contexts[body.mode] !== body.lane) fail('input');
      registrations = registrations.filter(at => at > now()-60000);
      if ([...pending.values()].filter(p=>p.state!=='delivered').length >= 8 || registrations.length >= 16) fail('rate_limit');
      registrations.push(now()); const challengeId=randomUUID(), expiresAt=now()+60000;
      pending.set(challengeId,{...body,challengeId,expiresAt,state:'pending',grant:null});
      return {challengeId,fingerprint:body.nonceDigest,expiresAt,state:'pending'};
    },
    async claim(body,nonce) {
      await expire();
      if (!exact(body,['challengeId']) || !hex(nonce)) fail('unauthorized');
      const p=pending.get(body.challengeId), d=createHash('sha256').update(Buffer.from(nonce,'hex')).digest();
      if (!p || !timingSafeEqual(d,Buffer.from(p.nonceDigest,'hex')) || ['delivered','owner-hold'].includes(p.state)) fail('unauthorized');
      if (p.state==='pending' || p.state==='approving') return {state:'pending',expiresAt:p.expiresAt};
      const grant=p.grant; delivered.set(p.challengeId,grant.capability);p.grant=null; p.state='delivered';
      return {state:'connected',grant};
    },
    async command(body) {
      await expire();
      if (body?.action==='list' && exact(body,['action'])) return {pending:[...pending.values()].map(({challengeId,nonceDigest,mode,lane,expiresAt,state})=>({challengeId,nonceDigest,mode,lane,expiresAt,state})),ownerHold:held};
      if (!exact(body,['action','challengeId','nonceDigest','mode','lane']) || !['approve','close'].includes(body.action)) fail('input');
      const p=pending.get(body.challengeId);
      if (!p || p.nonceDigest!==body.nonceDigest || p.mode!==body.mode || p.lane!==body.lane) fail('unauthorized');
      if (body.action==='close') {
        const capability=p.grant?.capability??delivered.get(p.challengeId);
        if(capability)await service.control(capability,'close');
        delivered.delete(p.challengeId);pending.delete(p.challengeId); return {state:'closed'};
      }
      if (held || p.state!=='pending') fail('duplicate');
      p.state='approving';
      try { p.grant=await service.owner.issueRun({laneId:`${p.mode}-${p.challengeId}`,controllerSessionBase:`decision-${randomUUID()}`}); p.grant={...p.grant,admission:await service.control(p.grant.capability,'runStatus')}; p.state='approved'; return {challengeId:p.challengeId,state:'approved'}; }
      catch(e) { p.state='owner-hold';held=true;throw e; }
    },
    async close() { for(const p of pending.values()) {const capability=p.grant?.capability??delivered.get(p.challengeId);if(capability)try{await service.control(capability,'close');}catch(e){if(e.code!=='unauthorized' && service.status().available)throw e;}}pending.clear();delivered.clear(); },
  });
}
// The inherited stream belongs to the supervising OS owner; no HTTP approval route exists.
export function attachOwnerInput(input,owner,output) {
  let buffer='',tail=Promise.resolve(),blocked=false;
  const onData = chunk => {
    if(blocked)return;
    buffer+=chunk.toString('utf8');
    if(Buffer.byteLength(buffer)>4096 && !buffer.includes('\n')) {blocked=true;output({error:'size'});return;}
    let index;
    while((index=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      tail=tail.then(async()=>{try {if(Buffer.byteLength(line)>4096)fail('size');const command=JSON.parse(line);output(await owner.command(command));}catch{output({error:'owner_command_rejected'});}});
    }
    if(Buffer.byteLength(buffer)>4096){blocked=true;output({error:'size'});}
  };
  input.on('data',onData);return async()=>{input.off('data',onData);await tail;};
}
