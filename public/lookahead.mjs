import { createGame, RULES } from './engine.mjs';
import { enumerate, simulate, observe, features, freeze, VERSIONS } from './harness.mjs';
import { HEURISTIC_WEIGHTS } from './controller.mjs';
import { BRIEF_VERSION } from './briefing.mjs';
export const LOOKAHEAD_VERSION = 'visible-placement-search-1';
const defaults = Object.freeze({ depth: 1, nodeCap: 4000, callCap: 4000, timeMs: 500, maxOutputBytes: 2097152, discount: .9 });
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const failureReasons=freeze({configuration:['unsupported configuration','unsupported mock','unsupported evaluator','explicit bounded evaluator policy required','evaluator metadata too large','overlapping search'],
  input:['private field','invalid public packet','invalid observation','duplicate root','root horizon or binding mismatch','insufficient known horizon','synthetic refill boundary','invalid public data'],
  budget:['node budget','evaluator call budget','output budget','reachability budget'],timeout:['time budget'],cancelled:['cancelled'],schema:['invalid leaf value','missing reachable children','canonical child failure'],provider_error:['leaf evaluator error']});
class SearchFailure extends Error {
  constructor(code, reason) {
    const valid=typeof code==='string'&&Object.hasOwn(failureReasons,code)&&typeof reason==='string'&&failureReasons[code].includes(reason);
    if(!valid){code='provider_error';reason='leaf evaluator error';}
    super(`Bounded search stopped: ${reason}. No placement selected.`); this.code=code;this.reason=reason;
  }
}
const fail=(code,reason)=>{throw new SearchFailure(code,reason);};
const bounded=(n,max)=>Number.isInteger(n)&&n>=1&&n<=max;
function configuration(input) {
  const c={...defaults,...input};
  if(Object.keys(c).some(k=>!Object.hasOwn(defaults,k))||![1,2].includes(c.depth)||!bounded(c.nodeCap,4000)||!bounded(c.callCap,4000)||
    !bounded(c.timeMs,5000)||!Number.isInteger(c.maxOutputBytes)||c.maxOutputBytes<4096||c.maxOutputBytes>4194304||!Number.isFinite(c.discount)||c.discount<0||c.discount>1)fail('configuration','unsupported configuration');
  return freeze(c);
}
export function localLeafEvaluator() {
  return Object.freeze({name:'Local leaf heuristic',kind:'local',version:'local-leaf-value-1',policy:freeze({weights:HEURISTIC_WEIGHTS,terminalPenalty:-1000000,valueRange:[-1000000,1000000],meaning:'Heuristic board value, not win probability'}),
    evaluate(leaf){const f=leaf.features,w=HEURISTIC_WEIGHTS;return leaf.terminalReason?-1000000:w.holes*f.holes+w.aggregateHeight*f.aggregateHeight+w.maxHeight*f.maxHeight+w.bumpiness*f.bumpiness+w.lines*leaf.linesDelta;} });
}
export function mockLeafEvaluator({mode='delay',delayMs=0}={}) {
  if(!['delay','error','invalid','never'].includes(mode)||!Number.isInteger(delayMs)||delayMs<0||delayMs>60000)fail('configuration','unsupported mock');
  const local=localLeafEvaluator();
  return Object.freeze({...local,name:'Mock leaf evaluator',kind:'mock',version:`mock-leaf-${mode}-1`,policy:freeze({...local.policy,mockMode:mode,delayMs}),
    async evaluate(leaf,{signal}={}){
      await new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new SearchFailure('cancelled','cancelled'));};
        if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
        if(mode!=='never')timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delayMs);});
      if(mode==='error')throw new Error('Deliberate mock leaf failure');if(mode==='invalid')return NaN;return local.evaluate(leaf);
    } });
}
function publicOnly(value) {
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){if(['seed','rng','queue','apikey','authorization','token','accesstoken','authtoken','clientsecret','password','secret'].includes(key.replace(/[-_]/g,'').toLowerCase()))fail('input','private field');publicOnly(item);}
}
function evaluatorIdentity(evaluator) {
  if(!evaluator||!['local','mock'].includes(evaluator.kind)||typeof evaluator.evaluate!=='function'||typeof evaluator.name!=='string'||!evaluator.name||evaluator.name.length>120||typeof evaluator.version!=='string'||!evaluator.version||evaluator.version.length>80)fail('configuration','unsupported evaluator');
  const p=evaluator.policy;
  if(!p||typeof p.meaning!=='string'||!p.meaning||p.meaning.length>500||JSON.stringify(p.valueRange)!==JSON.stringify([-1000000,1000000])||
    Object.keys(p).some(k=>!['weights','terminalPenalty','valueRange','meaning','formula','mockMode','delayMs'].includes(k)))fail('configuration','explicit bounded evaluator policy required');
  const meta={name:evaluator.name,kind:evaluator.kind,version:evaluator.version,policy:p};
  publicOnly(meta);if(size(meta)>4096)fail('configuration','evaluator metadata too large');return freeze(JSON.parse(JSON.stringify(meta)));
}
function checkPacket(p) {
  if(!p||p.schemaVersion!==VERSIONS.decision||p.rulesBrief?.version!==BRIEF_VERSION||p.observation?.rulesVersion!==RULES.version||p.observation.next?.length!==5||
    !Number.isInteger(p.deadlineMs)||p.deadlineMs<1||typeof p.requestId!=='string'||!p.requestId||p.requestId.length>200||!Array.isArray(p.candidates)||!p.candidates.length||p.candidates.length>800||size(p)>1048576)fail('input','invalid public packet');
  publicOnly(p);
  const validObservation=(o,preview)=>o&&o.schemaVersion===VERSIONS.observation&&o.width===10&&o.visibleHeight===20&&o.hiddenRows===0&&o.objective===RULES.objective&&
    o.previewCount===preview&&Array.isArray(o.next)&&o.next.length===preview&&o.next.every(t=>RULES.types.includes(t))&&
    ['score','lines','level','revision'].every(k=>Number.isSafeInteger(o[k])&&o[k]>=0)&&o.level===Math.floor(o.lines/10)+1&&
    Array.isArray(o.board)&&o.board.length===20&&o.board.every(row=>Array.isArray(row)&&row.length===10&&row.every(c=>c===null||RULES.types.includes(c)))&&
    ['playing','over'].includes(o.status)&&(o.status==='over'?o.active===null:o.active&&RULES.types.includes(o.active.type)&&Number.isInteger(o.active.rotation)&&o.active.rotation>=0&&o.active.rotation<4&&Number.isInteger(o.active.x)&&Number.isInteger(o.active.y));
  if(!validObservation(p.observation,5)||p.observation.revision!==p.stateRevision||p.observation.status!=='playing')fail('input','invalid observation');
  if(new Set(p.candidates.map(c=>c.id)).size!==p.candidates.length)fail('input','duplicate root');
  for(const c of p.candidates){const a=c.afterstate;
    if(typeof c.id!=='string'||c.id.length>200||c.revision!==p.stateRevision||c.sessionId!==p.observation.sessionId||!a||a.rulesVersion!==RULES.version||
      a.revision!==p.stateRevision+1||a.sessionId!==p.observation.sessionId||a.next?.length!==4||JSON.stringify(a.next)!==JSON.stringify(p.observation.next.slice(1))||
      !validObservation(a,4)||(a.status==='playing'&&a.active?.type!==p.observation.next[0])||!Number.isInteger(c.linesDelta)||c.linesDelta<0||c.linesDelta>4||c.linesDelta!==a.lines-p.observation.lines||c.scoreDelta!==a.score-p.observation.score)fail('input','root horizon or binding mismatch');
  }
}
function syntheticState(observation) {
  // This randomizer is isolated scaffolding. Only known queue entries can affect depth-two placement/spawn.
  const initial=createGame(1),active=observation.active;
  return {...initial,board:observation.board.map(row=>[...row]),active:active?{type:active.type,rotation:active.rotation,x:active.x,y:active.y}:null,
    queue:[...observation.next],nextType:observation.next[0],status:observation.status,score:observation.score,lines:observation.lines,level:observation.level,gravityElapsed:observation.gravityElapsedMs};
}
const leafFrom=(rootId,leafId,depth,observation,linesDelta,scoreDelta,placedCells)=>freeze({rootId,leafId,depth,observation,
  features:features(observation.board),linesDelta,scoreDelta,placedCells,terminalReason:observation.terminalReason,knownPreviewRemaining:observation.next.length});
