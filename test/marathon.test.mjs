import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGame, start, hardDrop, softDrop, move, rotate, tick, togglePause, levelForLines, RULES } from '../public/engine.mjs';
import { observe, enumerate, candidateEvidence, execute } from '../public/harness.mjs';
import { instructionPacket, validatePacket } from '../public/briefing.mjs';
import { heuristic, Controller } from '../public/controller.mjs';
import { evaluateLookahead } from '../public/lookahead.mjs';
import { runPaired, replayRun, recomputeRun, preflight } from '../benchmark.mjs';
import { Comparison, validateConfig } from '../public/comparison.mjs';
import { HumanVersus } from '../public/versus.mjs';
const binding = { sessionId: 'near-finish', revision: 9 };
function nearFinish(lines = 299, clear = 4) {
  const s = start(createGame(2)); s.lines = lines; s.level = levelForLines(lines); s.score = 1234;
  s.active = { type: 'I', rotation: 1, x: 3, y: 0 };
  for (let y = 20 - clear; y < 20; y++) s.board[y] = Array.from({ length: 10 }, (_, x) => x === 5 ? null : 'J');
  return s;
}
const reply = (p, id) => ({ requestId: p.requestId, stateRevision: p.stateRevision, selectedCandidateId: id });
test('full canonical clear preserves overshoot, pre-clear scoring and queue/RNG before completion; all engine inputs freeze', () => {
  assert.equal(levelForLines(0), 1); assert.equal(levelForLines(289), 29); assert.equal(levelForLines(290), 30);
  assert.equal(levelForLines(299), 30); assert.equal(levelForLines(303), 30);
  for (const [lines, clear] of [[296,4],[299,1],[299,4]]) {
    const s = nearFinish(lines, clear), before = structuredClone(s), won = hardDrop(s);
    assert.equal(won.status, 'won'); assert.equal(won.lines, lines + clear); assert.equal(won.level, 30);
    assert.equal(won.score, 1234 + RULES.clearPoints[clear] * 30); assert.equal(won.active, null);
    assert.equal(won.queue, s.queue); assert.equal(won.rng, s.rng); assert.equal(won.nextType, s.nextType);
    assert.deepEqual(s, before); assert(won.board.every(row => row.some(c => c === null)));
    for (const op of [start, hardDrop, softDrop, rotate, togglePause, x => move(x,1), x => tick(x,100000)]) assert.equal(op(won), won);
    assert.deepEqual(observe(won,binding).next, observe(s,binding).next);
  }
  const notYet = hardDrop(nearFinish(295,4)); assert.equal(notYet.status, 'playing'); assert.equal(notYet.lines,299);
});
test('winning public afterstate retains all five original previews, wins local ranking, and depth2 never expands it', async () => {
  const s = nearFinish(), obs = observe(s,binding), raw = enumerate(s,binding);
  const facts = raw.map(c => candidateEvidence(s,c,binding));
  const packet = instructionPacket(obs,facts,{requestId:'near-finish-request',deadlineMs:5000});
  const winner = facts.find(c => c.afterstate.status === 'won'); assert(winner);
  assert.deepEqual(winner.afterstate.next,obs.next); assert.equal(winner.afterstate.previewCount,5);
  assert.equal(winner.terminalReason,'300-line target reached'); assert.equal(winner.afterstate.active,null);
  const nonterminal = facts.find(c => c.afterstate.status === 'playing'); assert(nonterminal);
  assert.deepEqual(nonterminal.afterstate.next,obs.next.slice(1));
  const chosen = await heuristic().decide(packet); assert.equal(facts.find(c => c.id === chosen.selectedCandidateId).afterstate.status,'won');
  const winPacket = instructionPacket(obs,[winner],{requestId:'one-winning-root',deadlineMs:5000});
  const search = await evaluateLookahead(winPacket,{depth:2,timeMs:5000}); assert(search.ok,JSON.stringify(search.error));
  assert.equal(search.stats.nodes,1); assert.equal(search.stats.childrenEnumerated,0); assert.equal(search.stats.evaluatorCalls,1);
  assert.equal(search.value,1000000); assert.deepEqual(search.roots[0].bestLeaf.observation.next,obs.next);
  for (const mutate of [p=>{p.candidates[0].afterstate.next.shift();p.candidates[0].afterstate.previewCount=4;},p=>{p.candidates[0].afterstate.level=31;},p=>{p.observation.rulesVersion='local-classic-1';},p=>{p.objective='endless score and survival';}]) {
    const altered=structuredClone(winPacket); mutate(altered); assert.throws(()=>validatePacket(altered));
    assert.equal((await evaluateLookahead(altered,{depth:2})).ok,false);
  }
});
test('controller completion issues no further requests; reset restores level1 and a new request epoch', async () => {
  let calls=0;const local=heuristic();const provider={...local,async decide(p){calls++;return local.decide(p);}};
  const c=new Controller({seed:2,sessionId:'complete-freeze',provider,deadlineMs:5000});
  for(let n=0;n<1000 && c.view.status!=='won' && c.view.status!=='over';n++) await c.step();
  assert.equal(c.view.status,'won');const before=c.view, requests=calls;
  c.start();c.pause();c.stop();assert.equal(await c.step(),null);assert.equal(c.view.status,'won');
  assert.equal(calls,requests);assert.deepEqual(c.view.observation,before.observation);
  c.reset();assert.equal(c.view.observation.level,1);assert.equal(c.view.observation.lines,0);assert.equal(c.view.status,'ready');
  assert.notEqual(c.view.observation.sessionId,before.observation.sessionId);await c.step();assert.equal(c.view.pieces,1);c.stop();
});
test('actual default 1000-placement paired plan exports/replays within coupled caps with truthful win before cap', async () => {
  const options={runId:'marathon-full',sourceRevision:'7a603405560666d2093d7e82fb7c24e4bd9eb288',deadlineMs:5000,runWallMs:60000};
  const players=[{create:()=>heuristic()},{create:()=>heuristic()}];
  const plan=preflight(options,players,[2]);assert.equal(plan.manifest.maxPieces,1000);assert.equal(plan.manifest.maxPlannedPlacements,2000);
  assert.equal(validateConfig().pieceCap,1000);assert.throws(()=>validateConfig({samples:2}),/2000/);
  const artifact=await runPaired({options,players,seeds:[2]});
  assert(Buffer.byteLength(JSON.stringify(artifact))<=artifact.manifest.maxArtifactBytes);
  for(const run of artifact.runs){
    assert.equal(run.outcome,'marathon-complete');assert.equal(run.metrics.censored,false);assert(run.metrics.pieces<=1000);
    assert(run.finalObservation.lines>=300);assert.equal(run.finalObservation.level,30);assert.equal(run.finalObservation.active,null);
    assert((await replayRun(artifact.manifest,run,2)).verified);
    const falseCap=structuredClone(run);falseCap.outcome='piece-cap';assert.throws(()=>recomputeRun(falseCap,artifact.manifest),/Marathon/);
    const appended=structuredClone(run);appended.events.push({...appended.events.at(-1),index:appended.events.length});assert.throws(()=>recomputeRun(appended,artifact.manifest),/terminal/);
  }
});
test('captured frozen v1 fixture keeps original packet hashes and replays only under its exact recorded rules', async () => {
  const artifact=JSON.parse(await readFile(new URL('./fixtures/classic-v1-recording.json',import.meta.url),'utf8'));
  assert.equal(artifact.manifest.objective,'endless score and survival');
  for(const run of artifact.runs){assert((await replayRun(artifact.manifest,run,2)).verified);assert.deepEqual(recomputeRun(run,artifact.manifest),run.metrics);}
  for(const changed of [{rulesVersion:RULES.version},{promptVersion:'local-rules-brief-2'},{version:'unknown'},{objective:RULES.objective}]) await assert.rejects(replayRun({...artifact.manifest,...changed},artifact.runs[0],2));
});
test('comparison win freezes independently while an errored peer stays inspectable; replay makes no new decisions', async () => {
  let calls=0;const c=new Comparison({config:{left:'local',right:'local'},providerFactory:(key,config,{lane})=>{
    const local=heuristic();return {...local,async decide(p){calls++;if(lane===1)throw new Error('Independent test error');return local.decide(p);}};
  }});
  for(let n=0;n<1000 && c.view.lanes[0].status!=='won';n++) await c.step();
  assert.equal(c.view.lanes[0].status,'won');assert.equal(c.view.lanes[1].status,'error');assert.equal(c.view.state,'completed');
  const before=c.view.lanes[0].observation, requests=calls;await c.step();c.start();c.pause();c.stop();assert.equal(calls,requests);assert.deepEqual(c.view.lanes[0].observation,before);
  const record=JSON.parse(c.exportRun());assert.equal(record.summary.pairs[0].left.status,'won');assert(record.frames.length<=4000);assert(Buffer.byteLength(JSON.stringify(record))<8*1024*1024);
  c.replay();c.pause();for(let n=0;n<record.frames.length;n++)await c.step();assert.equal(calls,requests);assert.equal(c.view.lanes[0].recordedStatus,'won');
  c.reset();assert.equal(c.view.lanes[0].observation.level,1);c.dispose();
});
test('manual versus lane completes with real input paths and freezes while an unfinished algorithm remains independent', async () => {
  let resolve,packet;const c=new HumanVersus({providerFactory:()=>({...heuristic(),decide:p=>{packet=p;return new Promise(r=>{resolve=r;});}})});
  c.start();let state=start(createGame()),revision=0;const local=heuristic();
  for(let n=0;n<1000 && state.status==='playing';n++){
    const b={sessionId:'manual-plan',revision:revision++},raw=enumerate(state,b),p=instructionPacket(observe(state,b),raw.map(x=>candidateEvidence(state,x,b)),{requestId:`manual-${n}`,deadlineMs:5000});
    const selected=await local.decide(p),candidate=raw.find(x=>x.id===selected.selectedCandidateId);
    for(const action of candidate.path)c.input(({clockwise:'rotate'})[action]??action);
    state=execute(state,candidate,b);
  }
  assert.equal(state.status,'won');assert.equal(c.view.lanes[0].status,'won');assert.equal(c.view.lanes[1].outcome,null);
  const before=c.view.lanes[0].observation;for(const action of ['left','right','rotate','down','drop'])c.input(action);c.tick(100000);c.pause();c.start();assert.deepEqual(c.view.lanes[0].observation,before);
  c.reset();const fresh=c.view.lanes[0].observation;resolve(reply(packet,packet.candidates[0].id));await Promise.resolve();await Promise.resolve();
  assert.equal(c.view.lanes[0].observation.level,1);assert.equal(c.view.lanes[0].observation.lines,0);assert.deepEqual(c.view.lanes[0].observation,fresh);assert.equal(c.view.lanes[1].pieces,0);c.dispose();
});
test('a final single-line clear completes before a next piece that would have blocked after collapse', () => {
  const s=nearFinish(299,1);s.board[0][4]='J';s.queue=['T','I','O','S','Z'];s.nextType='T';
  const won=hardDrop(s);assert.equal(won.status,'won');assert.equal(won.board[1][4],'J');assert.equal(won.active,null);
  assert.equal(won.nextType,'T');assert.equal(won.queue,s.queue);assert.equal(won.rng,s.rng);
  const before=nearFinish(289,1),after=hardDrop(before);assert.equal(after.lines,290);assert.equal(after.level,30);assert.equal(after.score,1234+100*29);assert.equal(after.status,'playing');
});

