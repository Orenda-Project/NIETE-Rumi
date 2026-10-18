'use strict';
/**
 * The quiz page in a grown-up's chosen language (app_settings `web_quiz_return_lang`). A grown-up who picks a child's
 * language in the home's grown-ups corner writes it to child_language as 'chosen'; every hub page and link already
 * puts it first (web-quiz-child-lang.js ladder()). The quiz page /q/<code>?k=<chip> now does too: the edge passes the
 * chip, and the quiz answer names `child_lang: 'en'|'ur'` for that child, which the edge opens the page in (before the
 * link's ?lang). Only a grown-up's choice counts: a join language still loses to the quiz's own, as the ladder says.
 *
 *   field(ctx, k)   {child_lang} for a chip of this class whose row is 'chosen'; else {} (no k, a chip of the wrong
 *                   shape, an unknown chip, no row, a join row, the switch off, any read error). Never throws.
 *
 * Off: {} and nothing is read. Logs carry an error code only: never an id, a name or a chip.
 */
const { logToFile } = require('../../utils/logger');
const R = require('./web-quiz-return-lang');

// A chip is web-quiz-token chipId(): 16 lowercase hex.
const CHIP_RX = /^[0-9a-f]{16}$/;

async function field(ctx, k) {
  const want = typeof k === 'string' && CHIP_RX.test(k) ? k : null;
  if (!want || !ctx) return {};
  try {
    if (!(await R.on())) return {};
    // the chip as startSession resolves one: this code's chips, then a chip the child was given on an earlier code
    const chips = await require('./web-quiz.service').classChips(ctx);
    const hit = chips.find((c) => c.chip === want) || chips.find((c) => c.aliases.has(want));
    if (!hit) return {};
    const row = await require('./web-quiz-child-lang').ownOf(hit.studentId, { raw: true });
    const lang = row && row.source === 'chosen' ? R.linkLang(row.language) : null;
    return lang ? { child_lang: lang } : {};
  } catch (err) {
    logToFile('⚠️ quiz page language: not read — none', { code: (err && err.code) || null });
    return {};
  }
}

module.exports = { field, CHIP_RX };
