#!/usr/bin/env node
'use strict';
/**
 * Give the video-bank ("library") questions back their own recorded option voices.
 *
 *   node scripts/quiz/restore-bank-recorded-voices.js --expect-ref <project-ref> --map <file.json> [--apply] [--limit N]
 *
 * The bank was recorded by people, one clip per option for many questions, but the import that
 * filled this deployment's quiz_questions kept the question clips and dropped media.option_audio,
 * so a child never hears them. The map (built offline from each clip's transcript, never from its
 * file number: the legacy numbering does not always follow the options) says, per question id:
 *
 *   { "id": "<question uuid>", "options": { "a": "<option_a text>", ... },
 *     "option_audio": [ { "index": 0, "url": "<clip>" }, ... ],      // optional
 *     "reject_question_audio": true }                                 // optional: the clip says something else
 *
 * - DRY RUN IS THE DEFAULT: prints one line per question (id, action) and writes nothing. --apply writes.
 * - Writes media.option_audio (index = the option's stored slot), and for a rejected question clip moves
 *   media.question_audio to media.question_audio_rejected (kept, reversible). Nothing else in media changes.
 * - A row whose option texts no longer equal the map's is skipped ("changed"): the clips were checked
 *   against those words.
 * - Idempotent: a row that already holds exactly this is "same" and not written.
 * - A quiz whose rejected question has no generated question clip is marked to be recorded again
 *   (meta.web.audio_v cleared), so its next open records that question in the quiz voice.
 * - Refuses to run unless SUPABASE_URL's project ref equals --expect-ref. Prints ids only.
 */
const fs = require('fs');
const { projectRef } = require('./backfill-bank-quiz-audio');

const FIELDS = ['option_a', 'option_b', 'option_c', 'option_d'];
const CHUNK = 100;

function parseArgs(argv) {
  const a = { apply: false, expectRef: null, map: null, limit: 0 };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const k = argv[i];
    if (k === '--apply') a.apply = true;
    else if (k === '--dry-run') a.apply = false;
    else if (k === '--expect-ref') a.expectRef = String(argv[++i] || '').trim() || null;
    else if (k === '--map') a.map = argv[++i];
    else if (k === '--limit') a.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

const sameText = (x, y) => String(x == null ? '' : x).trim() === String(y == null ? '' : y).trim();

/** The media a row should hold for one map entry, or null when the row must not be touched. Pure. */
function nextMedia(row, entry) {
  const shown = FIELDS.map((f, i) => ({ i, text: row[f] })).filter((o) => o.text != null && String(o.text).trim() !== '');
  if (!shown.every((o) => sameText(o.text, (entry.options || {})['abcd'.charAt(o.i)]))) return { skip: 'changed' };
  const media = { ...(row.media || {}) };
  if (Array.isArray(entry.option_audio) && entry.option_audio.length) {
    const ok = entry.option_audio.every((o) => Number.isInteger(o.index) && shown.some((s) => s.i === o.index) && typeof o.url === 'string' && o.url);
    if (!ok) return { skip: 'bad_entry' };
    media.option_audio = entry.option_audio.map((o) => ({ index: o.index, url: o.url })).sort((x, y) => x.index - y.index);
  }
  if (entry.reject_question_audio && Array.isArray(media.question_audio) && media.question_audio.length) {
    media.question_audio_rejected = media.question_audio;
    media.question_audio = [];
  }
  return JSON.stringify(media) === JSON.stringify(row.media || {}) ? { skip: 'same' } : { media };
}

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const print = deps.print || ((l) => process.stdout.write(`${l}\n`));
  const args = parseArgs(argv);
  const ref = projectRef(env.SUPABASE_URL);
  if (!args.expectRef || !ref || ref !== args.expectRef) {
    print('REFUSED: SUPABASE_URL is not the project passed in --expect-ref (neither is printed). Nothing was read or written.');
    return { refused: true };
  }
  const map = deps.map || JSON.parse(fs.readFileSync(args.map, 'utf8'));
  const entries = args.limit ? map.slice(0, args.limit) : map;
  const db = deps.db || require('../../shared/config/supabase');
  const sum = { written: 0, same: 0, changed: 0, missing: 0, bad_entry: 0, failed: 0, requeued: 0 };
  const recheck = new Map(); // quiz id -> question ids whose recorded question clip was rejected
  print(`restore-bank-recorded-voices: mode=${args.apply ? 'apply' : 'dry-run'} entries=${entries.length}`);
  for (let i = 0; i < entries.length; i += CHUNK) {
    const part = entries.slice(i, i + CHUNK);
    const { data, error } = await db.from('quiz_questions').select(`id, quiz_id, ${FIELDS.join(', ')}, media`).in('id', part.map((e) => e.id));
    if (error) throw new Error(error.message || 'read failed');
    const rows = new Map((data || []).map((r) => [r.id, r]));
    for (const e of part) {
      const row = rows.get(e.id);
      if (!row) { sum.missing += 1; print(`${e.id}\tmissing`); continue; }
      const out = nextMedia(row, e);
      if (out.skip) { sum[out.skip] += 1; print(`${e.id}\t${out.skip}`); continue; }
      if (e.reject_question_audio) recheck.set(row.quiz_id, [...(recheck.get(row.quiz_id) || []), row.id]);
      if (!args.apply) { sum.written += 1; print(`${e.id}\twould_write\topts=${(out.media.option_audio || []).length}${e.reject_question_audio ? '\treject_q' : ''}`); continue; }
      const { error: uErr } = await db.from('quiz_questions').update({ media: out.media }).eq('id', e.id);
      if (uErr) { sum.failed += 1; print(`${e.id}\tfailed`); continue; }
      sum.written += 1;
      print(`${e.id}\twritten\topts=${(out.media.option_audio || []).length}${e.reject_question_audio ? '\treject_q' : ''}`);
    }
  }
  for (const [quizId, qids] of recheck) {
    const { data: quiz } = await db.from('quizzes').select('id, meta').eq('id', quizId).maybeSingle();
    const web = (quiz && quiz.meta && quiz.meta.web) || {};
    const audio = web.audio || {};
    if (!web.audio_v || qids.every((id) => audio[id] && audio[id].q)) continue;
    sum.requeued += 1;
    print(`${quizId}\t${args.apply ? 'record_again' : 'would_record_again'}`);
    if (args.apply) {
      const { audio_v: _old, ...rest } = web;
      await db.from('quizzes').update({ meta: { ...quiz.meta, web: rest } }).eq('id', quizId);
    }
  }
  const line = `SUMMARY mode=${args.apply ? 'apply' : 'dry-run'} ${Object.entries(sum).map(([k, v]) => `${k}=${v}`).join(' ')}`;
  print(line);
  return { ...sum, line };
}

module.exports = { main, parseArgs, nextMedia };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => process.exit(r && r.refused ? 2 : 0))
    .catch((e) => { process.stderr.write(`restore-bank-recorded-voices failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
