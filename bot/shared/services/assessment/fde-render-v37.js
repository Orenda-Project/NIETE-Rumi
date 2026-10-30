/**
 * v37 layout helpers for the FDE paper renderer (round 6). Pure: strings in, HTML out.
 *   - LISTEN_LABEL: the key's story box under Listening is named for its task, not «Read aloud» (G1 English).
 *   - marksText: «08» prints «8», as every other mark on the paper does (G5 Urdu Q2 ب).
 *   - alphabetStrip: the Urdu extended alphabet in book order, printed with an ordering question (G2 Urdu Q2).
 *   - lineCount / ruledLines: one numbered ruled line per sentence or turn the heading asks for (G2 Urdu Q7-Q9).
 *   - passageAgain / reprintAt: a long reading set prints its passage again before item (h), so the child sees it
 *     while answering the items on the next page (G2 English Q1).
 */

const LISTEN_LABEL = {
  en: 'Listening story (teacher reads aloud)',
  ur: 'سننے کی کہانی (استاد پڑھ کر سنائیں)',
};

// A poem box is named for the poem (v37 round 4: «سننے کی کہانی» on a poem). Urdu only; a cited book page prints beside it.
const POEM_LABEL = { ur: 'سننے کی نظم (استاد پڑھ کر سنائیں)' };
function scriptLabel(task, lang, c) {
  const poem = lang === 'ur' && task.id === 'poem' && task.kind === 'listening';
  const base = poem ? POEM_LABEL.ur : LISTEN_LABEL[lang];
  return poem && c && c.page ? `${base} — صفحہ ${c.page}` : base;
}

/** A bare number with a leading zero loses it; «0», «10», «{t:20}» and any text pass through. */
function marksText(s) {
  return typeof s === 'string' ? s.replace(/^0+(?=[0-9])/, '') : s;
}

const ALPHABET = 'ا آ ب پ ت ٹ ث ج چ ح خ د ڈ ذ ر ڑ ز ژ س ش ص ض ط ظ ع غ ف ق ک گ ل م ن و ہ ھ ء ی ے'.split(' ');

function alphabetStrip() {
  return `<div class="alpha-strip">${ALPHABET.map((l) => `<span>${l}</span>`).join('')}</div>`;
}

const COUNT_WORDS = [
  ['تین', 'three', 3], ['چار', 'four', 4], ['پانچ', 'five', 5], ['چھ', 'six', 6], ['سات', 'seven', 7], ['آٹھ', 'eight', 8],
];

/** How many sentences or turns the heading asks for; 0 when it names none. */
function lineCount(slot) {
  const ur = String((slot && slot.instruction_ur) || '');
  const en = String((slot && slot.instruction_en) || '').toLowerCase();
  for (const [u, e, n] of COUNT_WORDS) {
    if (new RegExp(`(^|\\s)${u}\\s+(جملے|باتوں)`).test(ur)) return n;
    if (new RegExp(`\\b${e}\\s+(sentences|turns|lines)\\b`).test(en)) return n;
  }
  return 0;
}

/** `num` turns 1..n into the paper's own digits. */
function ruledLines(n, num) {
  return Array.from({ length: n }, (_, i) => `<div class="rl"><span class="rn">${num(String(i + 1))}</span></div>`).join('');
}

const REPRINT_AT = 7;
const reprintAt = (count) => (count > REPRINT_AT ? REPRINT_AT : 0);

function passageAgain(passageHtml, medium) {
  const head = medium === 'ur' ? 'عبارت (دوبارہ)' : 'Passage (again)';
  return `<div class="passage reprint"><div class="rp-head">${head}</div>${passageHtml}</div>`;
}

const V37_CSS = `
  .alpha-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 10px; border: 1px solid #888; padding: 3px 8px; margin: 3px 0 5px; font-size: 1.15em; break-inside: avoid; }
  .rl { height: 9.5mm; border-bottom: 1px solid #000; margin: 0; break-inside: avoid; display: flex; align-items: flex-end; }
  .rl .rn { font-size: .85em; min-width: 6mm; }
  .passage.reprint { break-before: page; }
  .rp-head { font-weight: 700; font-size: .85em; }`;

module.exports = { LISTEN_LABEL, POEM_LABEL, scriptLabel, marksText, alphabetStrip, lineCount, ruledLines, reprintAt, passageAgain, REPRINT_AT, V37_CSS };
