import {RunClock,mountRunClocks} from './run-timing.mjs';
import {GravityController} from './gravity-controller.mjs';
import {gravityPolicy} from './ai-gravity.mjs';
import {mountTestCost} from './test-cost.mjs';
import {compactPlayerName,visibleOutcome} from './arcade-copy.mjs';
import {createPlacementPresenter,placementEvent,placementBeforeView,depth2Error} from './placement-motion.mjs';
import { providerProvenance } from './provider-provenance.mjs';
import { mountDecisionPairing } from './decision-session.mjs';
import { providerPolicy } from './provider-policy.mjs';
import { DecisionJournal } from './decision-record.mjs';
import { cells, RULES } from './engine.mjs';
import { GEOMETRY, freeze } from './harness.mjs';
import { Controller, heuristic, mockProvider } from './controller.mjs';
import {providerFor} from './comparison.mjs';
import { briefing } from './briefing.mjs';
import { MARATHON_COPY, linesProgress, levelProgress, outcomeDetail } from './marathon.mjs';
export function mountHarness(doc,{window:win=globalThis,onExport=null,clock}={}) {
const updateCost=mountTestCost(doc);
const runClock=new RunClock({now:clock?.now??(()=>performance.now())});let runClocks=null;
const $ = id => doc.getElementById(id), format = new Intl.NumberFormat().format;
const depthSelect=$('h-depth');if(depthSelect&&!/^[1-6]$/.test(depthSelect.value))depthSelect.value='2';
const STATUS = { falling:'Falling', placing:'Placing…',ready: 'Ready', running: 'Running', choosing: 'Choosing…', paused: 'Paused', stopped: 'Stopped', over: 'Game over', won: MARATHON_COPY.complete, error: 'Error' };
const board = $('h-board'), tiles = Array.from({length:RULES.width*RULES.height},()=>{const tile=doc.createElement('span');tile.className='h-cell';tile.setAttribute('aria-hidden','true');board.append(tile);return tile;});
let generation=0,pendingPresentation=false,placing=false,beforeView=null,visual=null,motionAbort=null;
const presenter=createPlacementPresenter({window:win,onFrame:observation=>{visual=observation;render(controller.view);},onSettled:()=>{visual=null;}});
function fenceMotion(){generation++;beforeView=null;pendingPresentation=false;placing=false;motionAbort?.abort();motionAbort=null;presenter.cancel();}
let disposed=false,replayFrame=null,savedReplayJSON=null;
let locked=false, frames=[],replay=false,replayIndex=0,pairing=null,provider=$('h-provider').value==='lookahead'?providerFor('lookahead',{depth:Number(depthSelect.value)}):heuristic(),policy=null;
let recordingBytes=0,archiveError=null,journal=null;
function transition({input,view}){if(journal&&(!journal.incomplete||['computer','spawn'].includes(input.kind)))journal.append(0,input,view);}
const gravity=()=>$('h-gravity')?.checked===true;
const currentPolicy=()=>gravity()?gravityPolicy(providerPolicy(provider)):providerPolicy(provider);
function newJournal(){journal=new DecisionJournal({mode:"solo"});journal.addLane(0,"computer",controller.view,policy??currentPolicy());}
let auto = false, loopToken = 0, timer = null, previousStatus = 'ready';
function announce(text) { $('h-announcement').textContent=text; }
function render(view) {
 if(disposed)return;
 runClocks?.update();
 updateCost({gameId:view.observation.sessionId,receipt:view.lastDecision?.receipt,error:!!view.error,busy:view.busy,replay,openAI:$('h-provider').value==='openai',tracked:policy?.kind==='externalDecisions'});
 $('h-reset').disabled=!replay&&!!pairing?.resetBlocked;
 if(replay&&replayFrame)view=replayFrame;
 if(!replay)pairing?.observe(view.lastDecision?.receipt);
 if(pendingPresentation&&view.busy&&!beforeView&&(gravity()||!view.lastDecision))beforeView=gravity()?placementBeforeView(view):view;
 if(beforeView&&(pendingPresentation||placing)&&!view.error)view={...beforeView,status:placing||beforeView.status==='placing'?'placing':'choosing',busy:true,observation:visual??beforeView.observation};
 else if(replay&&visual)view={...view,observation:visual,status:'placing'};
 const obs=view.observation, active=new Map((obs.active?.cells??[]).map(p=>[`${p.x},${p.y}`,obs.active.type]));
 for(let y=0;y<RULES.height;y++)for(let x=0;x<RULES.width;x++){
  const falling=active.get(`${x},${y}`),type=falling??obs.board[y][x];
  tiles[y*RULES.width+x].className=`h-cell${type?` filled piece-${type}`:''}${falling?' active':''}`;
 }
 board.setAttribute('aria-label',`${RULES.width} columns by ${RULES.height} rows. ${obs.board.flat().filter(Boolean).length} locked cells. ${obs.active?`Falling ${obs.active.type} piece.`:'No falling piece.'}`);
 $('h-status').textContent=replay?'Saved visual replay':view.pieces>=1000&&obs.status!=='won'?'Capped':(view.status==='falling'&&view.missedChoice?'Falling · missed choice':STATUS[view.status]);$('player-heading').textContent=!replay&&!!pairing&&$('h-provider').value==='openai'&&pairing.session.state.state!=='connected'?'OpenAI Decisions':compactPlayerName(view.player.name);
 for(const key of ['score','lines','level'])$('h-'+key).textContent=format(obs[key]);$('h-pieces').textContent=format(view.pieces);$('h-lines').textContent=linesProgress(obs.lines);$('h-level').textContent=levelProgress(obs.level);$('h-outcome').textContent=visibleOutcome(view.status,obs,view.error);
 $('player-heading').title=view.player.name;
 $('h-next').replaceChildren();obs.next.forEach((type,index)=>{
  const mini=doc.createElement('div');mini.className=`h-mini piece-${type}`;mini.setAttribute('role','img');mini.setAttribute('aria-label',`Next ${index+1}: ${type}`);
  const occupied=new Set(GEOMETRY.find(g=>g.type===type).orientations[0].cells.map(p=>`${p.x},${p.y}`));
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){const dot=doc.createElement('span');if(occupied.has(`${x},${y}`))dot.className='filled';mini.append(dot);} $('h-next').append(mini);
 });
 if(['over','won','error'].includes(view.status)&&previousStatus!==view.status){auto=false;loopToken++;clearTimeout(timer);announce(`Computer: ${STATUS[view.status]}. ${view.status==='won'?outcomeDetail('won',obs):view.error??`${format(view.pieces)} pieces, ${format(obs.lines)} lines.`}`);}
 const unavailable=!replay&&$('h-provider').value==='openai' && (pairing?.session.state.state!=='connected'||pairing?.blocked);
 $('h-provenance').textContent=providerProvenance(policy??providerPolicy(provider),{recorded:replay,pending:unavailable && (pairing?.session.state.message ?? true)});
 const terminal=(!replay&&['over','won'].includes(view.status))||(!replay&&(view.pieces>=1000||archiveError))||(!replay&&view.recoveryRequired)||unavailable;$('h-start').textContent=replay?'Play saved frames':['paused','stopped'].includes(view.status)?'Resume':'Start';$('h-start').disabled=auto||view.busy||placing||terminal||(replay&&replayIndex>=frames.length);$('h-step').disabled=auto||view.busy||placing||terminal||(replay&&replayIndex>=frames.length);
 $('h-pause').disabled=!auto&&!view.busy&&!placing;$('h-stop').disabled=!view.busy&&(view.status==='ready'||view.status==='stopped'||(!replay&&['won','over'].includes(view.status))); $('h-provider').disabled=locked;if($('h-gravity'))$('h-gravity').disabled=locked;
 if(depthSelect){depthSelect.disabled=locked||$('h-provider').value!=='lookahead';if(depthSelect.parentNode)depthSelect.parentNode.hidden=$('h-provider').value!=='lookahead';}
 $('h-replay').disabled=!frames.length;$('h-export').disabled=!frames.length;
 $('h-step').textContent=replay?'Next frame':'Step';$('h-step').setAttribute('aria-label',replay?'Next saved frame':'Step one piece');
 if(!replay&&obs.status!=='won'&&(view.pieces>=1000||archiveError))$('h-outcome').textContent=archiveError??'Placement safety limit reached. The 300-line goal was not reached. Reset to play again.';
 $('h-error').hidden=!view.error;$('h-error').textContent=depth2Error(provider,view.error,'solo')??'';
 if(view.lastDecision){const c=view.lastDecision.candidate;$('h-choice').textContent=`${c.piece} · ${c.cells.map(p=>`(${p.x}, ${p.y})`).join(' ')} · ${Math.round(view.lastDecision.latencyMs)} ms`;$('h-details').textContent=JSON.stringify({missedChoice:view.lastDecision.missedChoice??false,receipt:view.lastDecision.receipt??null,orientation:c.orientation,path:c.path,clearedRows:c.clearedRows,scoreDelta:c.scoreDelta,features:c.features},null,2);}else{$('h-choice').textContent='No piece selected yet.';$('h-details').textContent='Run or step to inspect a choice.';}
 previousStatus=view.status;
}
let controller=new (gravity()?GravityController:Controller)({sessionId:'harness',provider,...(clock?{clock}:{}),onChange:render,onTransition:transition});
newJournal();
runClocks=mountRunClocks(doc,{window:win,read:()=>({replay,lanes:[{lane:0,...runClock.view}]}),ids:{0:'h-clock'}});
pairing=mountDecisionPairing(doc,{mode:'solo',lane:'solo',window:win,onAvailabilityChange:()=>render(controller.view),beforeConnect:()=>{if($('h-provider').value!=='openai')throw new Error('Select OpenAI before connecting.');},onConnected:()=>{if($('h-provider').value==='openai')chooseProvider();}});
function chooseProvider(){if(locked)return;runClock.reset();controller.stop();provider=$('h-provider').value==='openai'?pairing.session.provider:$('h-provider').value==='lookahead'?providerFor('lookahead',{depth:Number(depthSelect.value)}):$('h-provider').value==='local'?heuristic():mockProvider({mode:$('h-provider').value});controller=new (gravity()?GravityController:Controller)({...(provider.kind==='remote'?pairing.session.binding:{sessionId:'harness'}),provider,...(clock?{clock}:{}),onChange:render,onTransition:transition});policy=currentPolicy();newJournal();frames=[];render(controller.view);}
function record(){const v=controller.view;if(v.lastDecision?.requestId && v.lastDecision.requestId===frames.at(-1)?.lastDecision?.requestId)return;if(!v.lastDecision&&frames.at(-1)?.status===v.status)return;const last=v.lastDecision;const frame=JSON.parse(JSON.stringify({...v,lastDecision:last?{requestId:last.requestId,latencyMs:last.latencyMs,receipt:last.receipt,candidate:{piece:last.candidate.piece,cells:last.candidate.cells,orientation:last.candidate.orientation,path:last.candidate.path.map(a=>({left:'L',right:'R',clockwise:'C',down:'D',drop:'H'})[a]).join(''),pathEncoding:'LRCDH-1',clearedRows:last.candidate.clearedRows,scoreDelta:last.candidate.scoreDelta,features:last.candidate.features}}:null}));const bytes=new TextEncoder().encode(JSON.stringify(frame)).length;if(frames.length>=1000||recordingBytes+bytes>16*1024*1024-160*1024){journal.censor();archiveError='Recording limit reached. The 300-line goal was not reached. Reset to play again.';auto=false;controller.stop();$('h-outcome').textContent=archiveError;return;}recordingBytes+=bytes;frames.push(freeze(frame));}
async function one(continuing=false){locked=true;runClock.start();const activeController=controller;const token=generation,sessionId=controller.view.observation.sessionId,previousPieces=controller.view.pieces;pendingPresentation=true;beforeView=null;await controller.step({continueRunning:continuing});if(controller===activeController)runClock.record(controller.view.lastDecision);if(token!==generation){if(!replay&&controller.view.observation.sessionId===sessionId)record();return;}record();const v=controller.view;pendingPresentation=false;
 if(beforeView&&v.pieces===previousPieces+1&&!v.error&&!v.recoveryRequired){placing=true;motionAbort=new AbortController();render(v);await presenter.play(placementEvent(beforeView,v,{generation:token,signal:motionAbort.signal}));if(token!==generation)return;}
 placing=false;beforeView=null;motionAbort=null;if(['over','won'].includes(controller.view.status)||controller.view.recoveryRequired||controller.view.pieces>=1000||journal.incomplete)runClock.finish();else if(!auto)runClock.pause();render(controller.view);if(journal.incomplete){archiveError=journal.archiveError;auto=false;controller.stop();}await pairing?.refresh();if(controller.view.pieces>=1000||controller.view.recoveryRequired){auto=false;render(controller.view);}}

