/**
 * Child test v2 — the print pack (bd-s1oo0.46.5, lane L29; design COACH_JOURNEY_V2 §5, CONTRACT §19).
 *
 * What the operator prints for each coach, once a term:
 *   - per grade, three laminated A4 cards, one task per side (EGRA Toolkit pp. 52, 97):
 *       Urdu    front: the story only · back: "only if the child can't read the story": 10 letters, 10 words
 *       English front: the story only · back: the same
 *       Maths   front: A–D four number pairs, 1–4 four sums · back: blank (the coach reads the word problems)
 *     every side in the grade's colour (Grade 3 green, Grade 5 blue) with "Grade 3 · Urdu" and
 *     "Set A · Oct–Dec 2026" in the band, big enough to read from a metre, so the wrong card is not picked up;
 *   - one coach page: English front, Urdu back (the sitting picture, what to bring, the five rules);
 *   - the "before the first child" setup picture the bot sends (CONTRACT §19, L29 → L26).
 *
 * A CHILD side carries no answer, no question, no word problem and no item number. The maths card
 * keeps its A–D / 1–4 labels: the coach points to them while the step message says "point to each pair".
 *
 * Pure builders (item-bank form in, HTML out) plus thin render wrappers. Content comes from the item
 * bank; until the bank carries `maths.oral` (L27) the Set A items are CONTRACT §19's table and Set B
 * a draft parallel set (`equated: false`), and the caller is told which (`oralMaths().source`).
 */

const { fontFaceCss, LATIN_STACK, URDU_STACK } = require('./fonts');
const { esc } = require('./html');

const INK = '#111111';
const GRADE_COLOUR = {
  3: { name: 'green', hex: '#1B7F45', tint: '#E7F4EC' },
  5: { name: 'blue', hex: '#1F56A8', tint: '#E6EEF9' },
};
const TERMS = { A: 'Oct–Dec 2026', B: 'Jan–Mar 2027' };
const SUBJECT = { urdu: 'Urdu', english: 'English', maths: 'Maths' };
const SUBJECT_UR = { urdu: 'اردو', english: 'انگریزی', maths: 'ریاضی' };
const NOT_YET = 'Next term — do not print yet';
const SETUP_PICTURE = { cssWidth: 540, scale: 2, viewW: 1080, viewH: 860 };

const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** Urdu digits for Urdu prose (language-protocol §9.4): U+06F0–06F9, never the Arabic set. */
function urDigits(s) { return String(s).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]); }

function setLabel(set, termLabel) {
  const s = String(set || '').toUpperCase();
  const term = termLabel || TERMS[s];
  if (!term) throw new Error(`child-test print v2: no term for set "${set}"`);
  return `Set ${s} · ${term}`;
}

/** How a sum is printed: spaced true signs (− × ÷ +), never a hyphen or an x. */
function mathsDisplay(prompt) {
  return String(prompt)
    .replace(/\s+/g, '')
    .replace(/(\d)([-−+x×*÷/])(?=\d)/g, (_, d, op) => `${d} ${{ '-': '−', '−': '−', '+': '+', x: '×', '×': '×', '*': '×', '÷': '÷', '/': '÷' }[op]} `);
}

/* ------------------------------------------------------------------ oral maths content -- */

// CONTRACT §19 table (May instrument). Used only until the item bank carries maths.oral (L27).
const COMPARE_A = [[11, 16], [93, 77], [625, 638], [3826, 2863]];
const CONTRACT_TABLE = {
  A: {
    compare: COMPARE_A,
    3: {
      sums: [['14+1', 15], ['19-6', 13], ['92-41', 51], ['85+37', 122]],
      word_problems: [
        { id: 'wp_biscuits', prompt_en: 'You have 3 biscuits. Sana gives you 3 more. How many biscuits do you have now?', prompt_ur: 'آپ کے پاس 3 بسکٹ ہیں۔ ثنا آپ کو 3 اور دیتی ہے۔ اب آپ کے پاس کتنے بسکٹ ہیں؟', answer: 6 },
        { id: 'wp_apples', prompt_en: 'Ayesha has 15 apples. 3 of those apples are red. The rest are green. How many green apples does Ayesha have?', prompt_ur: 'عائشہ کے پاس 15 سیب ہیں۔ ان میں سے 3 لال ہیں، باقی ہرے ہیں۔ ہرے سیب کتنے ہیں؟', answer: 12 },
      ],
    },
    5: {
      sums: [['92-41', 51], ['85+37', 122], ['8x9', 72], ['72÷6', 12]],
      word_problems: [
        { id: 'wp_balls', prompt_en: 'Ahmed puts 4 balls in a bag. Now there are 25 balls in the bag. How many balls were in the bag to begin with?', prompt_ur: null, answer: 21 },
        { id: 'wp_bananas', prompt_en: 'There are 5 girls and 25 bananas. The girls share the bananas equally. How many bananas does each girl get?', prompt_ur: null, answer: 5 },
      ],
    },
  },
  // Draft parallel items for next term (same structure, different numbers), not equated. L27 owns the real ones.
  B: {
    compare: [[12, 17], [85, 68], [734, 741], [5193, 1958]],
    3: { sums: [['13+2', 15], ['18-7', 11], ['87-43', 44], ['76+48', 124]], word_problems: [] },
    5: { sums: [['87-43', 44], ['76+48', 124], ['7x8', 56], ['63÷7', 9]], word_problems: [] },
  },
};

/**
 * The maths card's items for a grade and set.
 * @returns {{ items: {compare, sums, word_problems}, source: 'item-bank'|'contract-table'|'draft-parallel' }}
 */
function oralMaths({ grade, set, form }) {
  const oral = form && form.maths && form.maths.oral;
  if (oral && Array.isArray(oral.compare) && Array.isArray(oral.sums)) {
    return { items: { compare: oral.compare, sums: oral.sums, word_problems: oral.word_problems || [] }, source: 'item-bank' };
  }
  const s = String(set || 'A').toUpperCase();
  const t = CONTRACT_TABLE[s];
  if (!t || !t[grade]) throw new Error(`child-test print v2: no oral maths for grade ${grade} set ${s}`);
  const L = 'ABCD';
  return {
    items: {
      compare: t.compare.map(([a, b], i) => ({ id: `cmp_${L[i]}`, a, b, answer: Math.max(a, b) })),
      sums: t[grade].sums.map(([prompt, answer], i) => ({ id: `sum_${i + 1}`, prompt, answer })),
      word_problems: t[grade].word_problems,
    },
    source: s === 'A' ? 'contract-table' : 'draft-parallel',
  };
}

/* ------------------------------------------------------------------------- the cards -- */

