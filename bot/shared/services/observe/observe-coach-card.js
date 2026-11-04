/**
 * FEAT-053 bd-44 — the coach-feedback CARD.
 *
 * The officer's coaching feedback used to arrive as a text bubble; it now
 * arrives as a rendered card in the hero-report design language (navy header,
 * Lexend), ANCHORED ON A COACHING VALUE — Sabeena's design feedback
 * (2026-07-15): the value the officer's coaching embodied is the organising
 * header of the artefact, with the wins and the one try beneath it.
 *
 * Trust rules carried over unchanged:
 *  - the value is OPTIONAL (D36: an LLM field describing reality may be null;
 *    a null value gets the neutral title, never an invented one);
 *  - a HARMFUL debrief never gets a celebration card (harm gate — bd-30);
 *  - no numeric score ever appears on the card;
 *  - all model output is HTML-escaped before rendering.
 */

const fs = require('fs');
const path = require('path');
const { isHarmfulDebrief } = require('./observe-coach-feedback');

// bd-63: same asset discipline as the hero report — the real Rumi mark and
// base64-embedded fonts, NO network at render time. Loaded once per process.
const ASSET = (p) => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', p)).toString('base64'); }
  catch { return ''; }
};
const CARD_ASSETS = {
  logoWhite: ASSET('assets/niete-mark-ondark.png'),
  logoNavy: ASSET('assets/niete-mark-onlight.png'),
  lexR: ASSET('fonts/Lexend-Regular.ttf'),
  lexB: ASSET('fonts/Lexend-Bold.ttf'),
  nastR: ASSET('fonts/NotoNastaliqUrdu-Regular.ttf'),
  nastB: ASSET('fonts/NotoNastaliqUrdu-Bold.ttf'),
};

// The fixed value vocabulary. Small on purpose: the model picks the ONE that
// best names what the officer's coaching embodied this time — or null.
const COACH_VALUES = {
  imani: { sw: 'Imani', en: 'Trust', ur: 'بھروسہ' },
  heshima: { sw: 'Heshima', en: 'Respect', ur: 'احترام' },
  usikivu: { sw: 'Usikivu', en: 'Listening', ur: 'سماعت' },
  ukuaji: { sw: 'Ukuaji', en: 'Growth', ur: 'نشوونما' },
  ushirikiano: { sw: 'Ushirikiano', en: 'Partnership', ur: 'شراکت' },
};

function normalizeCoachValue(v) {
  if (typeof v !== 'string') return null;
  const key = v.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COACH_VALUES, key) ? key : null;
}

/**
 * bd-2453 — brand palettes, same tokenization pattern as the hero template
 * (bd-2452). `default` keeps the original Rumi navy byte-for-byte; `niete` =
 * NIETE Green #47BA7D + Navy Slate #333748 (brand book, via niete-brand
 * skill). The green tick / try-block / amber praise-accent colours are
 * semantic and stay identical across brands.
 */
const CARD_PALETTES = {
  default: {
    deep: '#0c1a4e',                       // header bg + footer wordmark
    shadow: 'rgba(12,26,78,.12)',
    eyebrow: '#9db1e8', sub: '#b9c6e6',
    praiseBg: '#f4f6fb', praiseText: '#1c2749',
    sec: '#8b97b8', winTitle: '#123a8a', winQuote: '#3f4c6e',
    lock: '#67729b',
  },
  niete: {
    deep: '#333748',
    shadow: 'rgba(51,55,72,.12)',
    eyebrow: '#a9e3c4', sub: '#c6e9d5',
    praiseBg: '#f3faf6', praiseText: '#2b3040',
    sec: '#8a92a0', winTitle: '#2f7d55', winQuote: '#3f4a5e',
    lock: '#6a7284',
  },
};

