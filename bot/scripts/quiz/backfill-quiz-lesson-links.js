#!/usr/bin/env node
'use strict';
/**
 * Put the lesson plan on PAST lesson quizzes — `quizzes.meta.lesson_links` (bd-ptl6x9.13.1).
 *
 *   node scripts/quiz/backfill-quiz-lesson-links.js                                  # dry run (counts)
 *   node scripts/quiz/backfill-quiz-lesson-links.js --apply --expect-ref <project-ref>
 *
 * New quizzes get the links when they are made (quiz-lesson-link.js). This ONE-OFF run copies the same
 * links onto older quizzes, only where the link is ALREADY RECORDED — never guessed, never by date:
 *   - lp_v8 / lp612: the quiz's own `meta.lessons` (the plan it was written from);
 *   - transcript: the recording's `_fidelity_ref`, only when the teacher picked her plan (`selected_recent`).
 * Safety:
 *   - DRY RUN IS THE DEFAULT: counts per source × outcome, writes nothing. --apply writes only when
 *     SUPABASE_URL's project ref equals --expect-ref (neither is printed).
 *   - Only quizzes at least MIN_AGE_DAYS old are written: a live quiz's meta is still moving (step, report),
 *     and a whole-meta write could race it. Younger ones are counted `too_recent`; a later run takes them.
 *   - Only `lesson_links` is added; the rest of meta is the row's own, read just before the write.
 *   - A quiz that already has `lesson_links` is never touched (idempotent).
 *   - Prints counts only — never an id, a topic or a teacher.
 */

const LessonLink = require('../../shared/services/quiz/quiz-lesson-link');
const { LESSON_SOURCES } = require('../../shared/services/quiz/quiz-sources');

const TABLE = 'quizzes';
const PAGE = 200;
const MIN_AGE_DAYS = 7;
const DAY_MS = 864e5;

function parseArgs(argv) {
  const args = { apply: false, expectRef: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--expect-ref') args.expectRef = String(argv[++i] || '').trim() || null;
  }
  return args;
}

function projectRef(url) {
  try {
    const host = new URL(String(url || '')).hostname;
    return /\.supabase\.(co|in)$/.test(host) ? host.split('.')[0] : null;
  } catch (_) {
    return null;
  }
}

function fail(what, error) {
  throw new Error(`${what} read failed: ${(error && error.message) || 'unknown error'}`);
}

/** Every lesson quiz, paged by id (keyset). Only the slices this run needs. */
async function lessonQuizzes(db) {
  const rows = [];
  let after = null;
  for (;;) {
    let q = db.from(TABLE).select('id, quiz_source, coaching_session_id, created_at, lessons:meta->lessons, links:meta->lesson_links')
      .in('quiz_source', LESSON_SOURCES);
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(PAGE);
    if (error) fail(TABLE, error);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
    after = page[page.length - 1].id;
  }
}

/** session id → links, for recordings (one IN read per PAGE sessions). */
async function recordingLinks(db, sessionIds) {
  const out = new Map();
  for (let i = 0; i < sessionIds.length; i += PAGE) {
    const { data, error } = await db.from('coaching_sessions')
      .select('id, lesson_plan_link_method, ref:lesson_plan_structured->_fidelity_ref')
      .in('id', sessionIds.slice(i, i + PAGE));
    if (error) fail('coaching_sessions', error);
    for (const s of data || []) out.set(s.id, LessonLink.fromRecording(s));
  }
  return out;
}

/**
 * @param {{ supabase, dryRun?: boolean, now?: Date, log?: (line: string) => void }} opts
 * @returns {Promise<{ dryRun, counts, written }>}
 */
async function run({ supabase, dryRun = true, now = new Date(), log = (l) => process.stdout.write(`${l}\n`) } = {}) {
  const db = supabase;
  log(`backfill-quiz-lesson-links: ${dryRun ? 'DRY RUN — nothing is written' : 'APPLY — writing'}`);
  const quizzes = await lessonQuizzes(db);
  const sessions = [...new Set(quizzes.filter((q) => q.coaching_session_id && !q.links).map((q) => q.coaching_session_id))];
  const bySession = await recordingLinks(db, sessions);
  const cutoff = now.getTime() - MIN_AGE_DAYS * DAY_MS;

  const counts = {};
  const bump = (src, k) => { counts[src] = counts[src] || {}; counts[src][k] = (counts[src][k] || 0) + 1; };
  const toWrite = [];
  for (const q of quizzes) {
    if (Array.isArray(q.links)) { bump(q.quiz_source, 'has_links'); continue; }
    const links = q.coaching_session_id && q.quiz_source === 'transcript'
      ? (bySession.get(q.coaching_session_id) || [])
      : LessonLink.fromPlanLessons(q.lessons);
    if (!links.length) { bump(q.quiz_source, 'no_link'); continue; }
    if (!(Date.parse(q.created_at) <= cutoff)) { bump(q.quiz_source, 'too_recent'); continue; }
    bump(q.quiz_source, 'linked');
    toWrite.push({ id: q.id, links });
  }
  for (const [src, c] of Object.entries(counts)) log(`  ${src}: ${Object.entries(c).map(([k, n]) => `${k}=${n}`).join(' ')}`);

  let written = 0;
  if (!dryRun) {
    for (const { id, links } of toWrite) {
      const { data: row, error } = await db.from(TABLE).select('meta').eq('id', id).maybeSingle();
      if (error) fail(TABLE, error);
      if (!row || (row.meta && row.meta.lesson_links)) continue;
      const { data, error: wErr } = await db.from(TABLE).update({ meta: { ...(row.meta || {}), lesson_links: links } })
        .eq('id', id).select('id');
      if (wErr) throw new Error(`${TABLE} write failed after ${written} rows: ${wErr.message || 'unknown error'}`);
      written += (data || []).length;
    }
  }
  log(dryRun ? `DRY RUN — would write ${toWrite.length}. Re-run with --apply --expect-ref <project-ref>.` : `written: ${written}`);
  return { dryRun: Boolean(dryRun), counts, written };
}

async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const print = deps.print || ((line) => process.stdout.write(`${line}\n`));
  const args = parseArgs(argv);
  if (args.apply) {
    const ref = projectRef(env.SUPABASE_URL);
    if (!args.expectRef || !ref || ref !== args.expectRef) {
      print('REFUSED: --apply needs --expect-ref equal to SUPABASE_URL\'s project (neither is printed). Nothing was read or written.');
      return { refused: true };
    }
  }
  const supabase = deps.db || require('../../shared/config/supabase');
  return run({ supabase, dryRun: !args.apply, log: print });
}

module.exports = { main, run, parseArgs, projectRef, MIN_AGE_DAYS };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.exit(r && r.refused ? 2 : 0); })
    .catch((e) => { process.stderr.write(`backfill-quiz-lesson-links failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
