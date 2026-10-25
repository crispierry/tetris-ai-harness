import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, heuristic, mockProvider } from '../public/controller.mjs';
const pause = ms => new Promise(r=>setTimeout(r,ms));
test('single step commits one piece, pauses and resets reproducibly; stop retains inspectable board',async()=>{
 const c=new Controller({seed:876,sessionId:'test'});assert.equal(c.view.status,'ready');
 await c.step();const first=c.view;assert.equal(first.pieces,1);assert.equal(first.status,'paused');
 c.stop();assert.deepEqual(c.view.observation.board,first.observation.board);assert.equal(c.view.status,'stopped');
 c.start();await c.step();assert.equal(c.view.pieces,2);c.reset();assert.equal(c.view.pieces,0);assert.equal(c.view.status,'ready');
 await c.step();assert.deepEqual(c.view.observation.board,first.observation.board);assert.notEqual(c.view.observation.sessionId,first.observation.sessionId);
});
test('pause/reset/stop cancels pending decisions without late or duplicate execution',async()=>{
 for(const action of ['pause','reset','stop']) {
  const c=new Controller({provider:mockProvider({delayMs:30}),sessionId:action});const pending=c.step();
  assert.equal(c.view.status,'choosing');await assert.rejects(c.step(),/already/);
  c[action]();await pending;await pause(40);assert.equal(c.view.pieces,0);assert.equal(c.view.busy,false);
 }
 let release;const base=heuristic();const ignoring={...base,decide:p=>new Promise(resolve=>{release=async()=>resolve(await base.decide(p));})};
 const c=new Controller({provider:ignoring,deadlineMs:500});const old=c.step();await pause(0);c.reset();await old;await release();await pause(0);assert.equal(c.view.pieces,0);
});
test('hung, erroring, stale and invalid mocks stop honestly with no fallback or piece execution',async()=>{
 for(const mode of ['never','error','stale','invalid']) {
  const c=new Controller({provider:mockProvider({mode,delayMs:0}),deadlineMs:10});await c.step();
  assert.equal(c.view.status,'error');assert.equal(c.view.pieces,0);assert(c.view.error);assert.equal(c.view.busy,false);
 }
});
test('mock provider receives no private state or network credential and cannot mutate frozen packets',async()=>{
 const local=heuristic();let observed;
 const c=new Controller({provider:{...local,async decide(p){observed=p;assert(Object.isFrozen(p));assert(!JSON.stringify(p).includes('"rng"'));assert(!JSON.stringify(p).includes('"seed"'));return local.decide(p);}}});
 await c.step();assert.equal(c.view.pieces,1);assert.equal(observed.observation.next.length,5);assert.equal(observed.candidates[0].afterstate.next.length,4);
 assert.throws(()=>c.setProvider({...local,capabilities:{movementMode:'realtime'}}),/Unsupported/);
});
test('local heuristic completes a bounded natural whole game without credentials or network',async()=>{
 const c=new Controller({seed:2,sessionId:'whole'});let n=0;
 while(c.view.status!=='won'&&c.view.status!=='over'&&c.view.status!=='error'&&n++<3000)await c.step();
 assert.equal(c.view.status,'won',`expected Marathon completion, got ${c.view.status} after ${n}`);assert(c.view.pieces>1 && c.view.pieces<=1000);assert.equal(c.view.observation.terminalReason,'300-line target reached');assert(c.view.observation.lines>=300);assert.equal(c.view.observation.level,30);
});
test('effective heuristic policy is immutable and mock metadata identifies its actual fixture settings',()=>{
 const input={holes:-9},p=heuristic(input);input.holes=100;
 assert.equal(p.runMetadata.policy.weights.holes,-9);assert.equal(p.runMetadata.policy.weights.lines,8);
 assert.equal(p.runMetadata.policy.terminalPenalty,-1e9);assert.match(p.runMetadata.policy.tieBreak,/first offered/);
 assert(Object.isFrozen(p.runMetadata));assert(Object.isFrozen(p.runMetadata.policy));assert(Object.isFrozen(p.runMetadata.policy.weights));
 assert.throws(()=>{p.runMetadata.policy.weights.holes=3;},TypeError);
 const mock=mockProvider({mode:'error',delayMs:7});assert.equal(mock.runMetadata.mode,'offline-mock');assert.equal(mock.runMetadata.mockMode,'error');assert.equal(mock.runMetadata.delayMs,7);assert.equal(mock.runMetadata.liveEnabled,false);
});
