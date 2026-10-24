// Offline, Node-only Choice protocol fixtures. No transport, credentials or network defaults.
import { createHash } from 'node:crypto';
import { ProviderError } from './providers.mjs';
import { freeze, VERSIONS } from './public/harness.mjs';
import { BRIEF_VERSION, validateChoice } from './public/briefing.mjs';
const fail = code => { throw new ProviderError(code); };
const size = value => Buffer.byteLength(JSON.stringify(value));
const definitions = freeze({
  decisions: { provider: 'OpenAI Decisions', model: 'gpt-6-luna', endpoint: 'https://api.openai.com/v1/decisions', documentedMaxCandidates: 255,
    confidenceMeaning: 'Provider Choice confidence, separate from its option distribution; not a win probability or calibrated game value.' },
  jev: { provider: 'TypeSafe Jev', model: 'jev-latest', endpoint: 'https://api.typesafe.ai/v1/systemone', documentedMaxCandidates: 255,
    confidenceMeaning: 'Provider distribution-concentration confidence; not a win probability or calibrated game value.' }
});
export function choiceCapabilities(protocol) {
  if (typeof protocol !== 'string' || !Object.hasOwn(definitions, protocol)) fail('configuration');
  const d = definitions[protocol];
  return freeze({ ...d, discovery: 'official documentation and offline fixtures; no authenticated model discovery',
    liveAvailability: 'unknown', resolvedModel: null, fixtureMaxCandidates: 255, maxInputBytes: 1048576,
    reasoningEffort: 'not configured: unsupported by this Choice request contract', serviceTier: 'not configured: unsupported by this Choice request contract' });
}
function packetCheck(packet, config) {
  if (packet?.schemaVersion !== VERSIONS.decision || packet.rulesBrief?.version !== BRIEF_VERSION ||
      !Number.isInteger(packet.deadlineMs) || packet.deadlineMs < 1 || !packet.candidates?.length ||
      packet.candidates.length > config.maxCandidates || size(packet) > config.maxInputBytes ||
      new Set(packet.candidates.map(c => c.id)).size !== packet.candidates.length) fail('input');
}
function requestFor(protocol, packet, config) {
  const ids = packet.candidates.map(c => c.id), instructions = 'Choose one legal placement ID using the complete rules, objective and consequences in the supplied public packet.';
  return freeze({ method: 'POST', url: definitions[protocol].endpoint, body: protocol === 'decisions' ? {
    model: config.model, input: JSON.stringify(packet), questions: [{ type: 'choice', name: 'placement', instructions,
      choices: ids.map(value => ({ value, description: 'Legal placement; exact path and consequences are in the input packet.' })) }]
  } : { model: config.model, state: packet, questions: { placement: { type: 'choice', instructions,
    criteria: Object.fromEntries(packet.candidates.map(c => [c.id, c])) } } } });
}
function compatible(protocol, model) {
  return typeof model === 'string' && (protocol === 'decisions' ? /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model) : /^(?:jev-latest|jev-\d+\.\d+\.\d+)$/.test(model));
}
function parse(protocol, result, packet) {
  if (!Number.isInteger(result?.status)) fail('transport_ambiguous');
  if ([401, 403].includes(result.status)) fail('authentication');
  if (result.status === 404) fail('unavailable'); if (result.status === 429) fail('rate_limit');
  if (result.status >= 500) fail('transport_ambiguous'); if (result.status !== 200) fail('provider_error');
  const body = result.body; if (size(body) > 65536) fail('size');
  if (body?.model !== undefined && !compatible(protocol, body.model)) fail('model_mismatch');
  let answer;
  if (protocol === 'decisions') {
    if (!Array.isArray(body?.answers) || body.answers.length !== 1 || body.answers[0].name !== 'placement') fail('schema');
    answer = body.answers[0];
  } else {
    if (!body?.answers || Array.isArray(body.answers) || Object.keys(body.answers).length !== 1 || !Object.hasOwn(body.answers, 'placement')) fail('schema');
    answer = body.answers.placement;
  }
  if (answer.type === 'refusal') fail('refusal');
  if (answer.type !== 'choice' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) fail('schema');
  let distribution;
  if (protocol === 'decisions') {
    if (!Array.isArray(answer.probabilities)) fail('schema');
    distribution = answer.probabilities.map(p => ({ id: p.value, probability: p.probability }));
  } else {
    if (!answer.probabilities || typeof answer.probabilities !== 'object' || Array.isArray(answer.probabilities)) fail('schema');
    distribution = Object.entries(answer.probabilities).map(([id, probability]) => ({ id, probability }));
  }
  const ids = packet.candidates.map(c => c.id);
  if (distribution.length !== ids.length || new Set(distribution.map(p => p.id)).size !== ids.length ||
      distribution.some(p => !ids.includes(p.id) || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) ||
      Math.abs(distribution.reduce((sum, p) => sum + p.probability, 0) - 1) > 1e-6 || !ids.includes(answer.choice) ||
      distribution.find(p => p.id === answer.choice).probability < Math.max(...distribution.map(p => p.probability))) fail('schema');
  return { choice: { requestId: packet.requestId, stateRevision: packet.stateRevision, selectedCandidateId: answer.choice }, distribution, confidence: answer.confidence };
}
export function createChoiceAdapter({ protocol, config: overrides = {}, transport, live = false } = {}) {
  if (live !== false) fail('live_disabled');
  const capabilities = choiceCapabilities(protocol), definition = definitions[protocol];
  const config = { model: definition.model, maxCandidates: 255, maxInputBytes: 1048576, timeoutMs: 1500, retryLimit: 0, spendCapUSD: 0, ...overrides };
  if (Object.keys(config).some(k => !['model', 'maxCandidates', 'maxInputBytes', 'timeoutMs', 'retryLimit', 'spendCapUSD'].includes(k)) ||
      config.model !== definition.model || !Number.isInteger(config.maxCandidates) || config.maxCandidates < 1 || config.maxCandidates > 255 ||
      !Number.isInteger(config.maxInputBytes) || config.maxInputBytes < 1 || config.maxInputBytes > 1048576 ||
      !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 60000 || config.retryLimit !== 0) fail('configuration');
  if (config.spendCapUSD !== 0) fail('budget');
  if (transport !== undefined && (typeof transport !== 'function' || transport.mode !== 'fixture')) fail('configuration');
  freeze(config);
  const metadata = freeze({ ...capabilities, configuration: config, protocolVersion: `${protocol}-choice-1`, instructionVersion: BRIEF_VERSION,
    decisionVersion: VERSIONS.decision, mode: 'offline-fixture', liveEnabled: false, availability: transport ? 'fixture-only' : 'unconfigured',
    assistance: 'canonical-afterstates-v1; complete offered set, no pruning or cross-batch ranking', actualCostUSD: null });
  let active = null, serial = 0, receiptSerial = 0, receipt = null;
  return Object.freeze({ name: `${definition.provider} (offline fixture)`, kind: 'mock', version: `${protocol}-choice-1`,
    capabilities: freeze({ maxCandidates: config.maxCandidates, movementMode: 'reachable-paused-gravity-v1', assistance: 'canonical-afterstates-v1' }),
    get runMetadata() { return metadata; }, get lastReceipt() { return receipt; },
    async decide(packet, { signal } = {}) {
      if (active) fail('configuration');
      const job = { serial: ++serial }; active = job;
      const abort = new AbortController(), started = performance.now();
      let timer, listener, response, parsed, code, attempts = 0, deadline = Infinity;
      try {
        packetCheck(packet, config); if (signal?.aborted) fail('cancelled');
        deadline = started + Math.min(config.timeoutMs, packet.deadlineMs);
        const current = () => {
          if (abort.signal.aborted || signal?.aborted) fail('cancelled');
          if (performance.now() >= deadline) fail('timeout');
        };
        current();
        let decoded;
        if (packet.candidates.length === 1) {
          decoded = { choice: { requestId: packet.requestId, stateRevision: packet.stateRevision, selectedCandidateId: packet.candidates[0].id }, distribution: null, confidence: null };
        } else {
          if (!transport) fail('unavailable');
          const request = requestFor(protocol, packet, config);
          const guard = new Promise((_, reject) => {
            listener = () => { if (active === job) active = null; abort.abort(); reject(new ProviderError('cancelled')); };
            signal?.addEventListener('abort', listener, { once: true });
            timer = setTimeout(() => { if (active === job) active = null; abort.abort(); reject(new ProviderError('timeout')); }, Math.max(0, deadline - performance.now()));
          });
          try { response = await Promise.race([Promise.resolve().then(() => { current(); attempts++; return transport(request, { signal: abort.signal }); }), guard]); }
          catch (error) { if (error instanceof ProviderError) throw error; fail('transport_ambiguous'); }
          current();
          decoded = parse(protocol, response, packet);
        }
        validateChoice(packet, decoded.choice); current(); parsed = decoded; return freeze(parsed.choice);
      } catch (error) { code = error instanceof ProviderError ? error.code : 'schema'; throw new ProviderError(code); }
      finally {
        clearTimeout(timer); signal?.removeEventListener('abort', listener); abort.abort(); if (active === job) active = null;
        let responseSha256 = null;
        try { if (response?.body && size(response.body) <= 65536) responseSha256 = createHash('sha256').update(JSON.stringify(response.body)).digest('hex'); } catch { /* No raw body is retained. */ }
        const usage = {}; for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) if (Number.isSafeInteger(response?.body?.usage?.[key]) && response.body.usage[key] >= 0) usage[key] = response.body.usage[key];
        let finished = freeze({ metadata, requestId: typeof packet?.requestId === 'string' ? packet.requestId : null, attempts,
          outcome: code ? 'provider-error' : attempts ? 'selected' : 'single-legal-candidate; no provider decision', errorCode: code ?? null,
          latencyMs: performance.now() - started, selectedCandidateId: parsed?.choice.selectedCandidateId ?? null,
          choiceDistribution: parsed?.distribution ?? null, confidence: parsed?.confidence ?? null, confidenceMeaning: definition.confidenceMeaning,
          reportedModel: compatible(protocol, response?.body?.model) ? response.body.model : null,
          reportedModelStatus: response?.body?.model === undefined ? 'not reported' : compatible(protocol, response.body.model) ? 'compatible reported identity; live unverified' : 'incompatible; rejected',
          usage: Object.keys(usage).length ? usage : null, usageProvenance: 'fixture response, not actual API usage', actualCostUSD: null,
          responseSha256, rawResponseArtifactRef: /^fixture:[A-Za-z0-9_./#-]{1,200}$/.test(response?.artifactRef ?? '') ? response.artifactRef : null, rawResponseRetained: false });
        const finalCode = !code && (signal?.aborted ? 'cancelled' : performance.now() >= deadline ? 'timeout' : null);
        finished = freeze({ ...finished, latencyMs: performance.now() - started, ...(finalCode ? { outcome: 'provider-error', errorCode: finalCode, selectedCandidateId: null, choiceDistribution: null, confidence: null } : {}) });
        if (job.serial >= receiptSerial) { receipt = finished; receiptSerial = job.serial; }
        if (finalCode) throw new ProviderError(finalCode);
      }
    } });
}
