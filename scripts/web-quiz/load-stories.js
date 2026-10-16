#!/usr/bin/env node
'use strict';
/**
 * load-stories — load storybooks into one environment's database and storage (bot/shared/services/quiz/story-load.js).
 *
 *   node scripts/web-quiz/load-stories.js --manifest <pages manifest.json> --env sandbox --expect-ref <supabase ref>
 *        [--serve-root <dir>]      the books' files (default: the manifest's local_serve_root, else serve_root)
 *        [--voices <dir>]          <dir>/<source_id>/p<NN>.{json,qa.json,ogg} and q<N>[o<M>].ogg
 *        [--questions <dir>]       <dir>/<source_id>.json
 *        [--cleared <csv>]         the books whose watermark sweep is done (a source_id column); a book not in it stays a draft
 *        [--clean <json>]          the watermark-cleaning step's clean manifest {books:[{source_id, serve_root?, pages:[{n, image,
 *                                  text_band, cleaned, looked}]}]}: its picture and band win; a cleaned page counts as
 *                                  watermark-free only when looked at and passed
 *        [--verdicts <json>]       its lookers' verdicts {"<source_id>/<n>": {clean_ok, text_ok}} (a false fails the page)
 *        [--clean-root <dir>]      the clean manifest's files (default: its serve_root, else beside it in serve/)
 *        [--catalogue <csv>]       drive_id → r2_pdf_key
 *        [--only <id,id>]          these source ids only
 *        [--state <json>]          keys already stored (skipped; re-stored only when absent)
 *        [--out <csv>]             loaded.csv: one line per book (source_id, book_id, grade, lang, pages, voiced,
 *                                  questions, status, why, at), merged by source_id
 *        [--dry-run]               plan and print; write and store nothing (no env needed)
 *        [--misses <json>]         instead of loading: write the pages children opened without a voice since the
 *                                  file's last `until` ({since, until, pages:[{book_id, source_id, n}]}) and stop;
 *                                  the voice build voices those books' missing pages, then a normal run loads them
 *
 * Idempotent: ids are uuid v5 of the catalogue id and files are named by their content hash, so a re-run updates the
 * same rows and stores only new files. A book is 'ready' only when every gate passes (story-load.js), else 'draft'.
 * stdout: one line per book, counts and reasons only — never a key, a token or a URL with a signature.
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the R2_* variables unless --dry-run; refuses unless SUPABASE_URL
 * carries --expect-ref. Exit 0; 1 = a book failed to load; 2 = usage, env or a refused database.
 */
const fs = require('fs');
const path = require('path');

