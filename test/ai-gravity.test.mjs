import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start,gravityInterval} from '../public/engine.mjs';
import {observe,enumerate,execute} from '../public/harness.mjs';
import {createGravityTurn,replayGravityProof,gravityPolicy,LEGACY_GRAVITY_TIMING} from '../public/ai-gravity.mjs';
import {GravityController} from '../public/gravity-controller.mjs';
import {heuristic,mockProvider} from '../public/controller.mjs';
import {DecisionJournal} from '../public/decision-record.mjs';
import {providerPolicy} from '../public/provider-policy.mjs';
import {verifyDecisionUIRecord} from '../decision-record-verifier.mjs';
const binding={sessionId:'clock-0',revision:1},micro=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
import {fakeClock} from './helpers/fake-clock.mjs';

function recorded(provider,clock){let journal;const c=new GravityController({provider,clock,sessionId:'clock',onTransition:({input,view})=>journal.append(0,input,view)});journal=new DecisionJournal({mode:'solo'});journal.addLane(0,'computer',c.view,gravityPolicy(providerPolicy(provider)));return {c,journal};}
test('gravity uses actual level intervals; depth/motion preferences never change its clock',()=>{
 for(const lines of [0,10,100,290]){const s=start(createGame(2));s.lines=lines;s.level=1+lines/10;const turn=createGravityTurn(s,binding),ms=gravityInterval(s.level);turn.advance(ms-1);assert.equal(turn.state.active.y,0);turn.advance(1);assert.equal(turn.state.active.y,1);}
});
test('historical natural-descent proofs still descend and replay with their original timing',async()=>{
 const s=start(createGame(2)),turn=createGravityTurn(s,binding,{hardDropOnChoice:false}),packet={requestId:'fixture',stateRevision:1,candidates:turn.offered.map(c=>({id:c.id,features:{holes:0,aggregateHeight:0,maxHeight:0,bumpiness:0},linesDelta:0}))};
 const chosen=(await heuristic().decide(packet)).selectedCandidateId;turn.advance(800);assert.equal(turn.state.active.y,1);turn.choose(chosen);assert.equal(turn.locked,false);
 const positions=[];while(!turn.locked){positions.push(turn.state.active.y);turn.advance(800);}assert(positions.length>=15);
 const replay=replayGravityProof(s,binding,turn.proof,{selectedCandidateId:chosen});assert.deepEqual(observe(replay.state,binding),observe(turn.state,binding));assert.equal(replay.missed,false);
});
test('late or unreachable choices never teleport a piece; gravity retains the real locked state',()=>{
 const s=start(createGame(2)),turn=createGravityTurn(s,binding),selected=turn.offered.find(c=>c.cells.every(p=>p.x<2));assert(selected);
 while(!turn.locked)turn.advance(800);const actual=turn.state;turn.choose(selected.id);assert.equal(turn.missed,true);assert.deepEqual(turn.state,actual);
 const replay=replayGravityProof(s,binding,turn.proof,{selectedCandidateId:selected.id});assert.deepEqual(observe(replay.state,binding),observe(actual,binding));assert.equal(replay.missed,true);
 const advanced=createGravityTurn(s,binding);advanced.advance(14400);advanced.choose(selected.id);assert.equal(advanced.missed,true);assert.equal(advanced.state.active.x,s.active.x); // rotation is no longer reachable at the floor
});
test('proofs reject invented actions, multiple choices, extra time after a lock, and wrong choice binding',()=>{
 const s=start(createGame(2)),turn=createGravityTurn(s,binding),id=turn.offered[0].id;turn.choose(id);
 for(const proof of [{version:'ai-gravity-turn-1',placementLimit:1,reveals:[],trace:[{action:'teleport'}]},{version:'ai-gravity-turn-1',placementLimit:1,reveals:[],trace:[{choiceId:id},{choiceId:id}]},{...turn.proof,trace:[...turn.proof.trace,{waitMs:1}]}])assert.throws(()=>replayGravityProof(s,binding,proof,{selectedCandidateId:id}));
 assert.throws(()=>replayGravityProof(s,binding,turn.proof,{selectedCandidateId:'wrong'}));
});
test('real-time controller falls while thinking, then immediately hard-drops the reachable choice',async()=>{
 const clock=fakeClock(),base=heuristic();let release,packet;
 const provider={...base,async decide(p){packet=p;await new Promise(r=>release=r);return base.decide(p);}}, {c,journal}=recorded(provider,clock);
 const step=c.step();await micro();assert(packet);await clock.advance(800);assert.equal(c.view.observation.active.y,1);assert.equal(c.view.pieces,0);assert.equal(c.view.status,'choosing');release();await step;
 assert.equal(c.view.pieces,1);assert.equal(c.view.status,'paused');assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
});
test('Pause retains a partial fall, freezes time, and Resume makes a fresh bound decision',async()=>{
 const clock=fakeClock(),base=heuristic();let release;const {c,journal}=recorded({...base,async decide(p){await new Promise(r=>release=r);return base.decide(p);}},clock);const step=c.step();await micro();await clock.advance(1000);assert.equal(c.view.status,'choosing');c.pause();await step;const before=c.view;assert.equal(before.pieces,0);assert.equal(before.status,'paused');await clock.advance(5000);assert.deepEqual(c.view,before);assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
 release();const resumed=c.step();await micro();release();await resumed;assert.equal(c.view.pieces,1);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
});
test('Reset cancels an uncooperative late response and all old gravity timers',async()=>{
 const clock=fakeClock(),base=heuristic();let release;const {c,journal}=recorded({...base,async decide(p){await new Promise(r=>release=r);return base.decide(p);}},clock);
 const step=c.step();await micro();await clock.advance(850);c.reset();await micro();const reset=c.view;release();await step;await clock.advance(20000);assert.deepEqual(c.view,reset);assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
});
test('a decision timeout preserves the fall and stops its timers without placing a phantom piece',async()=>{
 const clock=fakeClock(),base=heuristic(),{c,journal}=recorded({...base,decide:()=>new Promise(()=>{})},clock);const step=c.step();await micro();await clock.advance(1500);await step;assert.equal(c.view.pieces,0);assert.equal(c.view.observation.active.y,1);assert.equal(c.view.status,'error');assert.match(c.view.error,/deadline/);assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
});

