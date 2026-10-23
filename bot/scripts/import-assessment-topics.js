#!/usr/bin/env node
'use strict';
/**
 * Load teacher topics (grouped from the G1-5 curriculum matrix) into `assessment_topics`.
 *
 *   node bot/scripts/import-assessment-topics.js <dir> --matrix-version <v> [--dry-run] [--allow-page-errors] [--review out.csv]
 *
 * <dir> holds the matrix tabs exported as CSV: English.csv, Urdu.csv, Maths.csv, Science.csv (the bot has
 * no Sheets client). Tabs that are missing are skipped and named; reconcile() is scoped to the
 * (grade, subject) pairs actually imported, so a partial import never retires another subject's rows.
 *
 *  - every write is an upsert on `topic_id`, chunked at 250; a vanished id is retired (is_current=false),
 *    never deleted.
 *  - --dry-run writes nothing. Without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY it treats the table as empty;
 *    with them it reads the stored rows so the counts show the real diff.
 *  - --review writes one CSV row per topic for a human look (not a release gate).
 *  - with a DB client, every topic's pages are checked against its chapter's page range in `textbook_toc` before
 *    any write (page-check.js). A topic wholly outside its chapter stops a load unless --allow-page-errors;
 *    --dry-run only reports it. Spills and chapters with no range are logged, never blocking.
 *
 * The DB client is injectable (run(argv, {client})) so tests never touch a live database.
 */
const fs = require('fs');
const path = require('path');
const { parseMatrixTab } = require('../shared/services/assessment/topics/matrix-rows');
const { groupAll } = require('../shared/services/assessment/topics/group');
const { reconcile, toRow, fromRow } = require('../shared/services/assessment/topics/reconcile');
const { checkPages, REPEATED_PRINTED_PAGES } = require('../shared/services/assessment/topics/page-check');

const TABLE = 'assessment_topics';
const CHUNK = 250;
const PAGE = 1000;
const TABS = [['English', 'english'], ['Urdu', 'urdu'], ['Maths', 'maths'], ['Science', 'science']];
const REVIEW_HEADER = ['grade', 'subject', 'chapter', 'heading', 'name', 'days', 'pages', 'slo_codes'];
const USAGE = 'usage: import-assessment-topics.js <dir> --matrix-version <v> [--dry-run] [--allow-page-errors] [--review out.csv]';

/** RFC 4180 CSV -> 2-D array of strings. Quoted cells may hold commas, "" and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** 2-D array -> CSV text, quoting only cells that need it. */
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

const joinList = (a) => (a || []).join(', ');
const reviewRow = (t) => [
  t.grade, t.subject, t.chapterNumber, t.heading, t.name, joinList(t.days), joinList(t.pages), joinList(t.sloCodes),
];

function parseArgs(argv) {
  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const flagValues = new Set([valueOf('--matrix-version'), valueOf('--review')]);
  const dir = argv.find((a) => !a.startsWith('--') && !flagValues.has(a));
  if (!dir) throw new Error(USAGE);
  const matrixVersion = valueOf('--matrix-version');
  if (!matrixVersion || matrixVersion.startsWith('--')) throw new Error(`--matrix-version is required\n${USAGE}`);
  return { dir, matrixVersion, dryRun: argv.includes('--dry-run'), allowPageErrors: argv.includes('--allow-page-errors'), review: valueOf('--review') };
}

function loadTopics(dir, log) {
  const present = TABS.filter(([file]) => fs.existsSync(path.join(dir, `${file}.csv`)));
  if (!present.length) throw new Error(`no matrix tabs in ${dir}: expected ${TABS.map(([f]) => `${f}.csv`).join(', ')}`);
  const skipped = TABS.filter((t) => !present.includes(t)).map(([f]) => `${f}.csv`);
  if (skipped.length) log(`skipped (not in ${dir}): ${skipped.join(', ')}`);
  const subjects = present.map(([, s]) => s);
  const topics = present.flatMap(([file, subject]) => {
    const values = parseCsv(fs.readFileSync(path.join(dir, `${file}.csv`), 'utf8'));
    return groupAll(subject, parseMatrixTab(values, subject));
  });
  return { subjects, topics };
}

function resolveClient(given, env, dryRun) {
  if (given) return given;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return require('../shared/config/supabase');
  if (dryRun) return null;
  throw new Error('a load needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run)');
}

