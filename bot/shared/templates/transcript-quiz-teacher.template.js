'use strict';
/**
 * Transcript quiz — the teacher's PDF.
 *
 * What she gets alongside the forwardable link: every question, WHY it is
 * asked (the SLO it checks and how the lesson taught it), what each wrong
 * answer reveals (the misconception behind the distractor), and what the
 * child is told either way.
 *
 * TWO LANGUAGES, ALWAYS.
 *   `language`        — the teacher's own interface language. Titles, labels,
 *                       instructions: the document's chrome.
 *   `contentLanguage` — the language the QUIZ was written in. Stems, options,
 *                       explanations, the goals, the terms, the topic.
 * They are frequently different — a teacher who reads English can perfectly
 * well have taught an Urdu-medium lesson, and the quiz follows the lesson, not
 * her menu. Keying the whole document on the teacher's language put Urdu
 * content on a Latin-only face, which the render container draws as empty
 * boxes (a desktop hides this by substituting a system font). So every
 * font-family names BOTH families, and every block of quiz content is wrapped
 * in `.content` carrying its own `dir` and its own font order.
 *
 * PlayWriteReports rules otherwise as before: fonts embedded as base64,
 * Latin runs inside Urdu isolated with both `unicode-bidi:isolate` AND
 * `direction:ltr`, numbers and links forced LTR.
 *
 * Brand: NIETE (niete-brand skill) — navy-slate ground, green accent, the
 * on-dark monogram, the diamond lattice at whisper density behind the hero,
 * the book's audience lockup, diamond markers. No other product's palette.
 *
 * No grade is named anywhere — the teacher forwards the quiz to whichever
 * group she taught.
 */

const fs = require('fs');
const path = require('path');
const { PALETTE, FONTS, headFamily, bodyFamily, latticeSvg, diamondSvg, lockup } = require('./niete-brand');

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

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const RTL_LANGS = new Set(['ur']);

const CHROME = {
  en: {
    eyebrow: 'Class quiz · ready to forward',
    lockup: 'FOR TEACHERS',
    forTeacher: (n) => `For <b>${esc(n)}</b>`,
    lessonOf: (d) => `Lesson of ${esc(d)}`,
    questions: 'questions', slos: 'learning goals', checks: 'What this quiz checks',
    level: { recall: 'recall', understand: 'understand', apply: 'apply' },
    howTo: 'How to send it',
    howToText: 'The message after this PDF is for your students. Forward it to the class WhatsApp group — each child taps the link and takes the quiz in their own chat. You get a report on what to reteach about 12 hours after the first child starts, or as soon as everyone finishes.',
    question: 'Question', why: 'Why this question', ifTheyPick: 'If they pick', reveals: 'it usually means',
    childHears: 'the child is told', whenRight: 'When they get it right', correct: 'correct',
    examples: 'Lesson examples the questions draw on', terms: 'Terms as spoken in class',
    link: 'Link', footer: 'Made from your lesson recording · NIETE Teaching Assistant',
  },
  ur: {
    eyebrow: 'کلاس کوئز · forward کرنے کے لیے تیار',
    lockup: 'اساتذہ کے لیے',
    forTeacher: (n) => `${esc(n)} <b>کے لیے</b>`,
    lessonOf: (d) => `${esc(d)} کا سبق`,
    questions: 'سوالات', slos: 'سیکھنے کے مقاصد', checks: 'یہ کوئز کیا جانچتا ہے',
    level: { recall: 'یاد', understand: 'سمجھ', apply: 'استعمال' },
    howTo: 'بھیجنے کا طریقہ',
    howToText: 'اس PDF کے بعد والا پیغام طلبہ کے لیے ہے۔ اسے کلاس کے WhatsApp group میں forward کریں — ہر بچہ link پر tap کر کے اپنی chat میں کوئز حل کرے گا۔ پہلے بچے کے شروع کرنے کے تقریباً 12 گھنٹے بعد، یا سب کے مکمل کرتے ہی، آپ کو رپورٹ ملے گی کہ کیا دوبارہ پڑھانا ہے۔',
    question: 'سوال', why: 'یہ سوال کیوں', ifTheyPick: 'اگر بچہ چنے', reveals: 'تو عموماً مطلب',
    childHears: 'بچے کو بتایا جائے گا', whenRight: 'صحیح جواب پر', correct: 'درست',
    examples: 'سبق کی مثالیں جن پر سوال بنے', terms: 'کلاس میں بولی گئی اصطلاحات',
    link: 'Link', footer: 'آپ کے سبق کی ریکارڈنگ سے تیار · NIETE Teaching Assistant',
  },
};

