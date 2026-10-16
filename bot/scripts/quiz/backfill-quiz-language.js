#!/usr/bin/env node
'use strict';
/**
 * Mark each video-bank ("library") quiz with the language its QUESTIONS are written in.
 *
 *   node scripts/quiz/backfill-quiz-language.js                                  # dry run
 *   node scripts/quiz/backfill-quiz-language.js --apply --expect-ref <project-ref>
 *
 * The bank quizzes were generated without `quizzes.language`, so nothing can tell a teacher whether a
 * quiz's questions are in English or in Urdu. This is a ONE-OFF run, not a periodic job.
 *
 * - The rule (no model, no guess): a quiz is 'ur' when at least half of its non-empty
 *   `quiz_questions.question_text` contain an Arabic-script letter (U+0600-06FF, U+0750-077F,
 *   U+FB50-FDFF, U+FE70-FEFF), else 'en'. A quiz with no question text is left as it is (NULL).
 * - The read-aloud voice reads `quizzes.language` once it is set (web-quiz-publish.service.js quizLanguage):
 *   without it the voice is 'ur' when ANY question text or first option has an Arabic letter. A quiz whose
 *   decided language differs from that voice language is LEFT NULL (counted as `disagree`), so this run never
 *   changes the voice a child hears; such a quiz simply shows no language mark.
 * - Only rows with `language IS NULL AND quiz_source = 'video'` are read or written; every write
 *   repeats that filter, so a row marked meanwhile is never overwritten.
 * - DRY RUN IS THE DEFAULT: it prints the counts before and after ({ en, ur, untouched } over every
 *   video quiz) and writes nothing. --apply writes, and only when SUPABASE_URL's project ref equals
 *   --expect-ref (neither ref is printed).
 * - Idempotent: a second run finds nothing to mark.
 * - Prints counts only — never a question's text, a topic or an id.
 * - NOT RUN by the maker page's change. quizzes.language has five live readers, each of which changes for a marked
 *   quiz: the child page's chrome language (student-quiz.service.js:116), the hub's ranking (web-quiz-hub.js:195),
 *   the class report's language (teacher-report.data.js:313) and the read-aloud voice
 *   (web-quiz-publish.service.js:444-448, web-quiz-videos.js:271-273). The page computes the same mark at read
 *   time (maker.qlang.js qlangFor) and writes nothing; running this is a separate, decided data step.
 */

const TABLE = 'quizzes';
const QUESTIONS = 'quiz_questions';
const SOURCE = 'video';
const PAGE = 200;          // quizzes per page; also the .in() list size (under the ~390-id header cap)
const QUESTION_PAGE = 1000; // PostgREST's default max rows per response
const WRITE_CHUNK = 200;

// The rule and the voice check live with the maker page, which computes the same mark at read time.
const { decideLanguage, voiceLanguage, ARABIC_SCRIPT } = require('../../shared/services/first-touch/maker.qlang');

