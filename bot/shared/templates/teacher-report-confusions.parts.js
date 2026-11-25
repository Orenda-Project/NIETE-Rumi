'use strict';
/**
 * The teacher's live quiz report: "what your class got wrong, and the likely confusion" (queue #299, bd-vo9fkc).
 * Renders `r.misconceptions` (report-misconceptions.js), which teacher-report.data supplies only while app_settings
 * `quiz_report_misconceptions` is on; absent or empty, this returns '' and the page is unchanged byte for byte.
 * Strings are in ux-strings.js (en + ur); counts in the page language's digits (the page kit's D).
 */
const { resolveUx } = require('../config/ux-strings');

/**
 * @param {Array|undefined} items   r.misconceptions
 * @param {{lang: string, L: Function, M: Function, K: Function, D: Function, esc: Function}} kit the page's helpers
 */
function confusionsSection(items, { lang, L, M, K, D, esc }) {
  if (!Array.isArray(items) || !items.length) return '';
  const S = (key, params) => esc(resolveUx(key, { language: lang, params }));
  const rows = items.map((m) => {
    const count = L(S('quiz_report_confusions_picked', { picked: D(m.picked), answered: D(m.answered) }));
    const confusion = m.confusion
      ? `<div class="g cf-why" style="margin:8px 0 4px"><div class="gk" style="margin-bottom:.5em">${L(S('quiz_report_confusions_likely'))}</div>${K(m.confusion, 'div')}</div>` : '';
    return `<li class="band-red">${M(m.text, 'div', 'stem')}`
      + `<div class="wrong">${count}: ${M(m.pick.text)}</div>`
      + `<div class="wrong">${L(S('quiz_report_confusions_right'))}: ${M(m.right.text)}</div>${confusion}</li>`;
  }).join('');
  return `<section class="card" id="confusions"><h2>${L(S('quiz_report_confusions_title'))}</h2>`
    + `<p class="small muted">${L(S('quiz_report_confusions_sub'))}</p><ul class="qs">${rows}</ul></section>`;
}

module.exports = { confusionsSection };
