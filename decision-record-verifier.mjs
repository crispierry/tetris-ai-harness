/** Node-only canonical record verifier. Dependency boundary: pure reducers only. */
import {RULES,cells,start,move,rotate,softDrop,hardDrop,tick,togglePause,levelForLines} from './public/engine.mjs';
import {VERSIONS,observe,enumerate,execute} from './public/harness.mjs';
const LIMITS={solo:{events:2002,bytes:16*1024*1024,lanes:1},comparison:{events:4000,bytes:16*1024*1024,lanes:2},versus:{events:50000,bytes:64*1024*1024,lanes:2}};
const size=x=>new TextEncoder().encode(typeof x==='string'?x:JSON.stringify(x)).length;
const fail=message=>{throw new Error(`Decision record: ${message}`);};
const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))fail(`${label} mismatch`);};
function keys(o,allowed,label){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(o,k)))fail(`${label} shape`);}
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail(`${label} bound`);}
function points(p,label){if(!Array.isArray(p)||p.length!==4)fail(`${label} shape`);for(const c of p){keys(c,['x','y'],label);integer(c.x,0,9,label);integer(c.y,0,19,label);}}
function observation(o){
 keys(o,['sessionId','revision','board','active','next','score','lines','level','status','gravityElapsedMs','terminalReason'],'observation');
 if(typeof o.sessionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(o.sessionId))fail('session binding');integer(o.revision,0,200000,'revision');
 if(!Array.isArray(o.board)||o.board.length!==20||o.board.some(r=>typeof r!=='string'||!/^([IOTSZJL.]*)$/.test(r)||r.length!==10))fail('board shape');
 if(!Array.isArray(o.next)||o.next.length!==5||o.next.some(t=>!RULES.types.includes(t)))fail('preview shape');
 integer(o.score,0,10000000,'score');integer(o.lines,0,303,'lines');integer(o.level,1,30,'level');if(o.level!==levelForLines(o.lines))fail('level');
 if(!['ready','playing','paused','over','won'].includes(o.status))fail('engine status');
 if(!Number.isFinite(o.gravityElapsedMs)||o.gravityElapsedMs<0||o.gravityElapsedMs>=800)fail('gravity elapsed bound');
 eq(o.terminalReason,o.status==='won'?'300-line target reached':o.status==='over'?'blocked spawn':null,'terminal reason');
 if((o.status==='won')!==(o.lines>=300))fail('target outcome');
 if(o.active){keys(o.active,['type','rotation','x','y','cells'],'active');if(!RULES.types.includes(o.active.type))fail('active type');integer(o.active.rotation,0,3,'rotation');integer(o.active.x,-3,9,'active x');integer(o.active.y,-3,19,'active y');points(o.active.cells,'active cells');eq(o.active.cells,cells(o.active),'active cells');if(o.active.cells.some(p=>o.board[p.y][p.x]!=='.'))fail('active collision');}
 if(['playing','paused'].includes(o.status)!==!!o.active)fail('active status');
}
function state(o){return {board:o.board.map(r=>[...r].map(c=>c==='.'?null:c)),active:o.active?{type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y}:null,
 queue:[...o.next],nextType:o.next[0],rng:0,seed:0,status:o.status,score:o.score,lines:o.lines,level:o.level,gravityElapsed:o.gravityElapsedMs};}
