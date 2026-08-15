'use strict';
/**
 * Video-quiz class report — bd-2335, redesigned bd-2473, i18n foundation
 * ported from the main bot (bd-2664/bd-2679) — NIETE's copy was still the
 * English-only v1 layout: no Nastaliq font, no RTL, no per-language chrome.
 *
 * The teacher's copy of "how did my class do, and what do I do about it".
 * v2 (bd-2473) adopts the coaching hero-report visual system (navy hero,
 * Fraunces/Lexend, jewel-tone cards, gold accents — see the main bot's
 * shared/services/coaching/report-v2/hero-report.template.js) instead of the
 * v1 flat white layout, so the report family reads as one product.
 *
 * The ordering is still the argument, unchanged from v1: what to reteach
 * comes FIRST, above the roster. A report that opens with a ranked list of
 * children invites her to read it as a league table; one that opens with
 * "these three questions, this wrong answer, here is why" invites her to
 * change tomorrow's lesson. Scores are underneath, because she does still
 * need them.
 *
 * language ('en' default; 'ur' fully localised chrome + RTL — NIETE is flat
 * en/ur, root CLAUDE.md language-protocol, unlike the main bot's 5-market
 * region-keyed offer with pa-PK/sd-PK approximation branches).
 *
 * Function signature is UNCHANGED except for the new optional `language`
 * key — video-quiz-report.service.js's call site adds one field, nothing
 * else moves.
 */

const fs = require('fs');
const path = require('path');
const { stripEmphasis, classLabel } = require('../utils/text-format');

let _assets = null;

function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch { return ''; }
}

function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      fraunces: readBase64('fonts/Fraunces-Regular.ttf'),
      frauncesSemi: readBase64('fonts/Fraunces-SemiBold.ttf'),
      // Same asset the main bot's hero-report.template.js embeds. Without
      // this @font-face, Urdu/Perso-Arabic text has no glyphs to fall back
      // to and Chromium renders empty tofu boxes.
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      // NIETE branding (2026-08-04): black-on-transparent N/ن monogram from
      // the niete-brand skill, for the light-background footer lockup.
      nieteMark: readBase64('assets/niete-mark-black-transparent.png'),
    };
  }
  return _assets;
}

/**
 * Deliberately does NOT escape quote characters. Every T()/L() call site in
 * this file interpolates into element TEXT CONTENT, never an HTML attribute
 * value (checked every call site) — a literal `'`/`"` is markup-safe there.
 * Escaping them to &#39;/&quot; used to actively cause a bug on the main bot
 * (bd-2679): wrapLatin()'s tag/entity pre-split pulls any HTML entity out as
 * its own opaque, unwrappable segment, so an escaped apostrophe tore an
 * English contraction/possessive ("cat's", "don't") into two separate
 * isolated .ltr spans with a bare entity between them, mid-word. Building
 * this port already in the fixed shape, skipping the intermediate bug.
 * `<`/`>`/`&` stay escaped — those ARE markup-significant in text content.
 */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** RTL (Perso-Arabic-script) quiz languages this report ships for. NIETE is
 *  flat en/ur — no pa-PK/sd-PK concept here. */
const RTL_LANGS = new Set(['ur']);

/** Chrome strings per language. */
const CHROME = {
  en: {
    eyebrow: 'Class quiz results',
    forTeacher: (n) => `For <b>${esc(n)}</b>`,
    classResults: 'Class results',
    gradeLine: (g) => ` &middot; Grade ${esc(g)}`,
    classAverage: 'Class average',
    started: 'Started', finished: 'Finished', worthReteaching: 'Worth reteaching',
    worthReteachingHeading: 'Worth reteaching &mdash; most missed',
    gotWrong: (n, t) => `${n} of ${t} got this wrong`,
    mostChose: 'Most chose', correctAnswer: 'correct answer',
    explanation: 'Explanation:',
    howEachStudentDid: 'How each student did',
    notFinishedYet: 'Not finished yet:',
    forTomorrow: 'For tomorrow',
  },
  ur: {
    eyebrow: 'کلاس کوئز کے نتائج',
    forTeacher: (n) => `${esc(n)} <b>کے لیے</b>`,
    classResults: 'کلاس کے نتائج',
    gradeLine: (g) => ` &middot; جماعت ${esc(g)}`,
    classAverage: 'کلاس اوسط',
    started: 'شروع کیا', finished: 'مکمل کیا', worthReteaching: 'دوبارہ پڑھانا',
    worthReteachingHeading: 'دوبارہ پڑھانے کے قابل &mdash; سب سے زیادہ غلط',
    gotWrong: (n, t) => `${t} میں سے ${n} نے غلط جواب دیا`,
    mostChose: 'زیادہ تر نے چنا', correctAnswer: 'درست جواب',
    explanation: 'وضاحت:',
    howEachStudentDid: 'ہر طالب علم کی کارکردگی',
    notFinishedYet: 'ابھی مکمل نہیں کیا:',
    forTomorrow: 'کل کے لیے',
  },
};

