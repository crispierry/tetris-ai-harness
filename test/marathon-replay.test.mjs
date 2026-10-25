import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aggregatePairs, digest, preflight, recomputeRun, replayRun } from '../benchmark.mjs';
import { heuristic } from '../public/controller.mjs';
import * as historical from '../legacy/marathon-v2/benchmark.mjs';
const fixture = async () => JSON.parse(await readFile(new URL('./fixtures/marathon-v2-recording.json', import.meta.url), 'utf8'));

test('genuine baseline Marathon-v2 packets replay with original hashes and canonical transitions, without provider calls', async () => {
  const artifact = await fixture(), { artifactHash, ...content } = artifact;
  assert.equal(artifactHash, 'cb2deaf86c24b000819f0d7aad266aeb772705cc3e885cca17ab42ebee1e26a0');
  assert.equal(digest(content), artifactHash);
  assert.equal(artifact.manifest.sourceRevision, '0f994f1b8c3136577ff5ffce80d18e5b807bafcc');
  assert.equal(artifact.manifest.promptVersion, 'local-rules-brief-2');
  assert.equal(artifact.manifest.schemas.decision, 2);
  for (const run of artifact.runs) {
    const originalHashes = run.events.map(e => [e.packetHash, e.candidateDigest, e.observationBeforeHash, e.observationAfterHash]);
    const replay = await replayRun(artifact.manifest, run, 2);
    assert.equal(replay.verified, true); assert.equal(replay.providerCalls, 0);
    assert.deepEqual(replay.metrics, run.metrics); assert.deepEqual(recomputeRun(run, artifact.manifest), run.metrics);
    assert.deepEqual(run.events.map(e => [e.packetHash, e.candidateDigest, e.observationBeforeHash, e.observationAfterHash]), originalHashes);
  }
  assert.deepEqual(aggregatePairs(artifact.runs, artifact.manifest), artifact.aggregate);
  assert.equal(historical.runPaired, undefined); assert.equal(historical.preflight, undefined);
  const current = preflight({ runId: 'current-stays-current', sourceRevision: '2ca4278e7bf02d3517b538a473b3395f5e347dc2', maxPieces: 1 }, [{ create: () => heuristic() }, { create: () => heuristic() }], [2]);
  assert.equal(current.manifest.schemas.decision, 3); assert.equal(current.manifest.promptVersion, 'local-rules-brief-3');
});

test('historical Marathon-v2 dispatch rejects mixed schema/rules/brief/objective contracts', async () => {
  const artifact = await fixture(), manifest = artifact.manifest;
  for (const change of [
    { schemas: { ...manifest.schemas, decision: 3 } },
    { schemas: { ...manifest.schemas, observation: 1 } },
    { promptVersion: 'local-rules-brief-3' },
    { rulesVersion: 'local-classic-1' },
    { version: 'offline-benchmark-1' },
    { objective: 'endless score and survival' },
    { target: null },
  ]) {
    const mixed = { ...manifest, ...change };
    assert.throws(() => recomputeRun(artifact.runs[0], mixed));
    assert.throws(() => aggregatePairs(artifact.runs, mixed));
    await assert.rejects(replayRun(mixed, artifact.runs[0], 2));
  }
});

test('historical canonical replay rejects tampered packet/candidate/transition hashes, selected IDs, metrics and seed', async () => {
  const artifact = await fixture();
  for (const tamper of [
    r => { r.events[0].packetHash = '0'.repeat(64); },
    r => { r.events[0].candidateDigest = '0'.repeat(64); },
    r => { r.events[0].observationAfterHash = '0'.repeat(64); },
    r => { r.events[0].selectedCandidateId = 'invented'; },
    r => { r.events[0].observationAfter.board[19][0] = 'I'; },
    r => { r.metrics.score++; },
  ]) {
    const run = structuredClone(artifact.runs[0]); tamper(run);
    await assert.rejects(replayRun(artifact.manifest, run, 2));
  }
  await assert.rejects(replayRun(artifact.manifest, artifact.runs[0], 3));
});
