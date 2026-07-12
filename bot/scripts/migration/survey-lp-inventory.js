// One-shot inventory of ALL lesson-plan corpora we can currently see —
// both from NIETE-Rumi's own Supabase and from taleemabad-core's prod DB
// (the source the current import was drawn from).
//
// Output: markdown-style summary of publishers / curricula / counts /
// enabled-ness so we can plan the next import wave (external orgs).
//
// Usage:
//   NIETE_ENV_PATH=/path/to/.env node survey-lp-inventory.js

const path = require('path');
const fs = require('fs');
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

const supabase = require('../../shared/config/supabase');
// Lazy pg require — this bot doesn't ship pg, but the dashboard dir does.
// The taleemabad-core section is optional; if pg isn't installed we skip it.
let pgClient;
try { pgClient = require('pg').Client; } catch (_) { pgClient = null; }

(async () => {
  console.log('=== LP INVENTORY SURVEY ===\n');

  // ── 1. NIETE-Rumi Supabase: curriculum_lp_ast ──────────────────────────
  console.log('── NIETE-Rumi Supabase: curriculum_lp_ast ──');
  const { data: astRows, error: astErr } = await supabase
    .from('curriculum_lp_ast')
    .select('publisher, curriculum_key, grade, subject, is_enabled, pdf_r2_key_en, pdf_r2_key_ur');
  if (astErr) { console.error('AST error:', astErr.message); process.exit(1); }
  const astByPubCur = {};
  for (const r of astRows) {
    const k = `${r.publisher} · ${r.curriculum_key}`;
    astByPubCur[k] = astByPubCur[k] || { total: 0, enabled: 0, cached_en: 0, cached_ur: 0, grades: new Set(), subjects: new Set() };
    astByPubCur[k].total += 1;
    if (r.is_enabled) astByPubCur[k].enabled += 1;
    if (r.pdf_r2_key_en) astByPubCur[k].cached_en += 1;
    if (r.pdf_r2_key_ur) astByPubCur[k].cached_ur += 1;
    astByPubCur[k].grades.add(r.grade);
    astByPubCur[k].subjects.add(r.subject);
  }
  for (const [k, v] of Object.entries(astByPubCur).sort()) {
    console.log(`  ${k}: ${v.total} LPs (${v.enabled} enabled, ${v.cached_en} en cached, ${v.cached_ur} ur cached)`);
    console.log(`    grades: ${[...v.grades].sort().join(',')}  subjects: ${[...v.subjects].sort().join(',')}`);
  }

  // ── 2. NIETE-Rumi: does pre_generated_lps table exist here? ────────────
  console.log('\n── NIETE-Rumi Supabase: pre_generated_lps ──');
  const { data: preRows, error: preErr } = await supabase
    .from('pre_generated_lps')
    .select('curriculum_key, grade, subject, chapter_number, pdf_r2_key_en')
    .limit(500);
  if (preErr) {
    console.log(`  (table missing or restricted: ${preErr.message})`);
  } else {
    const preByCur = {};
    for (const r of preRows) {
      const k = r.curriculum_key;
      preByCur[k] = preByCur[k] || { total: 0, cached: 0, grades: new Set(), subjects: new Set() };
      preByCur[k].total += 1;
      if (r.pdf_r2_key_en) preByCur[k].cached += 1;
      preByCur[k].grades.add(r.grade);
      preByCur[k].subjects.add(r.subject);
    }
    for (const [k, v] of Object.entries(preByCur).sort()) {
      console.log(`  ${k}: ${v.total} rows (${v.cached} cached)  grades: ${[...v.grades].sort().join(',')}  subjects: ${[...v.subjects].sort().join(',')}`);
    }
    if (!Object.keys(preByCur).length) console.log('  (no rows)');
  }

  // ── 3. NIETE-Rumi: textbook_toc for chapter indexing ───────────────────
  console.log('\n── NIETE-Rumi Supabase: textbook_toc (chapter indexing) ──');
  const { data: tocRows, error: tocErr } = await supabase
    .from('textbook_toc')
    .select('curriculum_key, grade, subject')
    .limit(5000);
  if (tocErr) {
    console.log(`  (${tocErr.message})`);
  } else {
    const tocByCur = {};
    for (const r of tocRows) {
      const k = r.curriculum_key;
      tocByCur[k] = tocByCur[k] || { total: 0, grades: new Set(), subjects: new Set() };
      tocByCur[k].total += 1;
      tocByCur[k].grades.add(r.grade);
      tocByCur[k].subjects.add(r.subject);
    }
    for (const [k, v] of Object.entries(tocByCur).sort()) {
      console.log(`  ${k}: ${v.total} chapters  grades: ${[...v.grades].sort().join(',')}  subjects: ${[...v.subjects].sort().join(',')}`);
    }
  }

  // ── 4. taleemabad-core prod DB: what publishers / states did we NOT import? ──
  console.log('\n── taleemabad-core prod DB: LP publishers + states ──');
  const TBCORE_HOST = process.env.TALEEMABAD_DB_HOST;
  const TBCORE_USER = process.env.TALEEMABAD_DB_USER;
  const TBCORE_PASS = process.env.TALEEMABAD_DB_PASSWORD;
  const TBCORE_NAME = process.env.TALEEMABAD_DB_NAME;
  const TBCORE_PORT = process.env.TALEEMABAD_DB_PORT || 5432;
  if (!TBCORE_HOST) {
    console.log('  (TALEEMABAD_DB_* env vars not set — skipping)');
  } else if (!pgClient) {
    console.log('  (pg module not installed in this dir — run from bot/../dashboard or similar)');
  } else {
    const client = new pgClient({
      host: TBCORE_HOST, port: TBCORE_PORT, database: TBCORE_NAME,
      user: TBCORE_USER, password: TBCORE_PASS, ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      const pubStats = await client.query(`
        SELECT b.publisher, lp.state, COUNT(DISTINCT lp.id) AS lp_count
        FROM curriculum_lessonplan lp
        JOIN curriculum_chapter c ON lp.chapter_id = c.id
        JOIN curriculum_book b ON c.book_id = b.id
        WHERE lp.deleted_at IS NULL
        GROUP BY b.publisher, lp.state
        ORDER BY b.publisher, lp.state`);
      let currentPub = null;
      for (const r of pubStats.rows) {
        if (r.publisher !== currentPub) {
          console.log(`\n  ${r.publisher}:`);
          currentPub = r.publisher;
        }
        console.log(`    ${r.state.padEnd(20)} ${r.lp_count}`);
      }
      // Non-shipping LPs we didn't take
      const notImported = await client.query(`
        SELECT b.publisher, COUNT(DISTINCT lp.id) AS lp_count
        FROM curriculum_lessonplan lp
        JOIN curriculum_chapter c ON lp.chapter_id = c.id
        JOIN curriculum_book b ON c.book_id = b.id
        WHERE lp.deleted_at IS NULL
          AND lp.state != 'shipping'
        GROUP BY b.publisher
        ORDER BY lp_count DESC`);
      console.log('\n  ── Non-shipping (NOT imported) ──');
      for (const r of notImported.rows) console.log(`    ${r.publisher.padEnd(30)} ${r.lp_count} LPs`);
      await client.end();
    } catch (e) {
      console.log(`  connection failed: ${e.message}`);
    }
  }

  console.log('\n=== END SURVEY ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
