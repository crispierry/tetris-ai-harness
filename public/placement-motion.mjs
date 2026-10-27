import {cells,move,rotate,softDrop} from './engine.mjs';
import {freeze} from './harness.mjs';
const actions={L:'left',R:'right',C:'clockwise',D:'down',H:'drop'};
const points=p=>p.map(({x,y})=>`${x},${y}`).sort().join(';');
const board=o=>o.board.map(r=>typeof r==='string'?[...r].map(c=>c==='.'?null:c):[...r]);
/** Pure visual evidence: only legal engine poses along the actual committed path. */
export function placementTrajectory({beforeObservation:before,afterObservation:after,path,piece,placedCells}){
 if(!before?.active||!after||!Array.isArray(before.next))return [];
 if(typeof path==='string')path=[...path].map(c=>actions[c]);
 if(!Array.isArray(path)||!path.length||path.length>800)return [];
 let state={board:board(before),active:{type:before.active.type,rotation:before.active.rotation,x:before.active.x,y:before.active.y},queue:[...before.next,after.next?.[4]??'I'],rng:1,seed:1,nextType:before.next[0],score:before.score,lines:before.lines,level:before.level,status:'playing',gravityElapsed:before.gravityElapsedMs??0};
 const poses=[],add=()=>poses.push(freeze({...state.active,cells:cells(state.active)}));add();let locked=false,landing;
 for(let i=0;i<path.length;i++){
  const action=path[i];if(!['left','right','clockwise','down','drop'].includes(action)||locked)return [];
  const advance=()=>{const old=state;landing=old.active;const next=softDrop(old);if(next.board!==old.board){state=next;locked=true;}else{state=next;add();}};
  if(action==='drop'){for(let n=0;n<=20&&!locked;n++)advance();}
  else if(action==='down')advance();
  else{const next=action==='left'?move(state,-1):action==='right'?move(state,1):rotate(state);if(next===state)return [];state=next;add();}
  if(locked&&i!==path.length-1)return [];
 }
 if(!locked||landing.type!==piece||points(cells(landing))!==points(placedCells??[])||JSON.stringify(state.board)!==JSON.stringify(board(after))||['score','lines','level','status'].some(k=>state[k]!==after[k]))return [];
 return freeze(poses);
}
/** Presentation owns no game state. Abort settles immediately; generations fence old callbacks. */
export function createPlacementPresenter({window:win=globalThis,onFrame=()=>{},onSettled=()=>{},durationMs=350,reducedMotion=()=>typeof win.matchMedia!=='function'||win.matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
 let generation=0,active=null;
 const cancel=()=>{generation++;const job=active;if(!job)return;active=null;if(job.frame!==null)win.cancelAnimationFrame?.(job.frame);job.signal?.removeEventListener('abort',job.abort);onSettled();job.resolve();};
 return Object.freeze({cancel,dispose:cancel,get active(){return !!active;},async play(event){
  cancel();const token=generation,poses=placementTrajectory(event);
  if(event.signal?.aborted||poses.length<2||reducedMotion()||typeof win.requestAnimationFrame!=='function'){onSettled();return;}
  return new Promise(resolve=>{const job={resolve,frame:null,signal:event.signal,abort:cancel};active=job;event.signal?.addEventListener('abort',cancel,{once:true});let started=null,last=-1;
   const frame=now=>{if(token!==generation||active!==job)return;if(started===null)started=now;const progress=Math.min(1,(now-started)/durationMs),index=Math.min(poses.length-1,Math.floor(progress*(poses.length-1)));
    if(index!==last){last=index;onFrame({...event.beforeObservation,active:poses[index]});}
    if(progress>=1){active=null;job.signal?.removeEventListener('abort',cancel);onSettled();resolve();}else job.frame=win.requestAnimationFrame(frame);
   };onFrame({...event.beforeObservation,active:poses[0]});job.frame=win.requestAnimationFrame(frame);
  });
 }});
}
export function placementEvent(beforeView,afterView,{lane=0,generation=0,replay=false,signal}={}){const c=afterView.lastDecision?.candidate;return {lane,generation,requestId:afterView.lastDecision?.requestId??null,beforeObservation:beforeView.observation,afterObservation:afterView.observation,path:c?.path,piece:c?.piece,placedCells:c?.cells,replay,signal};}
export function depth2Error(provider,error,mode){const search=provider?.runMetadata?.search,e=provider?.lastSearch?.error,depth=search?.depth;if(!error||!e||!(search?.version==='visible-beam-search-1'||depth===2))return error;const limit=e.code==='timeout'&&e.reason==='time budget'?'time':e.code==='budget'&&e.reason==='node budget'?'node':e.code==='budget'&&e.reason==='output budget'?'output':null;if(!limit)return error;return `Depth ${depth} search reached its ${limit} limit. No piece was placed. Reset, then ${mode==='comparison'?'lower the depth or adjust Run settings':'lower the depth or choose another player'}.`;}