function download(json){if(onExport){onExport(json);return;}const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const link=doc.createElement('a');link.href=url;link.download='tetris-solo-run.json';doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function runLoop(token){if(!auto||token!==loopToken)return;if(controller.view.pieces>=1000)return;await one(true);if(auto&&token===loopToken&&controller.view.status==='running')timer=setTimeout(()=>runLoop(token),gravity()?0:150);}
function pause(){runClock.pause();fenceMotion();auto=false;loopToken++;clearTimeout(timer);controller.pause();announce('Paused. Step once or Start to continue.');}
async function showSaved(){if(replayIndex>=frames.length){auto=false;render(replayFrame);return false;}const previous=replayFrame,token=generation;replayFrame={...frames[replayIndex++],status:'paused'};if(!gravity()&&previous&&replayFrame.pieces===previous.pieces+1&&replayFrame.lastDecision?.candidate?.path&&!replayFrame.error){beforeView=previous;motionAbort=new AbortController();placing=true;await presenter.play(placementEvent(previous,replayFrame,{generation:token,replay:true,signal:motionAbort.signal}));if(token!==generation)return false;}placing=false;beforeView=null;motionAbort=null;render(replayFrame);return true;}
async function playSaved(token){if(!auto||token!==loopToken||disposed)return;if(await showSaved()&&auto&&token===loopToken&&!disposed)timer=setTimeout(()=>playSaved(token),150);}
function exportRun(){if(replay&&savedReplayJSON)return savedReplayJSON;return journal.exportRun({metadata:{accounting:provider.kind==='remote'?provider.runMetadata.accounting:null}});}
$('h-start').addEventListener('click',()=>{if(replay){auto=true;playSaved(++loopToken);return;}locked=true;auto=true;runClock.start();const token=++loopToken;controller.start();announce('Running computer play.');runLoop(token);});
$('h-pause').addEventListener('click',pause);
$('h-step').addEventListener('click',async()=>{if(replay){await showSaved();return;}await one();if(controller.view.status==='paused')announce('One piece placed. Paused.');});
$('h-stop').addEventListener('click',()=>{runClock.pause();fenceMotion();auto=false;loopToken++;clearTimeout(timer);controller.stop();announce('Stopped. Board retained. Start continues; Reset begins again.');});
$('h-reset').addEventListener('click',()=>{runClock.reset();fenceMotion();auto=false;loopToken++;clearTimeout(timer);controller.reset();pairing?.session.reset();locked=false;frames=[];recordingBytes=0;archiveError=null;replay=false;replayFrame=null;savedReplayJSON=null;newJournal();render(controller.view);announce('Reset. Ready to begin the same sequence.');});
pairing?.setEnabled(false);
$('h-provider').addEventListener('change',()=>{pairing?.setEnabled($('h-provider').value==='openai');try{chooseProvider();}catch{render(controller.view);announce('Connect OpenAI before playing.');}});
$('h-gravity')?.addEventListener('change',()=>{try{chooseProvider();}catch(error){announce(error.message);}});
depthSelect?.addEventListener('change',()=>{try{chooseProvider();}catch(error){announce(error.message);}});
$('h-replay').addEventListener('click',()=>{if(!frames.length)return;runClock.pause();fenceMotion();auto=false;loopToken++;clearTimeout(timer);savedReplayJSON=exportRun();controller.pause();replay=true;replayIndex=0;showSaved();announce('Saved visual replay. Step advances stored frames; no new decisions.');});
$('h-export').addEventListener('click',()=>download(exportRun()));
win.addEventListener?.('blur',()=>{if(auto||controller.view.busy||placing)pause();});
doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&(auto||controller.view.busy||placing))pause();});
const list=doc.createElement('ol');list.className='h-rules-list';briefing().instructions.forEach(text=>{const li=doc.createElement('li');li.textContent=text;list.append(li);});$('h-rules').append(list);
const examples=doc.createElement('pre');examples.textContent=JSON.stringify(briefing().examples,null,2);$('h-rules').append(examples);render(controller.view);

const dispose=()=>{runClock.pause();runClocks?.dispose();fenceMotion();presenter.dispose();disposed=true;auto=false;loopToken++;clearTimeout(timer);controller.stop();pairing?.session.close().catch(()=>{});};
win.addEventListener?.('pagehide',event=>{if(event?.persisted){if(auto||controller.view.busy||placing)pause();}else dispose();});return {get controller(){return controller;},get timing(){return runClock.view;},exportRun,dispose};
}
if(typeof document!=='undefined')mountHarness(document);
