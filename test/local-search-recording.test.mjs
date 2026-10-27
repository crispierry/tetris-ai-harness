import test from 'node:test';
import assert from 'node:assert/strict';
import { Comparison,providerFor } from '../public/comparison.mjs';
import { HumanVersus } from '../public/versus.mjs';
import { createLookaheadProvider } from '../public/lookahead.mjs';
import { compactReceipt,localSearchReceipt } from '../public/provider-policy.mjs';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<1500;n++){if(predicate())return;await wait(5);}throw new Error('Recording regression did not settle.');}
function checkReceipt(receipt){assert.ok(receipt);assert.equal(receipt.errorCode,null);assert.ok(receipt.search.rootsCompleted>0);assert.match(receipt.provenance,/no live model calls/);assert.ok(Buffer.byteLength(JSON.stringify(receipt))<=4096);assert.equal(receipt.version,undefined);assert.throws(()=>compactReceipt(receipt),/Invalid compact receipt/);}
for(const depth of [1,2])for(const automatic of [false,true]) {
 test(`comparison successful look${depth} ${automatic?'automatic play':'Step'} retains committed frame/export/replay`,async()=>{
  const unhandled=[];const onUnhandled=e=>unhandled.push(e);process.on('unhandledRejection',onUnhandled);
  let calls=0;const c=new Comparison({config:{gravity:false,left:'local',right:depth===1?'look1':'look2',pieceCap:1,nodeCap:4000,timeMs:1000,paceMs:30},providerFactory:(key,config)=>{const provider=providerFor(key,config);return {...provider,get lastReceipt(){return provider.lastReceipt;},get lastSearch(){return provider.lastSearch;},async decide(...args){calls++;return provider.decide(...args);}};}});
  try {
   if(automatic){c.start();await until(()=>c.view.state==='completed');}else await c.step();
   assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]);assert.equal(c.view.state,'completed');
   const record=JSON.parse(c.exportRun());assert.equal(record.version,'offline-comparison-2');assert.equal(record.policy.liveProviders,false);
   const moves=record.frames.filter(f=>f.lane===1&&f.pieces===1);assert.equal(moves.length,1);checkReceipt(moves[0].decision.receipt);assert.equal(moves[0].search.ok,true);
   assert.deepEqual(moves[0].observation.board,c.view.lanes[1].observation.board.map(row=>row.map(cell=>cell??'.').join('')));
   const saved=c.exportRun(),callCount=calls;c.replay();c.pause();for(let n=0;n<record.frames.length;n++)await c.step();assert.equal(c.view.lanes[1].pieces,1);assert.equal(c.exportRun(),saved);assert.equal(calls,callCount);await wait(0);assert.deepEqual(unhandled,[]);
  } finally {c.dispose();process.off('unhandledRejection',onUnhandled);}
 });
 test(`versus successful look${depth} ${automatic?'automatic play':'Step'} retains committed frame/export/replay`,async()=>{
  const unhandled=[];const onUnhandled=e=>unhandled.push(e);process.on('unhandledRejection',onUnhandled);
  let calls=0;const c=new HumanVersus({pieceCap:1,paceMs:150,providerFactory:()=>{const provider=createLookaheadProvider({depth,nodeCap:4000,callCap:4000,timeMs:1000});return {...provider,get lastReceipt(){return provider.lastReceipt;},async decide(...args){calls++;return provider.decide(...args);}};}});
  try {
   if(automatic){c.start();await until(()=>!!c.view.lanes[1].outcome);c.pause();}else await c.stepAlgorithm();
   assert.equal(c.view.lanes[1].pieces,1);assert.equal(c.view.lanes[1].status,'capped');assert.equal(c.view.lanes[0].pieces,0);
   const record=JSON.parse(c.exportRun());assert.equal(record.version,'human-local-versus-2');assert.equal(record.provenance.liveProviders,false);
   const moves=record.frames.filter(f=>f.lane===1&&f.event==='outcome');assert.equal(moves.length,1);checkReceipt(moves[0].lastDecision.receipt);assert.equal(record.outcomes[1].pieces,1);
   const callCount=calls,frameCount=c.view.frameCount;c.replay();c.pause();for(let n=0;n<frameCount;n++)await c.stepAlgorithm();assert.equal(c.view.lanes[1].pieces,1);assert.equal(calls,callCount);assert.equal(c.view.frameCount,frameCount);await wait(0);assert.deepEqual(unhandled,[]);
  } finally {c.dispose();process.off('unhandledRejection',onUnhandled);}
 });
}
test('local search receipt retains only bounded local fields and rejects oversized or invalid stats',()=>{
 const receipt={requestId:'local:1',errorCode:null,search:{nodes:1,elapsedMs:1},usage:{private:'omitted'},actualCostUSD:99,provenance:'untrusted',extra:'omitted'};
 const saved=localSearchReceipt(receipt);assert.equal(saved.usage,null);assert.equal(saved.actualCostUSD,null);assert.equal(saved.extra,undefined);assert.match(saved.provenance,/Local\/mock/);assert.ok(Object.isFrozen(saved.search));
 assert.throws(()=>localSearchReceipt({...receipt,search:{nodes:Infinity}}));assert.throws(()=>localSearchReceipt({...receipt,requestId:'x'.repeat(5000)}));
});