function publicObservation(s,binding){const o=observe(s,binding);return {sessionId:o.sessionId,revision:o.revision,board:o.board.map(r=>r.map(c=>c??'.').join('')),active:o.active?{type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y,cells:o.active.cells}:null,next:o.next,score:o.score,lines:o.lines,level:o.level,status:o.status,gravityElapsedMs:o.gravityElapsedMs,terminalReason:o.terminalReason};}
const LIMIT_FIELDS=['maxAttempts','maxInputTokens','maxEstimatedMicros','expiresAt','maxRuns','maxEpochs','maxPlacements','timeoutMs','reservationTokens','reservationMicros'];
const ACCOUNT_FIELDS=['mode','provider','requestedModel','observedModel','endpoint','protocol','policyDigest','limits','epoch','placements','expiresAt','interrupted','terminal','remainingAttempts','remainingReservedInputTokens','remainingEstimatedMicros','attempts','completions','uncertain','actualExternalCalls','actualCostUSD','freshness','reason'];
const RECEIPT_FIELDS=['version','provider','requestedModel','observedModel','requestLatencyMs','completions','placements','actualExternalCalls','remainingAllowance','completedResponses','mode','runId','laneId','epoch','lineage','policyDigest','usage','estimatedReservationMicros','reservedInputTokens','requestId','stateRevision','selectedCandidateId','attempts','actualCostUSD','usageProvenance'];
function allow(o,fields,label){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!fields.includes(k)))fail(`${label} shape`);}
function finiteJSON(o,depth=0){if(depth>8)fail('metadata depth');if(o===null||typeof o==='boolean')return;if(typeof o==='string'){if(o.length>1000)fail('metadata text bound');return;}if(typeof o==='number'){if(!Number.isFinite(o)||Math.abs(o)>Number.MAX_SAFE_INTEGER)fail('metadata number');return;}if(!o||typeof o!=='object')fail('metadata value');for(const [key,value]of Object.entries(o)){if(/^(seed|rng|queue|capability|apikey|authorization|token|password|secret|response)$/i.test(key))fail('private metadata key');finiteJSON(value,depth+1);}}
function limits(p){allow(p,LIMIT_FIELDS,'policy limits');for(const v of Object.values(p))integer(v,1,Number.MAX_SAFE_INTEGER,'policy limit');}
function heuristicPolicy(p){keys(p,['weights','terminalPenalty','completionReward','terminalOrder','tieBreak'],'heuristic policy');keys(p.weights,['holes','aggregateHeight','maxHeight','bumpiness','lines'],'heuristic weights');for(const v of [...Object.values(p.weights),p.terminalPenalty,p.completionReward])if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e9)fail('heuristic numeric policy');if(typeof p.terminalOrder!=='string'||typeof p.tieBreak!=='string')fail('heuristic policy text');finiteJSON(p);}
function policy(p){
 finiteJSON(p);if(size(p)>16384)fail('policy bytes');
 if(p?.kind==='externalDecisions'){
  keys(p,['version','kind','provider','requestedModel','observedModel','transport','endpoint','protocol','assistance','visiblePreview','externalSearch','policyDigest','limits','actualCostUSD'],'external policy');
  if(p.version!=='provider-policy-1'||p.provider!=='OpenAI'||p.requestedModel!=='gpt-6-luna'||!['http-fixture','live'].includes(p.transport)||p.endpoint!=='https://api.openai.com/v1/decisions'||p.protocol!=='decisions-http-1'||p.assistance!=='canonical-afterstates-v1'||p.visiblePreview!==5||p.externalSearch!==false||!/^[a-f0-9]{64}$/.test(p.policyDigest??''))fail('external policy');limits(p.limits);
 }else if(p?.kind==='human'){
  keys(p,['version','kind','rulesVersion','timing','pieceCap'],'human policy');if(p.version!=='manual-focused-clock-1'||p.rulesVersion!==RULES.version)fail('human policy');integer(p.pieceCap,1,1000,'human policy cap');
 }else if(p?.kind==='localHeuristic'){
  keys(p,['version','kind','policy'],'local policy');if(p.version!=='provider-policy-1')fail('local policy version');heuristicPolicy(p.policy);
 }else if(p?.kind==='mock'){
  keys(p,['version','kind','name','fixture'],'mock policy');if(p.version!=='provider-policy-1')fail('mock policy version');keys(p.fixture,['mode','policyVersion','policy','liveEnabled','mockMode','delayMs'],'mock fixture');heuristicPolicy(p.fixture.policy);if(p.fixture.liveEnabled!==false||p.fixture.mode!=='offline-mock'||!['delay','error','stale','invalid','never'].includes(p.fixture.mockMode))fail('mock fixture');integer(p.fixture.delayMs,0,60000,'mock delay');
 }else fail('unsupported policy kind');
}
function accounting(a){if(a===null)return;if(Array.isArray(a)){if(a.length>2)fail('accounting lanes');a.forEach(accounting);return;}allow(a,ACCOUNT_FIELDS,'accounting');finiteJSON(a);if(a.limits)limits(a.limits);}
function receipt(r,i,p){
 if(r===null){if(p.kind==='externalDecisions')fail('missing compact receipt');return;}
 keys(r,RECEIPT_FIELDS,'receipt');finiteJSON(r);if(size(r)>4096||r.version!=='decision-receipt-2'||r.provider!=='OpenAI'||r.requestedModel!==p.requestedModel||r.mode!==p.transport||r.policyDigest!==p.policyDigest||r.requestId!==i.requestId||r.stateRevision!==i.revision||r.selectedCandidateId!==i.selectedCandidateId)fail('receipt binding');
 allow(r.remainingAllowance,['attempts','reservedInputTokens','estimatedReservationMicros'],'receipt allowance');
 if(r.usage!==null){allow(r.usage,['input_tokens','output_tokens','total_tokens','cached_input_tokens','cache_read_input_tokens','cache_write_input_tokens','input_tokens_details'],'receipt usage');if(r.usage.input_tokens_details)allow(r.usage.input_tokens_details,['cached_tokens','cache_write_tokens'],'receipt cache usage');for(const [k,v]of Object.entries(r.usage)){if(k==='input_tokens_details'){for(const n of Object.values(v))integer(n,0,Number.MAX_SAFE_INTEGER,'receipt cache tokens');}else integer(v,0,Number.MAX_SAFE_INTEGER,'receipt usage tokens');}}
 for(const v of Object.values(r.remainingAllowance))integer(v,0,Number.MAX_SAFE_INTEGER,'receipt allowance');if(r.actualCostUSD!==null&&(typeof r.actualCostUSD!=='number'||!Number.isFinite(r.actualCostUSD)||r.actualCostUSD<0))fail('receipt cost');if(r.mode==='http-fixture'&&(r.actualCostUSD!==0||r.actualExternalCalls!==0))fail('fixture receipt provenance');
 for(const k of ['requestLatencyMs','completions','placements','completedResponses','epoch','estimatedReservationMicros','reservedInputTokens','attempts'])if(!Number.isFinite(r[k])||r[k]<0)fail('receipt numeric bound');
}
/** Throws on corrupt/unsupported records. Success is conditional replay, never provenance authentication. */
export function verifyDecisionUIRecord(input){
 if(typeof input!=='string')fail('supply the exact saved JSON text');if(size(input)>64*1024*1024)fail('byte limit');let r;try{r=JSON.parse(input);}catch{fail('invalid JSON');}
 if(r?.version==='decision-ui-record-1')return {ok:false,version:r.version,assurance:'legacy-visual-only',canonical:false,reason:'Version 1 omits canonical inputs and human clock-only ticks; canonical verification unsupported.'};
 if(r?.version!=='decision-ui-record-2')fail('unsupported version');
 keys(r,['version','mode','rulesVersion','schemas','objective','pieceCap','lanes','events','finals','metadata','archive','assurance','replay'],'envelope');
 const limit=LIMITS[r.mode];if(!limit||size(input)>limit.bytes)fail('mode/byte limit');eq(r.rulesVersion,RULES.version,'rules version');eq(r.schemas,VERSIONS,'schemas');eq(r.objective,{targetLines:300,startLevel:1,maxLevel:30},'objective');integer(r.pieceCap,1,1000,'piece cap');
 keys(r.metadata,['accounting'],'metadata');accounting(r.metadata.accounting);if(size(r.metadata)>160*1024)fail('metadata bytes');
 keys(r.archive,['incomplete','reason'],'archive');if(typeof r.archive.incomplete!=='boolean'||(r.archive.incomplete?(typeof r.archive.reason!=='string'||r.archive.reason.length>500):r.archive.reason!==null))fail('archive censoring');
 eq(r.assurance,'Canonical reducers conditional on the recorded initial state and observed piece sequence; no seed, provider, billing, or wall-clock authentication.','assurance');eq(r.replay,'Stored visible frames only; zero new decisions','replay contract');
 if(!Array.isArray(r.lanes)||r.lanes.length!==limit.lanes||!Array.isArray(r.events)||r.events.length>limit.events||!Array.isArray(r.finals)||r.finals.length!==limit.lanes)fail('lane/event/final bounds');
 const lanes=new Map();
 for(let n=0;n<r.lanes.length;n++){
  const l=r.lanes[n];keys(l,['id','kind','initial','policy'],'lane');if(l.id!==n||l.kind!==(r.mode==='versus'&&n===0?'human':'computer'))fail('lane identity/kind');policy(l.policy);if((l.kind==='human')!==(l.policy.kind==='human'))fail('lane policy kind');
  keys(l.initial,['observation','pieces','status'],'initial');observation(l.initial.observation);integer(l.initial.pieces,0,r.pieceCap,'initial pieces');if(!['ready','running','paused','stopped','over','won','error'].includes(l.initial.status))fail('initial status');
  // Production exporters begin at an empty ready board; arbitrary mid-game fixtures cannot claim a full run.
  const o=l.initial.observation;if(o.status!=='ready'||o.active!==null||o.score!==0||o.lines!==0||o.level!==1||o.gravityElapsedMs!==0||o.revision!==0||l.initial.pieces!==0||l.initial.status!=='ready'||o.board.some(row=>row!=='.'.repeat(10)))fail('initial must be canonical empty ready state');
  lanes.set(l.id,{...l,last:l.initial,s:state(o),serial:null,attempt:null,recovery:false});
 }
 for(let index=0;index<r.events.length;index++){
  const e=r.events[index];keys(e,['seq','lane','input','observation','pieces','status'],`event ${index}`);if(e.seq!==index||!lanes.has(e.lane)||size(e)>16384)fail(`event ${index} order/lane/bytes`);
  const l=lanes.get(e.lane),before=l.last.observation,i=e.input;observation(e.observation);integer(e.pieces,0,r.pieceCap,'event pieces');if(['over','won'].includes(before.status)||l.last.pieces>=r.pieceCap)fail(`event ${index} after terminal`);
  if(!i||typeof i!=='object'||Array.isArray(i))fail('event input');let s={...l.s,queue:[...before.next,e.observation.next[4]]},rev=before.revision,pieces=l.last.pieces,status=l.last.status;
  const human=l.kind==='human';
  if(i.kind==='computer'){
   keys(i,['kind','requestId','revision','selectedCandidateId','piece','orientation','cells','path','receipt','latencyMs'],'computer input');if(human||s.status!=='playing'||l.recovery)fail('computer state');
   request(l,i,before);receipt(i.receipt,i,l.policy);if(!Number.isFinite(i.latencyMs)||i.latencyMs<0||i.latencyMs>60000)fail('decision latency');points(i.cells,'selected cells');integer(i.orientation,0,3,'selected orientation');if(!RULES.types.includes(i.piece)||!Array.isArray(i.path)||i.path.length<1||i.path.length>800||i.path.some(a=>!['left','right','clockwise','down','drop'].includes(a)))fail('selected route');
   const binding={sessionId:before.sessionId,revision:rev};const c=enumerate(s,binding).find(c=>c.id===i.selectedCandidateId);
   if(!c)fail('selected candidate binding');eq(i.path,c.path,'canonical path');eq(i.cells,c.cells,'selected cells');eq(i.orientation,c.orientation,'selected orientation');eq(i.piece,c.piece,'selected piece');s=execute(s,c,binding);rev++;pieces++;status=['won','over'].includes(s.status)?s.status:e.status;
   if(!['won','over','running','paused'].includes(status))fail('computer status');l.attempt='computer';
  }else if(i.kind==='spawn'){
   keys(i,['kind'],'spawn input');if(human||s.status!=='ready')fail('spawn state');s=start(s);rev++;
  }else if(i.kind==='human'||i.kind==='ticks'){
   if(!human||s.status!=='playing')fail('human state');const old=s;
   if(i.kind==='human'){keys(i,['kind','action'],'human input');const actions={left:s=>move(s,-1),right:s=>move(s,1),rotate,down:softDrop,drop:hardDrop};if(!Object.hasOwn(actions,i.action))fail('human action');s=actions[i.action](s);}else{keys(i,['kind','elapsedMs'],'tick input');if(!Array.isArray(i.elapsedMs)||i.elapsedMs.length<1||i.elapsedMs.length>256)fail('clock vector bound');for(let k=0;k<i.elapsedMs.length;k++){const ms=i.elapsedMs[k];if(!Number.isFinite(ms)||ms<=0||ms>250)fail('tick bound');const at=s;s=tick(s,ms);if(s.board!==at.board&&k!==i.elapsedMs.length-1)fail('clock vector crosses lock');}}
   if(s===old)fail('unapplied human event');rev+=i.kind==='ticks'?i.elapsedMs.length:1;if(s.board!==old.board)pieces++;if(pieces>=r.pieceCap&&s.status==='playing'){s=togglePause(s);status='capped';}else status=s.status;
  }else if(['resume','start','pause','stop'].includes(i.kind)){
   keys(i,['kind'],'lifecycle input');if(human){if(i.kind==='start')fail('human lifecycle');if(i.kind==='resume'){if(s.status==='ready')s=start(s);else if(s.status==='paused')s=togglePause(s);else fail('resume state');status=s.status;}else{if(s.status!=='playing')fail('human pause state');s=togglePause(s);status=i.kind==='stop'?'stopped':'paused';}rev++;}
   else{if(i.kind==='resume')fail('computer lifecycle');if(i.kind==='start'&&l.recovery)fail('recovery requires reset');status=i.kind==='start'?'running':l.recovery?'error':i.kind==='stop'?'stopped':'paused';}
  }else if(i.kind==='error'||i.kind==='cancel'){
   if(human||s.status!=='playing')fail('failed request state');keys(i,i.kind==='error'?['kind','requestId','revision','code','recoveryRequired']:['kind','control','requestId','revision'],'failed request');request(l,i,before);
   if(i.kind==='error'){if(i.code!=='decision-failed'||typeof i.recoveryRequired!=='boolean'||(i.recoveryRequired&&l.policy.kind!=='externalDecisions'))fail('error code/recovery');l.recovery=i.recoveryRequired;status='error';}else{if(!['paused','stopped'].includes(i.control))fail('cancel control');l.recovery=l.policy.kind==='externalDecisions';status=l.recovery?'error':i.control;}l.attempt=i.kind;
  }else fail('unknown input kind');
  eq(e.pieces,pieces,`event ${index} pieces`);eq(e.status,status,`event ${index} status`);eq(e.observation,publicObservation(s,{sessionId:before.sessionId,revision:rev}),`event ${index} observation`);
  l.last=e;l.s={...s,queue:[...e.observation.next],nextType:e.observation.next[0]};
 }
 for(let n=0;n<r.finals.length;n++){
  const f=r.finals[n],l=lanes.get(n),last=l.last,o=last.observation;keys(f,['lane','observation','pieces','status','outcome','censored'],'final');
  const outcome=o.status==='won'?'won':o.status==='over'?'over':last.pieces>=r.pieceCap?'capped':l.attempt==='error'?'error':l.attempt==='cancel'?'cancelled':r.archive.incomplete?'archive':'incomplete';
  eq(f,{lane:n,observation:o,pieces:last.pieces,status:last.status,outcome,censored:!['won','over'].includes(outcome)},`final ${n}`);
 }
 return {ok:true,canonical:true,version:r.version,mode:r.mode,events:r.events.length,lanes:r.lanes.length,archiveIncomplete:r.archive.incomplete,outcomes:r.finals.map(f=>f.outcome),assurance:r.assurance};
}
function request(l,i,o){
 if(i.revision!==o.revision||typeof i.requestId!=='string'||!i.requestId.startsWith(`${o.sessionId}:${o.revision}:`))fail('request revision binding');const suffix=i.requestId.slice(`${o.sessionId}:${o.revision}:`.length);if(!/^[1-9][0-9]{0,8}$/.test(suffix))fail('request serial');const serial=Number(suffix);if(l.serial!==null&&serial!==l.serial+1)fail('request ordering');l.serial=serial;
}
