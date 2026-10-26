import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,start} from '../public/engine.mjs';
import {observe,enumerate,candidateEvidence} from '../public/harness.mjs';
import {instructionPacket} from '../public/briefing.mjs';
import {evaluateLookahead} from '../public/lookahead.mjs';
function packet(){const s=start(createGame()),b={sessionId:'full-scheduler',revision:1};return instructionPacket(observe(s,b),enumerate(s,b).map(c=>candidateEvidence(s,c,b)),{requestId:'full',deadlineMs:1500});}
test('full depth2 survives browser-like timer clamp with equivalent complete roots and closes every scheduler port',async t=>{
 const p=packet(),nativeTimeout=globalThis.setTimeout,NativeChannel=globalThis.MessageChannel;let opened=0,closed=0,zeroTimers=0;
 globalThis.MessageChannel=class extends NativeChannel{constructor(){super();opened+=2;for(const port of [this.port1,this.port2]){const close=port.close.bind(port);port.close=()=>{closed++;close();};}}};
 try{const a=await evaluateLookahead(p,{depth:2});assert(a.ok,JSON.stringify(a.error));globalThis.setTimeout=(fn,ms,...args)=>{if(ms===0)zeroTimers++;return nativeTimeout(fn,Math.max(4,ms),...args);};const b=await evaluateLookahead(p,{depth:2});assert(b.ok,JSON.stringify(b.error));assert.deepEqual(b.roots,a.roots);assert.equal(b.selectedRootId,a.selectedRootId);assert.equal(b.stats.rootsCompleted,p.candidates.length);assert.equal(b.stats.pruned,0);assert.equal(zeroTimers,0);assert.equal(closed,opened);t.diagnostic(`full depth2 ${b.stats.nodes} nodes/${b.stats.leavesEvaluated} leaves; clamp ${b.stats.elapsedMs.toFixed(1)} ms; ${closed} ports closed`);
  const cancel=new AbortController();cancel.abort();const c=await evaluateLookahead(p,{depth:2,signal:cancel.signal});assert.equal(c.error.code,'cancelled');const limit=await evaluateLookahead(p,{depth:2,nodeCap:1});assert.equal(limit.error.code,'budget');assert.equal(limit.selectedRootId,null);assert.equal(closed,opened);
 }finally{globalThis.setTimeout=nativeTimeout;globalThis.MessageChannel=NativeChannel;}
});
