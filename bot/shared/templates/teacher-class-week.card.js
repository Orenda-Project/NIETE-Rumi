'use strict';
/**
 * The class week card on the teacher's Jugnu tab (switch web_quiz_class_week): the fixed line the teacher
 * will forward, and the forward button (a link the server answers with a 302 to wa.me; NO JAVASCRIPT).
 * Drawn only when teacher-class-week.cardFor() returned a card. No name, no count, no number on it.
 *
 * Copy: jg.week.forward (T.<lang>.weekForward, the line itself) and jg.t.fwd_btn (T.<lang>.tFwdBtn).
 */
const CSS = `
.jwk-l{margin:0 0 10px;color:var(--ink)}
`;

/**
 * @param {{line: string}} card teacher-class-week cardFor()
 * @param {{L: Function, label: string, href: string}} o
 */
function renderWeekCard(card, { L, label, href }) {
  if (!card || !card.line || !label || !href) return '';
  return `<section class="card" id="jwk"><p class="jwk-l">${L(card.line)}</p><a class="btn btn-primary" href="${href}">${L(label)}</a></section>\n`;
}

module.exports = { renderWeekCard, CSS };
