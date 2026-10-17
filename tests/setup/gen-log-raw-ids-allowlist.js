#!/usr/bin/env node
/**
 * Regenerate (or inspect) log-raw-ids.allowlist.json: per product file, how many log-line properties carry a raw person
 * id or phone (see log-raw-ids-lib.js), the area the file belongs to, and the hits as they stood when written.
 *
 * Usage, from the repo root:
 *   node tests/setup/gen-log-raw-ids-allowlist.js            # show the drift, write nothing
 *   node tests/setup/gen-log-raw-ids-allowlist.js --write    # re-baseline the allowlist
 *
 * `--write` grandfathers every raw id logged today. That is right when adopting the ratchet and wrong as a way to
 * silence a line you just added: for a new line, log `tk(id)` / `kid(id)` or a masked phone instead. The list only
 * earns its keep if it shrinks. On a merge conflict in the allowlist, regenerate on the merged tree; never hand-merge.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { rawIdHits, isProductFile } = require('./log-raw-ids-lib');

const REPO = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'log-raw-ids.allowlist.json');

/** The area a file belongs to: its folder under bot/shared/services, bot/shared, bot or dashboard. */
function areaOf(f) {
  const p = f.split('/');
  if (p[0] === 'bot' && p[1] === 'shared' && p[2] === 'services' && p.length > 4) return p[3];
  if (p[0] === 'bot' && p[1] === 'shared' && p.length > 3) return p[2];
  return p.length > 2 ? `${p[0]}/${p[1]}` : p[0];
}

function scan() {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'bot', 'dashboard'], { cwd: REPO }).toString('utf8').split('\0').filter(isProductFile);
  const out = {};
  for (const f of files) {
    const hits = rawIdHits(fs.readFileSync(path.join(REPO, f), 'utf8'));
    if (hits.length) out[f] = { n: hits.length, area: areaOf(f), at: hits };
  }
  return out;
}

if (require.main === module) {
  const now = scan();
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const f of [...new Set([...Object.keys(now), ...Object.keys(old)])].sort()) {
    const a = old[f] ? old[f].n : 0;
    const b = now[f] ? now[f].n : 0;
    if (a !== b) console.log(`${f}: ${a} → ${b}`);
  }
  const total = Object.values(now).reduce((s, e) => s + e.n, 0);
  console.log(`${Object.keys(now).length} files, ${total} raw-id log properties.`);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, `${JSON.stringify(now, null, 1)}\n`);
    console.log(`written: ${path.relative(REPO, OUT)}`);
  }
}

module.exports = { scan, areaOf };
