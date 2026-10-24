import { cells, RULES } from './engine.mjs';
import { GEOMETRY } from './harness.mjs';
import { Controller, heuristic, mockProvider } from './controller.mjs';
import { briefing } from './briefing.mjs';
const $ = id => document.getElementById(id), format = new Intl.NumberFormat().format;
const STATUS = { ready: 'Ready', running: 'Running', choosing: 'Choosing…', paused: 'Paused', stopped: 'Stopped', over: 'Game over', error: 'Error' };
const board = $('h-board'), tiles = Array.from({length:RULES.width*RULES.height},()=>{const tile=document.createElement('span');tile.className='h-cell';tile.setAttribute('aria-hidden','true');board.append(tile);return tile;});
let auto = false, loopToken = 0, timer = null, previousStatus = 'ready';
function announce(text) { $('h-announcement').textContent=text; }
function render(view) {
 const obs=view.observation, active=new Map((obs.active?.cells??[]).map(p=>[`${p.x},${p.y}`,obs.active.type]));
 for(let y=0;y<RULES.height;y++)for(let x=0;x<RULES.width;x++){
  const falling=active.get(`${x},${y}`),type=falling??obs.board[y][x];
  tiles[y*RULES.width+x].className=`h-cell${type?` filled piece-${type}`:''}${falling?' active':''}`;
 }
 board.setAttribute('aria-label',`${RULES.width} columns by ${RULES.height} rows. ${obs.board.flat().filter(Boolean).length} locked cells. ${obs.active?`Falling ${obs.active.type} piece.`:'No falling piece.'}`);
 $('h-status').textContent=STATUS[view.status];$('player-heading').textContent=view.player.name;
 for(const key of ['score','lines','level'])$('h-'+key).textContent=format(obs[key]);$('h-pieces').textContent=format(view.pieces);
 $('h-next').replaceChildren();obs.next.forEach((type,index)=>{
  const mini=document.createElement('div');mini.className=`h-mini piece-${type}`;mini.setAttribute('role','img');mini.setAttribute('aria-label',`Next ${index+1}: ${type}`);
  const occupied=new Set(GEOMETRY.find(g=>g.type===type).orientations[0].cells.map(p=>`${p.x},${p.y}`));
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){const dot=document.createElement('span');if(occupied.has(`${x},${y}`))dot.className='filled';mini.append(dot);} $('h-next').append(mini);
 });
 const terminal=view.status==='over';$('h-start').textContent=['paused','stopped'].includes(view.status)?'Resume':'Start';$('h-start').disabled=auto||view.busy||terminal;$('h-step').disabled=auto||view.busy||terminal;
 $('h-pause').disabled=!auto&&!view.busy;$('h-stop').disabled=view.status==='ready'||view.status==='stopped'||terminal;$('h-provider').disabled=auto||view.busy;
 $('h-error').hidden=!view.error;$('h-error').textContent=view.error??'';
 if(view.lastDecision){const c=view.lastDecision.candidate;$('h-choice').textContent=`${c.piece} · ${c.cells.map(p=>`(${p.x}, ${p.y})`).join(' ')} · ${Math.round(view.lastDecision.latencyMs)} ms`;$('h-details').textContent=JSON.stringify({orientation:c.orientation,path:c.path,clearedRows:c.clearedRows,scoreDelta:c.scoreDelta,features:c.features},null,2);}else{$('h-choice').textContent='No piece selected yet.';$('h-details').textContent='Run or step to inspect a choice.';}
 if(['over','error'].includes(view.status)&&previousStatus!==view.status){auto=false;loopToken++;clearTimeout(timer);announce(`${STATUS[view.status]}. ${view.error??`${format(view.pieces)} pieces, ${format(obs.lines)} lines.`}`);}previousStatus=view.status;
}
const controller=new Controller({sessionId:'harness',onChange:render});
async function runLoop(token){if(!auto||token!==loopToken)return;await controller.step({continueRunning:true});if(auto&&token===loopToken&&controller.view.status==='running')timer=setTimeout(()=>runLoop(token),150);}
function pause(){auto=false;loopToken++;clearTimeout(timer);controller.pause();announce('Paused. Step once or Start to continue.');}
$('h-start').addEventListener('click',()=>{auto=true;const token=++loopToken;controller.start();announce('Running local computer play.');runLoop(token);});
$('h-pause').addEventListener('click',pause);
$('h-step').addEventListener('click',async()=>{await controller.step();if(controller.view.status==='paused')announce('One piece placed. Paused.');});
$('h-stop').addEventListener('click',()=>{auto=false;loopToken++;clearTimeout(timer);controller.stop();announce('Stopped. Board retained. Start continues; Reset begins again.');});
$('h-reset').addEventListener('click',()=>{auto=false;loopToken++;clearTimeout(timer);controller.reset();announce('Reset. Ready to begin the same sequence.');});
$('h-provider').addEventListener('change',()=>{controller.setProvider($('h-provider').value==='local'?heuristic():mockProvider({mode:$('h-provider').value}));render(controller.view);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(auto||controller.view.busy))pause();});
const list=document.createElement('ol');list.className='h-rules-list';briefing().instructions.forEach(text=>{const li=document.createElement('li');li.textContent=text;list.append(li);});$('h-rules').append(list);
const examples=document.createElement('pre');examples.textContent=JSON.stringify(briefing().examples,null,2);$('h-rules').append(examples);render(controller.view);
