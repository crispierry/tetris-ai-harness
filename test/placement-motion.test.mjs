import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start,move,rotate,softDrop,hardDrop,cells} from '../public/engine.mjs';
import {observe,enumerate,execute,candidateEvidence} from '../public/harness.mjs';
import {Controller,heuristic} from '../public/controller.mjs';
import {Comparison} from '../public/comparison.mjs';
import {HumanVersus} from '../public/versus.mjs';
import {placementTrajectory,placementEvent,createPlacementPresenter,depth2Error} from '../public/placement-motion.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await wait(2);}throw new Error('presentation did not settle');}
const binding={sessionId:'motion',revision:1};
function event(s,path){let at=s,placed;for(const a of path){if(a==='drop'){let p=at;while(true){const n=softDrop(p);if(n.board!==p.board){placed=cells(p.active);break;}p=n;}at=hardDrop(at);}else{const old=at;at=a==='clockwise'?rotate(at):a==='left'?move(at,-1):a==='right'?move(at,1):softDrop(at);if(at.board!==old.board)placed=cells(old.active);}}return {beforeObservation:observe(s,binding),afterObservation:observe(at,{...binding,revision:2}),path,piece:s.active.type,placedCells:placed};}
function legal(event,poses){assert(poses.length);for(const pose of poses){assert.deepEqual(pose.cells,cells(pose));for(const p of pose.cells){assert(p.x>=0&&p.x<10&&p.y>=0&&p.y<20);assert.equal(event.beforeObservation.board[p.y][p.x],null);}}}

test('trajectory uses legal hard-drop rows, actual wall kicks, soft lock and clear/terminal poses',()=>{
 const s=start(createGame(2)),e=event(s,['left','clockwise','drop']),before=JSON.stringify(e);const poses=placementTrajectory(e);legal(e,poses);assert(new Set(poses.map(p=>p.y)).size>=3);assert.equal(JSON.stringify(e),before);
 const kick=start(createGame(2));kick.active={type:'I',rotation:1,x:-2,y:4};const k=event(kick,['clockwise','drop']),kp=placementTrajectory(k);legal(k,kp);assert.equal(kp[1].x,0);
 const soft=start(createGame(2));soft.active={type:'O',rotation:0,x:3,y:18};const sp=event(soft,['down']);legal(sp,placementTrajectory(sp));
 for(const lines of [0,299]){const clear=start(createGame(2));clear.active={type:'I',rotation:1,x:3,y:0};clear.lines=lines;clear.level=lines?30:1;for(let y=16;y<20;y++)clear.board[y]=Array.from({length:10},(_,x)=>x===5?null:'J');const ce=event(clear,['drop']);legal(ce,placementTrajectory(ce));assert.equal(ce.afterObservation.lines,lines+4);if(lines)assert.equal(ce.afterObservation.status,'won');}
 const tuck=start(createGame(2));tuck.active={type:'O',rotation:0,x:4,y:0};for(let x=0;x<4;x++)tuck.board[17][x]='J';const raw=enumerate(tuck,binding),tc=raw.find(c=>c.path.includes('down'));assert(tc,'fixture must require a real tuck');const te={beforeObservation:observe(tuck,binding),afterObservation:observe(execute(tuck,tc,binding),{...binding,revision:2}),path:tc.path,piece:tc.piece,placedCells:tc.cells};legal(te,placementTrajectory(te));
 const bad=structuredClone(e);bad.placedCells[0].x=9;assert.deepEqual(placementTrajectory(bad),[]);
});

test('presenter shows intermediate legal rows, reduced motion settles immediately and abort fences stale frames',async()=>{
 const frames=new Map();let id=0;const shown=[],win={requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i),matchMedia:()=>({matches:false})};let settles=0;const p=createPlacementPresenter({window:win,onFrame:o=>shown.push(o.active.y),onSettled:()=>settles++}),e=event(start(createGame(2)),['drop']);const promise=p.play(e);
 for(const now of [0,60,120,180,240,300,360]){const job=frames.entries().next().value;if(job){frames.delete(job[0]);job[1](now);}}
 await promise;assert(new Set(shown).size>=3);assert.equal(frames.size,0);const abort=new AbortController(),second=p.play({...e,signal:abort.signal});const stale=[...frames.values()][0];abort.abort();await second;const count=shown.length;stale?.(999);assert.equal(shown.length,count);assert.equal(frames.size,0);assert(settles>=2);
 const reduced=createPlacementPresenter({window:{...win,matchMedia:()=>({matches:true})},onFrame:()=>assert.fail('reduced motion must not show a directional pose')});await reduced.play(e);assert.equal(frames.size,0);p.dispose();
});

test('comparison postcommit gate captures first spawned piece, independently paces lanes and Pause settles committed state',async()=>{
 const events=[],gates=[],calls=[0,0],base=heuristic();const c=new Comparison({config:{gravity:false,left:'local',right:'local',pieceCap:3,paceMs:30},providerFactory:(key,config,{lane})=>({...base,async decide(p){calls[lane]++;return base.decide(p);}}),onPlacement:e=>{events.push(e);return new Promise(r=>gates[e.lane]=r);}});
 const step=c.step();await until(()=>events.length===2);assert(events.every(e=>e.beforeObservation.active));assert(c.view.lanes.every(l=>l.pieces===1&&l.presentation.phase==='placing'));assert.equal(c.view.busy,true);await c.step();assert.deepEqual(calls,[1,1]);const exported=c.exportRun();c.pause();await step;assert(c.view.lanes.every(l=>l.pieces===1&&!l.presentation));gates.forEach(r=>r());await wait(0);assert(c.view.lanes.every(l=>l.pieces===1));assert.equal(c.exportRun(),exported);c.reset();assert(c.view.lanes.every(l=>l.pieces===0&&!l.presentation));c.dispose();
});

