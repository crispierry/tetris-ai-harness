// Shared pure native Choice protocol; no transport or credential access.
import { ProviderError } from './providers.mjs';
import { freeze, VERSIONS } from './public/harness.mjs';
import { BRIEF_VERSION, validatePacket, semanticPacket } from './public/briefing.mjs';
export const fail = code => {
  const error = new ProviderError(code);
  if (code === 'unsupported_candidates') error.message = 'Complete legal candidate set exceeds the supported Choice option limit.';
  throw error;
};
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
    inputLimitMeaning: 'Application UTF-8 byte bound on both the controller packet and serialized request body; not a token/context estimate.', maxResponseBytes: 65536,
    reasoningEffort: 'not configured: unsupported by this Choice request contract', serviceTier: 'not configured: unsupported by this Choice request contract' });
}
export function packetCheck(packet, config) {
  try { validatePacket(packet); } catch { fail('input'); }
  if (packet?.schemaVersion !== VERSIONS.decision || packet.rulesBrief?.version !== BRIEF_VERSION ||
      !Number.isInteger(packet.deadlineMs) || packet.deadlineMs < 1 || !packet.candidates?.length ||
      size(packet) > config.maxInputBytes ||
      new Set(packet.candidates.map(c => c.id)).size !== packet.candidates.length) fail('input');
  if (packet.candidates.length > config.maxCandidates) fail('unsupported_candidates');
}
export function requestFor(protocol, packet, config) {
  const ids = packet.candidates.map(c => c.id), instructions = protocol === 'decisions'
    ? 'Select exactly one supplied current legal placement ID as the native placement Choice answer. Use the complete rules, objective and immediate consequences in the public packet; replan on the next turn.'
    : 'Choose one legal placement ID using the complete rules, objective and consequences in the supplied public packet.';
  return freeze({ method: 'POST', url: definitions[protocol].endpoint, body: protocol === 'decisions' ? {
    model: config.model, input: JSON.stringify(semanticPacket(packet)), questions: [{ type: 'choice', name: 'placement', instructions,
      choices: ids.map(value => ({ value, description: 'Legal placement; exact path and consequences are in the input packet.' })) }]
  } : { model: config.model, state: packet, questions: { placement: { type: 'choice', instructions,
    criteria: Object.fromEntries(packet.candidates.map(c => [c.id, c])) } } } });
}
export function compatible(protocol, model) {
  return typeof model === 'string' && (protocol === 'decisions' ? /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model) : /^(?:jev-latest|jev-\d+\.\d+\.\d+)$/.test(model));
}
export function parse(protocol, result, packet) {
  if (!Number.isInteger(result?.status)) fail('transport_ambiguous');
  if ([401, 403].includes(result.status)) fail('authentication');
  if (result.status === 404) fail('unavailable'); if (result.status === 429) fail('rate_limit');
  if (result.status >= 500) fail('transport_ambiguous'); if (result.status !== 200) fail('provider_error');
  const body = result.body; if (size(body) > 65536) fail('size');
  if ((protocol === 'decisions' || body?.model !== undefined) && !compatible(protocol, body?.model)) fail('model_mismatch');
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
