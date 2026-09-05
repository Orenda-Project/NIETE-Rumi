'use strict';
/**
 * Transcript quiz — the teacher's PDF (v2).
 *
 * What she gets alongside the forwardable link, on ONE scannable sheet of
 * three pages: what she taught, what the quiz checks, how to send it, and then
 * every question laid out the way the child will meet it — picture, stem,
 * three options with the correct one marked — each with ONE line saying which
 * moment of her lesson it came from and ONE line per wrong option saying what
 * choosing it would reveal.
 *
 * ONE LANGUAGE PER DOCUMENT (PLAN_R4 D1).
 *   Round 2 split the document in two: `language` drove the chrome (the
 *   teacher's stored preference) and `contentLanguage` drove the questions.
 *   The result was an English document with Urdu labels down its left side,
 *   which reads as a bug — "if it is in English why does it have Urdu in it".
 *   A document is now written wholly in the language the QUIZ was written in,
 *   which is the language she chose for this quiz. Both parameters stay in the
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

const fs = require('fs');
const path = require('path');
const { richNotation } = require('../services/quiz/quiz-notation');
const { PALETTE, FONTS, headFamily, bodyFamily, latticeSvg, diamondSvg, scriptOf } = require('./niete-brand');

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
 * a different "A" from the one on her pupil's phone. Required lazily and
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

const CHROME = {
  en: {
    eyebrow: 'Class quiz · ready to forward',
    grade: (g) => `Grade ${esc(g)}`,
    questions: 'questions', slos: 'learning goals',
    taught: 'What you taught', checks: 'What this quiz checks',
    level: { recall: 'recall', understand: 'understand', apply: 'apply' },
    howTo: 'How to send it',
    howToText: 'The NEXT message is for your students — forward it to the class group. Each child taps the link and answers in their own chat. Your report on what to reteach follows about 12 hours after the first child starts.',
    chosen: 'From your lesson', correct: 'correct',
    link: 'Link', footer: 'Made from your lesson recording · NIETE Teaching Assistant',
  },
  ur: {
    eyebrow: 'کلاس کوئز · forward کرنے کے لیے تیار',
    grade: (g) => `جماعت ${esc(g)}`,
    questions: 'سوالات', slos: 'سیکھنے کے مقاصد',
    taught: 'آپ نے کیا پڑھایا', checks: 'یہ کوئز کیا جانچتا ہے',
    level: { recall: 'یاد', understand: 'سمجھ', apply: 'استعمال' },
    howTo: 'بھیجنے کا طریقہ',
    howToText: 'اگلا پیغام طلبہ کے لیے ہے — اسے کلاس کے group میں forward کریں۔ ہر بچہ link پر tap کر کے اپنی chat میں جواب دے گا۔ پہلے بچے کے شروع کرنے کے تقریباً 12 گھنٹے بعد رپورٹ آ جائے گی۔',
    chosen: 'آپ کے سبق سے', correct: 'درست',
    link: 'Link', footer: 'آپ کے سبق کی ریکارڈنگ سے تیار · NIETE Teaching Assistant',
  },
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
function wrapLatin(html, rtl) {
  if (!rtl) return html;
  const run = new RegExp(`\\(?[A-Za-z0-9]${LATIN_TOKEN}*(?:[\\s\\-]${LATIN_TOKEN}+)*`, 'g');
  return html.split(/(<[^>]+>|&[a-zA-Z]+;|&#\d+;)/).map((seg) => (
    seg.startsWith('<') || (seg.startsWith('&') && seg.endsWith(';'))
  ) ? seg
    : seg.replace(run, (m) => `<span class="ltr">${m}</span>`)).join('');
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * @param {object} d
 * @param {string} [d.language] a single-language caller's language; the
 *        document language when `contentLanguage` is absent.
 * @param {string} [d.contentLanguage] the language the QUIZ was written in —
 *        the whole document is written in it (D1).
 * @param {string} [d.lessonSummary] the author call's `lesson_summary`: what
 *        she taught, in the order she taught it. Opens the document.
 * @param {string|number} [d.grade]
 * @param {Array}  [d.questions] `quiz_questions` rows. Each may carry
 *        `figureSvg` (drawn above the stem, as on the phone) and
 *        `selected_because` — directly or on `media.selected_because` — the
 *        one line saying which moment of the lesson the question tests.
 */
