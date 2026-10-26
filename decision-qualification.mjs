// Owner evidence is an explicit prerequisite, never inferred from byte length or
// observed usage. This module supplies no qualified evidence or live default.
export const DECISIONS_SCHEMA = 'decisions-create-fixed-1';
const endpoint = 'https://api.openai.com/v1/decisions';
const exact = (v, keys) => v && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const integer = v => Number.isSafeInteger(v) && v > 0;
const fields = ['kind','model','endpoint','method','requestSchema','maxBodyBytes','maxResponseBytes','totalBillableInputCeiling','ceilingEvidence','reservationTokens','inputMicrosPerMillion','cacheWriteMicrosPerMillion','cacheTTL','longContextMultiplier','regionalNumerator','regionalDenominator','outputBilling','outputMicrosPerMillion','reservationMicros','pilotStartedAt'];
const evidenceFields = ['status','model','endpoint','requestSchema','totalBillableInputCeiling','includesQuestionsAndFraming','sourceURL','checkedAt','validUntil'];
export function conservativeReservationMicros(tokens) {
  if (!integer(tokens)) throw Error('qualification_required');
  // Reserve full input AND full 30m cache write, with long-context and regional
  // worst cases. BigInt avoids fractional/unsafe intermediate arithmetic.
  const value = (BigInt(tokens) * 225000n * 2n * 11n + 9999999n) / 10000000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('qualification_required');
  return Number(value);
}
export function qualifiedDecisions(q, policy, now = Date.now()) {
  if (!exact(q, fields) || !exact(policy, ['maxAttempts','maxInputTokens','maxEstimatedMicros','expiresAt','maxRuns','maxEpochs','maxPlacements','timeoutMs','reservationTokens','reservationMicros']) || Object.values(policy).some(v => !integer(v))) return false;
  const e = q.ceilingEvidence;
  if (!exact(e, evidenceFields) || e.status !== 'qualified' || e.includesQuestionsAndFraming !== true ||
      !['https://developers.openai.com/api/docs/guides/decisions','https://developers.openai.com/api/reference/resources/decisions/methods/create','https://developers.openai.com/api/docs/models/gpt-6-luna'].includes(e.sourceURL) ||
      !integer(e.checkedAt) || !integer(e.validUntil) || e.checkedAt > now || e.validUntil <= now || e.validUntil > e.checkedAt + 86400000 ||
      e.model !== q.model || e.endpoint !== q.endpoint || e.requestSchema !== q.requestSchema || e.totalBillableInputCeiling !== q.totalBillableInputCeiling) return false;
  if (q.kind !== 'owner-qualified-decisions-live-v2' || q.model !== 'gpt-6-luna' || q.endpoint !== endpoint || q.method !== 'POST' || q.requestSchema !== DECISIONS_SCHEMA ||
      q.maxBodyBytes !== 1048576 || q.maxResponseBytes !== 65536 || !integer(q.totalBillableInputCeiling) || !integer(q.reservationTokens) || q.reservationTokens < q.totalBillableInputCeiling ||
      q.inputMicrosPerMillion !== 100000 || q.cacheWriteMicrosPerMillion !== 125000 || q.cacheTTL !== '30m' || q.longContextMultiplier !== 2 || q.regionalNumerator !== 11 || q.regionalDenominator !== 10 ||
      q.outputBilling !== 'free' || q.outputMicrosPerMillion !== 0 || !integer(q.pilotStartedAt) || q.pilotStartedAt > now || policy.expiresAt > q.pilotStartedAt + 300000 || policy.expiresAt <= now ||
      !integer(policy.maxAttempts) || policy.maxAttempts > 20 || !integer(policy.maxEstimatedMicros) || policy.maxEstimatedMicros > 10000000 ||
      policy.reservationTokens !== q.reservationTokens || policy.maxInputTokens < q.reservationTokens || policy.maxInputTokens > q.reservationTokens * policy.maxAttempts ||
      !integer(q.reservationMicros) || policy.reservationMicros !== q.reservationMicros || q.reservationMicros > policy.maxEstimatedMicros) return false;
  try { return q.reservationMicros === conservativeReservationMicros(q.reservationTokens); } catch { return false; }
}
