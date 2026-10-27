import {tick,move,rotate,softDrop,cells,RULES} from './engine.mjs';
import {enumerate,freeze,observe} from './harness.mjs';
export const GRAVITY_TIMING='real-gravity-v1';
export const gravityPolicy=p=>freeze({...p,timing:GRAVITY_TIMING});
const key=points=>points.map(p=>`${p.x},${p.y}`).sort().join(';');
const fail=()=>{throw new Error('Invalid AI gravity proof');};
export function stateFromObservation(o,revealed=o.next[4]){
 return {board:o.board.map(r=>typeof r==='string'?[...r].map(c=>c==='.'?null:c):[...r]),active:o.active?{type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y}:null,
 queue:[...o.next,revealed],nextType:o.next[0],rng:1,seed:1,status:o.status,score:o.score,lines:o.lines,level:o.level,gravityElapsed:o.gravityElapsedMs};
}
/** One real-time piece. The chosen route is rederived from the falling pose, never trusted from a provider.
 * Lateral moves/turns execute immediately; route down steps and final descent wait for engine gravity.
 * A late/unreachable choice is discarded; gravity still locks the piece where it actually fell. */
export function createGravityTurn(initial,binding,{placementLimit=1}={}){
 if(initial.status!=='playing'||!initial.active||!Number.isInteger(placementLimit)||placementLimit<1||placementLimit>1000)fail();
 const offered=enumerate(initial,binding);let state=initial,route=null,chosen=null,locked=false,locks=0,missed=false,total=0;const reveals=[];
 const trace=[];
 const prefix=()=>{while(route?.length&&['left','right','clockwise'].includes(route[0])){const a=route.shift(),next=a==='left'?move(state,-1):a==='right'?move(state,1):rotate(state);if(next===state)fail();state=next;}};
 return {offered,get state(){return state;},get locked(){return locked;},get locks(){return locks;},get done(){return locked&&(!!chosen||locks>=placementLimit||['won','over'].includes(state.status));},get missed(){return missed;},get chosen(){return chosen;},get proof(){return freeze({version:'ai-gravity-turn-1',placementLimit,reveals:[...reveals],trace:trace.map(x=>({...x}))});},
 choose(id){
  if(chosen)fail();chosen=offered.find(c=>c.id===id);if(!chosen)fail();trace.push({choiceId:id});
  if(locked){missed=true;return;}
  const current=enumerate(state,binding).find(c=>key(c.cells)===key(chosen.cells));
  if(!current){missed=true;return;}route=[...current.path];prefix();
 },
 advance(ms){
  if(locked&&(chosen||locks>=placementLimit||['won','over'].includes(state.status)))return 0;if(!Number.isFinite(ms)||ms<=0||ms>20000)fail();
  const old=state;let remaining=ms,used=0;
  while(remaining>0&&(!locked||!chosen&&locks<placementLimit&&!['won','over'].includes(state.status))){
   const interval=Math.max(RULES.minimumGravityMs,Math.floor(RULES.gravityStartMs*RULES.gravityFactor**(state.level-1))),step=Math.min(remaining,interval-state.gravityElapsed),at=state;
   state=tick(state,step);remaining-=step;used+=step;
   if(state.board!==at.board){locked=true;locks++;reveals.push(state.queue[4]);if(chosen&&!missed&&key(cells(at.active))!==key(chosen.cells))fail();}
   else if(state.active.y!==at.active.y&&route){if(route[0]==='down')route.shift();prefix();}
  }
  if(state===old)return 0;total+=used;if(total>20000)fail();const last=trace.at(-1);if(last&&Object.hasOwn(last,'waitMs'))last.waitMs+=used;else trace.push({waitMs:used});return used;
 }};
}
/** Shared by the browser, server settlement and independent saved-record verifier. */
export function replayGravityProof(initial,binding,proof,{selectedCandidateId=null}={}){
 if(!proof||Object.keys(proof).sort().join(',')!=='placementLimit,reveals,trace,version'||proof.version!=='ai-gravity-turn-1'||!Array.isArray(proof.trace)||proof.trace.length>3||!Array.isArray(proof.reveals)||proof.reveals.length>1000||proof.reveals.some(t=>!RULES.types.includes(t)))fail();
 const seeded={...initial,queue:[...initial.queue.slice(0,5),...proof.reveals]},turn=createGravityTurn(seeded,binding,{placementLimit:proof.placementLimit});let choices=0;
 for(const item of proof.trace){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==1)fail();
  if(Object.hasOwn(item,'waitMs')){if(turn.done||turn.advance(item.waitMs)!==item.waitMs)fail();}
  else if(Object.hasOwn(item,'choiceId')){if(++choices>1||item.choiceId!==selectedCandidateId)fail();turn.choose(item.choiceId);}else fail();
 }
 if((selectedCandidateId!==null)!==(choices===1)||JSON.stringify(turn.proof.reveals)!==JSON.stringify(proof.reveals))fail();return turn;
}
export function gravityObservation(turn,binding){return observe(turn.state,{sessionId:binding.sessionId,revision:binding.revision+1});}
