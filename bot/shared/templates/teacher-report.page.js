'use strict';
/**
 * The teacher's web quiz report — /r/<token>, opened in WhatsApp's in-app
 * browser, and its PDF.
 *
 *   renderPage({ quiz | class }, { lang, print, tab, tokens, scope, now })
 *     quiz   teacher-report.data quizReport(): who played, who has NOT played
 *            (greyed, when the quiz's one class is known), scores, every
 *            question's difficulty, the stored reteach guidance, the reminder
 *     class  teacher-report.data classReport(): grade × subject, 8 weeks, quizzes
 *   renderMessagePage({ kind: 'expired'|'missing'|'error', lang })
 *
 * NO JAVASCRIPT. Every action is a link the server answers: Export PDF, Remind
 * the class (logged, then a 302 to wa.me with the reminder), each tab, the
 * class pick, the language switch. "Copy message" is a <details> holding the
 * text. It loads fast on a slow phone and works with scripts off.
 *
 * THE PDF IS THIS PAGE. print:true hides the actions, prints the reminder as
 * text with the children's link, and embeds every font as base64 (the bot's
 * Chromium has no system fonts and no network — playwrite-reports §1). The
 * screen page embeds only Lexend (small) and points Urdu at the child page's
 * 57 KB Nastaliq subset on the same host (/wq/fonts, cached a year), because
 * the full Noto Nastaliq is 1.5 MB of base64 on every open in a slow IAB.
 *
 * Language: `lang` is the TEACHER's chrome. Content (names, stems, topic) gets
 * its direction and font from its own script (niete-brand scriptOf), so an
 * Urdu quiz in an English page still reads right to left.
 *
 * Escaping: T() for anything from the database (names, topic, stems, LLM
 * guidance) — escaped, then Latin runs isolated; L() for our own chrome —
 * isolated only, never re-escaped (playwrite-reports §4).
 */

const fs = require('fs');
const path = require('path');
const { wrapLatinRuns } = require('./latin-runs');
const { PALETTE, FONTS, TYPE_FLOOR, scriptOf, dirOf, diamondSvg } = require('./niete-brand');
// Maths in a stem or an option is inline TeX ($…$): typeset server-side, never shown raw.
const { mathHtml, mathCss, usesMath } = require('../services/quiz/quiz-math');

const RTL_LANGS = new Set(['ur']);
// The portal path of the report. Not /t: that is the training-template login link.
const REPORT_PATH = '/r';
const LATIN_TOKEN = '[A-Za-z0-9\'’".,:;!?()%/+=*$@#\\-]';
// The child page's Urdu face (OFL, subset), served by the portal beside this page.
const SCREEN_NASTALIQ_URL = '/wq/fonts/wq-nastaliq-1.woff2';

