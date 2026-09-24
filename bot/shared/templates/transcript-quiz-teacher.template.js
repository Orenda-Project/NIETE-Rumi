'use strict';
/**
 * Transcript quiz — the teacher's PDF (v2).
 *
 * What the teacher gets alongside the forwardable link, on ONE scannable
 * sheet of three pages: what they taught, what the quiz checks, how to send
 * it, and then every question laid out the way the child will meet it —
 * picture, stem, three options with the correct one marked — each with ONE
 * line saying which moment of their lesson it came from and ONE line per
 * wrong option saying what choosing it would reveal.
 *
 * ONE LANGUAGE PER DOCUMENT (PLAN_R4 D1).
 *   Round 2 split the document in two: `language` drove the chrome (the
 *   teacher's stored preference) and `contentLanguage` drove the questions.
 *   The result was an English document with Urdu labels down its left side,
 *   which reads as a bug — "if it is in English why does it have Urdu in it".
 *   A document is now written wholly in the language the QUIZ was written in,
 *   which is the language the teacher chose for this quiz. Both parameters stay in the
 *   signature (callers pass the same value); `contentLanguage` wins, and
 *   `language` alone still works for a single-language caller.
 *
 *   The ONE exception is a person's NAME, which keeps the script it was typed
 *   in — `scriptOf()` — because "عائشہ" in an English document is still
 *   "عائشہ", and Latin letters put through Nastaliq metrics lay out as if they
 *   joined.
 *
 * Fonts are STILL dual-stacked everywhere. A single-language document is a
 * decision about words, not about glyph coverage: a name, a term the class
 * used, a chemical formula can be in the other script on any page, and the
 * render container has no system fonts to fall back on — a Latin-only face
 * paints Urdu as empty boxes.
 *
 * PlayWriteReports rules otherwise as before: fonts embedded as base64, Latin
 * runs inside Urdu isolated with both `unicode-bidi:isolate` AND
 * `direction:ltr`, numbers and links forced LTR.
 *
 * Brand: NIETE (niete-brand skill) — navy-slate ground, green accent, the
 * on-dark monogram, the diamond lattice at whisper density behind the hero,
 * diamond markers. No other product's palette, no glyph markers (a ✓ or a ●
 * depends on a font that covers it).
 */

const { LP_V8 } = require('../services/quiz/quiz-sources');
const fs = require('fs');
const path = require('path');
const { richNotation } = require('../services/quiz/quiz-notation');
const { mathHtml, mathCss, usesMath } = require('../services/quiz/quiz-math');
const { sloStatement } = require('../services/quiz/transcript-quiz-language');
const { resolveUx } = require('../config/ux-strings');
const { wrapLatinRuns } = require('./latin-runs');
const {
  PALETTE, FONTS, TYPE_FLOOR, TYPE_FLOOR_UR, TYPE_STEP, TYPE_STEP_UR, HEAD_SCALE, leadingAt,
  NASTALIQ, nastaliqPad, headFamily, bodyFamily, latticeSvg, diamondSvg, scriptOf,
} = require('./niete-brand');

// Urdu line pitch and box padding (niete-brand NASTALIQ): measured from the
// font's ink so two lines of Nastaliq never run into each other, and a line in
// a bordered row never runs through the border. The stems, the correct option
// and the hero title are set in the Bold face, which climbs higher.
const UR_LEAD = NASTALIQ.leading.regular;       // 2.4
const UR_LEAD_BOLD = NASTALIQ.leading.bold;     // 2.5
const UR_PAD = nastaliqPad(UR_LEAD);
const UR_PAD_BOLD = nastaliqPad(UR_LEAD_BOLD, 'bold');
const em = (n) => `${n}em`;

// PLAN_R5 D6 / PLAN_R6 D4 — the Urdu bump is now ONE constant, exported from
// niete-brand and shared with the class report, not recomputed per template.
// Round 5 had this file scaling by 1.15 while the class report scaled by
// 1.055 (19px against an 18px body) and neither file could see the other —
// the same drift the shared token exists to stop. The local names stay so the
// ~25 interpolation sites below do not move.
const BODY_UR = TYPE_FLOOR_UR.body;   // 24.2px
const SMALL_UR = TYPE_FLOOR_UR.small; // 19px
const LABEL_UR = TYPE_FLOOR_UR.label; // 17.8px

