import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraAdapter, ASTRA_CONFIG, ProviderError } from '../providers.mjs';
import { Controller } from '../public/controller.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = fn => Object.assign(fn, { mode: 'fixture' });
function success(request, alter = x => x) {
  const packet = JSON.parse(request.body.input[0].content[0].text);
  const choice = alter({ requestId: packet.requestId, stateRevision: packet.stateRevision, selectedCandidateId: packet.candidates[0].id });
  return { status: 200, artifactRef: 'fixture:test/providers.test.mjs#success', body: { status: 'completed', model: 'gpt-6-astra', service_tier: 'default',
    usage: { input_tokens: 120, output_tokens: 18, total_tokens: 138, secret: 'omit-me' },
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(choice) }] }] } };
}
test('Astra fixture constructs explicit stateless strict request and commits only a current offered candidate', async () => {
  let sent;
  const adapter = createAstraAdapter({ transport: fixture(async request => { sent = request; return success(request); }) });
  const controller = new Controller({ provider: adapter, sessionId: 'astra-contract' });
  await controller.step();
  assert.equal(controller.view.pieces, 1); assert.equal(controller.view.status, 'paused');
  assert.equal(sent.url, 'https://api.openai.com/v1/responses'); assert.equal(sent.method, 'POST');
  assert.equal(sent.body.model, 'gpt-6-astra'); assert.deepEqual(sent.body.reasoning, { effort: 'medium' });
  assert.equal(sent.body.service_tier, 'default'); assert.equal(sent.body.store, false); assert.equal(sent.body.truncation, 'disabled');
  assert.equal(sent.body.text.format.strict, true); assert.equal(sent.body.text.format.schema.additionalProperties, false);
  assert(!JSON.stringify(sent.body.text.format.schema).includes('"const"'));
  const packet = JSON.parse(sent.body.input[0].content[0].text);
  assert.equal(packet.observation.next.length, 5); assert.equal(packet.candidates[0].afterstate.next.length, 4);
  assert.deepEqual(sent.body.text.format.schema.properties.selectedCandidateId.enum, packet.candidates.map(c => c.id));
  assert.deepEqual(sent.body.text.format.schema.properties.requestId.enum, [packet.requestId]);
  const receipt = adapter.lastReceipt;
  assert.equal(receipt.outcome, 'selected'); assert.equal(receipt.attempts, 1); assert.equal(receipt.responseSha256.length, 64);
  assert.equal(receipt.rawResponseArtifactRef, 'fixture:test/providers.test.mjs#success'); assert.equal(receipt.rawResponseRetained, false);
  assert.deepEqual(receipt.usage, { input_tokens: 120, output_tokens: 18, total_tokens: 138 });
  assert.equal(receipt.actualCostUSD, null); assert.match(receipt.usageProvenance, /fixture/); assert(Object.isFrozen(receipt));
  assert.equal(adapter.runMetadata.availability, 'fixture-only'); assert.equal(adapter.runMetadata.resolvedModel, null);
  assert.equal(adapter.runMetadata.configuration.retryLimit, 0); assert.equal(adapter.runMetadata.configuration.spendCapUSD, 0);
  for (const forbidden of ['"seed"', '"rng"', '"queue"', '"apiKey"', '"authorization"', 'omit-me']) {
    assert(!JSON.stringify({ sent, receipt }).includes(forbidden), forbidden);
  }
});
test('default-off, unavailable and unsupported configuration fail without transport/network/credentials', async () => {
  let network = 0; const original = globalThis.fetch;
  globalThis.fetch = () => { network++; throw new Error('must not call'); };
  try {
    const adapter = createAstraAdapter(); const c = new Controller({ provider: adapter }); await c.step();
    assert.equal(c.view.pieces, 0); assert.equal(adapter.lastReceipt.errorCode, 'unavailable'); assert.equal(adapter.lastReceipt.attempts, 0);
    assert.equal(adapter.runMetadata.availability, 'unconfigured');
    assert.throws(() => createAstraAdapter({ live: true }), e => e.code === 'live_disabled');
    for (const change of [{ model: 'other' }, { reasoningEffort: 'ultra' }, { serviceTier: 'auto' }, { retryLimit: 1 }, { maxOutputTokens: 0 }, { timeoutMs: 0 }, { apiKey: 'secret-sentinel' }]) {
      assert.throws(() => createAstraAdapter({ config: { ...ASTRA_CONFIG, ...change } }), e => e.code === 'configuration');
    }
    assert.throws(() => createAstraAdapter({ config: { ...ASTRA_CONFIG, spendCapUSD: 1 } }), e => e.code === 'budget');
    assert.throws(() => createAstraAdapter({ transport: async () => {} }), e => e.code === 'configuration');
    assert.equal(network, 0);
  } finally { globalThis.fetch = original; }
});
test('HTTP, refusal, incomplete and malformed outputs are distinct provider failures, never game loss or retries', async () => {
  const cases = [[401, 'authentication'], [403, 'authentication'], [404, 'unavailable'], [429, 'rate_limit'], [500, 'transport_ambiguous'], [400, 'provider_error']];
  for (const [status, code] of cases) {
    let calls = 0; const a = createAstraAdapter({ transport: fixture(async () => { calls++; return { status, body: { message: 'secret-sentinel' } }; }) });
    const c = new Controller({ provider: a }); await c.step();
    assert.equal(a.lastReceipt.errorCode, code); assert.equal(calls, 1); assert.equal(c.view.status, 'error'); assert.equal(c.view.pieces, 0);
    assert(!JSON.stringify({ view: c.view, receipt: a.lastReceipt }).includes('secret-sentinel'));
  }
  for (const [body, code] of [
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'incomplete'],
    [{ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'secret-sentinel' }] }] }, 'refusal'],
    [{ status: 'completed', output: [] }, 'schema'], [{ status: 'queued' }, 'schema'],
    [{ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'invalid' }] }] }, 'schema'],
    [{ status: 'completed', junk: 'x'.repeat(65536) }, 'size']]) {
    const a = createAstraAdapter({ transport: fixture(async () => ({ status: 200, body })) }); const c = new Controller({ provider: a }); await c.step();
    assert.equal(a.lastReceipt.errorCode, code); assert.equal(c.view.pieces, 0); assert.equal(c.view.status, 'error');
    assert(!JSON.stringify(a.lastReceipt).includes('secret-sentinel'));
  }
});
test('stale identities, unknown choices and extra fields cannot commit; returned transport text is sanitized', async () => {
  for (const alter of [x => ({ ...x, requestId: 'old' }), x => ({ ...x, stateRevision: -1 }), x => ({ ...x, selectedCandidateId: 'invented' }), x => ({ ...x, rationale: 'extra' })]) {
    const a = createAstraAdapter({ transport: fixture(async r => success(r, alter)) }); const c = new Controller({ provider: a }); await c.step();
    assert.equal(c.view.pieces, 0); assert.equal(a.lastReceipt.errorCode, 'schema');
  }
  const a = createAstraAdapter({ transport: fixture(async () => { throw new Error('secret-sentinel'); }) });
  const c = new Controller({ provider: a }); await c.step(); assert.equal(a.lastReceipt.errorCode, 'transport_ambiguous');
  assert(!JSON.stringify({ view: c.view, receipt: a.lastReceipt }).includes('secret-sentinel'));
});
test('deadline and cancellation suppress delayed transport completion with no late controller mutation', async () => {
  let release, seenSignal;
  const a = createAstraAdapter({ config: { ...ASTRA_CONFIG, timeoutMs: 10 }, transport: fixture((r, { signal }) => { seenSignal = signal; return new Promise(resolve => { release = () => resolve(success(r)); }); }) });
  const c = new Controller({ provider: a, deadlineMs: 1000 }); await c.step();
  assert.equal(a.lastReceipt.errorCode, 'timeout'); assert.equal(a.lastReceipt.attempts, 1); assert(seenSignal.aborted);
  release(); await delay(0); assert.equal(c.view.pieces, 0);
  let late; const b = createAstraAdapter({ transport: fixture(r => new Promise(resolve => { late = () => resolve(success(r)); })) });
  const d = new Controller({ provider: b }); const pending = d.step(); await delay(0); d.reset(); await pending; await delay(0);
  assert.equal(b.lastReceipt.errorCode, 'cancelled'); assert.equal(b.lastReceipt.attempts, 1);
  late(); await delay(0); assert.equal(d.view.pieces, 0); assert.equal(d.view.status, 'ready');
});
test('invalid/oversize packets and already-aborted signals fail before fixture dispatch', async () => {
  let captured; const probe = new Controller({ provider: createAstraAdapter({ transport: fixture(async r => { captured = JSON.parse(r.body.input[0].content[0].text); return success(r); }) }) }); await probe.step();
  let calls = 0; const a = createAstraAdapter({ transport: fixture(async () => { calls++; }) });
  await assert.rejects(a.decide({ ...captured, schemaVersion: 'unsupported' }), e => e instanceof ProviderError && e.code === 'input');
  await assert.rejects(a.decide({ ...captured, padding: 'x'.repeat(1048576) }), e => e.code === 'input');
  const abort = new AbortController(); abort.abort(); await assert.rejects(a.decide(captured, { signal: abort.signal }), e => e.code === 'cancelled');
  assert.equal(calls, 0); assert.equal(a.lastReceipt.attempts, 0);
});
test('Reset immediately followed by Step releases only the cancelled job and ignores its late result', async () => {
  let late, calls = 0;
  const adapter = createAstraAdapter({ transport: fixture(r => {
    calls++;
    if (calls === 1) return new Promise(resolve => { late = () => resolve(success(r)); });
    return Promise.resolve(success(r));
  }) });
  const controller = new Controller({ provider: adapter });
  const old = controller.step(); await delay(0);
  controller.reset(); const fresh = controller.step();
  await Promise.all([old, fresh]);
  assert.equal(calls, 2); assert.equal(controller.view.pieces, 1); assert.equal(controller.view.status, 'paused');
  const receipt = adapter.lastReceipt; assert.equal(receipt.outcome, 'selected'); assert.equal(receipt.requestId, controller.view.lastDecision.requestId);
  late(); await delay(0); assert.equal(controller.view.pieces, 1); assert.equal(adapter.lastReceipt, receipt);
  await controller.step(); assert.equal(controller.view.pieces, 2);
});
test('reported incompatible models cannot substitute; a reported dated Astra version is retained honestly', async () => {
  for (const model of ['unexpected-other-model', 'gpt-6-astra-secret-sentinel', 17]) {
    const adapter = createAstraAdapter({ transport: fixture(async r => { const result = success(r); result.body.model = model; return result; }) });
    const controller = new Controller({ provider: adapter }); await controller.step();
    assert.equal(controller.view.pieces, 0); assert.equal(adapter.lastReceipt.errorCode, 'model_mismatch');
    assert.equal(adapter.lastReceipt.reportedModelStatus, 'incompatible; rejected'); assert.equal(adapter.lastReceipt.reportedModel, null);
    assert(!JSON.stringify(adapter.lastReceipt).includes('secret-sentinel'));
  }
  const adapter = createAstraAdapter({ transport: fixture(async r => { const result = success(r); result.body.model = 'gpt-6-astra-2026-10-01'; return result; }) });
  const controller = new Controller({ provider: adapter }); await controller.step();
  assert.equal(controller.view.pieces, 1); assert.equal(adapter.lastReceipt.reportedModel, 'gpt-6-astra-2026-10-01');
  assert.equal(adapter.runMetadata.resolvedModel, null); assert.match(adapter.lastReceipt.reportedModelStatus, /live identity unverified/);
});
