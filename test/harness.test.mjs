import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, start, hardDrop, RULES } from '../public/engine.mjs';
import { observe, geometry, GEOMETRY } from '../public/harness.mjs';
const empty = () => Array.from({ length: 20 }, () => Array(10).fill(null));
test('five previews cross bag boundaries without changing the accepted ordinal sequence', () => {
  let state = start(createGame(876)); const types = [];
  const accepted = 'JOTSLZIILZJTSOTZIOSJLJZLIOTSTJISOLZOIJSZLTZLJSTIOILOTSJZ';
  for (let n = 0; n < accepted.length; n++) {
    types.push(state.active.type);
    const before = JSON.stringify(state), obs = observe(state, { sessionId: 'sequence', revision: n });
    assert.equal(obs.next.length, 5);
    let future = structuredClone(state); const actualFuture = [];
    for (let k = 0; k < 5; k++) { future = hardDrop({ ...future, board: empty() }); actualFuture.push(future.active.type); }
    assert.deepEqual(obs.next, actualFuture); assert.equal(JSON.stringify(state), before);
    state = hardDrop({ ...state, board: empty() });
  }
  assert.equal(types.join(''), accepted);
});
test('observation is immutable, versioned and excludes all private randomizer state', () => {
  const state = start(createGame(999)); state.board[17][2] = 'J'; state.board[19][2] = 'L';
  const obs = observe(state, { sessionId: 'privacy', revision: 5 });
  assert.equal(obs.hiddenRows, 0); assert.equal(obs.schemaVersion, 1); assert.equal(obs.rulesVersion, RULES.version);
  assert.equal(obs.revision, 5); assert.equal(obs.board[18][2], null); assert.equal(obs.board[19][2], 'L');
  for (const key of ['seed', 'rng', 'queue', 'nextType']) assert.equal(key in obs, false);
  assert.equal(obs.next.length, 5); assert.equal(obs.capabilities.hold, false);
  const roundtrip = JSON.parse(JSON.stringify(obs)); assert.deepEqual(roundtrip, obs);
  assert.throws(() => { obs.board[0][0] = 'I'; });
  state.board[17][2] = 'S'; assert.equal(obs.board[17][2], 'J');
  assert.throws(() => observe(state, { sessionId: 'x', revision: -1 }));
  assert.throws(() => observe(state, { sessionId: 'x', revision: 1, previewLimit: 6 }));
});
test('all seven matrix geometries retain four engine orientations, exact offsets and normalized bounds', () => {
  assert.equal(GEOMETRY.length, 7);
  for (const type of RULES.types) for (const turn of geometry(type).orientations) {
    assert.equal(turn.cells.length, 4); assert.equal(new Set(turn.cells.map(p => `${p.x},${p.y}`)).size, 4);
    assert.equal(Math.min(...turn.normalized.map(p => p.x)), 0);
    assert.equal(Math.min(...turn.normalized.map(p => p.y)), 0);
    assert.equal(Math.max(...turn.normalized.map(p => p.x)) + 1, turn.bounds.width);
    assert.equal(Math.max(...turn.normalized.map(p => p.y)) + 1, turn.bounds.height);
  }
  assert.deepEqual(geometry('I').orientations[0].bounds, { minX: 0, minY: 1, width: 4, height: 1 });
  assert.deepEqual(geometry('T').orientations[0].normalized, [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}]);
  assert.throws(() => geometry('unknown'));
});

// Independent small reference: geometry + direct collision/rotation graph, no engine reducers.
function referencePlacements(state) {
  const orientations = geometry(state.active.type).orientations;
  const occupied = p => orientations[p.rotation].cells.map(c => ({x:c.x+p.x,y:c.y+p.y}));
  const fits = p => occupied(p).every(c => c.x>=0&&c.x<10&&c.y>=0&&c.y<20&&!state.board[c.y][c.x]);
  const key = p => `${p.rotation}/${p.x}/${p.y}`, result = new Set(), seen = new Set(), pending=[state.active];
  while(pending.length) {
    const p=pending.pop(); if(seen.has(key(p)))continue; seen.add(key(p));
    let final=p; while(fits({...final,y:final.y+1}))final={...final,y:final.y+1};
    result.add(occupied(final).map(c=>`${c.x},${c.y}`).sort().join(';'));
    const next=[{...p,x:p.x-1},{...p,x:p.x+1},{...p,y:p.y+1}];
    for(const dx of [0,-1,1,-2,2]) {const q={...p,rotation:(p.rotation+1)%4,x:p.x+dx};if(fits(q)){next.push(q);break;}}
    for(const q of next)if(fits(q)&&!seen.has(key(q)))pending.push(q);
  }
  return result;
}
const binding = {sessionId:'routes',revision:0};
const positions = list => new Set(list.map(c=>c.cells.map(p=>`${p.x},${p.y}`).sort().join(';')));
test('enumeration matches independent exhaustive collision graph and every offered route executes', async () => {
  const {enumerate,execute}=await import('../public/harness.mjs');
  for(const type of ['O','T','I']) {
    const state={...start(createGame()),active:{type,rotation:0,x:type==='O'?4:3,y:0}};
    state.board[19][0]='J';state.board[18][0]='J';state.board[19][8]='L';
    const before=structuredClone(state), candidates=enumerate(state,binding);
    assert.deepEqual(positions(candidates),referencePlacements(state));assert(candidates.length>1);
    for(const c of candidates){const after=execute(state,c,binding);assert.equal(after.board.flat().filter(Boolean).length,before.board.flat().filter(Boolean).length+4);}
    assert.deepEqual(state,before);
  }
});
test('a fitting sealed cavity is unreachable while a supported under-overhang slide is reachable', async () => {
  const {enumerate}=await import('../public/harness.mjs');
  const state={...start(createGame()),active:{type:'O',rotation:0,x:4,y:0}};
  state.board[10]=Array(10).fill('J');
  assert(!enumerate(state,binding).some(c=>c.cells.some(p=>p.y>10)));
  state.board=empty();state.board[17][5]='J';
  const cs=enumerate(state,binding);
  assert(cs.some(c=>c.x===5&&c.y===18)); // descend beside the block and slide underneath
  assert.deepEqual(positions(cs),referencePlacements(state));
});
test('reachability fails explicitly on exhausted bound and rejects forged, stale and mutated-state candidates', async () => {
  const {enumerate,execute}=await import('../public/harness.mjs');const state=start(createGame());
  assert.throws(()=>enumerate(state,binding,{maxPoses:1}),/limit/);
  assert.throws(()=>enumerate(state,binding,{maxTransitions:1}),/limit/);
  const c=enumerate(state,binding)[0];assert.throws(()=>execute(state,structuredClone(c),binding),/Unknown/);
  assert.throws(()=>execute(state,c,{...binding,revision:1}),/stale/);
  assert.throws(()=>execute({...state,score:1},c,binding),/state-mismatched/);
});
test('legal placement which blocks the following spawn is a terminal candidate, not an illegal action', async () => {
  const {enumerate,execute}=await import('../public/harness.mjs');
  const state={...start(createGame()),active:{type:'O',rotation:0,x:0,y:18},board:empty(),queue:['T','I','O','J','L','S'],nextType:'T'};
  state.board[0][4]='J';const c=enumerate(state,binding).find(c=>c.x===0&&c.y===18);
  assert(c);assert.equal(c.terminalReason,'blocked spawn');assert.equal(execute(state,c,binding).status,'over');
});
