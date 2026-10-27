import {isTerminal} from './engine.mjs';
import {enumerate,simulate,observe,features,freeze} from './harness.mjs';
import {createLookaheadProvider,evaluateLookahead,localLeafEvaluator} from './lookahead.mjs';

export const BEAM_VERSION='visible-beam-search-1';
const size=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const reasons={input:['private field','invalid public packet','invalid observation','duplicate root','root horizon or binding mismatch','insufficient known horizon','synthetic refill boundary','invalid public data'],budget:['node budget','evaluator call budget','output budget','reachability budget'],timeout:['time budget'],cancelled:['cancelled'],schema:['invalid leaf value','missing reachable children','canonical child failure'],provider_error:['leaf evaluator error']};
const failure=(code,reason)=>{const valid=Object.hasOwn(reasons,code)&&reasons[code].includes(reason);return Object.assign(new Error(`Bounded search stopped: ${valid?reason:'leaf evaluator error'}. No placement selected.`),{code:valid?code:'provider_error',reason:valid?reason:'leaf evaluator error'});};
const fail=(code,reason)=>{throw failure(code,reason);};
function settings({depth=2,beamWidth=4,evaluator=localLeafEvaluator(),...limits}={}){
 if(!Number.isInteger(depth)||depth<1||depth>6||!Number.isInteger(beamWidth)||beamWidth<1||beamWidth>16)throw new RangeError('Lookahead depth must be 1–6 and beam width 1–16.');
 // Reuse the historical packet/evaluator/limit contracts without changing saved depth1/2 searches.
 const base=createLookaheadProvider({...limits,depth:1,evaluator}).runMetadata.search;
 const policy=freeze({...base,version:BEAM_VERSION,depth,beamWidth,tier:`visible-depth-${depth}-beam-${beamWidth}-v1`,
  rootReward:'Discounted cleared-line rewards plus the final leaf board value; terminal values override the evaluator',
  pruning:'Global beam after each complete placement layer; retained branches only, not exhaustive search',
  tieOrder:'Terminal rank, value, original root order, then canonical child order',
  nodeUnit:'Every evaluated root and child placement',
  horizon:'Current piece plus at most five visible next pieces; no unknown spawn is evaluated at the horizon'});
 return {config:policy,policy,evaluator};
}
const stateFrom=o=>({board:o.board.map(r=>[...r]),active:o.active?{type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y}:null,
 queue:[...o.next],nextType:o.next[0]??'I',rng:1,seed:1,status:o.status,score:o.score,lines:o.lines,level:o.level,gravityElapsed:o.gravityElapsedMs});