function arg(argv, name) { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] || ''); }

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const split = (l) => { const out = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h, c[i] || ''])); });
}
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function main({ argv = process.argv.slice(2), env = process.env, io = process, now = () => new Date(), db = null } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  const manifestPath = arg(argv, '--manifest');
  const target = arg(argv, '--env');
  const dryRun = argv.includes('--dry-run');
  const missesPath = arg(argv, '--misses');
  const connect = () => {
    if (db) return db;
    const ref = arg(argv, '--expect-ref');
    if (!ref || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { say('load-stories: --expect-ref, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required; refusing to run'); return null; }
    if (!String(env.SUPABASE_URL).includes(ref)) { say('load-stories: SUPABASE_URL is not the expected database; refusing to run'); return null; }
    // The bot's own client library (the repo root has no node_modules of its own).
    const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [path.join(__dirname, '..', '..', 'bot')] }));
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  };
  if (missesPath) {
    const client = connect();
    if (!client) return 2;
    const prior = fs.existsSync(missesPath) ? JSON.parse(fs.readFileSync(missesPath, 'utf8')) : {};
    const out = await require('../../bot/shared/services/quiz/story-load').missedPages(client, { since: prior.until || null, now });
    fs.writeFileSync(missesPath, JSON.stringify(out, null, 1));
    io.stdout.write(`${JSON.stringify({ misses: out.pages.length, books: new Set(out.pages.map((p) => p.book_id)).size, since: out.since, until: out.until })}\n`);
    return 0;
  }
  if (!manifestPath || !target) { say('usage: load-stories.js --manifest <file> --env <name> --expect-ref <ref> [--dry-run] …'); return 2; }
  const Load = require('../../bot/shared/services/quiz/story-load');
  const Store = require('../../bot/shared/services/quiz/story-store');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const serveRoot = arg(argv, '--serve-root') || manifest.local_serve_root || manifest.serve_root;
  const voices = arg(argv, '--voices');
  const questions = arg(argv, '--questions');
  const clearedCsv = arg(argv, '--cleared');
  const cleared = new Set(clearedCsv && fs.existsSync(clearedCsv) ? readCsv(clearedCsv).map((r) => r.source_id || r.book).filter(Boolean) : []);
  const cleanPath = arg(argv, '--clean');
  const clean = cleanPath && fs.existsSync(cleanPath) ? JSON.parse(fs.readFileSync(cleanPath, 'utf8')) : { books: [] };
  const verdictsPath = arg(argv, '--verdicts');
  const verdicts = verdictsPath && fs.existsSync(verdictsPath) ? JSON.parse(fs.readFileSync(verdictsPath, 'utf8')) : {};
  const cleanRoot = arg(argv, '--clean-root') || clean.serve_root || (cleanPath ? path.join(path.dirname(cleanPath), 'serve') : null);
  const cleanOf = new Map((clean.books || []).map((b) => [b.source_id, b]));
  const pagesOfClean = (sid) => {
    const b = cleanOf.get(sid);
    if (!b) return null;
    return new Map((b.pages || []).map((p) => {
      const v = verdicts[`${sid}/${p.n}`];
      const ok = v ? v.clean_ok !== false && v.text_ok !== false : p.looked === true;
      return [p.n, { ...p, ok, looked: p.looked === true || Boolean(v) }];
    }));
  };
  const catCsv = arg(argv, '--catalogue');
  const catalogue = new Map(catCsv && fs.existsSync(catCsv) ? readCsv(catCsv).map((r) => [r.drive_id, r]) : []);
  const only = arg(argv, '--only') ? new Set(arg(argv, '--only').split(',').filter(Boolean)) : null;
  const statePath = arg(argv, '--state');
  const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  const outPath = arg(argv, '--out');

  let store = null;
  let upload = null;
  if (!dryRun) {
    const client = connect();
    if (!client) return 2;
    store = Load.supabaseStore(client);
    const r2 = require('../../bot/shared/storage/r2');
    const bucket = Store.storyBucket(env) || undefined;
    upload = async (buf, { key, contentType }) => {
      await r2.uploadBuffer(buf, key, contentType, { bucket, cacheControl: Store.IMMUTABLE });
      state[key] = buf.length;
      return key;
    };
  }

  const books = (manifest.books || []).filter((b) => b && b.source_id && (!only || only.has(b.source_id)));
  const rows = [];
  let failed = 0;
  for (const book of books) {
    const plan = Load.planBook({
      book,
      serveDir: path.join(serveRoot, book.source_id),
      voiceDir: voices && fs.existsSync(path.join(voices, book.source_id)) ? path.join(voices, book.source_id) : null,
      questionsFile: questions && fs.existsSync(path.join(questions, `${book.source_id}.json`)) ? path.join(questions, `${book.source_id}.json`) : null,
      cleared: cleared.has(book.source_id),
      cleanPages: pagesOfClean(book.source_id),
      cleanDir: cleanRoot ? path.join((cleanOf.get(book.source_id) || {}).serve_root || cleanRoot, (cleanOf.get(book.source_id) || {}).serve_root ? '' : book.source_id) : null,
      extra: { pdf_r2_key: (catalogue.get(book.source_id) || {}).r2_pdf_key || null },
    });
    let out;
    try {
      out = await Load.applyPlan(plan, { store, upload, env: target, dryRun, has: (k) => Object.prototype.hasOwnProperty.call(state, k) });
    } catch (e) {
      failed += 1;
      say(`load-stories: ${book.source_id} failed: ${String(e && e.message).slice(0, 160)}`);
      continue;
    } finally {
      if (statePath && !dryRun) fs.writeFileSync(statePath, JSON.stringify(state));
    }
    const c = plan.counts;
    const why = plan.why.length > 4 ? [...plan.why.slice(0, 4), `+${plan.why.length - 4} more`] : plan.why;
    io.stdout.write(`${JSON.stringify({ source_id: book.source_id, book_id: plan.bookId, g: book.grade, lang: book.lang, pages: c.pages, voiced: `${c.voiced}/${c.textPages}`, questions: c.reviewed, files: plan.files.length, stored: out.uploaded, kept: out.skipped, status: out.status, why })}\n`);
    rows.push({ source_id: book.source_id, book_id: plan.bookId, grade: book.grade, lang: book.lang, pages: c.pages, voiced: `${c.voiced}/${c.textPages}`, questions: c.reviewed, status: dryRun ? `dry:${out.status}` : out.status, why: plan.why.join('; '), at: now().toISOString() });
  }
  if (outPath && rows.length) {
    const head = ['source_id', 'book_id', 'grade', 'lang', 'pages', 'voiced', 'questions', 'status', 'why', 'at'];
    const prior = fs.existsSync(outPath) ? readCsv(outPath) : [];
    const merged = new Map(prior.map((r) => [r.source_id, r]));
    rows.forEach((r) => merged.set(r.source_id, r));
    fs.writeFileSync(outPath, `${head.join(',')}\n${[...merged.values()].map((r) => head.map((h) => csvCell(r[h])).join(',')).join('\n')}\n`);
  }
  const ready = rows.filter((r) => r.status === 'ready' || r.status === 'dry:ready').length;
  io.stdout.write(`${JSON.stringify({ books: rows.length, ready, draft: rows.length - ready, failed, dry_run: dryRun })}\n`);
  return failed ? 1 : 0;
}

if (require.main === module) main().then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`load-stories: ${e && e.message}\n`); process.exitCode = 2; });

module.exports = { main, readCsv };
