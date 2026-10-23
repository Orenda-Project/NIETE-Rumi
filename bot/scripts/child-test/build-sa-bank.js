#!/usr/bin/env node
/**
 * Rewrite the SA battery bank from the v3 bank, the extra official items (item-bank.sa-extra.v1.json) and the W3 picks
 * (item-bank.sa-w3.v1.json) (shared/services/child-test/sa/build.js):
 *   bot/shared/data/child-test/item-bank.sa.v1.json   the whole bank (CONTRACT §2: forms + tasks keyed "<form>/<task>")
 *   bot/shared/data/child-test/sa/<form>.json         the same shape, one form's tasks only
 *   bot/shared/data/child-test/sa/sa.<form>.<lang>.json  what the engine runs (/sa/batteries/), one form in one language
 *
 *   node bot/scripts/child-test/build-sa-bank.js [--check]
 *
 * --check exits 1 when any committed file differs from what the builder makes.
 */

const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const v3 = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.v3.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.sa-extra.v1.json'), 'utf8'));
const w3 = JSON.parse(fs.readFileSync(path.join(DATA, 'item-bank.sa-w3.v1.json'), 'utf8'));

const files = splitSaBankWithRuntime(buildSaBank({ v3, extra, w3 }));
const check = process.argv.includes('--check');
let stale = 0;
// A form file no longer made is stale too.
for (const f of fs.existsSync(path.join(DATA, 'sa')) ? fs.readdirSync(path.join(DATA, 'sa')) : []) {
  if (files[`sa/${f}`]) continue;
  if (check) { stale += 1; console.log(`stale: sa/${f}`); } else fs.unlinkSync(path.join(DATA, 'sa', f));
}
for (const [rel, obj] of Object.entries(files)) {
  const out = path.join(DATA, rel);
  const text = `${JSON.stringify(obj)}\n`;
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { stale += 1; console.log(`stale: ${rel}`); }
    continue;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`wrote ${rel} (${text.length} bytes)`);
}
if (check) { console.log(stale ? `${stale} stale file(s): run build-sa-bank.js` : 'SA bank is current'); process.exit(stale ? 1 : 0); }