const CARD_CSS = `
@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#fff;color:${INK}}
.page{width:210mm;height:297mm;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column;page-break-after:always;break-after:page;--s:1}
.page:last-child{page-break-after:auto;break-after:auto}
header{flex:0 0 auto;direction:ltr}
.band{background:var(--band);color:#fff;height:30mm;box-sizing:border-box;padding:0 12mm;display:flex;align-items:center;justify-content:space-between;gap:6mm}
.band .lab{font:700 31pt/1 ${LATIN_STACK};letter-spacing:.01em;white-space:nowrap}
.band .right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:1mm}
.band .set{font:700 17pt/1.1 ${LATIN_STACK};white-space:nowrap;background:rgba(255,255,255,.18);padding:1.5mm 3mm;border-radius:2mm}
.band .urlab{font:16pt/1.8 ${URDU_STACK};direction:rtl;unicode-bidi:isolate}
.only{margin:5mm 14mm 0;padding:2.5mm 4mm;border-radius:2mm;background:var(--tint);color:#344054;display:flex;justify-content:space-between;align-items:center;gap:6mm;font:13pt/1.3 ${LATIN_STACK}}
.only .ur{font:14pt/2 ${URDU_STACK};direction:rtl;unicode-bidi:isolate}
.stamp{margin:4mm 14mm 0;border:1mm solid #B42318;color:#B42318;font:700 16pt/1.2 ${LATIN_STACK};text-align:center;padding:2mm;border-radius:2mm;letter-spacing:.02em}
.foot{flex:0 0 12mm;background:var(--band)}
.fit{flex:1 1 auto;overflow:hidden;padding:12mm 16mm 10mm;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--s)*12mm)}
.story{margin:0}
.story.ur{font-family:${URDU_STACK};direction:rtl;text-align:right;line-height:2.15;word-spacing:.12em;padding:0 3mm}
.story.en{font-family:${LATIN_STACK};direction:ltr;text-align:left;line-height:1.6;word-spacing:.06em}
.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));column-gap:7mm;row-gap:calc(var(--s)*6mm);text-align:center;align-items:center}
.grid .it{white-space:nowrap;unicode-bidi:isolate;min-width:0;padding:1mm 0}
.grid.ur{font-family:${URDU_STACK};direction:rtl;line-height:1.9}
.grid.en{font-family:${LATIN_STACK};direction:ltr;line-height:1.3}
.rule{border:0;border-top:.7mm dashed #C9CDD2;margin:0}
.mgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--s)*6mm) 8mm;direction:ltr}
.mgrid.pairs{grid-template-columns:minmax(0,1fr)}
.box{border:.7mm solid #98A2B3;border-radius:4mm;padding:calc(var(--s)*5mm) 4mm calc(var(--s)*4mm);display:flex;align-items:center;gap:3mm;font-family:${LATIN_STACK};white-space:nowrap;min-width:0}
.box .tag{flex:0 0 10mm;height:10mm;border-radius:50%;background:var(--tint);color:var(--band);font:700 14pt/10mm ${LATIN_STACK};text-align:center;align-self:center}
.box .n{flex:1 1 0;line-height:1;text-align:center}
.box .n.sum{padding-right:10mm}
`;

/** In-page: grow the type until something would overflow, then step back (floor 0.6, cap data-max). */
const FIT_SCRIPT = `
window.__beforeCapture = async function () {
  var overflow = [], scales = {};
  function over(fit) {
    if (fit.scrollHeight > fit.clientHeight + 1 || fit.scrollWidth > fit.clientWidth + 1) return true;
    return Array.prototype.some.call(fit.querySelectorAll('.it,.box'), function (el) { return el.scrollWidth > el.clientWidth + 1; });
  }
  document.querySelectorAll('.page').forEach(function (pg) {
    var fit = pg.querySelector('.fit');
    var s = 1;
    if (fit && fit.children.length) {
      s = Number(fit.getAttribute('data-max')) || 1.5;
      var min = Number(fit.getAttribute('data-min')) || 0.6;
      pg.style.setProperty('--s', s);
      while (over(fit) && s > min) { s = Math.max(min, Math.round((s - 0.02) * 100) / 100); pg.style.setProperty('--s', s); }
      if (over(fit)) overflow.push(pg.getAttribute('data-page'));
    } else if (pg.scrollHeight > pg.clientHeight + 1) overflow.push(pg.getAttribute('data-page'));
    scales[pg.getAttribute('data-page')] = s;
  });
  return { overflow: overflow, scales: scales, pages: document.querySelectorAll('.page').length };
};
`;

const BASE_PT = { // before the fit pass scales them
  3: { story: { urdu: 26, english: 24 }, letters: { urdu: 44, english: 44 }, words: { urdu: 30, english: 28 }, compare: 46, sums: 40 },
  5: { story: { urdu: 21, english: 19 }, letters: { urdu: 40, english: 40 }, words: { urdu: 28, english: 26 }, compare: 44, sums: 38 },
};
const pt = (n) => `calc(var(--s)*${n}pt)`;

function header({ grade, card, set, termLabel, notYet, only }) {
  const right = `<span class="set">${esc(setLabel(set, termLabel))}</span>`
    + `<span class="urlab" lang="ur" dir="rtl">جماعت ${urDigits(grade)} – ${SUBJECT_UR[card]}</span>`;
  return '<header>'
    + `<div class="band"><span class="lab">Grade ${grade} · ${SUBJECT[card]}</span><span class="right">${right}</span></div>`
    + (only || '')
    + (notYet ? `<div class="stamp">${NOT_YET}</div>` : '')
    + '</header>';
}

function section({ grade, card, side, set, termLabel, notYet, only, body, max, pageId }) {
  const c = GRADE_COLOUR[grade];
  if (!c) throw new Error(`child-test print v2: no colour for grade ${grade}`);
  const id = pageId || `g${grade}/${card}/${side}`;
  return `<section class="page card" data-page="${id}" data-audience="child" data-grade="${grade}" data-card="${card}" data-side="${side}" style="--band:${c.hex};--tint:${c.tint}">`
    + header({ grade, card, set, termLabel, notYet, only })
    + `<div class="fit" data-max="${max || 1.5}">${body || ''}</div><div class="foot"></div></section>`;
}

function need(form, block) {
  const b = form && form[block];
  if (!b) throw new Error(`child-test print v2: the form has no ${block} block`);
  return b;
}

function grid(items, cls, size) {
  return `<div class="grid ${cls}" style="font-size:${pt(size)}">${items.map((t) => `<div class="it">${esc(t)}</div>`).join('')}</div>`;
}

const ONLY = {
  urdu: '<div class="only"><span>Only if the child can\'t read the story</span><span class="ur" lang="ur" dir="rtl">صرف اس صورت میں جب بچہ کہانی نہ پڑھ سکے</span></div>',
  english: '<div class="only"><span>Only if the child can\'t read the story</span><span class="ur" lang="ur" dir="rtl">صرف اس صورت میں جب بچہ کہانی نہ پڑھ سکے</span></div>',
};

function readingSides({ grade, block, form, set, termLabel, notYet, prefix }) {
  const b = need(form, block);
  if (!b.story || !b.story.text) throw new Error(`child-test print v2: ${block} story text missing`);
  const fb = b.fallback;
  if (!fb || !Array.isArray(fb.letters) || !Array.isArray(fb.words)) throw new Error(`child-test print v2: ${block} has no fallback letters/words`);
  const T = BASE_PT[grade];
  const cls = block === 'urdu' ? 'ur' : 'en';
  const lang = block === 'urdu' ? 'ur' : 'en';
  const story = `<p class="story ${cls}" lang="${lang}" style="font-size:${pt(T.story[block])}">${esc(String(b.story.text).replace(/\s+/g, ' ').trim())}</p>`;
  const back = grid(fb.letters, cls, T.letters[block]) + '<hr class="rule">' + grid(fb.words, cls, T.words[block]);
  const common = { grade, card: block, set, termLabel, notYet };
  return [
    section({ ...common, side: 'front', body: story, max: 1.5, pageId: prefix && `${prefix}/${block}/front` }),
    section({ ...common, side: 'back', only: ONLY[block], body: back, max: 1.3, pageId: prefix && `${prefix}/${block}/back` }),
  ];
}

