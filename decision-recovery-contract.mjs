// Private-ledger recovery metadata; never a public HTTP or provider contract.
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=1000;
const positive=x=>Number.isSafeInteger(x)&&x>0;
export function validOwnerAbandonment(state,key,entry,digest){
 if(state.policy?.kind!=='risk-accepted-project-browser-policy-1'||entry.status!=='reconciled-abandoned'||!hash(entry.reconciliationId))return false;
 const event=state.ownerReconciliations?.[entry.reconciliationId];if(!event)return false;
 const {id,...body}=event,original=event.originalEntry;
 const {reconciliationId,status,...preserved}=entry;
 return id===entry.reconciliationId&&digest(body)===id&&event.version===1&&event.resolution==='owner-abandon-no-retry'&&event.upstreamOutcome==='unknown'&&event.actualCostUSD===null&&event.actor==='Cris'&&positive(event.recordedAt)&&event.requestKey===key&&original?.status==='uncertain'&&original.deliveryPending===false&&digest({...preserved,status:'uncertain'})===digest(original)&&hash(event.beforeLedgerSHA256)&&text(event.authorization?.reference)&&hash(event.authorization?.sha256)&&text(event.drain?.reference)&&hash(event.drain?.sha256)&&event.drain.localFetchAndResponseStreamSettled===true&&event.drain.supervisedExitCode===0&&event.drain.ledgerOwnerLockReleased===true&&state.runs[entry.runId]?.closed===true&&state.runs[entry.runId]?.interrupted===true&&state.browserSession?.ownerHold===true&&state.browserSession?.reason==='owner_abandoned_retired'&&/^[A-Za-z0-9_-]{1,80}$/.test(event.successorLineage??'');
}
export function validPredecessor(state){
 const p=state.predecessor;return state.policy?.kind==='risk-accepted-project-browser-policy-1'&&p?.version===1&&/^[A-Za-z0-9_-]{1,80}$/.test(p.lineage??'')&&p.lineage!==state.lineage&&hash(p.ledgerSHA256)&&hash(p.reconciliationId)&&Number.isSafeInteger(p.usedAttempts)&&p.usedAttempts>=0&&Number.isSafeInteger(state.used?.attempts)&&state.used.attempts>=p.usedAttempts&&p.usedAttempts<=state.policy.maxAttempts;
}