const rank=n=>n.state.status==='won'?1:n.state.status==='over'?-1:0;
const compare=(a,b)=>rank(b)-rank(a)||b.value-a.value||a.rootOrder-b.rootOrder||a.order-b.order;
// One cooperative queue per live search, closed even when an evaluator ignores cancellation.
function scheduler(signal){
 const channel=new MessageChannel();let pending=null;
 channel.port1.onmessage=()=>{const p=pending;pending=null;p?.resolve();};
 const abort=()=>{const p=pending;pending=null;p?.reject(failure('cancelled','cancelled'));};signal.addEventListener('abort',abort);
 return {yield(){if(signal.aborted)return Promise.reject(failure('cancelled','cancelled'));return new Promise((resolve,reject)=>{pending={resolve,reject};channel.port2.postMessage(0);});},close(){signal.removeEventListener('abort',abort);abort();channel.port1.close();channel.port2.close();}};
}
async function search(packet,{config,policy,evaluator},parentSignal){
 const scope=new AbortController(),forward=()=>scope.abort();parentSignal?.addEventListener('abort',forward,{once:true});if(parentSignal?.aborted)scope.abort();
 const signal=scope.signal,queue=scheduler(signal),started=performance.now();let lastYield=started,acceptedRequestId=null;
 const stats={nodes:0,evaluatorCalls:0,rootsOffered:0,rootsCompleted:0,childrenEnumerated:0,leavesEvaluated:0,pruned:0,elapsedMs:0,depthRequested:config.depth,depthReached:0,selectedDepth:0,beamWidth:config.beamWidth,expandedStates:0,earlyTerminal:0};
 const deadline=()=>Math.min(config.timeMs,packet?.deadlineMs??config.timeMs);
 const check=()=>{if(signal.aborted)fail('cancelled','cancelled');if(performance.now()-started>=deadline())fail('timeout','time budget');};
 const cooperate=async()=>{check();if(performance.now()-lastYield>=8){await queue.yield();lastYield=performance.now();}check();};
 const evaluate=async leaf=>{
  check();if(stats.evaluatorCalls>=config.callCap)fail('budget','evaluator call budget');if(size(leaf)>config.maxOutputBytes)fail('budget','output budget');stats.evaluatorCalls++;
  let timer,abort;try{
   const guard=new Promise((_,reject)=>{abort=()=>reject(failure('cancelled','cancelled'));signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>reject(failure('timeout','time budget')),Math.max(1,deadline()-(performance.now()-started)));});
   const value=await Promise.race([Promise.resolve().then(()=>evaluator.evaluate(leaf,{signal})),guard]);check();
   if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000)fail('schema','invalid leaf value');stats.leavesEvaluated++;
   return leaf.observation.status==='won'?1000000:leaf.observation.status==='over'?-1000000:value;
  }catch(error){if(error?.code&&Object.hasOwn(reasons,error.code)&&reasons[error.code].includes(error.reason))throw failure(error.code,error.reason);throw failure('provider_error','leaf evaluator error');}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 };
 try{
  // Validates every public root and evaluator identity, and evaluates all roots before any pruning.
  const initial=await evaluateLookahead(packet,{depth:1,nodeCap:config.nodeCap,callCap:config.callCap,timeMs:config.timeMs,maxOutputBytes:config.maxOutputBytes,discount:config.discount,evaluator,signal});
  if(!initial.ok)return freeze({...initial,version:BEAM_VERSION,policyReference:{version:BEAM_VERSION,tier:policy.tier,evaluatorVersion:policy.evaluator.version},limits:{depth:config.depth,beamWidth:config.beamWidth,nodeCap:config.nodeCap,callCap:config.callCap,timeMs:config.timeMs,maxOutputBytes:config.maxOutputBytes},stats:{...stats,...initial.stats,elapsedMs:performance.now()-started}});
  acceptedRequestId=packet.requestId;Object.assign(stats,initial.stats);stats.depthReached=1;check();
  let serial=0;
  const all=initial.roots.map((r,index)=>({rootId:r.rootId,rootOrder:index,order:serial++,depth:1,value:r.value,priorReward:0,linesDelta:packet.candidates[index].linesDelta,
   state:stateFrom(packet.candidates[index].afterstate),knownQueue:[...packet.candidates[index].afterstate.next],leaf:r.bestLeaf}));
  const roots=new Map(all.map(n=>[n.rootId,{rootId:n.rootId,value:n.value,terminalRank:rank(n),depthReached:1}]));
  let beam=[...all].sort(compare);
  if(config.depth>1){stats.pruned+=Math.max(0,beam.length-config.beamWidth);beam=beam.slice(0,config.beamWidth);}
  for(let depth=2;depth<=config.depth&&!beam.every(n=>isTerminal(n.state.status));depth++){
   const pool=[];
   for(const parent of beam){
    if(isTerminal(parent.state.status)){pool.push(parent);continue;}
    await cooperate();stats.expandedStates++;
    // The canonical reducer needs a spawn token at the last known lock. Its arbitrary
    // synthetic spawn is stripped immediately and NEVER contributes a feature or terminal rank.
    const state={...parent.state,queue:parent.knownQueue.length?[...parent.knownQueue]:['I'],nextType:parent.knownQueue[0]??'I',rng:1,seed:1};
    const binding={sessionId:packet.observation.sessionId,revision:packet.stateRevision+depth-1};let children;
    try{children=enumerate(state,binding);}catch{fail('budget','reachability budget');}check();
    if(!children.length)fail('schema','missing reachable children');stats.childrenEnumerated+=children.length;
    for(const candidate of children){
     await cooperate();if(stats.nodes>=config.nodeCap)fail('budget','node budget');stats.nodes++;
     let simulation;try{simulation=simulate(state,candidate,binding);}catch{fail('schema','canonical child failure');}
     const won=simulation.state.status==='won',horizon=!won&&parent.knownQueue.length===0;
     const knownQueue=won?[...parent.knownQueue]:parent.knownQueue.slice(1);
     const projected={...simulation.state,queue:knownQueue,nextType:knownQueue[0]??'I',rng:1,seed:1,...(horizon?{active:null,status:'horizon'}:{})};
     const observation=observe(projected,{...binding,revision:binding.revision+1,previewLimit:knownQueue.length});
     const leaf=freeze({rootId:parent.rootId,leafId:`${parent.rootId}/d${depth}/${serial}`,depth,observation,features:features(projected.board),linesDelta:simulation.linesDelta,scoreDelta:simulation.scoreDelta,placedCells:candidate.cells,terminalReason:observation.terminalReason,knownPreviewRemaining:knownQueue.length,horizon});
     const evaluated=await evaluate(leaf),priorReward=parent.priorReward+config.discount**(parent.depth-1)*8*parent.linesDelta;
     const value=isTerminal(projected.status)?evaluated:priorReward+config.discount**(depth-1)*evaluated;
     pool.push({rootId:parent.rootId,rootOrder:parent.rootOrder,order:serial++,depth,value,priorReward,linesDelta:simulation.linesDelta,state:projected,knownQueue,leaf});
    }
   }
   pool.sort(compare);stats.depthReached=depth;
   for(const n of pool){const old=roots.get(n.rootId);if(n.depth>old.depthReached||(n.depth===old.depthReached&&(rank(n)>old.terminalRank||(rank(n)===old.terminalRank&&n.value>old.value))))roots.set(n.rootId,{rootId:n.rootId,value:n.value,terminalRank:rank(n),depthReached:n.depth});}
   if(depth<config.depth){stats.pruned+=Math.max(0,pool.length-config.beamWidth);beam=pool.slice(0,config.beamWidth);}else beam=pool;
  }
  const selected=beam.sort(compare)[0];stats.selectedDepth=selected.depth;stats.earlyTerminal=stats.depthReached<config.depth&&beam.every(n=>isTerminal(n.state.status))?1:0;stats.elapsedMs=performance.now()-started;
  const report={version:BEAM_VERSION,requestId:acceptedRequestId,ok:true,complete:true,policy,stats,selectedRootId:selected.rootId,value:selected.value,roots:[...roots.values()],bestLeaf:selected.leaf};
  if(size(report)>config.maxOutputBytes)fail('budget','output budget');check();return freeze(report);
 }catch(error){
  const safe=failure(error?.code,error?.reason);stats.elapsedMs=performance.now()-started;
  return freeze({version:BEAM_VERSION,requestId:acceptedRequestId,ok:false,complete:false,error:{code:safe.code,reason:safe.reason},selectedRootId:null,value:null,policyReference:{version:BEAM_VERSION,tier:policy.tier,evaluatorVersion:policy.evaluator.version},limits:{depth:config.depth,beamWidth:config.beamWidth,nodeCap:config.nodeCap,callCap:config.callCap,timeMs:config.timeMs,maxOutputBytes:config.maxOutputBytes},stats});
 }finally{scope.abort();queue.close();parentSignal?.removeEventListener('abort',forward);}
}
export async function evaluateVisibleBeam(packet,{signal,...options}={}){return search(packet,settings(options),signal);}
export function createConfigurableLookaheadProvider(options={}){
 const setup=settings(options),{policy}=setup;let active=null,serial=0,receiptSerial=0,lastSearch=null,lastReceipt=null;
 return Object.freeze({name:`Local lookahead depth ${policy.depth}`,kind:policy.evaluator.kind,version:BEAM_VERSION,
  capabilities:freeze({movementMode:'reachable-paused-gravity-v1',assistance:'canonical-afterstates-v1',maxCandidates:800}),
  runMetadata:freeze({name:'Visible-piece bounded beam search',version:BEAM_VERSION,search:policy,comparison:'Algorithm/assistance tier; bounded beam, not exhaustive search',liveEnabled:false,actualCostUSD:null}),
  get lastSearch(){return lastSearch;},get lastReceipt(){return lastReceipt;},
  async decide(packet,{signal}={}){
   if(active)throw new Error('A lookahead search is already running.');const job={serial:++serial,abort:new AbortController()};active=job;
   const cancel=()=>{job.abort.abort();if(active===job)active=null;};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   try{const report=await search(packet,setup,job.abort.signal);
    if(job.serial>=receiptSerial){lastSearch=report;lastReceipt=freeze({requestId:report.requestId,errorCode:report.ok?null:report.error.code,search:report.stats,usage:null,actualCostUSD:null,provenance:'Local/mock leaf evaluations; no live model calls'});receiptSerial=job.serial;}
    if(!report.ok)throw failure(report.error.code,report.error.reason);if(signal?.aborted||job.abort.signal.aborted)throw failure('cancelled','cancelled');
    return freeze({requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:report.selectedRootId});
   }finally{job.abort.abort();if(active===job)active=null;signal?.removeEventListener('abort',cancel);}
  }
 });
}