/**
 * Wrap Latin-script runs in an explicit LTR span so mixed Urdu+English text
 * doesn't get visually scrambled by the browser's bidi algorithm — same
 * technique as the main bot's hero-report.template.js's wrapLatin(),
 * including the split-on-tags-and-entities-FIRST fix (a naive regex replace
 * can land inside a tag attribute or split a real entity like `&amp;` into
 * `&<span>amp</span>;`). No-ops for LTR reports.
 *
 * The run-detection class includes ASCII digits and common punctuation/
 * symbols (`,` `:` `;` `?` `!` `(` `)` `%` `/` `+` `=` `*` `$` `@` `#` `"`) —
 * built already in this shape rather than the main bot's original narrower
 * class, which excluded them and fragmented English clauses inside RTL text
 * into several separate isolated spans with bare, un-isolated characters
 * between them (bd-2679 on the main bot: isolation only preserves order
 * WITHIN a span — the browser's bidi algorithm still reorders adjacent
 * isolated islands per the surrounding dir="rtl" paragraph, scrambling
 * clause order even though no individual span's own text was corrupted).
 * This codebase's genuine Urdu punctuation uses distinct Arabic-block
 * characters (۔ ، ؟), never these ASCII ones, so the wide class doesn't risk
 * swallowing real Urdu text. Quotes are includable because esc() (above) no
 * longer entity-escapes them.
 */
