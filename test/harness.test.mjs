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
