'use strict';
/**
 * Board header, roll-number/version bubbles and per-section answer notes. Header lines are printed exactly as
 * the chrome wrote them into `_layout.header` (`lines_en` / `lines_ur`): nothing is re-typed here, only the
 * `{t:}` atoms are filled. A layout without a header prints none (never an invented one).
 */
const { textOf, marksText } = require('./text');

const WORDS = {
  en: { roll: 'Roll No', version: 'Version', omr: 'Answer on the OMR sheet.', sheet: 'Write the answers on the separate answer sheet.' },
  // ur: needs fluent-Urdu review (design_pending)
  ur: { roll: 'رول نمبر', version: 'ورژن', omr: 'جواب OMR شیٹ پر دیں۔', sheet: 'جوابات الگ جوابی کاپی پر لکھیں۔' },
};

function headerBlock(layout, lang) {
  const lines = layout.header && layout.header[`lines_${lang}`];
  if (!Array.isArray(lines) || lines.length === 0) return '';
  const rtl = lang === 'ur';
  return `<div class="hdr">${lines.map((l) => `<div>${marksText(l, rtl)}</div>`).join('')}</div>`;
}

/** Roll number (6 columns x 0-9) and version (A-D) bubbles, only when a section is answered on the paper. */
function bubbleBlock(layout, lang) {
  if (!layout.sections.some((s) => s.answer_on === 'question_paper')) return '';
  const rtl = lang === 'ur';
  const w = WORDS[lang];
  const roll = Array.from({ length: 6 }, () => `<div class="bubcol">${Array.from({ length: 10 }, (_, d) => `<div>${textOf(d, rtl)} <span class="bub"></span></div>`).join('')}</div>`).join('');
  const version = ['A', 'B', 'C', 'D'].map((v) => `<div>${v} <span class="bub"></span></div>`).join('');
  return `<div class="bubbles"><div><b>${w.roll}</b><div style="display:flex;gap:6px">${roll}</div></div><div><b>${w.version}</b>${version}</div></div>`;
}

/** The line above a section saying where its answers go; a section's own note wins. */
function noteFor(section, lang) {
  const own = section[`note_${lang}`];
  if (own) return own;
  if (section.answer_on === 'omr') return WORDS[lang].omr;
  if (section.answer_on === 'e_sheet') return WORDS[lang].sheet;
  return '';
}

module.exports = { headerBlock, bubbleBlock, noteFor };
