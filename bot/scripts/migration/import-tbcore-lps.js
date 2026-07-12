// Import NBF + Taleemabad lesson plans from Taleemabad prod Postgres
// (fde_production schema) into NIETE-Rumi Supabase's curriculum_lp_ast table.
//
// Usage:
//   node import-tbcore-lps.js --dry-run          # print the plan + first 3 rows, no writes
//   node import-tbcore-lps.js                     # execute the import
//   node import-tbcore-lps.js --publisher=NBF     # scope filter
//   node import-tbcore-lps.js --limit=100         # cap rows (dev only)
//
// Idempotency: upserts on source_lp_uuid. source_hash lets a re-run skip
// rows that haven't changed at source (short-circuit).
//
// Resumability: writes /tmp/import-tbcore-lps.log.jsonl — one line per LP with
// {source_lp_uuid, action: 'insert'|'update'|'skip'|'error', batch, ts}.
// If a run dies mid-batch, subsequent runs pick up idempotently.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DRY_RUN = !!args['dry-run'];
const PUBLISHER_FILTER = args.publisher || null;   // 'NBF' | 'Taleemabad' | null (both)
const LIMIT = args.limit ? parseInt(args.limit, 10) : null;
const BATCH_SIZE = 100;
const LOG_PATH = '/tmp/import-tbcore-lps.log.jsonl';