test('comparison fast lane advances after its presenter while the peer remains gated; reset fences both',async()=>{
 const base=heuristic(),calls=[0,0],gates=[];const c=new Comparison({config:{gravity:false,left:'local',right:'local',pieceCap:3,paceMs:30},providerFactory:(key,config,{lane})=>({...base,async decide(p){calls[lane]++;return base.decide(p);}}),onPlacement:e=>e.lane===1?new Promise(r=>gates.push(r)):Promise.resolve()});c.start();await until(()=>calls[0]>=2);assert.equal(calls[1],1);assert.equal(c.view.lanes[1].presentation.phase,'placing');c.reset();const fresh=c.view;gates.forEach(r=>r());await wait(50);assert.deepEqual(c.view,fresh);c.dispose();
});

test('versus human gravity/input remain independent during algorithm Placing and replay uses no chooser or changed export',async()=>{
 let gate,calls=0;const base=heuristic(),v=new HumanVersus({onPlacement:e=>e.replay?Promise.resolve():new Promise(r=>gate=r),providerFactory:()=>({...base,async decide(p){calls++;return base.decide(p);}})});v.start();await until(()=>!!gate);assert.equal(v.view.lanes[1].pieces,1);assert.equal(v.view.lanes[1].presentation.phase,'placing');v.tick(200);v.input('left');assert.equal(v.view.lanes[0].observation.gravityElapsedMs,200);v.input('drop');assert.equal(v.view.lanes[0].pieces,1);v.stop();const json=v.exportRun();gate();await wait(0);assert.equal(v.view.lanes[1].pieces,1);v.replay();v.pause();for(let i=0;i<8;i++)await v.stepAlgorithm();assert.equal(calls,1);assert.equal(v.exportRun(),json);v.reset();assert(v.view.lanes.every(l=>l.pieces===0));v.dispose();
});

test('actual provider confirmation completes before facade animation starts; friendly depth2 errors preserve unrelated reasons',async()=>{
 let committed=false,animated=false;const base=heuristic();const v=new HumanVersus({providerFactory:()=>({...base,confirmCommitted:async()=>{committed=true;}}),onPlacement:()=>{animated=true;assert.equal(committed,true);return Promise.resolve();}});await v.stepAlgorithm();assert(animated);v.dispose();const p={runMetadata:{search:{depth:2}},lastSearch:{error:{code:'timeout',reason:'time budget'}}};assert.match(depth2Error(p,'raw','comparison'),/Run settings/);assert.doesNotMatch(depth2Error(p,'raw','versus'),/Run settings/);p.lastSearch.error={code:'cancelled',reason:'cancelled'};assert.equal(depth2Error(p,'cancelled actual','versus'),'cancelled actual');
});


test('Pause during a terminal placement finishes the pair once without duplicate placements or choices',async()=>{
 const gates=[],base=heuristic();let calls=0;const c=new Comparison({config:{gravity:false,left:'local',right:'local',pieceCap:1},providerFactory:()=>({...base,async decide(p){calls++;return base.decide(p);}}),onPlacement:e=>new Promise(r=>gates[e.lane]=r)});const step=c.step();await until(()=>gates.length===2&&gates.every(Boolean));assert(c.view.lanes.every(l=>l.outcome.status==='capped'));c.pause();await step;assert.equal(c.view.summary.observedPairs,1);assert.equal(c.view.summary.pairs.length,1);await c.step();assert.equal(calls,2);assert.equal(JSON.parse(c.exportRun()).frames.filter(f=>f.event==='outcome').length,2);gates.forEach(r=>r());c.dispose();
});

test('replay Pause settles the saved committed frame and generation fences its old presenter',async()=>{
 const gates=[],c=new Comparison({config:{gravity:false,left:'local',right:'local',pieceCap:3,paceMs:30},onPlacement:e=>e.replay?new Promise(r=>gates.push(r)):Promise.resolve()});await c.step();await c.step();const json=c.exportRun();c.replay();c.pause();for(let i=0;i<3;i++)await c.step();const playing=c.step();await until(()=>gates.length>0);assert.equal(c.view.busy,true);c.pause();await playing;assert(c.view.lanes.every(l=>!l.presentation));assert.equal(c.view.busy,false);const current=c.view;gates.forEach(r=>r());await wait(0);assert.deepEqual(c.view,current);assert.equal(c.exportRun(),json);c.dispose();
});


test('entering replay during terminal motion freezes the exact earlier exported bytes',async()=>{
 const gates=[],c=new Comparison({config:{gravity:false,left:'local',right:'local',pieceCap:1},onPlacement:e=>new Promise(r=>gates[e.lane]=r)});const step=c.step();await until(()=>gates.length===2&&gates.every(Boolean));const original=c.exportRun();c.replay();await step;c.pause();assert.equal(c.exportRun(),original);gates.forEach(r=>r());c.dispose();
});

test('search limit errors identify depth6 and stale search metadata cannot invent a new error',()=>{const p={runMetadata:{search:{depth:6,version:'visible-beam-search-1'}},lastSearch:{error:{code:'timeout',reason:'time budget'}}};assert.match(depth2Error(p,'raw','comparison'),/Depth 6/);assert.match(depth2Error(p,'raw','solo'),/lower the depth/);assert.match(depth2Error(p,'raw','solo'),/No move was selected/);assert.doesNotMatch(depth2Error(p,'raw','solo'),/No piece was placed/);assert.equal(depth2Error(p,null,'comparison'),null);});
