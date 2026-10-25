import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, start, RULES } from '../public/engine.mjs';
import { observe, enumerate, candidateEvidence } from '../public/harness.mjs';
import { briefing, workedExamples, instructionPacket, validateChoice, semanticPacket } from '../public/briefing.mjs';
test('rules briefing derives numeric facts and all geometry from canonical exports',()=>{
 const brief=briefing();assert.equal(brief.rules,RULES);assert.equal(brief.rules.version,brief.rulesVersion);
 assert.equal(brief.geometry.length,7);assert.equal(brief.rules.hold,false);assert.equal(brief.rules.hiddenRows,0);
 assert(brief.instructions.some(s=>s.includes('Marathon: clear 300 lines')));
 assert(brief.instructions.some(s=>s.includes('100/300/500/800')));assert(Object.isFrozen(brief));
});
test('three executable worked examples have exact expected rotation, collapse, score/level and loss',()=>{
 const [r,c,l]=workedExamples();
 assert.deepEqual(r.before,[{x:4,y:5},{x:3,y:6},{x:4,y:6},{x:5,y:6}]);
 assert.deepEqual(r.after,[{x:5,y:6},{x:4,y:5},{x:4,y:6},{x:4,y:7}]);
 assert.equal(c.linesAfter,10);assert.equal(c.scoreAfter-c.scoreBefore,100);assert.equal(c.levelAfter,2);
 assert.equal(c.boardAfter[19][0],'S');assert.equal(c.placedCells.length,4);assert(c.placedCells.some(p=>p.y===19));
 assert.equal(l.status,'over');assert.equal(l.active,null);assert.equal(l.boardAfter[0][4],'J');
});
test('offline mock receives self-contained bounded instruction packet and validates exact action schema',()=>{
 const state=start(createGame()),binding={sessionId:'brief',revision:2};
 const candidates=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding));
 const packet=instructionPacket(observe(state,binding),candidates,{requestId:'r1',deadlineMs:1000});
 const mock=p=>({requestId:p.requestId,stateRevision:p.stateRevision,selectedCandidateId:p.candidates[0].id});
 assert.equal(validateChoice(packet,mock(packet)),candidates[0].id);assert.equal(packet.rulesBrief.examples.length,3);
 assert.equal(packet.observation.next.length,5);assert.equal(packet.candidates[0].afterstate.next.length,4);
 assert.deepEqual(packet.responseSchema.properties.selectedCandidateId.enum,candidates.map(c=>c.id));
 for(const bad of [{...mock(packet),requestId:'old'},{...mock(packet),stateRevision:1},{...mock(packet),selectedCandidateId:'made-up'},{...mock(packet),extra:true}])assert.throws(()=>validateChoice(packet,bad));
 assert.throws(()=>instructionPacket({...packet.observation,rng:123},candidates,{requestId:'r2',deadlineMs:1000}),/Private/);
 assert.throws(()=>instructionPacket(packet.observation,candidates,{requestId:'r2',deadlineMs:0}));
});

test('semantic game evidence and object response instructions have separate versioned contracts', () => {
 const state=start(createGame()),binding={sessionId:'format-separation',revision:2};
 const candidates=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding));
 const packet=instructionPacket(observe(state,binding),candidates,{requestId:'format-request',deadlineMs:1000});
 assert.equal(packet.schemaVersion,3);assert.equal(packet.rulesBrief.version,'local-rules-brief-3');
 assert.match(packet.responseInstructions,/Return only requestId, stateRevision and selectedCandidateId/);
 assert(!packet.rulesBrief.instructions.some(s=>/response schema|Return only|selectedCandidateId/.test(s)));
 const game=semanticPacket(packet);assert.equal(game.observation,packet.observation);assert.equal(game.candidates,packet.candidates);
 assert.equal(game.responseSchema,undefined);assert.equal(game.responseInstructions,undefined);assert.equal(game.requestId,undefined);
 assert(Object.isFrozen(game));
 for(const id of [null,1,''])assert.throws(()=>instructionPacket(packet.observation,[{...candidates[0],id}],{requestId:'invalid-id',deadlineMs:1000}));
});