function mathsSides({ grade, form, set, termLabel, notYet, prefix }) {
  const { items } = oralMaths({ grade, set, form });
  if (items.compare.length !== 4 || items.sums.length !== 4) throw new Error('child-test print v2: the maths card needs 4 pairs and 4 sums');
  const T = BASE_PT[grade];
  const pairs = items.compare.map((c, i) => {
    const l = 'ABCD'[i];
    return `<div class="box" data-label="${l}" style="font-size:${pt(T.compare)}"><span class="tag">${l}</span><span class="n">${esc(c.a)}</span><span class="n">${esc(c.b)}</span></div>`;
  }).join('');
  const sums = items.sums.map((s, i) => `<div class="box" data-label="${i + 1}" style="font-size:${pt(T.sums)}"><span class="tag">${i + 1}</span><span class="n sum">${esc(mathsDisplay(s.prompt))}</span></div>`).join('');
  const body = `<div class="mgrid pairs">${pairs}</div><hr class="rule"><div class="mgrid">${sums}</div>`;
  const common = { grade, card: 'maths', set, termLabel, notYet };
  return [
    section({ ...common, side: 'front', body, max: 1.4, pageId: prefix && `${prefix}/maths/front` }),
    section({ ...common, side: 'back', body: '', pageId: prefix && `${prefix}/maths/back` }),
  ];
}

function cardSections({ grade, set, form, termLabel, notYet, prefix }) {
  const g = Number(grade);
  if (!BASE_PT[g]) throw new Error(`child-test print v2: no print scale for grade ${grade}`);
  const a = { grade: g, form, set, termLabel, notYet, prefix };
  return [
    ...readingSides({ ...a, block: 'urdu' }),
    ...readingSides({ ...a, block: 'english' }),
    ...mathsSides(a),
  ];
}

