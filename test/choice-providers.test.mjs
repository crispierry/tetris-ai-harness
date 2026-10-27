import test from 'node:test';
import assert from 'node:assert/strict';
import { createChoiceAdapter, choiceCapabilities } from '../choice-providers.mjs';
import { createAstraAdapter } from '../providers.mjs';
import { createGame, start, RULES, levelForLines } from '../public/engine.mjs';
import { observe, enumerate, candidateEvidence, execute, VERSIONS } from '../public/harness.mjs';
import { instructionPacket, semanticPacket, BRIEF_VERSION } from '../public/briefing.mjs';
import { Controller } from '../public/controller.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
const fixture = fn => Object.assign(fn, { mode: 'fixture' });
function makePacket(state = start(createGame(42)), binding = { sessionId: 'protocol-fixture', revision: 1 }) {
  return instructionPacket(observe(state, binding), enumerate(state, binding).map(c => candidateEvidence(state, c, binding)), { requestId: 'protocol-request', deadlineMs: 1000 });
}
function packetOf(request, protocol) { return protocol === 'decisions' ? JSON.parse(request.body.input) : request.body.state; }
function success(request, protocol, alter = x => x) {
  const packet = packetOf(request, protocol), ids = packet.candidates.map(c => c.id), choice = ids.at(-1);
  const probabilities = protocol === 'decisions' ? ids.map(value => ({ value, probability: value === choice ? 1 : 0 })) : Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0]));
  const answer = alter({ type: 'choice', ...(protocol === 'decisions' ? { name: 'placement' } : {}), choice, probabilities, confidence: .8 });
  return { status: 200, artifactRef: 'fixture:test/choice-providers.test.mjs#success', body: { model: protocol === 'decisions' ? 'gpt-6-luna' : 'jev-1.14.0',
    answers: protocol === 'decisions' ? [answer] : { placement: answer }, usage: { input_tokens: 100, output_tokens: 5 } } };
}
test('Decisions options expose distinct canonical consequences without replacing the model choice', async () => {
  const initial=start(createGame(42)),board=initial.board.map(row=>[...row]);
  board[19]=Array.from({length:10},(_,x)=>x===5?null:'J');
  const packet=makePacket({...initial,board,active:{type:'I',rotation:1,x:3,y:0}});
  const clear=packet.candidates.find(c=>c.linesDelta===1),stack=packet.candidates.find(c=>c.features.holes>0);
  assert(clear);assert(stack);
  let request;
  const adapter=createChoiceAdapter({protocol:'decisions',transport:fixture(async r=>{request=r;return success(r,'decisions');})});
  const choice=await adapter.decide(packet),question=request.body.questions[0],options=question.choices;
  assert.deepEqual(JSON.parse(request.body.input),semanticPacket(packet));
  assert.deepEqual(options.map(c=>c.value),packet.candidates.map(c=>c.id));
  assert.match(options.find(c=>c.value===clear.id).description,/lines cleared 1; holes 0/);
  assert.match(options.find(c=>c.value===stack.id).description,new RegExp(`holes ${stack.features.holes} `));
  assert.notEqual(options.find(c=>c.value===clear.id).description,options.find(c=>c.value===stack.id).description);
  assert.match(question.instructions,/survive long enough to clear 300 lines/);
  assert.match(question.instructions,/empty cells below occupied cells/);
  assert.match(question.instructions,/visible next five pieces/);
  assert.equal(choice.selectedCandidateId,packet.candidates.at(-1).id);
});
for (const protocol of ['decisions', 'jev']) {
  test(`${protocol}: blocking fixture respects minimum adapter/packet deadline and never commits`,async()=>{
    const packet=makePacket();
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
    const packet = makePacket();
    let calls = 0; const adapter = createChoiceAdapter({ protocol, transport: fixture(async () => { calls++; }) });
    const one = { ...packet, candidates: packet.candidates.slice(0, 1) };
    const selected = await adapter.decide(one); assert.equal(selected.selectedCandidateId, one.candidates[0].id);
    assert.equal(adapter.lastReceipt.attempts, 0); assert.equal(adapter.lastReceipt.confidence, null); assert.match(adapter.lastReceipt.outcome, /no provider decision/);
    const many = { ...packet, candidates: Array.from({ length: 256 }, (_, i) => ({ ...packet.candidates[0], id: `candidate-${i}` })) };
    await assert.rejects(adapter.decide(many), e => e.code === 'unsupported_candidates'); assert.equal(calls, 0);
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
  assert.deepEqual(semanticPacket(astra), decisions); assert.deepEqual(decisions, semanticPacket(jev));
  assert.equal(astra.responseInstructions, jev.responseInstructions);
  assert.deepEqual(astra.responseSchema, jev.responseSchema);
  assert.equal(decisions.responseInstructions, undefined); assert.equal(decisions.responseSchema, undefined);
  assert(!JSON.stringify(decisions).includes('selectedCandidateId'));
  assert.equal(decisions.schemaVersion, VERSIONS.decision); assert.equal(decisions.rulesBrief.version, BRIEF_VERSION);
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

test('Decisions native Choice keeps controller ownership local and executes the exact offered placement', async () => {
  const state = start(createGame(42)), binding = { sessionId: 'native-choice', revision: 7 };
  const packet = makePacket(state, binding), raw = enumerate(state, binding);
  let captured;
  const adapter = createChoiceAdapter({ protocol: 'decisions', transport: fixture(r => {
    captured = r;
    const result = success(r, 'decisions');
    // Even extra untrusted ownership claims cannot replace the controller's binding.
    Object.assign(result.body.answers[0], { requestId: 'foreign', stateRevision: -1, selectedCandidateId: 'foreign' });
    return result;
  }) });
  const selected = await adapter.decide(packet), candidate = raw.at(-1);
  assert.deepEqual(Object.keys(selected).sort(), ['requestId', 'selectedCandidateId', 'stateRevision']);
  assert.deepEqual(selected, { requestId: packet.requestId, stateRevision: binding.revision, selectedCandidateId: candidate.id });
  assert.equal(captured.method, 'POST');
  assert.deepEqual(Object.keys(captured.body).sort(), ['input', 'model', 'questions']);
  assert.equal(captured.body.questions.length, 1);
  assert.equal(captured.body.questions[0].type, 'choice'); assert.equal(captured.body.questions[0].name, 'placement');
  assert.match(captured.body.questions[0].instructions, /native placement Choice/);
  const input = JSON.parse(captured.body.input);
  assert.deepEqual(input, semanticPacket(packet));
  assert(!captured.body.input.includes('selectedCandidateId'));
  assert.deepEqual(input.candidates.map(c => [c.id, c.orientation, c.cells, c.path]), raw.map(c => [c.id, c.orientation, c.cells, c.path]));
  const after = execute(state, candidate, binding), evidence = packet.candidates.at(-1);
  assert.deepEqual(after.board, evidence.afterstate.board);
  assert.deepEqual(observe(after, { ...binding, revision: binding.revision + 1, previewLimit: 4 }), evidence.afterstate);
  assert.equal(adapter.version, 'decisions-choice-2');
});

test('Decisions counts actual UTF-8 request-body overhead and rejects one byte over before transport', async () => {
  const packet = makePacket(); let request;
  const capture = createChoiceAdapter({ protocol: 'decisions', transport: fixture(r => { request = r; return success(r, 'decisions'); }) });
  await capture.decide(packet);
  const packetBytes = Buffer.byteLength(JSON.stringify(packet)), requestBytes = Buffer.byteLength(JSON.stringify(request.body));
  assert(requestBytes > packetBytes, 'serialized string escaping and Choice options have real overhead');
  assert.equal(capture.lastReceipt.packetBytes, packetBytes); assert.equal(capture.lastReceipt.requestBodyBytes, requestBytes);
  let calls = 0;
  const bounded = cap => createChoiceAdapter({ protocol: 'decisions', config: { maxInputBytes: cap }, transport: fixture(r => { calls++; return success(r, 'decisions'); }) });
  const rejected = bounded(requestBytes - 1);
  await assert.rejects(rejected.decide(packet), e => e.code === 'input');
  assert.equal(calls, 0); assert.equal(rejected.lastReceipt.attempts, 0);
  await bounded(requestBytes).decide(packet); assert.equal(calls, 1);
  const unicode = { ...packet, padding: '水'.repeat(requestBytes) };
  await assert.rejects(bounded(requestBytes).decide(unicode), e => e.code === 'input'); assert.equal(calls, 1);
});

test('Decisions rejects missing or malformed native answers/models and oversized responses with no selection', async () => {
  const packet = makePacket();
  const mutations = [
    r => { delete r.body.model; },
    r => { r.body.answers = []; },
    r => { r.body.answers.push(r.body.answers[0]); },
    r => { r.body.answers[0].name = 'other'; },
    r => { r.body.answers[0].type = 'object'; },
    r => { r.body.answers[0].probabilities[0].probability = Infinity; },
    r => { r.body.answers[0].probabilities[0].value = 'unknown'; },
    r => { r.body.answers[0].choice = r.body.answers[0].probabilities[0].value; },
    r => { r.body.padding = 'x'.repeat(65536); },
  ];
  for (const mutate of mutations) {
    const adapter = createChoiceAdapter({ protocol: 'decisions', transport: fixture(r => { const result = success(r, 'decisions'); mutate(result); return result; }) });
    await assert.rejects(adapter.decide(packet));
    assert.equal(adapter.lastReceipt.attempts, 1); assert.equal(adapter.lastReceipt.selectedCandidateId, null);
    assert.equal(adapter.lastReceipt.choiceDistribution, null);
  }
  const legacyJev = createChoiceAdapter({ protocol: 'jev', transport: fixture(r => { const result = success(r, 'jev'); delete result.body.model; return result; }) });
  await legacyJev.decide(packet); assert.equal(legacyJev.lastReceipt.reportedModelStatus, 'not reported');
});

test('Decisions cross-bag turns expose only current next-five and immediate original-horizon afterstates', async () => {
  let state = start(createGame(42));
  const adapter = createChoiceAdapter({ protocol: 'decisions', transport: fixture(r => success(r, 'decisions')) });
  for (let turn = 0; turn < 8; turn++) {
    const binding = { sessionId: 'cross-bag', revision: turn }, packet = makePacket(state, binding);
    assert.deepEqual(packet.observation.next, state.queue.slice(0, 5));
    assert.equal(packet.observation.next.length, 5);
    assert(!/"(?:seed|rng|queue)":/.test(JSON.stringify(semanticPacket(packet))));
    for (const c of packet.candidates) assert.deepEqual(c.afterstate.next, packet.observation.next.slice(c.afterstate.status === 'won' ? 0 : 1));
    const chosen = await adapter.decide(packet), raw = enumerate(state, binding);
    state = execute(state, raw.find(c => c.id === chosen.selectedCandidateId), binding);
    assert.equal(state.status, 'playing');
  }
});

test('Decisions winning packet retains five previews and final scoring; terminal packets never dispatch', async () => {
  const state = start(createGame(2)); state.lines = 299; state.level = levelForLines(299); state.score = 1234;
  state.active = { type: 'I', rotation: 1, x: 3, y: 0 };
  for (let y = 16; y < 20; y++) state.board[y] = Array.from({ length: 10 }, (_, x) => x === 5 ? null : 'J');
  const binding = { sessionId: 'winning-native', revision: 9 }, packet = makePacket(state, binding);
  const winner = packet.candidates.find(c => c.afterstate.status === 'won'); assert(winner);
  let calls = 0;
  const adapter = createChoiceAdapter({ protocol: 'decisions', transport: fixture(r => {
    calls++; const input = packetOf(r, 'decisions');
    assert.equal(input.rulesBrief.rules.startLevel, 1); assert.equal(input.rulesBrief.rules.targetLines, 300); assert.equal(input.rulesBrief.rules.maxLevel, 30);
    const result = success(r, 'decisions'), answer = result.body.answers[0]; answer.choice = winner.id;
    answer.probabilities = input.candidates.map(c => ({ value: c.id, probability: c.id === winner.id ? 1 : 0 })); return result;
  }) });
  const selected = await adapter.decide(packet); assert.equal(selected.selectedCandidateId, winner.id);
  assert.equal(winner.afterstate.lines, 303); assert.equal(winner.scoreDelta, RULES.clearPoints[4] * 30);
  assert.equal(winner.afterstate.active, null); assert.deepEqual(winner.afterstate.next, packet.observation.next);
  const won = execute(state, enumerate(state, binding).find(c => c.id === selected.selectedCandidateId), binding);
  assert.throws(() => makePacket(won, { ...binding, revision: 10 }));
  await assert.rejects(adapter.decide({ ...packet, observation: observe(won, { ...binding, revision: 10 }) }), e => e.code === 'input');
  assert.equal(calls, 1);
});
