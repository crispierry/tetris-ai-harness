import {createGame,start,DEFAULT_SEED,isTerminal} from './engine.mjs';
import {observe,candidateEvidence,freeze} from './harness.mjs';
import {instructionPacket,validateChoice} from './briefing.mjs';
import {compactReceipt,localSearchReceipt} from './provider-policy.mjs';
import {recordedObservation} from './decision-record.mjs';
import {createGravityTurn} from './ai-gravity.mjs';

let instances=0;
/** Real-time counterpart to the step controller. One request per falling piece; no automatic retries.
 * A completed response is only a plan. The server acknowledges the actual checked gravity trace.
 * Clock and lifecycle ownership are independent of provider latency and presentation preferences. */
export class GravityController{
 #pieceCap;#state;#seed;#id;#epoch;#revision=0;#serial=0;#pieces=0;#provider;#deadline;#pending=null;
 #status='ready';#error=null;#last=null;#recovery=false;#onChange;#onTransition;#clock;
 constructor({pieceCap=1000,seed=DEFAULT_SEED,sessionId=`gravity-${++instances}`,gameEpoch=0,provider,deadlineMs=1500,onChange=()=>{},onTransition=()=>{},clock={now:()=>performance.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}}={}){
  if(!/^[A-Za-z0-9_-]{1,60}$/.test(sessionId)||!Number.isInteger(gameEpoch)||gameEpoch<0||gameEpoch>=100||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>60000)throw new TypeError('Invalid gravity controller configuration');
  if(!Number.isInteger(pieceCap)||pieceCap<1||pieceCap>1000)throw new TypeError('Invalid piece cap');this.#pieceCap=pieceCap;this.#seed=seed;this.#state=createGame(seed);this.#id=sessionId;this.#epoch=gameEpoch;this.#deadline=deadlineMs;this.#onChange=onChange;this.#onTransition=onTransition;this.#clock=clock;this.setProvider(provider);
 }
 get #binding(){return {sessionId:`${this.#id}-${this.#epoch}`,revision:this.#revision};}
 get view(){return freeze({observation:observe(this.#state,this.#binding),status:this.#status,pieces:this.#pieces,error:this.#error,recoveryRequired:this.#recovery,lastDecision:this.#last,
  player:{name:this.#provider.name,kind:this.#provider.kind,version:this.#provider.version},busy:!!this.#pending,gravity:true,missedChoice:this.#pending?.turn.missed??this.#last?.missedChoice??false});}
 #emit(){this.#onChange(this.view);}
 #record(input,{state=this.#state,status=this.#status,pieces=this.#pieces,revision=this.#revision}={}){
  try{this.#onTransition({input,view:{observation:observe(state,{sessionId:`${this.#id}-${this.#epoch}`,revision}),status,pieces}});return true;}
  catch(e){if(!/Canonical recording capacity/.test(e.message))throw e;this.#status='stopped';this.#error=e.message;return false;}
 }
 setProvider(provider){if(this.#pending||this.#status==='running')throw new Error('Pause before changing player');if(!provider||typeof provider.decide!=='function'||typeof provider.name!=='string'||provider.capabilities?.movementMode!=='reachable-paused-gravity-v1'||provider.capabilities?.assistance!=='canonical-afterstates-v1'||!Number.isInteger(provider.capabilities.maxCandidates)||provider.capabilities.maxCandidates<1||provider.capabilities.maxCandidates>800)throw new Error('Unsupported provider capability');this.#provider=provider;}
 start(){if(this.#recovery||isTerminal(this.#state.status))return;if(this.#pending)throw new Error('Decision already in progress');if(!this.#record({kind:'start'},{status:'running'}))return;this.#status='running';this.#error=null;this.#emit();}
 #advance(job){
  if(this.#pending!==job||job.finalizing)return;
  const now=this.#clock.now(),elapsed=Math.max(0,Math.floor(now-job.lastClock));job.lastClock+=elapsed;
  if(elapsed&&!job.turn.done){job.turn.advance(Math.min(20000,elapsed));this.#state=job.turn.state;}
  if(job.turn.done){this.#clock.clearTimeout(job.timer);job.wake();}
  this.#emit();
 }
 #schedule(job){job.timer=this.#clock.setTimeout(()=>{this.#advance(job);if(this.#pending===job&&!job.finalizing&&!job.turn.done)this.#schedule(job);},50);}
 async #finish(job,outcome,error=null){
  if(job.finalizing)return job.finalizing;
  const operation=(async()=>{
   this.#clock.clearTimeout(job.timer);job.wake();
   const selected=job.selected??null,remote=this.#provider.kind==='remote',recovery=remote&&(outcome==='cancel'||outcome==='error');
   const receipt=selected?job.receipt:null;
   const status=isTerminal(this.#state.status)?this.#state.status:recovery?'error':outcome==='placed'?(job.continueRunning?'running':'paused'):outcome==='cancel'?job.control:outcome;
   const input={kind:'gravity',requestId:job.requestId,revision:job.binding.revision,selectedCandidateId:selected,receipt,latencyMs:job.latencyMs??Math.max(0,this.#clock.now()-job.started),proof:job.turn.proof,outcome,recoveryRequired:recovery};
   const pieces=this.#pieces+job.turn.locks,revision=this.#revision+1;
   if(!this.#record(input,{status,pieces,revision})){job.abort.abort();return;}
   this.#revision=revision;this.#pieces=pieces;this.#status=status;this.#recovery=recovery;this.#error=error;
   if(job.last)this.#last=freeze({...job.last,missedChoice:job.turn.missed});
   const observed=recordedObservation(observe(this.#state,this.#binding));
   if(selected&&remote){
    // The full trace is captured before asynchronous acknowledgement; Reset cannot change its identity.
    job.abort.abort('placement-committed');this.#emit();
    try{await this.#provider.confirmGravity(job.requestId,{proof:job.turn.proof,observation:observed});}
    catch{if(this.#pending===job&&job.epoch===this.#epoch){this.#recovery=true;this.#status=isTerminal(this.#state.status)?this.#state.status:'error';this.#error='Board retained. OpenAI confirmation is unavailable; see provider status before continuing.';}}
   }else job.abort.abort();
  })();job.finalizing=operation;return operation;
 }
 #cancel(control){
  const job=this.#pending;
  if(job){if(job.finalizing){this.#status=isTerminal(this.#state.status)?this.#state.status:this.#recovery?'error':control;this.#emit();return;}
   this.#advance(job);job.control=control;void this.#finish(job,job.selected?control:'cancel',this.#provider.kind==='remote'&&!job.selected?'Cancelled — see provider status before continuing.':null).catch(error=>{this.#status='error';this.#error=error.message;job.abort.abort();}).finally(()=>{if(this.#pending===job)this.#pending=null;this.#emit();});
  }else{if(!isTerminal(this.#state.status))this.#record({kind:control==='stopped'?'stop':'pause'},{status:this.#recovery?'error':control});this.#status=isTerminal(this.#state.status)?this.#state.status:this.#recovery?'error':control;}
  this.#emit();
 }
 pause(){this.#cancel('paused');}
 stop(){this.#cancel('stopped');this.#provider.invalidateAccounting?.();}
 reset(){this.#cancel('stopped');this.#pending=null;this.#epoch++;this.#revision=0;this.#pieces=0;this.#state=createGame(this.#seed);this.#status='ready';this.#error=null;this.#last=null;this.#recovery=false;this.#provider.invalidateAccounting?.();this.#emit();}
 async step({continueRunning=false,admitDecision=null}={}){
  if(this.#recovery||this.#pieces>=this.#pieceCap||isTerminal(this.#state.status))return null;if(this.#pending)throw new Error('Decision already in progress');
  if(this.#state.status==='ready'){const next=start(this.#state);if(!this.#record({kind:'spawn'},{state:next,revision:this.#revision+1}))return null;this.#state=next;this.#revision++;}
  const binding=this.#binding,started=this.#clock.now(),turn=createGravityTurn(this.#state,binding,{placementLimit:continueRunning?this.#pieceCap-this.#pieces:1}),abort=new AbortController();let wake;
  const locked=new Promise(r=>wake=r),job={turn,binding,epoch:this.#epoch,started,lastClock:started,abort,wake,continueRunning,requestId:`${binding.sessionId}:${binding.revision}:${++this.#serial}`};
  this.#pending=job;this.#last=null;this.#error=null;this.#status='choosing';this.#provider.invalidateAccounting?.();this.#schedule(job);this.#emit();
  let timer,abortListener;
  try{
   if(this.#provider.kind==='remote'&&typeof this.#provider.confirmGravity!=='function')throw new Error('This connection needs simulation mode. Reset, then turn Gravity off.');
   if(turn.offered.length>this.#provider.capabilities.maxCandidates)throw new Error('Provider candidate limit exceeded; no placements were discarded');
   const packet=instructionPacket(observe(turn.state,binding),turn.offered.map(c=>candidateEvidence(turn.state,c,binding)),{requestId:job.requestId,deadlineMs:this.#deadline,gravity:true});
   if(new TextEncoder().encode(JSON.stringify(packet)).length>1048576)throw new Error('Decision packet exceeds one MiB limit');
   let timeout;const guard=new Promise((_,reject)=>{timeout=()=>reject(new Error('Decision deadline exceeded'));abortListener=()=>reject(new Error('Cancelled'));abort.signal.addEventListener('abort',abortListener,{once:true});});
   const response=await Promise.race([Promise.resolve().then(async()=>{const release=await admitDecision?.(abort.signal);try{if(abort.signal.aborted)throw new Error('Cancelled');job.decisionStarted=this.#clock.now();timer=this.#clock.setTimeout(timeout,this.#deadline);return await this.#provider.decide(packet,{signal:abort.signal,gravity:true});}finally{release?.();}}),guard]);
   if(this.#pending!==job||job.finalizing||abort.signal.aborted)return null;
   job.latencyMs=this.#clock.now()-job.decisionStarted;if(job.latencyMs>=this.#deadline)throw new Error('Decision deadline exceeded');
   if(new TextEncoder().encode(JSON.stringify(response)).length>4096)throw new Error('Decision response exceeds size limit');
   const id=validateChoice(packet,response);job.receipt=this.#provider.kind==='remote'?compactReceipt(this.#provider.lastReceipt):this.#provider.runMetadata?.search?localSearchReceipt(this.#provider.lastReceipt):null;this.#advance(job);if(this.#pending!==job||job.finalizing||abort.signal.aborted)return null;turn.choose(id);job.selected=id;this.#state=turn.state;
   job.last={candidate:packet.candidates.find(c=>c.id===id),latencyMs:job.latencyMs,requestId:job.requestId,player:this.#provider.name,receipt:this.#provider.lastReceipt??null};
   this.#last=freeze({...job.last,missedChoice:turn.missed});this.#status='falling';this.#emit();
   this.#clock.clearTimeout(timer);abort.signal.removeEventListener('abort',abortListener);abortListener=null;
   if(!turn.locked)await locked;
   if(this.#pending!==job||job.finalizing)return null;
   await this.#finish(job,'placed');return this.#last;
  }catch(error){if(this.#pending===job&&!job.finalizing){this.#advance(job);await this.#finish(job,'error',error.message); }return null;}
  finally{this.#clock.clearTimeout(timer);if(abortListener)abort.signal.removeEventListener('abort',abortListener);if(job.finalizing)await job.finalizing;if(this.#pending===job)this.#pending=null;this.#clock.clearTimeout(job.timer);this.#emit();}
 }
}
