// Node-only offline protocol boundary. No credentials, fetch, environment reads or default transport.
import { createHash } from 'node:crypto';
import { validateChoice, BRIEF_VERSION } from './public/briefing.mjs';
import { freeze, VERSIONS } from './public/harness.mjs';

export const ASTRA_CONFIG = freeze({ model: 'gpt-6-astra', reasoningEffort: 'medium', serviceTier: 'default',
  maxOutputTokens: 1024, timeoutMs: 1500, retryLimit: 0, spendCapUSD: 0 });
const messages = Object.freeze({ configuration: 'Unsupported adapter configuration.', unavailable: 'Offline fixture transport is unavailable.',
  live_disabled: 'Live provider operation is disabled.', input: 'Invalid or oversized public decision packet.',
  authentication: 'Provider authentication failed.', rate_limit: 'Provider rate limit reached.', transport_ambiguous: 'Transport outcome is unknown; no retry was made.',
  provider_error: 'Provider request failed.', refusal: 'Provider refused the decision.', incomplete: 'Provider response is incomplete.',
  schema: 'Provider response is invalid, stale or not an offered candidate.', size: 'Provider response exceeds the bounded size.',
  timeout: 'Adapter decision deadline exceeded.', cancelled: 'Adapter decision was cancelled.', budget: 'Offline adapter permits no spending.' });
export class ProviderError extends Error {
  constructor(code) { super(messages[code] ?? messages.provider_error); this.name = 'ProviderError'; this.code = code; }
}
const fail = code => { throw new ProviderError(code); };
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
function configuration(input) {
  const c = { ...input };
  if (Object.keys(c).some(k => !Object.hasOwn(ASTRA_CONFIG, k)) || Object.keys(ASTRA_CONFIG).some(k => !Object.hasOwn(c, k)) ||
      c.model !== 'gpt-6-astra' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(c.reasoningEffort) || c.serviceTier !== 'default' ||
      !Number.isInteger(c.maxOutputTokens) || c.maxOutputTokens < 1 || c.maxOutputTokens > 128000 ||
      !Number.isInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > 60000 || c.retryLimit !== 0) fail('configuration');
  if (c.spendCapUSD !== 0) fail('budget');
  return freeze(c);
}
function requestFor(packet, config) {
  try {
    if (packet.schemaVersion !== VERSIONS.decision || packet.rulesBrief?.version !== BRIEF_VERSION || !packet.candidates?.length ||
        packet.candidates.length > 800 || !Number.isInteger(packet.deadlineMs) || packet.deadlineMs < 1 || bytes(packet) > 1048576) fail('input');
    // The documented strict subset supports enum; do not forward the controller's JSON Schema const keywords.
    const schema = { type: 'object', additionalProperties: false, properties: {
      requestId: { type: 'string', enum: [packet.requestId] }, stateRevision: { type: 'integer', enum: [packet.stateRevision] },
      selectedCandidateId: { type: 'string', enum: packet.candidates.map(c => c.id) } },
      required: ['requestId', 'stateRevision', 'selectedCandidateId'] };
    return freeze({ method: 'POST', url: 'https://api.openai.com/v1/responses', body: {
      model: config.model, reasoning: { effort: config.reasoningEffort }, service_tier: config.serviceTier,
      max_output_tokens: config.maxOutputTokens, store: false, truncation: 'disabled',
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(packet) }] }],
      text: { format: { type: 'json_schema', name: 'tetris_placement_v1', strict: true, schema } } } });
  } catch (error) { if (error instanceof ProviderError) throw error; fail('input'); }
}
const tokenUsage = u => {
  if (!u || typeof u !== 'object') return null;
  const out = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(u[key]) && u[key] >= 0) out[key] = u[key];
  }
  return Object.keys(out).length ? out : null;
};
function decode(result, packet) {
  if (!result || !Number.isInteger(result.status)) fail('transport_ambiguous');
  if ([401, 403].includes(result.status)) fail('authentication');
  if (result.status === 404) fail('unavailable');
  if (result.status === 429) fail('rate_limit');
  if (result.status >= 500) fail('transport_ambiguous');
  if (result.status !== 200) fail('provider_error');
  const body = result.body;
  if (bytes(body) > 65536) fail('size');
  if (body?.status === 'incomplete') fail('incomplete');
  if (body?.status !== 'completed' || !Array.isArray(body.output)) fail('schema');
  const contents = body.output.filter(i => i.type === 'message' && i.role === 'assistant').flatMap(i => i.content ?? []);
  if (contents.some(i => i.type === 'refusal')) fail('refusal');
  if (contents.length !== 1 || contents[0].type !== 'output_text' || typeof contents[0].text !== 'string') fail('schema');
  let choice;
  try { choice = JSON.parse(contents[0].text); validateChoice(packet, choice); } catch { fail('schema'); }
  return choice;
}