const round1 = (n) => Math.round(n * 10) / 10;

let _assets = null;
function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try { return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : ''; } catch { return ''; }
}
function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      fraunces: readBase64('fonts/Fraunces-Regular.ttf'),
      frauncesSemi: readBase64('fonts/Fraunces-SemiBold.ttf'),
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      // The monogram has a light and a dark form. The hero is navy-slate, so
      // it takes the on-dark one (green N, white nuqta); the footer sits on
      // white and takes the all-black one, per the brand book's background
      // table. Never redrawn, never described to a model — the file itself.
      markOnDark: readBase64('assets/niete-mark-ondark-padded.png'),
      markOnLight: readBase64('assets/niete-mark-black-transparent.png'),
    };
  }
  return _assets;
}

// The diagram engine paints with page tokens (var(--navy), var(--amber)…);
// unbound they fall back to the lesson-plan palette, so the PDF's figures are
// bound to the same NIETE tokens the child's PNG uses.
function figureTokens() {
  try {
    const { NIETE_TOKENS } = require('../services/quiz/transcript-quiz-figure');
    return Object.entries(NIETE_TOKENS).map(([k, v]) => `--${k}:${v}`).join(';');
  } catch { return '--navy:#333748;--amber:#47BA7D;--ink:#232735'; }
}

/**
 * The order the CHILD sees the options in.
 *
 * The sender shuffles display position with a shuffle seeded on the row's
 * `external_id`; a PDF that listed them in stored order would show the teacher
 * a different "A" from the one on their pupil's phone. Required lazily and
 * defensively: a PDF is worth more than a perfectly-ordered PDF.
 */
function childOrder(row) {
  try {
    const render = require('../services/quiz/video-quiz-render.service');
    const labels = render.optionLabels(row);
    return { labels, order: render.displayOrder(row, labels) };
  } catch {
    const labels = [row.option_a, row.option_b, row.option_c, row.option_d]
      .map((o) => (o == null ? '' : String(o).trim())).filter((o) => o !== '');
    return { labels, order: labels.map((_, i) => i) };
  }
}

/**
 * A figure's aspect ratio decides where it goes.
 *
 * The phone's canvas is 1.91:1 and some engines draw wider still — a number
 * line marked in tenths is nearly 4:1. Squeezed into a 268px side column its
 * tick labels print at about 4px, which is not a picture anybody can read.
 * Wide-and-flat figures therefore take the full column width above the stem
 * (where 710px makes the same labels legible) and cost almost no height;
 * square and tall ones sit beside the words, where they save a lot.
 */
