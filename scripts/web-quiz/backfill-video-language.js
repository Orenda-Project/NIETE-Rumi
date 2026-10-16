#!/usr/bin/env node
'use strict';
/**
 * backfill-video-language — fill student_videos.language (web_quiz_student_videos_language.sql) once, from each
 * video's lesson quiz, by the rule the quiz's clips are already recorded in (web-quiz-videos.js lessonLanguage: the
 * quiz row's language, else its questions' script; then clamped to the languages this deployment offers).
 *
 *   node scripts/web-quiz/backfill-video-language.js --expect-ref <supabase ref> [--dry-run]
 *
 * Only rows whose language is NULL are touched; a video with no lesson quiz stays NULL. Re-runnable.
 * stdout: one JSON line of counts {videos, null_before, with_quiz, en, ur, no_quiz, written, dry_run} — never an id.
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refuses unless SUPABASE_URL carries --expect-ref.
 * Exit 0; 1 = a write failed; 2 = usage, env or a refused database.
 */
const PAGE = 500;

function arg(argv, name) { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] || ''); }

/** The lesson's language by the quiz clips' rule. */
function languageFor(quiz, questions) {
  const { quizLanguage } = require('../../bot/shared/services/quiz/web-quiz-publish.service');
  const { clampLanguage } = require('../../bot/shared/config/ux-strings');
  return clampLanguage(quizLanguage(quiz, questions || []));
}

async function all(q) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q().range(from, from + PAGE - 1);
    if (error) throw new Error(`${error.code || ''} ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function main({ argv = process.argv.slice(2), env = process.env, io = process, db = null, langOf = languageFor } = {}) {
  const say = (s) => io.stderr.write(`${s}\n`);
  const dryRun = argv.includes('--dry-run');
  if (!db) {
    const ref = arg(argv, '--expect-ref');
    if (!ref || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { say('backfill-video-language: --expect-ref, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required; refusing to run'); return 2; }
    if (!String(env.SUPABASE_URL).includes(ref)) { say('backfill-video-language: SUPABASE_URL is not the expected database; refusing to run'); return 2; }
    // The bot's own client library (the repo root has no node_modules of its own).
    const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [require('path').join(__dirname, '..', '..', 'bot')] }));
    db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const videos = await all(() => db.from('student_videos').select('id, language').order('id'));
  const todo = videos.filter((v) => v.language == null);
  const quizzes = await all(() => db.from('quizzes').select('id, video_id, language').eq('quiz_source', 'video').not('video_id', 'is', null).order('id'));
  const quizOf = new Map(quizzes.map((q) => [q.video_id, q]));
  const counts = { videos: videos.length, null_before: todo.length, with_quiz: 0, en: 0, ur: 0, no_quiz: 0, written: 0, dry_run: dryRun };
  const byLang = { en: [], ur: [] };
  for (const v of todo) {
    const q = quizOf.get(v.id);
    if (!q) { counts.no_quiz += 1; continue; }
    counts.with_quiz += 1;
    let qs = [];
    if (!q.language) {
      const { data, error } = await db.from('quiz_questions').select('question_text, option_a').eq('quiz_id', q.id).limit(3);
      if (error) throw new Error(`${error.code || ''} ${error.message}`);
      qs = data || [];
    }
    const lang = langOf(q, qs);
    if (lang === 'en' || lang === 'ur') { counts[lang] += 1; byLang[lang].push(v.id); }
  }
  let failed = 0;
  if (!dryRun) {
    for (const lang of ['en', 'ur']) {
      for (let i = 0; i < byLang[lang].length; i += 200) {
        const ids = byLang[lang].slice(i, i + 200);
        const { error } = await db.from('student_videos').update({ language: lang }).in('id', ids).is('language', null);
        if (error) { failed += 1; say(`backfill-video-language: a write failed: ${error.code || ''}`); } else counts.written += ids.length;
      }
    }
  }
  io.stdout.write(`${JSON.stringify(counts)}\n`);
  return failed ? 1 : 0;
}

if (require.main === module) main().then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`backfill-video-language: ${e && e.message}\n`); process.exitCode = 2; });

module.exports = { main, languageFor };
