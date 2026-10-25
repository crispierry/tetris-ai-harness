// Offline, Node-only Choice protocol fixtures. No transport, credentials or network defaults.
import { createHash } from 'node:crypto';
import { ProviderError } from './providers.mjs';
import { freeze, VERSIONS } from './public/harness.mjs';
import { BRIEF_VERSION, validatePacket, validateChoice, semanticPacket } from './public/briefing.mjs';
import { fail, choiceCapabilities, packetCheck, requestFor, compatible, parse } from './choice-protocol.mjs';
export { choiceCapabilities } from './choice-protocol.mjs';
const size = value => Buffer.byteLength(JSON.stringify(value));
const definitions = { decisions: choiceCapabilities('decisions'), jev: choiceCapabilities('jev') };
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
  const metadata = freeze({ ...capabilities, configuration: config, protocolVersion: `${protocol}-choice-${protocol === 'decisions' ? 2 : 1}`, instructionVersion: BRIEF_VERSION,
    decisionVersion: VERSIONS.decision, mode: 'offline-fixture', liveEnabled: false, availability: transport ? 'fixture-only' : 'unconfigured',
    assistance: 'canonical-afterstates-v1; complete offered set, no pruning or cross-batch ranking', actualCostUSD: null });
  let active = null, serial = 0, receiptSerial = 0, receipt = null;
  return Object.freeze({ name: `${definition.provider} (offline fixture)`, kind: 'mock', version: `${protocol}-choice-${protocol === 'decisions' ? 2 : 1}`,
    capabilities: freeze({ maxCandidates: config.maxCandidates, movementMode: 'reachable-paused-gravity-v1', assistance: 'canonical-afterstates-v1' }),
    get runMetadata() { return metadata; }, get lastReceipt() { return receipt; },
    async decide(packet, { signal } = {}) {
      if (active) fail('configuration');
      const job = { serial: ++serial }; active = job;
      const abort = new AbortController(), started = performance.now();
      let timer, listener, response, parsed, code, requestBodyBytes = null, packetBytes = null, attempts = 0, deadline = Infinity;
      try {
        packetCheck(packet, config); packetBytes = size(packet); if (signal?.aborted) fail('cancelled');
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
          const request = requestFor(protocol, packet, config);
          requestBodyBytes = size(request.body);
          if (requestBodyBytes > config.maxInputBytes) fail('input');
          if (!transport) fail('unavailable');
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
        let finished = freeze({ metadata, packetBytes, requestBodyBytes, requestId: typeof packet?.requestId === 'string' ? packet.requestId : null, attempts,
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
