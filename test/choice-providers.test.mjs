import test from 'node:test';
import assert from 'node:assert/strict';
import { createChoiceAdapter, choiceCapabilities } from '../choice-providers.mjs';
import { createAstraAdapter } from '../providers.mjs';
import { Controller } from '../public/controller.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
const fixture = fn => Object.assign(fn, { mode: 'fixture' });
function packetOf(request, protocol) { return protocol === 'decisions' ? JSON.parse(request.body.input) : request.body.state; }
function success(request, protocol, alter = x => x) {
  const packet = packetOf(request, protocol), ids = packet.candidates.map(c => c.id), choice = ids.at(-1);
  const probabilities = protocol === 'decisions' ? ids.map(value => ({ value, probability: value === choice ? 1 : 0 })) : Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0]));
  const answer = alter({ type: 'choice', ...(protocol === 'decisions' ? { name: 'placement' } : {}), choice, probabilities, confidence: .8 });
  return { status: 200, artifactRef: 'fixture:test/choice-providers.test.mjs#success', body: { model: protocol === 'decisions' ? 'gpt-6-luna' : 'jev-1.14.0',
    answers: protocol === 'decisions' ? [answer] : { placement: answer }, usage: { input_tokens: 100, output_tokens: 5 } } };
}
for (const protocol of ['decisions', 'jev']) {
  test(`${protocol}: blocking fixture respects minimum adapter/packet deadline and never commits`,async()=>{
    let packet;const capture=createChoiceAdapter({protocol,transport:fixture(r=>{packet=packetOf(r,protocol);return success(r,protocol);})});await new Controller({provider:capture}).step();
    for(const packetCap of [false,true]){
      let calls=0,signal;const adapter=createChoiceAdapter({protocol,config:{timeoutMs:packetCap?1000:1},transport:fixture((r,ctx)=>{calls++;signal=ctx.signal;const until=performance.now()+20;while(performance.now()<until){}return success(r,protocol);})});
      if(packetCap)await assert.rejects(adapter.decide({...packet,deadlineMs:1}),e=>e.code==='timeout');
      else{const c=new Controller({provider:adapter,deadlineMs:1000});await c.step();assert.equal(c.view.pieces,0);assert.equal(c.view.status,'error');}
      assert.equal(adapter.lastReceipt.errorCode,'timeout');assert.equal(adapter.lastReceipt.selectedCandidateId,null);assert.equal(adapter.lastReceipt.attempts,calls);assert(calls<=1);if(signal)assert(signal.aborted);
    }
  });
  test(`${protocol}: response parsing cannot overrun the deadline and retain a selection`,async()=>{
    const adapter=createChoiceAdapter({protocol,config:{timeoutMs:10},transport:fixture(r=>{const result=success(r,protocol),answers=result.body.answers;Object.defineProperty(result.body,'answers',{enumerable:true,get(){const until=performance.now()+20;while(performance.now()<until){}return answers;}});return result;})});
    const c=new Controller({provider:adapter,deadlineMs:1000});await c.step();assert.equal(c.view.pieces,0);assert.equal(adapter.lastReceipt.errorCode,'timeout');assert.equal(adapter.lastReceipt.selectedCandidateId,null);
  });
  test(`${protocol}: receipt extraction past deadline cannot return a selected choice`,async()=>{
    const adapter=createChoiceAdapter({protocol,config:{timeoutMs:10},transport:fixture(r=>{const result=success(r,protocol);Object.defineProperty(result,'artifactRef',{get(){const until=performance.now()+20;while(performance.now()<until){}return 'fixture:test/choice';}});return result;})});
    const c=new Controller({provider:adapter,deadlineMs:1000});await c.step();assert.equal(c.view.pieces,0);assert.equal(adapter.lastReceipt.errorCode,'timeout');assert.equal(adapter.lastReceipt.selectedCandidateId,null);assert.equal(adapter.lastReceipt.choiceDistribution,null);
  });
  test(`${protocol}: independently selectable full semantic packet and complete labeled distribution`, async () => {
    let request;
    const adapter = createChoiceAdapter({ protocol, transport: fixture(async r => { request = r; return success(r, protocol); }) });
    const controller = new Controller({ provider: adapter }); await controller.step();
    assert.equal(controller.view.pieces, 1); assert.equal(controller.view.status, 'paused');
    const packet = packetOf(request, protocol), ids = packet.candidates.map(c => c.id);
    assert.equal(packet.observation.next.length, 5); assert.equal(packet.candidates[0].afterstate.next.length, 4);
    assert.equal(adapter.lastReceipt.selectedCandidateId, ids.at(-1));
    assert.equal(adapter.lastReceipt.choiceDistribution.length, ids.length); assert.equal(adapter.lastReceipt.confidence, .8);
    assert.match(adapter.lastReceipt.confidenceMeaning, /not a win probability/);
    assert.equal(adapter.lastReceipt.actualCostUSD, null); assert.match(adapter.lastReceipt.usageProvenance, /fixture/);
    assert.equal(adapter.runMetadata.liveAvailability, 'unknown'); assert.equal(adapter.runMetadata.resolvedModel, null);
    assert.equal(adapter.runMetadata.configuration.retryLimit, 0); assert.equal(adapter.runMetadata.liveEnabled, false);
    if (protocol === 'decisions') {
      assert.equal(request.url, 'https://api.openai.com/v1/decisions'); assert.equal(request.body.model, 'gpt-6-luna');
      assert.deepEqual(request.body.questions[0].choices.map(c => c.value), ids);
    } else {
      assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone'); assert.equal(request.body.model, 'jev-latest');
      assert.deepEqual(Object.values(request.body.questions.placement.criteria), packet.candidates);
      assert.equal(adapter.runMetadata.documentedMaxCandidates, 255); assert.equal(adapter.runMetadata.fixtureMaxCandidates, 255);
    }
    assert(Object.isFrozen(adapter.lastReceipt));
  });
  test(`${protocol}: invalid, duplicate, incomplete and nonfinite distributions never execute`, async () => {
    const alterations = [a => ({ ...a, choice: 'invented' }), a => ({ ...a, confidence: 1.1 }), a => ({ ...a, confidence: NaN }),
      a => ({ ...a, type: 'refusal' }),
      a => ({ ...a, probabilities: protocol === 'decisions' ? a.probabilities.slice(1) : Object.fromEntries(Object.entries(a.probabilities).slice(1)) }),
      a => ({ ...a, probabilities: protocol === 'decisions' ? a.probabilities.map(p => ({ ...p, probability: .5 })) : Object.fromEntries(Object.keys(a.probabilities).map(id => [id, .5])) }),
      a => ({ ...a, probabilities: protocol === 'decisions' ? [...a.probabilities.slice(1), a.probabilities[1]] : { ...a.probabilities, unknown: 0 } })];
    for (const alter of alterations) {
      const adapter = createChoiceAdapter({ protocol, transport: fixture(async r => success(r, protocol, alter)) });
      const controller = new Controller({ provider: adapter }); await controller.step();
      assert.equal(controller.view.pieces, 0); assert.equal(controller.view.status, 'error'); assert.equal(adapter.lastReceipt.attempts, 1);
    }
  });
  test(`${protocol}: explicit model, limits, single option, disabled default and no credential input`, async () => {
    assert.throws(() => createChoiceAdapter({ protocol, live: true }), e => e.code === 'live_disabled');
    for (const config of [{ model: 'other' }, { maxCandidates: 256 }, { maxInputBytes: 1048577 }, { retryLimit: 1 }, { apiKey: 'secret-sentinel' }]) {
      assert.throws(() => createChoiceAdapter({ protocol, config }), e => e.code === 'configuration');
    }
    assert.throws(() => createChoiceAdapter({ protocol, config: { spendCapUSD: 1 } }), e => e.code === 'budget');
    const unavailable = createChoiceAdapter({ protocol }); const c = new Controller({ provider: unavailable }); await c.step();
    assert.equal(unavailable.lastReceipt.errorCode, 'unavailable'); assert.equal(unavailable.lastReceipt.attempts, 0);
    let packet; const capture = createChoiceAdapter({ protocol, transport: fixture(async r => { packet = packetOf(r, protocol); return success(r, protocol); }) });
    await new Controller({ provider: capture }).step();
    let calls = 0; const adapter = createChoiceAdapter({ protocol, transport: fixture(async () => { calls++; }) });
    const one = { ...packet, candidates: packet.candidates.slice(0, 1) };
    const selected = await adapter.decide(one); assert.equal(selected.selectedCandidateId, one.candidates[0].id);
    assert.equal(adapter.lastReceipt.attempts, 0); assert.equal(adapter.lastReceipt.confidence, null); assert.match(adapter.lastReceipt.outcome, /no provider decision/);
    const many = { ...packet, candidates: Array.from({ length: 256 }, (_, i) => ({ ...packet.candidates[0], id: `candidate-${i}` })) };
    await assert.rejects(adapter.decide(many), e => e.code === 'input'); assert.equal(calls, 0);
    await assert.rejects(adapter.decide({ ...packet, padding: 'x'.repeat(1048576) }), e => e.code === 'input'); assert.equal(calls, 0);
    for (const model of ['other-model', null, 4]) {
      const bad = createChoiceAdapter({ protocol, transport: fixture(async r => { const result = success(r, protocol); result.body.model = model; return result; }) });
      const d = new Controller({ provider: bad }); await d.step(); assert.equal(d.view.pieces, 0); assert.equal(bad.lastReceipt.errorCode, 'model_mismatch');
    }
  });
  test(`${protocol}: Reset then immediate Step, late ownership, deadline and sanitized errors`, async () => {
    let calls = 0, late;
    const adapter = createChoiceAdapter({ protocol, transport: fixture(r => { calls++; if (calls === 1) return new Promise(resolve => { late = () => resolve(success(r, protocol)); }); return success(r, protocol); }) });
    const c = new Controller({ provider: adapter }); const old = c.step(); await delay(0); c.reset(); const fresh = c.step(); await Promise.all([old, fresh]);
    assert.equal(c.view.pieces, 1); const receipt = adapter.lastReceipt; late(); await delay(0); assert.equal(c.view.pieces, 1); assert.equal(adapter.lastReceipt, receipt);
    await c.step(); assert.equal(c.view.pieces, 2);
    let aborted = false;
    const hung = createChoiceAdapter({ protocol, config: { timeoutMs: 5 }, transport: fixture((r, { signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); }) });
    const d = new Controller({ provider: hung }); await d.step(); assert.equal(d.view.pieces, 0); assert.equal(hung.lastReceipt.errorCode, 'timeout'); assert(aborted);
    for (const [status, code] of [[401, 'authentication'], [404, 'unavailable'], [429, 'rate_limit'], [503, 'transport_ambiguous']]) {
      const bad = createChoiceAdapter({ protocol, transport: fixture(async () => ({ status, body: { message: 'secret-sentinel' } })) });
      const e = new Controller({ provider: bad }); await e.step(); assert.equal(bad.lastReceipt.errorCode, code); assert.equal(e.view.pieces, 0);
      assert(!JSON.stringify({ view: e.view, receipt: bad.lastReceipt }).includes('secret-sentinel'));
    }
  });
}
test('Astra, Decisions and Jev receive identical semantic evidence; none gets extra preview or search', async () => {
  let astra, decisions, jev;
  const providers = [createAstraAdapter({ transport: fixture(async r => { astra = JSON.parse(r.body.input[0].content[0].text); throw new Error('fixture stop'); }) }),
    createChoiceAdapter({ protocol: 'decisions', transport: fixture(async r => { decisions = packetOf(r, 'decisions'); return success(r, 'decisions'); }) }),
    createChoiceAdapter({ protocol: 'jev', transport: fixture(async r => { jev = packetOf(r, 'jev'); return success(r, 'jev'); }) })];
  for (const provider of providers) await new Controller({ seed: 42, sessionId: 'same-evidence', provider }).step();
  assert.deepEqual(astra, decisions); assert.deepEqual(decisions, jev);
  assert.equal(choiceCapabilities('decisions').documentedMaxCandidates, 255);
  assert.throws(() => choiceCapabilities('other'), e => e.code === 'configuration');
});
test('both exported factories reject inherited protocol names and nonstring coercion before dispatch', () => {
  let calls = 0;
  const transport = fixture(() => { calls++; throw new Error('must not dispatch'); });
  for (const protocol of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf', '', null, undefined, 1, {}, ['jev'], new String('jev')]) {
    assert.throws(() => choiceCapabilities(protocol), e => e.code === 'configuration');
    assert.throws(() => createChoiceAdapter({ protocol, transport }), e => e.code === 'configuration');
  }
  assert.equal(calls, 0);
  assert.equal(choiceCapabilities('jev').documentedMaxCandidates, 255);
  assert.equal(choiceCapabilities('jev').liveAvailability, 'unknown');
});