const policyFor=(config,evaluator)=>freeze({version:LOOKAHEAD_VERSION,rulesVersion:RULES.version,featureVersion:VERSIONS.features,objective:RULES.objective,
  tier:`visible-depth-${config.depth}-full-occupancy-v1`,...config,evaluator,rootReward:'8 × root cleared lines, plus discounted child leaf value at depth2',
  tieOrder:'Original root candidate order, then canonical child order',pruning:'none; every offered root and reachable child within caps',cache:'none',
  cacheKeyDefinition:'If enabled later: rules/observation/feature/evaluator/objective/search-policy versions and complete known board/active/preview',
  nodeUnit:'Placement nodes: supplied roots plus simulated child placements',reachabilityBounds:{poses:800,transitions:4000},
  horizon:'Current placement plus at most one known next placement; child preview at most original remaining three',live:false,modelCalls:0,spendCapUSD:0});
async function search(packet,config,evaluator,policy,signal) {
  const parentSignal=signal,scope=new AbortController(),forwardAbort=()=>scope.abort();
  parentSignal?.addEventListener('abort',forwardAbort,{once:true});if(parentSignal?.aborted)scope.abort();signal=scope.signal;
  const started=performance.now(),stats={nodes:0,evaluatorCalls:0,rootsOffered:0,rootsCompleted:0,childrenEnumerated:0,leavesEvaluated:0,pruned:0,elapsedMs:0};
  let deadline=config.timeMs,acceptedRequestId=null;
  const check=()=>{if(signal?.aborted)fail('cancelled','cancelled');if(performance.now()-started>=deadline)fail('timeout','time budget');};
  const visit=async()=>{check();if(stats.nodes>=config.nodeCap)fail('budget','node budget');stats.nodes++;if(stats.nodes%16===0)await new Promise(r=>setTimeout(r,0));check();};
  const evaluate=async leaf=>{
    check();if(stats.evaluatorCalls>=config.callCap)fail('budget','evaluator call budget');if(size(leaf)>config.maxOutputBytes)fail('budget','output budget');stats.evaluatorCalls++;
    let timer,listener,value;
    try{const guard=new Promise((_,reject)=>{listener=()=>reject(new SearchFailure('cancelled','cancelled'));signal?.addEventListener('abort',listener,{once:true});
      timer=setTimeout(()=>reject(new SearchFailure('timeout','time budget')),Math.max(1,deadline-(performance.now()-started)));});
      value=await Promise.race([Promise.resolve().then(()=>evaluator.evaluate(leaf,{signal})),guard]);
    }catch(error){if(error instanceof SearchFailure)throw error;fail('provider_error','leaf evaluator error');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',listener);}
    check();if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000)fail('schema','invalid leaf value');stats.leavesEvaluated++;return value;
  };
  try{
    checkPacket(packet);acceptedRequestId=packet.requestId;stats.rootsOffered=packet.candidates.length;deadline=Math.min(config.timeMs,packet.deadlineMs);check();const roots=[];
    for(const root of packet.candidates){
      await visit();let bestLeaf=null,bestValue=-Infinity,leafCount=0;
      if(config.depth===1||root.afterstate.status==='over'){
        const safeRootObservation=observe(syntheticState(root.afterstate),{sessionId:root.afterstate.sessionId,revision:root.afterstate.revision,previewLimit:4});
        const leaf=leafFrom(root.id,root.id,1,safeRootObservation,root.linesDelta,root.scoreDelta,root.cells.map(p=>({x:p.x,y:p.y}))),value=await evaluate(leaf);
        bestLeaf=freeze({...leaf,value});bestValue=value;leafCount=1;
      }else{
        if(root.afterstate.next.length<2)fail('input','insufficient known horizon');
        const state=syntheticState(root.afterstate),binding={sessionId:root.afterstate.sessionId,revision:root.afterstate.revision};let children;
        try{children=enumerate(state,binding);}catch{fail('budget','reachability budget');}
        check();if(!children.length)fail('schema','missing reachable children');stats.childrenEnumerated+=children.length;
        for(const child of children){
          await visit();let simulation;try{simulation=simulate(state,child,binding);}catch{fail('schema','canonical child failure');}
          const observation=observe(simulation.state,{...binding,revision:binding.revision+1,previewLimit:Math.min(3,root.afterstate.next.length-1)});
          if(JSON.stringify(observation.next)!==JSON.stringify(root.afterstate.next.slice(1,4)))fail('input','synthetic refill boundary');
          const leaf=leafFrom(root.id,`${root.id}/${child.id}`,2,observation,simulation.linesDelta,simulation.scoreDelta,simulation.placedCells),value=await evaluate(leaf);
          leafCount++;if(value>bestValue){bestValue=value;bestLeaf=freeze({...leaf,value});}
        }
        bestValue=HEURISTIC_WEIGHTS.lines*root.linesDelta+config.discount*bestValue;
      }
      roots.push(freeze({rootId:root.id,value:bestValue,bestLeaf,leafCount}));stats.rootsCompleted++;
      if(size({roots,stats,policy})>config.maxOutputBytes)fail('budget','output budget');check();
    }
    let selected=roots[0];for(const root of roots)if(root.value>selected.value)selected=root;
    stats.elapsedMs=performance.now()-started;
    const report={version:LOOKAHEAD_VERSION,requestId:packet.requestId,ok:true,complete:true,policy,stats,selectedRootId:selected.rootId,value:selected.value,roots};
    if(size(report)>config.maxOutputBytes)fail('budget','output budget');check();return freeze(report);
  }catch(error){let safe=new SearchFailure('input','invalid public data');
    if(error instanceof SearchFailure){try{safe=new SearchFailure(error.code,error.reason);}catch{safe=new SearchFailure('provider_error','leaf evaluator error');}}
    stats.elapsedMs=performance.now()-started;
    const core={version:LOOKAHEAD_VERSION,requestId:acceptedRequestId,ok:false,complete:false,error:{code:safe.code,reason:safe.reason},selectedRootId:null,value:null};
    let report={...core,policyReference:{version:LOOKAHEAD_VERSION,tier:policy.tier,evaluatorVersion:policy.evaluator.version},limits:config,stats};
    // Failed output is bounded too; invalid identities and complete evaluator policies are never echoed.
    if(size(report)>config.maxOutputBytes)report={...core,requestId:null,stats:{nodes:stats.nodes,evaluatorCalls:stats.evaluatorCalls,elapsedMs:stats.elapsedMs}};
    return freeze(report);
  }finally{parentSignal?.removeEventListener('abort',forwardAbort);scope.abort();}
}
export async function evaluateLookahead(packet,{evaluator=localLeafEvaluator(),signal,...options}={}) {
  const config=configuration(options),identity=evaluatorIdentity(evaluator);return search(packet,config,evaluator,policyFor(config,identity),signal);
}
export function createLookaheadProvider({evaluator=localLeafEvaluator(),...options}={}) {
  const config=configuration(options),identity=evaluatorIdentity(evaluator),policy=policyFor(config,identity);
  const metadata=freeze({name:'Bounded visible-queue lookahead',version:LOOKAHEAD_VERSION,search:policy,comparison:'Algorithm/assistance tier; not equal-assistance provider quality',liveEnabled:false,actualCostUSD:null});
  let active=null,serial=0,receiptSerial=0,lastSearch=null,lastReceipt=null;
  return Object.freeze({name:`Local lookahead depth ${config.depth}`,kind:evaluator.kind,version:LOOKAHEAD_VERSION,
    capabilities:freeze({movementMode:'reachable-paused-gravity-v1',assistance:'canonical-afterstates-v1',maxCandidates:800}),
    get runMetadata(){return metadata;},get lastSearch(){return lastSearch;},get lastReceipt(){return lastReceipt;},
    async decide(packet,{signal}={}){
      if(active)fail('configuration','overlapping search');const job={serial:++serial,abort:new AbortController()};active=job;
      const cancel=()=>{if(active===job)active=null;job.abort.abort();};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
      try{const report=await search(packet,config,evaluator,policy,job.abort.signal);
        if(job.serial>=receiptSerial){lastSearch=report;lastReceipt=freeze({requestId:report.requestId,errorCode:report.ok?null:report.error.code,search:report.stats,usage:null,actualCostUSD:null,provenance:'Local/mock leaf evaluations; no live model calls'});receiptSerial=job.serial;}
        if(!report.ok)throw new SearchFailure(report.error.code,report.error.reason);
        if(job.abort.signal.aborted||signal?.aborted)fail('cancelled','cancelled');
        return freeze({requestId:packet.requestId,stateRevision:packet.stateRevision,selectedCandidateId:report.selectedRootId});
      }finally{signal?.removeEventListener('abort',cancel);job.abort.abort();if(active===job)active=null;}
    } });
}
