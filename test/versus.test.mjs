import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HumanVersus, VERSUS_LIMITS } from '../public/versus.mjs';
import { heuristic, mockProvider } from '../public/controller.mjs';
import { createGame, start, move, rotate, softDrop, hardDrop, tick, DEFAULT_SEED } from '../public/engine.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let n = 0; n < 200; n++) { if (fn()) return; await pause(5); } throw new Error('Versus state did not settle.'); }
function controlled() {
  const jobs = [], local = heuristic();
  return { jobs, factory: () => ({ ...local, name: 'Controlled local test', kind: 'mock',
    decide: packet => new Promise(resolve => jobs.push({ packet, release: async () => resolve(await local.decide(packet)) })) }) };
}
const publicGame = o => ({ board:o.board, active:o.active && {type:o.active.type,rotation:o.active.rotation,x:o.active.x,y:o.active.y}, next:o.next,
  score:o.score,lines:o.lines,level:o.level,status:o.status,gravityElapsedMs:o.gravityElapsedMs });

test('configuration is bounded and refuses remote/live providers', () => {
  for(const options of [{pieceCap:0},{pieceCap:1001},{paceMs:149},{paceMs:1001},{pieceCap:1.5}])assert.throws(()=>new HumanVersus(options),/Bounded/);
  assert.throws(()=>new HumanVersus({providerFactory:()=>({...heuristic(),kind:'live'})}),/Only local/);
});

test('human clock/actions keep advancing during actual delayed AI Choosing and match the accepted pure engine', async () => {
  const control=controlled(), c=new HumanVersus({providerFactory:control.factory});c.start();await until(()=>control.jobs.length===1);
  assert.equal(c.view.lanes[1].status,'choosing');const aiBefore=c.view.lanes[1].observation;
  let expected=start(createGame(DEFAULT_SEED));
  for(let n=0;n<4;n++){c.tick(200);expected=tick(expected,200);}
  assert.equal(c.view.lanes[0].observation.active.y,1);
  for(const[action,fn]of [['left',s=>move(s,-1)],['rotate',rotate],['down',softDrop],['drop',hardDrop]]){c.input(action);expected=fn(expected);}
  const human=c.view.lanes[0].observation;
  assert.deepEqual(publicGame(human),{board:expected.board,active:expected.active,next:expected.queue.slice(0,5),score:expected.score,lines:expected.lines,level:expected.level,status:expected.status,gravityElapsedMs:expected.gravityElapsed});
  assert.equal(c.view.lanes[0].pieces,1);assert.deepEqual(c.view.lanes[1].observation,aiBefore);assert.equal(c.view.lanes[1].pieces,0);
  await control.jobs[0].release();await until(()=>c.view.lanes[1].pieces===1);
  assert.deepEqual(c.view.lanes[0].observation,human);assert.equal(c.view.state,'running');c.dispose();
});

test('Step algorithm advances exactly one AI decision and keeps human state/time unchanged', async () => {
  const c=new HumanVersus();const ready=c.view.lanes[0];await c.stepAlgorithm();
  assert.deepEqual(c.view.lanes[0],ready);assert.equal(c.view.lanes[1].pieces,1);assert.equal(c.view.state,'paused');
  c.tick(250);assert.deepEqual(c.view.lanes[0],ready);
  c.start();c.tick(250);c.input('left');c.pause();const paused=c.view.lanes[0];const n=c.view.lanes[1].pieces;
  await c.stepAlgorithm();assert.deepEqual(c.view.lanes[0],paused);assert.equal(c.view.lanes[1].pieces,n+1);c.dispose();
});

test('shared pause/stop freeze both; Resume continues and Reset reproduces with fresh identities', async () => {
  const c=new HumanVersus();c.start();c.input('rotate');c.input('drop');c.pause();
  const board=c.view.lanes[0].observation.board, id=c.view.lanes[0].observation.sessionId;
  c.tick(250);c.input('drop');assert.deepEqual(c.view.lanes[0].observation.board,board);
  c.stop();assert.deepEqual(c.view.lanes[0].observation.board,board);assert.equal(c.view.lanes[0].status,'stopped');
  c.start();c.input('drop');assert.equal(c.view.lanes[0].pieces,2);
  c.reset();assert.equal(c.view.state,'ready');assert(c.view.lanes.every(l=>l.pieces===0));assert.notEqual(c.view.lanes[0].observation.sessionId,id);
  c.start();c.input('rotate');c.input('drop');assert.deepEqual(c.view.lanes[0].observation.board,board);c.dispose();
});

test('human game over retains its board while independent AI continues', async () => {
  const c=new HumanVersus({paceMs:150});c.start();let n=0;
  while(!c.view.lanes[0].outcome&&n++<100)c.input('drop');
  assert.equal(c.view.lanes[0].status,'over');assert.equal(c.view.lanes[0].outcome.censored,false);
  const human=c.view.lanes[0].observation;await until(()=>c.view.lanes[1].pieces>=2);
  assert.deepEqual(c.view.lanes[0].observation,human);assert.equal(c.view.state,'running');c.dispose();
});

