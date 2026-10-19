'use strict';
/**
 * A shared link's preview facts, kept in memory in the bot.
 *
 * WhatsApp builds a link's preview on the sender's phone before the message goes, and the portal answers that
 * fetch from these facts instead of rendering the quiz (2-3 s). The portal runs several worker processes, so the
 * facts live here, in the one bot process, where every worker can ask for them (GET /og/:code).
 *
 * Kept per CODE only: everything here is the same for every child who opens the code (getQuiz builds it per code,
 * never per device or session). Never a question, roster, chip or child, apart from a challenge code's
 * challenger (first name + score), which its og:title already shows.
 */
const KEEP_MS = 3600000;
const MAX = 2000;
const kept = new Map();

/** The fields a preview head reads (the portal's ogText / ogImageFor). */
function facts(p) {
  const q = (p && p.quiz) || {};
  const cls = (p && p.cls) || {};
  const ch = p && p.challenge;
  return {
    quiz: { lang: q.lang, topic: q.topic, n: q.n || (q.questions || []).length || 0, ...(q.topic_ur ? { topic_ur: q.topic_ur } : {}) },
    cls: { label: cls.label || null },
    challenge: ch ? { first: ch.first, correct: ch.correct, total: ch.total } : null,
    art: (p && p.art) || {},
    brand: (p && p.brand) || null,
    invited: Boolean(p && p.invited),
    // A storybook the teacher sent (web_quiz_stories_teacher): its preview names a story, not "0 questions". Absent otherwise.
    ...(p && p.story ? { story: true } : {}),
    // the finish card's switch, named only when on (the Urdu preview's digits); off, the facts are today's
    ...(p && p.card_v3 === true ? { card_v3: true } : {}),
    // the corrected Urdu share words (web_quiz_ur_share_copy), named only when on: the class table's preview says them
    ...(p && p.ur_share === true ? { ur_share: true } : {}),
  };
}

function remember(code, payload) {
  if (!payload || !payload.quiz) return null;
  const key = String(code || '').toUpperCase();
  const f = facts(payload);
  kept.delete(key);
  kept.set(key, { f, until: Date.now() + KEEP_MS });
  while (kept.size > MAX) kept.delete(kept.keys().next().value);
  return f;
}

function get(code) {
  const key = String(code || '').toUpperCase();
  const e = kept.get(key);
  if (!e) return null;
  if (e.until <= Date.now()) { kept.delete(key); return null; }
  return e.f;
}

/** The facts for a code: from memory, else from one quiz load (its errors, a 404 or 410, pass through). */
async function forCode(code, loadQuiz) {
  return get(code) || remember(code, await loadQuiz(String(code || '').toUpperCase()));
}

function _reset() { kept.clear(); }
function _size() { return kept.size; }

module.exports = { facts, remember, get, forCode, KEEP_MS, _reset, _size };
