'use strict';
/**
 * bd-v0toag.9 / .10 — the teacher report page's v21 pieces. Each renders only when
 * teacher-report.data supplied its data, which it does only with app_settings
 * `quiz_slo_retest_enabled` on; otherwise each returns '' and the page is unchanged.
 * NIETE is flat en/ur: every string is in both.
 */

const STRINGS = {
  en: {
    completed: 'Completed',
    tries: (n) => `<span class="num">${n}</span> tries`,
  },
  ur: {
    completed: 'مکمل کیا',
    tries: (n) => `<span class="num">${n}</span> بار`,
  },
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const S = (lang) => STRINGS[lang] || STRINGS.en;
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** The fourth tile: finished of started, beside Average. */
function completionTile(c, lang) {
  if (!c || !int(c.started)) return '';
  return `<div class="tile tile-done"><div class="k">${S(lang).completed}</div><div class="v num">${int(c.pct)}%</div><div class="t muted"><span class="num" dir="ltr">${int(c.finished)}/${int(c.started)}</span></div></div>`;
}

/** "N tries" on a child's score row, only when they tried more than once. */
function triesTag(n, lang) {
  return int(n) > 1 ? `<span class="tries tag">${S(lang).tries(int(n))}</span>` : '';
}

/** The curriculum SLO code on a question row, in place of nothing (S-labels were never shown here). */
function codeChip(code) {
  return code ? `<span class="slo" dir="ltr">${esc(code)}</span>` : '';
}

const CSS = '.tiles.tiles-4{grid-template-columns:repeat(4,1fr)}'
  + '.slo{display:inline-block;font-size:.7rem;background:var(--grey-bg);color:var(--ink);border-radius:999px;padding:0 8px;margin-inline-start:6px;line-height:1.6}';

/** True when the rendered html carries a v21 piece; the page adds CSS only then (switch off = byte-identical). */
const usedIn = (html) => /class="(?:tiles tiles-4|slo|tries tag)"/.test(String(html || ''));

module.exports = { STRINGS, completionTile, triesTag, codeChip, CSS, usedIn };
