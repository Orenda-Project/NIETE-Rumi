#!/usr/bin/env node
/**
 * Run the render matrix by hand and keep the evidence:
 *   node dashboard/tests/render-matrix/run.js --png <dir> [--json <file>] [--only <shape regex>] [--all-shots]
 * Prints one line per failing case and a summary; exits 1 when any case fails.
 */
'use strict';

const fs = require('fs');
const { cases } = require('./shapes');
const { run, available } = require('./browser');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const pngDir = arg('--png');
const json = arg('--json');
const only = arg('--only');

(async () => {
  const av = available();
  if (!av.ok) { process.stdout.write(`render matrix skipped: ${av.why}\n`); process.exit(0); }
  if (pngDir) fs.mkdirSync(pngDir, { recursive: true });
  const all = cases({ only: only ? new RegExp(only) : null });
  const t0 = Date.now();
  const res = await run(all, { pngDir, shotEvery: process.argv.includes('--all-shots'), onCase: (r) => { if (r.faults.length) process.stdout.write(`FAIL ${r.id} [${r.kind}] ${r.faults.join(' | ')}\n`); } });
  const bad = res.filter((r) => r.faults.length);
  process.stdout.write(`\n${res.length} cases (${all.length - res.length} not served), ${bad.length} failing, ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  if (json) fs.writeFileSync(json, JSON.stringify(res, null, 1));
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { process.stderr.write(`${e.stack}\n`); process.exit(2); });
