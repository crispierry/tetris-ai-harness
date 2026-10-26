import test from 'node:test';
import assert from 'node:assert/strict';
import { mountVersus } from '../public/versus-ui.mjs';
import { HumanVersus } from '../public/versus.mjs';
import { mountComparison } from '../public/comparison-ui.mjs';
import { Comparison, DEFAULT_CONFIG } from '../public/comparison.mjs';
import { providerProvenance } from '../public/provider-provenance.mjs';

function fixture() {
  const nodes = new Map(), events = {};
  const doc = { activeElement: null, hidden: false, hasFocus: () => true,
    getElementById: id => { if (id === 'decision-pairing') return null; if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    createElement: () => new Element(), addEventListener: (key, fn) => { events[key] = fn; } };
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; }
    append(...v) { this.children.push(...v); } replaceChildren(...v) { this.children = [...v]; }
    setAttribute(k, v) { this.attributes[k] = v; } addEventListener(k, fn) { this.listeners[k] = fn; }
    trigger(k) { return this.listeners[k]?.({ target: this }); } focus() { doc.activeElement = this; }
  }
  const $ = doc.getElementById;
  for (const [k, v] of Object.entries(DEFAULT_CONFIG)) $('c-' + k).value = String(v);
  $('v-provider').value = 'local';
  return { doc, $, win: { addEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {} } };
}
const external = transport => ({ version: 'provider-policy-1', kind: 'externalDecisions', provider: 'OpenAI', transport,
  visiblePreview: 5, externalSearch: false, assistance: 'canonical-afterstates-v1' });
const matrix = [
  [{ version: 'provider-policy-1', kind: 'localHeuristic' }, 'Independent local choices · No external provider calls'],
  [{ version: 'provider-policy-1', kind: 'localSearch' }, 'Local lookahead search · No external provider calls'],
  [{ version: 'provider-policy-1', kind: 'mock' }, 'Offline test fixture · No external provider calls'],
  [external('http-fixture'), 'Offline HTTP fixture via local server · No external provider calls'],
  [external('live'), 'Live OpenAI via server bridge'],
  [external('future-unknown'), 'Provider provenance unknown'],
  [{ version: 'future-policy', kind: 'remote' }, 'Provider provenance unknown'],
  [null, 'Provider provenance unknown'],
];
for (const mode of ['versus', 'comparison']) test(`mounted ${mode} policy matrix and recorded identities ignore player names and UI live mode`, () => {
  const f = fixture(); let emit;
  const mounted = mode === 'versus'
    ? mountVersus(f.doc, { window: f.win, runnerFactory: options => { emit = options.onChange; return new HumanVersus(options); } })
    : mountComparison(f.doc, { comparisonFactory: options => { emit = options.onChange; return new Comparison(options); } });
  const runner = mounted.runner ?? mounted;
  try {
    const initial = runner.view, focus = f.$(mode === 'versus' ? 'v-provider' : 'c-right'); focus.focus();
    for (const [policy, expected] of matrix) for (const recorded of [false, true]) {
      const view = structuredClone(initial); view.mode = recorded ? 'replay' : 'live';
      focus.value = recorded ? 'openai' : 'local';
      // Deliberately misleading identity text cannot establish provider provenance.
      view.lanes[1].player = { name: 'Live OpenAI local fixture', kind: 'remote', version: 'unknown' };
      if (mode === 'versus') view.policies[1] = policy; else view.lanes[1].policy = policy;
      emit(view);
      const text = f.$(mode === 'versus' ? 'v-1-provenance' : 'c-1-tier').textContent;
      assert.ok(text.startsWith((recorded ? 'Recorded · ' : '') + expected), text);
      if (expected === 'Provider provenance unknown') assert.doesNotMatch(text, /Live OpenAI|No external provider calls|Local algorithm/);
      if (policy?.transport === 'live') assert.doesNotMatch(text, /No external provider calls/);
      assert.equal(f.doc.activeElement, focus);
    }
  } finally { mounted.dispose(); }
});

test('real versus selection, Reset and replay refresh provenance without any provider calls', async () => {
  const f = fixture(), mounted = mountVersus(f.doc, { window: f.win });
  try {
    for (const [key, expected] of [['local', 'Independent local choices'], ['look1', 'Local lookahead search'], ['delay', 'Offline test fixture']]) {
      f.$('v-provider').value = key; await f.$('v-provider').trigger('change');
      assert.match(f.$('v-1-provenance').textContent, new RegExp(expected));
    }
    f.$('v-provider').value = 'openai'; await f.$('v-provider').trigger('change');
    assert.match(f.$('v-1-provenance').textContent, /Not configured/);
    assert.doesNotMatch(f.$('v-1-provenance').textContent, /No external provider calls/);
    f.$('v-provider').value = 'local'; await f.$('v-provider').trigger('change');
    await f.$('v-step').trigger('click'); await f.$('v-replay').trigger('click'); await f.$('v-pause').trigger('click');
    assert.match(f.$('v-1-provenance').textContent, /^Recorded · Independent local choices/);
    await f.$('v-reset').trigger('click');
    assert.match(f.$('v-1-provenance').textContent, /^Independent local choices/);
  } finally { mounted.dispose(); }
});

test('unknown transport, missing policy and incomplete horizon never infer live, local or no calls', () => {
  assert.equal(providerProvenance({ kind: 'remote' }), 'Provider provenance unknown');
  assert.equal(providerProvenance({ ...external('http-fixture'), visiblePreview: null }), 'Offline HTTP fixture via local server · No external provider calls');
  assert.equal(providerProvenance(external('live'), { recorded: true, pending: true }).startsWith('Recorded · Live OpenAI'), true);
  assert.equal(providerProvenance(null, { pending: 'Waiting for local owner approval.' }), 'Waiting for local owner approval.');
});
