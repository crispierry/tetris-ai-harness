import {createGame,start} from '../../public/engine.mjs';
import {observe,enumerate,candidateEvidence} from '../../public/harness.mjs';
import {instructionPacket} from '../../public/briefing.mjs';
export function singlePlacementPacket({base='browser',gravity=false}={}){
 const state=start(createGame(2)),binding={sessionId:base+'-0',revision:1};
 state.active={type:'I',rotation:1,x:2,y:0};
 state.board=Array.from({length:20},()=>Array.from({length:10},(_,x)=>x===4?null:'J'));
 return instructionPacket(observe(state,binding),enumerate(state,binding).map(c=>candidateEvidence(state,c,binding)),{requestId:binding.sessionId+':1:1',deadlineMs:1500,gravity});
}
