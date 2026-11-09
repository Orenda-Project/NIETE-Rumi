#!/usr/bin/env node
// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (bd-42mo0w, audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * Sync a region's lesson plans from its curriculum sheet (bd-97daxo.14). Today: Gilgit-Baltistan, from Amena's
 * GB Curriculum Matrix. Re-runnable: run it after every batch she finishes.
 *
 *   node bot/scripts/sync-sheet-lps.js --config gb --env sandbox|staging|prod [mode] [options]
 *
 * MODES (one per run)
 *   (default)        lesson PDFs + answer keys → NIETE's R2 + niete_lp_assets. New and re-rendered PDFs go up as a
 *                    new version (the old one stays in R2 and on record); unchanged ones are skipped by the content
 *                    hash in their URL; a lesson gone from the sheet is REPORTED and stays live.
 *   --retire <id>    stop serving one lesson (every asset kind). The only way a lesson leaves the menu.
 *   --catalog        rewrite GB's books in bot/data/lp_catalog.json from the sheet (a code change: PR it).
 *                    With --check, exit 1 if the committed catalog is behind the sheet.
 *   --books          write the region's book list (region_features.book_keys) from the Books tab.
 *
 * OPTIONS
 *   --commit         write. WITHOUT IT NOTHING IS WRITTEN: the default is a dry run that reports what it would do.
 *   --prod-go "<the operator's words>"   required for --env prod, every mode, and recorded in the report.
 *   --xlsx <file>    read a saved export instead of downloading the sheet.
 *   --env-file <f>   default: <repo>/.env.sandbox | .env.stage | .env.prod (checked against the project ref).
 *   --out <dir>      where the report goes (JSON + Markdown); default: a temp dir, printed.
 *   --only <book>    limit the asset sync to one book key; --limit <n> to the first n uploads.
 *
 * Teachers never depend on Amena's bucket: every PDF is copied into NIETE's own R2 (lp-cache/v8/<lesson>/<hash>.pdf).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const Workbook = require('./sheet-lps/workbook');
const Matrix = require('./sheet-lps/matrix');

const CONFIGS = { gb: () => require('./sheet-lps/gb.config') };
const PROJECT_REF = { sandbox: 'olvritwoqujtjvwfulbh', staging: 'rpqkekcfvumypldbejhp', prod: 'ihzciabopbttygxxgrkm' };
const ENV_FILE = { sandbox: '.env.sandbox', staging: '.env.stage', prod: '.env.prod' };
const REPO_ROOT = path.join(__dirname, '..', '..');
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'lp_catalog.json');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

// ── guards ──────────────────────────────────────────────────────────────────

function checkEnv({ env, prodGo } = {}) {
  if (!PROJECT_REF[env]) throw new Error(`--env must be sandbox, staging or prod (got "${env}")`);
  if (env === 'prod' && !(typeof prodGo === 'string' && prodGo.trim())) {
    throw new Error('REFUSING prod without --prod-go "<the operator\'s go, in their words>"');
  }
  return true;
}

function assertProject(env, supabaseUrl) {
  const ref = PROJECT_REF[env];
  if (!ref || !String(supabaseUrl || '').includes(`${ref}.supabase.co`)) {
    throw new Error(`REFUSING: the env file's SUPABASE_URL is not the ${env} project (${ref})`);
  }
  return true;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) throw new Error(`env file not found: ${file} (pass --env-file)`);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

// ── planning (pure) ─────────────────────────────────────────────────────────

/**
 * What each sheet item needs, against the CURRENT rows on record.
 * unchanged = the current row's source_sha1 starts with the URL's content hash (Amena's renders/<sha1[0:8]>/ dir),
 * so a re-run downloads nothing it already has. removed = a current lesson the sheet no longer links: reported,
 * never retired here.
 */
function plan(items, currentRows) {
  const current = new Map();
  for (const r of currentRows || []) if (r.is_current) current.set(`${r.lesson_id}|${r.asset_kind || 'lesson'}`, r);
  const out = { new: [], changed: [], unchanged: [], removed: [] };
  const seen = new Set();
  for (const item of items) {
    const k = `${item.lesson_id}|${item.asset_kind}`;
    seen.add(k);
    const cur = current.get(k);
    if (!cur) out.new.push(item);
    else if (cur.source_sha1 && String(cur.source_sha1).startsWith(item.url_hash)) out.unchanged.push(item);
    else out.changed.push({ ...item, current: { id: cur.id, version_stamp: cur.version_stamp || null } });
  }
  for (const [k, r] of current) if (!seen.has(k)) out.removed.push({ lesson_id: r.lesson_id, asset_kind: r.asset_kind || 'lesson', id: r.id, version_stamp: r.version_stamp || null });
  out.counts = { new: out.new.length, changed: out.changed.length, unchanged: out.unchanged.length, removed: out.removed.length };
  return out;
}

