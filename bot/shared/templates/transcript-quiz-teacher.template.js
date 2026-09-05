'use strict';
/**
 * Transcript quiz — the teacher's PDF.
 *
 * What she gets alongside the forwardable link: every question, WHY it is
 * asked (the SLO it checks and how the lesson taught it), what each wrong
 * answer reveals (the misconception behind the distractor), and what the
 * child is told either way. Written for the teacher, in HER language;
 * the questions themselves are in the quiz language.
 *
 * PlayWriteReports rules: embedded Nastaliq for Urdu, dir=rtl, per-language
 * chrome, Latin runs isolated in .ltr spans. NIETE palette
 * (hero-report.template.js `niete`): slate #333748, green #47BA7D.
 * No grade is named anywhere — the teacher forwards the quiz to whichever
 * group she taught.
 */

const fs = require('fs');
const path = require('path');

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
      nieteMark: readBase64('assets/niete-mark-black-transparent.png'),
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

function renderTranscriptQuizTeacherHtml(d) {
  const a = assets();
  const {
    topic = '', teacherName = '', date = '', link = '', digest = {}, questions = [], language = 'en',
  } = d || {};
  const RTL = RTL_LANGS.has(language);
  const C = CHROME[language] || (RTL ? CHROME.ur : CHROME.en);
  const T = (s) => wrapLatin(esc(s), RTL);
  const L = (s) => wrapLatin(s, RTL);
  const slos = Array.isArray(digest.slos) ? digest.slos : [];
  const sloById = new Map(slos.map((s) => [s.id, s]));

  const sloList = slos.map((s) => `
      <li><span class="pill">${L(C.level[s.taught_level] || esc(s.taught_level || ''))}</span> ${T(s.statement)}</li>`).join('');

  const cards = questions.map((q, i) => {
    const sloId = (String(q.external_id || '').split(':')[1]) || q.slo_id || '';
    const slo = sloById.get(sloId);
    const opts = ['option_a', 'option_b', 'option_c', 'option_d'].map((k) => q[k]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const correctLetter = String(q.correct_option || 'A').split(',')[0].trim();
    const correctIdx = LETTERS.indexOf(correctLetter);
    const fb = q.option_feedback || {};
    const misc = q.distractor_misconceptions || {};
    const optionsHtml = opts.map((o, k) => `
        <div class="opt ${k === correctIdx ? 'correct' : ''}"><span class="mark">${k === correctIdx ? '✓' : '○'}</span> ${T(o)}</div>`).join('');
    const distractors = opts.map((o, k) => {
      if (k === correctIdx) return '';
      const m = misc[LETTERS[k]] || misc[String(k)] || '';
      const guidance = (fb.wrong && (fb.wrong[String(k)] ?? fb.wrong[k])) || '';
      return `
        <div class="dist">
          <div class="dist-head"><span class="lbl">${L(C.ifTheyPick)}</span> <span class="wrongpill">${T(o)}</span>${m ? ` <span class="lbl">${L(C.reveals)}</span> ${T(m)}` : ''}</div>
          ${guidance ? `<div class="hears"><span class="lbl">${L(C.childHears)}:</span> ${T(guidance)}</div>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="card">
        <div class="chead"><div class="num">${i + 1}</div>
          <div class="cmeta">${slo ? `<span class="slo">${T(slo.statement)}</span>` : ''}${slo ? ` <span class="pill">${L(C.level[slo.taught_level] || '')}</span>` : ''}</div></div>
        <div class="stem">${T(q.question_text)}</div>
        <div class="opts">${optionsHtml}</div>
        ${q.explanation ? `<div class="why"><b>${L(C.why)}:</b> ${T(q.explanation)}</div>` : ''}
        ${distractors}
        ${fb.correct ? `<div class="right"><span class="lbl">${L(C.whenRight)}:</span> ${T(fb.correct)}</div>` : ''}
      </div>`;
  }).join('');

  const examples = (digest.examples_used || []).slice(0, 8);
  const terms = (digest.key_terms || []).slice(0, 8);
  const extras = (examples.length || terms.length) ? `
    <div class="extras">
      ${examples.length ? `<div class="label">${L(C.examples)}</div><ul>${examples.map((e) => `<li>${T(e)}</li>`).join('')}</ul>` : ''}
      ${terms.length ? `<div class="label">${L(C.terms)}</div><div class="terms">${terms.map((t) => `<span class="term">${T(t.as_spoken || t.term)}</span>`).join('')}</div>` : ''}
    </div>` : '';

  const brandMarkImg = a.nieteMark ? `<img class="mark-img" src="data:image/png;base64,${a.nieteMark}" alt="NIETE">` : '';
  const headFam = RTL ? `'NastaliqUrdu',serif` : `'Fraunces',serif`;
  const bodyFam = RTL ? `'NastaliqUrdu',serif` : `'Lexend',sans-serif`;
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
.ltr{font-family:'Lexend',sans-serif;unicode-bidi:isolate;direction:ltr}
.hero{position:relative;background:#333748;padding:30px 42px 26px;color:#fff}
.eyebrow{font-size:12px;letter-spacing:${RTL ? '0' : '.18em'};${RTL ? '' : 'text-transform:uppercase;'}color:#a9e3c4;font-weight:700}
.hero h1{font-family:${headFam};font-size:${RTL ? '24px' : '27px'};line-height:${RTL ? '1.9' : '1.2'};font-weight:600;margin-top:10px;max-width:640px}
.who{margin-top:12px;font-size:14px;color:#e2e5ea;line-height:${lh}}
.who b{color:#fff}
.statrow{display:flex;gap:10px;margin-top:16px}
.stchip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16);border-radius:11px;padding:8px 14px}
.stchip .n{font-family:'Lexend';font-weight:700;font-size:19px;direction:ltr}
.stchip .l{font-size:${RTL ? '11.5px' : '10.5px'};color:#a9e3c4;${RTL ? '' : 'text-transform:uppercase;'}letter-spacing:.06em}
.body{padding:24px 42px 8px}
.label{font-size:${RTL ? '12.5px' : '11px'};letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:#333748;opacity:.6;font-weight:700;margin:14px 0 10px}
.checks ul{list-style:none}
.checks li{padding:6px 0;font-size:13.5px;line-height:${lh};border-bottom:1px solid #eaeeeb}
.pill{display:inline-block;font-family:'Lexend';font-size:10.5px;font-weight:700;color:#1f7a4b;background:#e4f5ec;border-radius:10px;padding:2px 9px;vertical-align:middle;margin-${RTL ? 'left' : 'right'}:6px}
.howto{margin-top:18px;background:#f3faf6;border:1px solid #d6efe1;border-radius:14px;padding:14px 18px;font-size:13px;line-height:${lh}}
.howto .lnk{margin-top:8px;font-family:'Lexend';font-size:12px;color:#1f7a4b;direction:ltr;text-align:${RTL ? 'right' : 'left'}}
.card{background:#f6f8f7;border-radius:14px;padding:16px 18px;margin:12px 0;page-break-inside:avoid}
.chead{display:flex;gap:10px;align-items:flex-start}
.num{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#333748;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Lexend'}
.cmeta{font-size:12px;color:#5a6272;line-height:${lh}}
.slo{color:#333748}
.stem{font-family:${headFam};font-size:${RTL ? '16px' : '16.5px'};line-height:${lh};color:#232735;font-weight:600;margin:10px 0 8px}
.opts{display:flex;flex-direction:column;gap:5px;margin:6px 0 10px}
.opt{font-size:13.5px;line-height:${lh};padding:6px 10px;border-radius:8px;background:#fff;border:1px solid #e3e8e5}
.opt.correct{background:#e4f5ec;border-color:#47BA7D;color:#1f5f3e;font-weight:700}
.opt .mark{display:inline-block;width:18px;font-family:'Lexend';color:#47BA7D}
.why{font-size:12.5px;line-height:${lh};background:#fff;border-radius:8px;padding:8px 10px;margin-top:6px}
.dist{margin-top:8px;font-size:12.5px;line-height:${lh}}
.dist-head{color:#5a6272}
.lbl{color:#6a7284}
.wrongpill{background:#fff4d6;color:#9a6b00;font-weight:700;padding:2px 9px;border-radius:10px}
.hears{margin-top:3px;padding-${RTL ? 'right' : 'left'}:10px;border-${RTL ? 'right' : 'left'}:3px solid #e3e8e5;color:#374151}
.right{margin-top:8px;font-size:12.5px;line-height:${lh};padding-${RTL ? 'right' : 'left'}:10px;border-${RTL ? 'right' : 'left'}:3px solid #47BA7D;color:#1f5f3e}
.extras{margin-top:16px;font-size:12.5px;line-height:${lh}}
.extras ul{padding-${RTL ? 'right' : 'left'}:18px}
.terms{display:flex;flex-wrap:wrap;gap:6px}
.term{background:#eceef2;color:#333748;border-radius:10px;padding:2px 10px;font-size:12px}
.foot{display:flex;align-items:center;justify-content:space-between;padding:20px 42px 28px;margin-top:20px;border-top:1px solid #eaeeeb;color:#8a92a0;font-size:12px;line-height:${lh}}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#333748;font-size:14px;font-family:'Lexend'}
.brand .mark-img{width:20px;height:20px;object-fit:contain;display:block}
</style></head><body>
<div class="report">
  <div class="hero">
    <div class="eyebrow">${L(C.eyebrow)}</div>
    <h1>${T(topic)}</h1>
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
    <div class="brand">${brandMarkImg}NIETE</div>
    <div>${L(C.footer)}</div>
  </div>
</div>
</body></html>`;
}

module.exports = renderTranscriptQuizTeacherHtml;
