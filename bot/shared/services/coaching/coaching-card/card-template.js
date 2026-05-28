/**
 * Coaching Commitment Card — HTML template.
 *
 * Builds the HTML the Playwright engine (htmlToImage) screenshots into the
 * WhatsApp card PNG. Replaces the old node-canvas render.
 *
 * Design: navy gradient band with the white Rumi mark + her commitment;
 * a light action box with one lesson-rooted action; navy Rumi mark in the
 * footer. Variable height (crops to .card).
 *
 * Language-aware:
 *   - en/sw  → LTR, Lexend (brand font, same as reports)
 *   - ur     → RTL, Noto Nastaliq Urdu, very tall line-height
 *   - ar     → RTL, Noto Naskh Arabic, moderate line-height
 *   - RTL: English pedagogical terms are wrapped in a Latin-font span; the
 *     browser's native bidi orders contiguous Latin LTR (do NOT isolate).
 *   - RTL highlights are colour-only (a background span breaks the script flow).
 *
 * Fonts + logo are base64-embedded (no network dependency at render time);
 * `document.fonts.ready` in htmlToImage waits for them.
 */

const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', '..', '..', 'fonts');
const ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'assets');

function b64(p) {
  try { return fs.readFileSync(p).toString('base64'); } catch { return ''; }
}

let _fonts;
function fonts() {
  if (_fonts) return _fonts;
  _fonts = {
    lexendRegular: b64(path.join(FONT_DIR, 'Lexend-Regular.ttf')),
    lexendBold: b64(path.join(FONT_DIR, 'Lexend-Bold.ttf')),
    nastaliqRegular: b64(path.join(FONT_DIR, 'NotoNastaliqUrdu-Regular.ttf')),
    nastaliqBold: b64(path.join(FONT_DIR, 'NotoNastaliqUrdu-Bold.ttf')),
    naskhRegular: b64(path.join(FONT_DIR, 'NotoNaskhArabic-Regular.ttf')),
    naskhBold: b64(path.join(FONT_DIR, 'NotoNaskhArabic-Bold.ttf')),
  };
  return _fonts;
}

let _logos;
function logos() {
  if (_logos) return _logos;
  _logos = {
    white: b64(path.join(ASSETS_DIR, 'rumi-mark-white.png')),
    navy: b64(path.join(ASSETS_DIR, 'rumi-mark-navy.png')),
  };
  return _logos;
}

const LABELS = {
  sw: { eyebrow: '🎯 Ahadi yako · Darasa lijalo', tryLabel: 'Jambo moja mahususi la kujaribu', foot: 'Kutoka kwenye tafakari yetu pamoja' },
  ur: { eyebrow: '🎯 آپ کا عہد · اگلی کلاس', tryLabel: 'آزمانے کے لیے ایک خاص بات', foot: 'ہماری مشترکہ سوچ بچار سے' },
  en: { eyebrow: '🎯 Your commitment · Next class', tryLabel: 'One specific thing to try', foot: 'From your reflection together' },
  ar: { eyebrow: '🎯 التزامك · الحصة القادمة', tryLabel: 'أمر محدد لتجربته', foot: 'من تأملنا المشترك' },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Wrap highlight phrases (verbatim) in a .hi span for emphasis. */
function highlightText(text, highlights) {
  let out = escapeHtml(text);
  for (const h of (highlights || []).filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(escapeHtml(h)), 'g'), `<span class="hi">${escapeHtml(h)}</span>`);
  }
  return out;
}

/** In RTL text, wrap runs of Latin letters in a Latin-font span (skips tag internals). */
function wrapLatinRtl(html) {
  return html
    .split(/(<[^>]+>)/)
    .map((seg) => (seg.startsWith('<') ? seg
      : seg.replace(/[A-Za-z][A-Za-z'’.-]*(?:[\s-][A-Za-z'’.-]+)*/g, (m) => `<span class="ltr">${m}</span>`)))
    .join('');
}

/**
 * @param {object} card - { commitment, action, highlights[], lesson_label }
 * @param {object} opts - { language: 'en'|'sw'|'ur'|'ar', teacherName }
 * @returns {string} full HTML document
 */
