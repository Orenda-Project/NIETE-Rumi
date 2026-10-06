/**
 * Rows → what the page receives. Each case's row goes through the server's own
 * questionPayload() (web-quiz.service: figure drawing, picture options, emoji tiles,
 * WhatsApp match decoding, the web item) and playable() (a question whose stem
 * points at a picture it does not have is never served). The page shell is the
 * real renderQuizPage().
 *
 * The bot service needs its Supabase env to load; nothing here reaches a database.
 */
'use strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-only';

const CODE = 'RMTX01';
let Svc = null;
function svc() {
  // eslint-disable-next-line global-require
  if (!Svc) Svc = require('../../../bot/shared/services/quiz/web-quiz.service');
  return Svc;
}

/** The E2 question for one case, or null when the server would not serve it (unplayable). */
function question(c) {
  const S = svc();
  if (!S.playable(c.row)) return null;
  return S.questionPayload(c.row, 0, CODE, c.audio || null, false);
}

/** The whole E2 payload of a one-question quiz for this case. */
function payload(c, q) {
  return {
    cls: { label: 'Class 3-B', teacher: 'Teacher Testwala', chips: [] }, live: {}, video: null,
    quiz: { code: CODE, lang: c.lang, topic: c.lang === 'ur' ? 'مادہ' : 'Matter', grade: 3, questions: [q] },
  };
}

/** The real page shell for a case (null when unplayable). */
function pageHtml(c, origin) {
  const q = question(c);
  if (!q) return null;
  // eslint-disable-next-line global-require
  const { renderQuizPage } = require('../../routes/web-quiz.routes');
  return renderQuizPage({ payload: payload(c, q), code: CODE, view: 'quiz', origin: origin || 'http://127.0.0.1', assetV: 'rm' });
}

/** A wrong answer and the right answer for a question, as the page's wire() would send them. */
function answers(q) {
  const slots = (q.options || []).map((o) => o.slot);
  const key = String(q.correct_slot || '');
  const keyList = key.split(',').filter(Boolean);
  const kind = String(q.type || '');
  if (kind === 'order' || kind === 'match') {
    const wrong = [...keyList].reverse();
    if (wrong.join(',') === key) wrong.push(wrong.shift());
    return { wrong: wrong.join(','), right: key };
  }
  if (keyList.length > 1) return { wrong: slots.filter((s) => !keyList.includes(s)).slice(0, 1).join(','), right: key };
  return { wrong: slots.find((s) => s !== key) || slots[0], right: key };
}

module.exports = { question, payload, pageHtml, answers, CODE };