function doc(body, { coach = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}${CARD_CSS}${COACH_CARD_CSS}${coach ? COACH_CSS : ''}</style></head>`
    + `<body>${body}<script>${FIT_SCRIPT}</script></body></html>`;
}

/**
 * Six A4 sides for one grade and set: Urdu front/back, English front/back, Maths front/back.
 * @param {{grade:3|5, set:'A'|'B', form:object, termLabel?:string, notYet?:boolean}} a
 */
function buildCardsHtml({ grade, set, form, termLabel, notYet = false }) {
  return doc(cardSections({ grade, set, form, termLabel, notYet }).join(''));
}

/* ---------------------------------------------------------------------- coach card -- */

// The EGRA/EGMA assessor's own sheet, simplified (L33, bd-s1oo0.46.10): one laminated A4 side per
// grade and set, held by the coach, never shown to the child. Paper twin of the phone's step
// messages, and the backup when a phone can't scroll during a locked recording. Every question,
// accepted answer, line and number comes from the form; chrome comes from the catalog.

const COACH_CARD_PT = { body: 13, label: 10.5, acc: 9.5, accUr: 10.5, maths: 13, wp: 16, rule: 13 };

const COACH_CARD_CSS = `
.page.cc{background:#fff}
.band.cc{height:auto;padding:1.5mm 7mm 0;display:block}
.band.cc .row{display:flex;align-items:center;justify-content:space-between;gap:6mm}
.band.cc .lab{font-size:21pt}
.band.cc .set{font-size:15pt}
.dont{margin:1mm -7mm 0;background:#101828;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:6mm;padding:0 7mm;font:700 14pt/1.55 ${LATIN_STACK}}
.dont .ur{font:700 14pt/1.6 ${URDU_STACK};direction:rtl;unicode-bidi:isolate}
.fit.cc{padding:1.5mm 7mm 1mm;justify-content:flex-start;gap:calc(var(--s)*1.2mm)}
.blk{padding:0 0 calc(var(--s)*1.2mm);border-bottom:.8mm solid var(--tint)}
.blk:last-child{border-bottom:0}
.blk.ur{font-family:${URDU_STACK};direction:rtl;text-align:right}
.blk.en{font-family:${LATIN_STACK};direction:ltr;text-align:left}
.blk h3{margin:0;color:var(--band);font-size:calc(var(--s)*14pt);display:inline-flex;gap:2mm;align-items:baseline;white-space:nowrap}
.blk h3 .en{font:700 calc(var(--s)*14pt)/1.4 ${LATIN_STACK}}
.blk h3 .ur{font:700 calc(var(--s)*14pt)/1.8 ${URDU_STACK}}
.says{display:flex;flex-wrap:wrap;gap:0 4mm;align-items:baseline}
.say{display:inline-flex;gap:2mm;align-items:baseline;max-width:100%}
.tag{flex:0 0 auto;font-weight:700;font-size:${COACH_CARD_PT.label}pt;background:var(--tint);color:var(--band);border-radius:1.5mm;padding:0 1.8mm;white-space:nowrap}
.blk.en .tag{font-family:${LATIN_STACK};line-height:1.5}
.blk.ur .tag{font-family:${URDU_STACK};line-height:1.65}
.line{font-size:calc(var(--s)*${COACH_CARD_PT.body}pt)}
.blk.ur .line,.blk.ur .p{line-height:2}
.blk.en .line,.blk.en .p{line-height:1.4}
.q{display:flex;gap:2.5mm;align-items:baseline;margin-top:.3mm}
.q .num{flex:0 0 6.5mm;height:6.5mm;border-radius:50%;background:var(--band);color:#fff;text-align:center;font:700 11pt/6.5mm ${LATIN_STACK}}
.blk.ur .q{gap:4.5mm}
.blk.ur .q .num{font:700 11pt/7.5mm ${URDU_STACK}}
.qb{flex:1 1 auto;min-width:0}
.p{font-weight:700;font-size:calc(var(--s)*${COACH_CARD_PT.body}pt)}
.acc{font-size:calc(var(--s)*${COACH_CARD_PT.acc}pt);color:#475467}
.blk.ur .acc{line-height:1.95;font-size:calc(var(--s)*${COACH_CARD_PT.accUr}pt)}
.blk.en .acc{line-height:1.25;font-family:'CTAndika','CTNastaliq',sans-serif}
.acc .k{font-weight:700;color:#344054}
.acc bdi{unicode-bidi:isolate}
.fb{margin-top:.8mm;padding-top:.8mm;border-top:.4mm dashed #D0D5DD}
.mcols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1mm 6mm;margin-top:.5mm}
.mcol .say{margin-bottom:.5mm}
.mbox{direction:ltr;display:flex;align-items:center;gap:2.5mm;font:calc(var(--s)*${COACH_CARD_PT.maths}pt)/1.05 ${LATIN_STACK};padding:0;white-space:nowrap;border-bottom:.3mm solid #EAECF0}
.mbox .tag{font:700 11pt/1.5 ${LATIN_STACK}}
.mbox .n{flex:1 1 auto}
.mbox .arrow{color:#98A2B3}
.mbox .ans,.mbox b{font-weight:700;color:var(--band)}
.mbox .ans{border:.6mm solid var(--band);border-radius:4mm;padding:0 2.5mm}
.wps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 5mm;border-top:.4mm dashed #D0D5DD}
.wp{display:block;font-size:calc(var(--s)*${COACH_CARD_PT.wp}pt);line-height:1.75;padding:0}
.wp .num{display:inline-block;width:7mm;height:7mm;border-radius:50%;background:var(--band);color:#fff;text-align:center;font:700 12pt/8mm ${URDU_STACK};margin-inline-end:2mm}
.wp .ansb{display:inline-block;margin-inline-start:2mm;line-height:1.5;font-weight:700;background:var(--band);color:#fff;border-radius:2mm;padding:0 3mm;white-space:nowrap}
.ccrule{flex:0 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6mm;align-items:center;padding:1.5mm 7mm;background:#FEF3F2;border-top:1mm solid #B42318;color:#7A271A}
.ccrule .en{font:700 ${COACH_CARD_PT.rule}pt/1.3 ${LATIN_STACK}}
.ccrule .ur{font:700 ${COACH_CARD_PT.rule}pt/1.8 ${URDU_STACK};direction:rtl;text-align:right}
.foot.cc{flex:0 0 3mm}
.stamp.cc{margin:1mm 7mm 0;padding:0 2mm;font-size:13pt;border-width:.6mm}
`;

const ux = (key, language, params) => require('../../../config/ux-strings').resolveUx(key, { language, params });

function ccNeed(form, grade, set) {
  const miss = (what) => { throw new Error(`child-test coach card: grade ${grade} set ${set} has no ${what} in the item bank`); };
  for (const block of ['urdu', 'english']) {
    const b = form && form[block];
    if (!b || !b.script) miss(`${block}.script`);
    for (const k of ['start', 'go_on', 'stop', 'questions_intro', 'fallback']) if (!b.script[k]) miss(`${block}.script.${k}`);
    if (!Array.isArray(b.questions) || !b.questions.length) miss(`${block}.questions`);
    for (const q of b.questions) if (!q.prompt || !Array.isArray(q.accept) || !q.accept.length) miss(`${block} question ${q.id} prompt/accept`);
  }
  const oral = form.maths && form.maths.oral;
  if (!oral) miss('maths.oral');
  if (!Array.isArray(oral.compare) || oral.compare.length !== 4) miss('maths.oral.compare (4 pairs)');
  if (!Array.isArray(oral.sums) || oral.sums.length !== 4) miss('maths.oral.sums (4 sums)');
  if (!Array.isArray(oral.word_problems) || !oral.word_problems.length) miss('maths.oral.word_problems');
  for (const w of oral.word_problems) if (!w.prompt_ur || w.answer === undefined) miss(`word problem ${w.id} prompt_ur/answer`);
  if (!oral.script) miss('maths.oral.script');
  for (const k of ['start', 'compare', 'sum', 'next', 'wp_intro', 'stop']) if (!oral.script[k]) miss(`maths.oral.script.${k}`);
  return oral;
}

const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const URDU_RE = /[\u0600-\u06FF]/;

/**
 * The accepted answers worth printing: a longer answer that contains a shorter accepted one as whole
 * words ("a small plant" ⊃ "plant") adds nothing for the coach's ear, so only the shorter is shown.
 * Order is the bank's. Nothing is added: every printed answer is a bank answer.
 */
// The card shows the coach a few examples, not the bank's whole list (up to 22 for one question): the
// AI scores against every accepted answer; a "…" after the last example says more count (bd-j41md).
const COACH_ACCEPT_MAX = 4;

function coachAccepts(accept, { latinOnly = false } = {}) {
  let n = [...new Set((accept || []).map(one))];
  if (latinOnly && n.some((a) => !URDU_RE.test(a))) n = n.filter((a) => !URDU_RE.test(a));
  return n.filter((a) => !n.some((o) => o !== a && o.length < a.length && ` ${a} `.includes(` ${o} `)));
}

// Typography per script (not wording: that is the catalog's). Urdu prose takes Urdu digits (§9.4).
const SCRIPT = {
  ur: { dir: 'rtl', other: 'en', quote: ['«', '»'], sep: '، ', prose: (t) => urDigits(one(t)), num: (n) => urDigits(n) },
  en: { dir: 'ltr', other: 'ur', quote: ['“', '”'], sep: ' · ', prose: (t) => one(t), num: (n) => String(n) },
};

/** A line the coach says aloud, quoted in its own language; `tag` says when (`atom`: an isolated Latin label). */
function sayLine(lang, tag, line, atom) {
  const q = SCRIPT[lang].quote;
  const words = SCRIPT[lang].prose(line);
  return `<span class="say"><span class="tag">${esc(tag)}${atom ? `&nbsp;&nbsp;<bdi dir="ltr">${esc(atom)}</bdi>` : ''}</span>`
    + (line == null ? '' : `<span class="line">${q[0]}${esc(words)}${q[1]}</span>`)
    + '</span>';
}

function ccStory(block, b) {
  const lang = block === 'urdu' ? 'ur' : 'en';
  const T = SCRIPT[lang];
  const L = (key) => ux(key, lang);
  const s = b.script;
  const num = (i) => T.num(i + 1);
  const sep = T.sep;
  const fix = T.prose;
  const qs = b.questions.map((q, i) => '<div class="q">'
    + `<span class="num">${num(i)}</span><div class="qb"><div class="p">${esc(fix(q.prompt))}</div>`
    + `<div class="acc" data-accept="${esc(q.id)}"><span class="k">${esc(L(lang === 'en' && q.accept.some((a) => URDU_RE.test(a)) ? 'childTestCoachCardAcceptAlsoUrdu' : 'childTestCoachCardAccept'))}:</span> `
    + ((all) => all.slice(0, COACH_ACCEPT_MAX).map((a) => `<bdi>${esc(a)}</bdi>`).join(sep)
      + (all.length > COACH_ACCEPT_MAX ? `${sep}<span class="more" aria-label="more answers count">…</span>` : ''))(coachAccepts(q.accept, { latinOnly: lang === 'en' }))
    + '</div></div></div>').join('');
  const title = block === 'urdu' ? 'childTestCoachCardUrduStory' : 'childTestCoachCardEnglishStory';
  return `<div class="blk ${lang}" data-block="${block}" dir="${T.dir}" lang="${lang}">`
    + '<div class="says">'
    + `<h3><span class="${lang}">${esc(ux(title, lang))}</span><span class="${T.other}" lang="${T.other}">${esc(ux(title, T.other))}</span></h3>`
    + sayLine(lang, L('childTestCoachCardSayStart'), s.start)
    + sayLine(lang, L('childTestCoachCardSayFallback'), s.fallback)
    + sayLine(lang, L('childTestCoachCardSayGoOn'), s.go_on)
    + sayLine(lang, L('childTestCoachCardSayStop'), s.stop)
    + sayLine(lang, L('childTestCoachCardFaceDown'), null)
    + sayLine(lang, L('childTestCoachCardSayQuestions'), s.questions_intro)
    + '</div>'
    + qs
    + '</div>';
}

function ccMaths(oral) {
  const L = (key) => ux(key, 'ur');
  const s = oral.script;
  const pairs = oral.compare.map((c, i) => {
    const l = c.label || 'ABCD'[i];
    const big = c.answer !== undefined ? c.answer : Math.max(c.a, c.b);
    return `<div class="mbox" data-pair="${esc(l)}"><span class="tag">${esc(l)}</span><span class="n">${esc(c.a)} · ${esc(c.b)}</span>`
      + `<span class="arrow">→</span><div class="ans" data-bigger="${esc(l)}">${esc(big)}</div></div>`;
  }).join('');
  const sums = oral.sums.map((x, i) => {
    const l = x.label || String(i + 1);
    return `<div class="mbox" data-sum="${esc(l)}"><span class="tag">${esc(l)}</span><span class="n">${esc(mathsDisplay(x.prompt))} = <b>${esc(x.answer)}</b></span></div>`;
  }).join('');
  const wps = oral.word_problems.map((w, i) => `<div class="wp" data-wp="${esc(w.id)}" dir="rtl" lang="ur">`
    + `<span class="num">${urDigits(i + 1)}</span><span class="txt">«${esc(urDigits(one(w.prompt_ur)))}»</span>`
    + `<span class="ansb">${esc(L('childTestCoachCardAnswer'))}: ${urDigits(w.answer)}</span></div>`).join('');
  return '<div class="blk ur" data-block="maths" dir="rtl" lang="ur">'
    + '<div class="says">'
    + `<h3><span class="ur">${esc(ux('childTestCoachCardMaths', 'ur'))}</span><span class="en" lang="en">${esc(ux('childTestCoachCardMaths', 'en'))}</span></h3>`
    + `${sayLine('ur', L('childTestCoachCardSayStart'), s.start)}${sayLine('ur', L('childTestCoachCardNext'), s.next)}</div>`
    + '<div class="mcols">'
    + `<div class="mcol">${sayLine('ur', L('childTestCoachCardBigger'), s.compare, 'A–D')}${pairs}</div>`
    // «۱ تا ۴», not «۱–۴»: a dash between Urdu digits paints reversed (language-protocol §9.3)
    + `<div class="mcol">${sayLine('ur', `${L('childTestCoachCardSums')} ${urDigits(1)} تا ${urDigits(4)}`, s.sum)}${sums}</div>`
    + '</div>'
    + `<div class="says">${sayLine('ur', L('childTestCoachCardFaceDown'), null)}${sayLine('ur', L('childTestCoachCardWordProblems'), s.wp_intro)}${sayLine('ur', L('childTestCoachCardEnd'), s.stop)}</div>`
    + `<div class="wps">${wps}</div>`
    + '</div>';
}

function coachCardSection({ grade, set, form, termLabel, notYet, prefix }) {
  const g = Number(grade);
  const c = GRADE_COLOUR[g];
  if (!c) throw new Error(`child-test coach card: no colour for grade ${grade}`);
  const s = String(set || '').toUpperCase();
  const oral = ccNeed(form, g, s);
  const id = prefix ? `${prefix}/coachcard` : `g${g}/coachcard`;
  const right = `<span class="set">${esc(setLabel(s, termLabel))}</span>`;
  const head = '<header>'
    + `<div class="band cc"><div class="row"><span class="lab">${esc(ux('childTestCoachCardTitle', 'en', { grade: g }))}</span><span class="right">${right}</span></div>`
    + `<div class="dont"><span>${esc(ux('childTestCoachCardDontShow', 'en'))}</span><span class="ur" lang="ur" dir="rtl">${esc(ux('childTestCoachCardDontShow', 'ur'))}</span></div></div>`
    + (notYet ? `<div class="stamp cc">${NOT_YET}</div>` : '')
    + '</header>';
  const body = ccStory('urdu', form.urdu) + ccStory('english', form.english) + ccMaths(oral);
  const rule = `<div class="ccrule" data-rule="facedown"><span class="en">${esc(ux('childTestCoachCardRule', 'en'))}</span>`
    + `<span class="ur" lang="ur" dir="rtl">${esc(ux('childTestCoachCardRule', 'ur'))}</span></div>`;
  return `<section class="page cc" data-page="${id}" data-audience="coach" data-grade="${g}" data-card="coachcard" data-side="front" style="--band:${c.hex};--tint:${c.tint}">`
    + head
    + `<div class="fit cc" data-max="1.25" data-min="1">${body}</div>`
    + rule
    + '<div class="foot cc"></div></section>';
}

function coachCardBack({ grade, prefix }) {
  const g = Number(grade);
  return `<section class="page blankside" data-page="${prefix || `g${g}`}/coachcard-back" data-audience="coach" data-grade="${g}" data-card="coachcard" data-side="back">`
    + `<div style="text-align:center">${esc(ux('childTestCoachCardBlankBack', 'en', { grade: g }))}<br><span lang="ur" dir="rtl" style="font-family:${URDU_STACK};line-height:2">${esc(ux('childTestCoachCardBlankBack', 'ur', { grade: urDigits(g) }))}</span></div></section>`;
}

/**
 * One A4 side for the coach, one grade and set: the lines to say, the questions with accepted
 * answers, the maths answers and the word problems. Never shown to the child.
 * @param {{grade:3|5, set:'A'|'B', form:object, termLabel?:string, notYet?:boolean}} a
 */
function buildCoachCardHtml({ grade, set, form, termLabel, notYet = false }) {
  return doc(coachCardSection({ grade, set, form, termLabel, notYet }));
}

/* ------------------------------------------------------------------- setup picture -- */

const PIC_TEXT = {
  en: {
    dir: 'ltr',
    nums: ['1', '2', '3'],
    labels: [
      'Sit away from the class, where others can\'t hear',
      'Card flat on the desk, in front of the child',
      'Phone in your hand, screen away from the child',
    ],
    classWord: 'Class',
  },
  ur: {
    dir: 'rtl',
    nums: ['۱', '۲', '۳'],
    labels: [
      'کلاس سے دور بیٹھیں، جہاں دوسرے نہ سن سکیں',
      'کارڈ میز پر سیدھا، بچے کے سامنے',
      'فون آپ کے ہاتھ میں، اسکرین بچے سے دور',
    ],
    classWord: 'کلاس',
  },
};

function person({ id, x, seatY, scale, facing, shirt, extra = '' }) {
  // A seated figure in profile: head, torso, legs on a chair. Plain shapes, no gendered detail.
  const s = scale;
  const f = facing; // +1 faces right, -1 faces left
  const headR = 34 * s;
  const torsoH = 120 * s;
  const torsoW = 64 * s;
  const hipY = seatY;
  const shoulderY = hipY - torsoH;
  const headY = shoulderY - headR - 6 * s;
  const kneeX = x + f * 70 * s;
  const footY = seatY + 110 * s;
  return `<g id="${id}">`
    // chair
    + `<rect x="${x - f * 40 * s - 6 * s}" y="${shoulderY + 10 * s}" width="${12 * s}" height="${torsoH - 10 * s}" rx="${4 * s}" fill="#8A6A4F"/>`
    + `<rect x="${Math.min(x - f * 44 * s, x + f * 44 * s)}" y="${seatY}" width="${88 * s}" height="${12 * s}" rx="${4 * s}" fill="#8A6A4F"/>`
    + `<rect x="${x - f * 36 * s - 4 * s}" y="${seatY + 12 * s}" width="${8 * s}" height="${footY - seatY - 12 * s + 6 * s}" fill="#8A6A4F"/>`
    + `<rect x="${x + f * 36 * s - 4 * s}" y="${seatY + 12 * s}" width="${8 * s}" height="${footY - seatY - 12 * s + 6 * s}" fill="#8A6A4F"/>`
    // legs
    + `<path d="M ${x} ${hipY - 4 * s} L ${kneeX} ${hipY - 4 * s} L ${kneeX} ${footY}" stroke="#3B4A5A" stroke-width="${26 * s}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    // torso
    + `<rect x="${x - torsoW / 2}" y="${shoulderY}" width="${torsoW}" height="${torsoH + 6 * s}" rx="${26 * s}" fill="${shirt}"/>`
    // head (neck + head + simple hair cap)
    + `<rect x="${x - 9 * s}" y="${headY + headR - 4 * s}" width="${18 * s}" height="${16 * s}" fill="#B07A55"/>`
    + `<circle cx="${x}" cy="${headY}" r="${headR}" fill="#C68B62"/>`
    + `<path d="M ${x - headR} ${headY - 2 * s} A ${headR} ${headR} 0 0 1 ${x + headR} ${headY - 2 * s} L ${x + headR * 0.6} ${headY - headR * 0.45} L ${x - headR * 0.6} ${headY - headR * 0.45} Z" fill="#2B2B2B"/>`
    + `<circle cx="${x + f * headR * 0.55}" cy="${headY + 2 * s}" r="${3.6 * s}" fill="#2B2B2B"/>`
    + extra
    + '</g>';
}

function labelBox({ x, y, w, n, text, dir, lead }) {
  // HTML inside the SVG so the label wraps and shapes like any paragraph (Nastaliq included).
  const ur = dir === 'rtl';
  const font = ur ? `font:25px/1.75 ${URDU_STACK}` : `font:700 27px/1.25 ${LATIN_STACK}`;
  return '<g class="label">'
    + (lead ? `<path d="${lead}" stroke="#101828" stroke-width="3.5" fill="none" stroke-dasharray="2 8" stroke-linecap="round"/>` : '')
    + `<foreignObject x="${x}" y="${y}" width="${w}" height="220">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" dir="${dir}" style="display:flex;align-items:center;gap:14px;box-sizing:border-box;background:#fff;border:3px solid #101828;border-radius:16px;padding:12px 16px;color:#101828;${font}">`
    + `<span style="flex:0 0 46px;height:46px;border-radius:50%;background:#101828;color:#fff;display:flex;align-items:center;justify-content:center;font:700 26px/1 ${LATIN_STACK}">${n}</span>`
    + `<span>${esc(text)}</span></div></foreignObject>`
    + '</g>';
}

/**
 * The "before the first child" picture: coach and child at a desk away from the class, the card flat
 * in front of the child, the phone in the coach's hand with its screen away from the child.
 * A diagram, not a photo; gender-neutral figures. viewBox 1080 × 860 (aspect 0.80).
 */
function setupPictureSvg(lang = 'en') {
  const T = PIC_TEXT[lang];
  if (!T) throw new Error(`child-test print v2: setup picture has no "${lang}" text`);
  const { viewW: W, viewH: H } = SETUP_PICTURE;
  const floorY = 700;
  // the class, far away and small: three rows of desks with heads
  let cls = '';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 56 + c * 80 + r * 12;
      const y = 92 + r * 58;
      cls += `<rect x="${x}" y="${y + 18}" width="58" height="14" rx="3" fill="#C9B79C"/>`
        + `<circle cx="${x + 29}" cy="${y + 4}" r="14" fill="#D5A98A"/><path d="M ${x + 15} ${y + 2} A 14 14 0 0 1 ${x + 43} ${y + 2} Z" fill="#4A4A4A"/>`;
    }
  }
  const rtl = T.dir === 'rtl';
  const classGroup = `<g id="class"><rect x="30" y="40" width="300" height="240" rx="18" fill="#EEF0F3" stroke="#B9C0CA" stroke-width="2.5"/>${cls}`
    + `<text x="${rtl ? 306 : 54}" y="${rtl ? 262 : 264}" ${rtl ? 'direction="rtl"' : ''} fill="#667085" style="font-family:${(rtl ? URDU_STACK : LATIN_STACK).replace(/'/g, '')};font-size:26px">${esc(T.classWord)}</text></g>`;
  // distance arrow from the class to the desk
  const dist = '<g id="distance"><path d="M 330 270 C 410 330, 450 360, 505 400" stroke="#667085" stroke-width="4" fill="none" stroke-dasharray="12 10"/>'
    + '<path d="M 512 405 l -24 -1 l 13 -18 z" fill="#667085"/></g>';
  // the desk, drawn with a visible top so the card lies flat on it
  const desk = '<g id="desk">'
    + '<polygon points="450,500 750,500 790,548 410,548" fill="#D9B98F" stroke="#8A6A4F" stroke-width="3"/>'
    + '<rect x="410" y="548" width="380" height="24" fill="#B8916A" stroke="#8A6A4F" stroke-width="3"/>'
    + `<rect x="424" y="572" width="16" height="${floorY - 572}" fill="#8A6A4F"/><rect x="760" y="572" width="16" height="${floorY - 572}" fill="#8A6A4F"/>`
    + '</g>';
  // the card: a white sheet with the grade band, lying on the desk top in front of the child
  const card = '<g id="card">'
    + '<polygon points="470,506 604,506 618,540 456,540" fill="#FFFFFF" stroke="#344054" stroke-width="2.5"/>'
    + '<polygon points="470,506 604,506 607,513 467,513" fill="#1B7F45"/>'
    + '<path d="M 470 522 L 604 522 M 466 531 L 610 531" stroke="#98A2B3" stroke-width="3"/>'
    + '</g>';
  // child (smaller) on the left, facing right; hand resting on the desk beside the card
  const childArm = '<path d="M 322 492 L 372 530 L 438 522" stroke="#2F8F6A" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    + '<circle cx="442" cy="522" r="10" fill="#C68B62"/>';
  const child = person({ id: 'child', x: 318, seatY: 588, scale: 0.85, facing: 1, shirt: '#3BA37A', extra: childArm });
  // coach (larger) on the right, facing left; the phone held at chest height, its back to the child
  // and its screen (light edge) towards the coach
  const phone = '<g id="phone" transform="rotate(-14 787 446)">'
    + '<rect x="769" y="408" width="38" height="72" rx="7" fill="#1D2939"/>'
    + '<circle cx="779" cy="419" r="4" fill="#667085"/>'
    + '<rect x="803" y="412" width="6" height="64" rx="2" fill="#7CC4FA"/>'
    + '</g>';
  const coachArm = '<path d="M 871 470 L 835 520 L 801 462" stroke="#4E6A9C" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
    + '<circle cx="801" cy="458" r="13" fill="#C68B62"/>';
  const look = '<path d="M 843 402 L 813 432" stroke="#7CC4FA" stroke-width="3" stroke-dasharray="5 6"/>';
  const coach = person({ id: 'coach', x: 880, seatY: 588, scale: 1.08, facing: -1, shirt: '#5B7DB8', extra: coachArm + phone + look });
  const floor = `<rect x="0" y="${floorY}" width="${W}" height="${H - floorY}" fill="#F2EEE8"/><path d="M 0 ${floorY} L ${W} ${floorY}" stroke="#D0C7BA" stroke-width="3"/>`;
  const [l1, l2, l3] = T.labels;
  const labels = labelBox({ x: 362, y: 28, w: 340, n: T.nums[0], text: l1, dir: T.dir, lead: 'M 470 150 L 425 330' })
    + labelBox({ x: 722, y: 28, w: 336, n: T.nums[2], text: l3, dir: T.dir, lead: 'M 860 150 L 790 400' })
    + labelBox({ x: 140, y: 738, w: 560, n: T.nums[1], text: l2, dir: T.dir, lead: 'M 420 738 L 530 545' });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" lang="${lang}">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#FBFAF7"/>${floor}${classGroup}${dist}${desk}${child}${card}${coach}${labels}</svg>`;
}

/** The picture alone, for the bot to send: 540 CSS px rendered at 2x = 1080 px wide. */
function buildSetupPictureHtml(lang = 'en') {
  const { cssWidth } = SETUP_PICTURE;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}`
    + `html,body{margin:0;padding:0;background:#fff}body{width:${cssWidth}px}.pic{width:${cssWidth}px;line-height:0}.pic svg{display:block;width:100%;height:auto}</style></head>`
    + `<body><div class="pic">${setupPictureSvg(lang)}</div></body></html>`;
}

/* ------------------------------------------------------------------------ coach page -- */

const COACH = {
  en: {
    dir: 'ltr',
    title: 'Child test · coach page',
    sub: 'Keep this page with your cards.',
    bringH: 'What to bring',
    bring: [
      'The 3 cards for today\'s grade: <b>green = Grade 3</b>, <b>blue = Grade 5</b> (Urdu, English, Maths).',
      'Paper and a pencil for the child (for maths).',
      'Your phone, charged, with this chat open.',
      'A desk and two chairs away from the class, where other children can\'t hear.',
    ],
    rulesH: 'Five rules',
    rules: [
      '<b>One child at a time.</b> The next child waits in class.',
      'Turn the card <b>face down</b> before you ask the questions.',
      'Never help, and never say “right” or “wrong”. Just say “thank you”.',
      'Child stuck for <b>3 seconds</b>? Silently point to the next word and say “Go on”. Don\'t read the word.',
      '<b>Never stop the recording</b> in the middle of a part. Send it when the message says “Send”.',
    ],
    keyBig: 'The phone tells you every step; you never count.',
    keySmall: 'The recording does the marking. Each child, about 6 minutes: Urdu story → English story → Maths, one voice note each.',
  },
  ur: {
    dir: 'rtl',
    title: 'بچوں کا ٹیسٹ · کوچ کا صفحہ',
    sub: 'یہ صفحہ اپنے کارڈز کے ساتھ رکھیں۔',
    bringH: 'کیا ساتھ لائیں',
    bring: [
      `آج کی جماعت کے ${urDigits(3)} کارڈ: <b>سبز = جماعت ${urDigits(3)}</b>، <b>نیلا = جماعت ${urDigits(5)}</b> (اردو، انگریزی، ریاضی)۔`,
      'بچے کے لیے کاغذ اور پنسل (ریاضی کے لیے)۔',
      'آپ کا فون، چارج کیا ہوا، یہ چیٹ کھلی ہوئی۔',
      'کلاس سے دور ایک میز اور دو کرسیاں، جہاں دوسرے بچے نہ سن سکیں۔',
    ],
    rulesH: 'پانچ اصول',
    rules: [
      '<b>ایک وقت میں ایک بچہ۔</b> اگلا بچہ کلاس میں انتظار کرے۔',
      'سوال پوچھنے سے پہلے کارڈ <b>الٹا</b> کر دیں۔',
      'کبھی مدد نہ کریں، اور کبھی «صحیح» یا «غلط» نہ کہیں۔ بس «شکریہ» کہیں۔',
      `بچہ <b>${urDigits(3)} سیکنڈ</b> رک جائے؟ خاموشی سے اگلے لفظ کی طرف اشارہ کریں اور کہیں «آگے پڑھیں»۔ لفظ خود نہ پڑھیں۔`,
      'کسی حصے کے بیچ میں <b>ریکارڈنگ کبھی نہ روکیں</b>۔ جب پیغام کہے «بھیجیں» تب بھیجیں۔',
    ],
    keyBig: 'فون آپ کو ہر قدم بتائے گا؛ آپ کو کوئی گنتی نہیں کرنی۔',
    keySmall: `نمبر ریکارڈنگ سے لگتے ہیں۔ ہر بچہ، تقریباً ${urDigits(6)} منٹ: اردو کہانی ← انگریزی کہانی ← ریاضی، ہر حصے کا ایک وائس نوٹ۔`,
  },
};

const COACH_CSS = `
.coach{padding:12mm 15mm 10mm;display:block}
.coach.ur{direction:rtl;font-family:${URDU_STACK}}
.coach.en{direction:ltr;font-family:${LATIN_STACK}}
.coach h1{margin:0;font-size:22pt;line-height:1.3;color:#101828}
.coach.ur h1{font-size:20pt;line-height:2}
.coach .sub{margin:0 0 3mm;color:#475467;font-size:11.5pt}
.coach.ur .sub{font-size:12pt;line-height:2}
.coach .pic{width:140mm;margin:0 auto 2mm;border:.5mm solid #D0D5DD;border-radius:3mm;overflow:hidden;line-height:0}
.coach .pic svg{display:block;width:100%;height:auto}
.coach h2{margin:2mm 0 1mm;font-size:14pt;line-height:1.3;color:#101828}
.coach.ur h2{font-size:14pt;line-height:1.9}
.coach ul,.coach ol{margin:0;padding-inline-start:7mm}
.coach li{font-size:11.5pt;line-height:1.4;margin:0 0 1.2mm}
.coach.ur li{font-size:12pt;line-height:1.9;margin:0 0 .4mm}
.coach ol.rules{list-style:none;padding:0}
.coach .rules li{font-size:12.5pt;display:flex;gap:2.5mm;align-items:baseline}
.coach .rules .num{flex:0 0 6mm;height:6mm;border-radius:50%;background:#101828;color:#fff;font:700 10pt/6mm ${LATIN_STACK};text-align:center;position:relative;top:-.5mm}
.coach.ur .rules .num{font:700 11pt/6mm ${URDU_STACK};line-height:7mm}
.coach.ur .rules li{font-size:12.5pt}
.coach .key{margin:3mm 0 0;padding:3mm 4mm;border-radius:2.5mm;background:#101828;color:#fff}
.coach .key .big{font-size:16pt;font-weight:700;line-height:1.3;margin:0}
.coach.ur .key .big{font-size:15pt;line-height:1.9}
.coach .key .small{font-size:11pt;line-height:1.4;margin:1mm 0 0;color:#D0D5DD}
.coach.ur .key .small{font-size:11.5pt;line-height:1.9}
.coach .ltr{direction:ltr;unicode-bidi:isolate}
`;

function coachSection(lang, pageId) {
  const C = COACH[lang];
  const side = lang === 'en' ? 'front' : 'back';
  return `<section class="page coach ${lang}" data-page="${pageId || `coach/${lang}`}" data-audience="coach" data-lang="${lang}" data-side="${side}" lang="${lang}" dir="${C.dir}">`
    + `<h1>${C.title}</h1><p class="sub">${C.sub}</p>`
    + `<div class="pic">${setupPictureSvg(lang)}</div>`
    + `<h2>${C.bringH}</h2><ul>${C.bring.map((b) => `<li>${b}</li>`).join('')}</ul>`
    + `<h2>${C.rulesH}</h2><ol class="rules list-none">${C.rules.map((r, i) => `<li class="rule-item"><span class="num">${lang === 'ur' ? urDigits(i + 1) : i + 1}</span><span>${r}</span></li>`).join('')}</ol>`
    + `<div class="key"><p class="big">${C.keyBig}</p><p class="small">${C.keySmall}</p></div>`
    + '</section>';
}

/** One A4 sheet: English front, Urdu back. */
function buildCoachPageHtml() {
  return doc(coachSection('en') + coachSection('ur'), { coach: true });
}

/* ------------------------------------------------------------------------- PRINT_ME -- */

const COVER_CSS = `
.cover{padding:16mm 18mm;font-family:${LATIN_STACK};display:block}
.cover h1{font-size:22pt;margin:0 0 2mm}
.cover .lead{font-size:13pt;margin:0 0 5mm;color:#344054}
.cover .warn{border:1.2mm solid #B42318;color:#B42318;font-size:22pt;font-weight:700;text-align:center;padding:4mm;border-radius:3mm;margin:0 0 5mm}
.cover table{border-collapse:collapse;width:100%;font-size:12pt}
.cover td,.cover th{border:.4mm solid #D0D5DD;padding:1.6mm 3mm;text-align:left;vertical-align:middle}
.cover th{background:#F2F4F7}
.cover .sw{display:inline-block;width:6mm;height:6mm;border-radius:1mm;vertical-align:middle;margin-right:2mm}
.cover ul{font-size:12pt;line-height:1.5;padding-left:6mm}
.blankside{display:flex;align-items:center;justify-content:center;font:11pt ${LATIN_STACK};color:#98A2B3}
`;

function coverSection({ set, termLabel, notYet, grades }) {
  const label = setLabel(set, termLabel);
  let p = 5;
  const rows = [`<tr><td>3–4</td><td>Coach page (English front, Urdu back)</td><td>Yes</td><td>1</td></tr>`];
  for (const g of grades) {
    const c = GRADE_COLOUR[g];
    rows.push(`<tr><td>${p}–${p + 1}</td><td><span class="sw" style="background:${c.hex}"></span>Grade ${g} · Coach card (${c.name}), back is blank. Coach only.</td><td>Yes</td><td>1</td></tr>`);
    p += 2;
  }
  for (const g of grades) {
    const c = GRADE_COLOUR[g];
    for (const card of ['urdu', 'english', 'maths']) {
      rows.push(`<tr><td>${p}–${p + 1}</td><td><span class="sw" style="background:${c.hex}"></span>Grade ${g} · ${SUBJECT[card]} card (${c.name})${card === 'maths' ? ', back is blank' : ''}</td><td>Yes</td><td>1</td></tr>`);
      p += 2;
    }
  }
  return `<section class="page cover" data-page="cover" data-audience="printer">`
    + (notYet ? `<div class="warn">${NOT_YET}</div>` : '')
    + `<h1>Child test print pack · ${esc(label)}</h1>`
    + `<p class="lead">Everything one coach needs for this term. <b>Print one copy per coach.</b>${notYet ? ` Set ${esc(set)} is for next term (${esc(TERMS[String(set).toUpperCase()] || termLabel || '')}): print it only when the bot starts asking for Set ${esc(set)} cards.` : ''}</p>`
    + '<ul>'
    + '<li><b>Printer:</b> A4, colour, <b>double-sided, flip on the long edge</b>. Pages 1–2 are this cover: don\'t laminate them.</li>'
    + '<li><b>Then laminate</b> every sheet after the cover, one sheet = one card (front and back).</li>'
    + `<li><b>Kit per coach:</b> ${grades.length * 3} laminated cards (${grades.map((g) => `Grade ${g} ${GRADE_COLOUR[g].name}`).join(', ')}) + 1 laminated coach page + ${grades.length} laminated coach cards (one per grade, for the coach's hand, never shown to the child). No strips, no pads.</li>`
    + '<li><b>Check before laminating:</b> each card\'s band is its grade\'s colour, and the band says the same set as this cover.</li>'
    + '</ul>'
    + `<table><tr><th style="width:14mm">Pages</th><th>What</th><th style="width:22mm">Laminate</th><th style="width:22mm">Per coach</th></tr>${rows.join('')}</table>`
    + '</section>';
}

/**
 * Everything for one coach for a term, in print order: cover (+ blank back), coach page, the coach
 * card per grade (Grade 3 then 5, each with a blank back), then each grade's Urdu, English and Maths
 * cards, front then back.
 * @param {{itemBank?:object, set:'A'|'B', grades?:number[], termLabel?:string, notYet?:boolean}} a
 *   notYet defaults to true for Set B (next term).
 */
function buildPrintMeHtml({ itemBank, set = 'A', grades = [3, 5], termLabel, notYet } = {}) {
  const s = String(set).toUpperCase();
  const stamp = notYet === undefined ? s !== 'A' : !!notYet;
  const parts = [
    coverSection({ set: s, termLabel, notYet: stamp, grades }),
    '<section class="page blankside" data-page="cover-back" data-audience="printer">This side is blank on purpose, so each card prints front-to-back.</section>',
    coachSection('en'),
    coachSection('ur'),
  ];
  for (const g of grades) {
    parts.push(coachCardSection({ grade: g, set: s, form: formFrom(itemBank, g, s), termLabel, notYet: stamp, prefix: `g${g}` }), coachCardBack({ grade: g, prefix: `g${g}` }));
  }
  for (const g of grades) {
    const form = formFrom(itemBank, g, s);
    parts.push(...cardSections({ grade: g, set: s, form, termLabel, notYet: stamp, prefix: `g${g}` }));
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}${CARD_CSS}${COACH_CARD_CSS}${COACH_CSS}${COVER_CSS}</style></head>`
    + `<body>${parts.join('')}<script>${FIT_SCRIPT}</script></body></html>`;
}

function formFrom(itemBank, grade, set) {
  const { resolveForm } = require('./source');
  return resolveForm({ grade, form: set, itemBank }).data;
}

/* ------------------------------------------------------------------------ rendering -- */

const PDF_OPTS = { preferCSSPageSize: true, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } };

async function pdfOf(page) {
  const { htmlToPdf } = require('../../../utils/html-to-pdf');
  let layout = null;
  const pdf = await htmlToPdf(page, { beforeCapture: true, onBeforeCapture: (r) => { layout = r; }, pdfOptions: PDF_OPTS });
  if (layout && layout.overflow && layout.overflow.length) {
    require('../../../utils/logger').logToFile('child_test.print_v2_overflow', { pages: layout.overflow });
  }
  return { pdf, layout };
}

/** @returns {Promise<{pdf: Buffer, layout: object|null}>} six sides for one grade and set */
async function renderCards({ grade, set, itemBank, termLabel, notYet } = {}) {
  const form = formFrom(itemBank, grade, String(set).toUpperCase());
  return pdfOf(buildCardsHtml({ grade: Number(grade), set, form, termLabel, notYet }));
}

/** @returns {Promise<{pdf: Buffer, layout: object|null}>} the coach card: one A4 side, one grade and set */
async function renderCoachCard({ grade, set, itemBank, termLabel, notYet } = {}) {
  const form = formFrom(itemBank, grade, String(set).toUpperCase());
  return pdfOf(buildCoachCardHtml({ grade: Number(grade), set, form, termLabel, notYet }));
}

async function renderCoachPage() { return pdfOf(buildCoachPageHtml()); }

async function renderPrintMe(opts = {}) { return pdfOf(buildPrintMeHtml(opts)); }

/** @returns {Promise<Buffer>} the setup picture PNG, 1080 px wide */
async function renderSetupPicture(lang = 'en') {
  const { htmlToElementImages } = require('../../../utils/html-to-pdf');
  const shots = await htmlToElementImages(buildSetupPictureHtml(lang), { width: SETUP_PICTURE.cssWidth, deviceScaleFactor: SETUP_PICTURE.scale, selector: '.pic' });
  return shots[0].png;
}

module.exports = {
  GRADE_COLOUR,
  TERMS,
  NOT_YET,
  SETUP_PICTURE,
  setLabel,
  urDigits,
  mathsDisplay,
  oralMaths,
  buildCardsHtml,
  buildCoachPageHtml,
  buildCoachCardHtml,
  COACH_CARD_PT,
  COACH_ACCEPT_MAX,
  buildPrintMeHtml,
  setupPictureSvg,
  buildSetupPictureHtml,
  renderCards,
  renderCoachPage,
  renderCoachCard,
  renderPrintMe,
  renderSetupPicture,
};
