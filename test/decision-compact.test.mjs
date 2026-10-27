import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start} from '../public/engine.mjs';
import {observe,enumerate,candidateEvidence,execute} from '../public/harness.mjs';
import {instructionPacket} from '../public/briefing.mjs';
import {compactDecisionInput,strategicExamples,COMPACT_CHOICE_VERSION,LEGACY_CHOICE_VERSION,HOLE_CHOICE_VERSION,holeConsequences,holeStrategicExamples} from '../decision-compact.mjs';
import {requestFor,parse} from '../choice-protocol.mjs';
import {stateFromObservation} from '../public/ai-gravity.mjs';
const packetFor=(state,binding={sessionId:'compact-test',revision:1})=>instructionPacket(observe(state,binding),enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),{requestId:'compact-r',deadlineMs:1500,gravity:true});
const board=rows=>rows.map(row=>[...row].map(c=>c==='.'?null:c));
test('compact evidence preserves every legal move, exact board, path, preview and consequence across different states',()=>{
 for(const seed of [7,53,199]){
  let state=start(createGame(seed));
  for(let turn=1;turn<=8;turn++){
   const packet=packetFor(state,{sessionId:'compact-test',revision:turn}),input=compactDecisionInput(packet);
   assert.equal(input.moves.length,packet.candidates.length);assert.deepEqual(board(input.current.rows),packet.observation.board);assert.deepEqual(input.current.next,packet.observation.next);
   for(let i=0;i<input.moves.length;i++){
    const m=input.moves[i],c=packet.candidates[i];assert.equal(m.move,`m${i}`);assert.deepEqual(board(m.after.rows),c.afterstate.board);assert.deepEqual(m.cells,c.cells.map(p=>[p.x,p.y]));assert.deepEqual(m.bounds,c.bounds);
    assert.equal(m.path,c.path.map(a=>({left:'L',right:'R',clockwise:'C',down:'D',drop:'H'})[a]).join(''));
    assert.equal(m.after.status,c.afterstate.status);assert.equal(m.after.previewRemaining,c.afterstate.next.length);assert.deepEqual(packet.observation.next.slice(c.afterstate.status==='won'?0:1),c.afterstate.next);
    assert.equal(input.current.lines+m.change.lines,c.afterstate.lines);assert.equal(input.current.score+m.change.score,c.afterstate.score);assert.equal(input.current.level+m.change.level,c.afterstate.level);
    assert.deepEqual({...m.features,schemaVersion:1},c.features);assert.equal(m.change.holes,c.featureDeltas.holes);
   }
   assert(!JSON.stringify(input).includes('compact-test'));assert(!/"(?:seed|rng|queue|capability)":/.test(JSON.stringify(input)));
   if(state.status!=='playing')break;state=execute(state,enumerate(state,{sessionId:'advance',revision:turn})[0],{sessionId:'advance',revision:turn});if(state.status!=='playing')break;
  }
 }
});
test('strategic examples are executable, have honest outcomes and vary the preferred label',()=>{
 const examples=strategicExamples();assert.equal(examples.length,3);assert(new Set(examples.map(e=>e.prefer)).size>1);
 for(const example of examples){
  const initial=start(createGame(71)),o={...observe(initial,{sessionId:'example-check',revision:1}),board:example.current.rows,active:example.current.active,next:example.current.next},state=stateFromObservation(o),binding={sessionId:'example-check',revision:1},cs=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding));
  for(const option of example.options){const candidate=cs.find(c=>JSON.stringify(c.cells.map(p=>[p.x,p.y]))===JSON.stringify(option.cells));assert(candidate);assert.deepEqual(board(option.after.rows),candidate.afterstate.board);assert.equal(option.after.status,candidate.afterstate.status);}
 }
 const preferred=e=>e.options.find(o=>o.move===e.prefer),other=e=>e.options.find(o=>o.move!==e.prefer);
 assert(preferred(examples[0]).features.holes<other(examples[0]).features.holes);assert(preferred(examples[1]).change.lines>other(examples[1]).change.lines);assert.equal(preferred(examples[2]).after.status,'playing');assert.equal(other(examples[2]).after.status,'over');
});
test('short wire labels map exactly back to canonical IDs even with reversed options; unknown and canonical wire IDs reject',()=>{
 const p=packetFor(start(createGame(7))),opts={format:COMPACT_CHOICE_VERSION,reverseChoices:true},request=requestFor('decisions',p,{model:'gpt-6-luna'},opts),values=request.body.questions[0].choices.map(c=>c.value),selected=values[1];
 assert.equal(values.at(-1),'m0');assert.equal(JSON.parse(request.body.input).format,COMPACT_CHOICE_VERSION);
 const result={status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:selected,confidence:.9,probabilities:values.map(value=>({value,probability:value===selected?1:0}))}]}};
 const decoded=parse('decisions',result,p,opts);assert.equal(decoded.choice.selectedCandidateId,p.candidates[Number(selected.slice(1))].id);assert.deepEqual(new Set(decoded.distribution.map(d=>d.id)),new Set(p.candidates.map(c=>c.id)));
 for(const choice of ['m999',p.candidates[0].id]){const bad=structuredClone(result);bad.body.answers[0].choice=choice;assert.throws(()=>parse('decisions',bad,p,opts));}
 assert.throws(()=>requestFor('decisions',p,{model:'gpt-6-luna'},{format:'invented'}));
});
test('compact request is substantially smaller without discarding any candidate',()=>{
 const p=packetFor(start(createGame(7))),legacy=requestFor('decisions',p,{model:'gpt-6-luna'},{format:LEGACY_CHOICE_VERSION}),compact=requestFor('decisions',p,{model:'gpt-6-luna'},{format:COMPACT_CHOICE_VERSION});
 assert(Buffer.byteLength(JSON.stringify(compact.body))<Buffer.byteLength(JSON.stringify(legacy.body))*.65);assert.equal(compact.body.questions[0].choices.length,legacy.body.questions[0].choices.length);
});
test('winning compact moves retain the original five-piece preview and stop before spawning',()=>{
 const initial=start(createGame(53)),board=initial.board.map(row=>[...row]);board[19]=Array.from({length:10},(_,x)=>x===5?null:'J');
 const packet=packetFor({...initial,board,active:{type:'I',rotation:1,x:3,y:0},lines:299,level:30}),input=compactDecisionInput(packet),winner=packet.candidates.findIndex(c=>c.afterstate.status==='won');
 assert(winner>=0);const move=input.moves[winner];assert.equal(move.after.active,null);assert.equal(move.after.previewRemaining,5);assert.equal(input.current.lines+move.change.lines,300);assert.deepEqual(input.current.next,packet.candidates[winner].afterstate.next);
});
test('hole facts expose compensated creation and track surviving holes through a row clear',()=>{
 const empty=()=>Array.from({length:20},()=>Array(10).fill(null)),before=empty(),after=empty();before[18][0]='J';after[18][0]='J';after[19][0]='I';after[18][1]='J';
 assert.deepEqual(holeConsequences(before,after,[]),{created:1,resolved:1,maxBlocksAboveHole:1});
 const fallingBefore=empty(),fallingAfter=empty();fallingBefore[16][0]='J';fallingAfter[17][0]='J';assert.deepEqual(holeConsequences(fallingBefore,fallingAfter,[19]),{created:0,resolved:1,maxBlocksAboveHole:1});
});
test('hole guidance supplies facts for every option without changing order, selecting, ranking or scoring a current move',()=>{
 const p=packetFor(start(createGame(197))),input=compactDecisionInput(p,{prioritizeHoles:true}),request=requestFor('decisions',p,{model:'gpt-6-luna'},{format:HOLE_CHOICE_VERSION});
 assert.equal(input.format,HOLE_CHOICE_VERSION);assert.equal(input.moves.length,p.candidates.length);assert.deepEqual(input.moves.map(m=>m.move),p.candidates.map((_,i)=>`m${i}`));
 for(let i=0;i<p.candidates.length;i++){const c=p.candidates[i],m=input.moves[i];assert.equal(m.holeEvidence.created-m.holeEvidence.resolved,c.featureDeltas.holes);assert.deepEqual(board(m.after.rows),c.afterstate.board);for(const key of ['recommended','rank','value','evaluationScore','prefer'])assert(!Object.hasOwn(m,key));}
 assert(!Object.hasOwn(input,'prefer'));assert(!Object.hasOwn(input,'recommended'));assert.match(request.body.questions[0].instructions,/you decide exceptions/);assert.match(request.body.questions[0].choices[0].description,/new holes/);
 const values=request.body.questions[0].choices.map(c=>c.value),chosen=values.at(-1),result={status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:chosen,confidence:1,probabilities:values.map(value=>({value,probability:value===chosen?1:0}))}]}};
 assert.equal(parse('decisions',result,p,{format:HOLE_CHOICE_VERSION}).choice.selectedCandidateId,p.candidates.at(-1).id);
});
test('hole-priority examples teach a deliberate roughness tradeoff and resolving an existing hole',()=>{
 const e=holeStrategicExamples(),good=x=>x.options.find(o=>o.move===x.prefer),bad=x=>x.options.find(o=>o.move!==x.prefer);
 assert.equal(e.length,3);assert.equal(good(e[0]).holeEvidence.created,0);assert(bad(e[0]).holeEvidence.created>0);assert(good(e[0]).features.bumpiness>bad(e[0]).features.bumpiness);
 assert.equal(good(e[1]).holeEvidence.resolved,1);assert.equal(good(e[1]).holeEvidence.created,0);assert.equal(bad(e[1]).holeEvidence.resolved,0);assert.equal(good(e[2]).after.status,'playing');assert.equal(bad(e[2]).after.status,'over');
 for(const example of e){const initial=start(createGame(71)),state=stateFromObservation({...observe(initial,{sessionId:'hole-verify',revision:1}),board:example.current.rows,active:example.current.active,next:example.current.next}),binding={sessionId:'hole-verify',revision:1},cs=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding));for(const option of example.options){const c=cs.find(c=>JSON.stringify(c.cells.map(p=>[p.x,p.y]))===JSON.stringify(option.cells));assert(c);assert.deepEqual(option.holeEvidence,holeConsequences(state.board,c.afterstate.board,c.clearedRows));}}
});