function wrapLatin(html, rtl) {
  if (!rtl) return html;
  return html.split(/(<[^>]+>|&[a-zA-Z]+;|&#\d+;)/).map((seg) => (
    seg.startsWith('<') || (seg.startsWith('&') && seg.endsWith(';'))
  ) ? seg
    : seg.replace(/[A-Za-z0-9][A-Za-z0-9'’".,:;!?()%/+=*$@#\-]*(?:[\s\-][A-Za-z0-9'’".,:;!?()%/+=*$@#\-]+)*/g, (m) => `<span class="ltr">${m}</span>`)).join('');
}

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * @param {object} d
 * @param {string} [d.language] the teacher's interface language (chrome)
 * @param {string} [d.contentLanguage] the language the quiz is written in;
 *        defaults to the chrome language so an existing single-language caller
 *        keeps its exact behaviour.
 * @param {Array}  [d.questions] each may carry `figureSvg`, an SVG string
 *        rendered above the stem — the same order the child meets it in.
 */
function renderTranscriptQuizTeacherHtml(d) {
  const a = assets();
  const {
    topic = '', teacherName = '', date = '', link = '', digest = {}, questions = [], language = 'en',
  } = d || {};
  const contentLanguage = (d && d.contentLanguage) || language;
  const RTL = RTL_LANGS.has(language);          // chrome
  const CRTL = RTL_LANGS.has(contentLanguage);  // quiz content
  const C = CHROME[language] || (RTL ? CHROME.ur : CHROME.en);
  // Chrome helper: L() only isolates, never re-escapes — a trusted chrome
  // string may carry a real <b> that must survive.
  const L = (s) => wrapLatin(s, RTL);
  // Content helpers — isolation follows the CONTENT's direction, not the
  // teacher's. An English word inside an Urdu stem still needs isolating even
  // when the surrounding document is English.
  const K = (s) => wrapLatin(esc(s), CRTL);
  const cdir = CRTL ? 'rtl' : 'ltr';
  /** Open a quiz-content block: its own direction and its own font order. */
  const cls = (extra) => `class="${extra} content" dir="${cdir}"`;

  const slos = Array.isArray(digest.slos) ? digest.slos : [];
  const sloById = new Map(slos.map((s) => [s.id, s]));

  const bullet = diamondSvg({ size: 8, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });
  const optMarkCorrect = diamondSvg({ size: 11, fill: PALETTE.green, stroke: PALETTE.green, width: 0 });
  const optMarkPlain = diamondSvg({ size: 11, fill: 'none', stroke: '#B9C2CC', width: 1.4 });

  const sloList = slos.map((s) => `
      <li>${bullet}<span class="pill">${L(C.level[s.taught_level] || esc(s.taught_level || ''))}</span> <span ${cls('sloline')}>${K(s.statement)}</span></li>`).join('');

  const cards = questions.map((q, i) => {
    const sloId = (String(q.external_id || '').split(':')[1]) || q.slo_id || '';
    const slo = sloById.get(sloId);
    const opts = ['option_a', 'option_b', 'option_c', 'option_d'].map((k) => q[k]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const correctLetter = String(q.correct_option || 'A').split(',')[0].trim();
    const correctIdx = LETTERS.indexOf(correctLetter);
    const fb = q.option_feedback || {};
    const misc = q.distractor_misconceptions || {};
    const optionsHtml = opts.map((o, k) => `
        <div ${cls(`opt${k === correctIdx ? ' correct' : ''}`)}><span class="mark">${k === correctIdx ? optMarkCorrect : optMarkPlain}</span> ${K(o)}${k === correctIdx ? `<span class="tag">${L(C.correct)}</span>` : ''}</div>`).join('');
    const distractors = opts.map((o, k) => {
      if (k === correctIdx) return '';
      const m = misc[LETTERS[k]] || misc[String(k)] || '';
      const guidance = (fb.wrong && (fb.wrong[String(k)] ?? fb.wrong[k])) || '';
      return `
        <div class="dist">
          <div class="dist-head"><span class="lbl">${L(C.ifTheyPick)}</span> <span ${cls('wrongpill')}>${K(o)}</span>${m ? ` <span class="lbl">${L(C.reveals)}</span> <span ${cls('inline')}>${K(m)}</span>` : ''}</div>
          ${guidance ? `<div class="hears"><span class="lbl">${L(C.childHears)}:</span> <span ${cls('inline')}>${K(guidance)}</span></div>` : ''}
        </div>`;
    }).join('');
    // The picture, when the question has one, comes before the words — the
    // same order the child meets it in on WhatsApp. `figureSvg` is authored
    // markup from the deterministic diagram engine, not user input.
    const figure = q.figureSvg ? `
        <div class="figure">${q.figureSvg}</div>` : '';
    return `
      <div class="card">
        <div class="chead"><div class="num"><span>${i + 1}</span></div>
          <div class="cmeta">${slo ? `<span ${cls('slo')}>${K(slo.statement)}</span>` : ''}${slo ? ` <span class="pill">${L(C.level[slo.taught_level] || '')}</span>` : ''}</div></div>
        ${figure}
        <div ${cls('stem')}>${K(q.question_text)}</div>
        <div class="opts">${optionsHtml}</div>
        ${q.explanation ? `<div class="why"><b>${L(C.why)}:</b> <span ${cls('whytext')}>${K(q.explanation)}</span></div>` : ''}
        ${distractors}
        ${fb.correct ? `<div class="right"><span class="lbl">${L(C.whenRight)}:</span> <span ${cls('inline')}>${K(fb.correct)}</span></div>` : ''}
      </div>`;
  }).join('');

  const examples = (digest.examples_used || []).slice(0, 8);
  const terms = (digest.key_terms || []).slice(0, 8);
  const extras = (examples.length || terms.length) ? `
    <div class="extras">
      ${examples.length ? `<div class="label">${L(C.examples)}</div><ul>${examples.map((e) => `<li>${bullet}<span ${cls('inline')}>${K(e)}</span></li>`).join('')}</ul>` : ''}
      ${terms.length ? `<div class="label">${L(C.terms)}</div><div class="terms">${terms.map((t) => `<span ${cls('term')}>${K(t.as_spoken || t.term)}</span>`).join('')}</div>` : ''}
    </div>` : '';

  const heroMark = a.markOnDark ? `<img class="hero-mark" src="data:image/png;base64,${a.markOnDark}" alt="NIETE">` : '';
  const footMark = a.markOnLight ? `<img class="mark-img" src="data:image/png;base64,${a.markOnLight}" alt="NIETE">` : '';
  const headFam = headFamily(RTL);
  const bodyFam = bodyFamily(RTL);
  const cHeadFam = headFamily(CRTL);
  const cBodyFam = bodyFamily(CRTL);
  const dir = RTL ? 'rtl' : 'ltr';
  const lh = RTL ? '1.9' : '1.45';

  return `<!doctype html><html dir="${dir}" lang="${language}"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
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
/* Every quiz-content block follows the QUIZ's language, not the teacher's. */
.content{font-family:${cBodyFam}}
.content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.9}
.content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.45}
.figure{margin:10px 0 4px;text-align:center}
.figure svg,.figure img{max-width:100%;max-height:260px;width:auto;height:auto;display:inline-block}
.hero{position:relative;overflow:hidden;background:${PALETTE.slate};padding:30px 42px 26px;color:#fff}
.hero .lattice{position:absolute;inset:0;width:100%;height:100%;z-index:0}
.hero>*:not(.lattice){position:relative;z-index:1}
.herotop{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.hero-mark{width:52px;height:52px;object-fit:contain;flex-shrink:0;display:block}
.eyebrow{font-size:12px;letter-spacing:${RTL ? '0' : '.18em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.greenPale};font-weight:700;font-family:${bodyFam}}
.lockup{display:flex;align-items:center;gap:5px;margin-top:14px;font-family:${bodyFam};font-size:${RTL ? '12px' : '10.5px'};letter-spacing:${RTL ? '0' : '.26em'};color:#dfe3ea;font-weight:700}
.lockup .nuqta{display:block}
.hero h1{font-family:${cHeadFam};font-size:${CRTL ? '24px' : '27px'};line-height:${CRTL ? '1.9' : '1.2'};font-weight:600;margin-top:10px;max-width:560px;text-align:${RTL ? 'right' : 'left'}}
.who{margin-top:12px;font-size:14px;color:#e2e5ea;line-height:${lh};font-family:${bodyFam}}
.who b{color:#fff}
.statrow{display:flex;gap:10px;margin-top:16px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:8px 14px}
.stchip .n{font-family:${bodyFamily(false)};font-weight:700;font-size:19px;direction:ltr}
.stchip .l{font-family:${bodyFam};font-size:${RTL ? '11.5px' : '10.5px'};color:${PALETTE.greenPale};${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.06em}
.body{padding:24px 42px 8px}
.label{font-family:${bodyFam};font-size:${RTL ? '12.5px' : '11px'};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:${PALETTE.slate};opacity:.6;font-weight:700;margin:14px 0 10px}
.checks ul{list-style:none}
.checks li{padding:6px 0;font-size:13.5px;line-height:${lh};border-bottom:1px solid #eaeeeb}
.checks li .dia,.extras li .dia{vertical-align:middle;margin-${RTL ? 'left' : 'right'}:8px}
.pill{display:inline-block;font-family:${bodyFamily(false)};font-size:10.5px;font-weight:700;color:#1f7a4b;background:${PALETTE.greenWash};border-radius:10px;padding:2px 9px;vertical-align:middle;margin-${RTL ? 'left' : 'right'}:6px}
.howto{margin-top:18px;background:#f3faf6;border:1px solid #d6efe1;border-radius:14px;padding:14px 18px;font-size:13px;line-height:${lh};font-family:${bodyFam}}
.howto .lnk{margin-top:8px;font-family:${bodyFamily(false)};font-size:12px;color:#1f7a4b;direction:ltr;unicode-bidi:isolate;text-align:${RTL ? 'right' : 'left'}}
.card{background:#f6f8f7;border-radius:14px;padding:16px 18px;margin:12px 0;page-break-inside:avoid}
.chead{display:flex;gap:10px;align-items:flex-start}
.num{flex-shrink:0;width:26px;height:26px;transform:rotate(45deg);background:${PALETTE.slate};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:${bodyFamily(false)}}
.num span{display:block;transform:rotate(-45deg)}
.cmeta{font-size:12px;color:${PALETTE.muted};line-height:${lh};font-family:${bodyFam}}
.slo{color:${PALETTE.slate}}
.stem{font-family:${cHeadFam};font-size:${CRTL ? '16px' : '16.5px'};line-height:${CRTL ? '1.9' : '1.45'};color:${PALETTE.ink};font-weight:600;margin:10px 0 8px}
.opts{display:flex;flex-direction:column;gap:5px;margin:6px 0 10px}
.opt{font-size:13.5px;padding:6px 10px;border-radius:8px;background:#fff;border:1px solid #e3e8e5}
.opt.correct{background:${PALETTE.greenWash};border-color:${PALETTE.green};color:#1f5f3e;font-weight:700}
.opt .mark{display:inline-block;width:18px;vertical-align:middle}
.opt .tag{font-family:${bodyFamily(false)};font-size:10px;font-weight:700;letter-spacing:.08em;color:#1f7a4b;margin-${RTL ? 'right' : 'left'}:8px;vertical-align:middle}
.why{font-size:12.5px;line-height:${lh};font-family:${bodyFam};background:#fff;border-radius:8px;padding:8px 10px;margin-top:6px}
.dist{margin-top:8px;font-size:12.5px;line-height:${lh};font-family:${bodyFam}}
.dist-head{color:${PALETTE.muted}}
.lbl{color:#6a7284;font-family:${bodyFam}}
.wrongpill{display:inline-block;background:#eceef2;color:${PALETTE.slateLight};font-weight:700;padding:2px 9px;border-radius:10px}
.hears{margin-top:3px;padding-${RTL ? 'right' : 'left'}:10px;border-${RTL ? 'right' : 'left'}:3px solid #e3e8e5;color:#374151}
.right{margin-top:8px;font-size:12.5px;line-height:${lh};font-family:${bodyFam};padding-${RTL ? 'right' : 'left'}:10px;border-${RTL ? 'right' : 'left'}:3px solid ${PALETTE.green};color:#1f5f3e}
.extras{margin-top:16px;font-size:12.5px;line-height:${lh};font-family:${bodyFam}}
.extras ul{list-style:none}
.extras li{padding:3px 0}
.terms{display:flex;flex-wrap:wrap;gap:6px}
.term{background:#eceef2;color:${PALETTE.slate};border-radius:10px;padding:2px 10px;font-size:12px}
.foot{display:flex;align-items:center;justify-content:space-between;padding:20px 42px 28px;margin-top:20px;border-top:1px solid #eaeeeb;color:#8a92a0;font-size:12px;line-height:${lh};font-family:${bodyFam}}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:${PALETTE.slate};font-size:14px;font-family:${bodyFamily(false)}}
.brand .mark-img{width:20px;height:20px;object-fit:contain;display:block}
</style></head><body>
<div class="report">
  <div class="hero">
    ${latticeSvg({ id: 'niete-lattice-hero', line: PALETTE.green, opacity: 0.16 })}
    <div class="herotop">
      <div>
        <div class="eyebrow">${L(C.eyebrow)}</div>
        <h1 class="content" dir="${cdir}">${K(topic)}</h1>
      </div>
      ${heroMark}
    </div>
    ${lockup(L(C.lockup))}
    <div class="who">${teacherName ? L(C.forTeacher(teacherName)) : ''}${teacherName && date ? ' &middot; ' : ''}${date ? L(C.lessonOf(date)) : ''}</div>
    <div class="statrow">
      <div class="stchip"><div class="n">${questions.length}</div><div class="l">${L(C.questions)}</div></div>
      <div class="stchip"><div class="n">${slos.length}</div><div class="l">${L(C.slos)}</div></div>
    </div>
  </div>
  <div class="body">
    ${slos.length ? `<div class="checks"><div class="label">${L(C.checks)}</div><ul>${sloList}</ul></div>` : ''}
    <div class="howto"><div class="label" style="margin-top:0">${L(C.howTo)}</div>${L(C.howToText)}${link ? `<div class="lnk">${L(C.link)}: ${esc(link)}</div>` : ''}</div>
    ${cards}
    ${extras}
  </div>
  <div class="foot">
    <div class="brand">${footMark}NIETE</div>
    <div>${L(C.footer)}</div>
  </div>
</div>
</body></html>`;
}

module.exports = renderTranscriptQuizTeacherHtml;
