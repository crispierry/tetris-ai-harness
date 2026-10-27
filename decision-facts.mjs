// Factual presentation only. Live options keep canonical order and identity.
// Next-piece enumeration is confined to the fixed teaching example below.
import {createGame,start} from './public/engine.mjs';
import {observe,enumerate,candidateEvidence,execute,features,freeze} from './public/harness.mjs';
import {compactDecisionInput,compactMove} from './decision-compact.mjs';
export const FACT_CHOICE_V1='compact-facts-1';
export const FACT_CHOICE_VERSION='compact-facts-2';

export function boardFacts(board){
 const holes=[],nearCompleteRows=[],surfaceGaps=[],above=Array(10).fill(0),openRows=[];
 for(let y=0;y<20;y++){
  const open=[],empty=[];
  for(let x=0;x<10;x++){
   if(board[y][x]!==null){above[x]++;open[x]=false;}
   else{empty.push(x);open[x]=above[x]===0;if(above[x])holes.push({x,y,blocksAbove:above[x]});}
  }
  if(empty.length>=1&&empty.length<=4)nearCompleteRows.push({y,emptyColumns:empty});
  openRows.push(open);
 }
 for(let y=0;y<20;y++)for(let x=0;x<10;){
  if(!openRows[y][x]){x++;continue;}
  const left=x;while(x<10&&openRows[y][x])x++;const right=x-1;
  const boundedLeft=left===0||board[y][left-1]!==null,boundedRight=right===9||board[y][right+1]!==null;
  if(!boundedLeft||!boundedRight||left===0&&right===9)continue;
  const previous=surfaceGaps.findLast(g=>g.left===left&&g.right===right&&g.bottomY===y-1);
  if(previous){previous.bottomY=y;previous.depth++;}
  else surfaceGaps.push({left,right,topY:y,bottomY:y,width:right-left+1,depth:1});
 }
 return freeze({holes,nearCompleteRows,surfaceGaps});
}
export function placementFacts(before,after,piecesLocked=1){
 const decode=b=>b.map(r=>typeof r==='string'?[...r].map(c=>c==='.'?null:c):r),beforeBoard=decode(before.board),afterBoard=decode(after.board);
 const a=features(beforeBoard),b=features(afterBoard);
 return freeze({piecesLocked,linesCleared:after.lines-before.lines,holesBefore:a.holes,holesAfter:b.holes,heightBefore:a.maxHeight,heightAfter:b.maxHeight,
  occupiedCellsBefore:beforeBoard.flat().filter(c=>c!==null).length,occupiedCellsAfter:afterBoard.flat().filter(c=>c!==null).length});
}
let example;
export function nextPieceExample(){
 if(example)return example;
 const s=start(createGame(71));s.board[18]=[...'L.I.....S.'].map(c=>c==='.'?null:c);s.board[19]=[...'L.I.TTT.SS'].map(c=>c==='.'?null:c);
 s.active={type:'O',rotation:0,x:4,y:0};s.queue=['Z','J','I','J','O','T'];s.nextType='Z';
 const binding={sessionId:'fixed-next-piece-example',revision:1},roots=enumerate(s,binding);
 const options=roots.map(c=>{const after=execute(s,c,binding),childBinding={...binding,revision:2},children=enumerate(after,childBinding).map(n=>candidateEvidence(after,n,childBinding));return {c,after,children};});
 const a=options[0],b=options.find(x=>features(x.after.board).holes===0&&x.children.some(c=>c.features.holes===0));
 if(features(a.after.board).holes!==0||a.children.some(c=>c.features.holes===0)||!b)throw Error('Invalid next-piece example');
 const option=(x,label)=>{const child=x.children.find(c=>c.features.holes===0)??x.children[0];return {...compactMove(candidateEvidence(s,x.c,binding),label),
  nextPiece:{type:'Z',legalPlacementCount:x.children.length,placementsLeavingZeroHoles:x.children.filter(c=>c.features.holes===0).length,
   illustratedPlacement:compactMove(child,'example-Z')}};};
 example=freeze({name:'Two hole-free O placements leave different surfaces for the visible Z',current:{rows:s.board.map(r=>r.map(c=>c??'.').join('')),active:s.active,next:s.queue.slice(0,5)},
  options:[option(a,'A'),option(b,'B')],explanation:'Both O placements leave zero holes immediately. Their resulting surfaces differ, changing the legal placements available to the next visible Z. Counts and illustrated continuations describe only this fixed teaching board; they are not live move recommendations or predictions of winning.'});
 return example;
}
export function factualDecisionInput(packet,{history=[],format=FACT_CHOICE_VERSION}={}){
 const base=compactDecisionInput(packet,{prioritizeHoles:true});
 // Earlier examples retain their literal boards and consequences, without an
 // answer label. They teach mechanics; no current candidate receives a rating.
 const examples=base.strategyExamples.map(({prefer,why,name,...e},i)=>({...e,name:['Covered empty cells','Filling a covered empty cell','Next spawn occupancy'][i]}));
 return freeze({...base,format,
  current:{...base.current,boardFacts:boardFacts(packet.observation.board)},
  recentPlacements:history.slice(-5),
  strategyExamples:[...examples,nextPieceExample()],
  factMeaning:'Hole coordinates have occupied-cell counts above them in their column. Near-complete rows have 1–4 empty cells, listed by column. Surface gaps are vertically merged spans of empty cells open to the top, flanked on each side by an occupied cell or the board wall, with at least one occupied side. Gap width/depth describes empty geometry, not tetromino fit or movement reachability. Recent placements are confirmed actual board transitions, including gravity locks. No live continuation search, candidate ranking, heuristic value or recommended move is supplied.',
  moves:base.moves.map((m,i)=>({...m,boardFacts:boardFacts(packet.candidates[i].afterstate.board)}))});
}
