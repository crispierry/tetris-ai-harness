import {FACT_CHOICE_VERSION,factualDecisionInput} from './decision-facts.mjs';
// Shared pure native Choice protocol; no transport or credential access.
import { ProviderError } from './providers.mjs';
import { freeze, VERSIONS } from './public/harness.mjs';
import { BRIEF_VERSION, validatePacket, semanticPacket } from './public/briefing.mjs';
import {COMPACT_CHOICE_VERSION,HOLE_CHOICE_VERSION,LEGACY_CHOICE_VERSION,compactDecisionInput,compactChoiceDescription,holeChoiceDescription} from './decision-compact.mjs';
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
function formatCheck(protocol,format){if(![LEGACY_CHOICE_VERSION,COMPACT_CHOICE_VERSION,HOLE_CHOICE_VERSION,FACT_CHOICE_VERSION].includes(format)||(protocol!=='decisions'&&format!==LEGACY_CHOICE_VERSION))fail('configuration');}
export function requestFor(protocol, packet, config, {format=LEGACY_CHOICE_VERSION,reverseChoices=false,history=[]}={}) {
  formatCheck(protocol,format);if(typeof reverseChoices!=='boolean')fail('configuration');
  if(protocol==='decisions'&&packet.candidates.length<2)fail('unsupported_candidates');
  if(format!==LEGACY_CHOICE_VERSION){const choices=packet.candidates.map((c,i)=>({value:`m${i}`,description:[HOLE_CHOICE_VERSION,FACT_CHOICE_VERSION].includes(format)?holeChoiceDescription(c,packet.observation.board):compactChoiceDescription(c)}));if(reverseChoices)choices.reverse();return freeze({method:'POST',url:definitions[protocol].endpoint,body:{model:config.model,input:JSON.stringify(format===FACT_CHOICE_VERSION?factualDecisionInput(packet,{history}):compactDecisionInput(packet,{prioritizeHoles:format===HOLE_CHOICE_VERSION})),questions:[{type:'choice',name:'placement',instructions:format===FACT_CHOICE_VERSION?'Select one supplied move to survive to 300 lines. Consider current holes, height, empty-row gaps, surface geometry and the next visible pieces together. Use the factual recent trajectory to understand accumulation and clearing. Distinguish newly created holes from existing holes resolved. Teaching examples illustrate mechanics on fixed boards, not a ranked answer for this turn. Every legal option remains available in its original order. You decide the tradeoffs; no score, ranking or recommendation is supplied. Return one supplied move label.':format===HOLE_CHOICE_VERSION?'Choose the move most likely to survive to 300 lines. Prefer a winning afterstate and avoid immediate blocked-spawn loss when survival is possible. Among surviving moves, give strong priority to avoiding newly covered holes and resolving existing holes; a smoother surface or slightly lower roof usually does not justify creating a hole. Inspect created and resolved holes separately, not just net change, and consider how many blocks cover them. Then weigh height, clean line clears and the visible next pieces. These are survival priorities, not an absolute fewest-holes rule: you decide exceptions for immediate danger, a winning clear or a convincing plan using visible pieces. All legal moves remain available with exact afterstates; none is ranked or recommended for this turn. Return one supplied move label.':'Choose the move most likely to survive to 300 lines. Prefer a winning afterstate and avoid immediate blocked-spawn loss when survival is possible. Compare holes, height, roughness, clean line clears and the visible next pieces. Use the strategic examples as tradeoffs, not rigid rules. All moves and exact settled boards are supplied; do not invent a move or unseen future. Return one supplied move label.',choices}]}});}
  const instructions = protocol === 'decisions'
    ? 'Select exactly one supplied current legal placement ID as the native placement Choice answer. The goal is to survive long enough to clear 300 lines. Prefer a winning afterstate; avoid blocked-spawn loss when a surviving placement exists. Compare the exact afterstates and the visible next five pieces. Holes are empty cells below occupied cells in a column; heights measure occupied stack height from the bottom; aggregateHeight sums column heights; bumpiness sums adjacent height differences. Avoid creating holes or a tall, uneven stack, and clear lines when that helps survival. Choice descriptions summarize existing candidate evidence, not predicted future rewards. Use the complete rules, objective and immediate consequences in the public packet; replan on the next turn.'
    : 'Choose one legal placement ID using the complete rules, objective and consequences in the supplied public packet.';
  return freeze({ method: 'POST', url: definitions[protocol].endpoint, body: protocol === 'decisions' ? {
    model: config.model, input: JSON.stringify(semanticPacket(packet)), questions: [{ type: 'choice', name: 'placement', instructions,
      choices: (reverseChoices?[...packet.candidates].reverse():packet.candidates).map(c => ({ value:c.id, description:`${c.piece} at (${c.x},${c.y}), rotation ${c.orientation}. After placement: ${c.afterstate.status}; lines cleared ${c.linesDelta}; holes ${c.features.holes} (${c.featureDeltas.holes>=0?'+':''}${c.featureDeltas.holes}); max height ${c.features.maxHeight}; total height ${c.features.aggregateHeight}; bumpiness ${c.features.bumpiness}. Exact board, path and remaining preview are in the input packet.` })) }]
  } : { model: config.model, state: packet, questions: { placement: { type: 'choice', instructions,
    criteria: Object.fromEntries(packet.candidates.map(c => [c.id, c])) } } } });
}
export function compatible(protocol, model) {
  return typeof model === 'string' && (protocol === 'decisions' ? /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(model) : /^(?:jev-latest|jev-\d+\.\d+\.\d+)$/.test(model));
}
export function parse(protocol, result, packet, {format=LEGACY_CHOICE_VERSION}={}) {
  formatCheck(protocol,format);
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
  const ids = packet.candidates.map((c,i) => format!==LEGACY_CHOICE_VERSION?`m${i}`:c.id);
  if (distribution.length !== ids.length || new Set(distribution.map(p => p.id)).size !== ids.length ||
      distribution.some(p => !ids.includes(p.id) || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) ||
      Math.abs(distribution.reduce((sum, p) => sum + p.probability, 0) - 1) > 1e-6 || !ids.includes(answer.choice) ||
      distribution.find(p => p.id === answer.choice).probability < Math.max(...distribution.map(p => p.probability))) fail('schema');
  const canonicalId=id=>packet.candidates[ids.indexOf(id)].id;
  return { choice: { requestId: packet.requestId, stateRevision: packet.stateRevision, selectedCandidateId: canonicalId(answer.choice) }, distribution:distribution.map(p=>({...p,id:canonicalId(p.id)})), confidence: answer.confidence };
}