// ---- env loading (from NIETE-Rumi/.env) ----
function loadEnv(p) {
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(process.env.NIETE_ENV_PATH || path.resolve(__dirname, '..', '..', '..', '.env'));

// ---- normalization ----
const GRADE_TO_INT = {
  'Prep': 0,
  'Grade One': 1, 'Grade Two': 2, 'Grade Three': 3, 'Grade Four': 4, 'Grade Five': 5,
};

function slugifySubject(raw) {
  // 'Math' → 'maths' (align with NIETE-Rumi's existing slug convention);
  // everything else → lowercase + spaces to underscores.
  if (raw === 'Math') return 'maths';
  return String(raw).toLowerCase().replace(/\s+/g, '_');
}

function publisherToCurriculumKey(publisher) {
  return publisher === 'NBF' ? 'nbf_snc' : 'taleemabad';
}

function computeSourceHash(row) {
  // Stable hash of the fields we care about — order matters. If any of these
  // change at source, re-import updates the row.
  const payload = JSON.stringify({
    lp_uuid: row.lp_uuid,
    topic: row.topic,
    lp_type: row.lp_type,
    opening_steps: row.opening_steps,
    practice_steps: row.practice_steps,
    explain_steps: row.explain_steps,
    independent_practice_steps: row.independent_practice_steps,
    conclusion_steps: row.conclusion_steps,
    classroom_setup_instructions: row.classroom_setup_instructions,
    homework_instructions: row.homework_instructions,
    videos: row.videos,
    lp_slo: row.lp_slo,
    contains_video: row.contains_video,
    times: [row.opening_time, row.explain_time, row.practice_time, row.independent_practice_time, row.conclusion_time],
    chapter_title: row.chapter_title,
    chapter_number: row.chapter_number,
    lp_index: row.lp_index,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ---- source query ----
const SQL_SOURCE = `
SELECT b.publisher, b.id AS book_id,
       g.label AS grade_label, g.grade_order,
       s.label AS subject_label,
       bc.id AS chapter_id, bc.chapter_number, bc.title AS chapter_title,
       bcl.id AS join_id, bcl.lp_index,
       lp.uuid AS lp_uuid,
       lp.topic, lp.type AS lp_type,
       lp.lp_source, lp.lp_category,
       lp.opening_steps, lp.practice_steps, lp.explain_steps,
       lp.independent_practice_steps, lp.conclusion_steps,
       lp.classroom_setup_instructions, lp.homework_instructions,
       lp.videos, lp.lp_slo, lp.contains_video,
       lp.opening_time, lp.explain_time, lp.practice_time,
       lp.independent_practice_time, lp.conclusion_time
  FROM book_library_book                    b
  JOIN slo_gradesubject                     gs  ON gs.id = b.grade_subject_id
  JOIN slo_grade                             g  ON g.id  = gs.grade_id
  JOIN slo_subject                           s  ON s.id  = gs.subject_id
  JOIN book_library_bookchapter             bc  ON bc.book_id = b.id
  JOIN book_library_bookchapterlessonplan   bcl ON bcl.book_chapter_id = bc.id
  JOIN slo_lessonplan                       lp  ON bcl.lesson_plan_id = lp.id
 WHERE b.is_active = true AND b.status = 'OnProd'
   AND b.publisher IN ('NBF','Taleemabad')
   AND bc.is_active = true AND bc.status = 'OnProd'
   AND bcl.is_active = true
   AND lp.is_active = true
   ${PUBLISHER_FILTER ? "AND b.publisher = $1" : ''}
 ORDER BY b.publisher, g.grade_order, s.label, bc.chapter_number, bcl.lp_index
 ${LIMIT ? `LIMIT ${LIMIT}` : ''}
`;

// ---- transform ----
function transform(row) {
  const gradeInt = GRADE_TO_INT[row.grade_label];
  if (gradeInt === undefined) {
    throw new Error(`Unknown grade_label "${row.grade_label}" for lp_uuid ${row.lp_uuid}`);
  }
  const subject = slugifySubject(row.subject_label);
  return {
    source_lp_uuid: row.lp_uuid,
    source_book_id: row.book_id,
    source_chapter_id: row.chapter_id,
    source_join_id: row.join_id,
    publisher: row.publisher,
    curriculum_key: publisherToCurriculumKey(row.publisher),
    grade: gradeInt,
    grade_label: row.grade_label,
    subject,
    subject_label: row.subject_label,
    chapter_number: row.chapter_number,
    chapter_title: row.chapter_title,
    lp_index: row.lp_index,
    topic: row.topic,
    lp_type: row.lp_type,
    lp_source: row.lp_source,
    lp_category: row.lp_category,
    opening_steps: row.opening_steps,
    practice_steps: row.practice_steps,
    explain_steps: row.explain_steps,
    independent_practice_steps: row.independent_practice_steps,
    conclusion_steps: row.conclusion_steps,
    classroom_setup_instructions: row.classroom_setup_instructions,
    homework_instructions: row.homework_instructions,
    videos: row.videos || [],
    lp_slo: row.lp_slo || [],
    contains_video: !!row.contains_video,
    opening_time: row.opening_time,
    explain_time: row.explain_time,
    practice_time: row.practice_time,
    independent_practice_time: row.independent_practice_time,
    conclusion_time: row.conclusion_time,
    source_hash: computeSourceHash(row),
  };
}

// ---- main ----
async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
  if (PUBLISHER_FILTER) console.log(`Publisher filter: ${PUBLISHER_FILTER}`);
  if (LIMIT) console.log(`Row limit: ${LIMIT}`);
  console.log(`Log: ${LOG_PATH}`);
  console.log();

  // Reset log for this run (append-safe: the log is per-run)
  if (!DRY_RUN) fs.writeFileSync(LOG_PATH, '');

  // --- 1. Source connection + fetch ---
  const src = new Client({
    host: process.env.TALEEMABAD_DB_HOST,
    port: parseInt(process.env.TALEEMABAD_DB_PORT, 10),
    database: process.env.TALEEMABAD_DB_NAME,
    user: process.env.TALEEMABAD_DB_USER,
    password: process.env.TALEEMABAD_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await src.connect();
  await src.query(`SET search_path TO ${process.env.TALEEMABAD_DB_SCHEMA}, public`);

  console.log('Fetching from Taleemabad prod...');
  const t0 = Date.now();
  const params = PUBLISHER_FILTER ? [PUBLISHER_FILTER] : [];
  const { rows } = await src.query(SQL_SOURCE, params);
  const fetchMs = Date.now() - t0;
  console.log(`Fetched ${rows.length} rows in ${fetchMs}ms`);
  await src.end();

  // --- 2. Transform ---
  const transformed = rows.map(transform);
  const distribution = transformed.reduce((acc, r) => {
    const k = `${r.publisher}/${r.grade_label}/${r.subject_label}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byPublisher = transformed.reduce((acc, r) => {
    acc[r.publisher] = (acc[r.publisher] || 0) + 1;
    return acc;
  }, {});

  console.log();
  console.log('=== Distribution ===');
  console.log('Publisher:', byPublisher);
  console.log(`Distinct (publisher × grade × subject) combos: ${Object.keys(distribution).length}`);
  console.log();

  // Precompute the dedupe target so both dry-run and live see the same numbers.
  const seenNK = new Set();
  const nkDupes = [];
  for (const r of transformed) {
    const k = `${r.source_chapter_id}:${r.source_lp_uuid}`;
    if (seenNK.has(k)) { nkDupes.push(r); continue; }
    seenNK.add(k);
  }
  console.log(`Natural-key check: ${transformed.length} raw → ${seenNK.size} unique on (source_chapter_id, source_lp_uuid); ${nkDupes.length} in-batch dupes ${nkDupes.length ? '(will be dropped on write)' : ''}`);
  console.log();

  // --- 3. Dry-run: show first 3 sample rows, no writes ---
  if (DRY_RUN) {
    console.log('=== First 3 rows (dry-run sample) ===');
    for (const r of transformed.slice(0, 3)) {
      console.log(`  ${r.publisher}/${r.grade_label}/${r.subject_label} Ch${r.chapter_number}#${r.lp_index}`);
      console.log(`    topic: "${r.topic}"`);
      console.log(`    curriculum_key=${r.curriculum_key} grade=${r.grade} subject=${r.subject}`);
      console.log(`    steps=${['opening','practice','explain','independent_practice','conclusion'].map(k => (r[`${k}_steps`] || []).length).join('/')}  video=${r.contains_video}`);
      console.log(`    source_hash=${r.source_hash.slice(0, 16)}...`);
    }
    console.log();
    console.log('DRY-RUN complete. No writes performed.');
    return;
  }

  // --- 4. Live write: upsert in batches ---
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Belt-and-suspenders: dedupe on the natural key (source_chapter_id, source_lp_uuid)
  // within the transformed set, keeping the first occurrence. The source table has
  // UNIQUE (book_chapter_id, lesson_plan_id) via Django's unique_together so this
  // shouldn't fire — but if it does, Supabase batch upsert would reject the whole batch.
  const seen = new Set();
  const dedupedRows = [];
  let dropped = 0;
  for (const r of transformed) {
    const k = `${r.source_chapter_id}:${r.source_lp_uuid}`;
    if (seen.has(k)) { dropped++; continue; }
    seen.add(k);
    dedupedRows.push(r);
  }
  if (dropped > 0) console.log(`[warn] Dropped ${dropped} in-batch duplicates on natural key`);

  let inserted = 0, updated = 0, errored = 0;
  const batches = [];
  for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
    batches.push(dedupedRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`Writing ${dedupedRows.length} rows in ${batches.length} batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const t1 = Date.now();
    const { data, error } = await sb
      .from('curriculum_lp_ast')
      .upsert(batch, { onConflict: 'source_chapter_id,source_lp_uuid', ignoreDuplicates: false })
      .select('source_lp_uuid');

    const ms = Date.now() - t1;
    if (error) {
      errored += batch.length;
      console.error(`  Batch ${i + 1}/${batches.length} FAILED (${ms}ms): ${error.message}`);
      for (const r of batch) {
        fs.appendFileSync(LOG_PATH, JSON.stringify({
          source_lp_uuid: r.source_lp_uuid, action: 'error', batch: i + 1,
          error: error.message, ts: new Date().toISOString(),
        }) + '\n');
      }
    } else {
      // Supabase upsert doesn't tell us insert-vs-update per row, but the count is exact.
      const affected = (data || []).length;
      inserted += affected;
      console.log(`  Batch ${i + 1}/${batches.length}: ${affected} upserted (${ms}ms)`);
      for (const r of batch) {
        fs.appendFileSync(LOG_PATH, JSON.stringify({
          source_lp_uuid: r.source_lp_uuid, action: 'upsert', batch: i + 1,
          ts: new Date().toISOString(),
        }) + '\n');
      }
    }
  }

  console.log();
  console.log('=== Import summary ===');
  console.log(`Upserted (insert or update): ${inserted}`);
  console.log(`Errored:                     ${errored}`);
  console.log(`Log written to:              ${LOG_PATH}`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
