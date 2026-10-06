#!/usr/bin/env node
'use strict';
/**
 * Record the read-aloud clips of the video-bank ("library") quizzes BEFORE a child opens them.
 *
 *   node scripts/quiz/backfill-bank-quiz-audio.js --expect-ref <project-ref> [--limit N]
 *        [--apply] [--concurrency K] [--max-usd X] [--days D]
 *
 * Without it the first child to open a library quiz waits for its clips (about a minute) and
 * hears whatever older clips exist, in another voice. This is a ONE-OFF run, not a periodic job.
 *
 * - DRY RUN IS THE DEFAULT: it prints the plan (rank, quiz id, language, grade, subject, opens,
 *   clips to make, characters, estimated USD) and makes no voice, storage or database write.
 *   --apply records.
 * - --limit N takes the first N quizzes of the ranking (default 0: nothing).
 * - Ranking: opens (quiz_sessions) in the last --days (14) days, most first; ties by the
 *   lesson's place in its grade x subject (the bank's own order), then grade, then subject, so
 *   every grade x subject gets its first lesson before any gets its second.
 * - Idempotent: a quiz whose clips are already current in its language's quiz voice
 *   (web-quiz-publish isCurrent) is skipped and counted, never re-billed; publishQuizAudio
 *   itself skips any clip already stored.
 * - Records through publishQuizAudio only (one synthesis path; the kill switch and the daily
 *   cap in app_settings still apply: "disabled" or "capped" stops the run).
 * - Stops before starting another quiz once the run's spend reaches --max-usd (default 15).
 * - Refuses to run unless SUPABASE_URL's project ref equals --expect-ref. Neither ref is printed.
 * - Prints ids, grades and subjects only — never a child's or a teacher's name.
 */

const GRADE_ORDER = ['NURSERY', 'KG', '1', '2', '3', '4', '5', '6'];
// Measured on sandbox publishes (Soniox, 64 quizzes, 5-6 Oct 2026): USD per 1,000 characters spoken.
const USD_PER_1K_CHARS = 0.0145;
const PAGE = 1000;
const QUIZ_CONCURRENCY = 2;
const DEFAULT_MAX_USD = 15;
const DEFAULT_DAYS = 14;
// Publishes of one quiz in a run: publish records at most 120 clips a call; the largest bank quiz has 133.
const MAX_PASSES = 3;

