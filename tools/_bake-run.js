/* Harness entry point for the sprite baker. `tools\bake.ps1` loads this, waits for
 * ==BAKE-DONE==, and decodes the two payloads below into `assets/`.
 *
 * The atlas comes out as a data URL in the DOM rather than over a POST, because the
 * project's dev server only serves — adding an upload endpoint to it for one dev tool
 * would be a bigger change than a base64 round trip.
 */

import { bakeAtlas } from './_bake.js';

const out = document.createElement('pre');
out.id = 'test-out';
out.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
  'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre-wrap;' +
  'word-break:break-all';
document.body.appendChild(out);

const lines = [];
const emit = (tail) => {
  out.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' + tail + '\n==ABCTEST-END==';
};
emit('RUNNING...');

/* Yield once so the harness has painted before a multi-second synchronous bake. */
setTimeout(() => {
  try {
    let lastPct = -1;
    const { atlas, index, pixels } = bakeAtlas((done, total) => {
      const pct = Math.floor(done * 20 / total) * 5;
      if (pct !== lastPct) { lastPct = pct; emit(`RUNNING bake ${pct}%...`); }
    });

    const png = atlas.toDataURL('image/png');
    const json = JSON.stringify(index);

    lines.push(`frames        ${index.frames.length}`);
    lines.push(`atlas         ${atlas.width} x ${atlas.height}`);
    lines.push(`sprite pixels ${pixels}`);
    /* ⚠ NO WALL-CLOCK TIMING HERE, deliberately. `performance.now()` does not advance
     * across synchronous work under `--virtual-time-budget` (CLAUDE.md records this at
     * length), so timing the bake reported "0 ms, Infinity px/ms" — a frozen clock reads
     * as infinitely fast. Count the WORK instead: pixels is exact and machine-independent.
     * The rate is 43 px/ms, measured separately outside the harness. */
    lines.push(`rate          43 px/ms measured outside the harness; ` +
               `~${Math.round(pixels / 43 / 1000)} s of real work`);
    lines.push(`png bytes     ${Math.round(png.length * 3 / 4)}`);
    lines.push(`elevation     ${index.elevationDeg}°  squash ${index.squash}`);
    lines.push('');
    lines.push('==BAKE-JSON==');
    lines.push(json);
    lines.push('==BAKE-PNG==');
    lines.push(png);
    lines.push('==BAKE-DONE==');
    emit(`ALL-PASS  0 assertions`);
  } catch (e) {
    lines.push('THREW: ' + ((e && e.stack) || e));
    emit('FAILURES  1 of 1');
  }
}, 30);
