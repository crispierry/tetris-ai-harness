import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start} from '../public/engine.mjs';
import {observe,enumerate,candidateEvidence,execute,features} from '../public/harness.mjs';
import {instructionPacket} from '../public/briefing.mjs';
import {stateFromObservation} from '../public/ai-gravity.mjs';
import {boardFacts,placementFacts,factualDecisionInput,nextPieceExample,FACT_CHOICE_VERSION} from '../decision-facts.mjs';
import {requestFor,parse} from '../choice-protocol.mjs';
const empty=()=>Array.from({length:20},()=>Array(10).fill(null));
const packet=s=>{const b={sessionId:'facts',revision:1};return instructionPacket(observe(s,b),enumerate(s,b).map(c=>candidateEvidence(s,c,b)),{requestId:'factual-test',deadlineMs:10000,gravity:true});};
test('row gaps, hole covering counts and surface rectangles describe literal occupied cells',()=>{
 const b=empty();b[17][2]='J';b[18][2]='J';b[19]=Array(10).fill('L');b[19][2]=null;b[19][5]=null;
 const f=boardFacts(b);assert.deepEqual(f.holes,[{x:2,y:19,blocksAbove:2}]);assert.deepEqual(f.nearCompleteRows,[{y:19,emptyColumns:[2,5]}]);assert.deepEqual(f.surfaceGaps.find(g=>g.left===5&&g.right===5),{left:5,right:5,topY:19,bottomY:19,width:1,depth:1});
 for(const g of f.surfaceGaps)for(let y=g.topY;y<=g.bottomY;y++)for(let x=g.left;x<=g.right;x++){assert.equal(b[y][x],null);for(let above=0;above<y;above++)assert.equal(b[above][x],null);}
 assert.deepEqual(boardFacts(empty()),{holes:[],nearCompleteRows:[],surfaceGaps:[]});
});
test('recent facts use actual locked boards and handle saved string rows without counting dots as blocks',()=>{
 const before={board:empty(),lines:0},after={board:empty(),lines:0};after.board[19][0]='I';after.board[18][0]='I';
 const fact=placementFacts(before,after);assert.deepEqual(fact,{piecesLocked:1,linesCleared:0,holesBefore:0,holesAfter:0,heightBefore:0,heightAfter:2,occupiedCellsBefore:0,occupiedCellsAfter:2});
 assert.deepEqual(placementFacts({...before,board:before.board.map(r=>r.map(c=>c??'.').join(''))},{...after,board:after.board.map(r=>r.map(c=>c??'.').join(''))}),fact);
});
test('all canonical options, cells, boards and parser bindings survive factual presentation without rankings',()=>{
 const p=packet(start(createGame(37))),history=Array.from({length:8},(_,n)=>({piecesLocked:1,linesCleared:0,holesBefore:n,holesAfter:n,heightBefore:n,heightAfter:n+1,occupiedCellsBefore:n*4,occupiedCellsAfter:n*4+4})),input=factualDecisionInput(p,{history});
 assert.equal(input.moves.length,p.candidates.length);assert.deepEqual(input.recentPlacements,history.slice(-5));
 input.moves.forEach((m,i)=>{assert.equal(m.move,`m${i}`);assert.deepEqual(m.cells,p.candidates[i].cells.map(c=>[c.x,c.y]));assert.deepEqual(m.after.rows,p.candidates[i].afterstate.board.map(r=>r.map(c=>c??'.').join('')));assert.deepEqual(m.boardFacts,boardFacts(p.candidates[i].afterstate.board));});
 const check=o=>{if(o&&typeof o==='object'){for(const [k,v]of Object.entries(o)){assert(!['recommended','rank','value','evaluationScore','prefer'].includes(k),k);check(v);}}};check(input);
 const opts={format:FACT_CHOICE_VERSION,history,reverseChoices:true},r=requestFor('decisions',p,{model:'gpt-6-luna'},opts),values=r.body.questions[0].choices.map(c=>c.value);assert.deepEqual(values,p.candidates.map((_,i)=>`m${i}`).reverse());assert.equal(JSON.parse(r.body.input).format,FACT_CHOICE_VERSION);
 const chosen=values[2],response={status:200,body:{model:'gpt-6-luna',answers:[{name:'placement',type:'choice',choice:chosen,confidence:1,probabilities:values.map(value=>({value,probability:value===chosen?1:0}))}]}};assert.equal(parse('decisions',response,p,opts).choice.selectedCandidateId,p.candidates[Number(chosen.slice(1))].id);
});
test('the fixed next-piece example replays every O option and Z consequence; live candidates receive no continuations',()=>{
 const e=nextPieceExample(),initial=start(createGame(71)),s=stateFromObservation({...observe(initial,{sessionId:'example',revision:1}),board:e.current.rows,active:e.current.active,next:e.current.next}),binding={sessionId:'example',revision:1};
 const roots=enumerate(s,binding);
 for(const option of e.options){const c=roots.find(c=>JSON.stringify(c.cells.map(p=>[p.x,p.y]))===JSON.stringify(option.cells));assert(c);const after=execute(s,c,binding);assert.equal(features(after.board).holes,0);const childBinding={...binding,revision:2},children=enumerate(after,childBinding),outcomes=children.map(c=>execute(after,c,childBinding));assert.equal(children.length,option.nextPiece.legalPlacementCount);assert.equal(outcomes.filter(s=>features(s.board).holes===0).length,option.nextPiece.placementsLeavingZeroHoles);const child=children.find(c=>JSON.stringify(c.cells.map(p=>[p.x,p.y]))===JSON.stringify(option.nextPiece.illustratedPlacement.cells));assert(child);assert.deepEqual(execute(after,child,childBinding).board.map(r=>r.map(c=>c??'.').join('')),option.nextPiece.illustratedPlacement.after.rows);}
 assert.equal(e.options[0].nextPiece.placementsLeavingZeroHoles,0);assert(e.options[1].nextPiece.placementsLeavingZeroHoles>0);assert(factualDecisionInput(packet(start(createGame(5)))).moves.every(m=>!('nextPiece' in m)));
});
