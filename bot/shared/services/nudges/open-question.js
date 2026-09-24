'use strict';
/**
 * ONE OPEN QUESTION AT A TIME — is the teacher answering one of our questions
 * right now?
 *
 * Four surveys end a 👎 with a question whose answer is the teacher's NEXT plain
 * text: the K-5 lesson-plan survey, the 6-12 one, the coaching survey and the
 * video survey. For ten minutes after the 👎 the text handler hands that text to
 * the survey before any router sees it. A scheduled ask sent into that window
 * (the coaching ask after a lesson plan, the 15:00 quiz offer) cannot be answered
 * by typing: a typed "yes" or "جی" is saved as the survey's reason and the
 * teacher is thanked for feedback they did not give. The sweeper asks this module
 * first and, while a question is open, hands the row back to wait for it to close.
 *
 * THE KEYS ARE THE OWNERS'. Each survey service exports its own
 * `REDIS_REASON_KEY` and `REASON_WINDOW_SECS`; they are restated here rather than
 * required, because requiring the survey services would pull the WhatsApp client
 * and the lesson-plan code into the sweeper's load path. The test
 * `tests/lp-v8/lp-coaching-ask-survey-window.test.js` arms each window through its
 * owner's export, so the two spellings cannot drift apart unnoticed.
 *
 * FAILS OPEN. A cache that cannot be read means no window could have been armed
 * either (the surveys write it to the same cache), so the answer is "nothing open"
 * — logged at error level, never a silently lost ask.
 */

const { logToFile } = require('../../utils/logger');

/** The windows that take the next typed message, in no particular order. */
const WINDOWS = Object.freeze([
  Object.freeze({ kind: 'lp_survey', key: (userId) => `lp_feedback_pending:${userId}`, seconds: 600 }),
  Object.freeze({ kind: 'lp612_survey', key: (userId) => `lp612_feedback_pending:${userId}`, seconds: 600 }),
  Object.freeze({ kind: 'coaching_survey', key: (userId) => `coaching_feedback_pending:${userId}`, seconds: 600 }),
  Object.freeze({ kind: 'video_survey', key: (userId) => `student_video_feedback_pending:${userId}`, seconds: 600 }),
]);

/** A key whose window has (by its own clock) passed is still there: wait a minute, not zero. */
const MIN_WAIT_MS = 60 * 1000;

/**
 * The open question this teacher still owes an answer, if any.
 *
 * @param {string} userId
 * @param {{now?: Date}} [opts]
 * @returns {Promise<{kind: string, until: Date}|null>} `until` is when the last open
 *   window closes — never earlier than a minute from `now`, never later than one
 *   whole window from `now`.
 */
async function openQuestion(userId, { now = new Date() } = {}) {
  if (!userId) return null;
  const at = (now instanceof Date ? now : new Date(now)).getTime();

  let cache;
  try {
    cache = require('../cache/railway-redis.service');
  } catch (err) {
    logToFile('❌ open-question: cache unavailable, treating as no open question', { error: err.message }, 'error');
    return null;
  }

  let latest = null;
  for (const w of WINDOWS) {
    let pending;
    try {
      pending = await cache.get(w.key(userId));
    } catch (err) {
      logToFile('❌ open-question: could not read a survey window, treating it as closed', {
        userId, kind: w.kind, error: err.message,
      }, 'error');
      continue;
    }
    if (!pending) continue;

    const windowMs = w.seconds * 1000;
    const prompted = Number(pending && pending.promptedAt);
    const closes = Number.isFinite(prompted) && prompted > 0 ? prompted + windowMs : at + windowMs;
    const until = Math.min(Math.max(closes, at + MIN_WAIT_MS), at + windowMs);
    if (!latest || until > latest.until.getTime()) latest = { kind: w.kind, until: new Date(until) };
  }
  return latest;
}

module.exports = { openQuestion, WINDOWS };
