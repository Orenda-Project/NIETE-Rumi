'use strict';
/**
 * The Reading Hour / Numeracy (FLN) plan behind a recorded lesson, for the quiz made from it (bd-chz35n.26).
 *
 * Grades 1-2 teachers plan from FLN plans, which lpHintFor (K-5 downloads and app opens) never sees, so their quizzes
 * carried no lesson. The portal stores each FLN open with the plan's lesson + skill key (niete_lp_opens.lesson_key,
 * fln-lesson-key.js). Here, in the SAME window as lpHintFor (36 h before to 6 h after the recording): if the teacher
 * opened exactly ONE distinct FLN plan of the lesson's subject, that plan's key is the quiz's `meta.fln_lesson`.
 * Two plans, no keyed open, another subject: null. Only a certain mapping is stored.
 *
 * Stored for the evals only: it is not part of the digest prompt, the grade or anything the teacher sees.
 * NEVER THROWS: a failed read (e.g. the column not yet on this database) is null.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { bookForSubject, pickFlnLesson, BEFORE_MS, AFTER_MS } = require('../fln-lesson-key');

const MAX_ROWS = 50;
// The teacher key, never the raw id, on a log line (tests/setup/log-raw-ids.test.js); lazy, so a failed load is null.
const tkOf = (userId) => { try { return require('./web-quiz-kid').tk(userId); } catch (_) { return null; } };

async function flnLessonFor({ userId, sessionCreatedAt, subject }) {
  const book = bookForSubject(subject);
  if (!userId || !sessionCreatedAt || !book) return null;
  const at = new Date(sessionCreatedAt);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const { data, error } = await supabase
      .from('niete_lp_opens')
      .select('lesson_key, opened_at')
      .eq('user_id', userId)
      .eq('plan_kind', 'fln')
      .gte('opened_at', new Date(at.getTime() - BEFORE_MS).toISOString())
      .lte('opened_at', new Date(at.getTime() + AFTER_MS).toISOString())
      .order('opened_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error || !Array.isArray(data)) return null;
    return pickFlnLesson(data, { book });
  } catch (err) {
    logToFile('⚠️ transcript quiz: fln lesson lookup failed (non-fatal)', { tk: tkOf(userId), error: err.message });
    return null;
  }
}

module.exports = { flnLessonFor };
