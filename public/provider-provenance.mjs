// Display only: interpret the existing immutable public policy, never selector names
// or the UI's `live` playback mode. Unknown metadata must stay unknown.
export function providerProvenance(policy, { recorded = false, pending = false } = {}) {
  if (pending && !recorded) return typeof pending === 'string' ? pending : 'Not configured — Connect OpenAI before playing.';
  let message = 'Provider provenance unknown';
  if (policy?.version === 'provider-policy-1') {
    if (policy.kind === 'localHeuristic') message = 'Independent local choices · No external provider calls';
    else if (policy.kind === 'localSearch') message = 'Local lookahead search · No external provider calls';
    else if (policy.kind === 'mock') message = 'Offline test fixture · No external provider calls';
    else if (policy.kind === 'externalDecisions' && policy.provider === 'OpenAI') {
      if (policy.transport === 'http-fixture') message = 'Offline HTTP fixture via local server · No external provider calls';
      else if (policy.transport === 'live') message = 'Live OpenAI via server bridge';
      if (message !== 'Provider provenance unknown' && policy.visiblePreview === 5 && policy.externalSearch === false && policy.assistance === 'canonical-afterstates-v1')
        message += ' · Current + next five; immediate afterstates; no external search';
    }
  // Historical local facade policies remain canonical in their saved records.
  } else if (policy?.version === 'heuristic-2' && policy.kind === 'local') message = 'Independent local choices · No external provider calls';
  else if (policy?.version === 'mock-2' && policy.kind === 'mock') message = 'Offline test fixture · No external provider calls';
  else if (policy?.version === 'visible-placement-search-2' && (policy.kind === 'local' || policy.evaluator?.kind === 'local' || policy.evaluator?.kind === 'mock')) message = 'Local lookahead search · No external provider calls';
  return (recorded ? 'Recorded · ' : '') + message;
}
