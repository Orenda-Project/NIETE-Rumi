'use strict';
/**
 * The closed and "not open" child pages in the child's language (app_settings web_quiz_closed_lang, default off, fail
 * off, 30 s cache).
 *
 * Today the edge draws a child home's closed page (an expired /quiz link, 401) and its "not open right now" page (the bot
 * away, 502/503) in the PHONE's language, and a class link's "not open" page (the bot away) in English. So an Urdu child
 * on a phone set to English reads them in English. On:
 *   - a home link that is genuine but expired answers its 401 with the children's `lang` (the hub's own rule for a phone
 *     that may not see the children: their class quizzes' language, else the link's `l`, else their own quizzes'); a
 *     forged or garbled link gets today's 401 (no language, so nothing about any child);
 *   - the quiz and hub answers say `closed_lang: true`, so the edge also knows the switch for a page it draws without the
 *     bot (the bot away): it then takes the home link's own `l`, the link's ?lang=, or a class code's known language.
 * Off: the key is absent, every answer is today's, byte for byte. Only the stored JSON boolean true turns it on.
 *
 * on() never waits: it answers from the cache and refreshes it in the background (web-quiz-one-face.js's shape), so the
 * switch adds no database round trip to a child's page. The 401's language is read only on that closed answer.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const T = require('./web-quiz-token');
const { read: dbRead } = require('./web-quiz-db-deadline');   // a deadline + one retry on reads (web_quiz_db_deadline)

const KEY = 'web_quiz_closed_lang';
const FIELD = 'closed_lang';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
function isTrue(value) {
  return value === true;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz closed lang: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, never waited for: the cached value, refreshed in the background when stale. Never throws. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on && now - cache.at < 2 * TTL_MS);
}

/** The switch, waited for (the closed answer, and tests). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/** A quiz or hub answer with `closed_lang: true` only when on; nothing added when off. */
function carry(answerP) {
  const yes = on();
  return Promise.resolve(answerP).then((out) => (yes && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

/**
 * The hub's answer: the same field, from the hub's one switch read (web-quiz-hub-flags.js carries this key), so a
 * child's home makes no settings read of its own for it. The hub's flags() has run by the time its answer resolves.
 */
function carryHub(answerP) {
  return Promise.resolve(answerP).then((out) => (out && typeof out === 'object' && !Array.isArray(out) && require('./web-quiz-hub-flags').closedLangNow() ? Object.assign(out, { [FIELD]: true }) : out));
}

/**
 * The language of the children a genuine home link names, expired or not; null for a forged or garbled link, or when
 * nothing can be read (the edge then keeps today's language). The same rule as the hub's locked page (web-quiz-hub.js
 * lockedHub): no name, chip or quiz is read out, only the language.
 */
async function hubLang(token) {
  const tok = T.verify(token, 'h', { allowExpired: true });
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length) return null;
  const linked = tok.l === 'en' || tok.l === 'ur' ? tok.l : null;
  try {
    const { data: rows, error } = await dbRead('closedLang:students:1', (db) => db.from('students').select('id, is_active').in('id', tok.ids.map(String)));
    if (error) throw new Error(error.message || 'students read failed');
    const live = (rows || []).filter((r) => r.is_active !== false);
    if (!live.length) return linked;
    const StudentQuiz = require('./student-quiz.service');
    const history = await StudentQuiz.quizzesForStudents(live);
    return clampLanguage(StudentQuiz.classLanguage(history) || linked || StudentQuiz.childLanguage(history));
  } catch (err) {
    logToFile('⚠️ web quiz closed lang: the children\'s language could not be read', { error: err.message });
    return linked;
  }
}

/**
 * A home answer whose 401 (the link is not good now) carries the children's `lang` while on. Any other answer or
 * failure, and every 401 while off or for a forged link, passes as it came.
 */
function closedHub(answerP, token) {
  return Promise.resolve(answerP).catch(async (err) => {
    if (!(err && err.status === 401 && err.body && typeof err.body === 'object')) throw err;
    let lang = null;
    try { lang = (await flag()) ? await hubLang(token) : null; } catch (_) { lang = null; }
    if (lang === 'en' || lang === 'ur') err.body = { ...err.body, lang };
    throw err;
  });
}

module.exports = { on, flag, carry, carryHub, hubLang, closedHub, KEY, FIELD, TTL_MS, _reset: () => { cache = null; reading = null; } };