test('autoplay continues gravity into the next piece while an old choice is still pending',()=>{
 const s=start(createGame(2));s.level=30;s.lines=290;s.active.y=17;
 const turn=createGravityTurn(s,binding,{placementLimit:10}),id=turn.offered[0].id;turn.advance(600);assert.equal(turn.locks,1);assert(turn.state.active.y>=2);const before=observe(turn.state,binding);turn.choose(id);assert.equal(turn.missed,true);assert.deepEqual(observe(turn.state,binding),before);
 const replay=replayGravityProof(s,binding,turn.proof,{selectedCandidateId:id});assert.deepEqual(observe(replay.state,binding),before);
});


test('Space drop executes the current reachable route and clears rows before spawning',()=>{
 for(const lines of [9,299]){const s=start(createGame(2));s.active={type:'I',rotation:1,x:3,y:0};s.lines=lines;s.level=lines===9?1:30;for(let y=16;y<20;y++)s.board[y]=Array.from({length:10},(_,x)=>x===5?null:'J');
  const turn=createGravityTurn(s,binding),chosen=turn.offered.find(c=>c.cells.every(p=>p.x===5));turn.advance(gravityInterval(s.level));const before=turn.state,current=enumerate(before,binding).find(c=>JSON.stringify(c.cells)===JSON.stringify(chosen.cells));assert(current);const expected=execute(before,current,binding);turn.choose(chosen.id);assert.equal(turn.done,true);assert.equal(turn.locks,1);assert.equal(turn.missed,false);assert.deepEqual(turn.state,expected);assert.equal(turn.state.lines,lines+4);if(lines===299)assert.equal(turn.state.status,'won');assert.equal(turn.proof.version,'ai-gravity-turn-2');
  const replay=replayGravityProof(s,binding,turn.proof,{selectedCandidateId:chosen.id});assert.deepEqual(observe(replay.state,binding),observe(turn.state,binding));
 }
});

test('historical exported gravity records remain verifiable and proof timing cannot be substituted',()=>{
 const s=createGame(2),initial={observation:observe(s,{...binding,revision:0}),pieces:0,status:'ready'},journal=new DecisionJournal({mode:'solo'});journal.addLane(0,'computer',initial,{...providerPolicy(heuristic()),timing:LEGACY_GRAVITY_TIMING});const spawned=start(s);journal.append(0,{kind:'spawn'},{observation:observe(spawned,binding),pieces:0,status:'ready'});const turn=createGravityTurn(spawned,binding,{hardDropOnChoice:false}),id=turn.offered[0].id;turn.choose(id);turn.advance(16000);journal.append(0,{kind:'gravity',requestId:'clock-0:1:1',revision:1,selectedCandidateId:id,receipt:null,latencyMs:0,proof:turn.proof,outcome:'placed',recoveryRequired:false},{observation:observe(turn.state,{...binding,revision:2}),pieces:1,status:'paused'});const json=journal.exportRun();assert.equal(verifyDecisionUIRecord(json).ok,true);const bad=JSON.parse(json);bad.events[1].input.proof.version='ai-gravity-turn-2';assert.throws(()=>verifyDecisionUIRecord(JSON.stringify(bad)),/timing/);
});
