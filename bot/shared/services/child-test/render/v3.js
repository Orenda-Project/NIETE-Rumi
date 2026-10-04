'use strict';
/**
 * Child test v3 — the print pack (bd-s1oo0.50.4, lane L38; CONTRACT §21.7, design COACH_JOURNEY_V3).
 *
 * What the operator prints for each coach, once a term, from the v3 item bank (§21.3):
 *   - CHILD STIMULUS BOOKLETS, laminated, one task per A4 side (EGRA Toolkit pp. 52, 97):
 *       Urdu reading    letters (10 × 10, right to left), made-up words, familiar words (5 a row), the story
 *       English reading the same
 *         both shared by Grades 3 and 5 (one reading form, as RWP), in a NEUTRAL band, not green or blue;
 *       Maths Grade 3 (green) and Maths Grade 5 (blue): number ID (4 rows of 5), which is bigger,
 *         missing number, quick + and −, harder + and −.
 *     Every grid page carries its practice row first, boxed and marked "Practice". No listening or
 *     word-problem sheet: the coach reads those. A child side carries no item number, no answer and
 *     no question (EGRA child-sheet rule). A `gap: true` task gets no page; the cover says so.
 *   - COACH PROTOCOL CARDS (the coach's hand, never the child's), one sheet each: Urdu reading,
 *     English reading, Maths G3, Maths G5. The lines to say (verbatim from the bank), the stop rule,
 *     the listening story with its questions and answers, the reading questions with the §20
 *     "only if the child read past «…»" anchors, every maths answer and the word problems in Urdu.
 *     Blocks flow from the front side to the back in the browser, so the card stays one sheet when
 *     the bank changes.
 *   - a cover, then PRINT_ME_v3: cover, coach cards, booklets; each part starts on a fresh sheet.
 *
 * Pure builders (bank in, HTML out) plus thin render wrappers. Words on the page come from the bank;
 * coach-facing chrome from the string catalog (EN + UR); the cover is for the printer (English).
 */

const { fontFaceCss, LATIN_STACK, URDU_STACK } = require('./fonts');
const { esc } = require('./html');
const { anchorFor } = require('../scoring/reach');
const { GRADE_COLOUR, urDigits, coachAccepts, COACH_ACCEPT_MAX } = require('./v2');

const INK = '#111111';
// Reading is one form for Grades 3 and 5, so its band must not say either grade's colour.
const NEUTRAL = { name: 'grey', hex: '#57534E', tint: '#F0EEEC' };
const ux = (key, language, params) => require('../../../config/ux-strings').resolveUx(key, { language, params });

const READING_PRINTED = ['letters', 'nonwords', 'words', 'story'];
const MATHS_PRINTED = ['number_id', 'discrimination', 'missing', 'add1', 'sub1', 'add2', 'sub2'];
const READING_ALL = ['listening', ...READING_PRINTED];
const MATHS_ALL = [...MATHS_PRINTED, 'word_problems'];

const BOOKLETS = {
  ur: { id: 'ur', kind: 'reading', lang: 'ur', title: 'childTestPrintV3BookletUrdu', colour: NEUTRAL },
  en: { id: 'en', kind: 'reading', lang: 'en', title: 'childTestPrintV3BookletEnglish', colour: NEUTRAL },
  ma3: { id: 'ma3', kind: 'maths', grade: 3, title: 'childTestPrintV3BookletMaths', colour: GRADE_COLOUR[3] },
  ma5: { id: 'ma5', kind: 'maths', grade: 5, title: 'childTestPrintV3BookletMaths', colour: GRADE_COLOUR[5] },
};
const BOOKLET_ORDER = ['ur', 'en', 'ma3', 'ma5'];

const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const pt = (n) => `calc(var(--s)*${n}pt)`;
const opSign = (op) => (op === '-' || op === '−' ? '−' : op === 'x' || op === '×' ? '×' : op === '/' || op === '÷' ? '÷' : '+');
const sumText = (x) => `${x.a} ${opSign(x.op)} ${x.b}`;

/* ------------------------------------------------------------------------ the bank -- */

function setOf(bank, set) {
  const S = String(set || 'A').toUpperCase();
  const s = bank && bank.sets && bank.sets[S];
  if (!s) throw new Error(`child-test print v3: the bank has no set ${S}`);
  return { S, s };
}

function setLabel(bank, set) {
  const { S, s } = setOf(bank, set);
  const term = s.term && s.term.en;
  if (!term) throw new Error(`child-test print v3: set ${S} has no term`);
  return `Set ${S} · ${term}`;
}

/** The task spec for a booklet slot, or throws: a missing slot is a broken bank, a gap is `{gap:true}`. */
function specOf(bank, set, bk, kind) {
  const { S, s } = setOf(bank, set);
  const form = bk.kind === 'reading' ? s.reading && s.reading[bk.lang] : s.maths && s.maths[String(bk.grade)];
  const t = form && form[kind];
  if (!t || typeof t !== 'object') throw new Error(`child-test print v3: set ${S} ${bk.id} has no ${kind}`);
  if (t.gap) return { task: t.task || taskId(bk, kind), gap: true, reason: t.reason || '' };
  if (!t.task) throw new Error(`child-test print v3: set ${S} ${bk.id}.${kind} has no task id`);
  return t;
}
const taskId = (bk, kind) => `${bk.kind === 'reading' ? bk.lang : 'ma'}.${kind}`;

/** The booklet's printed sides: the non-gap tasks in battery order, page 1.., and its gaps. */
function bookletPlan(bank, set, id) {
  const bk = BOOKLETS[id];
  if (!bk) throw new Error(`child-test print v3: no booklet "${id}"`);
  const kinds = bk.kind === 'reading' ? READING_PRINTED : MATHS_PRINTED;
  const pages = [];
  const gaps = [];
  for (const kind of kinds) {
    const t = specOf(bank, set, bk, kind);
    if (t.gap) gaps.push({ task: t.task, booklet: id, reason: t.reason });
    else pages.push({ kind, task: t.task, spec: t, page: pages.length + 1 });
  }
  return { bk, pages, gaps };
}

/**
 * Where the child's sheet for a task is, for the step message ("Urdu booklet, page 2").
 * @returns {{booklet:'ur'|'en'|'ma3'|'ma5', page:number}|null} null for a gap or a task with no sheet
 */
function pageFor({ bank, set = 'A', grade, task }) {
  const [prefix, kind] = String(task).split('.');
  const id = prefix === 'ma' ? `ma${Number(grade)}` : prefix;
  if (!BOOKLETS[id]) return null;
  const hit = bookletPlan(bank, set, id).pages.find((p) => p.kind === kind);
  return hit ? { booklet: id, page: hit.page } : null;
}

