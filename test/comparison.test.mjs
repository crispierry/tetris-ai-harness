import test from 'node:test';
import assert from 'node:assert/strict';
import { Comparison, validateConfig, DEFAULT_CONFIG, LIMITS } from '../public/comparison.mjs';
import { heuristic } from '../public/controller.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 300; n++) { if (fn()) return; await pause(10); } throw new Error('Comparison did not settle.'); }
const plain = config => new Comparison({ config: { left: 'local', right: 'local', ...config } });

test('all settings reject over-cap, fractional, unavailable and unknown inputs before decisions', () => {
  assert.deepEqual(validateConfig(), DEFAULT_CONFIG); assert(Object.isFrozen(validateConfig()));
  for (const [key, max] of [['samples',8],['pieceCap',1000],['paceMs',1000],['nodeCap',4000],['timeMs',1000]]) {
    for (const value of [0, max + 1, 1.5, Infinity, '2']) assert.throws(() => validateConfig({ [key]: value }), new RegExp(key));
  }
  assert.throws(() => validateConfig({ paceMs: 29 }), /paceMs/);
  for (const player of ['Astra','Decisions','Jev','__proto__']) assert.throws(() => validateConfig({ left: player }), /unavailable/);
  assert.throws(() => validateConfig({ seed: 123 }), /Unknown/); assert.throws(() => validateConfig(null), /object/);
  assert.equal(validateConfig({ samples:1, pieceCap:1000 }).samples * 2 * 1000, LIMITS.placements);
});

test('Step makes exactly one decision per eligible independent lane and settings lock until Reset', async () => {
  const identities = [], packets = [];
  const c = new Comparison({ config: { right:'local', pieceCap:2, samples:2 }, providerFactory: (key, config, identity) => {
    const base = heuristic(); identities.push(base);
    return { ...base, async decide(packet) { packets.push({ ...identity, next:[...packet.observation.next] }); return base.decide(packet); } };
  } });
  await c.step(); assert.deepEqual(c.view.lanes.map(l => l.pieces), [1,1]); assert.equal(c.view.state,'paused');
  assert.equal(c.view.locked,true); assert.notEqual(identities[0],identities[1]); assert.deepEqual(packets[0].next,packets[1].next);
  const firstBoard=c.view.lanes[0].observation.board;
  assert.throws(() => c.configure({right:'error'}), /locked/);
  await c.step(); assert.equal(c.view.summary.observedPairs,1); assert.equal(c.view.sample,1);
  assert(c.view.lanes.every(l => l.outcome.reason==='piece cap' && l.outcome.censored));
  await c.step(); assert.equal(c.view.sample,2); assert.deepEqual(c.view.lanes.map(l=>l.pieces),[1,1]); assert.equal(identities.length,4);
  await c.step(); assert.equal(c.view.state,'completed'); assert.equal(c.view.summary.observedPairs,2); assert.equal(c.view.summary.missingPairs,0);
  await c.step(); assert.equal(packets.length,8);
  c.stop(); assert(c.view.lanes.every(l=>l.status==='capped')); c.pause(); assert(c.view.lanes.every(l=>l.outcome));
  c.reset(); assert.equal(c.view.locked,false); await c.step(); assert.deepEqual(c.view.lanes[0].observation.board,firstBoard); c.dispose();
});

test('slow lane never paces its peer; sample replacement waits for both terminal outcomes', async () => {
  let release; const base=heuristic();
  const c=new Comparison({config:{right:'local',samples:2,pieceCap:2,paceMs:30},providerFactory:(key,config,{lane,sample})=>
    lane===0&&sample===1 ? {...base,decide:packet=>new Promise(resolve=>{release=async()=>resolve(await base.decide(packet));})} : heuristic()});
  c.start(); await until(()=>c.view.lanes[1].pieces===2);
  assert.equal(c.view.sample,1); assert.equal(c.view.lanes[0].pieces,0); assert.equal(c.view.lanes[1].status,'capped');
  await release(); await until(()=>c.view.lanes[0].pieces===1); await until(()=>typeof release==='function');
  // A new choice gets a fresh resolver; the peer's final board remains stable.
  const peer=c.view.lanes[1].observation.board; await pause(60); assert.deepEqual(c.view.lanes[1].observation.board,peer);
  await release(); await until(()=>c.view.sample===2); await until(()=>c.view.state==='completed');
  assert.equal(c.view.summary.observedPairs,2); c.dispose();
});

test('Pause, Stop, Reset and Replay fence late ignored-abort completions and old timers', async () => {
  for (const action of ['pause','stop','reset','replay']) {
    let release; const base=heuristic(); let delayed=false;
    const c=new Comparison({config:{right:'local',pieceCap:10,paceMs:30},providerFactory:()=>({...base,decide:packet=>
      delayed ? new Promise(resolve=>{release=async()=>resolve(await base.decide(packet));}) : base.decide(packet)})});
    await c.step(); delayed=true; c.start(); await until(()=>!!release); c[action]();
    if(action==='replay')c.pause();
    const before=JSON.stringify(c.view.lanes.map(l=>({board:l.observation.board,pieces:l.pieces}))); await release(); await pause(80);
    assert.equal(JSON.stringify(c.view.lanes.map(l=>({board:l.observation.board,pieces:l.pieces}))),before,action);
    assert.equal(c.view.auto,false); if(action==='reset')assert.equal(c.view.frameCount,0); c.dispose();
  }
});