function buildCardHtml(card, opts = {}) {
  const lang = (opts.language || 'en').slice(0, 2);
  const labels = LABELS[lang] || LABELS.en;
  const teacher = escapeHtml(opts.teacherName || '');
  const nastaliq = lang === 'ur';
  const naskh = lang === 'ar';
  const rtl = nastaliq || naskh;
  const f = fonts();
  const lg = logos();

  const bodyFamily = nastaliq ? "'Noto Nastaliq Urdu', serif"
    : naskh ? "'Noto Naskh Arabic', serif" : "'Lexend', sans-serif";
  const headLH = nastaliq ? '2.5' : naskh ? '1.95' : '1.2';
  const actionLH = nastaliq ? '2.75' : naskh ? '2.1' : '1.5';

  const commitment = rtl ? wrapLatinRtl(escapeHtml(card.commitment || '')) : escapeHtml(card.commitment || '');
  const lessonLabel = rtl ? wrapLatinRtl(escapeHtml(card.lesson_label || '')) : escapeHtml(card.lesson_label || '');
  const actionHtml = (() => {
    const hl = highlightText(card.action || '', card.highlights);
    return rtl ? wrapLatinRtl(hl) : hl;
  })();
  const eyebrow = labels.eyebrow.replace('🎯', '<span class="em">🎯</span>');
  const who = [teacher, lessonLabel].filter(Boolean).join(' · ');

  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  @font-face { font-family:'Lexend'; font-weight:400; src:url(data:font/ttf;base64,${f.lexendRegular}) format('truetype'); }
  @font-face { font-family:'Lexend'; font-weight:700; src:url(data:font/ttf;base64,${f.lexendBold}) format('truetype'); }
  @font-face { font-family:'Noto Nastaliq Urdu'; font-weight:400; src:url(data:font/ttf;base64,${f.nastaliqRegular}) format('truetype'); }
  @font-face { font-family:'Noto Nastaliq Urdu'; font-weight:700; src:url(data:font/ttf;base64,${f.nastaliqBold}) format('truetype'); }
  @font-face { font-family:'Noto Naskh Arabic'; font-weight:400; src:url(data:font/ttf;base64,${f.naskhRegular}) format('truetype'); }
  @font-face { font-family:'Noto Naskh Arabic'; font-weight:700; src:url(data:font/ttf;base64,${f.naskhBold}) format('truetype'); }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:680px; font-family:${bodyFamily}; }
  .card { background:#fff; border-radius:28px; overflow:hidden; box-shadow:0 12px 48px rgba(12,26,78,.16); }
  .band { background:linear-gradient(135deg,#0c1a4e 0%,#1b2f7a 100%); color:#fff; padding:${rtl ? '34px 38px 30px' : '30px 38px 28px'}; position:relative; }
  .band .logo { position:absolute; top:28px; ${rtl ? 'left' : 'right'}:34px; width:76px; height:auto; }
  .eyebrow { font-size:${rtl ? '18px' : '14px'}; letter-spacing:${rtl ? '0' : '.14em'}; ${rtl ? 'line-height:2;' : 'text-transform:uppercase;'} color:#9db0ff; font-weight:700; margin-bottom:${rtl ? '6px' : '12px'}; }
  .eyebrow .em { font-size:${rtl ? '22px' : '17px'}; }
  .band h1 { font-weight:700; font-size:${rtl ? '27px' : '31px'}; line-height:${headLH}; max-width:${rtl ? '600px' : '560px'}; }
  .band .who { margin-top:${rtl ? '16px' : '12px'}; font-size:15px; color:#c5cffb; font-weight:500; ${rtl ? 'line-height:2;' : ''} }
  .body { padding:32px 38px 14px; }
  .label { font-size:13px; letter-spacing:${rtl ? '0' : '.1em'}; ${rtl ? 'line-height:1.9;' : 'text-transform:uppercase;'} color:#0c1a4e; font-weight:700; opacity:.55; margin-bottom:${rtl ? '6px' : '12px'}; }
  .action-box { background:#f4f7ff; border:1px solid #dde6ff; border-radius:18px; padding:${rtl ? '28px 30px' : '24px 26px'}; }
  .action { font-size:${rtl ? '21px' : '20px'}; line-height:${actionLH}; color:#1c2a52; font-weight:500; }
  .action .hi { color:#0c1a4e; font-weight:700; background:linear-gradient(transparent 62%,#ffe9a8 62%); padding:0 1px; }
  [dir=rtl] .action .hi { background:none; padding:0; color:#b07000; }
  [dir=rtl] .ltr { font-family:'Lexend', sans-serif; font-weight:600; font-size:.92em; }
  .foot { display:flex; align-items:center; justify-content:space-between; padding:20px 38px 28px; }
  .foot .brand { display:flex; align-items:center; gap:11px; font-weight:700; color:#0c1a4e; font-size:18px; font-family:'Lexend',sans-serif; }
  .foot .brand img { width:40px; height:auto; }
  .tag { font-size:13px; color:#7a86a8; font-weight:500; }
</style></head><body><div class="card">
  <div class="band">
    <img class="logo" src="data:image/png;base64,${lg.white}" alt="Rumi">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${commitment}</h1>
    ${who ? `<div class="who">${who}</div>` : ''}
  </div>
  <div class="body">
    <div class="label">${escapeHtml(labels.tryLabel)}</div>
    <div class="action-box"><div class="action">${actionHtml}</div></div>
  </div>
  <div class="foot">
    <div class="brand"><img src="data:image/png;base64,${lg.navy}" alt="Rumi">Rumi</div>
    <div class="tag">${escapeHtml(labels.foot)}</div>
  </div>
</div></body></html>`;
}

module.exports = { buildCardHtml, LABELS, highlightText, wrapLatinRtl };
