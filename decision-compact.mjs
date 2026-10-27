// Presentation only: every canonical move is retained. No search, ranking or pruning.
import {createGame,start} from './public/engine.mjs';
import {observe,enumerate,candidateEvidence,freeze,features} from './public/harness.mjs';
export const COMPACT_CHOICE_VERSION='compact-strategy-1';
export const HOLE_CHOICE_VERSION='compact-holes-1';
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
const expand=boardRows=>boardRows.map(row=>[...row].map(c=>c==='.'?null:c));
function holeCells(board){const holes=[];for(let x=0;x<10;x++){let above=0;for(let y=0;y<20;y++){if(board[y][x]!==null)above++;else if(above)holes.push({x,y,above});}}return holes;}
/** Factual cell tracking through row collapse; no scalar evaluation or preferred move. */
export function holeConsequences(before,after,clearedRows){
 const old=holeCells(before),next=holeCells(after),keys=new Set(next.map(h=>`${h.x},${h.y}`));let persisted=0;
 for(const h of old)if(!clearedRows.includes(h.y)&&keys.has(`${h.x},${h.y+clearedRows.filter(y=>y>h.y).length}`))persisted++;
 return {created:next.length-persisted,resolved:old.length-persisted,maxBlocksAboveHole:next.reduce((n,h)=>Math.max(n,h.above),0)};
}
let holeExamples;
export function holeStrategicExamples(){
 if(holeExamples)return holeExamples;
 const base=strategicExamples(),state=start(createGame(71));state.active={type:'I',rotation:0,x:3,y:0};state.board[19][0]='J';state.board[18][1]='J';
 const binding={sessionId:'hole-example',revision:1},cs=enumerate(state,binding).map(c=>candidateEvidence(state,c,binding));
 const good=cs.find(c=>holeConsequences(state.board,c.afterstate.board,c.clearedRows).resolved===1&&c.features.holes===0),bad=cs.find(c=>c.features.holes===1&&c.linesDelta===0&&holeConsequences(state.board,c.afterstate.board,c.clearedRows).resolved===0);if(!good||!bad)throw Error('Invalid hole example');
 const resolve={name:'Resolve a covered hole',current:{rows:rows(state.board),active:pose(state.active),next:state.queue.slice(0,5)},options:[compactMove(bad,'A'),compactMove(good,'B')],prefer:'B',why:'B resolves the existing covered empty cell without creating another. A leaves it buried. A low or smooth surface is secondary to keeping empty cells reachable; use the exact boards and paths to understand the tradeoff.'};
 const avoid={...base[0],name:'Prefer a hole-free landing over a smoother roof',why:'A leaves zero holes; B creates one even though its surface is smoother. A covered empty cell cannot be filled by a straight drop: covering blocks must be cleared or a reachable side route must exist. Prefer avoiding that burden over a cosmetic reduction in roughness when both moves survive.'};
 holeExamples=freeze([avoid,resolve,{...base[2],why:'Immediate survival and a winning clear take precedence. Rejecting a surviving move solely because its hole count is high can still lose immediately. Use exact terminal outcomes, then assess holes and the visible next pieces.'}].map(example=>{
  const before=expand(example.current.rows);return {...example,options:example.options.map(option=>{const placed=before.map(r=>[...r]);for(const [x,y]of option.cells)placed[y][x]=option.piece;const cleared=placed.flatMap((row,y)=>row.every(Boolean)?[y]:[]);return {...option,holeEvidence:holeConsequences(before,expand(option.after.rows),cleared)};})};
 }));return holeExamples;
}
export function compactDecisionInput(packet,{prioritizeHoles=false}={}){
 const o=packet.observation;
 const result={format:prioritizeHoles?HOLE_CHOICE_VERSION:COMPACT_CHOICE_VERSION,objective:packet.objective,rules:packet.rulesBrief.rules,geometry:packet.rulesBrief.geometry,
 encoding:'Rows run top to bottom, columns left to right. Dot is empty; every piece letter is occupied. Coordinates x right, y down. Path L/R/C/D/H means left/right/clockwise/down/hard drop. All offered paths are legal. Current next is the only future queue: after a nonwinning move its head becomes active, leaving the suffix; winning stops before spawn. Change fields are after minus before. Holes are empty cells below occupied cells in a column. Heights count rows from the bottom; aggregateHeight sums them; bumpiness sums adjacent height differences. Features describe the settled board, not win probabilities.',
 instructions:packet.rulesBrief.instructions,current:{rows:rows(o.board),active:pose(o.active),next:o.next,score:o.score,lines:o.lines,level:o.level,gravityElapsedMs:o.gravityElapsedMs},
 strategyExamples:prioritizeHoles?holeStrategicExamples():strategicExamples(),moves:packet.candidates.map((c,i)=>({...compactMove(c,`m${i}`),...(prioritizeHoles?{holeEvidence:holeConsequences(o.board,c.afterstate.board,c.clearedRows)}:{})}))};
 if(prioritizeHoles){result.current.features=metrics(features(o.board));result.holeEvidenceMeaning='created counts newly covered empty cells; resolved counts old holes filled, cleared or uncovered. Existing holes are tracked through cleared-row collapse, so creating and resolving a hole are not hidden by a zero net change. maxBlocksAboveHole is the largest number of occupied cells above a hole in its column, not a prediction of recovery cost.';}
 return freeze(result);
}
export function compactChoiceDescription(c){return `clear ${c.linesDelta}; holes ${c.features.holes} (change ${c.featureDeltas.holes}); height ${c.features.maxHeight}; total height ${c.features.aggregateHeight}; roughness ${c.features.bumpiness}; ${c.afterstate.status}${c.terminalReason?': '+c.terminalReason:''}`;}

export function holeChoiceDescription(c,before){const h=holeConsequences(before,c.afterstate.board,c.clearedRows);return `new holes ${h.created}; resolved ${h.resolved}; remaining ${c.features.holes}; max blocks above hole ${h.maxBlocksAboveHole}; clear ${c.linesDelta}; height ${c.features.maxHeight}; roughness ${c.features.bumpiness}; ${c.afterstate.status}${c.terminalReason?': '+c.terminalReason:''}`;}