/** Celebration cards are for coaching worth celebrating — never for harm. */
function shouldRenderCard(fb) {
  return !isHarmfulDebrief(fb && fb.rubric);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The ur/en card draws its symbols as shapes. The card embeds only Lexend and Noto Nastaliq, and the worker's Chromium
 * has no system font with ★ ☆ ✓ or emoji, so a symbol printed as text came out as an empty box on sandbox. Shapes
 * need no font. Any symbol or emoji in the words themselves (a label's ✓, the model's 👏) is dropped from the image;
 * the text card keeps them (a phone has the fonts).
 */
const ICON = {
  star: (on) => `<svg data-star="${on ? 'on' : 'off'}" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.95 6.55.8-4.8 4.5 1.25 6.5L12 17.15l-5.85 3.2 1.25-6.5-4.8-4.5 6.55-.8z" fill="${on ? '#e0a21b' : '#dfe3ea'}"/></svg>`,
  tick: (color, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l4.5 4.5L19.5 6.5" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  book: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linejoin="round"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
};

// Symbols and emoji (arrows, shapes, stars, ticks, dingbats, pictographs, joiners); never Urdu, Arabic or Latin.
const PICTOGRAPH = /[\u2190-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F\u200D]/gu;
function stripPictographs(s) {
  return String(s == null ? '' : s).replace(PICTOGRAPH, '').replace(/[ \t]{2,}/g, ' ').trim();
}

function starsHtml(m) {
  return [...Array(m.done).fill(true), ...Array(m.total - m.done).fill(false)].map((on) => ICON.star(on)).join('');
}

/** The rubric's styles, only on a card that shows it (ur/en): the Swahili card's HTML stays byte-identical. */
function rubricCss(rtl) {
  return `.mk{background:#f7f8fb;border-radius:14px;padding:4px 20px 14px;margin:20px 0 4px}
.mkh{display:flex;justify-content:space-between;align-items:center;gap:12px}
.mkh .sec{margin:16px 0 12px}
.stars{display:inline-flex;align-items:center;gap:2px;font-family:'Lexend',sans-serif;font-size:20px;color:#d99a1e;white-space:nowrap}
.stars b{margin-inline-start:10px;font-size:19px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
.cell{display:flex;align-items:center;gap:10px;font-size:${rtl ? '14.5px' : '15px'};line-height:${rtl ? '2.2' : '1.6'};color:#2a3040}
.cell .dot{flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.cell.on .dot{background:#e7f3ec;color:#1d7a46}
.cell.off .dot{border:2px dashed #c4c9d4}
.cell.off{color:#6a7284}
.ok{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:${rtl ? '14.5px' : '15px'};color:#1d7a46;font-weight:700;line-height:${rtl ? '2.2' : '1.6'}}
.miss{display:flex;gap:14px;margin-bottom:14px;align-items:flex-start}
.miss .mi{flex:none;width:28px;height:28px;border-radius:50%;background:#fdf1e3;color:#b4690e;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px;margin-top:4px}
.miss .wt{font-size:${rtl ? '16.5px' : '17px'};font-weight:700;color:#7a4a12;line-height:${rtl ? '2.2' : '1.9'}}
.miss .what{font-size:${rtl ? '15px' : '15.5px'};color:#2a3040;line-height:${rtl ? '2.4' : '2'}}
.miss .why{font-size:${rtl ? '15px' : '15.5px'};color:#4a4436;line-height:${rtl ? '2.4' : '2'}}
.miss b,.try .fw b{font-weight:700}
.try .fw{border-top:1px solid #cfe6d6;margin-top:12px;padding-top:10px}
.mod{display:flex;align-items:center;gap:8px;margin:-4px 0 16px;font-size:${rtl ? '15px' : '15.5px'};color:#1d4ed8;font-weight:700;line-height:${rtl ? '2.2' : '1.8'}}
.ft .lock{display:inline-flex;align-items:center;gap:6px}
`;
}

/**
 * Card HTML — same visual family as the hero report: navy #0c1a4e header,
 * Lexend-ish system stack, soft panels. Rendered by htmlToImage (Playwright)
 * on the SQS worker, exactly like the hero report.
 */
function buildCoachCardHtml(fb, { lang = 'sw', brand } = {}) {
  const { observeStrings } = require('./observe-strings');
  const S = observeStrings(lang);
  const P = CARD_PALETTES[brand] || CARD_PALETTES.default;   // bd-2453
  const rtl = lang === 'ur';   // FEAT-093 bd-53 — Urdu renders right-to-left
  const valueKey = normalizeCoachValue(fb.value);
  const header = valueKey ? (COACH_VALUES[valueKey][lang] || COACH_VALUES[valueKey].en) : S.coach_card_title;
  const eyebrow = valueKey ? S.coach_card_value_eyebrow : S.coach_card_eyebrow;

  // The rubric (ur/en, gated on the marks label, so the Swahili card is untouched): the same marks, Respect line,
  // misses and module the text card shows (observe-coach-feedback.js), computed from the judge's booleans.
  const R = require('./observe-coach-rubric');
  const rubricOn = !!S.coach_card_marks_label;
  // ur/en: every word on the image goes through E, which drops symbols the embedded fonts cannot draw.
  const E = rubricOn ? (v) => esc(stripPictographs(v)) : esc;

  const wins = (fb.wins || []).map((w) => `
      <div class="win">
        <div class="tick">${rubricOn ? ICON.tick('#1d7a46', 15) : '✓'}</div>
        <div>
          <div class="wt">${E(w.behaviour)}</div>
          <div class="wq">“${E(w.evidence)}”</div>
        </div>
      </div>`).join('');

  const t = fb.try || {};
  const A = CARD_ASSETS;
  const m = rubricOn ? R.rubricMarks(fb.rubric) : null;
  const marksHtml = rubricOn && m.total ? `
    <div class="mk"><div class="mkh"><span class="sec">${E(S.coach_card_marks_label)}</span><span class="stars" dir="ltr">${starsHtml(m)}<b>${m.done}/${m.total}</b></span></div>
      <div class="grid">${m.marks.map((x) => `<div class="cell ${x.done ? 'on' : 'off'}" data-mark="${x.done ? 'done' : 'missed'}"><span class="dot">${x.done ? ICON.tick('#1d7a46', 14) : ''}</span><span>${E(S.coach_rubric_names[x.key])}</span></div>`).join('')}</div>
      ${m.respectHeld ? `<div class="ok">${ICON.tick('#1d7a46', 16)}<span>${E(S.coach_card_respect_line)}</span></div>` : ''}
    </div>` : '';
  // Each miss: what happened in THIS debrief (the judge's own line), then why it matters. A card judged before the
  // judge wrote those lines shows the coach's own words, labelled, under the focus miss (they used to sit, unlabelled,
  // in the focus box), and the why line for every miss.
  const missed = rubricOn ? R.missedBehaviours(fb.rubric) : [];
  const focusKey = rubricOn ? R.nextFocusKey(fb) : null;
  const whatOf = (k) => {
    const said = fb.missed && fb.missed[k];
    if (said) return `<div class="what"><b>${E(S.coach_card_what_happened_label)}</b> ${E(said)}</div>`;
    if (k === focusKey && t.evidence) return `<div class="what"><b>${E(S.coach_card_you_said_label)}</b> “${E(t.evidence)}”</div>`;
    return '';
  };
  const missedHtml = missed.length ? `
    <div class="sec">${E(S.coach_card_missed_label)}</div>
    ${missed.map((k) => `<div class="miss"><div class="mi">!</div><div><div class="wt">${E(S.coach_rubric_names[k])}</div>${whatOf(k)}<div class="why"><b>${E(S.coach_card_why_label)}</b> ${E(S.coach_rubric_why[k])}</div></div></div>`).join('')}` : '';
  const mod = rubricOn ? R.focusModule(fb) : null;
  const moduleHtml = mod ? `
    <div class="mod">${ICON.book}<span>${E(R.moduleLine(mod, S, S.coach_card_module_lang))}</span></div>` : '';
  // The one next focus and why it was chosen. No second behaviour: the old Action plan box is gone (ur/en).
  const rubricTryHtml = `
    <div class="try">
      <div class="tl">${E(S.coach_card_try_label)}</div>
      <h2>${E(t.move || '')}</h2>
      ${fb.focus_why ? `<p class="fw"><b>${E(S.coach_card_focus_why_label)}</b> ${E(fb.focus_why)}</p>` : ''}
    </div>`;
  // bd-63 (operator escalation): the old header hand-drew the smile as an
  // absolutely-positioned SVG at right:36px — in RTL that is exactly where
  // the eyebrow text begins, so the two collided into a garble. And with no
  // embedded fonts, Urdu fell back to an italic serif that was hard to read.
  // Now: the REAL Rumi mark (same asset as the hero report), flex layout
  // (nothing absolute — RTL-safe by construction), and the hero report's
  // font discipline (Lexend for Latin; bd-64: embedded NotoNastaliqUrdu
  // for ALL Urdu — operator directive: Nastaliq on every Urdu artifact —
  // with hanging-script sizing: bigger line-heights, slightly smaller display).
  // bd-2644: Nastaliq leads the stack for an Urdu card (RTL prose), but it is
  // ALSO a permanent fallback below Lexend for every other card — the model
  // routinely writes Urdu prose while the strings pack is English, and Lexend
  // carries no Urdu glyphs, so gating the face on the pack printed a coach's
  // whole card as tofu boxes. Latin still resolves to Lexend first.
  const urFont = rtl ? `'NastaliqUrdu',` : '';
  return `<!doctype html><html${rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><style>
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${A.lexR})}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${A.lexB})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${A.nastR})}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${A.nastB})}
*{margin:0;padding:0;box-sizing:border-box;font-family:${urFont}'Lexend','NastaliqUrdu','Segoe UI',-apple-system,sans-serif}
.card{width:760px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px ${P.shadow}}
.hd{background:${P.deep};color:#fff;padding:30px 38px 28px}
.hd .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.hd .top img{width:64px;height:auto;display:block}
.hd .eb{font-size:13px;letter-spacing:${rtl ? '0' : '.16em'};${rtl ? '' : 'text-transform:uppercase;'}color:${P.eyebrow};font-weight:700;line-height:1.8}
.hd h1{font-size:${rtl ? '36px' : '44px'};font-weight:700;line-height:${rtl ? '2' : '1.6'};letter-spacing:0}
.hd .sub{font-size:16px;color:${P.sub};margin-top:6px;line-height:${rtl ? '2.3' : '1.9'}}
.bd{padding:26px 38px 6px}
.praise{background:${P.praiseBg};border-${rtl ? 'right' : 'left'}:4px solid #f2a65a;border-radius:10px;padding:16px 20px;font-size:${rtl ? '16.5px' : '17.5px'};line-height:${rtl ? '2.4' : '2'};color:${P.praiseText}}
.sec{font-size:13px;color:${P.sec};font-weight:700;margin:26px 0 14px;letter-spacing:${rtl ? '0' : '.14em'};${rtl ? '' : 'text-transform:uppercase;'}}
.win{display:flex;gap:14px;margin-bottom:18px;align-items:flex-start}
.win .tick{flex:none;width:28px;height:28px;border-radius:50%;background:#e7f3ec;color:#1d7a46;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px;margin-top:4px}
.win .wt{font-size:${rtl ? '16.5px' : '17.5px'};font-weight:700;color:${P.winTitle};line-height:${rtl ? '2.2' : '1.9'}}
.win .wq{font-size:${rtl ? '15px' : '15.5px'};color:${P.winQuote};margin-top:6px;line-height:${rtl ? '2.4' : '2'};background:#fafbfd;border-radius:8px;padding:10px 14px}
.try{background:#eef7f0;border-radius:14px;padding:20px 22px;margin:8px 0 16px}
/* bd-y7jr8 — the action plan and the one question, so the image says exactly
   what the text card says (a coach should never meet two different shapes). */
.act{background:#f6f8fb;border-radius:14px;padding:16px 22px;margin:6px 0 16px}
.act p{font-size:${rtl ? '15px' : '15.5px'};color:#2a3b4d;line-height:${rtl ? '2.4' : '2'}}
.ask{border-left:4px solid #F5B301;padding:10px 0 10px 16px;margin:6px 0 20px}
.ask p{font-size:${rtl ? '15px' : '15.5px'};color:#4a4436;font-style:italic;line-height:${rtl ? '2.4' : '2'}}
.try .tl{font-size:13px;color:#1d7a46;font-weight:700;letter-spacing:${rtl ? '0' : '.14em'};${rtl ? '' : 'text-transform:uppercase;'}}
.try h2{font-size:${rtl ? '19px' : '22px'};color:#14532d;font-weight:700;margin:8px 0 6px;line-height:${rtl ? '2.3' : '1.9'}}
.try p{font-size:${rtl ? '15px' : '15.5px'};color:#2f4a3a;line-height:${rtl ? '2.4' : '2'};margin-top:6px}
${rubricOn ? rubricCss(rtl) : ''}.ft{border-top:1px solid #e7ebf4;padding:16px 38px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.ft .brand{display:flex;align-items:center;gap:9px}
.ft .brand img{width:30px;height:auto}
.ft .brand span{font-weight:700;color:${P.deep};font-size:16px;font-family:'Lexend',sans-serif}
.ft .lock{font-size:14px;color:${P.lock};line-height:${rtl ? '2.2' : '1.9'}}
</style></head><body><div class="card">
  <div class="hd">
    <div class="top">
      <img src="data:image/png;base64,${A.logoWhite}" alt=""/>
      <div class="eb">${E(eyebrow)}</div>
    </div>
    <h1>${E(header)}</h1>
    <div class="sub">${E(S.coach_card_subtitle)}</div>
  </div>
  <div class="bd">
    <div class="praise">${E(fb.praise_line || '')}</div>${marksHtml}
    <div class="sec">${E(S.coach_card_wins_label)}</div>
    ${wins}${missedHtml}${rubricOn ? rubricTryHtml : `
    <div class="try">
      <div class="tl">${esc(S.coach_card_try_label)}</div>
      <h2>${esc(t.move || '')}</h2>
      <p>${esc(t.evidence || '')}</p>
      ${S.coach_card_action_label ? '' : `<p><b>${esc(t.instead || '')}</b></p>`}
    </div>`}
    ${!rubricOn && S.coach_card_action_label && t.instead ? `<div class="sec">${esc(S.coach_card_action_label)}</div>
    <div class="act"><p>${esc(t.instead)}</p></div>` : ''}${moduleHtml}
    ${S.coach_card_reflect_label && fb.reflection_question ? `<div class="sec">${E(S.coach_card_reflect_label)}</div>
    <div class="ask"><p>${E(fb.reflection_question)}</p></div>` : ''}
  </div>
  <div class="ft">
    <div class="brand"><img src="data:image/png;base64,${A.logoNavy}" alt=""/><span>NIETE</span></div>
    <span class="lock">${rubricOn ? `${ICON.lock}<span>${E(S.coach_card_closing)}</span>` : `🔒 ${esc(S.coach_card_closing)}`}</span>
  </div>
</div></body></html>`;
}

/**
 * Render the card PNG. Returns null (never throws) when the card should not
 * or cannot be rendered — the caller falls back to the text card, so a
 * Playwright hiccup can never cost an officer their feedback.
 */
async function renderCoachCard(fb, { lang = 'sw', brand } = {}) {
  if (!shouldRenderCard(fb)) return null;
  try {
    const { htmlToImage } = require('../../utils/html-to-pdf');
    const html = buildCoachCardHtml(fb, { lang, brand });
    return await htmlToImage(html, { selector: '.card', width: 800, deviceScaleFactor: 2 });
  } catch (err) {
    const { logToFile } = require('../../utils/logger');
    logToFile('⚠️ coach card render failed — falling back to text card', { error: err.message });
    return null;
  }
}

module.exports = {
  COACH_VALUES, normalizeCoachValue, shouldRenderCard, buildCoachCardHtml, renderCoachCard, stripPictographs,
};