test('algorithm cap/error retains its board while human controls continue without fallback', async () => {
  const c=new HumanVersus({pieceCap:2,paceMs:150});c.start();await until(()=>c.view.lanes[1].status==='capped');
  const ai=c.view.lanes[1];c.input('left');for(let n=0;n<4;n++)c.tick(200);
  assert.equal(c.view.lanes[0].observation.active.y,1);assert.deepEqual(c.view.lanes[1],ai);assert.equal(c.view.state,'running');c.dispose();
  const e=new HumanVersus({providerFactory:()=>mockProvider({mode:'error',delayMs:0})});e.start();await until(()=>e.view.lanes[1].status==='error');
  e.input('drop');assert.equal(e.view.lanes[0].pieces,1);assert.equal(e.view.lanes[1].pieces,0);assert.match(e.view.lanes[1].error,/Deliberate/);e.stop();assert.equal(e.view.lanes[1].status,'error');e.dispose();
});

test('Pause/Stop/Reset fence old ignored-abort AI replies even immediately followed by a new Step', async () => {
  for(const action of ['pause','stop','reset']) {
    const control=controlled(),c=new HumanVersus({providerFactory:control.factory});c.start();await until(()=>control.jobs.length===1);
    c[action]();const human=c.view.lanes[0].observation,humanPieces=c.view.lanes[0].pieces;const step=c.stepAlgorithm();await until(()=>control.jobs.length===2);
    await control.jobs[0].release();await pause(0);assert.equal(c.view.lanes[1].pieces,0,action);assert.deepEqual(c.view.lanes[0].observation,human);assert.equal(c.view.lanes[0].pieces,humanPieces);
    await control.jobs[1].release();await step;assert.equal(c.view.lanes[1].pieces,1,action);assert.deepEqual(c.view.lanes[0].observation,human);assert.equal(c.view.lanes[0].pieces,humanPieces);c.dispose();
  }
});

test('overlapping Step/Start cannot turn a pending one-piece step into autoplay/human gravity', async () => {
  const control=controlled(),c=new HumanVersus({providerFactory:control.factory});const first=c.stepAlgorithm();await until(()=>control.jobs.length===1);
  await c.stepAlgorithm();c.start();c.tick(250);assert.equal(control.jobs.length,1);assert.equal(c.view.lanes[0].status,'ready');assert.equal(c.view.state,'paused');
  await control.jobs[0].release();await first;assert.equal(c.view.lanes[1].pieces,1);assert.equal(c.view.state,'paused');c.dispose();
});

test('saved replay has no new AI decisions/human writes and exports immutable redacted provenance', async () => {
  let choices=0;const local=heuristic();const c=new HumanVersus({providerFactory:()=>({...local,async decide(p){choices++;return local.decide(p);}})});
  c.start();c.input('left');c.input('rotate');c.input('drop');await until(()=>c.view.lanes[1].pieces===1);c.pause();
  const before=c.exportRun(),expected=choices,record=JSON.parse(before);
  assert.equal(record.policies[0].kind,'human');assert.equal(record.policies[0].weights,undefined);assert.equal(record.policies[1].weights.holes,-5);
  const scan=v=>{if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){assert(!/^(seed|rng|queue|apikey|authorization|token|password|secret)$/i.test(k),k);scan(x);}};scan(record);
  c.replay();c.pause();const first=c.view.lanes;c.input('drop');c.tick(250);assert.deepEqual(c.view.lanes,first);
  while(c.view.replayIndex+1<c.view.frameCount)await c.stepAlgorithm();
  assert.equal(choices,expected);assert.equal(c.exportRun(),before);assert(c.view.lanes.every(l=>l.status==='replay'));assert(Object.isFrozen(c.view.lanes[0]));c.dispose();
});

test('recording capacity stops honestly within frame/export bounds and cancels pending work', async () => {
  const control=controlled(),c=new HumanVersus({providerFactory:control.factory});c.start();
  for(let n=0;n<5000&&!c.view.archiveError;n++)c.input(n%2?'left':'right');
  assert.match(c.view.archiveError,/capacity/);assert.equal(c.view.state,'stopped');assert.equal(c.view.busy,false);
  const record=JSON.parse(c.exportRun());assert.equal(record.archiveIncomplete,true);assert(record.frames.length<=VERSUS_LIMITS.frames);
  assert(new TextEncoder().encode(c.exportRun()).length<=VERSUS_LIMITS.exportBytes);c.reset();assert.equal(c.view.archiveError,null);assert.equal(c.view.frameCount,0);c.dispose();
});

test('all four modes retain direct navigation and current page indication', async () => {
  const pages=[['index.html','/'],['harness.html','/harness.html'],['comparison.html','/comparison.html'],['versus.html','/versus.html']];
  for(const[file,current]of pages){const html=await readFile(new URL('../public/'+file,import.meta.url),'utf8');
    const nav=html.match(/<nav class="mode-nav"[^>]*>(.*?)<\/nav>/s)?.[1];assert(nav,file);
    for(const[,url]of pages)assert(nav.includes(`href="${url}"`),`${file}: ${url}`);
    assert(nav.includes(`href="${current}" aria-current="page"`));assert.equal((nav.match(/aria-current/g)??[]).length,1);assert(html.includes('/modes.css'));}
});
