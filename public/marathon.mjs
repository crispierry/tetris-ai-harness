import { RULES } from './engine.mjs';
export const formatNumber = new Intl.NumberFormat().format;
export const MARATHON_COPY = Object.freeze({
  intro: 'Marathon: clear 300 lines. Start at level 1; every 10 lines raises the level, up to level 30.',
  complete: 'Marathon complete',
  cap: 'Placement safety limit reached before the 300-line target. This run is capped, not a Marathon completion.',
});
export const linesProgress = lines => `${formatNumber(lines)} / ${formatNumber(RULES.targetLines)}`;
export function outcomeDetail(status, observation, error = null) {
  if (status === 'won') return `300-line target reached. Final score: ${formatNumber(observation.score)}. Lines cleared: ${formatNumber(observation.lines)}. Start a new game to play again.`;
  if (status === 'capped') return MARATHON_COPY.cap;
  if (status === 'over') return 'Blocked spawn. Start a new game to try again.';
  if (status === 'error') return error ?? 'Error';
  return MARATHON_COPY.intro;
}