test('error and bounded search exhaustion preserve lane boards and never silently fall back', async () => {
  const c=new Comparison({config:{left:'error',right:'local',pieceCap:2}});
  await c.step(); assert.equal(c.view.lanes[0].status,'error'); assert.equal(c.view.lanes[0].pieces,0); assert.match(c.view.lanes[0].error,/Deliberate/);
  const failedBoard=c.view.lanes[0].observation.board; c.pause(); c.stop(); await c.step();
  assert.equal(c.view.lanes[0].status,'error'); assert.deepEqual(c.view.lanes[0].observation.board,failedBoard); assert.equal(c.view.lanes[1].pieces,2);
  c.dispose();
  const search=new Comparison({config:{left:'look1',right:'local',nodeCap:1}}); await search.step();
  assert.equal(search.view.lanes[0].status,'error'); assert.equal(search.view.lanes[0].pieces,0); assert.equal(search.view.lanes[0].search.complete,false);
  assert.match(search.view.lanes[0].error,/No placement selected/); assert.equal(search.view.lanes[1].pieces,1); search.dispose();
});

test('saved visual replay makes no new decisions; exported own frames are immutable, bounded and redacted', async () => {
  let decisions=0; const base=heuristic();
  const c=new Comparison({config:{right:'local',pieceCap:2},providerFactory:()=>({...base,decide:p=>{decisions++;return base.decide(p);}})});
  await c.step(); await c.step(); const record=JSON.parse(c.exportRun()), expected=decisions;
  assert.equal(record.frames.length,6); assert.equal(record.policy.actualCostUSD,null); assert.match(record.policy.replay,/not canonical/);
  const scan=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert(!/^(seed|rng|queue|apikey|authorization|token|password|secret)$/i.test(key),key);scan(item);}};scan(record);
  assert(new TextEncoder().encode(c.exportRun()).length<=LIMITS.exportBytes); assert.equal(record.frames[0].observation.board[0],'..........');
  const changed=record.frames[2].pieces; record.frames[2].pieces=999; assert.equal(JSON.parse(c.exportRun()).frames[2].pieces,changed);
  c.replay(); c.pause(); while(c.view.replayIndex+1<c.view.frameCount)await c.step();
  assert.equal(decisions,expected); assert.equal(c.view.lanes[0].status,'replay'); assert.equal(c.view.lanes[0].pieces,2);
  assert.equal(c.view.lanes[0].recordedStatus,'capped'); assert(Object.isFrozen(c.view.lanes[0]));
  assert.equal(JSON.parse(c.exportRun()).frames.length,6); c.dispose();
});

test('automatic two-sample run ends at caps and a disposed session cannot wake timers', async () => {
  const c=plain({samples:2,pieceCap:2,paceMs:30}); c.start(); await until(()=>c.view.state==='completed');
  assert.deepEqual(c.view.summary.pairs.map(p=>[p.left.pieces,p.right.pieces]),[[2,2],[2,2]]);
  assert.equal(c.view.frameCount,12); const frames=c.view.frameCount; c.dispose(); await pause(80); assert.equal(c.view.frameCount,frames);
});

test('immutable saved policy identifies evaluator, all search limits and visible horizon in live/replay/export details', async () => {
  const c=new Comparison({config:{left:'look1',right:'look2',nodeCap:1,timeMs:1000}});await c.step();
  const record=JSON.parse(c.exportRun());assert.equal(record.policies.length,2);
  for(const entry of record.policies){const p=entry.policy;assert.equal(p.evaluator.version,'local-leaf-value-2');
    assert.equal(p.callCap,1);assert.equal(p.nodeCap,1);assert.equal(p.timeMs,1000);assert.equal(p.maxOutputBytes,2097152);
    assert.equal(p.discount,.9);assert.match(p.horizon,/at most one known next placement/);assert.match(p.tieOrder,/Original root/);
    assert.equal(p.evaluator.policy.weights.holes,-5);assert.equal(p.live,false);assert.equal(p.pruning,'none; every offered root and reachable child within caps');}
  assert.deepEqual(record.policies.map(p=>p.policy.depth),[1,2]);
  assert(record.frames.every(f=>record.policies.some(p=>p.id===f.policyId)));
  assert(Object.isFrozen(c.view.lanes[0].policy.evaluator.policy.weights));
  c.replay();c.pause();assert.equal(c.view.lanes[0].policy.evaluator.version,'local-leaf-value-2');c.dispose();
});