/** Every gap in the set, across the booklets and the sheet-less tasks. */
function gapsOf(bank, set) {
  const out = [];
  for (const id of BOOKLET_ORDER) {
    const bk = BOOKLETS[id];
    const kinds = bk.kind === 'reading' ? READING_ALL : MATHS_ALL;
    for (const kind of kinds) {
      const t = specOf(bank, set, bk, kind);
      if (t.gap && !out.some((g) => g.task === t.task && g.where === (bk.kind === 'maths' ? `Grade ${bk.grade}` : 'Grades 3 and 5'))) {
        out.push({ task: t.task, where: bk.kind === 'maths' ? `Grade ${bk.grade}` : 'Grades 3 and 5', reason: t.reason });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ child booklets -- */

const CSS = `
@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#fff;color:${INK}}
.page{width:210mm;height:297mm;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column;page-break-after:always;break-after:page;--s:1}
.page:last-child{page-break-after:auto;break-after:auto}
header{flex:0 0 auto;direction:ltr}
.band{background:var(--band);color:#fff;height:27mm;box-sizing:border-box;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;gap:5mm}
.band .left{display:flex;flex-direction:column;gap:1.5mm;min-width:0}
.band .lab{font:700 27pt/1 ${LATIN_STACK};white-space:nowrap}
.band .sub{font:700 14pt/1.1 ${LATIN_STACK};white-space:nowrap;opacity:.95}
.band .right{display:flex;flex-direction:column;align-items:flex-end;gap:.6mm;text-align:right}
.band .set{font:700 13pt/1.1 ${LATIN_STACK};white-space:nowrap;background:rgba(255,255,255,.2);padding:1mm 2.5mm;border-radius:2mm}
.band .urlab{font:13pt/1.9 ${URDU_STACK};direction:rtl;unicode-bidi:isolate;white-space:nowrap}
.band .pg{font:12pt/1.2 ${LATIN_STACK};white-space:nowrap}
.foot{flex:0 0 8mm;background:var(--band)}
.fit{flex:1 1 auto;overflow:hidden;padding:8mm 14mm 7mm;display:flex;flex-direction:column;justify-content:center;gap:calc(var(--s)*6mm)}
.practice{border:.6mm dashed #98A2B3;border-radius:3mm;padding:1.5mm 4mm calc(var(--s)*2.5mm);background:#FAFAF9}
.plabel{display:flex;gap:3mm;align-items:baseline;color:#475467;font:700 12pt/1.3 ${LATIN_STACK}}
.plabel .ur{font:700 12pt/1.9 ${URDU_STACK}}
.sep{border:0;border-top:.8mm solid #D0D5DD;margin:0}
.grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));column-gap:3mm;row-gap:calc(var(--s)*2.2mm);text-align:center;align-items:center}
.grid .it{white-space:nowrap;unicode-bidi:isolate;min-width:0;padding:.3mm 0}
.grid.ur{font-family:${URDU_STACK};direction:rtl;line-height:2}
.grid.en{font-family:${LATIN_STACK};direction:ltr;line-height:1.35}
.grid.num{font-family:${LATIN_STACK};direction:ltr;line-height:1.3}
.grid.sums{grid-auto-flow:column;grid-template-rows:repeat(var(--rows),auto);column-gap:14mm}
.grid.sums .it{text-align:left;padding-left:6mm}
.story{margin:0}
.story.ur{font-family:${URDU_STACK};direction:rtl;text-align:right;line-height:2.2;word-spacing:.15em}
.story.en{font-family:${LATIN_STACK};direction:ltr;text-align:left;line-height:1.7;word-spacing:.08em}
.story .sl{margin:0 0 calc(var(--s)*1.2mm)}
.mains,.pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--s)*5mm) 8mm;direction:ltr}
.pgrid{gap:calc(var(--s)*3mm) 8mm}
.pair{display:flex;justify-content:space-around;gap:7mm;align-items:center;border:.7mm solid #98A2B3;border-radius:4mm;padding:calc(var(--s)*3mm) 3mm;font-family:${LATIN_STACK};line-height:1;white-space:nowrap;min-width:0}
.pair .n{flex:0 0 auto}
.seq{display:flex;gap:2.5mm;justify-content:center;font-family:${LATIN_STACK};direction:ltr;min-width:0}
.cell{flex:0 0 auto;min-width:1.7em;min-height:1.1em;padding:calc(var(--s)*1.5mm) 1.2mm;border:.6mm solid #98A2B3;border-radius:2mm;text-align:center;line-height:1.1;white-space:nowrap}
.cell.blank{border:.9mm solid ${INK}}
.blankside{display:flex;align-items:center;justify-content:center;font:11pt ${LATIN_STACK};color:#98A2B3;text-align:center}
.blankside .ur{font:11pt/2 ${URDU_STACK}}
`;

// Type sizes at scale 1 (the fit pass grows them to data-max, never shrinks below 1).
const CHILD_PT = {
  letters: { ur: 22, en: 25 }, nonwords: { ur: 21, en: 23 }, words: { ur: 21, en: 23 }, story: { ur: 19, en: 19 },
  number_id: 34, discrimination: 28, missing: 22, sums1: 25, sums2: 34,
};
const CHILD_MAX = { letters: 1.3, nonwords: 1.35, words: 1.35, story: 1.45, number_id: 1.5, discrimination: 1.4, missing: 1.4, sums1: 1.3, sums2: 1.4 };

function practiceBox(inner) {
  return `<div class="practice"><div class="plabel"><span>${esc(ux('childTestPrintV3Practice', 'en'))}</span>`
    + `<span class="ur" lang="ur" dir="rtl">${esc(ux('childTestPrintV3Practice', 'ur'))}</span></div>${inner}</div>`;
}

function grid(list, { cls, size, cols, main, rows }) {
  const lang = cls === 'ur' ? ' lang="ur" dir="rtl"' : ' dir="ltr"';
  const style = `--cols:${cols};${rows ? `--rows:${rows};` : ''}font-size:${pt(size)}`;
  return `<div class="grid ${main ? 'main' : 'prac'} ${cls}"${lang} style="${style}">${list.map((t) => `<div class="it">${esc(t)}</div>`).join('')}</div>`;
}

function readingBody(t, kind, lang) {
  const size = CHILD_PT[kind][lang];
  if (kind === 'story') {
    const s = t.story || {};
    if (!s.text) throw new Error(`child-test print v3: ${t.task} has no story text`);
    const printed = one(s.text).split(' ');
    const tokens = s.tokens || [];
    const words = printed.length === tokens.length ? printed : tokens;
    const lines = Array.isArray(s.lines) && s.lines.length && words.length
      ? s.lines.map((l) => words.slice(Number(l.from), Number(l.to) + 1).join(' '))
      : [one(s.text)];
    const body = `<div class="story ${lang}" lang="${lang}" dir="${lang === 'ur' ? 'rtl' : 'ltr'}" style="font-size:${pt(size)}">`
      + lines.map((l) => `<div class="sl">${esc(l)}</div>`).join('') + '</div>';
    return (t.practice && t.practice.length ? practiceBox(grid(t.practice, { cls: lang, size, cols: Math.min(5, t.practice.length) })) + '<hr class="sep">' : '') + body;
  }
  const cols = Number(t.per_row) || (kind === 'letters' ? 10 : 5);
  if (!Array.isArray(t.items) || !t.items.length) throw new Error(`child-test print v3: ${t.task} has no items`);
  const prac = (t.practice || []).map(String);
  return (prac.length ? practiceBox(grid(prac, { cls: lang, size, cols })) + '<hr class="sep">' : '')
    + grid(t.items.map(String), { cls: lang, size, cols, main: true });
}

const pairHtml = (x) => `<div class="pair"><span class="n">${esc(x.a)}</span><span class="n">${esc(x.b)}</span></div>`;
const seqHtml = (x) => `<div class="seq">${(x.seq || []).map((v) => (v === null || v === undefined || v === '_'
  ? '<span class="cell blank"></span>' : `<span class="cell">${esc(v)}</span>`)).join('')}</div><!--seq-->`;

function mathsBody(t, kind) {
  const prac = t.practice || [];
  if (!Array.isArray(t.items) || !t.items.length) throw new Error(`child-test print v3: ${t.task} has no items`);
  if (kind === 'number_id') {
    return (prac.length ? practiceBox(grid(prac.map(String), { cls: 'num', size: CHILD_PT.number_id, cols: 5 })) + '<hr class="sep">' : '')
      + grid(t.items.map(String), { cls: 'num', size: CHILD_PT.number_id, cols: Number(t.per_row) || 5, main: true });
  }
  if (kind === 'discrimination' || kind === 'missing') {
    const f = kind === 'discrimination' ? pairHtml : seqHtml;
    const size = CHILD_PT[kind];
    return (prac.length ? practiceBox(`<div class="pgrid" style="font-size:${pt(size)}">${prac.map(f).join('')}</div>`) + '<hr class="sep">' : '')
      + `<div class="mains" style="font-size:${pt(size)}">${t.items.map(f).join('')}</div>`;
  }
  // + and −: the EGMA sheet reads top to bottom, column by column ("glide hand top to bottom").
  const level1 = kind === 'add1' || kind === 'sub1';
  const cols = t.items.length > 6 ? 2 : 1;
  const rows = Math.ceil(t.items.length / cols);
  const size = level1 ? CHILD_PT.sums1 : CHILD_PT.sums2;
  return (prac.length ? practiceBox(grid(prac.map((x) => `${sumText(x)} =`), { cls: 'num sums', size, cols: 2, rows: Math.ceil(prac.length / 2) })) + '<hr class="sep">' : '')
    + grid(t.items.map((x) => `${sumText(x)} =`), { cls: 'num sums', size, cols, rows, main: true });
}

function childBand({ bk, t, page, bank, set }) {
  const lab = bk.kind === 'reading' ? ux(bk.lang === 'ur' ? 'childTestBlockUrdu' : 'childTestBlockEnglish', 'en') : ux('childTestPrintV3BookletMaths', 'en');
  const sub = bk.kind === 'reading' ? ux('childTestPrintV3GradesBoth', 'en') : `Grade ${bk.grade}`;
  const urSub = bk.kind === 'reading' ? ux('childTestPrintV3GradesBoth', 'ur') : `جماعت ${urDigits(bk.grade)}`;
  const urLab = `${ux(bk.title, 'ur')} – ${urSub} · ${t.title && t.title.ur ? t.title.ur : ''} · ${ux('childTestPrintV3Page', 'ur', { n: urDigits(page) })}`;
  return '<header><div class="band">'
    + `<span class="left"><span class="lab">${esc(lab)}</span><span class="sub">${esc(sub)}</span></span>`
    + `<span class="right"><span class="set">${esc(setLabel(bank, set))}</span>`
    + `<span class="urlab" lang="ur" dir="rtl">${esc(urLab)}</span>`
    + `<span class="pg">${esc(ux('childTestPrintV3Page', 'en', { n: page }))} · ${esc(t.title && t.title.en ? t.title.en : t.task)}</span></span>`
    + '</div></header>';
}

function blankSide({ id, part, note }) {
  return `<section class="page blankside" data-page="${id}" data-part="${part}" data-audience="blank">`
    + `<div>${esc(note || 'This side is blank on purpose.')}<br><span class="ur" lang="ur" dir="rtl">یہ طرف جان بوجھ کر خالی ہے۔</span></div></section>`;
}

/** A booklet's sides, padded to whole sheets (double-sided). */
function bookletSections({ bank, set, booklet }) {
  const { bk, pages } = bookletPlan(bank, set, booklet);
  const part = `booklet-${bk.id}`;
  const out = pages.map(({ kind, spec: t, page }) => {
    const body = bk.kind === 'reading' ? readingBody(t, kind, bk.lang) : mathsBody(t, kind);
    const maxKey = bk.kind === 'reading' ? kind : (kind === 'add1' || kind === 'sub1' ? 'sums1' : kind === 'add2' || kind === 'sub2' ? 'sums2' : kind);
    return `<section class="page card" data-page="${bk.id}/${kind}" data-part="${part}" data-audience="child" data-booklet="${bk.id}" data-task="${esc(t.task)}" data-side="${page}" style="--band:${bk.colour.hex};--tint:${bk.colour.tint}">`
      + childBand({ bk, t, page, bank, set })
      + `<div class="fit" data-max="${CHILD_MAX[maxKey] || 1.3}" data-min="1">${body}</div><div class="foot"></div></section>`;
  });
  if (out.length % 2) out.push(blankSide({ id: `${bk.id}/blank`, part }));
  return out;
}

/* -------------------------------------------------------------------- coach cards -- */

const COACH_PT = { body: 13, label: 11, acc: 11.5, meta: 11, stop: 12, story: 14, maths: 13, wp: 14.5 };

const COACH_CSS = `
.page.cc{background:#fff}
.band.cc{height:auto;padding:2mm 7mm 0;display:block}
.band.cc .row{display:flex;align-items:center;justify-content:space-between;gap:4mm}
.band.cc .lab{font:700 18pt/1.3 ${LATIN_STACK};white-space:nowrap}
.band.cc .set{font:700 13pt/1.1 ${LATIN_STACK};white-space:nowrap;background:rgba(255,255,255,.2);padding:1mm 2.5mm;border-radius:2mm}
.band.cc .urlab{font:700 14pt/1.9 ${URDU_STACK};direction:rtl;white-space:nowrap}
.dont{margin:1mm -7mm 0;background:#101828;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:6mm;padding:0 7mm;font:700 13pt/1.6 ${LATIN_STACK}}
.dont .ur{font:700 13pt/1.9 ${URDU_STACK};direction:rtl;unicode-bidi:isolate}
.fit.cc{padding:1.5mm 7mm 1.5mm;justify-content:flex-start;gap:calc(var(--s)*.8mm)}
.blk{padding:0 0 calc(var(--s)*.5mm);border-bottom:.8mm solid var(--tint)}
.blk:last-child{border-bottom:0}
.blk.ur{font-family:${URDU_STACK};direction:rtl;text-align:right}
.blk.en{font-family:${LATIN_STACK};direction:ltr;text-align:left}
.blk h3{margin:0;color:var(--band);display:flex;flex-wrap:wrap;gap:0 3mm;align-items:baseline}
.blk h3 .t{font-weight:700;font-size:calc(var(--s)*13.5pt)}
.blk h3 .o{font-weight:700;font-size:calc(var(--s)*12pt);opacity:.8}
.blk h3 .o.ur{font-family:${URDU_STACK};line-height:1.9}
.blk h3 .o.en{font-family:${LATIN_STACK}}
.blk.ur h3 .t{line-height:1.9}
.blk.en h3 .t{line-height:1.4}
.meta{font-weight:400;font-size:${COACH_PT.meta}pt;color:#344054;background:var(--tint);border-radius:1.5mm;padding:0 2mm;white-space:nowrap}
.blk.ur .meta{line-height:1.9}
.blk.en .meta{line-height:1.5}
.says{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-flow:row dense;gap:0 4mm;align-items:baseline}
.says .stop{grid-column:span 2;margin-top:0}
.says .stop.long{grid-column:1/-1}
.says.both .stop{grid-column:auto}
.says.both{grid-template-columns:minmax(0,1fr)}
.say{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 2mm;align-items:baseline;min-width:0}
.say.wide{grid-column:1/-1}
.say.both{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:0 3mm}
.qs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5mm 5mm;align-items:start}
.tag{flex:0 0 auto;font-weight:700;font-size:${COACH_PT.label}pt;background:var(--tint);color:var(--band);border-radius:1.5mm;padding:0 1.8mm;white-space:nowrap}
.blk.en .tag{font-family:${LATIN_STACK};line-height:1.5}
.blk.ur .tag{font-family:${URDU_STACK};line-height:1.9}
.line{font-size:calc(var(--s)*${COACH_PT.body}pt)}
.blk.ur .line{line-height:1.9}
.blk.en .line{line-height:1.4}
.blk.en .line.ur{font-family:${URDU_STACK};direction:rtl;unicode-bidi:isolate;line-height:2;color:#344054;text-align:right}
.ltext{border:.5mm solid #D0D5DD;border-radius:2mm;padding:.5mm 3mm;margin:1mm 0;font-size:calc(var(--s)*${COACH_PT.story}pt)}
.blk.ur .ltext{line-height:2.1}
.blk.en .ltext{line-height:1.5}
.q{display:flex;gap:2.5mm;align-items:baseline}
.q .num{flex:0 0 6.5mm;height:6.5mm;border-radius:50%;background:var(--band);color:#fff;text-align:center;font:700 11pt/6.5mm ${LATIN_STACK}}
.blk.ur .q{gap:4mm}
.blk.ur .q .num{font:700 11pt/7.5mm ${URDU_STACK}}
.qb{flex:1 1 auto;min-width:0}
.p{font-weight:700;font-size:calc(var(--s)*${COACH_PT.body}pt)}
.blk.ur .p{line-height:2}
.blk.en .p{line-height:1.4}
.acc{font-size:calc(var(--s)*${COACH_PT.acc}pt);color:#475467}
.blk.ur .acc{line-height:1.95}
.blk.en .acc{line-height:1.3;font-family:'CTAndika','CTNastaliq',sans-serif}
.acc .k{font-weight:700;color:#344054}
.acc bdi,.reach bdi{unicode-bidi:isolate}
.reach{font-size:calc(var(--s)*${COACH_PT.acc}pt);font-weight:700;color:#9a3412}
.blk.ur .reach{line-height:1.95}
.blk.en .reach{line-height:1.3}
.stop{margin-top:.8mm;padding:0 2.5mm;border-inline-start:1.2mm solid #B42318;background:#FEF3F2;color:#7A271A;font-weight:700;font-size:${COACH_PT.stop}pt}
.blk.ur .stop{line-height:1.95}
.blk.en .stop{line-height:1.45}
.mrow{display:flex;flex-wrap:wrap;gap:.6mm 2.5mm;direction:ltr;font:calc(var(--s)*${COACH_PT.maths}pt)/1.5 ${LATIN_STACK};margin:.5mm 0}
.mn{min-width:11mm;text-align:center;border-bottom:.3mm solid #D0D5DD}
.mp{display:inline-flex;gap:2.5mm;align-items:center;padding:0 2mm;border:.3mm solid #D0D5DD;border-radius:2mm;white-space:nowrap}
.mp .ans{border:.6mm solid var(--band);border-radius:4mm;padding:0 1.5mm;font-weight:700;color:var(--band)}
.mq{display:inline-flex;gap:1.5mm;align-items:center;padding:0 2mm;border:.3mm solid #D0D5DD;border-radius:2mm;white-space:nowrap}
.mq .ma{font-weight:700;color:var(--band);border:.6mm solid var(--band);border-radius:1mm;padding:0 1mm}
.mi{white-space:nowrap;min-width:20mm;border-bottom:.3mm solid #EAECF0}
.mi b{color:var(--band)}
.pr{font:700 9.5pt/1.5 ${LATIN_STACK};color:#667085;background:#F2F4F7;border-radius:1mm;padding:0 1mm}
.wps{display:block}
.wp{display:block;font-size:calc(var(--s)*${COACH_PT.wp}pt);line-height:1.95;padding:0}
.wp.prac .num{width:auto;border-radius:2mm;padding:0 2mm}
.wp .num{display:inline-block;width:7mm;height:7mm;border-radius:50%;background:var(--band);color:#fff;text-align:center;font:700 12pt/8mm ${URDU_STACK};margin-inline-end:2mm}
.wp .ansb{display:inline-block;margin-inline-start:2mm;line-height:1.5;font-weight:700;background:var(--band);color:#fff;border-radius:2mm;padding:0 3mm;white-space:nowrap}
.wp.prac .num{background:#98A2B3}
.ccrule{flex:0 0 auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6mm;align-items:center;padding:1mm 7mm;background:#FEF3F2;border-top:1mm solid #B42318;color:#7A271A}
.ccrule .en{font:700 11.5pt/1.3 ${LATIN_STACK}}
.ccrule .ur{font:700 11.5pt/1.9 ${URDU_STACK};direction:rtl;text-align:right}
.foot.cc{flex:0 0 3mm}
`;

// Typography per script (not wording: that is the catalog's). Urdu prose takes Urdu digits (§9.4).
const SCRIPT = {
  ur: { dir: 'rtl', other: 'en', quote: ['«', '»'], sep: '، ', prose: (t) => urDigits(one(t)), num: (n) => urDigits(n) },
  en: { dir: 'ltr', other: 'ur', quote: ['“', '”'], sep: ' · ', prose: (t) => one(t), num: (n) => String(n) },
};
const URDU_RE = /[؀-ۿ]/;

// The tag shown before each scripted line, by bank script key; any other key prints as "Say".
const SAY_TAG = {
  intro: 'childTestPrintV3SayIntro',
  practice: 'childTestPrintV3SayPractice',
  practice_right: 'childTestPrintV3SayPracticeRight',
  practice_wrong: 'childTestPrintV3SayPracticeWrong',
  begin: 'childTestPrintV3SayBegin',
  start: 'childTestPrintV3SayBegin',
  go_on: 'childTestCoachCardSayGoOn',
  stop: 'childTestPrintV3SayStop',
  questions: 'childTestCoachCardSayQuestions',
  next: 'childTestCoachCardNext',
};

/** One line the coach says, verbatim; the English card also gives the bank's Urdu wording. */
function sayRow(lang, key, line, { untimed = false, both = false } = {}) {
  const T = SCRIPT[lang];
  const tagKey = key === 'stop' && untimed ? 'childTestCoachCardEnd' : (SAY_TAG[key] || 'childTestPrintV3SayOther');
  const text = line && line[lang];
  if (!text) throw new Error(`child-test print v3: script line "${key}" has no ${lang} text`);
  const wide = !both && [...one(text)].length > (lang === 'ur' ? 18 : 22);
  return `<div class="say${both ? ' both' : ''}${wide ? ' wide' : ''}"><span class="tag">${esc(ux(tagKey, lang))}</span>`
    + `<span class="line">${T.quote[0]}${esc(T.prose(text))}${T.quote[1]}</span>`
    + (both && line.ur ? `<span class="line ur" lang="ur" dir="rtl">«${esc(urDigits(one(line.ur)))}»</span>` : '')
    + '</div>';
}

// A line said the same way in several tasks of one card (begin, go on, thank you…) prints once, in the
// card's "lines for every task" block, so the card stays one sheet; every other line stays with its task.
const COMMON_KEYS = ['begin', 'start', 'go_on', 'stop', 'next', 'practice_right'];
const lineSig = (key, t, line, lang, both) => [key, t.timed_s ? 1 : 0, one(line && line[lang]), both ? one(line && line.ur) : ''].join('|');

function commonLines(specs, lang, both) {
  const seen = new Map();
  for (const t of specs) {
    for (const [k, line] of Object.entries(t.script || {})) {
      if (!COMMON_KEYS.includes(k)) continue;
      const sig = lineSig(k, t, line, lang, both);
      const e = seen.get(sig) || { key: k, line, timed: !!t.timed_s, n: 0 };
      e.n += 1;
      seen.set(sig, e);
    }
  }
  return new Map([...seen].filter(([, e]) => e.n > 1));
}

function says(t, lang, { both = false, common, extra = '' } = {}) {
  const script = t.script || {};
  const keys = Object.keys(script);
  if (!keys.length) throw new Error(`child-test print v3: ${t.task} has no script`);
  const own = keys.filter((k) => !(common && common.has(lineSig(k, t, script[k], lang, both))));
  if (!own.length && !extra) return '';
  return `<div class="says${both ? ' both' : ''}">${own.map((k) => sayRow(lang, k, script[k], { untimed: !t.timed_s, both })).join('')}${extra}</div>`;
}

function commonBlock(common, lang, both) {
  if (!common.size) return '';
  const T = SCRIPT[lang];
  const rows = [...common.values()].map((e) => sayRow(lang, e.key, e.line, { untimed: !e.timed, both }));
  return `<div class="blk ${lang}" data-task="common" dir="${T.dir}" lang="${lang}"><h3><span class="t">${esc(ux('childTestPrintV3CommonLines', lang))}</span>`
    + `<span class="o ${T.other}" lang="${T.other}">${esc(ux('childTestPrintV3CommonLines', T.other))}</span></h3>`
    + `<div class="says${both ? ' both' : ''}">${rows.join('')}</div></div>`;
}

function stopRule(t, lang, { kind, skipL2 } = {}) {
  const T = SCRIPT[lang];
  const out = [];
  if (kind === 'listening') out.push(ux('childTestPrintV3StopListening', lang));
  const st = t.stop || { type: 'none' };
  if (st.type === 'first_row') out.push(ux('childTestPrintV3StopFirstRow', lang, { n: T.num(Number(t.per_row) || (kind === 'letters' ? 10 : 5)) }));
  else if (st.type === 'first_line') out.push(ux('childTestPrintV3StopFirstLine', lang));
  else if (st.type === 'consecutive_errors') out.push(ux('childTestPrintV3StopConsecutive', lang, { n: T.num(Number(st.n) || 4) }));
  else if (!t.timed_s && kind !== 'listening') out.push(ux('childTestPrintV3StopNone', lang));
  if (t.timed_s) out.push(ux('childTestPrintV3StopTimed', lang));
  if (skipL2) out.push(ux('childTestPrintV3SkipIfL1Zero', lang));
  const long = [...out.join(' ')].length > 40;
  return out.length ? `<div class="stop${long ? ' long' : ''}">${out.map((s) => `<span>${esc(s)}</span>`).join(' ')}</div>` : '';
}

function blockHead(t, lang, { sheet }) {
  const T = SCRIPT[lang];
  const title = (t.title && t.title[lang]) || t.task;
  const other = t.title && t.title[T.other];
  const metas = [sheet, t.gap ? null : ux(t.timed_s ? 'childTestPrintV3Timed' : 'childTestPrintV3Untimed', lang)].filter(Boolean);
  return `<h3><span class="t">${esc(title)}</span>${other ? `<span class="o ${T.other}" lang="${T.other}">${esc(other)}</span>` : ''}`
    + metas.map((m) => `<span class="meta">${esc(m)}</span>`).join('') + '</h3>';
}

function sheetLabel(bank, set, bk, kind, lang) {
  const hit = bookletPlan(bank, set, bk.id).pages.find((p) => p.kind === kind);
  if (!hit) return ux('childTestPrintV3NoSheet', lang);
  const name = bk.kind === 'reading'
    ? ux(bk.lang === 'ur' ? 'childTestBlockUrdu' : 'childTestBlockEnglish', lang)
    : `${ux('childTestPrintV3BookletMaths', lang)} ${SCRIPT[lang].num(bk.grade)}`;
  return ux('childTestPrintV3BookletPage', lang, { booklet: name, n: SCRIPT[lang].num(hit.page) });
}

function acceptsHtml(q, lang) {
  const T = SCRIPT[lang];
  const L = (key) => ux(key, lang);
  const all = coachAccepts(q.accept, { latinOnly: lang === 'en' });
  const label = L(lang === 'en' && (q.accept || []).some((a) => URDU_RE.test(a)) ? 'childTestCoachCardAcceptAlsoUrdu' : 'childTestCoachCardAccept');
  return `<div class="acc" data-accept="${esc(q.id)}"><span class="k">${esc(label)}:</span> `
    + all.slice(0, COACH_ACCEPT_MAX).map((a) => `<bdi>${esc(lang === 'ur' ? urDigits(a) : a)}</bdi>`).join(T.sep)
    + (all.length > COACH_ACCEPT_MAX ? `${T.sep}<span class="more">…</span>` : '')
    + '</div>';
}

function questionsHtml(t, lang, { reach }) {
  const T = SCRIPT[lang];
  const qs = t.questions || [];
  if (!qs.length) throw new Error(`child-test print v3: ${t.task} has no questions`);
  return '<div class="qs">' + qs.map((q, i) => {
    if (!q.prompt || !Array.isArray(q.accept) || !q.accept.length) throw new Error(`child-test print v3: ${t.task} question ${q.id} has no prompt/accept`);
    const note = reach && (i > 0 || Number(q.needs_line) > 1)
      ? `<div class="reach" data-reach="${esc(q.id)}">${esc(ux('childTestL34OnlyIfPast', lang))} <bdi>${T.quote[0]}${esc(T.prose(anchorFor(t, q)))}${T.quote[1]}</bdi></div>`
      : '';
    return `<div class="q"><span class="num">${T.num(i + 1)}</span><div class="qb">${note}<div class="p">${esc(T.prose(q.prompt))}</div>${acceptsHtml(q, lang)}</div></div>`;
  }).join('') + '</div>';
}

function readingBlock({ bank, set, bk, kind, common }) {
  const lang = bk.lang;
  const T = SCRIPT[lang];
  const t = specOf(bank, set, bk, kind);
  const open = `<div class="blk ${lang}" data-task="${esc(t.task)}" dir="${T.dir}" lang="${lang}">`;
  if (t.gap) {
    return `${open}${blockHead({ ...t, title: null }, lang, { sheet: null })}<div class="stop">${esc(ux('childTestPrintV3GapSkip', lang))}</div></div>`;
  }
  const both = lang === 'en';
  let body = blockHead(t, lang, { sheet: sheetLabel(bank, set, bk, kind, lang) });
  if (kind === 'listening') {
    if (!t.story || !t.story.text) throw new Error(`child-test print v3: ${t.task} has no story text`);
    body += says({ ...t, script: pick(t.script, (k) => k !== 'questions') }, lang, { both, common })
      + `<div class="say"><span class="tag">${esc(ux('childTestPrintV3Story', lang))}</span><span class="line">${esc(ux('childTestPrintV3ReadTwice', lang))}</span></div>`
      + `<div class="ltext">${esc(T.prose(t.story.text))}</div>`
      + (t.script && t.script.questions ? `<div class="says${both ? ' both' : ''}">${sayRow(lang, 'questions', t.script.questions, { both })}</div>` : '')
      + questionsHtml(t, lang, { reach: false })
      + stopRule(t, lang, { kind });
  } else if (kind === 'story') {
    body += says({ ...t, script: pick(t.script, (k) => k !== 'questions') }, lang, { both, common })
      + stopRule(t, lang, { kind })
      + `<div class="says${both ? ' both' : ''}"><div class="say"><span class="tag">${esc(ux('childTestCoachCardFaceDown', lang))}</span></div>`
      + (t.script && t.script.questions ? sayRow(lang, 'questions', t.script.questions, { both }) : '') + '</div>'
      + questionsHtml(t, lang, { reach: true });
  } else {
    body += says(t, lang, { both, common, extra: stopRule(t, lang, { kind }) });
  }
  return `${open}${body}</div>`;
}

function pick(obj, keep) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (keep(k)) out[k] = v;
  return out;
}

function mathsBlock({ bank, set, bk, kind, common }) {
  const t = specOf(bank, set, bk, kind);
  const open = `<div class="blk ur" data-task="${esc(t.task)}" dir="rtl" lang="ur">`;
  if (t.gap) return `${open}${blockHead({ ...t, title: null }, 'ur', { sheet: null })}<div class="stop">${esc(ux('childTestPrintV3GapSkip', 'ur'))}</div></div>`;
  const prac = t.practice || [];
  const pr = `<span class="pr">${esc(ux('childTestPrintV3PracticeItem', 'en'))}</span>`;
  let items = '';
  if (kind === 'number_id') {
    items = `<div class="mrow">${t.items.map((n) => `<span class="mn">${esc(n)}</span>`).join('')}</div>`;
  } else if (kind === 'discrimination') {
    const p = (x, isPrac) => {
      const big = x.answer !== undefined ? x.answer : Math.max(x.a, x.b);
      const n = (v) => (String(v) === String(big) ? `<span class="ans">${esc(v)}</span>` : `<span class="x">${esc(v)}</span>`);
      return `<span class="mp">${isPrac ? pr : ''}${n(x.a)}${n(x.b)}</span>`;
    };
    items = `<div class="mrow">${prac.map((x) => p(x, true)).join('')}${t.items.map((x) => p(x, false)).join('')}</div>`;
  } else if (kind === 'missing') {
    const q = (x, isPrac) => `<span class="mq">${isPrac ? pr : ''}${(x.seq || []).map((v) => (v === null || v === undefined || v === '_'
      ? `<b class="ma">${esc(x.answer)}</b>` : `<span>${esc(v)}</span>`)).join('')}</span>`;
    items = `<div class="mrow">${prac.map((x) => q(x, true)).join('')}${t.items.map((x) => q(x, false)).join('')}</div>`;
  } else if (kind === 'word_problems') {
    const wp = (w, i, isPrac) => {
      if (!w.prompt_ur || w.answer === undefined) throw new Error(`child-test print v3: word problem ${w.id || i} has no prompt_ur/answer`);
      return `<div class="wp${isPrac ? ' prac' : ''}"${w.id && !isPrac ? ` data-wp="${esc(w.id)}"` : ''} dir="rtl" lang="ur">`
        + `<span class="num">${isPrac ? esc(ux('childTestPrintV3PracticeItem', 'ur')) : urDigits(i + 1)}</span><span class="txt">«${esc(urDigits(one(w.prompt_ur)))}»</span>`
        + `<span class="ansb">${esc(ux('childTestCoachCardAnswer', 'ur'))}: ${urDigits(w.answer)}</span></div>`;
    };
    items = `<div class="wps">${prac.map((w, i) => wp(w, i, true)).join('')}${t.items.map((w, i) => wp(w, i, false)).join('')}</div>`;
  } else {
    items = `<div class="mrow">${prac.map((x) => `<span class="mi">${pr} ${esc(sumText(x))} = <b>${esc(x.answer)}</b></span>`).join('')}`
      + `${t.items.map((x) => `<span class="mi">${esc(sumText(x))} = <b>${esc(x.answer)}</b></span>`).join('')}</div>`;
  }
  const form = bank.sets[setOf(bank, set).S].maths[String(bk.grade)];
  const skipL2 = (kind === 'add2' || kind === 'sub2') && form.skip_level2_if_level1_zero;
  return `${open}${blockHead(t, 'ur', { sheet: sheetLabel(bank, set, bk, kind, 'ur') })}${says(t, 'ur', { common, extra: stopRule(t, 'ur', { kind, skipL2 }) + (kind === 'word_problems' ? `<div class="say"><span class="tag">${esc(ux('childTestCoachCardFaceDown', 'ur'))}</span></div>` : '') })}${items}</div>`;
}

const CARDS = {
  ur: { booklet: 'ur', title: (l) => ux('childTestPrintV3CoachUrdu', l) },
  en: { booklet: 'en', title: (l) => ux('childTestPrintV3CoachEnglish', l) },
  ma3: { booklet: 'ma3', title: (l) => ux('childTestPrintV3CoachMaths', l, { grade: l === 'ur' ? urDigits(3) : 3 }) },
  ma5: { booklet: 'ma5', title: (l) => ux('childTestPrintV3CoachMaths', l, { grade: l === 'ur' ? urDigits(5) : 5 }) },
};

/** One coach card = one sheet: the front holds every block it can at full type, the rest flows to the back. */
function coachCardSections({ bank, set, card }) {
  const c = CARDS[card];
  if (!c) throw new Error(`child-test print v3: no coach card "${card}"`);
  const bk = BOOKLETS[c.booklet];
  const kinds = bk.kind === 'reading' ? READING_ALL : MATHS_ALL;
  const lang = bk.kind === 'reading' ? bk.lang : 'ur';
  const both = lang === 'en';
  const common = commonLines(kinds.map((k) => specOf(bank, set, bk, k)).filter((t) => !t.gap), lang, both);
  const blocks = [commonBlock(common, lang, both), ...kinds.map((kind) => (bk.kind === 'reading'
    ? readingBlock({ bank, set, bk, kind, common }) : mathsBlock({ bank, set, bk, kind, common })))].filter(Boolean);
  const head = '<header>'
    + `<div class="band cc"><div class="row"><span class="lab">${esc(c.title('en'))}</span><span class="set">${esc(setLabel(bank, set))}</span>`
    + `<span class="urlab" lang="ur" dir="rtl">${esc(c.title('ur'))}</span></div>`
    + `<div class="dont"><span>${esc(ux('childTestCoachCardDontShow', 'en'))}</span><span class="ur" lang="ur" dir="rtl">${esc(ux('childTestCoachCardDontShow', 'ur'))}</span></div></div>`
    + '</header>';
  const id = `coach-${card}`;
  const sec = (side, body, flowTo) => `<section class="page cc" data-page="${id}/${side}" data-part="${id}" data-audience="coach" data-card="${card}" data-side="${side}"`
    + `${flowTo ? ` data-flow-to="${flowTo}"` : ''} style="--band:${bk.colour.hex};--tint:${bk.colour.tint}">`
    + `${head}<div class="fit cc" data-max="1.2" data-min="1">${body}</div><div class="foot cc"></div></section>`;
  return [sec('front', blocks.join(''), `${id}/back`), sec('back', '')];
}

/* --------------------------------------------------------------------------- cover -- */

const COVER_CSS = `
.cover{padding:14mm 16mm;font-family:${LATIN_STACK};display:block}
.cover h1{font-size:21pt;margin:0 0 2mm}
.cover .lead{font-size:12.5pt;margin:0 0 3mm;color:#344054}
.cover table{border-collapse:collapse;width:100%;font-size:11pt;margin:2mm 0}
.cover td,.cover th{border:.4mm solid #D0D5DD;padding:1.2mm 2.5mm;text-align:left;vertical-align:middle}
.cover th{background:#F2F4F7}
.cover .sw{display:inline-block;width:5mm;height:5mm;border-radius:1mm;vertical-align:middle;margin-right:2mm}
.cover ul{font-size:11.5pt;line-height:1.45;padding-left:6mm;margin:1mm 0 2mm}
.cover h2{font-size:13.5pt;margin:3mm 0 1mm}
.cover .gap{border:.8mm solid #B42318;border-radius:2mm;padding:1.5mm 3mm;color:#7A271A;font-size:11pt}
.cover .gap ul{font-size:11pt;margin:0}
.cover code{font-size:10.5pt}
`;

function coverSection({ bank, set, parts }) {
  const label = setLabel(bank, set);
  let p = 3;
  const rows = parts.map((x) => {
    const r = `<tr><td>${p}–${p + x.sides - 1}</td><td><span class="sw" style="background:${x.colour.hex}"></span>${esc(x.what)}</td><td>${x.sides / 2}</td><td>${esc(x.who)}</td></tr>`;
    p += x.sides;
    return r;
  });
  const sheets = parts.reduce((n, x) => n + x.sides / 2, 0);
  const gaps = gapsOf(bank, set);
  return `<section class="page cover" data-page="cover" data-audience="printer">`
    + `<h1>Child test print pack v3 · ${esc(label)}</h1>`
    + '<p class="lead">Everything one coach needs for the full EGRA/EGMA battery this term. <b>Print one copy per coach.</b></p>'
    + '<ul>'
    + '<li><b>Printer:</b> A4, colour, <b>double-sided, flip on the long edge</b>. Pages 1–2 are this cover: don\'t laminate them.</li>'
    + `<li><b>Then laminate every sheet after the cover</b>: ${sheets} sheets, each printed front and back. Each part starts on a new sheet; a "blank on purpose" side keeps it that way.</li>`
    + '<li><b>Check before laminating:</b> the reading booklets have a grey band ("Grades 3 and 5"); Maths Grade 3 is green, Maths Grade 5 is blue; every band says the same set as this cover.</li>'
    + '</ul>'
    + '<h2>Kit per coach</h2><ul>'
    + `<li>4 coach cards (Urdu reading, English reading, Maths Grade 3, Maths Grade 5): <b>the coach's hand only</b>, never shown to the child.</li>`
    + '<li>4 child booklets (Urdu reading, English reading, Maths Grade 3, Maths Grade 5): clip or ring each booklet\'s sheets together in page order.</li>'
    + '<li>10–20 counters (bottle caps or pebbles), blank paper and a pencil for the child (harder sums and word problems).</li>'
    + '<li>The coach\'s phone, charged; a desk and two chairs away from the class.</li>'
    + '</ul>'
    + `<table><tr><th style="width:16mm">Pages</th><th>What</th><th style="width:16mm">Sheets</th><th style="width:30mm">Who holds it</th></tr>${rows.join('')}</table>`
    + '<p class="lead" style="font-size:11pt">No child sheet for listening or word problems: the coach reads those aloud from the coach card.</p>'
    + (gaps.length
      ? `<div class="gap"><b>Not in this set (no page; the bot skips these tasks with a line to the coach):</b><ul>${gaps.map((g) => `<li><code>${esc(g.task)}</code> (${esc(g.where)}): ${esc(g.reason)}</li>`).join('')}</ul></div>`
      : '')
    + '</section>';
}

/* ------------------------------------------------------------------------- the fit -- */

/**
 * In-page, before capture: (1) a coach card's front gives its trailing blocks to the back while it
 * overflows at scale 1; (2) every page grows its type until something would overflow, then steps
 * back, never below data-min. Reports overflow, scales and page count.
 */
const FIT_SCRIPT = `
window.__beforeCapture = async function () {
  var overflow = [], scales = {};
  function over(fit) {
    if (fit.scrollHeight > fit.clientHeight + 1 || fit.scrollWidth > fit.clientWidth + 1) return true;
    return Array.prototype.some.call(fit.querySelectorAll('.it,.pair,.seq,.mp,.mq,.mi,.band .lab,.band .urlab'), function (el) { return el.scrollWidth > el.clientWidth + 1; });
  }
  document.querySelectorAll('.page[data-flow-to]').forEach(function (pg) {
    var fit = pg.querySelector('.fit');
    var to = document.querySelector('.page[data-page="' + pg.getAttribute('data-flow-to') + '"] .fit');
    if (!fit || !to) return;
    pg.style.setProperty('--s', 1);
    to.parentNode.style.setProperty('--s', 1);
    while (over(fit) && fit.children.length > 1) to.insertBefore(fit.lastElementChild, to.firstChild);
  });
  document.querySelectorAll('.page').forEach(function (pg) {
    var fit = pg.querySelector('.fit');
    var s = 1;
    if (fit && fit.children.length) {
      s = Number(fit.getAttribute('data-max')) || 1.5;
      var min = Number(fit.getAttribute('data-min')) || 1;
      pg.style.setProperty('--s', s);
      while (over(fit) && s > min) { s = Math.max(min, Math.round((s - 0.02) * 100) / 100); pg.style.setProperty('--s', s); }
      if (over(fit)) overflow.push(pg.getAttribute('data-page'));
    } else if (pg.scrollHeight > pg.clientHeight + 1) overflow.push(pg.getAttribute('data-page'));
    scales[pg.getAttribute('data-page')] = s;
  });
  return { overflow: overflow, scales: scales, pages: document.querySelectorAll('.page').length };
};
`;

function doc(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${fontFaceCss({ latin: true, urdu: true, bold: true })}${CSS}${COACH_CSS}${COVER_CSS}</style></head>`
    + `<body>${body}<script>${FIT_SCRIPT}</script></body></html>`;
}

/* ---------------------------------------------------------------------- builders -- */

/** One child booklet ('ur' | 'en' | 'ma3' | 'ma5'), one task per side, padded to whole sheets. */
function buildBookletHtml({ bank, set = 'A', booklet }) {
  return doc(bookletSections({ bank, set, booklet }).join(''));
}

/** One coach card ('ur' | 'en' | 'ma3' | 'ma5'): one sheet, front and back. */
function buildCoachCardHtml({ bank, set = 'A', card }) {
  return doc(coachCardSections({ bank, set, card }).join(''));
}

const PART_LABEL = {
  'coach-ur': ['Coach card · Urdu reading (listening, letters, words, story)', 'coach'],
  'coach-en': ['Coach card · English reading (listening, letters, made-up words, words, story)', 'coach'],
  'coach-ma3': ['Coach card · Maths Grade 3 (every answer, the 6 word problems)', 'coach'],
  'coach-ma5': ['Coach card · Maths Grade 5 (every answer, the 6 word problems)', 'coach'],
  'booklet-ur': ['Child booklet · Urdu reading, Grades 3 and 5', 'child (face up)'],
  'booklet-en': ['Child booklet · English reading, Grades 3 and 5', 'child (face up)'],
  'booklet-ma3': ['Child booklet · Maths Grade 3', 'child (face up)'],
  'booklet-ma5': ['Child booklet · Maths Grade 5', 'child (face up)'],
};

/**
 * Everything for one coach for a term, in print order: cover (+ blank back), the four coach cards,
 * then the four booklets. Every part starts on a fresh sheet.
 */
function buildPrintMeHtml({ bank, set = 'A' } = {}) {
  const groups = [
    ...['ur', 'en', 'ma3', 'ma5'].map((c) => ({ part: `coach-${c}`, colour: BOOKLETS[CARDS[c].booklet].colour, sections: coachCardSections({ bank, set, card: c }) })),
    ...BOOKLET_ORDER.map((b) => ({ part: `booklet-${b}`, colour: BOOKLETS[b].colour, sections: bookletSections({ bank, set, booklet: b }) })),
  ];
  const parts = groups.map((g) => ({ what: PART_LABEL[g.part][0], who: PART_LABEL[g.part][1], colour: g.colour, sides: g.sections.length }));
  const all = [
    coverSection({ bank, set, parts }),
    '<section class="page blankside" data-page="cover-back" data-audience="printer"><div>This side is blank on purpose, so each card prints front-to-back.</div></section>',
    ...groups.flatMap((g) => g.sections),
  ];
  return doc(all.join(''));
}

/* ------------------------------------------------------------------------ rendering -- */

const PDF_OPTS = { preferCSSPageSize: true, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } };

async function pdfOf(page) {
  const { htmlToPdf } = require('../../../utils/html-to-pdf');
  let layout = null;
  const pdf = await htmlToPdf(page, { beforeCapture: true, onBeforeCapture: (r) => { layout = r; }, pdfOptions: PDF_OPTS });
  if (layout && layout.overflow && layout.overflow.length) {
    require('../../../utils/logger').logToFile('child_test.print_v3_overflow', { pages: layout.overflow }, 'error');
  }
  return { pdf, layout };
}

const renderBooklet = (a) => pdfOf(buildBookletHtml(a));
const renderCoachCard = (a) => pdfOf(buildCoachCardHtml(a));
const renderPrintMe = (a) => pdfOf(buildPrintMeHtml(a));

module.exports = {
  NEUTRAL,
  GRADE_COLOUR,
  BOOKLETS,
  BOOKLET_ORDER,
  COACH_PT,
  CHILD_PT,
  bookletPlan,
  pageFor,
  gapsOf,
  buildBookletHtml,
  buildCoachCardHtml,
  buildPrintMeHtml,
  renderBooklet,
  renderCoachCard,
  renderPrintMe,
};
