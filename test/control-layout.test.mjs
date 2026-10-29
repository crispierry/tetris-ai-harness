import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const mode of ['comparison', 'harness', 'versus']) {
  test(`${mode} keeps variable setup and messages after the play controls`, async () => {
    const html = await readFile(new URL(`../public/${mode}.html`, import.meta.url), 'utf8');
    const rail = html.slice(html.indexOf('<aside class="control-rail"'));
    const toolbar = rail.indexOf('<div class="play-toolbar">');
    assert(toolbar >= 0, 'play controls exist in the rail');
    for (const marker of ['<div class="player-settings', 'id="decision-cost"', 'id="decision-cost-note"', 'id="decision-budget-risk"']) {
      assert(rail.indexOf(marker) > toolbar, `${marker} must follow the controls`);
    }
  });
}