async function readExisting(client, subjects, pageSize) {
  if (!client) return [];
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(TABLE).select('*').in('subject', subjects)
      .order('topic_id').range(from, from + pageSize - 1); // stable pages: unordered range() can skip/repeat rows
    if (error) throw new Error(`read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows.map(fromRow);
  }
}

/** textbook_toc rows (ict) for the imported subjects: each chapter's page_start..page_end. */
async function readToc(client, subjects, pageSize) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from('textbook_toc').select('grade,subject,chapter_number,page_start,page_end')
      .eq('curriculum', 'ict').in('subject', subjects).order('id').range(from, from + pageSize - 1);
    if (error) throw new Error(`textbook_toc read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

const findingLine = (kind, f) =>
  `  ${kind}: ${f.topicId} G${f.grade} ${f.subject} ch${f.chapterNumber} pages [${f.pages}] book ${f.pageStart}-${f.pageEnd} stray [${f.stray}]`;

/** Check topic pages against the book; log findings; throw on `outside` unless dry-run or allowed. */
async function pageCheck(db, subjects, topics, { dryRun, allowPageErrors, pageSize, log }) {
  if (!db) {
    log('page check skipped: no DB client to read textbook_toc');
    return { outside: 0, spill: 0, noRange: 0 };
  }
  const found = checkPages(topics, await readToc(db, subjects, pageSize), REPEATED_PRINTED_PAGES);
  found.outside.forEach((f) => log(findingLine('outside', f)));
  found.spill.forEach((f) => log(findingLine('spill', f)));
  if (found.noRange.length) log(`  no range: ${found.noRange.join(', ')}`);
  log(`page check: ${found.outside.length} outside, ${found.spill.length} spill, ${found.noRange.length} no range`);
  if (found.outside.length && !dryRun && !allowPageErrors) {
    throw new Error(`${found.outside.length} topic(s) sit wholly outside their chapter's book pages; fix the matrix or pass --allow-page-errors (nothing written)`);
  }
  return { outside: found.outside.length, spill: found.spill.length, noRange: found.noRange.length };
}

async function write(client, upsert, retire, matrixVersion, now) {
  const rows = upsert.map((t) => toRow(t, matrixVersion, now));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await client.from(TABLE).upsert(rows.slice(i, i + CHUNK), { onConflict: 'topic_id' });
    if (error) throw new Error(`upsert failed: ${error.message}`);
  }
  for (let i = 0; i < retire.length; i += CHUNK) {
    const { error } = await client.from(TABLE).update({ is_current: false, updated_at: now }).in('topic_id', retire.slice(i, i + CHUNK));
    if (error) throw new Error(`retire failed: ${error.message}`);
  }
}

function countByPair(topics) {
  const counts = {};
  for (const t of topics) {
    const key = `${t.grade} ${t.subject}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Testable entry point. Returns {counts, upsert, retire, pageCheck} (numbers). */
async function run(argv, { client, log = console.log, env = process.env, now = new Date().toISOString(), pageSize = PAGE } = {}) {
  const { dir, matrixVersion, dryRun, allowPageErrors, review } = parseArgs(argv);
  const { subjects, topics } = loadTopics(dir, log);
  const db = resolveClient(client, env, dryRun);
  const existing = await readExisting(db, subjects, pageSize);
  const pages = await pageCheck(db, subjects, topics, { dryRun, allowPageErrors, pageSize, log });
  const diff = reconcile(existing, topics);
  const counts = countByPair(topics);

  if (review) fs.writeFileSync(review, toCsv([REVIEW_HEADER, ...topics.map(reviewRow)]));
  if (!dryRun) await write(db, diff.upsert, diff.retire, matrixVersion, now);

  log(`\nassessment topic import ${dryRun ? '(DRY RUN) ' : ''}— matrix ${matrixVersion}${db ? '' : ' (no DB: existing treated as empty)'}`);
  for (const [key, n] of Object.entries(counts)) log(`  G${key}  ${n}`);
  log(`  topics     ${topics.length}`);
  log(`  ${dryRun ? 'would upsert' : 'upserted'}  ${diff.upsert.length}`);
  log(`  ${dryRun ? 'would retire' : 'retired'}  ${diff.retire.length}`);
  if (review) log(`  review     ${review}`);
  return { counts, upsert: diff.upsert.length, retire: diff.retire.length, pageCheck: pages };
}

module.exports = { run, parseCsv, toCsv };

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
