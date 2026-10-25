import { RULES, createGame, start, cells, rotate, hardDrop } from './engine.mjs';
import { VERSIONS, GEOMETRY, freeze } from './harness.mjs';
export const BRIEF_VERSION = 'local-rules-brief-1';
const empty = () => Array.from({ length: RULES.height }, () => Array(RULES.width).fill(null));
export function workedExamples() {
  const initial = start(createGame());
  const t = { ...initial, active: { type: 'T', rotation: 0, x: 3, y: 5 } }, turned = rotate(t);
  const clear = { ...initial, board: empty(), active: { type: 'I', rotation: 1, x: 3, y: 0 }, lines: 9, level: 1, score: 700 };
  clear.board[19] = Array.from({ length: RULES.width }, (_, x) => x === 5 ? null : 'J');
  clear.board[18][0] = 'S'; const cleared = hardDrop(clear);
  const blocked = { ...initial, board: empty(), active: { type: 'O', rotation: 0, x: 0, y: 18 }, queue: ['T', 'I', 'O', 'S', 'Z', 'J'], nextType: 'T' };
  blocked.board[0][4] = 'J'; const ended = hardDrop(blocked);
  return freeze([
    { name: 'Clockwise matrix rotation', before: cells(t.active), after: cells(turned.active),
      explanation: 'Rotate around the square matrix reference; normalized bounds do not replace the matrix offsets.' },
    { name: 'Complete a row, collapse and score', boardBefore: clear.board, placedCells: cells({ ...clear.active, y: 16 }), boardAfter: cleared.board,
      linesBefore: clear.lines, linesAfter: cleared.lines, scoreBefore: clear.score, scoreAfter: cleared.score,
      levelBefore: clear.level, levelAfter: cleared.level,
      explanation: 'The bottom row clears; surviving cells collapse. Score uses the level before the clear, then the level advances.' },
    { name: 'Blocked spawn ends endless play', boardBefore: blocked.board, placedCells: cells(blocked.active), boardAfter: ended.board,
      nextType: 'T', status: ended.status, active: ended.active,
      explanation: 'The placed piece locks, then the next piece cannot spawn. This is game loss, distinct from a provider or controller error.' },
  ]);
}
export function briefing() {
  return freeze({ version: BRIEF_VERSION, rulesVersion: RULES.version, schemaVersion: VERSIONS.observation,
    assistanceTier: 'complete legal placements with canonical one-placement afterstates; no external lookahead',
    rules: RULES, geometry: GEOMETRY, examples: workedExamples(),
    instructions: [
      `Board is ${RULES.width} columns by ${RULES.height} visible rows, with ${RULES.hiddenRows} hidden rows. Coordinates increase right and down from (0,0). Locked cells and active cells are separate.`,
      `Use ${RULES.rotation} rotation. Try horizontal offsets ${RULES.kicks.join(', ')} in order; no vertical kicks. No hold, counterclockwise turn, spin/combo scoring, ghost, or lock delay.`,
      'Left/right shift one column; soft drop moves down or locks immediately if blocked. Hard drop finds the last legal row and immediately locks. Complete rows are removed together; other rows collapse.',
      `One through four lines score ${RULES.clearPoints.slice(1).join('/')} times the pre-clear level. Level rises every ${RULES.linesPerLevel} lines. Gravity is max(${RULES.minimumGravityMs}, floor(${RULES.gravityStartMs} × ${RULES.gravityFactor}^(level−1)))ms per row. Step-mode waiting freezes game time.`,
      `Observe the next ${RULES.previewCount} pieces excluding the active piece. Seed/RNG and later future are private. Hypothetical afterstates show only the original remaining preview, never a new sixth piece.`,
      'The objective is endless score and survival. There is no victory condition. Blocked next spawn is a game loss. Timeout, cancellation and an experiment piece cap are separate outcomes, never wins.',
      'Choose exactly one supplied legal candidate ID. Each includes orientation, four occupied cells, bounds, executable path and exact consequences. The executor revalidates and performs that path; you cannot invent moves or select another piece.',
      'Return only requestId, stateRevision and selectedCandidateId matching the response schema. Future turns are reconsidered from fresh state. Same semantic briefing and assistance are provided to every competitor.',
    ] });
}
function ensurePublic(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['seed', 'rng', 'queue', 'apiKey', 'authorization', 'token'].includes(key)) throw new Error('Private field in decision packet');
    ensurePublic(item);
  }
}
export function instructionPacket(observation, candidates, { requestId, deadlineMs } = {}) {
  if (typeof requestId !== 'string' || !requestId || requestId.length > 200 || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000 || !candidates.length) throw new TypeError('Bounded request and candidates required');
  if (new Set(candidates.map(c => c.id)).size !== candidates.length || candidates.some(c => c.sessionId !== observation.sessionId || c.revision !== observation.revision || c.rulesVersion !== observation.rulesVersion)) throw new Error('Candidate packet binding mismatch');
  const packet = { schemaVersion: VERSIONS.decision, requestId, stateRevision: observation.revision, observation,
    rulesBrief: briefing(), objective: observation.objective, candidates,
    deadlineMs, responseSchema: { type: 'object', additionalProperties: false,
      properties: { requestId: { type: 'string', const: requestId }, stateRevision: { type: 'integer', const: observation.revision },
        selectedCandidateId: { type: 'string', enum: candidates.map(c => c.id) } },
      required: ['requestId', 'stateRevision', 'selectedCandidateId'] } };
  ensurePublic(packet); return freeze(packet);
}
export function validateChoice(packet, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      Object.keys(response).some(k => !['requestId', 'stateRevision', 'selectedCandidateId'].includes(k)) ||
      response.requestId !== packet.requestId || response.stateRevision !== packet.stateRevision ||
      !packet.candidates.some(c => c.id === response.selectedCandidateId)) throw new Error('Invalid, stale or unknown decision');
  return response.selectedCandidateId;
}