// ── reading what is on record ───────────────────────────────────────────────

async function currentRows(supabase, prefix) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('niete_lp_assets')
      .select('id, lesson_id, asset_kind, content_hash, source_sha1, version_stamp, is_current')
      .eq('catalog_version', 'v8').eq('is_current', true)
      .order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`reading niete_lp_assets: ${error.message || error}`);
    for (const r of data || []) if (String(r.lesson_id).startsWith(`${prefix}_`)) out.push(r);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ── executing ───────────────────────────────────────────────────────────────

async function download(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res || !res.ok) throw new Error(`download answered HTTP ${res ? res.status : '?'}`);
  return Buffer.from(await res.arrayBuffer());
}

async function pool(list, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < list.length) {
      const item = list[i];
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Plan, and with commit write: download → verify the bytes against the URL's hash → R2 + niete_lp_assets through
 * upload-lp-v8-to-r2's planFor/persistAssetRow (supersede-then-insert; same bytes again = reinstate).
 * deps: { supabase, r2, fetch, log } — tests pass fakes; the CLI passes the real ones.
 */
async function execute(m, { commit = false, prefix = 'gb', only = null, limit = null, concurrency = 6, deps = {} } = {}) {
  const supabase = deps.supabase || require('../shared/config/supabase');
  const log = deps.log || console.log;
  const items = only ? m.items.filter((i) => i.book_key === only) : m.items;
  const p = plan(items, await currentRows(supabase, prefix));
  const result = { ...p, written: [], failed: [], skipped: [] };
  const todo = [...p.new, ...p.changed].slice(0, limit == null ? undefined : Number(limit));
  if (!commit) {
    result.counts = { ...p.counts, written: 0, failed: 0 };
    return result;
  }
  const Up = require('./upload-lp-v8-to-r2');
  const r2 = deps.r2 || require('../shared/storage/r2');
  const fetchImpl = deps.fetch || globalThis.fetch;
  const persistDeps = {
    supabase, r2, log: () => {},
    fs: { existsSync: () => false }, // GB has no slide script here: no quiz source is recorded (none to bind)
    sourceStore: { upsertSource: async () => {} },
  };
  await pool(todo, concurrency, async (item) => {
    try {
      const bytes = await download(item.url, fetchImpl);
      const sourceSha = sha1(bytes);
      if (!sourceSha.startsWith(item.url_hash)) {
        throw new Error(`content hash mismatch: the URL says ${item.url_hash}, the bytes are ${sourceSha.slice(0, 8)}`);
      }
      const hash = Up.contentHash(bytes);
      const { data: history, error } = await supabase.from('niete_lp_assets')
        .select('id, lesson_id, asset_kind, content_hash, source_sha1, is_current')
        .eq('lesson_id', item.lesson_id);
      if (error) throw new Error(`reading ${item.lesson_id}: ${error.message || error}`);
      const row = { lesson_id: item.lesson_id, asset_kind: item.asset_kind, source_sha1: sourceSha,
        version_stamp: item.version_stamp, prompt_layer_sha: null, rendered_at: null };
      const planned = Up.planFor(row, hash, history || []);
      if (planned.action === 'skip') { result.skipped.push({ lesson_id: item.lesson_id, asset_kind: item.asset_kind }); return; }
      const res = await Up.persistAssetRow({ item: row, plan: planned, hash, buffer: bytes, sourceBytes: bytes.length,
        pdfPath: null, commit: true, deps: persistDeps });
      result.written.push({ lesson_id: item.lesson_id, asset_kind: item.asset_kind, action: res.action, r2_key: planned.r2_key, version_stamp: item.version_stamp });
      log(`  ✓ ${res.action.padEnd(11)} ${item.lesson_id}${item.asset_kind === 'lesson' ? '' : ` (${item.asset_kind})`}`);
    } catch (err) {
      result.failed.push({ lesson_id: item.lesson_id, asset_kind: item.asset_kind, url: item.url, error: err.message });
      log(`  ✗ ${item.lesson_id} ${item.asset_kind}: ${err.message}`);
    }
  });
  result.counts = { ...p.counts, written: result.written.length, failed: result.failed.length };
  return result;
}

/** Stop serving one lesson: every current asset of it is superseded (kept in R2 and on record). */
async function retire(lessonId, { commit = false, prefix = 'gb', deps = {} } = {}) {
  if (!String(lessonId || '').startsWith(`${prefix}_`)) throw new Error(`--retire only touches ${prefix}_ lessons (got "${lessonId}")`);
  const supabase = deps.supabase || require('../shared/config/supabase');
  const { data, error } = await supabase.from('niete_lp_assets').select('id, asset_kind').eq('lesson_id', lessonId).eq('is_current', true);
  if (error) throw new Error(error.message || String(error));
  const rows = data || [];
  if (commit) {
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      const { error: e } = await supabase.from('niete_lp_assets')
        .update({ is_current: false, superseded_at: new Date().toISOString() }).eq('id', r.id);
      if (e) throw new Error(`retiring ${r.id}: ${e.message || e}`);
    }
  }
  return { lesson_id: lessonId, retired: rows.length, kinds: rows.map((r) => r.asset_kind), commit };
}

