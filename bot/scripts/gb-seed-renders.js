// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * Seed the built GB v9 plans into GB's own lane (bd-rj6w0n.14.16.11).
 *
 * Reads the manifest the offline build writes (gb_seed_manifest.py: one row per send=true lesson, with
 * {segment_id, lang, pdf, bytes, sha256}), checks every PDF is the file the gate passed, then — only with
 * --commit — uploads each to gb-lp/<tv>/<lang>/<segment_id>.pdf and upserts its niete_gb_lp_renders row
 * as ready. A GB teacher's tap on one of these lessons is then a cache hit on GB's lane.
 *
 * Never an lp612/ key (GbLane.assertGbKey on every key) and never an lp612 table. Idempotent: re-running
 * re-uploads the same bytes and rewrites the same rows. Any bad file stops the commit before one upload.
 *
 *   node bot/scripts/gb-seed-renders.js <manifest.json> [--tv gb_k5_v9] [--commit]
 */
const fs = require('fs');
const GbLane = require('../shared/services/gb-lp-serving.service');

const SEGMENT = /^nbf_snc_grade_[1-5]_[a-z_]+\.c\d{2}\.s\d{3}$/;
const LANGS = new Set(['en', 'ur']);

/** [{segmentId, lang, key, row}] — throws on any row that is not a GB grade 1-5 lesson. */
function plan(manifest, tv) {
  return (manifest.rows || []).map((row) => {
    if (!SEGMENT.test(String(row.segment_id || ''))) throw new Error(`not a GB grade 1-5 segment: ${row.segment_id}`);
    if (!LANGS.has(row.lang)) throw new Error(`bad lang for ${row.segment_id}: ${row.lang}`);
    const key = GbLane.assertGbKey(GbLane.keyFor(row.segment_id, row.lang, tv));
    return { segmentId: row.segment_id, lang: row.lang, key, row };
  });
}

/** Problems with one row's file; [] when it is the PDF the gate passed. */
function verify(row, readFile) {
  let buf;
  try { buf = readFile(row.pdf); } catch (err) { return [`unreadable: ${err.message}`]; }
  const problems = [];
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') problems.push('not a PDF');
  if (buf.length !== row.bytes) problems.push('size differs');
  const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
  if (sha !== row.sha256 && !problems.includes('not a PDF')) problems.push('sha256 differs');
  return problems;
}

async function run({ manifest, tv, commit, readFile, upload, db, log = () => {} }) {
  const items = plan(manifest, tv);
  const bad = items.map((i) => ({ i, problems: verify(i.row, readFile) })).filter((x) => x.problems.length);
  bad.forEach(({ i, problems }) => log(`BAD ${i.segmentId}: ${problems.join(', ')} (${i.row.pdf})`));
  const out = { planned: items.length, bad: bad.length, written: 0 };
  if (!commit || bad.length) return out;
  for (const i of items) {
    await upload(readFile(i.row.pdf), i.key, 'application/pdf');
    const now = new Date().toISOString();
    const { error } = await db.from(GbLane.RENDERS).upsert({
      segment_id: i.segmentId, lang: i.lang, template_version: tv, status: 'ready', r2_key: i.key,
      model_used: 'offline_gb_v9_gate', lint_clean: true, waiters: [], error_code: null, error_detail: null,
      completed_at: now, updated_at: now,
    }, { onConflict: 'segment_id,lang,template_version' });
    if (error) throw new Error(`row for ${i.segmentId} not written: ${error.message}`);
    out.written += 1;
    log(`ok ${i.key}`);
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--tv');
  if (!file) throw new Error('usage: gb-seed-renders.js <manifest.json> [--tv gb_k5_v9] [--commit]');
  const tvAt = argv.indexOf('--tv');
  const tv = tvAt >= 0 ? argv[tvAt + 1] : GbLane.templateVersion();
  const commit = argv.includes('--commit');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deps = commit
    ? { upload: require('../shared/storage/r2').uploadBuffer, db: require('../shared/config/supabase') }
    : { upload: null, db: null };
  const out = await run({ manifest, tv, commit, readFile: (p) => fs.readFileSync(p), ...deps, log: console.log });
  console.log(`${commit ? 'COMMIT' : 'DRY RUN'} tv=${tv}: ${out.planned} planned, ${out.bad} bad, ${out.written} written`);
  if (out.bad) process.exitCode = 1;
  return out;
}

module.exports = { plan, verify, run, main };

if (require.main === module) {
  main().catch((err) => {
    console.error(`gb seed failed: ${err.message}`);
    process.exit(1);
  });
}