test('coupled full versus records both progressing heuristic lanes through Marathon completion', async () => {
  // Accelerate only visual algorithm pacing. The real 1500ms decision guard is untouched.
  const nativeTimeout=globalThis.setTimeout;
  const yieldTurn=()=>new Promise(resolve=>nativeTimeout(resolve,0));
  globalThis.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===500?0:ms,...args);
  const c=new HumanVersus();const local=heuristic();let state=start(createGame()),revision=0;
  try {
    c.start();
    for(let n=0;n<1000 && state.status==='playing';n++){
      const b={sessionId:'coupled-manual',revision:revision++},raw=enumerate(state,b);
      const p=instructionPacket(observe(state,b),raw.map(x=>candidateEvidence(state,x,b)),{requestId:`coupled-${n}`,deadlineMs:5000});
      const selected=await local.decide(p),candidate=raw.find(x=>x.id===selected.selectedCandidateId);
      for(const action of candidate.path)c.input(({clockwise:'rotate'})[action]??action);
      state=execute(state,candidate,b);await yieldTurn();
      assert.equal(c.view.archiveError,null,`both lanes must fit recording admission at ${n+1} human placements`);
      assert.equal(c.view.lanes[0].pieces,n+1);
    }
    for(let n=0;n<1000 && !c.view.lanes[1].outcome;n++)await yieldTurn();
    assert.equal(state.status,'won');assert(c.view.lanes[1].pieces>700,'the algorithm must actually progress with the human');
    assert(c.view.lanes.every(l=>l.status==='won'&&l.observation.lines>=300&&l.observation.active===null));
    assert.equal(c.view.state,'completed');assert.equal(c.view.archiveError,null);
    const json=c.exportRun(),record=JSON.parse(json);
    assert(record.outcomes.every(o=>o.status==='won'&&!o.censored));assert.equal(record.archiveIncomplete,false);
    assert(record.frames.some(f=>f.lane===0&&f.event==='outcome'&&f.status==='won'));
    assert(record.frames.some(f=>f.lane===1&&f.event==='outcome'&&f.status==='won'));
    assert(record.frames.length<=record.limits.frames);assert(Buffer.byteLength(json)<=record.limits.exportBytes);
  } finally {c.dispose();globalThis.setTimeout=nativeTimeout;}
});