function renderTranscriptQuizTeacherHtml(d) {
  const a = assets();
  const {
    topic = '', teacherName = '', grade = '', date = '', link = '', digest = {}, questions = [],
    language = 'en', lessonSummary = '',
  } = d || {};
  // D1: the document is written in the quiz's language. `language` is what a
  // single-language caller passes; `contentLanguage` is what the two-argument
  // callers pass, and it wins.
  const docLang = (d && d.contentLanguage) || language;
  const RTL = RTL_LANGS.has(docLang);
  const C = CHROME[docLang] || (RTL ? CHROME.ur : CHROME.en);
  // L() only isolates, never re-escapes — a trusted chrome string may carry a
  // real <b> that must survive. K() additionally escapes and turns x^2 / H2O
  // into real super/subscripts (richNotation only adds tags, which wrapLatin
  // already skips).
  const L = (s) => wrapLatin(s, RTL);
  // Order matters: escape → isolate the Latin run → only then grow the
  // super/subscript tags inside that single isolate. Notation-first splits
  // the run across two isolates and an RTL paragraph then prints it backwards.
  const K = (s) => richNotation(wrapLatin(esc(s), RTL));
  const dir = RTL ? 'rtl' : 'ltr';
  // Kept so a block can still declare its own direction where the script
  // genuinely differs from the document's (a name, a term).
  const cls = (extra) => `class="${extra} content" dir="${dir}"`;

  const slos = Array.isArray(digest.slos) ? digest.slos : [];
  const sloById = new Map(slos.map((s) => [s.id, s]));

  const bullet = diamondSvg({ size: 8, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });
  const optMarkCorrect = diamondSvg({ size: 12, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });
  const missMark = diamondSvg({ size: 7, fill: '#B9C2CC', stroke: '#B9C2CC', width: 0 });

  const sloList = slos.map((s) => `
      <li>${bullet}<span class="pill">${L(C.level[s.taught_level] || esc(s.taught_level || ''))}</span> <span ${cls('sloline')}>${K(s.statement)}</span></li>`).join('');

  const cards = questions.map((q, i) => {
    // external_id is `tq:<quizId>:<sloId>:<n>` in production and `tq:<sloId>:<n>`
    // in the older fixtures; the SLO is the second-to-last segment either way,
    // which is the convention the report already reads it by.
    const idParts = String(q.external_id || '').split(':');
    const sloId = (idParts.length >= 2 ? idParts[idParts.length - 2] : '') || q.slo_id || '';
    const slo = sloById.get(sloId);
    // The options in the order the CHILD meets them, with the same A/B/C
    // handles the sender puts on the buttons.
    const { labels, order } = childOrder(q);
    const storedCorrect = LETTERS.indexOf(String(q.correct_option || 'A').split(',')[0].trim());
    const correctPos = order.indexOf(storedCorrect);
    const misc = q.distractor_misconceptions || {};
    // EVERY row carries its letter, correct one included: the child taps a
    // letter, so a teacher reading "the answer is the one with the tick" still
    // has to count rows to know which button that is.
    const optionsHtml = order.map((stored, pos) => `
          <div ${cls(`opt${pos === correctPos ? ' correct' : ''}`)}><span class="mark"><span class="dia2"><span>${LETTERS[pos]}</span></span></span><span class="otext">${K(labels[stored])}</span>${pos === correctPos ? `<span class="tag">${L(C.correct)}</span>` : ''}</div>`).join('');
    // One compressed line per wrong option: the option, then in eight words
    // what picking it would reveal. The child-facing feedback prose is NOT
    // here — she reads that on her phone with the child, not on paper.
    const misses = order.map((stored, pos) => {
      if (pos === correctPos) return '';
      const m = clampWords(misc[LETTERS[stored]] || misc[String(stored)] || '', 14);
      if (!m) return '';
      return `
          <div class="miss"><span ${cls('wrongpill')}>${K(labels[stored])}</span>${missMark}<span ${cls('misstext')}>${K(m)}</span></div>`;
    }).join('');
    const why = q.selected_because || (q.media && q.media.selected_because) || '';
    // The picture, when the question has one, sits beside the words and comes
    // first in reading order — the same order the child meets it in.
    const wide = q.figureSvg && figureIsWide(q.figureSvg);
    const figure = q.figureSvg ? `
        <div class="figure${wide ? ' wide' : ''}">${q.figureSvg}</div>` : '';
    return `
      <div class="card${q.figureSvg ? ' hasfig' : ''}">
        <div class="chead"><div class="num"><span>${i + 1}</span></div>
          <div class="cmeta">${slo ? `<span ${cls('slo')}>${K(slo.statement)}</span> <span class="pill">${L(C.level[slo.taught_level] || '')}</span>` : ''}</div></div>
        ${wide ? figure : ''}
        <div class="cmain">${wide ? '' : figure}
          <div class="cbody">
            <div ${cls('stem')}>${K(q.question_text)}</div>
            <div class="opts">${optionsHtml}</div>
            ${why ? `<div class="chosen"><span class="lbl">${L(C.chosen)}</span> <span ${cls('inline')}>${K(why)}</span></div>` : ''}
            ${misses}
          </div>
        </div>
      </div>`;
  }).join('');

  const heroMark = a.markOnDark ? `<img class="hero-mark" src="data:image/png;base64,${a.markOnDark}" alt="NIETE">` : '';
  const footMark = a.markOnLight ? `<img class="mark-img" src="data:image/png;base64,${a.markOnLight}" alt="NIETE">` : '';
  const headFam = headFamily(RTL);
  const bodyFam = bodyFamily(RTL);
  const lh = RTL ? '1.85' : '1.42';
  // A NAME keeps the script it was typed in, whatever the document's language.
  const nameRtl = scriptOf(teacherName) === 'ur';
  const nameHtml = teacherName
    ? `<span class="nm" dir="${nameRtl ? 'rtl' : 'ltr'}">${esc(teacherName)}</span>` : '';
  const meta = [nameHtml, grade ? L(C.grade(grade)) : '', date ? L(esc(date)) : ''].filter(Boolean).join('<span class="sep">·</span>');

  return `<!doctype html><html dir="${dir}" lang="${docLang}"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4;margin:0}
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${a.fraunces}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${a.frauncesSemi}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold}) format('truetype')}
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
.content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.85}
.content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.42}
.nm{font-family:${bodyFamily(nameRtl)};unicode-bidi:isolate;direction:${nameRtl ? 'rtl' : 'ltr'};font-weight:700;color:#fff;font-size:${nameRtl ? '15px' : 'inherit'}}
/* ── hero ───────────────────────────────────────────────────────────────── */
.hero{position:relative;overflow:hidden;background:${PALETTE.slate};padding:22px 40px 18px;color:#fff}
.hero .lattice{position:absolute;inset:0;width:100%;height:100%;z-index:0}
.hero>*:not(.lattice){position:relative;z-index:1}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.hero-mark{width:48px;height:48px;object-fit:contain;flex-shrink:0;display:block}
.eyebrow{font-size:11.5px;letter-spacing:${RTL ? '0' : '.18em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.greenPale};font-weight:700;font-family:${bodyFam}}
.hero h1{font-family:${headFam};font-size:${RTL ? '23px' : '26px'};line-height:${RTL ? '1.5' : '1.18'};font-weight:600;margin-top:6px;max-width:580px}
.who{margin-top:10px;font-size:13.5px;color:#e2e5ea;line-height:${lh};font-family:${bodyFam}}
.who .sep{opacity:.5;margin:0 8px}
.statrow{display:flex;gap:9px;margin-top:11px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:5px 12px}
.stchip .n{font-family:${bodyFamily(false)};font-weight:700;font-size:17px;direction:ltr}
.stchip .l{font-family:${bodyFam};font-size:${RTL ? '11px' : '10px'};color:${PALETTE.greenPale};${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.06em}
/* ── sheet ──────────────────────────────────────────────────────────────── */
.body{padding:14px 40px 6px}
.label{font-family:${bodyFam};font-size:${RTL ? '12px' : '10.5px'};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.slate};opacity:.62;font-weight:700;margin-bottom:7px;break-after:avoid}
.band{display:flex;gap:18px;align-items:stretch}
.band>div{flex:1 1 0;min-width:0}
.band .taught{flex:1.05 1 0}
.taught .sum{font-size:13px;line-height:${RTL ? '1.72' : lh};background:${PALETTE.greenWash};border-${RTL ? 'right' : 'left'}:3px solid ${PALETTE.green};border-radius:${RTL ? '10px 4px 4px 10px' : '4px 10px 10px 4px'};padding:10px 13px}
.checks ul{list-style:none}
.checks li{padding:3px 0;font-size:12.5px;line-height:${RTL ? '1.72' : lh};border-bottom:1px solid #eaeeeb}
.checks .content[dir="rtl"],.taught .content[dir="rtl"]{line-height:1.72}
.checks li:last-child{border-bottom:0}
.checks li .dia,.miss .dia{vertical-align:middle;margin-${RTL ? 'left' : 'right'}:7px}
.pill{display:inline-block;font-family:${bodyFamily(false)};font-size:9.5px;font-weight:700;color:#1f7a4b;background:${PALETTE.greenWash};border-radius:10px;padding:1px 8px;vertical-align:middle;margin-${RTL ? 'left' : 'right'}:6px;letter-spacing:.02em}
.howto{margin-top:11px;background:#f6f8f7;border:1px solid #e3e8e5;border-radius:12px;padding:10px 14px;font-size:11.5px;line-height:${RTL ? '1.7' : '1.38'};font-family:${bodyFam};display:flex;gap:12px;align-items:flex-start}
.howto .txt{flex:1}
.howto .lnk{margin-top:6px;font-family:${bodyFamily(false)};font-size:11px;color:#1f7a4b;direction:ltr;unicode-bidi:isolate;text-align:${RTL ? 'right' : 'left'}}
/* ── question cards ─────────────────────────────────────────────────────── */
.qs{margin-top:13px}
.card{background:#f6f8f7;border-radius:12px;padding:8px 12px 8px;margin-bottom:6px;page-break-inside:avoid;break-inside:avoid}
.chead{display:flex;gap:9px;align-items:center;margin-bottom:4px}
.num{flex-shrink:0;width:22px;height:22px;transform:rotate(45deg);background:${PALETTE.slate};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:${bodyFamily(false)}}
.num span{display:block;transform:rotate(-45deg)}
.cmeta{font-size:11px;color:${PALETTE.muted};line-height:1.35;font-family:${bodyFam}}
.slo{color:${PALETTE.slate}}
.cmain{display:flex;gap:14px;align-items:flex-start}
.cbody{flex:1;min-width:0}
.figure{width:268px;flex-shrink:0;background:#fff;border:1px solid #e7ebe9;border-radius:10px;padding:8px;text-align:center;${figureTokens()}}
.figure.wide{width:auto;margin-bottom:5px;padding:5px 10px}
.figure.wide svg,.figure.wide img{max-height:100px;width:100%}
.figure svg,.figure img{max-width:100%;max-height:190px;width:auto;height:auto;display:inline-block}
.stem{font-family:${headFam};font-size:${RTL ? '14.5px' : '15px'};line-height:${RTL ? '1.55' : '1.3'};color:${PALETTE.ink};font-weight:600;margin-bottom:5px}
.opts{display:flex;flex-direction:column;gap:2px}
.opt{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:2px 9px;border-radius:7px;background:#fff;border:1px solid #e3e8e5}
/* An option row and a caption are UI, not prose: Nastaliq's prose leading
   (1.85) over eight of these is a whole extra page. The reading blocks — the
   summary, the goals, the stems — keep it. */
.opt.content[dir="rtl"],.miss .content[dir="rtl"],.chosen .content[dir="rtl"]{line-height:1.5}
.opt .otext{flex:1;min-width:0}
.opt.correct{background:${PALETTE.greenWash};border-color:${PALETTE.green};color:#1f5f3e;font-weight:700}
.opt .mark{display:inline-flex;align-items:center;justify-content:center;width:18px;flex-shrink:0}
/* The child's question card marks each option with a diamond carrying its
   letter. The same marker here, so "A" on paper is "A" on the phone. Drawn
   with a rotated box, never a glyph. */
.dia2{width:17px;height:17px;position:relative;display:inline-block}
.dia2::before{content:'';position:absolute;inset:1px;background:#fff;border:1.3px solid #C6CFCA;transform:rotate(45deg);border-radius:3px}
.opt.correct .dia2::before{background:${PALETTE.green};border-color:${PALETTE.green}}
.dia2>span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:${bodyFamily(false)};font-size:9.5px;font-weight:700;color:#7b8494;direction:ltr}
.opt.correct .dia2>span{color:#0B1A12}
.opt .tag{font-family:${bodyFamily(false)};font-size:9px;font-weight:700;letter-spacing:.08em;color:#1f7a4b;flex-shrink:0}
.chosen{margin-top:5px;font-size:11.5px;line-height:${RTL ? '1.6' : lh};font-family:${bodyFam};color:#3d4454}
.chosen .lbl{font-family:${bodyFamily(false)};font-size:9px;font-weight:700;letter-spacing:.1em;${RTL ? '' : 'text-transform:uppercase;'}color:#166341;background:${PALETTE.greenWash};border-radius:4px;padding:2px 7px;margin-${RTL ? 'left' : 'right'}:6px;vertical-align:middle}
.miss{margin-top:2px;font-size:11px;line-height:1.5;font-family:${bodyFam};color:#6a7284;display:flex;align-items:center;gap:6px}
.wrongpill{background:#eceef2;color:${PALETTE.slateLight};font-weight:700;padding:1px 8px;border-radius:9px;flex-shrink:0;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.misstext{flex:1;min-width:0}
.foot{display:flex;align-items:center;justify-content:space-between;padding:12px 40px 16px;margin-top:8px;border-top:1px solid #eaeeeb;color:#8a92a0;font-size:11.5px;line-height:${lh};font-family:${bodyFam}}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:${PALETTE.slate};font-size:13px;font-family:${bodyFamily(false)}}
.brand .mark-img{width:19px;height:19px;object-fit:contain;display:block}
</style></head><body>
<div class="report">
  <div class="hero">
    ${latticeSvg({ id: 'niete-lattice-hero', line: PALETTE.green, opacity: 0.16 })}
    <div class="herotop">
      <div>
        <div class="eyebrow">${L(C.eyebrow)}</div>
        <h1 ${cls('')}>${K(topic)}</h1>
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
      ${lessonSummary ? `<div class="taught"><div class="label">${L(C.taught)}</div><div ${cls('sum')}>${K(lessonSummary)}</div></div>` : ''}
      ${slos.length ? `<div class="checks"><div class="label">${L(C.checks)}</div><ul>${sloList}</ul></div>` : ''}
    </div>
    <div class="howto">${footMark ? `<img class="mark-img" style="width:26px;height:26px;object-fit:contain" src="data:image/png;base64,${a.markOnLight}" alt="">` : ''}<div class="txt"><div class="label" style="margin-bottom:4px">${L(C.howTo)}</div>${L(C.howToText)}${link ? `<div class="lnk">${L(C.link)}: ${esc(link)}</div>` : ''}</div></div>
    <div class="qs">${cards}</div>
  </div>
  <div class="foot">
    <div class="brand">${footMark}NIETE</div>
    <div>${L(C.footer)}</div>
  </div>
</div>
</body></html>`;
}

module.exports = renderTranscriptQuizTeacherHtml;
