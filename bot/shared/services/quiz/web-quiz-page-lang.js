'use strict';
/**
 * The quiz page in the child's language (app_settings web_quiz_page_lang, default off, fail off).
 *
 * On: the quiz and hub answers carry `page_lang: true`. The hub's Videos door then names the child's language on its
 * links to a quiz page (dashboard wq-doors.js), and the edge opens that page in it (web-quiz.routes uiLangOf: lang/dir
 * and the boot's ui_lang), so an Urdu child's English lesson has its page's own words in Urdu while the questions stay
 * in the quiz's language. Off: the key is absent, so every answer and every page is today's, byte for byte. Only the
 * stored JSON boolean true turns it on: the string 'true', '"true"', 1, {enabled:true}, no row or a failed read are off.
 *
 * The key rides the hub switches' one app_settings read (web-quiz-hub-flags.js); the quiz answer has read them too
 * (pageNav). carry() looks at that cache once the answer is in, so the switch adds no read of its own; a cold or
 * expired cache is off.
 */
const Flags = require('./web-quiz-hub-flags');

const KEY = Flags.PAGE_LANG_KEY;
const FIELD = 'page_lang';

/** The switch, never waited for and never read here. Never throws. */
function on(now = Date.now()) {
  try { return Flags.nowOf('pageLang', now); } catch (_) { return false; }
}

/** A page answer (or its promise) with `page_lang: true` while on; the same answer, untouched, while off. */
function carry(answerP) {
  return Promise.resolve(answerP).then((out) => (on() && out && typeof out === 'object' && !Array.isArray(out) ? Object.assign(out, { [FIELD]: true }) : out));
}

module.exports = { on, carry, KEY, FIELD };