/** Inject only a fixture function marked mode='fixture'. Live credentials/transport require a later authorized integration. */
export function createAstraAdapter({ config = ASTRA_CONFIG, transport, live = false } = {}) {
  if (live !== false) fail('live_disabled');
  const selected = configuration(config);
  if (transport !== undefined && (typeof transport !== 'function' || transport.mode !== 'fixture')) fail('configuration');
  let receipt = null, pending = false;
  const metadata = freeze({ provider: 'OpenAI', requestedModel: selected.model, resolvedModel: null, modelIdentity: 'alias; live version unverified',
    protocolVersion: 'astra-responses-1', instructionVersion: BRIEF_VERSION, decisionVersion: VERSIONS.decision,
    configuration: selected, mode: 'offline-fixture', liveEnabled: false, availability: transport ? 'fixture-only' : 'unconfigured',
    movementMode: 'reachable-paused-gravity-v1', assistance: 'canonical-afterstates-v1', actualCostUSD: null, costStatus: 'not measured; no live request' });
  return Object.freeze({ name: 'Astra (offline fixture)', kind: 'mock', version: 'astra-responses-1',
    capabilities: freeze({ movementMode: metadata.movementMode, assistance: metadata.assistance, maxCandidates: 800 }),
    get runMetadata() { return metadata; }, get lastReceipt() { return receipt; },
    async decide(packet, { signal } = {}) {
      if (pending) fail('configuration');
      pending = true;
      const abort = new AbortController(), started = performance.now();
      let timer, listener, response, choice, code, attempts = 0;
      try {
        if (!transport) fail('unavailable');
        if (signal?.aborted) fail('cancelled');
        const request = requestFor(packet, selected);
        const guard = new Promise((_, reject) => {
          listener = () => { abort.abort(); reject(new ProviderError('cancelled')); };
          signal?.addEventListener('abort', listener, { once: true });
          timer = setTimeout(() => { abort.abort(); reject(new ProviderError('timeout')); }, Math.min(selected.timeoutMs, packet.deadlineMs));
        });
        try { response = await Promise.race([Promise.resolve().then(() => { attempts++; return transport(request, { signal: abort.signal }); }), guard]); }
        catch (error) { if (error instanceof ProviderError) throw error; fail('transport_ambiguous'); }
        if (abort.signal.aborted || signal?.aborted) fail('cancelled');
        choice = decode(response, packet);
        return freeze({ requestId: choice.requestId, stateRevision: choice.stateRevision, selectedCandidateId: choice.selectedCandidateId });
      } catch (error) {
        code = error instanceof ProviderError ? error.code : 'schema';
        throw new ProviderError(code); // Never propagate transport/provider text into logs or the controller UI.
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', listener); abort.abort(); pending = false;
        let responseHash = null;
        try { if (response?.body && bytes(response.body) <= 65536) responseHash = createHash('sha256').update(JSON.stringify(response.body)).digest('hex'); } catch { /* Unserializable response is not retained. */ }
        receipt = freeze({ requestId: typeof packet?.requestId === 'string' ? packet.requestId : null, metadata,
          latencyMs: performance.now() - started, outcome: code ? 'provider-error' : 'selected', errorCode: code ?? null,
          selectedCandidateId: choice?.selectedCandidateId ?? null, reportedModel: /^gpt-6-astra(?:-[a-zA-Z0-9.-]+)?$/.test(response?.body?.model ?? '') ? response.body.model : null,
          reportedServiceTier: ['default', 'flex', 'priority', 'scale'].includes(response?.body?.service_tier) ? response.body.service_tier : null,
          usage: tokenUsage(response?.body?.usage), usageProvenance: 'fixture response; not measured API usage', actualCostUSD: null,
          responseSha256: responseHash, rawResponseArtifactRef: /^fixture:[A-Za-z0-9_./#-]{1,200}$/.test(response?.artifactRef ?? '') ? response.artifactRef : null,
          rawResponseRetained: false, attempts });
      }
    } });
}
