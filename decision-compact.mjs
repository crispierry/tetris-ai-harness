// Presentation only: every canonical move is retained. No search, ranking or pruning.
import {createGame,start} from './public/engine.mjs';
import {observe,enumerate,candidateEvidence,freeze} from './public/harness.mjs';
export const COMPACT_CHOICE_VERSION='compact-strategy-1';
export const LEGACY_CHOICE_VERSION='canonical-summary-1';
const paths={left:'L',right:'R',clockwise:'C',down:'D',drop:'H'};
const pose=p=>p?{type:p.type,rotation:p.rotation,x:p.x,y:p.y}:null;
const rows=board=>board.map(row=>row.map(cell=>cell??'.').join(''));
const metrics=f=>{const {schemaVersion,...values}=f;return values;};
export const compactMove=(c,label)=>({move:label,piece:c.piece,rotation:c.orientation,origin:[c.x,c.y],cells:c.cells.map(p=>[p.x,p.y]),bounds:c.bounds,
 path:c.path.map(a=>paths[a]).join(''),after:{rows:rows(c.afterstate.board),active:pose(c.afterstate.active),status:c.afterstate.status,terminalReason:c.terminalReason,previewRemaining:c.afterstate.previewCount},
 change:{lines:c.linesDelta,score:c.scoreDelta,level:c.levelDelta,...c.featureDeltas},features:metrics(c.features)});
let examples;
export function strategicExamples(){
 if(examples)return examples;
 const base=()=>start(createGame(71)),cases=[];
 const holes=base();holes.active={type:'O',rotation:0,x:3,y:0};holes.board[19][0]='J';
 cases.push({state:holes,name:'Avoid an unnecessary covered hole',pick:cs=>[cs.find(c=>c.features.holes===0&&c.features.maxHeight<=2),cs.find(c=>c.features.holes>0)],why:'With equal line clears, the clean landing avoids burying an empty cell. Its low stack leaves more room for future pieces.'});
 const clear=base();clear.active={type:'I',rotation:1,x:3,y:0};clear.board[19]=Array.from({length:10},(_,x)=>x===5?null:'J');
 cases.push({state:clear,name:'Take a clean line clear',pick:cs=>[cs.find(c=>c.linesDelta===1&&c.features.holes===0),cs.find(c=>c.linesDelta===0&&c.features.holes>0)],why:'Here the clear fills the gap without creating a hole and leaves much less material on the board. The alternative covers the gap. Compare the full afterstate; line clears alone are not always best.'});
 const spawn=base();spawn.active={type:'I',rotation:0,x:3,y:-1};spawn.queue=['T','O','S','Z','J','L'];spawn.nextType='T';
 spawn.board[1]=Array.from({length:10},(_,x)=>x<3||x>6?'J':null);for(let x=3;x<=6;x++)spawn.board[2][x]='L';
 cases.push({state:spawn,name:'Keep the next spawn clear',pick:cs=>[cs.find(c=>c.afterstate.status==='playing'),cs.find(c=>c.afterstate.status==='over')],why:'Choose the surviving clear rather than a placement whose exact afterstate says blocked spawn. A cheap-looking immediate move cannot compensate for immediate loss.'});
 examples=freeze(cases.map(({state,name,pick,why},i)=>{const binding={sessionId:`strategy-example-${i}`,revision:1},cs=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),[good,bad]=pick(cs);if(!good||!bad)throw Error('Invalid strategic example');return {name,current:{rows:rows(state.board),active:pose(state.active),next:state.queue.slice(0,5)},options:i%2?[compactMove(bad,'A'),compactMove(good,'B')]:[compactMove(good,'A'),compactMove(bad,'B')],prefer:i%2?'B':'A',why};}));
 return examples;
}
export function compactDecisionInput(packet){
 const o=packet.observation;
 return freeze({format:COMPACT_CHOICE_VERSION,objective:packet.objective,rules:packet.rulesBrief.rules,geometry:packet.rulesBrief.geometry,
 encoding:'Rows run top to bottom, columns left to right. Dot is empty; every piece letter is occupied. Coordinates x right, y down. Path L/R/C/D/H means left/right/clockwise/down/hard drop. All offered paths are legal. Current next is the only future queue: after a nonwinning move its head becomes active, leaving the suffix; winning stops before spawn. Change fields are after minus before. Holes are empty cells below occupied cells in a column. Heights count rows from the bottom; aggregateHeight sums them; bumpiness sums adjacent height differences. Features describe the settled board, not win probabilities.',
 instructions:packet.rulesBrief.instructions,current:{rows:rows(o.board),active:pose(o.active),next:o.next,score:o.score,lines:o.lines,level:o.level,gravityElapsedMs:o.gravityElapsedMs},
 strategyExamples:strategicExamples(),moves:packet.candidates.map((c,i)=>compactMove(c,`m${i}`))});
}
export function compactChoiceDescription(c){return `clear ${c.linesDelta}; holes ${c.features.holes} (change ${c.featureDeltas.holes}); height ${c.features.maxHeight}; total height ${c.features.aggregateHeight}; roughness ${c.features.bumpiness}; ${c.afterstate.status}${c.terminalReason?': '+c.terminalReason:''}`;}