function parseArgs(argv) {
  const args = { apply: false, expectRef: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--expect-ref') args.expectRef = String(argv[++i] || '').trim() || null;
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

function fail(what, error) {
  throw new Error(`${what} read failed: ${(error && error.message) || 'unknown error'}`);
}

/** Every video quiz still unmarked, paged by id (keyset, so a write between pages cannot skip a row). */
async function unmarkedQuizIds(db, page) {
  const ids = [];
  let after = null;
  for (;;) {
    let q = db.from(TABLE).select('id').is('language', null).eq('quiz_source', SOURCE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(page);
    if (error) fail(TABLE, error);
    const rows = data || [];
    ids.push(...rows.map((r) => r.id));
    if (rows.length < page) return ids;
    after = rows[rows.length - 1].id;
  }
}

/** quiz id -> [{ question_text, option_a }] for a batch of quizzes, paged by question id. */
async function questionTexts(db, quizIds) {
  const byQuiz = new Map(quizIds.map((id) => [id, []]));
  let after = null;
  for (;;) {
    let q = db.from(QUESTIONS).select('id, quiz_id, question_text, option_a').in('quiz_id', quizIds);
    if (after) q = q.gt('id', after);
    const { data, error } = await q.order('id', { ascending: true }).limit(QUESTION_PAGE);
    if (error) fail(QUESTIONS, error);
    const rows = data || [];
    for (const r of rows) if (byQuiz.has(r.quiz_id)) byQuiz.get(r.quiz_id).push({ question_text: r.question_text, option_a: r.option_a });
    if (rows.length < QUESTION_PAGE) return byQuiz;
    after = rows[rows.length - 1].id;
  }
}

async function countWhere(db, language) {
  let q = db.from(TABLE).select('id', { count: 'exact', head: true }).eq('quiz_source', SOURCE);
  q = language === null ? q.is('language', null) : q.eq('language', language);
  const { count, error } = await q;
  if (error) fail(TABLE, error);
  return count || 0;
}

/** Every video quiz by language: { en, ur, untouched } (untouched = still NULL). Other values are not counted. */
async function counts(db) {
  return { en: await countWhere(db, 'en'), ur: await countWhere(db, 'ur'), untouched: await countWhere(db, null) };
}

/**
 * @param {{ supabase, dryRun?: boolean, log?: (line: string) => void, page?: number }} opts
 * @returns {Promise<{ dryRun, before, decided, after, written }>}
 */
async function run({ supabase, dryRun = true, log = (l) => process.stdout.write(`${l}\n`), page = PAGE } = {}) {
  const db = supabase;
  const size = Math.max(1, Math.min(PAGE, page));
  log(`backfill-quiz-language: ${dryRun ? 'DRY RUN — nothing is written' : 'APPLY — writing'}`);

  const before = await counts(db);
  log(`before  video quizzes: en=${before.en} ur=${before.ur} untouched=${before.untouched}`);

  const ids = await unmarkedQuizIds(db, size);
  const decided = { en: 0, ur: 0, untouched: 0, disagree: 0 };
  const toWrite = { en: [], ur: [] };
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    const texts = await questionTexts(db, batch);
    for (const id of batch) {
      const qs = texts.get(id) || [];
      const lang = decideLanguage(qs.map((q) => q.question_text));
      if (!lang) { decided.untouched += 1; continue; }
      if (lang !== voiceLanguage(qs)) { decided.disagree += 1; continue; }
      decided[lang] += 1;
      toWrite[lang].push(id);
    }
  }
  log(`decided unmarked quizzes: en=${decided.en} ur=${decided.ur} untouched=${decided.untouched} disagree=${decided.disagree}`);

  let written = 0;
  if (!dryRun) {
    for (const lang of ['en', 'ur']) {
      const list = toWrite[lang];
      for (let i = 0; i < list.length; i += WRITE_CHUNK) {
        const chunk = list.slice(i, i + WRITE_CHUNK);
        const { data, error } = await db.from(TABLE).update({ language: lang })
          .in('id', chunk).is('language', null).eq('quiz_source', SOURCE).select('id');
        if (error) throw new Error(`${TABLE} write failed after ${written} rows: ${error.message || 'unknown error'}`);
        written += (data || []).length;
      }
    }
  }

  const after = dryRun
    ? { en: before.en + decided.en, ur: before.ur + decided.ur, untouched: before.untouched - decided.en - decided.ur }
    : await counts(db);
  log(`after${dryRun ? ' (would be)' : ''}  video quizzes: en=${after.en} ur=${after.ur} untouched=${after.untouched}`);
  log(dryRun ? 'DRY RUN — nothing written. Re-run with --apply --expect-ref <project-ref>.' : `written: ${written}`);
  return { dryRun: Boolean(dryRun), before, decided, after, written };
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

module.exports = { main, run, parseArgs, projectRef, decideLanguage, voiceLanguage, ARABIC_SCRIPT, PAGE };

if (require.main === module) {
  main(process.argv.slice(2)).then((r) => { process.exit(r && r.refused ? 2 : 0); })
    .catch((e) => { process.stderr.write(`backfill-quiz-language failed: ${String(e.message || e).slice(0, 300)}\n`); process.exit(1); });
}
