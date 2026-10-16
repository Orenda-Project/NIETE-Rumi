'use strict';
/**
 * The class week card on the teacher's Jugnu tab (switch web_quiz_class_week): its title, the line under it,
 * the fixed line the teacher will forward, and the forward button (a link the server answers with a 302 to
 * wa.me; NO JAVASCRIPT). Drawn only when teacher-class-week.cardFor() returned a card. No name, no count,
 * no number on it.
 *
 * Copy: jg.week.card_title, jg.week.card_sub, jg.week.forward (the line itself) and jg.t.fwd_btn.
 * The card sets its own direction and language; the Urdu card is set in the report's Urdu face
 * (niete-brand FONTS.bodyUrdu, the stack the report's .c-rtl text uses).
 */
const { FONTS } = require('./niete-brand');
const { clampLanguage } = require('../config/ux-strings');

const CSS = `
.jwk-t{font-size:1.1rem;margin:0 0 4px}
.jwk-l{margin:10px 0;color:var(--ink)}
#jwk[lang="ur"]{font-family:${FONTS.bodyUrdu}}
`;

/**
 * @param {{line: string}} card teacher-class-week cardFor()
 * @param {{L: Function, lang: 'en'|'ur', title: string, sub: string, label: string, href: string}} o
 */
function renderWeekCard(card, { L, lang = 'en', title, sub, label, href }) {
  if (!card || !card.line || !title || !label || !href) return '';
  const lg = clampLanguage(lang);
  return `<section class="card" id="jwk" dir="${lg === 'ur' ? 'rtl' : 'ltr'}" lang="${lg}"><h2 class="jwk-t">${L(title)}</h2>`
    + `${sub ? `<p class="muted small">${L(sub)}</p>` : ''}<p class="jwk-l">${L(card.line)}</p>`
    + `<a class="btn btn-primary" href="${href}">${L(label)}</a></section>\n`;
}

module.exports = { renderWeekCard, CSS };
