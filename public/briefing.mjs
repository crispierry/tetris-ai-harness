import { RULES, levelForLines, isTerminal, terminalReason, createGame, start, cells, rotate, hardDrop } from './engine.mjs';
import { VERSIONS, GEOMETRY, freeze } from './harness.mjs';
export const BRIEF_VERSION = 'local-rules-brief-3';
const CONTROLLER_RESPONSE_INSTRUCTIONS = 'Return only requestId, stateRevision and selectedCandidateId matching the response schema.';
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
    { name: 'Blocked spawn ends a Marathon attempt', boardBefore: blocked.board, placedCells: cells(blocked.active), boardAfter: ended.board,
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
      `One through four lines score ${RULES.clearPoints.slice(1).join('/')} times the pre-clear level. Start at level ${RULES.startLevel}; level rises every ${RULES.linesPerLevel} lines, up to ${RULES.maxLevel}. Gravity is max(${RULES.minimumGravityMs}, floor(${RULES.gravityStartMs} × ${RULES.gravityFactor}^(level−1)))ms per row. Step-mode waiting freezes game time.`,
      `Observe the next ${RULES.previewCount} pieces excluding the active piece. Seed/RNG and later future are private. Hypothetical afterstates show the original remaining preview, never a new sixth piece. A winning clear retains all five original next pieces because no spawn or refill occurs.`,
      'Marathon: clear 300 lines. Complete the entire clear and score at the pre-clear level, then stop before spawning or refilling. Keep overshoot lines and the final settled board; maximum level is 30. Blocked next spawn is a game loss. Timeout, cancellation, errors and a placement safety cap are separate outcomes, never wins.',
      'Choose exactly one supplied legal candidate ID. Each includes orientation, four occupied cells, bounds, executable path and exact consequences. The executor revalidates and performs that path; you cannot invent moves or select another piece.',
      'Choose only the current placement, then reconsider the next turn from fresh state. Same semantic briefing and assistance are provided to every competitor.',
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
    deadlineMs, responseInstructions: CONTROLLER_RESPONSE_INSTRUCTIONS, responseSchema: { type: 'object', additionalProperties: false,
      properties: { requestId: { type: 'string', const: requestId }, stateRevision: { type: 'integer', const: observation.revision },
        selectedCandidateId: { type: 'string', enum: candidates.map(c => c.id) } },
      required: ['requestId', 'stateRevision', 'selectedCandidateId'] } };
  validatePacket(packet); return freeze(packet);
}
/** Provider-neutral game evidence; controller object-generation instructions stay local to object protocols. */
export function semanticPacket(packet) {
  return freeze({ schemaVersion: packet.schemaVersion, observation: packet.observation,
    rulesBrief: packet.rulesBrief, objective: packet.objective, candidates: packet.candidates });
}
export function validateChoice(packet, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      Object.keys(response).some(k => !['requestId', 'stateRevision', 'selectedCandidateId'].includes(k)) ||
      response.requestId !== packet.requestId || response.stateRevision !== packet.stateRevision ||
      !packet.candidates.some(c => c.id === response.selectedCandidateId)) throw new Error('Invalid, stale or unknown decision');
  return response.selectedCandidateId;
}

/** Reject mixed versions/objectives and malformed terminal evidence before any provider request. */
export function validatePacket(packet) {
  const bad = () => { throw new Error('Invalid current Marathon decision packet'); };
  ensurePublic(packet);
  const validObservation = (o, preview) => o && o.schemaVersion === VERSIONS.observation && o.rulesVersion === RULES.version &&
    o.objective === RULES.objective && o.width === RULES.width && o.visibleHeight === RULES.height && o.hiddenRows === RULES.hiddenRows &&
    Array.isArray(o.board) && o.board.length === RULES.height && o.board.every(row => Array.isArray(row) && row.length === RULES.width && row.every(c => c === null || RULES.types.includes(c))) && o.previewCount === preview && Array.isArray(o.next) && o.next.length === preview && o.next.every(t => RULES.types.includes(t)) &&
    ['score','lines','revision'].every(k => Number.isSafeInteger(o[k]) && o[k] >= 0) && o.level === levelForLines(o.lines) &&
    ['playing','over','won'].includes(o.status) && o.terminalReason === terminalReason(o.status) &&
    (o.status === 'won' ? o.lines >= RULES.targetLines : o.lines < RULES.targetLines) &&
    (isTerminal(o.status) ? o.active === null : o.active && RULES.types.includes(o.active.type));
  if (!packet || packet.schemaVersion !== VERSIONS.decision || packet.rulesBrief?.version !== BRIEF_VERSION ||
      packet.rulesBrief?.rulesVersion !== RULES.version || JSON.stringify(packet.rulesBrief?.rules) !== JSON.stringify(RULES) ||
      packet.objective !== RULES.objective || packet.responseInstructions !== CONTROLLER_RESPONSE_INSTRUCTIONS ||
      typeof packet.requestId !== 'string' || !packet.requestId || packet.requestId.length > 200 ||
      !Number.isInteger(packet.deadlineMs) || packet.deadlineMs < 1 || packet.deadlineMs > 60000 || !validObservation(packet.observation, RULES.previewCount) || packet.observation.status !== 'playing' ||
      packet.stateRevision !== packet.observation.revision || !Array.isArray(packet.candidates) || !packet.candidates.length || packet.candidates.length > 800 || new Set(packet.candidates.map(c => c.id)).size !== packet.candidates.length) bad();
  const o = packet.observation;
  for (const c of packet.candidates) {
    const a = c.afterstate, consumed = a?.status === 'won' ? 0 : 1;
    if (typeof c.id !== 'string' || !c.id || c.id.length > 200 || c.schemaVersion !== VERSIONS.candidate || c.rulesVersion !== RULES.version || c.sessionId !== o.sessionId || c.revision !== o.revision ||
        !validObservation(a, RULES.previewCount - consumed) || a.sessionId !== o.sessionId || a.revision !== o.revision + 1 ||
        JSON.stringify(a.next) !== JSON.stringify(o.next.slice(consumed)) || (a.status === 'playing' && a.active?.type !== o.next[0]) ||
        c.terminalReason !== a.terminalReason || !Number.isInteger(c.linesDelta) || c.linesDelta < 0 || c.linesDelta > 4 ||
        c.linesDelta !== a.lines - o.lines || c.scoreDelta !== a.score - o.score || c.scoreDelta !== RULES.clearPoints[c.linesDelta] * o.level ||
        c.levelDelta !== a.level - o.level) bad();
  }
  return packet;
}
