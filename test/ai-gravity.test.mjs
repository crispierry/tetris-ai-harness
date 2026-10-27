import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start,gravityInterval} from '../public/engine.mjs';
import {observe,enumerate,execute} from '../public/harness.mjs';
import {createGravityTurn,replayGravityProof,gravityPolicy} from '../public/ai-gravity.mjs';
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
test('selected placement descends row by row under engine gravity and replays exactly',async()=>{
 const s=start(createGame(2)),turn=createGravityTurn(s,binding),packet={requestId:'fixture',stateRevision:1,candidates:turn.offered.map(c=>({id:c.id,features:{holes:0,aggregateHeight:0,maxHeight:0,bumpiness:0},linesDelta:0}))};
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
 const s=start(createGame(2)),turn=createGravityTurn(s,binding),id=turn.offered[0].id;turn.choose(id);turn.advance(16000);
 for(const proof of [{version:'ai-gravity-turn-1',placementLimit:1,reveals:[],trace:[{action:'teleport'}]},{version:'ai-gravity-turn-1',placementLimit:1,reveals:[],trace:[{choiceId:id},{choiceId:id}]},{...turn.proof,trace:[...turn.proof.trace,{waitMs:1}]}])assert.throws(()=>replayGravityProof(s,binding,proof,{selectedCandidateId:id}));
 assert.throws(()=>replayGravityProof(s,binding,turn.proof,{selectedCandidateId:'wrong'}));
});
test('real-time controller falls during a deferred model call, then waits for normal gravity to lock',async()=>{
 const clock=fakeClock(),base=heuristic();let release,packet;
 const provider={...base,async decide(p){packet=p;await new Promise(r=>release=r);return base.decide(p);}}, {c,journal}=recorded(provider,clock);
 const step=c.step();await micro();assert(packet);await clock.advance(800);assert.equal(c.view.observation.active.y,1);assert.equal(c.view.pieces,0);assert.equal(c.view.status,'choosing');release();await micro();assert.equal(c.view.status,'falling');await clock.advance(800);assert.equal(c.view.pieces,0);await clock.advance(16000);await step;
 assert.equal(c.view.pieces,1);assert.equal(c.view.status,'paused');assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
});
test('Pause retains a partial fall, freezes time, and Resume makes a fresh bound decision',async()=>{
 const clock=fakeClock(),{c,journal}=recorded(heuristic(),clock);const step=c.step();await micro();await clock.advance(1000);assert.equal(c.view.status,'falling');c.pause();await step;const before=c.view;assert.equal(before.pieces,0);assert.equal(before.status,'paused');await clock.advance(5000);assert.deepEqual(c.view,before);assert.equal(clock.size,0);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
 const resumed=c.step();await micro();await clock.advance(16000);await resumed;assert.equal(c.view.pieces,1);assert.equal(verifyDecisionUIRecord(journal.exportRun()).ok,true);
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