const WIDE_ASPECT = 2.2;
function figureIsWide(svg) {
  const m = /viewBox\s*=\s*"\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(String(svg || ''));
  if (!m) return false;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return h > 0 && w / h >= WIDE_ASPECT;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A distractor's meaning is a caption, not a paragraph: a short sentence prints whole, a long one is cut at 14 words. */
function clampWords(s, max) {
  const words = String(s === null || s === undefined ? '' : s).trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ')}…`;
}

const RTL_LANGS = new Set(['ur']);

/**
 * "Briefly tell the teacher what they taught" (operator, 2026-09-14): the
 * lesson summary is authored at four or five sentences; the sheet shows the
 * first one, capped at 32 words. Sentence ends in either script count. An
 * authored one-line summary (digest.lesson_summary_short) replaces the cap.
 */
function clampSentences(text, max, maxWords = 32) {
  const parts = String(text || '').trim().split(/(?<=[.!?۔؟])\s+/).filter(Boolean);
  const words = parts.slice(0, max).join(' ').split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? words.join(' ') : `${words.slice(0, maxWords).join(' ')}…`;
}

/**
 * One sentence for "what this quiz checks". A digest authored after this
 * change carries `checks_summary` written by the model in the quiz language;
 * an older digest gets its objectives folded into one sentence — each
 * statement lower-cased at its first Latin letter and stripped of its full
 * stop, joined with the document's own list separators.
 */
function checksSentence(digest, slos, C, docLang) {
  const authored = digest && typeof digest.checks_summary === 'string' && digest.checks_summary.trim();
  if (authored) return authored;
  if (!slos.length) return '';
  const order = ['recall', 'understand', 'apply'];
  const levels = order.filter((l) => slos.some((s) => s.taught_level === l)).map((l) => C.levelWord[l]);
  const last = levels.pop();
  const list = levels.length ? `${levels.join(C.listSep)}${C.listAnd}${last}` : (last || '');
  return C.checksFallback(slos.length, list);
}

const CHROME = {
  en: {
    eyebrow: 'Class quiz · ready to forward',
    questions: 'questions', slos: 'learning goals',
    taught: 'What you taught', checks: 'What this quiz checks',
    level: { recall: 'recall', understand: 'understand', apply: 'apply' },
    fromLesson: 'Every question below is taken from this lesson.',
    checksFallback: (n, levels) => `${n} learning goals from the lesson, tested for ${levels}.`,
    levelWord: { recall: 'recall', understand: 'understanding', apply: 'application' },
    listAnd: ' and ', listSep: ', ',
    correct: 'correct',
    footer: 'Made from your lesson recording · NIETE Teaching Assistant',
  },
  ur: {
    // 'quiz' is a term of record (root rule 20 / operator item 14) — it stays
    // in Latin letters, never transliterated to 'کوئز'.
    eyebrow: 'کلاس quiz · forward کرنے کے لیے تیار',
    questions: 'سوالات', slos: 'سیکھنے کے مقاصد',
    taught: 'آپ نے کیا پڑھایا', checks: 'یہ quiz کیا جانچتا ہے',
    level: { recall: 'یاد', understand: 'سمجھ', apply: 'استعمال' },
    fromLesson: 'نیچے دیا گیا ہر سوال اسی سبق سے لیا گیا ہے۔',
    checksFallback: (n, levels) => `سبق کے ${n} سیکھنے کے مقاصد — ${levels} کی جانچ۔`,
    levelWord: { recall: 'یاد', understand: 'سمجھ', apply: 'استعمال' },
    listAnd: ' اور ', listSep: '، ',
    correct: 'درست',
    footer: 'آپ کے سبق کی ریکارڈنگ سے تیار · NIETE Teaching Assistant',
  },
};

/**
 * An lp_v8 quiz was written from the lesson PLAN the teacher was served —
 * nobody heard the lesson — so the two lines that say where the sheet came
 * from say so (PLAN_R8 §3.6). Only these keys differ; everything else is the
 * CHROME above.
 */
const LP_CHROME = {
  en: { taught: 'What you planned', footer: 'Made from your lesson plan · NIETE Teaching Assistant' },
  ur: { taught: 'آپ کے سبق کا منصوبہ', footer: 'آپ کے lesson plan سے تیار · NIETE Teaching Assistant' },
};

/**
 * Isolate every Latin run inside RTL prose.
 *
 * The run must be ONE span. Two consecutive spans are two isolates, and an
 * RTL paragraph lays isolates out right-to-left — which is how `x^2` printed
 * as "²x" and `H2O` as "O₂H" on the Urdu sheet: notation became
 * `x<sup>2</sup>`, the tag split the run in two, and the phone-correct order
 * reversed on paper. So `^` and `_` are part of a run (they are notation, not
 * a break), and a run may take a bracket that clearly belongs to it.
 */
const LATIN_TOKEN = '[A-Za-z0-9\'’".,:;!?()%/+=*$@#^_\\-]';
// The run itself — its joiners ("&", "·", spaces) and its entity handling —
// is latin-runs.js, shared with the class report so the two cannot drift.
function wrapLatin(html, rtl) {
  if (!rtl) return html;
  return wrapLatinRuns(html, { token: LATIN_TOKEN, leadingParen: true });
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * @param {object} d
 * @param {string} [d.language] a single-language caller's language; the
 *        document language when `contentLanguage` is absent.
 * @param {string} [d.contentLanguage] the language the QUIZ was written in —
 *        the whole document is written in it (D1).
 * @param {string} [d.lessonSummary] the author call's `lesson_summary`: what
 *        the teacher taught, in the order they taught it. Opens the document.
 * @param {string|number} [d.grade] accepted and ignored (operator item 6: a
 *        transcript spans several grades — "grade 6-8, that's a wild range"
 *        — so the pre-send PDF no longer prints one). The parameter stays
 *        because `transcript-quiz-generate.service.js renderPdf` is owned by
 *        another lane this round and passes it either way.
 * @param {Array}  [d.questions] `quiz_questions` rows. Each may carry
 *        `figureSvg` (drawn above the stem, as on the phone) and
 *        `selected_because` — directly or on `media.selected_because` — the
 *        one line saying which moment of the lesson the question tests.
 */
function renderTranscriptQuizTeacherHtml(d) {
  const a = assets();
  const {
    topic = '', teacherName = '', grade = '', date = '', link = '', digest = {}, questions = [],
    language = 'en', lessonSummary = '', quizSource = null,
  } = d || {};
  // D1: the document is written in the quiz's language. `language` is what a
  // single-language caller passes; `contentLanguage` is what the two-argument
  // callers pass, and it wins.
  const docLang = (d && d.contentLanguage) || language;
  const RTL = RTL_LANGS.has(docLang);
  const C0 = CHROME[docLang] || (RTL ? CHROME.ur : CHROME.en);
  const C = quizSource === LP_V8 ? { ...C0, ...(LP_CHROME[docLang] || (RTL ? LP_CHROME.ur : LP_CHROME.en)) } : C0;
  // L() only isolates, never re-escapes — a trusted chrome string may carry a
  // real <b> that must survive. K() additionally escapes and turns x^2 / H2O
  // into real super/subscripts (richNotation only adds tags, which wrapLatin
  // already skips).
  const L = (s) => wrapLatin(s, RTL);
  // Order matters: escape → isolate the Latin run → only then grow the
  // super/subscript tags inside that single isolate. Notation-first splits
  // the run across two isolates and an RTL paragraph then prints it backwards.
  //
  // Maths written `$…$` (bd-mg9c7.159.19) is typeset by KaTeX, the same way the
  // child's card draws it. mathHtml() hands only the PROSE between expressions
  // to the pipeline above, so wrapLatin() never reaches inside KaTeX's markup;
  // each expression is already its own left-to-right isolate.
  const K = (s) => mathHtml(s, { prose: (p) => richNotation(wrapLatin(esc(p), RTL)) });
  const dir = RTL ? 'rtl' : 'ltr';
  // Kept so a block can still declare its own direction where the script
  // genuinely differs from the document's (a name, a term).
  const cls = (extra) => `class="${extra} content" dir="${dir}"`;

  const slos = Array.isArray(digest.slos) ? digest.slos : [];
  const sloById = new Map(slos.map((s) => [s.id, s]));

  const bullet = diamondSvg({ size: 8, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });
  const optMarkCorrect = diamondSvg({ size: 12, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });

  void clampWords;
  const taughtText = clampSentences(lessonSummary, 1);
  const checksText = checksSentence(digest, slos, C, docLang);

  const cardList = questions.map((q, i) => {
    // external_id is `tq:<quizId>:<sloId>:<n>` in production and `tq:<sloId>:<n>`
    // in the older fixtures; the SLO is the second-to-last segment either way,
    // which is the convention the report already reads it by.
    const idParts = String(q.external_id || '').split(':');
    const sloId = (idParts.length >= 2 ? idParts[idParts.length - 2] : '') || q.slo_id || '';
    const slo = sloById.get(sloId);
    // The options in the order the CHILD meets them, with the same A/B/C
    // handles the sender puts on the buttons.
    const { labels, order } = childOrder(q);
    // A question may have more than one correct option ("select all that
    // apply"), stored as a comma-joined letter set. Every one of them is
    // marked — not just the first.
    const correctPositions = new Set(
      String(q.correct_option || 'A').split(',')
        .map((c) => order.indexOf(LETTERS.indexOf(c.trim())))
        .filter((p) => p >= 0));
    const isMulti = Boolean(q.media && q.media.answer_mode === 'multi');
    // EVERY row carries its letter, correct one included: the child taps a
    // letter, so a teacher reading "the answer is the one with the tick" still
    // has to count rows to know which button that is.
    const optionsHtml = order.map((stored, pos) => `
          <div ${cls(`opt${correctPositions.has(pos) ? ' correct' : ''}`)}><span class="mark"><span class="dia2"><span>${LETTERS[pos]}</span></span></span><span class="otext">${K(labels[stored])}</span>${correctPositions.has(pos) ? `<span class="tag">${L(C.correct)}</span>` : ''}</div>`).join('');
    // One compressed line per wrong option: the option, then in eight words
    // what picking it would reveal. The child-facing feedback prose is NOT
    // here — the teacher reads that on their phone with the child, not on paper.
    // Skips EVERY correct position, not just the first — otherwise a correct
    // option on a multi-answer question prints as a misconception.
    // The picture, when the question has one, sits beside the words and comes
    // first in reading order — the same order the child meets it in.
    const wide = q.figureSvg && figureIsWide(q.figureSvg);
    const figure = q.figureSvg ? `
        <div class="figure${wide ? ' wide' : ''}">${q.figureSvg}</div>` : '';
    return `
      <div class="card${q.figureSvg ? ' hasfig' : ''}">
        <div class="chead"><div class="num"><span>${i + 1}</span></div>
          <div class="cmeta">${slo ? `<span ${cls('slo')}>${K(sloStatement(slo, docLang))}</span> <span class="pill">${L(C.level[slo.taught_level] || '')}</span>` : ''}</div></div>
        ${wide ? figure : ''}
        <div class="cmain">${wide ? '' : figure}
          <div class="cbody">
            <div ${cls('stem')}>${K(q.question_text)}</div>
            ${isMulti ? `<div class="multichip"><span class="pill">${L(resolveUx('vqMultiSelectAll', { language: docLang }))}</span></div>` : ''}
            <div class="opts">${optionsHtml}</div>
          </div>
        </div>
      </div>`;
  });
  const cards = cardList.join('');
  // The LAST card travels with the footer (see .tail below); the rest flow.
  const leadCards = cardList.slice(0, -1).join('');
  const lastCard = cardList.length ? cardList[cardList.length - 1] : '';

  const heroMark = a.markOnDark ? `<img class="hero-mark" src="data:image/png;base64,${a.markOnDark}" alt="NIETE">` : '';
  const footMark = a.markOnLight ? `<img class="mark-img" src="data:image/png;base64,${a.markOnLight}" alt="NIETE">` : '';
  const headFam = headFamily(RTL);
  const bodyFam = bodyFamily(RTL);
  const lh = RTL ? `${leadingAt(1.85)}` : '1.42';
  // A NAME keeps the script it was typed in, whatever the document's language.
  const nameRtl = scriptOf(teacherName) === 'ur';
  const nameHtml = teacherName
    ? `<span class="nm" dir="${nameRtl ? 'rtl' : 'ltr'}">${esc(teacherName)}</span>` : '';
  // grade is accepted-and-ignored (operator item 6) — the meta line is
  // `name · date` only.
  void grade; void link;
  const meta = [nameHtml, date ? L(esc(date)) : ''].filter(Boolean).join('<span class="sep">·</span>');
  // Built before the page so the page knows whether it needs KaTeX: its
  // stylesheet carries ~350 KB of inlined faces, and a sheet with no maths is
  // left exactly as light as it was.
  const topicHtml = K(topic);
  const taughtHtml = taughtText ? K(taughtText) : '';
  const checksHtml = checksText ? K(checksText) : '';
  const maths = [cards, topicHtml, taughtHtml, checksHtml].some(usesMath);

  return `<!doctype html><html dir="${dir}" lang="${docLang}"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4;margin:0}
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${a.fraunces}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${a.frauncesSemi}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold}) format('truetype')}${maths ? `\n${mathCss()}` : ''}
body{background:#eef1f0;font-family:${bodyFam};color:#2b3040}
.report{width:794px;margin:0 auto;background:#fff}
/* A Latin run inside RTL prose needs BOTH properties. isolate keeps the run
   from disturbing the Urdu around it; direction:ltr keeps the run's OWN parts
   (a date's digits and its month name are separate bidi runs) from being laid
   out right-to-left by the inherited direction. */
.ltr{font-family:${bodyFamily(false)};unicode-bidi:isolate;direction:ltr}
/* One language per document — but never one FONT: a name, a term or a formula
   in the other script can appear on any page. */
.content{font-family:${bodyFam}}
.content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:${UR_LEAD}}
.content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.42}
.nm{font-family:${bodyFamily(nameRtl)};unicode-bidi:isolate;direction:${nameRtl ? 'rtl' : 'ltr'};font-weight:700;color:#fff;font-size:${nameRtl ? `${SMALL_UR}px` : 'inherit'}}
/* ── hero ───────────────────────────────────────────────────────────────── */
.hero{position:relative;overflow:hidden;background:${PALETTE.slate};padding:22px 40px 18px;color:#fff}
.hero .lattice{position:absolute;inset:0;width:100%;height:100%;z-index:0}
.hero>*:not(.lattice){position:relative;z-index:1}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.hero-mark{width:48px;height:48px;object-fit:contain;flex-shrink:0;display:block}
.eyebrow{font-size:${RTL ? `${LABEL_UR}px` : `${TYPE_FLOOR.label}px`};letter-spacing:${RTL ? '0' : '.18em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.greenPale};font-weight:700;font-family:${bodyFam}}
.hero h1{font-family:${headFam};font-size:${RTL ? round1(28 * HEAD_SCALE) : round1(30 * HEAD_SCALE)}px;line-height:${RTL ? UR_LEAD_BOLD : '1.18'};font-weight:600;margin-top:6px;max-width:580px}
.hero h1.content[dir="rtl"]{line-height:${UR_LEAD_BOLD}}
.who{margin-top:10px;font-size:${RTL ? `${BODY_UR}px` : `${TYPE_FLOOR.body}px`};color:#e2e5ea;line-height:${lh};font-family:${bodyFam}}
.who .sep{opacity:.5;margin:0 8px}
.statrow{display:flex;gap:9px;margin-top:11px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:5px 12px}
.stchip .n{font-family:${bodyFamily(false)};font-weight:700;font-size:${TYPE_STEP.name}px;direction:ltr}
.stchip .l{font-family:${bodyFam};font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};color:${PALETTE.greenPale};${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.06em}
/* ── sheet ──────────────────────────────────────────────────────────────── */
.body{padding:12px 40px 0}
.label{font-family:${bodyFam};font-size:${RTL ? `${LABEL_UR}px` : `${TYPE_FLOOR.label}px`};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.slate};opacity:.62;font-weight:700;margin-bottom:7px;break-after:avoid}
.band{display:flex;flex-direction:column;gap:10px}
.band>div{min-width:0}
/* Both reading boxes — what you taught, what this quiz checks — share the box.
   Scoped to .taught alone, the checks box (which only recolours the edge rule)
   had no padding and no edge rule, and its text sat on the box's edge. */
.band .sum{font-size:${RTL ? `${BODY_UR}px` : `${TYPE_FLOOR.body}px`};line-height:${RTL ? UR_LEAD : lh};background:${PALETTE.greenWash};border-${RTL ? 'right' : 'left'}:3px solid ${PALETTE.green};border-radius:${RTL ? '10px 4px 4px 10px' : '4px 10px 10px 4px'};padding:10px 13px}
.checks .content[dir="rtl"],.taught .content[dir="rtl"]{line-height:${UR_LEAD}}
.checks .checks-sum{background:#f6f8f7;border-${RTL ? 'right' : 'left'}-color:#C6CFCA;font-size:${RTL ? `${BODY_UR}px` : `${TYPE_FLOOR.body}px`}}
.taught .fromlesson{display:block;margin-top:6px;color:#1f7a4b;font-weight:700}
.taught .content[dir="rtl"] .fromlesson{line-height:${UR_LEAD_BOLD};margin-top:0}
.pill{display:inline-block;font-family:${bodyFamily(false)};font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};font-weight:700;color:#1f7a4b;background:${PALETTE.greenWash};border-radius:10px;padding:1px 8px;vertical-align:middle;margin-${RTL ? 'left' : 'right'}:6px;letter-spacing:.02em}
/* The Urdu level word («سمجھ») is Nastaliq: set Nastaliq-first on the objective
   line's own pitch, it stays inside its green fill instead of standing on top
   of it — and costs no height, the objective line is already that tall. */
${RTL ? `.pill{font-family:${FONTS.bodyUrdu};line-height:${UR_LEAD};padding:0 9px;letter-spacing:0}` : ''}
/* ── question cards ─────────────────────────────────────────────────────── */
.qs{margin-top:10px}
.card{background:#f6f8f7;border-radius:12px;padding:6px 12px 6px;margin-bottom:5px;page-break-inside:avoid;break-inside:avoid}
/* An Urdu card is about half again as tall as it was before its lines were
   given room, and an unbreakable card that no longer fits leaves the rest of
   the page empty — a third of every page, measured. So in Urdu a card may
   break, but only BETWEEN two options: the objective line, the question and
   its first option always travel together, and a card that continues over the
   page is still drawn as one card (each piece keeps its own rounded edge and
   padding). The class report made the same trade for the same reason. */
${RTL ? `.card{break-inside:auto;page-break-inside:auto;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.chead,.stem,.multichip{break-after:avoid;page-break-after:avoid}
.chead,.stem,.opt,.figure{break-inside:avoid;page-break-inside:avoid}` : ''}
.chead{display:flex;gap:9px;align-items:center;margin-bottom:4px}
.num{flex-shrink:0;width:31px;height:31px;transform:rotate(45deg);background:${PALETTE.slate};color:#fff;font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};font-weight:700;display:flex;align-items:center;justify-content:center;font-family:${bodyFamily(false)}}
.num span{display:block;transform:rotate(-45deg)}
.cmeta{font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};color:${PALETTE.muted};line-height:${RTL ? UR_LEAD : '1.35'};font-family:${bodyFam}}
.slo{color:${PALETTE.slate}}
.cmain{display:flex;gap:14px;align-items:flex-start}
.cbody{flex:1;min-width:0}
.figure{width:220px;flex-shrink:0;background:#fff;border:1px solid #e7ebe9;border-radius:10px;padding:8px;text-align:center;${figureTokens()}}
.figure.wide{width:auto;margin-bottom:5px;padding:5px 10px}
.figure.wide svg,.figure.wide img{max-height:100px;width:100%}
.figure svg,.figure img{max-width:100%;max-height:150px;width:auto;height:auto;display:inline-block}
/* The stem element is one div carrying BOTH classes ("stem content", dir=rtl),
   so the .content[dir=rtl] rule (0,2,0) has always outranked a bare .stem
   (0,1,0) and the RTL line-height written here has never once reached the
   page. Restated at the specificity it needs, so the number in the file is the
   number that renders. No backticks in a comment inside a template literal —
   they terminate the string (round-5 failure catalogue). */
.stem{font-family:${headFam};font-size:${RTL ? TYPE_STEP_UR.headline : TYPE_STEP.headline}px;line-height:${RTL ? UR_LEAD_BOLD : '1.3'};color:${PALETTE.ink};font-weight:600;margin-bottom:5px}
/* The stem is Bold Nastaliq, so it takes the bold pitch, and a padding that
   holds its first line's tall strokes clear of the objective line above and
   its last line's tails clear of the first option's border below. */
.stem.content[dir="rtl"]{line-height:${UR_LEAD_BOLD};padding:${em(UR_PAD_BOLD.top)} 0 ${em(UR_PAD_BOLD.bottom)}}
.multichip{margin-bottom:5px}
.opts{display:flex;flex-direction:column;gap:2px}
.opt{display:flex;align-items:center;gap:8px;font-size:${RTL ? `${BODY_UR}px` : `${TYPE_FLOOR.body}px`};padding:3px 9px;border-radius:7px;background:#fff;border:1px solid #e3e8e5}
/* An option row is a bordered box around Nastaliq. The tighter leading it
   used to be given (1.43) put the tall letters through the top border and the
   tails through the bottom one, and a wrapped option's two lines into each
   other. It takes the Urdu pitch, and a padding sized from the font's ink so
   the letters stay inside the border; the correct option is Bold, which climbs
   higher, so it takes the bold pitch and padding. */
.opt.content[dir="rtl"]{line-height:${UR_LEAD};padding:${em(UR_PAD.top)} 9px ${em(UR_PAD.bottom)}}
.opt.correct.content[dir="rtl"]{line-height:${UR_LEAD_BOLD};padding:${em(UR_PAD_BOLD.top)} 9px ${em(UR_PAD_BOLD.bottom)}}
.opt .otext{flex:1;min-width:0}
.opt.correct{background:${PALETTE.greenWash};border-color:${PALETTE.green};color:#1f5f3e;font-weight:700}
.opt .mark{display:inline-flex;align-items:center;justify-content:center;width:26px;flex-shrink:0}
/* The child's question card marks each option with a diamond carrying its
   letter. The same marker here, so "A" on paper is "A" on the phone. Drawn
   with a rotated box, never a glyph — big enough that its own letter clears
   the small-type floor (operator item 11: the teacher matches it against
   their pupil's phone, it must be readable). */
.dia2{width:25px;height:25px;position:relative;display:inline-block}
.dia2::before{content:'';position:absolute;inset:1px;background:#fff;border:1.3px solid #C6CFCA;transform:rotate(45deg);border-radius:3px}
.opt.correct .dia2::before{background:${PALETTE.green};border-color:${PALETTE.green}}
.dia2>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:${bodyFamily(false)};font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};font-weight:700;color:#7b8494;direction:ltr}
.opt.correct .dia2>span{color:#0B1A12}
.opt .tag{font-family:${bodyFamily(false)};font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};font-weight:700;letter-spacing:.08em;color:#1f7a4b;flex-shrink:0}
/* The chip's own length is controlled in WORDS (clampWords, 5), not by a
   fixed-width CSS ellipsis: at the 18px+ floor a nowrap+ellipsis chip cut
   mid-word, and on the Urdu render — a Latin option phrase isolated inside
   an RTL chip — the truncation cut from the visual left, printing "…roper
   fraction" instead of "Proper fraction…". Wrapping to a second line beats
   either failure. */
/* THE FOOTER NEVER ENDS THE DOCUMENT ALONE. The cards cannot split, so when the
   last one fitted at the foot of a page and the footer did not, the footer
   spilled onto a page carrying the NIETE mark and one line and nothing else (an
   eight-question Urdu sheet, page 4). The last card and the footer are one
   indivisible tail: when the footer does not fit, the last card comes over to
   the new page with it. A break-before:avoid on the footer alone is NOT enough
   here — measured on Chromium 148, it was ignored in this document and the
   footer still stranded. The tail carries the body's side padding, and the
   body gives up its bottom padding to it, so the gap above the last card is
   the same 5px as between any two cards. */
.tail{break-inside:avoid;page-break-inside:avoid}
.tail .qs{margin-top:0;padding:0 40px 6px}
.foot{display:flex;align-items:center;justify-content:space-between;padding:12px 40px 16px;margin-top:8px;border-top:1px solid #eaeeeb;color:#8a92a0;font-size:${RTL ? `${BODY_UR}px` : `${TYPE_FLOOR.body}px`};line-height:${lh};font-family:${bodyFam}}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:${PALETTE.slate};font-size:${RTL ? `${SMALL_UR}px` : `${TYPE_FLOOR.small}px`};font-family:${bodyFamily(false)}}
.brand .mark-img{width:22px;height:22px;object-fit:contain;display:block}
</style></head><body>
<div class="report">
  <div class="hero">
    ${latticeSvg({ id: 'niete-lattice-hero', line: PALETTE.green, opacity: 0.16 })}
    <div class="herotop">
      <div>
        <div class="eyebrow">${L(C.eyebrow)}</div>
        <h1 ${cls('')}>${topicHtml}</h1>
      </div>
      ${heroMark}
    </div>
    <div class="who">${meta}</div>
    <div class="statrow">
      <div class="stchip"><div class="n">${questions.length}</div><div class="l">${L(C.questions)}</div></div>
      <div class="stchip"><div class="n">${slos.length}</div><div class="l">${L(C.slos)}</div></div>
    </div>
  </div>
  <div class="body">
    <div class="band">
      ${taughtText ? `<div class="taught"><div class="label">${L(C.taught)}</div><div ${cls('sum')}>${taughtHtml} <span class="fromlesson">${L(esc(C.fromLesson))}</span></div></div>` : ''}
      ${checksText ? `<div class="checks"><div class="label">${L(C.checks)}</div><div ${cls('sum checks-sum')}>${bullet} ${checksHtml}</div></div>` : ''}
    </div>
    <div class="qs">${leadCards}</div>
  </div>
  <div class="tail">
    ${lastCard ? `<div class="qs">${lastCard}</div>` : ''}
    <div class="foot">
      <div class="brand">${footMark}NIETE</div>
      <div>${L(C.footer)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

module.exports = renderTranscriptQuizTeacherHtml;
