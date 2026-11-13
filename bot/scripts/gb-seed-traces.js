'use strict';
/**
 * Store each seeded GB lesson's traces beside its PDF in GB's own lane (bd-rj6w0n.14.16.18).
 *
 * Reads the manifest the offline build writes (gb_trace_manifest.py: one row per seeded lesson, with
 * {segment_id, lang, files: {html, lp.json, card.json, moves.json}}, a trace not on disk being null), checks every
 * file reads and parses, then — only with --commit — uploads each to gb-lp/<tv>/<lang>/<segment_id>.<ext>, beside
 * the PDF gb-seed-renders.js put there. The raw v9 HTML is what the quiz reads; the card and moves docs feed live
 * moves; the lp.json is the v9 lp_doc.
 *
 * R2 only: no DB row is written (the PDF seed already wrote niete_gb_lp_renders). Never an lp612/ key
 * (GbLane.assertGbKey on every key). Idempotent: re-running re-uploads the same bytes to the same keys. Any bad
 * file stops the commit before one upload; a missing trace is reported and skipped.
 *
 *   node bot/scripts/gb-seed-traces.js <manifest.json> [--tv gb_k5_v10] [--commit]
 *   node bot/scripts/gb-seed-traces.js --list [--tv gb_k5_v10]     count gb-lp/<tv>/ keys per type in R2
 */
const fs = require('fs');
const GbLane = require('../shared/services/gb-lp-serving.service');
const { SEGMENT, LANGS } = require('./gb-seed-renders');

const TYPES = {
  html: 'text/html', 'lp.json': 'application/json', 'card.json': 'application/json', 'moves.json': 'application/json',
};
const EXTS = Object.keys(TYPES);
const zero = () => Object.fromEntries(EXTS.map((e) => [e, 0]));

/** {items: [{segmentId, lang, ext, path, key, contentType}], missing: [{segmentId, lang, ext}]}; throws on a bad row. */
function plan(manifest, tv) {
  const items = [];
  const missing = [];
  for (const row of manifest.rows || []) {
    if (!SEGMENT.test(String(row.segment_id || ''))) throw new Error(`not a GB grade 1-5 segment: ${row.segment_id}`);
    if (!LANGS.has(row.lang)) throw new Error(`bad lang for ${row.segment_id}: ${row.lang}`);
    for (const ext of EXTS) {
      const path = (row.files || {})[ext];
      const at = { segmentId: row.segment_id, lang: row.lang, ext };
      if (!path) { missing.push(at); continue; }
      const key = GbLane.assertGbKey(GbLane.keyFor(row.segment_id, row.lang, tv, ext));
      items.push({ ...at, path, key, contentType: TYPES[ext] });
    }
  }
  return { items, missing };
}

/** Problems with one trace file; [] when it reads and is the kind of file its extension says. */
function verify(item, readFile) {
  let buf;
  try { buf = readFile(item.path); } catch (err) { return [`unreadable: ${err.message}`]; }
  if (!buf || !buf.length) return ['empty'];
  if (item.ext === 'html') {
    return /<!doctype html|<html/i.test(buf.subarray(0, 4096).toString('utf8')) ? [] : ['not HTML'];
  }
  try { JSON.parse(buf.toString('utf8')); } catch { return ['not JSON']; }
  return [];
}

async function run({ manifest, tv, commit, readFile, upload, log = () => {} }) {
  const { items, missing } = plan(manifest, tv);
  const out = {
    lessons: (manifest.rows || []).length, planned: items.length, bad: 0, uploaded: 0, found: zero(), missing: zero(),
  };
  items.forEach((i) => { out.found[i.ext] += 1; });
  missing.forEach((m) => { out.missing[m.ext] += 1; log(`MISSING ${m.segmentId} ${m.lang} ${m.ext}`); });
  const bad = items.map((i) => ({ i, problems: verify(i, readFile) })).filter((x) => x.problems.length);
  bad.forEach(({ i, problems }) => log(`BAD ${i.segmentId} ${i.ext}: ${problems.join(', ')} (${i.path})`));
  out.bad = bad.length;
  if (!commit || bad.length) return out;
  for (const i of items) {
    await upload(readFile(i.path), GbLane.assertGbKey(i.key), i.contentType);
    out.uploaded += 1;
    log(`ok ${i.key}`);
  }
  return out;
}

/** Listed keys counted per type (pdf + the four traces) — the after-check on R2. */
function countKeys(keys) {
  const out = { pdf: 0, ...zero() };
  for (const k of keys) {
    const ext = ['pdf', ...EXTS].find((e) => k.endsWith(`.${e}`));
    if (ext) out[ext] += 1;
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const tvAt = argv.indexOf('--tv');
  const file = argv.find((a, n) => !a.startsWith('--') && argv[n - 1] !== '--tv');
  const r2 = () => require('../shared/storage/r2');
  if (argv.includes('--list')) {
    const tv = tvAt >= 0 ? argv[tvAt + 1] : GbLane.templateVersion();
    const prefix = GbLane.assertGbKey(`${GbLane.R2_PREFIX}${tv}/`);
    const counts = countKeys(await r2().listKeys(prefix));
    console.log(`R2 ${prefix}: ${JSON.stringify(counts)}`);
    return counts;
  }
  if (!file) throw new Error('usage: gb-seed-traces.js <manifest.json> [--tv gb_k5_v10] [--commit] | --list [--tv ..]');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tv = tvAt >= 0 ? argv[tvAt + 1] : (manifest.template_version || GbLane.templateVersion());
  const commit = argv.includes('--commit');
  const upload = commit ? r2().uploadBuffer : null;
  const out = await run({ manifest, tv, commit, readFile: (p) => fs.readFileSync(p), upload, log: console.log });
  console.log(`${commit ? 'COMMIT' : 'DRY RUN'} tv=${tv}: ${out.lessons} lessons, ${out.planned} traces planned, `
    + `found ${JSON.stringify(out.found)}, missing ${JSON.stringify(out.missing)}, ${out.bad} bad, ${out.uploaded} uploaded`);
  if (out.bad) process.exitCode = 1;
  return out;
}

module.exports = { plan, verify, run, countKeys, main, TYPES };

if (require.main === module) {
  main().catch((err) => {
    console.error(`gb traces seed failed: ${err.message}`);
    process.exit(1);
  });
}
