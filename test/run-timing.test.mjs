import test from 'node:test';
import assert from 'node:assert/strict';
import {RunClock,formatElapsed,comparisonPace,mountRunClocks} from '../public/run-timing.mjs';
import {Comparison} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {heuristic} from '../public/controller.mjs';
import {fakeClock} from './helpers/fake-clock.mjs';
const micro=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
test('active clock excludes pauses, deduplicates decisions, freezes once finished and resets cleanly',async()=>{
 const clock=fakeClock(),t=new RunClock({now:clock.now});assert.equal(t.view.elapsedMs,0);t.start();await clock.advance(1200);assert.equal(t.view.elapsedMs,1200);t.start();t.pause();await clock.advance(5000);assert.equal(t.view.elapsedMs,1200);t.start();await clock.advance(800);t.record({requestId:'a',latencyMs:10});t.record({requestId:'a',latencyMs:10});t.record({requestId:'b',latencyMs:20});t.finish();await clock.advance(5000);t.start();assert.deepEqual(t.view,{elapsedMs:2000,decisionMs:30,decisions:2,running:false,started:true,finished:true});t.reset();assert.equal(t.view.elapsedMs,0);assert.equal(t.view.decisions,0);assert.equal(t.view.started,false);
});
test('clock formatting is stable at minute and hour boundaries',()=>{
 for(const [ms,text]of [[0,'00:00.0'],[1299,'00:01.2'],[59999,'00:59.9'],[60000,'01:00.0'],[3600000,'1:00:00.0'],[-1,'00:00.0']])assert.equal(formatElapsed(ms),text);
});
test('clock UI updates only time elements, freezes replay and cleans up every timer',async()=>{
 const clock=fakeClock(),t=new RunClock({now:clock.now}),node={textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}},ids=[];let replay=false;
 const ui=mountRunClocks({getElementById:id=>{ids.push(id);return node;}},{window:clock,ids:{0:'time'},read:()=>({replay,lanes:[{lane:0,...t.view}]})});ui.update();assert.equal(node.textContent,'00:00.0');assert.equal(clock.size,0);t.start();ui.update();await clock.advance(1250);assert.equal(node.textContent,'00:01.2');assert.equal(node.attributes['data-running'],'true');t.pause();ui.update();assert.equal(clock.size,0);assert(ids.every(id=>id==='time'));replay=true;ui.update();assert.match(node.attributes['aria-label'],/^Recorded/);t.start();ui.update();assert.equal(clock.size,0);ui.dispose();assert.equal(clock.size,0);
});
const outcome=(status,pieces=100,lines=300)=>({status,pieces,lines}),time=elapsedMs=>({elapsedMs}),pair=(leftStatus,rightStatus,a=1000,b=2000)=>({left:outcome(leftStatus),right:outcome(rightStatus),leftTiming:time(a),rightTiming:time(b)});
test('matched 300-line finishes compare elapsed time with a correct percentage and distinguish the same model on both sides',()=>{
 const result=comparisonPace([pair('won','won')],['Local lookahead depth 2','Local lookahead depth 3']);assert.match(result.text,/Lookahead · 2 reached 300 lines 1.0s sooner \(50% less active time\)/);assert.match(result.detail,/00:01.0/);
 const same=comparisonPace([pair('won','won')],['A','A']);assert.match(same.text,/A \(left\)/);assert.match(comparisonPace([pair('won','won',1000,1050)],['A','B']).text,/Both models/);
});
test('capped and unequal outcomes compare per-piece pace, never claim an early loss won the race',()=>{
 const capped=comparisonPace([pair('capped','capped')],['A','B']);assert.match(capped.text,/A played at 2.0× the pace/);assert.match(capped.detail,/placement limit/);const loss=comparisonPace([pair('over','won')],['A','B']);assert.match(loss.detail,/Different outcomes/);assert.doesNotMatch(loss.text,/reached 300|sooner/);
 const unequal=pair('over','over',1000,2000);unequal.left.pieces=10;assert.match(comparisonPace([unequal],['A','B']).text,/B played at 5.0×/);
});
test('errors, incomplete samples and missing or tiny timing cannot produce a speed claim',()=>{
 for(const x of [comparisonPace([pair('error','won')],['A','B']),comparisonPace([pair('won','won')],['A','B'],{expectedPairs:2}),comparisonPace([pair('won','won',0,10)],['A','B']),comparisonPace([{left:outcome('won'),right:outcome('won')}],['A','B'])])assert.doesNotMatch(x.text,/sooner|×|faster/);
 assert.equal(comparisonPace([],['A','B'],{complete:false}),null);
});
test('paired samples compare aggregate elapsed time and aggregate pieces, not an average of ratios',()=>{
 const result=comparisonPace([pair('won','won',1000,2000),pair('won','won',3000,4000)],['A','B']);assert.match(result.text,/all 2 samples 2.0s sooner \(33%/);
 const x=pair('over','over',1000,10000),y=pair('over','over',10000,1000);x.left.pieces=10;y.right.pieces=10;assert.match(comparisonPace([x,y],['A','B']).text,/similar pace/);
});
test('independent comparison clocks include model waits, freeze each completed lane and retain their exact replay values',async()=>{
 const clock=fakeClock(),base=heuristic(),release=[],c=new Comparison({clock,config:{gravity:false,left:'local',right:'local',pieceCap:1},providerFactory:(key,settings,{lane})=>({...base,async decide(p){await new Promise(r=>release[lane]=r);return base.decide(p);}})});
 try{const step=c.step();await micro();await clock.advance(500);release[0]();await micro();assert.equal(c.timing.lanes[0].elapsedMs,500);assert.equal(c.timing.lanes[0].finished,true);await clock.advance(500);assert.equal(c.timing.lanes[0].elapsedMs,500);assert.equal(c.timing.lanes[1].elapsedMs,1000);release[1]();await step;assert.match(c.view.summary.pace.text,/2.0×/);const frozen=c.timing.lanes.map(t=>t.elapsedMs),json=c.exportRun();await clock.advance(5000);assert.deepEqual(c.timing.lanes.map(t=>t.elapsedMs),frozen);c.replay();c.pause();await c.step();assert.deepEqual(c.timing.lanes.map(t=>t.elapsedMs),frozen);assert.equal(c.exportRun(),json);c.reset();assert(c.timing.lanes.every(t=>t.elapsedMs===0));}finally{c.dispose();}
});
test('comparison pauses and idle time between Steps are excluded; starting new samples does not lose prior timings',async()=>{
 const clock=fakeClock(),base=heuristic(),release=[],c=new Comparison({clock,config:{gravity:false,left:'local',right:'local',pieceCap:2,samples:2},providerFactory:(key,settings,{lane})=>({...base,async decide(p){await new Promise(r=>release[lane]=r);return base.decide(p);}})});
 try{const first=c.step();await micro();await clock.advance(100);release.forEach(r=>r());await first;await clock.advance(5000);assert(c.timing.lanes.every(t=>t.elapsedMs===100));const pending=c.step();await micro();await clock.advance(200);c.pause();await pending;assert(c.timing.lanes.every(t=>t.elapsedMs===300));release.forEach(r=>r());await micro();await clock.advance(5000);assert(c.timing.lanes.every(t=>t.elapsedMs===300));}finally{c.dispose();}
});
test('computer clock in versus stops at its own outcome even while human play continues',async()=>{
 const clock=fakeClock(),base=heuristic();let release;const v=new HumanVersus({clock,pieceCap:1,providerFactory:()=>({...base,async decide(p){await new Promise(r=>release=r);return base.decide(p);}})});
 try{v.start();await micro();await clock.advance(1200);release();await micro();assert.equal(v.timing.lanes[0].elapsedMs,1200);assert.equal(v.timing.lanes[0].finished,true);assert.equal(v.view.running,true);await clock.advance(5000);assert.equal(v.timing.lanes[0].elapsedMs,1200);v.reset();assert.equal(v.timing.lanes[0].elapsedMs,0);}finally{v.dispose();}
});

test('header clocks accumulate paired samples without resetting, while summary uses each sample once',async()=>{
 const clock=fakeClock(),base=heuristic(),release=[],c=new Comparison({clock,config:{gravity:false,left:'local',right:'local',pieceCap:1,samples:2},providerFactory:(key,settings,{lane})=>({...base,async decide(p){await new Promise(r=>release[lane]=r);return base.decide(p);}})});
 try{let step=c.step();await micro();await clock.advance(500);release.forEach(r=>r());await step;assert(c.timing.lanes.every(t=>t.elapsedMs===500));step=c.step();await micro();assert(c.timing.lanes.every(t=>t.elapsedMs===500));await clock.advance(800);release.forEach(r=>r());await step;assert(c.timing.lanes.every(t=>t.elapsedMs===1300));assert.deepEqual(c.view.summary.pairs.map(p=>p.leftTiming.elapsedMs),[500,800]);assert.match(c.view.summary.pace.text,/similar pace/);c.reset();assert(c.timing.lanes.every(t=>t.elapsedMs===0));}finally{c.dispose();}
});

test('pausing the final drop settles timing and still exposes a finished-run explanation',async()=>{
 const clock=fakeClock(),gates=[],c=new Comparison({clock,config:{gravity:false,left:'local',right:'local',pieceCap:1},onPlacement:e=>new Promise(r=>gates[e.lane]=r)});
 try{const step=c.step();await micro();assert(gates.every(Boolean));await clock.advance(500);c.pause();await step;assert(c.view.summary.pace);assert(c.timing.lanes.every(t=>t.elapsedMs===500&&!t.running));gates.forEach(r=>r());}finally{c.dispose();}
});