function wrapLatin(html, rtl) {
  if (!rtl) return html;
  return html.split(/(<[^>]+>|&[a-zA-Z]+;|&#\d+;)/).map((seg) => (
    seg.startsWith('<') || (seg.startsWith('&') && seg.endsWith(';'))
  ) ? seg
    : seg.replace(/[A-Za-z0-9][A-Za-z0-9'’".,:;!?()%/+=*$@#\-]*(?:[\s\-][A-Za-z0-9'’".,:;!?()%/+=*$@#\-]+)*/g, (m) => `<span class="ltr">${m}</span>`)).join('');
}

/** Progress-bar band, matching the coaching hero-report's domain-bar palette. */
function band(pct) {
  if (pct >= 80) return 'band-strong';
  if (pct >= 60) return 'band-mid';
  return 'band-low';
}

function renderVideoQuizReportHtml(d) {
  const a = assets();
  const {
    topic = 'Video quiz', teacherName = '', grade = '',
    started = 0, finished = 0, average = 0,
    students = [], hardest = [], guidance = null, unfinished = [],
    generatedAt = '', language = 'en',
  } = d || {};

  const RTL = RTL_LANGS.has(language);
  const C = CHROME[language] || (RTL ? CHROME.ur : CHROME.en);
  // T() = untrusted content (escape THEN isolate Latin runs). L() = trusted,
  // developer-authored chrome HTML that may already contain real tags/entities
  // (&mdash;, <b>) — those must NOT be re-escaped, only Latin-isolated.
  const T = (s) => wrapLatin(esc(s), RTL);
  const L = (s) => wrapLatin(s, RTL);

  const missedCards = hardest.map((h, i) => {
    const chose = h.top_wrong_text ? `
      <div class="chose"><span class="lbl">${L(C.mostChose)}</span>
        <span class="wrongpill">${T(h.top_wrong_text)}</span>
        <span class="arrow">${RTL ? '&larr;' : '&rarr;'}</span>
        <span class="lbl">${L(C.correctAnswer)}</span>
        <span class="rightpill">${T(h.correct_text || '')}</span></div>` : '';
    const why = h.misconception ? `
      <div class="why"><b>${L(C.explanation)}</b> ${T(h.misconception)}</div>` : '';
    return `
      <div class="moment">
        <div class="mhead"><div class="num">${i + 1}</div><div class="m-q">${T(h.question_text)}</div></div>
        <div class="mstat">${L(C.gotWrong(h.wrong, h.total))}</div>
        ${chose}${why}
      </div>`;
  }).join('');

  const rosterRows = students.map((s) => {
    const pct = s.mastery_percentage || 0;
    return `
      <div class="r-row">
        <div class="r-name">${T(s.student_name || 'Unnamed')}<div class="cls">${T(classLabel(s.student_class))}</div></div>
        <div class="pbar"><div class="pfill ${band(pct)}" style="width:${pct}%"></div></div>
        <div class="r-score">${s.correct_answers || 0}/${s.total_questions_answered || 0} &middot; ${pct}%</div>
      </div>`;
  }).join('');

  const brandMarkImg = a.nieteMark
    ? `<img class="mark" src="data:image/png;base64,${a.nieteMark}" alt="NIETE">` : '';

  const notFinished = unfinished.length ? `
    <div class="unfin"><b>${L(C.notFinishedYet)}</b> ${T(unfinished.join(RTL ? '، ' : ', '))}</div>` : '';

  const guidanceBlock = guidance ? `
    <div class="try">
      <div class="label">${L(C.forTomorrow)}</div>
      <div class="try-text">${T(stripEmphasis(guidance))}</div>
    </div>` : '';

  const headFam = RTL ? `'NastaliqUrdu',serif` : `'Fraunces',serif`;
  const bodyFam = RTL ? `'NastaliqUrdu',serif` : `'Lexend',sans-serif`;
  const dir = RTL ? 'rtl' : 'ltr';

  return `<!doctype html><html dir="${dir}" lang="${language}"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${a.fraunces}) format('truetype')}
@font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${a.frauncesSemi}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq}) format('truetype')}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold}) format('truetype')}
body{background:#eef1f7;font-family:${bodyFam}}
.report{width:794px;margin:0 auto;background:#fff;color:#1c2438}
/* Latin runs isolated inside RTL text (proper nouns, stray English words)
   render in their own script + direction, matching hero-report. */
/* unicode-bidi:isolate alone does NOT force LTR — it only isolates the run
   from surrounding context, then still resolves direction from the
   INHERITED direction property, which under html dir=rtl is rtl. A
   multi-run string like a date ("13 Aug 2026" — digits/letters are separate
   bidi runs) then visually reorders (observed on the main bot: "Aug 2026
   13"). direction:ltr forces the isolate's own base direction, independent
   of the RTL ancestor. */
.ltr{font-family:'Lexend',sans-serif;font-weight:600;unicode-bidi:isolate;direction:ltr}

.hero{position:relative;min-height:230px;overflow:hidden;background:#0c1a4e;padding:30px 42px 26px}
.hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,26,78,.5),rgba(12,26,78,.45) 45%,rgba(12,26,78,.92))}
.hero>*{position:relative;z-index:1}
.eyebrow{font-size:12px;letter-spacing:${RTL ? '0' : '.2em'};${RTL ? '' : 'text-transform:uppercase;'}color:#9db0ff;font-weight:700}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px}
.hero h1{font-family:${headFam};font-size:${RTL ? '24px' : '26px'};line-height:${RTL ? '1.9' : '1.2'};font-weight:600;color:#fff;max-width:490px}
.hscore{text-align:${RTL ? 'left' : 'right'};flex-shrink:0;margin-${RTL ? 'right' : 'left'}:20px}
.hscore .p{font-family:'Lexend';font-weight:700;font-size:46px;color:#fff;letter-spacing:-.02em;line-height:1;direction:ltr}
.hscore .s{font-family:${RTL ? bodyFam : `'Lexend'`};font-size:11.5px;color:#bcc8ff;margin-top:5px;letter-spacing:.05em;${RTL ? '' : 'text-transform:uppercase;'}}
.who{margin-top:16px;font-size:14px;color:#dfe5ff;${RTL ? 'line-height:2;' : ''}}
.who b{color:#fff}
.statrow{display:flex;gap:10px;margin-top:18px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:9px 14px}
.stchip .n{font-family:'Lexend';font-weight:700;font-size:19px;color:#fff;direction:ltr}
.stchip .l{font-family:${RTL ? bodyFam : `'Lexend'`};font-size:${RTL ? '11.5px' : '10.5px'};color:#9db0ff;${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.08em;margin-top:1px}

.body{padding:26px 42px 6px}
.label{font-size:${RTL ? '12.5px' : '11px'};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:#0c1a4e;opacity:.55;font-weight:700;margin-bottom:14px}

.moment{background:#f7f9ff;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.mhead{display:flex;gap:10px;align-items:flex-start}
.num{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:#0c1a4e;color:#fff;font-size:12px;font-weight:700;
     display:flex;align-items:center;justify-content:center;font-family:'Lexend'}
.m-q{font-family:${headFam};font-size:16px;line-height:${RTL ? '1.9' : '1.4'};color:#26304d;font-weight:600}
.mstat{font-size:12px;color:#6a748f;margin:8px 34px 10px}
.chose{margin:0 34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.lbl{color:#6a748f}
.wrongpill{background:#fff4d6;color:#9a6b00;font-weight:700;padding:3px 10px;border-radius:12px}
.rightpill{background:#e2f6ea;color:#0f7a3d;font-weight:700;padding:3px 10px;border-radius:12px}
.arrow{color:#b7bfd6}
.why{margin:8px 34px 0;font-size:12px;line-height:${RTL ? '1.9' : '1.5'};color:#374151;background:#fff;border-radius:8px;padding:8px 10px}

.roster{margin-top:22px}
.r-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #eef0f6}
.r-row:last-child{border-bottom:none}
.r-name{width:190px;font-size:13.5px;font-weight:600;color:#26304d}
.r-name .cls{font-weight:400;color:#8a93ad;font-size:11.5px}
.pbar{flex:1;height:8px;border-radius:5px;background:#e7ebf3;overflow:hidden}
.pfill{height:100%;border-radius:5px}
.r-score{width:110px;text-align:${RTL ? 'left' : 'right'};font-family:'Lexend';font-weight:700;font-size:13px;color:#0c1a4e;direction:ltr}
.band-strong{background:#3aa775}.band-mid{background:#e0a52e}.band-low{background:#dd7a5c}

.unfin{margin-top:16px;background:#faf9f7;border:1px dashed #e2e0d8;border-radius:10px;padding:12px 16px;font-size:12.5px;color:#7a7360;line-height:${RTL ? '1.9' : 'normal'}}
.unfin b{color:#4a4636}

.try{margin:24px 42px 0;background:linear-gradient(135deg,#0c1a4e,#1b2f7a);color:#fff;border-radius:16px;padding:20px 24px}
.try .label{color:#9db0ff;opacity:1;margin-bottom:7px}
.try-text{font-family:${headFam};font-size:16.5px;line-height:${RTL ? '1.9' : '1.5'}}

.foot{display:flex;align-items:center;justify-content:space-between;padding:20px 42px 28px;margin-top:20px;border-top:1px solid #eef0f6;color:#8a93ad;font-size:12px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#0c1a4e;font-size:14px;font-family:'Lexend'}
.brand .mark{width:20px;height:20px;object-fit:contain;display:block}
</style></head><body>
<div class="report">

  <div class="hero">
    <div class="eyebrow">${L(C.eyebrow)}</div>
    <div class="herotop">
      <h1>${T(topic)}</h1>
      <div class="hscore"><div class="p">${average}%</div><div class="s">${L(C.classAverage)}</div></div>
    </div>
    <div class="who">${teacherName ? L(C.forTeacher(teacherName)) : L(C.classResults)}${grade ? L(C.gradeLine(grade)) : ''}</div>
    <div class="statrow">
      <div class="stchip"><div class="n">${started}</div><div class="l">${L(C.started)}</div></div>
      <div class="stchip"><div class="n">${finished}</div><div class="l">${L(C.finished)}</div></div>
      <div class="stchip"><div class="n">${hardest.length}</div><div class="l">${L(C.worthReteaching)}</div></div>
    </div>
  </div>

  <div class="body">
    ${hardest.length ? `<div class="label">${L(C.worthReteachingHeading)}</div>${missedCards}` : ''}

    ${students.length ? `<div class="roster">
      <div class="label">${L(C.howEachStudentDid)}</div>
      ${rosterRows}
    </div>` : ''}

    ${notFinished}
  </div>

  ${guidanceBlock}

  <div class="foot">
    <div class="brand">${brandMarkImg}NIETE</div>
    <div class="ltr" style="font-family:'Lexend',sans-serif">${esc(generatedAt)}</div>
  </div>

</div>
</body></html>`;
}

module.exports = renderVideoQuizReportHtml;