let assetCache = null;
function readBase64(rel) {
  try {
    const abs = path.join(__dirname, '..', rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch {
    return '';
  }
}
function assets() {
  if (!assetCache) {
    assetCache = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
    };
  }
  return assetCache;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function wrapLatin(html, rtl) {
  return rtl ? wrapLatinRuns(html, { token: LATIN_TOKEN }) : html;
}

const SUBJECTS = {
  science: { en: 'Science', ur: 'سائنس' },
  maths: { en: 'Maths', ur: 'ریاضی' },
  math: { en: 'Maths', ur: 'ریاضی' },
  mathematics: { en: 'Maths', ur: 'ریاضی' },
  english: { en: 'English', ur: 'انگریزی' },
  urdu: { en: 'Urdu', ur: 'اردو' },
  islamiat: { en: 'Islamiat', ur: 'اسلامیات' },
  'social studies': { en: 'Social Studies', ur: 'معاشرتی علوم' },
  social_studies: { en: 'Social Studies', ur: 'معاشرتی علوم' },
  'general knowledge': { en: 'General Knowledge', ur: 'معلومات عامہ' },
  general_knowledge: { en: 'General Knowledge', ur: 'معلومات عامہ' },
  computer: { en: 'Computer', ur: 'کمپیوٹر' },
};

// A slash command is one left-to-right atom: in Urdu prose a bare "/" would
// otherwise settle on the far side of the word ("quiz/").
const CMD = (c) => `<span class="ltr">${c}</span>`;

const SOURCES = { lp_v8: 'lp', lp612: 'lp', lp: 'lp', lp_v9: 'lp', transcript: 'coaching', video: 'video' };

/** Chrome, per language. Both complete: NIETE offers exactly en + ur. */
const CHROME = {
  en: {
    title: 'Quiz report',
    week: (d, m) => `${d} ${MONTHS_EN[m]}`,
    dateClass: 'num',
    switchTo: 'اردو', switchLang: 'ur',
    fromLp: 'From lesson plan', fromCoaching: 'From coaching', fromVideo: 'From video',
    className: (c) => `Class ${c}`,
    playedOf: (p, of) => `<b class="num">${p}</b> of <b class="num">${of}</b> played`,
    playedN: (p) => `<b class="num">${p}</b> played`,
    playedLabel: 'played',
    offList: (n) => `<span class="num">+${n}</span> not on the list`,
    average: 'Average', hardest: 'Hardest', none: '—',
    notPlayed: 'Not played yet',
    allPlayed: 'Everyone on your class list has played.',
    remind: 'Remind the class',
    remindHelp: 'Opens WhatsApp with a message for your class group. It names no child.',
    copy: 'Copy message',
    copyHint: 'Press and hold the message, choose Select all, then Copy.',
    reminderPrint: 'Message for the class group',
    ambiguousTitle: 'Which class was this for?',
    ambiguousBody: 'Children who played are below. Pick the class to see who has not played.',
    noneTitle: 'See who has not played',
    noneBody: 'Send /roster on WhatsApp to add your class list, then reopen this report to see who has not played.',
    scores: 'Scores', notOnList: 'not on list',
    listNo: (n) => `list no. <span class="num">${n}</span>`,
    provisionalTitle: 'Not on your class list',
    provisionalBody: 'These children typed their own name. Add each one to the class, or say who it really is.',
    addTo: (c) => `Add to ${c}`, thisIs: 'This is…', save: 'Save',
    noticeFailed: 'That did not save. Please try again.',
    noticeNotReady: 'This cannot be saved yet: choosing a class switches on with the next update. Your report is not affected.',
    noticeClosed: 'This quiz link has closed, so its class can no longer be changed.',
    noPlayers: 'No one has played yet. Share the quiz link with your class.',
    questions: 'Question by question',
    qRight: (n, p) => `Q${n} · ${p}% right`,
    qNone: (n) => `Q${n} · not answered yet`,
    mostChose: (o) => `Most-chosen wrong answer: ${o}`,
    reteach: 'What to reteach',
    guidanceMissing: 'Your reteach guidance arrives with the report PDF.',
    guidance: {
      muddled: 'Where they got muddled', board: 'How to reteach it tomorrow', check: 'Ask this at the end',
      secure: 'What they have secure', stretch: 'How to stretch them tomorrow',
    },
    schoolLine: (r, m, p) => `School this week: <b class="num">#${r}</b>${m > 0 ? ` (up <span class="num">${m}</span>)` : ''}${p != null ? ` · <b class="num">${p}</b> children played` : ''}`,
    exportPdf: 'Export PDF', allClasses: 'All my classes', backToQuiz: 'Back to this quiz',
    updated: (t) => `Updated ${t} · refreshes when you reopen`,
    classTitle: 'All my classes', classSub: 'Your quizzes from the last 60 days',
    cellLine: (q, p) => `<b class="num">${q}</b> ${q === 1 ? 'quiz' : 'quizzes'} · <b class="num">${p}</b> played`,
    avgShort: 'avg', noClass: 'No class',
    trend: 'Children who played, week by week',
    yourQuizzes: 'Your quizzes',
    quizLine: (p) => `<b class="num">${p}</b> played`,
    emptyClass: 'No quizzes sent in the last 60 days. Send /quiz on WhatsApp to make one.',
    expiredTitle: 'This link has expired',
    expiredBody: 'Send /quiz on WhatsApp for a fresh one.',
    missingTitle: 'We could not find this report',
    missingBody: 'Send /quiz on WhatsApp to see your quiz reports.',
    errorTitle: 'The report could not open right now',
    errorBody: 'Please try again in a little while.',
  },
  ur: {
    title: 'کوئز رپورٹ',
    week: (d, m) => `${d}/${m + 1}`,
    // An Urdu date (Urdu month between the numbers) reads right to left: no LTR isolate.
    dateClass: 'dt',
    switchTo: 'English', switchLang: 'en',
    fromLp: 'سبق کے منصوبے سے', fromCoaching: 'کوچنگ سے', fromVideo: 'ویڈیو سے',
    className: (c) => `جماعت <span class="num">${c}</span>`,
    playedOf: (p, of) => `<b class="num">${of}</b> میں سے <b class="num">${p}</b> نے کھیلا`,
    playedN: (p) => `<b class="num">${p}</b> نے کھیلا`,
    playedLabel: 'بچوں نے کھیلا',
    offList: (n) => `<span class="num">+${n}</span> فہرست سے باہر`,
    average: 'اوسط', hardest: 'سب سے مشکل', none: '—',
    notPlayed: 'ابھی نہیں کھیلا',
    allPlayed: 'کلاس کی فہرست میں سب بچوں نے کھیل لیا ہے۔',
    remind: 'کلاس کو یاد دلائیں',
    remindHelp: 'WhatsApp میں کلاس گروپ کے لیے پیغام کھلے گا۔ اس میں کسی بچے کا نام نہیں۔',
    copy: 'پیغام کاپی کریں',
    copyHint: 'پیغام کو دبا کر رکھیں، سب منتخب کریں، پھر کاپی کریں۔',
    reminderPrint: 'کلاس گروپ کے لیے پیغام',
    ambiguousTitle: 'یہ کوئز کس کلاس کے لیے تھا؟',
    ambiguousBody: 'جن بچوں نے کھیلا وہ نیچے ہیں۔ کلاس چنیں تاکہ پتا چلے کس نے ابھی نہیں کھیلا۔',
    noneTitle: 'دیکھیں کس نے ابھی نہیں کھیلا',
    noneBody: `WhatsApp پر ${CMD('/roster')} بھیج کر کلاس کی فہرست بنائیں، پھر یہ رپورٹ دوبارہ کھولیں۔`,
    scores: 'اسکور', notOnList: 'فہرست میں نہیں',
    listNo: (n) => `لسٹ نمبر <span class="num">${n}</span>`,
    provisionalTitle: 'کلاس کی فہرست میں نہیں',
    provisionalBody: 'ان بچوں نے اپنا نام خود لکھا۔ ہر ایک کو کلاس میں شامل کریں، یا بتائیں کہ یہ اصل میں کون ہے۔',
    addTo: (c) => `${c} میں شامل کریں`, thisIs: 'یہ دراصل…', save: 'محفوظ کریں',
    noticeFailed: 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
    noticeNotReady: 'ابھی محفوظ نہیں ہو سکتا: کلاس چننے کی سہولت اگلی اپ ڈیٹ کے ساتھ شروع ہوگی۔ آپ کی رپورٹ پر کوئی اثر نہیں۔',
    noticeClosed: 'اس کوئز کا لنک بند ہو چکا ہے، اس لیے اب اس کی کلاس نہیں بدلی جا سکتی۔',
    noPlayers: 'ابھی کسی نے نہیں کھیلا۔ کوئز کا لنک کلاس کو بھیجیں۔',
    questions: 'ہر سوال کا حال',
    qRight: (n, p) => `سوال <span class="num">${n}</span> · <span class="num">${p}%</span> درست`,
    qNone: (n) => `سوال <span class="num">${n}</span> · ابھی کسی نے جواب نہیں دیا`,
    mostChose: (o) => `سب سے زیادہ چنا گیا غلط جواب: ${o}`,
    reteach: 'کیا دوبارہ پڑھائیں',
    guidanceMissing: 'دوبارہ پڑھانے کی رہنمائی رپورٹ کی PDF کے ساتھ آئے گی۔',
    guidance: {
      muddled: 'بچے کہاں الجھے', board: 'کل اسے دوبارہ کیسے پڑھائیں', check: 'آخر میں یہ پوچھیں',
      secure: 'بچوں کو یہ پکا آ گیا', stretch: 'کل انہیں ایک قدم آگے کیسے لے جائیں',
    },
    schoolLine: (r, m, p) => `اس ہفتے اسکول کا نمبر: <b class="num">${r}</b>${m > 0 ? ` (<span class="num">${m}</span> درجے اوپر)` : ''}${p != null ? ` · <b class="num">${p}</b> بچوں نے کھیلا` : ''}`,
    exportPdf: 'PDF ڈاؤن لوڈ', allClasses: 'میری سب کلاسیں', backToQuiz: 'اس کوئز پر واپس',
    updated: (t) => `تازہ ترین: <span class="num">${t}</span> · دوبارہ کھولنے پر نئی معلومات`,
    classTitle: 'میری سب کلاسیں', classSub: 'پچھلے <span class="num">60</span> دن کے کوئز',
    cellLine: (q, p) => `<b class="num">${q}</b> کوئز · <b class="num">${p}</b> نے کھیلا`,
    avgShort: 'اوسط', noClass: 'کلاس معلوم نہیں',
    trend: 'ہر ہفتے کتنے بچوں نے کھیلا',
    yourQuizzes: 'آپ کے کوئز',
    quizLine: (p) => `<b class="num">${p}</b> نے کھیلا`,
    emptyClass: `پچھلے 60 دن میں کوئی کوئز نہیں بھیجا گیا۔ نیا بنانے کے لیے WhatsApp پر ${CMD('/quiz')} بھیجیں۔`,
    expiredTitle: 'اس لنک کی مدت ختم ہو گئی ہے',
    expiredBody: `نئے لنک کے لیے WhatsApp پر ${CMD('/quiz')} بھیجیں۔`,
    missingTitle: 'یہ رپورٹ نہیں ملی',
    missingBody: `اپنی کوئز رپورٹس دیکھنے کے لیے WhatsApp پر ${CMD('/quiz')} بھیجیں۔`,
    errorTitle: 'رپورٹ ابھی نہیں کھل سکی',
    errorBody: 'تھوڑی دیر بعد دوبارہ کوشش کریں۔',
  },
};

const MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PKT_MS = 5 * 3600 * 1000;

function pkt(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t + PKT_MS) : null;
}
function dateLabel(iso, lang, { year = false } = {}) {
  const d = pkt(iso);
  if (!d) return '';
  // Latin digits like every other number on the page (and the PDF); the date reads right
  // to left like the words around it, so it is never put in a left-to-right isolate.
  if (lang === 'ur') return `${d.getUTCDate()} ${MONTHS_UR[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
  return `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}
/** A week's column label: "28 Sep"; in Urdu the month name is too wide for eight columns, so "28/9". */
function weekLabel(iso, lang) {
  const d = pkt(iso);
  if (!d) return '';
  return (CHROME[lang] || CHROME.en).week(d.getUTCDate(), d.getUTCMonth());
}
function timeLabel(ms) {
  const d = pkt(ms);
  if (!d) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function band(p) {
  if (p == null) return 'none';
  if (p < 50) return 'red';
  if (p < 80) return 'amber';
  return 'green';
}

/** The list number of a child row (data core: roll; identity v2: number). */
const listNumber = (k) => (k && k.number != null ? k.number : k && k.roll);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const qs = (pairs) => {
  const s = pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&amp;');
  return s ? `?${s}` : '';
};

/** Fonts + the whole stylesheet. Variables carry the screen/print and LTR/RTL differences. */
function styles({ rtl, print, needUrdu, extraCss = '' }) {
  const a = assets();
  const P = PALETTE;
  const fonts = [
    `@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend}) format('truetype')}`,
    `@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${a.lexendBold}) format('truetype')}`,
  ];
  if (print) {
    if (needUrdu) {
      fonts.push(`@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq}) format('truetype')}`);
      fonts.push(`@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold}) format('truetype')}`);
    }
  } else {
    // unicode-range: a page with no Urdu on it never downloads the face.
    fonts.push(`@font-face{font-family:'NastaliqUrdu';src:url(${SCREEN_NASTALIQ_URL}) format('woff2');font-display:swap;size-adjust:155%;unicode-range:U+0600-06FF,U+00A0,U+200C-200F,U+2066-2069,U+25CC}`);
  }
  // Nastaliq stacks its letters diagonally: Urdu prose needs far more leading
  // than Latin, and Noto's line box (the PDF) more than the screen subset.
  const leadUr = print ? 2.3 : 1.9;
  const body = rtl ? FONTS.bodyUrdu : FONTS.bodyLatin;
  return `${fonts.join('\n')}
:root{--ink:${P.ink};--muted:${P.muted};--slate:${P.slate};--green:${P.green};--green-deep:${P.greenDeep};--wash:${P.greenWash};
--paper:#F6F7F9;--card:#FFFFFF;--line:#E3E6EC;--grey:#9AA1AE;--grey-bg:#EEF0F3;--red:#D9534F;--amber:#E8A33D;
--lead:${rtl ? leadUr : 1.45};--lead-ui:${rtl ? 1.6 : 1.3};--fs:${print ? TYPE_FLOOR.body : 16}px}
*{box-sizing:border-box}
html{font-size:var(--fs);-webkit-text-size-adjust:100%}
body{margin:0;background:${print ? '#FFFFFF' : 'var(--paper)'};color:var(--ink);font-family:${body};line-height:var(--lead)${rtl ? ';word-spacing:.12em' : ''}}
a{color:inherit}
.ltr,.num{direction:ltr;unicode-bidi:isolate;font-family:${FONTS.bodyLatin};word-spacing:normal}
.c-rtl{font-family:${FONTS.bodyUrdu};line-height:${leadUr}}
.c-ltr{font-family:${FONTS.bodyLatin}}
.wrap{max-width:760px;margin:0 auto;padding:0 16px 32px}
header.top{background:var(--slate);color:#fff;padding:18px 16px 22px}
header.top .in{max-width:760px;margin:0 auto}
.brand{display:flex;align-items:center;gap:8px;font-size:.8rem;color:${P.greenPale};margin-bottom:10px;line-height:var(--lead-ui)}
.brand .sp{flex:1}
.brand a{color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 12px;font-size:.85rem}
h1{font-size:1.5rem;line-height:${rtl ? leadUr : 1.25};margin:0 0 6px;font-weight:700}
.sub{font-size:.9rem;color:#D7DAE2;line-height:var(--lead-ui)}
.chip-src{display:inline-block;margin-top:10px;background:rgba(71,186,125,.18);color:${P.greenPale};border-radius:999px;padding:2px 12px;font-size:.8rem;line-height:var(--lead-ui)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:-14px 0 16px}
.tile{background:var(--card);border-radius:14px;padding:12px 8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.tile .k{font-size:.75rem;color:var(--muted);line-height:var(--lead-ui)}
.tile .v{font-size:1.35rem;font-weight:700;line-height:1.2;margin-top:4px}
.ring{width:58px;height:58px;border-radius:50%;margin:0 auto 4px;display:grid;place-items:center;background:conic-gradient(var(--green) calc(var(--p)*1%),var(--grey-bg) 0)}
.ring i{width:44px;height:44px;border-radius:50%;background:var(--card);display:grid;place-items:center;font-style:normal;font-weight:700;font-size:.85rem}
.tile .t{font-size:.78rem;line-height:var(--lead-ui)}
.tile .t b{font-size:.95rem}
section.card{background:var(--card);border-radius:14px;padding:16px;margin:0 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h2{font-size:1.05rem;margin:0 0 10px;line-height:var(--lead-ui)}
.muted{color:var(--muted)}
.small{font-size:.85rem}
.np{list-style:none;padding:0;margin:0 0 14px;display:flex;flex-wrap:wrap;gap:6px}
.np-chip{background:var(--grey-bg);color:#6B7280;border-radius:999px;padding:3px 12px;font-size:.9rem;line-height:var(--lead-ui);display:inline-flex;gap:6px;align-items:center}
.np-chip .roll{color:var(--grey);font-size:.78rem}
.btn{display:block;text-align:center;text-decoration:none;border-radius:12px;padding:12px 14px;font-weight:700;line-height:var(--lead-ui);margin-top:8px}
.btn-primary{background:var(--green);color:#fff}
.btn-ghost{border:1.5px solid var(--line);color:var(--ink);background:var(--card)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
details{margin-top:8px}
details summary{list-style:none;cursor:pointer;display:block;text-align:center;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;font-weight:700;line-height:var(--lead-ui)}
details summary::-webkit-details-marker{display:none}
details textarea{width:100%;min-height:120px;margin-top:8px;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-size:.9rem;line-height:var(--lead);resize:vertical;background:var(--paper)}
.hint{font-size:.78rem;color:var(--muted);margin-top:6px;line-height:var(--lead-ui)}
.classes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.classes button{font:inherit;cursor:pointer;background:var(--card);border:1.5px solid var(--green);color:var(--green-deep);border-radius:999px;padding:6px 16px;font-weight:700}
.sc{list-style:none;margin:0;padding:0}
.sc li{display:grid;grid-template-columns:minmax(0,1fr) 34% auto;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.sc li:last-child{border-bottom:0}
.sc .nm{min-width:0;overflow:hidden;white-space:nowrap;line-height:var(--lead-ui);display:flex;align-items:center;gap:6px}
.sc .nm>span:first-child{overflow:hidden;text-overflow:ellipsis}
.sc .roll{color:var(--grey);font-size:.78rem;flex:none}
.tag{display:inline-block;flex:none;font-size:.7rem;background:#FFF4E0;color:#9A6200;border-radius:999px;padding:0 8px;margin-inline-start:6px;line-height:1.6}
.bar{height:8px;background:var(--grey-bg);border-radius:999px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:999px;background:var(--green)}
.band-red .bar i{background:var(--red)}.band-amber .bar i{background:var(--amber)}.band-green .bar i{background:var(--green)}
.sc .s{font-weight:700;font-size:.9rem}
.qs{list-style:none;margin:0;padding:0}
.qs li{padding:10px 0;border-bottom:1px solid var(--line)}
.qs li:last-child{border-bottom:0}
.qh{display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:.9rem;line-height:var(--lead-ui);margin-bottom:6px}
.band-red .qh .pc{color:var(--red)}.band-amber .qh .pc{color:#B7791F}.band-green .qh .pc{color:var(--green-deep)}.band-none .qh .pc{color:var(--grey)}
.stem{margin-top:6px;font-size:.95rem;${print ? '' : 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;'}}
.wrong{margin-top:4px;font-size:.82rem;color:var(--muted)}
.g{border-inline-start:4px solid var(--green);padding:2px 12px;margin:0 0 12px}
.g .gk{font-size:.8rem;font-weight:700;color:var(--green-deep);line-height:var(--lead-ui)}
.foot{margin-top:6px}
.upd{text-align:center;font-size:.78rem;color:var(--muted);margin-top:14px;line-height:var(--lead-ui)}
.cells{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cell{background:var(--wash);border-radius:12px;padding:10px 12px}
.cell .h{font-weight:700;line-height:var(--lead-ui)}
.cell .l{font-size:.8rem;color:var(--muted);line-height:var(--lead-ui)}
.cell .a{font-size:1.2rem;font-weight:700;color:var(--green-deep);line-height:1.3}
.wk{display:flex;align-items:flex-end;gap:6px;height:130px;direction:ltr}
.wk-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.wk-bar{width:100%;max-width:40px;background:var(--green);border-radius:6px 6px 0 0;min-height:3px}
.wk-col .n{font-size:.72rem;font-weight:700;line-height:1.3}
.wk-col .d{font-size:.66rem;color:var(--muted);line-height:1.3;white-space:nowrap}
.ql{list-style:none;margin:0;padding:0}
.ql a{display:flex;justify-content:space-between;gap:10px;text-decoration:none;padding:10px 0;border-bottom:1px solid var(--line);line-height:var(--lead-ui)}
.ql li:last-child a{border-bottom:0}
.ql .tp{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ql .m{font-size:.8rem;color:var(--muted);white-space:nowrap}
.msg{max-width:480px;margin:18vh auto 0;text-align:center;padding:0 16px}
.msg .dia{margin-bottom:12px}
.msg h1{color:var(--slate)}
.msg + .msg{margin-top:40px}
.pv{list-style:none;margin:0;padding:0}
.pv li{padding:10px 0;border-bottom:1px solid var(--line)}
.pv li:last-child{border-bottom:0}
.pv-h{display:flex;justify-content:space-between;gap:10px;font-weight:700;line-height:var(--lead-ui)}
.pv-a{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.pv-a form{display:flex;gap:6px;margin:0}
.pv-a button,.pv-a select{font:inherit;font-size:.85rem;border-radius:10px;border:1.5px solid var(--line);background:var(--card);padding:6px 12px;line-height:var(--lead-ui);color:var(--ink)}
.pv-a .pv-add{border-color:var(--green);color:var(--green-deep);font-weight:700}
.notice{margin:12px 0 0;background:#FDECEA;color:#8A1F1B;border-radius:12px;padding:10px 14px;line-height:var(--lead-ui)}
.reminder-print{white-space:pre-wrap;background:var(--paper);border-radius:10px;padding:10px 12px;font-size:.9rem}
@media (min-width:700px){.tiles{gap:14px}.cells{grid-template-columns:repeat(3,1fr)}}
@media print{.act{display:none!important}section.card,.tile{box-shadow:none;border:1px solid var(--line)}.sc li,.qs li,.g,.tiles,h2{break-inside:avoid}h2{break-after:avoid}}
${extraCss}
${print ? '.act{display:none!important}header.top{-webkit-print-color-adjust:exact;print-color-adjust:exact}.wrap{max-width:none;padding:0}header.top .in{max-width:none}.sc .nm{white-space:normal}' : ''}`;
}

/** The renderer's helpers for one language. */
function kit(lang) {
  const rtl = RTL_LANGS.has(lang);
  const C = CHROME[lang] || CHROME.en;
  const T = (s) => wrapLatin(esc(s), rtl);
  const L = (s) => wrapLatin(s, rtl);
  // A piece of content sets its own direction and face from its own script.
  const K = (s, tag = 'span', cls = '') => {
    const crtl = scriptOf(s) === 'ur';
    return `<${tag} class="${crtl ? 'c-rtl' : 'c-ltr'}${cls ? ` ${cls}` : ''}" dir="${crtl ? 'rtl' : 'ltr'}">${wrapLatin(esc(s), crtl)}</${tag}>`;
  };
  // The same, for question text: maths typeset by KaTeX, the prose around it escaped.
  const M = (s, tag = 'span', cls = '') => {
    const crtl = scriptOf(s) === 'ur';
    return `<${tag} class="${crtl ? 'c-rtl' : 'c-ltr'}${cls ? ` ${cls}` : ''}" dir="${crtl ? 'rtl' : 'ltr'}">${mathHtml(s, { prose: (p) => wrapLatin(esc(p), crtl) })}</${tag}>`;
  };
  return { rtl, C, T, L, K, M };
}

function subjectLabel(s, lang) {
  if (!s) return '';
  const hit = SUBJECTS[String(s).trim().toLowerCase()];
  if (hit) return hit[lang] || hit.en;
  const raw = String(s).replace(/_/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function shell({ lang, rtl, title, body, print, needUrdu, extraCss }) {
  return `<!doctype html>
<html dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${styles({ rtl, print, needUrdu, extraCss })}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function topBar({ C, L, langHref, print }) {
  return `<div class="brand">${diamondSvg({ size: 10, fill: PALETTE.green, stroke: PALETTE.green })}<span>${L(C.title)}</span><span class="sp"></span>${print ? '' : `<a class="act" href="${langHref}" lang="${C.switchLang}">${esc(C.switchTo)}</a>`}</div>`;
}

function quizSections(r, { lang, print, tokens, slots = {}, notice: noticeKind = null }) {
  const { rtl, C, T, L, K, M } = kit(lang);
  const self = encodeURIComponent(tokens.self || '');
  const base = `${REPORT_PATH}/${self}`;
  const quiz = r.quiz || {};
  const roster = r.roster || { state: 'none', lists: [] };
  const summary = r.summary || {};
  const played = Array.isArray(r.played) ? r.played : [];
  const playedN = num(summary.played) != null ? num(summary.played) : played.length;
  const of = num(summary.of);
  const avg = num(summary.avg);

  // 1. header
  const src = SOURCES[quiz.source];
  const srcLabel = src === 'lp' ? C.fromLp : src === 'coaching' ? C.fromCoaching : src === 'video' ? C.fromVideo : '';
  const bits = [];
  if (quiz.date) bits.push(`<span class="${rtl ? '' : 'num'}">${esc(dateLabel(quiz.date, lang, { year: true }))}</span>`);
  if (roster.state === 'known' && roster.className) bits.push(L(C.className(esc(roster.className))));
  else if (quiz.grade) bits.push(L(C.className(esc(quiz.grade))));
  if (quiz.subject) bits.push(T(subjectLabel(quiz.subject, lang)));
  const header = `<header class="top"><div class="in">
${topBar({ C, L, langHref: `${base}${qs([['lang', C.switchLang]])}`, print })}
${K(quiz.topic || C.title, 'h1')}
<div class="sub">${bits.join(' · ')}</div>
${srcLabel ? `<span class="chip-src">${L(esc(srcLabel))}</span>` : ''}
</div></header>`;

  const NOTICE_KEYS = { failed: 'noticeFailed', notReady: 'noticeNotReady', closed: 'noticeClosed' };
  const notice = NOTICE_KEYS[noticeKind] && !print ? `<div class="notice" role="status">${L(C[NOTICE_KEYS[noticeKind]])}</div>` : '';

  // 2. tiles. With a known class, "N of M" counts the children ON the list only:
  // typed children and other classes' children are named separately, never out of M.
  const onListN = played.filter((p) => p.onList).length;
  const offListN = played.length - onListN;
  const ringP = of ? Math.min(100, Math.round((100 * onListN) / of)) : 0;
  const tiles = `<div class="tiles">
<div class="tile">${of ? `<div class="ring" style="--p:${ringP}"><i class="num">${ringP}%</i></div><div class="t">${L(C.playedOf(onListN, of))}</div>${offListN ? `<div class="t muted">${L(C.offList(offListN))}</div>` : ''}` : `<div class="v num">${playedN}</div><div class="k">${L(C.playedLabel)}</div>`}</div>
<div class="tile"><div class="k">${L(C.average)}</div><div class="v num">${avg != null ? `${avg}%` : esc(C.none)}</div></div>
<div class="tile"><div class="k">${L(C.hardest)}</div><div class="v num">${summary.hardestN ? `Q${num(summary.hardestN)}` : esc(C.none)}</div></div>
</div>`;

  // Reserved lines, shown only when their data is present: the school's place
  // this week (Wd's board(code).mine) and the class's reading check (M4).
  const lines = [];
  const sch = slots && slots.school;
  if (sch && num(sch.rank) != null) lines.push(L(C.schoolLine(num(sch.rank), num(sch.move), num(sch.played))));
  const rd = slots && slots.reading;
  if (rd && rd.text) lines.push(T(rd.text));
  const extra = lines.length ? `<section class="card small" id="extra">${lines.map((x) => `<div>${x}</div>`).join('')}</section>` : '';

  // 3. not played / which class / add a list — and the reminder
  const reminder = r.reminder && r.reminder.text ? r.reminder.text : '';
  const notPlayed = Array.isArray(r.notPlayed) ? r.notPlayed : null;
  const remindBlock = () => {
    if (!reminder) return '';
    if (print) return `<div class="small muted">${L(C.reminderPrint)}</div><div class="reminder-print">${K(reminder.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, ''))}</div>`;
    return `<a class="btn btn-primary act" href="${base}/remind${qs([['quiz', quiz.id]])}">${L(C.remind)}</a>
<div class="hint act">${L(C.remindHelp)}</div>
<details class="act"><summary>${L(C.copy)}</summary><textarea readonly rows="5" dir="${dirOf(reminder)}">${esc(reminder)}</textarea><div class="hint">${L(C.copyHint)}</div></details>`;
  };
  let follow = '';
  if (roster.state === 'known' && notPlayed) {
    const chips = notPlayed.map((k) => `<li class="np-chip">${K(k.first, 'span', 'nm')}${num(listNumber(k)) != null ? `<span class="roll">${L(C.listNo(num(listNumber(k))))}</span>` : ''}</li>`).join('');
    follow = `<section class="card" id="not-played"><h2>${L(C.notPlayed)} <span class="num muted">(${notPlayed.length})</span></h2>
${notPlayed.length ? `<ul class="np">${chips}</ul>${remindBlock()}` : `<p class="muted">${L(C.allPlayed)}</p>`}</section>`;
  } else if (roster.state === 'ambiguous') {
    const lists = Array.isArray(roster.lists) ? roster.lists : [];
    follow = `<section class="card" id="which-class"><h2>${L(C.ambiguousTitle)}</h2><p class="small muted">${L(C.ambiguousBody)}</p>
${print ? '' : `<form method="post" action="${base}/class" class="classes act"><input type="hidden" name="quiz" value="${esc(quiz.id)}">${lists.map((l) => `<button type="submit" name="key" value="${esc(l.key || l.id)}">${T(l.label)}</button>`).join('')}</form>`}${remindBlock()}</section>`;
  } else {
    follow = `<section class="card" id="add-list"><h2>${L(C.noneTitle)}</h2><p class="small muted">${L(C.noneBody)}</p>${remindBlock()}</section>`;
  }

  // 3b. typed children who are not on the class list: the teacher adds each one or
  // says who it really is (POST forms -> identity v2 /who/fix). Never on paper.
  const prov = Array.isArray(r.provisional) ? r.provisional : [];
  let provisional = '';
  if (prov.length) {
    const label = roster.className || '';
    const choices = (notPlayed || []).filter((k) => k.studentId);
    const rows = prov.map((pv) => {
      const who = pv.typed || pv.first || '';
      const score = `<span class="s num">${num(pv.correct) || 0}/${num(pv.total) || 0}</span>`;
      if (print) return `<li><div class="pv-h">${K(who)}${score}</div></li>`;
      const hidden = `<input type="hidden" name="quiz" value="${esc(quiz.id)}"><input type="hidden" name="ref" value="${esc(pv.sessionId)}">`;
      const add = label ? `<form method="post" action="${base}/fix">${hidden}<button type="submit" class="pv-add" name="add" value="1">${L(C.addTo(esc(label)))}</button></form>` : '';
      const pick = choices.length
        ? `<form method="post" action="${base}/fix" class="pv-pick">${hidden}<select name="studentId" aria-label="${esc(C.thisIs)}"><option value="">${esc(C.thisIs)}</option>${choices.map((k) => `<option value="${esc(k.studentId)}"${pv.suggest && pv.suggest.studentId === k.studentId ? ' selected' : ''}>${esc(k.first)}${num(listNumber(k)) != null ? ` (${num(listNumber(k))})` : ''}</option>`).join('')}</select><button type="submit">${L(C.save)}</button></form>` : '';
      return `<li><div class="pv-h">${K(who)}${score}</div><div class="pv-a act">${add}${pick}</div></li>`;
    }).join('');
    provisional = `<section class="card" id="provisional"><h2>${L(C.provisionalTitle)} <span class="num muted">(${prov.length})</span></h2><p class="small muted">${L(C.provisionalBody)}</p><ul class="pv">${rows}</ul></section>`;
  }

  // 4. scores
  const known = roster.state === 'known';
  // A child off this class list may carry another list's number: show the tag, not the number.
  const offList = (p) => known && p.onList === false;
  const rows = played.map((p) => {
    const pc = num(p.pct) || 0;
    return `<li class="band-${band(pc)}"><span class="nm">${K(p.first)}${offList(p) ? `<span class="tag">${L(C.notOnList)}</span>` : (num(listNumber(p)) != null ? `<span class="roll">${L(C.listNo(num(listNumber(p))))}</span>` : '')}</span><span class="bar"><i style="width:${Math.max(2, pc)}%"></i></span><span class="s num">${num(p.correct) || 0}/${num(p.total) || 0}</span></li>`;
  }).join('');
  const scores = `<section class="card" id="scores"><h2>${L(C.scores)}</h2>${played.length ? `<ul class="sc">${rows}</ul>` : `<p class="muted">${L(C.noPlayers)}</p>`}</section>`;

  // 5. question by question
  const qrows = (Array.isArray(r.questions) ? r.questions : []).map((q) => {
    const p = q.correctPct == null ? null : num(q.correctPct);
    const head = p == null ? C.qNone(num(q.n)) : C.qRight(num(q.n), p);
    const w = q.wrongTop && num(q.wrongTop.pct) >= 25 && p !== 100
      ? `<div class="wrong">${L(C.mostChose(`<span class="num">${esc(q.wrongTop.option)}</span>`))} ${M(q.wrongTop.text)}</div>` : '';
    return `<li class="band-${band(p)}"><div class="qh"><span class="pc">${L(head)}</span></div><div class="bar"><i style="width:${p == null ? 0 : Math.max(2, p)}%"></i></div>${M(q.text, 'div', 'stem')}${w}</li>`;
  }).join('');
  const questions = qrows ? `<section class="card" id="questions"><h2>${L(C.questions)}</h2><ul class="qs">${qrows}</ul></section>` : '';

  // 6. what to reteach
  const g = r.guidance && typeof r.guidance === 'object' ? r.guidance : null;
  const keys = g && ('secure' in g || 'stretch' in g) && !('muddled' in g) ? ['secure', 'stretch'] : ['muddled', 'board', 'check'];
  const blocks = g ? keys.filter((k) => g[k]).map((k) => `<div class="g"><div class="gk">${L(C.guidance[k])}</div>${K(g[k], 'div')}</div>`).join('') : '';
  const reteach = `<section class="card" id="reteach"><h2>${L(C.reteach)}</h2>${blocks || `<p class="muted">${L(C.guidanceMissing)}</p>`}</section>`;

  return { header, main: `${tiles}${notice}${extra}${follow}${provisional}${scores}${questions}${reteach}` };
}

/**
 * The aggregate tab. M3c's renderClassTab fragment (teacher-report-class.page.js)
 * replaces this body when that module lands — wired by whichever PR lands second.
 */
function classSections(r, { lang, print, tokens }) {
  const { C, T, L, K } = kit(lang);
  const self = encodeURIComponent(tokens.self || '');
  const base = `${REPORT_PATH}/${self}`;
  const cells = Array.isArray(r.cells) ? r.cells : [];
  const weeks = Array.isArray(r.weeks) ? r.weeks : [];
  const quizzes = Array.isArray(r.quizzes) ? r.quizzes : [];
  const header = `<header class="top"><div class="in">
${topBar({ C, L, langHref: `${base}${qs([['tab', 'class'], ['lang', C.switchLang]])}`, print })}
<h1>${L(C.classTitle)}</h1><div class="sub">${L(C.classSub)}</div>
</div></header>`;
  if (!cells.length && !quizzes.length) {
    return { header, main: `<section class="card" style="margin-top:16px"><p class="muted">${L(C.emptyClass)}</p></section>` };
  }
  const cellHtml = cells.map((c) => {
    const a = num(c.avg);
    const h = [c.grade ? C.className(esc(c.grade)) : esc(C.noClass), c.subject ? esc(subjectLabel(c.subject, lang)) : ''].filter(Boolean).join(' · ');
    return `<div class="cell"><div class="h">${L(h)}</div><div class="a num">${a != null ? `${a}%` : esc(C.none)}</div><div class="l">${L(C.cellLine(num(c.quizzes) || 0, num(c.played) || 0))}</div></div>`;
  }).join('');
  const max = Math.max(1, ...weeks.map((w) => num(w.played) || 0));
  const wk = weeks.map((w) => {
    const p = num(w.played) || 0;
    const a = num(w.avg);
    return `<div class="wk-col"><span class="n">${p}</span><span class="wk-bar" style="height:${Math.max(3, Math.round((90 * p) / max))}px"></span><span class="d num">${esc(weekLabel(w.weekStart, lang))}</span><span class="d">${a != null ? `${a}%` : ''}</span></div>`;
  }).join('');
  const qmap = tokens.quiz || {};
  const ql = quizzes.map((q) => {
    const tok = qmap[q.id];
    const a = num(q.avg);
    const inner = `<span class="tp">${K(q.topic || '—')}</span><span class="m"><span class="${C.dateClass}">${esc(dateLabel(q.date, lang))}</span> · ${L(C.quizLine(num(q.played) || 0))}${a != null ? ` · <span class="num">${a}%</span>` : ''}</span>`;
    return `<li>${tok && !print ? `<a href="${REPORT_PATH}/${encodeURIComponent(tok)}${qs([['lang', lang]])}">${inner}</a>` : `<a>${inner}</a>`}</li>`;
  }).join('');
  const main = `<section class="card" style="margin-top:16px"><div class="cells">${cellHtml}</div></section>
${weeks.length ? `<section class="card"><h2>${L(C.trend)}</h2><div class="wk">${wk}</div></section>` : ''}
${quizzes.length ? `<section class="card"><h2>${L(C.yourQuizzes)}</h2><ul class="ql">${ql}</ul></section>` : ''}`;
  return { header, main };
}

/**
 * @param {{quiz?: object, class?: object}} data
 * @param {{lang?: 'en'|'ur', print?: boolean, tab?: 'quiz'|'class', scope?: 'quiz'|'all',
 *          tokens: {self: string, quiz?: Object<string,string>}, now?: number}} opts
 * @returns {string} the whole HTML document
 */
function renderPage(data, opts = {}) {
  const lang = Object.prototype.hasOwnProperty.call(CHROME, opts.lang) ? opts.lang : 'en';
  const print = Boolean(opts.print);
  const tokens = opts.tokens || {};
  const tab = opts.tab === 'class' || !(data && data.quiz) ? 'class' : 'quiz';
  const { rtl, C, L } = kit(lang);
  const base = `${REPORT_PATH}/${encodeURIComponent(tokens.self || '')}`;
  const extraCss = '';
  const parts = tab === 'quiz'
    ? quizSections(data.quiz, { lang, print, tokens, slots: data, notice: opts.notice })
    : classSections((data && data.class) || {}, { lang, print, tokens });
  const foot = print ? '' : `<div class="foot act">
<div class="row2"><a class="btn btn-ghost" href="${base}/pdf${qs(tab === 'class' ? [['tab', 'class'], ['lang', lang]] : [['lang', lang]])}">${L(C.exportPdf)}</a>${
  tab === 'quiz'
    ? `<a class="btn btn-ghost" href="${base}${qs([['tab', 'class'], ['lang', lang]])}">${L(C.allClasses)}</a>`
    : (opts.scope === 'quiz' ? `<a class="btn btn-ghost" href="${base}${qs([['lang', lang]])}">${L(C.backToQuiz)}</a>` : '')
}</div></div>`;
  const upd = `<div class="upd">${L(C.updated(esc(timeLabel(opts.now || Date.now()))))}</div>`;
  const needUrdu = rtl || scriptOf(JSON.stringify(data || {})) === 'ur';
  const title = tab === 'quiz' ? `${(data.quiz.quiz && data.quiz.quiz.topic) || C.title} · ${C.title}` : C.classTitle;
  const css = usesMath(parts.main) ? `${extraCss}\n${mathCss()}` : extraCss;
  return shell({ lang, rtl, print, needUrdu, extraCss: css, title, body: `${parts.header}<main class="wrap">${parts.main}${foot}${upd}</main>` });
}

/**
 * Expired / not found / unavailable. With no `lang` (a bad token says nothing
 * about the teacher) it says it in both languages.
 */
function renderMessagePage({ kind = 'missing', lang = null } = {}) {
  const k = ['expired', 'missing', 'error'].includes(kind) ? kind : 'missing';
  const langs = lang === 'ur' || lang === 'en' ? [lang] : ['en', 'ur'];
  const blocks = langs.map((l) => {
    const C = CHROME[l];
    const rtl = RTL_LANGS.has(l);
    const L = (s) => wrapLatin(s, rtl);
    return `<div class="msg" dir="${rtl ? 'rtl' : 'ltr'}" lang="${l}">${diamondSvg({ size: 28, fill: PALETTE.green, stroke: PALETTE.green })}<h1>${L(C[`${k}Title`])}</h1><p class="muted">${L(C[`${k}Body`])}</p></div>`;
  }).join('');
  const first = langs[0];
  return shell({ lang: first, rtl: RTL_LANGS.has(first), print: false, needUrdu: langs.includes('ur'), title: CHROME[first][`${k}Title`], body: blocks });
}

module.exports = { renderPage, renderMessagePage, CHROME, REPORT_PATH };
