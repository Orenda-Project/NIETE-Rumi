'use strict';
/**
 * bd-97daxo.34.6 — the 15:00 quiz offer for Grades 6-12 and GB lessons.
 *
 * Their lessons are rows in `niete_lp612_deliveries` (WhatsApp, portal or backfill), not
 * `niete_lp_downloads`, so the K-5 cohort never saw them. This module gives the cohort the day's
 * 6-12 classes and answers a tap on one: the quiz is made by the lp612 provider (the one /quiz
 * uses), so one quiz per lesson holds whichever door asked.
 *
 * Same rules as the K-5 offer: the cohort window and cutoff (a lesson after it is the next school
 * day's), never an assessment, a held lesson or a subject the quiz is off for (provider.toItem),
 * never a lesson she already made a quiz from. Kill switch: QUIZ_LP612_SOURCE.
 *
 * Load: one paged read of the day's deliveries (delivered_at range), one IN read of their
 * segments, one read of recent lp612 quizzes per teacher with a lesson — once a day, at build.
 */

const supabase = require('../../config/supabase');
const { pagedRows } = require('../../utils/postgrest-paged');
const { logEvent } = require('../../utils/structured-logger');
const PktTime = require('./pkt-time');
const Store = require('./teacher-nudges.store');
const Deliveries = require('../lp612-deliveries.store');
const { lp612SourceOn } = require('../quiz/quiz-sources');

const WINDOW_DAYS = 4;
const KEY_PREFIX = 'lp612_';

// The offer's pure rules come from their own module, never the offer service, which
// requires this one (bd-97daxo.34.12: that closed an import cycle).
const Rules = require('./lp-quiz-offer-rules');
const { tk } = require('../quiz/web-quiz-kid');
// Lazy: the provider's own requires reach the lp612 feedback/serving services.
const Provider = () => require('../quiz/providers/lp612.provider');

/**
 * The day's 6-12 classes per teacher. A teacher who took a 6-12 lesson that cannot be offered is
 * still a key, with [], so the cohort records her as `no_lesson` (as K-5 does).
 * @returns {Promise<Map<string, object[]>>}
 */
async function classesFor(nudgeDate) {
  // A failure here must never stop the K-5 offer built in the same cohort: log it, offer no 6-12.
  try {
    return await read612(nudgeDate);
  } catch (err) {
    logEvent('lp_quiz_offer.cohort_612_failed', { nudgeDate, error: err.message });
    return new Map();
  }
}

async function read612(nudgeDate) {
  const out = new Map();
  if (!lp612SourceOn()) return out;
  const offer = Rules;
  const provider = Provider();
  const upper = PktTime.atPkt(nudgeDate, offer.cutoffHour(), 0);
  const lower = new Date(PktTime.atPkt(nudgeDate, 0, 0).getTime() - WINDOW_DAYS * 86400000);
  const rows = (await pagedRows('lp quiz offer: 6-12 deliveries', () => supabase
    .from(Deliveries.TABLE)
    .select('id, user_id, render_id, segment_id, lang, template_version, surface, delivered_at')
    .in('surface', Deliveries.SURFACES)
    .gte('delivered_at', lower.toISOString())
    .lt('delivered_at', upper.toISOString())))
    .filter((r) => r.user_id && offer.cohortRuleDate(r.delivered_at) === nudgeDate);
  if (!rows.length) return out;

  const segments = await provider.segmentsById(rows.map((r) => r.segment_id));
  const byTeacher = new Map();
  for (const r of rows) {
    if (!byTeacher.has(r.user_id)) byTeacher.set(r.user_id, []);
    byTeacher.get(r.user_id).push(r);
  }
  for (const [userId, own] of byTeacher) {
    // eslint-disable-next-line no-await-in-loop
    const quizzes = await provider.coveringQuizzes(userId, lower.toISOString());
    const classes = new Map();
    // Newest first, so each class names its newest lesson.
    own.sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at));
    for (const r of own) {
      if (quizzes.some((q) => provider.covers(q, provider.lessonKey(r)))) continue;
      const segment = segments.get(r.segment_id);
      const item = provider.toItem(r, segment);
      if (!item) continue;
      const key = KEY_PREFIX + offer.classKey(item.grade, segment.subject);
      if (classes.has(key)) continue;
      classes.set(key, {
        key,
        grade: item.grade,
        subject: segment.subject,
        source: 'lp612',
        lessons: [{
          lesson_ref: r.id,
          lesson_id: r.segment_id,
          segment_id: r.segment_id,
          lang: r.lang,
          delivered_at: r.delivered_at,
          topic: item.topic,
        }],
      });
    }
    out.set(userId, [...classes.values()].sort((a, b) => a.key.localeCompare(b.key)));
  }
  logEvent('lp_quiz_offer.cohort_612', {
    nudgeDate, teachers: out.size, offered: [...out.values()].filter((c) => c.length).length,
  });
  return out;
}

/**
 * Her yes on a 6-12 class: make the quiz through the provider and tie it to this offer.
 * `unavailable` was already answered by the provider; `already` is answered here.
 * @returns {Promise<true>}
 */
async function acceptLp612({ row, cls, from, user, language, reply }) {
  const lesson = cls.lessons[0];
  const out = await Provider().start(user, lesson.lesson_ref, { phone: from, via: 'lp_offer' });
  if (out.outcome === 'already') {
    await reply(from, 'lpQuizAlreadyHave', language);
    return true;
  }
  if (out.quizId) await Store.claimQuiz(row.id, out.quizId);
  logEvent('lp_quiz_offer.accepted_612', {
    nudgeId: row.id, tk: tk(row.user_id), class: cls.key, outcome: out.outcome, quizId: out.quizId || null,
  });
  return true;
}

module.exports = { classesFor, acceptLp612, KEY_PREFIX };
