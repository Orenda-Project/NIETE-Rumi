#!/usr/bin/env node
/**
 * upload-lp612-figures.js — upload ONLY the crops a diagram plan references.
 *
 * bd-17mht. `upload-lp612-page-truth.js --include-figures` sends every crop in a
 * book (~994 MB across the corpus). The diagram plan references far fewer, so
 * this uploads exactly the manifest and nothing else.
 *
 * THE BUCKET IS SHARED WITH PK PRODUCTION. The `lp612/` prefix is the only
 * isolation this lane has, so every key goes through the serving service's own
 * `assertKeyInPrefix` — the same function the worker uses, not a copy.
 *
 * Idempotent: an object already present with the same size is skipped, so a
 * re-run after more books land costs a HEAD per file and nothing else.
 *
 * Usage:
 *   node bot/scripts/upload-lp612-figures.js --manifest <file> --corpus <dir> [--dry-run]
 *        [--limit N] [--concurrency N] [--refs a,b,c]
 */
const fs = require('fs');
const path = require('path');

const Serving = require('../shared/services/lp612-serving.service');
const { uploadBuffer, downloadFromR2 } = require('../shared/storage/r2');

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}
const DRY = process.argv.includes('--dry-run');
const MANIFEST = arg('manifest');
const CORPUS = arg('corpus');
const LIMIT = parseInt(arg('limit', '0'), 10);
const CONC = Math.max(1, parseInt(arg('concurrency', '8'), 10));
const ONLY = (arg('refs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

/** ref -> R2 key. Must match build_plan.py's r2_key(). */
function keyForRef(ref) {
  const i = ref.indexOf('/');
  if (i < 1) throw new Error(`malformed ref: ${ref}`);
  const book = ref.slice(0, i);
  const fname = ref.slice(i + 1);
  return `lp612/page-truth/${book}/figures/${fname}.jpg`;
}

/** ref -> local crop path inside the corpus. */
function pathForRef(corpus, ref) {
  const i = ref.indexOf('/');
  const book = ref.slice(0, i);
  const fname = ref.slice(i + 1);
  return path.join(corpus, '01_page_truth', book, 'figures', `${fname}.jpg`);
}

async function alreadyThere(key, size) {
  try {
    const buf = await downloadFromR2(key);
    return buf && buf.length === size;
  } catch (_) {
    return false;
  }
}

async function main() {
  if (!MANIFEST || !CORPUS) {
    console.error('usage: --manifest <file> --corpus <dir> [--dry-run] [--limit N] [--refs a,b]');
    process.exit(2);
  }

  let refs = fs
    .readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ONLY.length) refs = refs.filter((r) => ONLY.includes(r));
  if (LIMIT > 0) refs = refs.slice(0, LIMIT);

  // Plan first, and refuse the whole run if ANY key would fall outside lp612/.
  const plan = [];
  let missing = 0;
  let bytes = 0;
  for (const ref of refs) {
    const key = Serving.assertKeyInPrefix(keyForRef(ref)); // throws outside lp612/
    const p = pathForRef(CORPUS, ref);
    if (!fs.existsSync(p)) {
      missing += 1;
      continue;
    }
    const size = fs.statSync(p).size;
    bytes += size;
    plan.push({ ref, key, path: p, size });
  }

  console.log(`refs in manifest : ${refs.length}`);
  console.log(`  on disk        : ${plan.length}`);
  console.log(`  MISSING        : ${missing}`);
  console.log(`  bytes          : ${bytes.toLocaleString()} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  every key passed assertKeyInPrefix`);
  if (DRY) {
    console.log('\nDRY RUN — nothing written. Sample keys:');
    for (const r of plan.slice(0, 5)) console.log(`  ${r.key}  (${r.size} B)`);
    return;
  }

  let up = 0;
  let skip = 0;
  let fail = 0;
  let sent = 0;
  let idx = 0;
  async function worker() {
    while (idx < plan.length) {
      const it = plan[idx++];
      try {
        if (await alreadyThere(it.key, it.size)) {
          skip += 1;
        } else {
          await uploadBuffer(fs.readFileSync(it.path), it.key, 'image/jpeg');
          up += 1;
          sent += it.size;
        }
      } catch (e) {
        fail += 1;
        console.error(`  FAIL ${it.key}: ${e.message}`);
      }
      const done = up + skip + fail;
      if (done % 250 === 0) console.log(`  … ${done}/${plan.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  console.log(`\nuploaded ${up}, skipped ${skip} (already present), failed ${fail}`);
  console.log(`bytes sent: ${sent.toLocaleString()} (${(sent / 1024 / 1024).toFixed(1)} MB)`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