function parseArgs(argv) {
  const args = { apply: false, limit: 0, expectRef: null, concurrency: QUIZ_CONCURRENCY, maxUsd: DEFAULT_MAX_USD, days: DEFAULT_DAYS };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--limit') args.limit = Math.max(0, parseInt(next(), 10) || 0);
    else if (a === '--expect-ref') args.expectRef = String(next() || '').trim() || null;
    else if (a === '--concurrency') args.concurrency = Math.max(1, Math.min(4, parseInt(next(), 10) || QUIZ_CONCURRENCY));
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--days') args.days = Math.max(1, parseInt(next(), 10) || DEFAULT_DAYS);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** The Supabase project ref of a URL (https://<ref>.supabase.co), or null. Pure. */
function projectRef(url) {
  try {
    const host = new URL(String(url || '')).hostname;
    return /\.supabase\.(co|in)$/.test(host) ? host.split('.')[0] : null;
  } catch (_) {
    return null;
  }
}

function gradeIndex(grade) {
  const i = GRADE_ORDER.indexOf(String(grade == null ? '' : grade).toUpperCase());
  return i < 0 ? GRADE_ORDER.length : i;
}

/**
 * The order to record in. Pure.
 * @param {Array<{id, grade, subject, videoAt}>} bank  one row per bank quiz (videoAt: the lesson's place in the bank)
 * @param {Map<string, number>} opens                  quiz id -> opens in the window
 */
function rank(bank, opens) {
  const groups = new Map();
  for (const b of bank) {
    const k = `${b.grade}|${b.subject}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const lesson = new Map();
  for (const rows of groups.values()) {
    rows.slice().sort((x, y) => String(x.videoAt || '').localeCompare(String(y.videoAt || '')) || String(x.id).localeCompare(String(y.id)))
      .forEach((r, i) => lesson.set(r.id, i));
  }
  return bank.map((b) => ({ ...b, opens: opens.get(b.id) || 0, lesson: lesson.get(b.id) }))
    .sort((x, y) => (y.opens - x.opens) || (x.lesson - y.lesson) || (gradeIndex(x.grade) - gradeIndex(y.grade))
      || String(x.subject || '').localeCompare(String(y.subject || '')) || String(x.id).localeCompare(String(y.id)));
}

async function pages(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'read failed');
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Every playable bank quiz (the rows the library lists), with its lesson's grade, subject and place.
 *  Only the two meta fields isCurrent reads are selected: a recorded quiz's meta carries its whole clip map. */
async function loadBank(db) {
  const vids = await pages(() => db.from('student_videos').select('id, grade, subject, created_at')
    .eq('migration_status', 'done').is('superseded_by', null).order('id', { ascending: true }));
  const videoOf = new Map(vids.map((v) => [v.id, v]));
  const quizzes = await pages(() => db.from('quizzes').select('id, video_id, language, audio_v:meta->web->>audio_v, audio_voice:meta->web->>audio_voice')
    .eq('quiz_source', 'video').eq('status', 'ready').order('id', { ascending: true }));
  return quizzes.filter((q) => videoOf.has(q.video_id)).map((q) => {
    const v = videoOf.get(q.video_id);
    return { id: q.id, grade: v.grade, subject: v.subject, videoAt: v.created_at, language: q.language, web: { audio_v: q.audio_v, audio_voice: q.audio_voice } };
  });
}

async function loadOpens(db, days, now) {
  const since = new Date(now - days * 86400000).toISOString();
  const rows = await pages(() => db.from('quiz_sessions').select('quiz_id').gte('created_at', since).order('id', { ascending: true }));
  const opens = new Map();
  for (const r of rows) if (r.quiz_id) opens.set(r.quiz_id, (opens.get(r.quiz_id) || 0) + 1);
  return opens;
}

/** What one quiz would cost to record: its language (as the publish step will choose it), clips and characters. */
async function planQuiz(db, Publish, b) {
  const { data: questions, error } = await db.from('quiz_questions')
    .select('id, question_text, option_a, option_b, option_c, option_d, correct_option, option_feedback, explanation, media, sort_order')
    .eq('quiz_id', b.id).order('sort_order', { ascending: true });
  if (error) throw new Error(error.message || 'read failed');
  const parts = (questions || []).flatMap((q) => Publish.partsFor(q));
  const chars = parts.reduce((n, p) => n + p.text.length, 0);
  return { language: Publish.quizLanguage({ language: b.language }, questions), questions: (questions || []).length, clips: parts.length, chars };
}

/**
 * One quiz, through publishQuizAudio. A quiz with more clips than one publish records (its per-run
 * clip cap) is published again — the clips already stored are reused, the rest recorded — up to
 * MAX_PASSES times, so it ends current in this run instead of on a child's first open.
 */
async function recordQuiz(Publish, db, quizId) {
  const total = { synthesized: 0, skipped: 0, chars: 0, estimatedCostUsd: 0 };
  let out = {};
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    out = (await Publish.publishQuizAudio(quizId, { db })) || {};
    total.synthesized += out.synthesized || 0;
    total.chars += out.chars || 0;
    total.estimatedCostUsd += out.estimatedCostUsd || 0;
    if (pass === 0) total.skipped = out.skipped || 0;
    if (!(out.ok && out.capped && !out.failed && out.synthesized)) break;
  }
  return { ...out, ...total };
}

const usd = (n) => (Math.round(n * 1e4) / 1e4).toFixed(4);

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const print = deps.print || ((line) => process.stdout.write(`${line}\n`));
  const args = parseArgs(argv);
  const ref = projectRef(env.SUPABASE_URL);
  if (!args.expectRef || !ref || ref !== args.expectRef) {
    print('REFUSED: SUPABASE_URL is not the project passed in --expect-ref (neither is printed). Nothing was read or written.');
    return { refused: true };
  }
  const db = deps.db || require('../../shared/config/supabase');
  const Publish = deps.publish || require('../../shared/services/quiz/web-quiz-publish.service');
  const now = deps.now || Date.now();
  const mode = args.apply ? 'apply' : 'dry-run';

  const bank = await loadBank(db);
  const opens = await loadOpens(db, args.days, now);
  const chosen = rank(bank, opens).slice(0, args.limit);
  print(`backfill-bank-quiz-audio: mode=${mode} bank=${bank.length} opened_in_${args.days}d=${bank.filter((b) => opens.has(b.id)).length} limit=${args.limit} max_usd=${args.maxUsd}`);
  print('rank\tquiz_id\tlang\tgrade\tsubject\topens\tclips\tchars\test_usd\tstatus');

  const sum = { done: 0, skipped: 0, failed: 0, chars: 0, usd: 0, estChars: 0, estUsd: 0, stopped: null };
  const todo = [];
  for (let i = 0; i < chosen.length; i += 1) {
    const b = chosen[i];
    const p = await planQuiz(db, Publish, b);
    const current = Publish.isCurrent(b.web);
    const est = (p.chars / 1000) * USD_PER_1K_CHARS;
    const status = current ? 'current' : (p.clips ? 'record' : 'no_clips');
    print([i + 1, b.id, p.language, b.grade, b.subject, b.opens, current ? 0 : p.clips, current ? 0 : p.chars, usd(current ? 0 : est), status].join('\t'));
    if (current || !p.clips) { sum.skipped += 1; continue; }
    sum.estChars += p.chars;
    sum.estUsd += est;
    todo.push({ rank: i + 1, ...b });
  }

  if (args.apply) {
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !sum.stopped) {
        if (sum.usd >= args.maxUsd) { sum.stopped = 'max_usd'; return; }
        const b = todo[next++];
        const out = await recordQuiz(Publish, db, b.id);
        sum.chars += out.chars;
        sum.usd += out.estimatedCostUsd;
        const ok = out.ok && !out.failed && !out.capped;
        if (ok) sum.done += 1; else sum.failed += 1;
        const why = out.reason || (out.failed ? `clips_failed_${out.failed}` : 'clip_cap');
        print(`recorded\t${b.rank}\t${b.id}\t${ok ? 'ok' : `failed:${why}`}\tsynthesized=${out.synthesized}\treused=${out.skipped}\tusd=${usd(out.estimatedCostUsd)}`);
        if (out.reason === 'disabled' || out.reason === 'capped') sum.stopped = out.reason;
      }
    };
    await Promise.all(Array.from({ length: Math.min(args.concurrency, todo.length) }, worker));
  }

  const line = args.apply
    ? `SUMMARY mode=apply quizzes done=${sum.done} skipped=${sum.skipped} failed=${sum.failed} not_started=${todo.length - sum.done - sum.failed} chars=${sum.chars} usd=${usd(sum.usd)}${sum.stopped ? ` stopped=${sum.stopped}` : ''}`
    : `SUMMARY mode=dry-run quizzes to_record=${todo.length} skipped=${sum.skipped} chars=${sum.estChars} est_usd=${usd(sum.estUsd)} (at ${USD_PER_1K_CHARS} per 1k chars)`;
  print(line);
  return { ...sum, planned: todo.length, line };
}

module.exports = { main, parseArgs, projectRef, rank, USD_PER_1K_CHARS };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.exit(r && r.refused ? 2 : 0); })
    .catch((e) => { process.stderr.write(`backfill-bank-quiz-audio failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
