import {freeze} from './harness.mjs';
import {compactPlayerName} from './arcade-copy.mjs';
/** Active play time: includes choosing, admission waits, gravity, pacing and presentation; excludes user pauses. */
export class RunClock{
 #now;#elapsed=0;#since=null;#finished=false;#started=false;#decisionMs=0;#seen=new Set();
 constructor({now=()=>performance.now()}={}){this.#now=now;}
 start(){if(this.#finished||this.#since!==null)return;this.#since=this.#now();this.#started=true;}
 pause(){if(this.#since===null)return;this.#elapsed+=Math.max(0,this.#now()-this.#since);this.#since=null;}
 finish(){this.pause();this.#finished=true;}
 reset(){this.#elapsed=0;this.#since=null;this.#finished=false;this.#started=false;this.#decisionMs=0;this.#seen.clear();}
 record(last){if(!last?.requestId||this.#seen.has(last.requestId)||!Number.isFinite(last.latencyMs)||last.latencyMs<0||last.latencyMs>60000)return;this.#seen.add(last.requestId);this.#decisionMs+=last.latencyMs;}
 get view(){return freeze({elapsedMs:Math.round(this.#elapsed+(this.#since===null?0:Math.max(0,this.#now()-this.#since))),decisionMs:Math.round(this.#decisionMs*1000)/1000,decisions:this.#seen.size,running:this.#since!==null,started:this.#started,finished:this.#finished});}
}
export function formatElapsed(ms){const ticks=Math.floor(Math.max(0,Number.isFinite(ms)?ms:0)/100),seconds=Math.floor(ticks/10),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60),pad=n=>String(n).padStart(2,'0');return `${hours?hours+':':''}${pad(hours?minutes%60:minutes)}:${pad(seconds%60)}.${ticks%10}`;}
const seconds=ms=>`${(ms/1000).toFixed(1)}s`;
const ratio=n=>n>=100?n.toFixed(0):n.toFixed(1);
/** Only a matched 300-line goal supports a time-to-goal claim. Other completed games use per-piece pace. */
export function comparisonPace(pairs,names,{expectedPairs=pairs.length,complete=true,archiveError=null}={}){
 if(!complete)return null;
 const title=archiveError||pairs.length!==expectedPairs||pairs.some(p=>['left','right'].some(side=>p[side].status==='error'))?'Run incomplete':'Run finished';
 if(title==='Run incomplete')return {title,text:'A model stopped early. There is no completed-run speed comparison.',detail:archiveError?'Recording stopped before the run finished.':'Errors and unfinished samples are excluded from speed claims.'};
 const sums=['left','right'].map(side=>pairs.reduce((a,p)=>({elapsedMs:a.elapsedMs+(p[side+'Timing']?.elapsedMs??0),pieces:a.pieces+p[side].pieces,lines:a.lines+p[side].lines}),{elapsedMs:0,pieces:0,lines:0}));
 if(!pairs.length||pairs.some(p=>!p.leftTiming||!p.rightTiming)||sums.some(s=>s.elapsedMs<100||s.pieces<1))return {title,text:'This run was too short for a useful speed comparison.',detail:'Run more pieces to compare active play time.'};
 const label=names.map(compactPlayerName),same=label[0]===label[1];if(same){label[0]+=' (left)';label[1]+=' (right)';}
 if(pairs.every(p=>p.left.status==='won'&&p.right.status==='won')){
  const fast=sums[0].elapsedMs<=sums[1].elapsedMs?0:1,slow=1-fast,a=sums[fast].elapsedMs,b=sums[slow].elapsedMs,diff=b-a,goal=pairs.length===1?'300 lines':`all ${pairs.length} samples`;
  return {title,text:diff<100?`Both models reached ${goal} in about ${seconds(a)}.`:`${label[fast]} reached ${goal} ${seconds(diff)} sooner (${Math.round(diff/b*100)||'<1'}% less active time).`,detail:`${label[0]} ${formatElapsed(sums[0].elapsedMs)} · ${label[1]} ${formatElapsed(sums[1].elapsedMs)}`};
 }
 const rates=sums.map(s=>s.pieces*1000/s.elapsedMs),fast=rates[0]>=rates[1]?0:1,slow=1-fast,multiple=rates[fast]/rates[slow],bothCapped=pairs.every(p=>p.left.status==='capped'&&p.right.status==='capped');
 return {title,text:multiple<1.05?`The models played at a similar pace (${rates[0].toFixed(1)} vs ${rates[1].toFixed(1)} pieces/s).`:`${label[fast]} played at ${ratio(multiple)}× the pace of ${label[slow]} (${rates[fast].toFixed(1)} vs ${rates[slow].toFixed(1)} pieces/s).`,detail:bothCapped?`Both reached the placement limit${pairs.length>1?` across ${pairs.length} samples`:''}. This measures pace, not a 300-line finish.`:`Left cleared ${sums[0].lines} lines; right cleared ${sums[1].lines}. Different outcomes; pace is per piece.`};
}
/** Update only clock text while idle between game events; never re-render boards on timer ticks. */
export function mountRunClocks(doc,{window:win=globalThis,read,ids}={}){
 let timer=null,disposed=false;const later=win.setTimeout?.bind(win)??globalThis.setTimeout,cancel=win.clearTimeout?.bind(win)??globalThis.clearTimeout;
 function update(){if(disposed)return;const {lanes,replay=false}=read();let running=false;
  for(const t of lanes){const element=doc.getElementById(ids[t.lane]);if(element){const value=formatElapsed(t.elapsedMs);if(element.textContent!==value)element.textContent=value;element.setAttribute('datetime',`PT${(t.elapsedMs/1000).toFixed(3)}S`);element.setAttribute('aria-label',`${replay?'Recorded active':'Active'} play time ${value}`);element.setAttribute('data-running',String(!replay&&t.running));}running||=!replay&&t.running;}
  if(running&&timer===null)timer=later(()=>{timer=null;update();},100);else if(!running&&timer!==null){cancel(timer);timer=null;}
 }
 return {update,dispose(){disposed=true;if(timer!==null)cancel(timer);timer=null;}};
}