// ── --catalog ───────────────────────────────────────────────────────────────

/** The committed catalog with this sheet's books in place of the region's old ones. Deterministic. */
function catalogWith(catalog, books, prefix) {
  const kept = catalog.books.filter((b) => !String(b.stem).startsWith(`${prefix}_`));
  const all = [...kept, ...books].sort((a, b) => (a.grade - b.grade) || a.subject_key.localeCompare(b.subject_key)
    || (Number(Boolean(a.opt_in)) - Number(Boolean(b.opt_in))) || a.stem.localeCompare(b.stem));
  const chapters = all.reduce((n, b) => n + b.chapters.length, 0);
  const lessons = all.reduce((n, b) => n + b.chapters.reduce((x, c) => x + c.lessons.length, 0), 0);
  return { ...catalog, counts: { books: all.length, chapters, lessons }, books: all };
}

// ── report ──────────────────────────────────────────────────────────────────

function markdown(report) {
  const c = report.counts || {};
  const lines = [
    `# Sheet LP sync — ${report.config} · ${report.env} · ${report.mode}${report.commit ? '' : ' (DRY RUN)'}`,
    '',
    `${report.at} · sheet ${report.sheet}${report.prod_go ? ` · prod go: "${report.prod_go}"` : ''}`,
    '',
  ];
  if (report.mode === 'assets') {
    lines.push('| new | changed | unchanged | removed (kept live) | written | failed | pending (no PDF yet) | blockers |',
      '|---|---|---|---|---|---|---|---|',
      `| ${c.new} | ${c.changed} | ${c.unchanged} | ${c.removed} | ${c.written} | ${c.failed} | ${report.pending.length} | ${report.blockers.length} |`, '');
    if (report.per_book) {
      lines.push('## Lessons with a PDF, per book', '', '| book | lessons in sheet | with PDF |', '|---|---|---|');
      for (const b of report.per_book) lines.push(`| ${b.book_key} | ${b.lessons} | ${b.with_pdf} |`);
      lines.push('');
    }
    for (const [title, list] of [['Changed', report.changed], ['Removed from the sheet (still live: --retire to stop)', report.removed],
      ['Failed', report.failed], ['Blockers', report.blockers]]) {
      if (!list || !list.length) continue;
      lines.push(`## ${title} (${list.length})`, '');
      for (const x of list.slice(0, 200)) lines.push(`- ${x.lesson_id || x.segment_id || `${x.tab} G${x.grade} day ${x.day}`}${x.asset_kind && x.asset_kind !== 'lesson' ? ` (${x.asset_kind})` : ''}${x.reason ? ` — ${x.reason}` : ''}${x.error ? ` — ${x.error}` : ''}`);
      if (list.length > 200) lines.push(`- … ${list.length - 200} more in the JSON`);
      lines.push('');
    }
  } else {
    lines.push('```json', JSON.stringify(report.result, null, 2).slice(0, 20000), '```');
  }
  return `${lines.join('\n')}\n`;
}

function writeReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `sync-${report.config}-${report.env}-${report.mode}-${report.at.replace(/[:.]/g, '')}${report.commit ? '' : '-dryrun'}`);
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(`${base}.md`, markdown(report));
  return base;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (['--commit', '--catalog', '--check', '--books'].includes(k)) { a.flags.add(k.slice(2)); continue; }
    if (k.startsWith('--')) { a[k.slice(2)] = argv[i + 1]; i += 1; }
  }
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  const cfgName = a.config || 'gb';
  if (!CONFIGS[cfgName]) throw new Error(`--config must be one of ${Object.keys(CONFIGS).join(', ')}`);
  const cfg = CONFIGS[cfgName]();
  const commit = a.flags.has('commit');
  const mode = a.retire ? 'retire' : a.flags.has('catalog') ? 'catalog' : a.flags.has('books') ? 'books' : 'assets';

  // The catalog is a file in this repo: no environment, no database.
  const needsDb = mode !== 'catalog';
  if (needsDb) {
    checkEnv({ env: a.env, prodGo: a['prod-go'] });
    loadEnvFile(a['env-file'] || path.join(REPO_ROOT, ENV_FILE[a.env]));
    assertProject(a.env, process.env.SUPABASE_URL);
  }

  const at = new Date().toISOString();
  const report = { config: cfgName, env: a.env || null, mode, commit, at, sheet: cfg.sheetId, prod_go: a['prod-go'] || null };
  const outDir = a.out || fs.mkdtempSync(path.join(os.tmpdir(), `sync-sheet-lps-${cfgName}-`));

  if (mode === 'retire') {
    report.result = await retire(a.retire, { commit, prefix: cfg.bookPrefix });
    console.log(`${commit ? 'retired' : 'would retire'} ${report.result.retired} asset(s) of ${a.retire}`);
    console.log(`report: ${writeReport(outDir, report)}.md`);
    return 0;
  }

  const buffer = a.xlsx ? fs.readFileSync(a.xlsx) : await Workbook.fetchPublic(cfg.sheetId);
  const m = Matrix.read(await Workbook.read(buffer), cfg);

  if (mode === 'catalog') {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const books = Matrix.catalogBooks(m, cfg);
    const next = catalogWith(catalog, books, cfg.bookPrefix);
    const text = `${JSON.stringify(next, null, 2)}\n`;
    const current = fs.readFileSync(CATALOG_PATH, 'utf8');
    const summary = books.map((b) => `${b.stem}: ${b.chapters.length} ch, ${b.chapters.reduce((n, c) => n + c.lessons.length, 0)} lessons`);
    if (a.flags.has('check')) {
      if (text !== current) { console.error(`✗ lp_catalog.json is behind the ${cfgName} sheet — run --catalog and PR it`); return 1; }
      console.log(`✓ lp_catalog.json matches the ${cfgName} sheet (${books.length} books)`);
      return 0;
    }
    fs.writeFileSync(CATALOG_PATH, text);
    console.log(`✓ ${CATALOG_PATH}: ${books.length} ${cfgName} books\n  ${summary.join('\n  ')}`);
    return 0;
  }

  if (mode === 'books') {
    const Catalog = require('../shared/services/lp-v8-catalog.service');
    const keys = Matrix.bookKeys(m, cfg, Catalog.shelf(null));
    report.result = { region: cfg.region, book_keys: keys, missing_ict_books: Matrix.bookKeys.lastMissing || [] };
    if (commit) {
      const supabase = require('../shared/config/supabase');
      const { data, error } = await supabase.from('region_features')
        .update({ book_keys: keys, updated_at: new Date().toISOString() }).eq('region', cfg.region).select('region, book_keys');
      if (error) throw new Error(`writing region_features.book_keys: ${error.message}`);
      if (!data || data.length !== 1) throw new Error(`region_features has no row "${cfg.region}" (updated ${data ? data.length : 0})`);
      report.result.written = data[0];
    }
    console.log(`${commit ? 'wrote' : 'would write'} ${keys.length} book keys to region_features "${cfg.region}":\n  ${keys.join(', ')}`);
    console.log(`report: ${writeReport(outDir, report)}.md`);
    return 0;
  }

  const res = await execute(m, { commit, prefix: cfg.bookPrefix, only: a.only || null, limit: a.limit || null });
  const perBook = new Map();
  for (const seg of m.segments.values()) {
    const b = perBook.get(seg.book_key) || { book_key: seg.book_key, lessons: 0, with_pdf: 0 };
    b.lessons += 1; perBook.set(seg.book_key, b);
  }
  for (const it of m.items) if (it.asset_kind === 'lesson' && perBook.has(it.book_key)) perBook.get(it.book_key).with_pdf += 1;
  Object.assign(report, {
    counts: res.counts, changed: res.changed, removed: res.removed, failed: res.failed, written: res.written,
    pending: m.pending, blockers: m.blockers, per_book: [...perBook.values()],
    new: res.new.map((i) => ({ lesson_id: i.lesson_id, asset_kind: i.asset_kind, version_stamp: i.version_stamp })),
  });
  const c = res.counts;
  console.log(`${commit ? '' : 'DRY RUN — '}${cfgName} → ${a.env}: new ${c.new} · changed ${c.changed} · unchanged ${c.unchanged} · removed ${c.removed} (kept live) · written ${c.written} · failed ${c.failed} · pending ${m.pending.length} · blockers ${m.blockers.length}`);
  console.log(`report: ${writeReport(outDir, report)}.md`);
  return res.failed.length ? 1 : 0;
}

if (require.main === module) {
  // Node 22 tries IPv6 and IPv4 with a 250 ms per-family budget; from a home connection Google's export host
  // misses it and fetch fails ETIMEDOUT while curl succeeds (seen 5 Nov). A longer budget, same behaviour.
  try { require('net').setDefaultAutoSelectFamilyAttemptTimeout(2000); } catch (_) { /* older Node: no knob, no need */ }
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(`✗ ${err.message}`); process.exit(1); });
}

module.exports = { plan, execute, retire, checkEnv, assertProject, catalogWith, markdown, main, PROJECT_REF };
