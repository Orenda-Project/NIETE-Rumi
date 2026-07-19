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
  logoWhite: ASSET('assets/rumi-mark-white.png'),
  logoNavy: ASSET('assets/rumi-mark-navy.png'),
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
 * Card HTML — same visual family as the hero report: navy #0c1a4e header,
 * Lexend-ish system stack, soft panels. Rendered by htmlToImage (Playwright)
 * on the SQS worker, exactly like the hero report.
 */
function buildCoachCardHtml(fb, { lang = 'sw' } = {}) {
  const { observeStrings } = require('./observe-strings');
  const S = observeStrings(lang);
  const rtl = lang === 'ur';   // FEAT-093 bd-53 — Urdu renders right-to-left
  const valueKey = normalizeCoachValue(fb.value);
  const header = valueKey ? (COACH_VALUES[valueKey][lang] || COACH_VALUES[valueKey].en) : S.coach_card_title;
  const eyebrow = valueKey ? S.coach_card_value_eyebrow : S.coach_card_eyebrow;

  const wins = (fb.wins || []).map((w) => `
      <div class="win">
        <div class="tick">✓</div>
        <div>
          <div class="wt">${esc(w.behaviour)}</div>
          <div class="wq">“${esc(w.evidence)}”</div>
        </div>
      </div>`).join('');

  const t = fb.try || {};
  const A = CARD_ASSETS;
  // bd-63 (operator escalation): the old header hand-drew the smile as an
  // absolutely-positioned SVG at right:36px — in RTL that is exactly where
  // the eyebrow text begins, so the two collided into a garble. And with no
  // embedded fonts, Urdu fell back to an italic serif that was hard to read.
  // Now: the REAL Rumi mark (same asset as the hero report), flex layout
  // (nothing absolute — RTL-safe by construction), and the hero report's
  // font discipline (Lexend for Latin; bd-64: embedded NotoNastaliqUrdu
  // for ALL Urdu — operator directive: Nastaliq on every Urdu artifact —
  // with hanging-script sizing: bigger line-heights, slightly smaller display).
  const urFont = rtl ? `'NastaliqUrdu',` : '';
  return `<!doctype html><html${rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><style>
@font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${A.lexR})}
@font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${A.lexB})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${A.nastR})}
@font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${A.nastB})}
*{margin:0;padding:0;box-sizing:border-box;font-family:${urFont}'Lexend','Segoe UI',-apple-system,sans-serif}
.card{width:760px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(12,26,78,.12)}
.hd{background:#0c1a4e;color:#fff;padding:30px 38px 28px}
.hd .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.hd .top img{width:64px;height:auto;display:block}
.hd .eb{font-size:13px;letter-spacing:${rtl ? '0' : '.16em'};${rtl ? '' : 'text-transform:uppercase;'}color:#9db1e8;font-weight:700;line-height:1.8}
.hd h1{font-size:${rtl ? '36px' : '44px'};font-weight:700;line-height:${rtl ? '2' : '1.6'};letter-spacing:0}
.hd .sub{font-size:16px;color:#b9c6e6;margin-top:6px;line-height:${rtl ? '2.3' : '1.9'}}
.bd{padding:26px 38px 6px}
.praise{background:#f4f6fb;border-${rtl ? 'right' : 'left'}:4px solid #f2a65a;border-radius:10px;padding:16px 20px;font-size:${rtl ? '16.5px' : '17.5px'};line-height:${rtl ? '2.4' : '2'};color:#1c2749}
.sec{font-size:13px;color:#8b97b8;font-weight:700;margin:26px 0 14px;letter-spacing:${rtl ? '0' : '.14em'};${rtl ? '' : 'text-transform:uppercase;'}}
.win{display:flex;gap:14px;margin-bottom:18px;align-items:flex-start}
.win .tick{flex:none;width:28px;height:28px;border-radius:50%;background:#e7f3ec;color:#1d7a46;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:15px;margin-top:4px}
.win .wt{font-size:${rtl ? '16.5px' : '17.5px'};font-weight:700;color:#123a8a;line-height:${rtl ? '2.2' : '1.9'}}
.win .wq{font-size:${rtl ? '15px' : '15.5px'};color:#3f4c6e;margin-top:6px;line-height:${rtl ? '2.4' : '2'};background:#fafbfd;border-radius:8px;padding:10px 14px}
.try{background:#eef7f0;border-radius:14px;padding:20px 22px;margin:8px 0 24px}
.try .tl{font-size:13px;color:#1d7a46;font-weight:700;letter-spacing:${rtl ? '0' : '.14em'};${rtl ? '' : 'text-transform:uppercase;'}}
.try h2{font-size:${rtl ? '19px' : '22px'};color:#14532d;font-weight:700;margin:8px 0 6px;line-height:${rtl ? '2.3' : '1.9'}}
.try p{font-size:${rtl ? '15px' : '15.5px'};color:#2f4a3a;line-height:${rtl ? '2.4' : '2'};margin-top:6px}
.ft{border-top:1px solid #e7ebf4;padding:16px 38px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.ft .brand{display:flex;align-items:center;gap:9px}
.ft .brand img{width:30px;height:auto}
.ft .brand span{font-weight:700;color:#0c1a4e;font-size:16px;font-family:'Lexend',sans-serif}
.ft .lock{font-size:14px;color:#67729b;line-height:${rtl ? '2.2' : '1.9'}}
</style></head><body><div class="card">
  <div class="hd">
    <div class="top">
      <img src="data:image/png;base64,${A.logoWhite}" alt=""/>
      <div class="eb">${esc(eyebrow)}</div>
    </div>
    <h1>${esc(header)}</h1>
    <div class="sub">${esc(S.coach_card_subtitle)}</div>
  </div>
  <div class="bd">
    <div class="praise">${esc(fb.praise_line || '')}</div>
    <div class="sec">${esc(S.coach_card_wins_label)}</div>
    ${wins}
    <div class="try">
      <div class="tl">${esc(S.coach_card_try_label)}</div>
      <h2>${esc(t.move || '')}</h2>
      <p>${esc(t.evidence || '')}</p>
      <p><b>${esc(t.instead || '')}</b></p>
    </div>
  </div>
  <div class="ft">
    <div class="brand"><img src="data:image/png;base64,${A.logoNavy}" alt=""/><span>Rumi</span></div>
    <span class="lock">🔒 ${esc(S.coach_card_closing)}</span>
  </div>
</div></body></html>`;
}

/**
 * Render the card PNG. Returns null (never throws) when the card should not
 * or cannot be rendered — the caller falls back to the text card, so a
 * Playwright hiccup can never cost an officer their feedback.
 */
async function renderCoachCard(fb, { lang = 'sw' } = {}) {
  if (!shouldRenderCard(fb)) return null;
  try {
    const { htmlToImage } = require('../../utils/html-to-pdf');
    const html = buildCoachCardHtml(fb, { lang });
    return await htmlToImage(html, { selector: '.card', width: 800, deviceScaleFactor: 2 });
  } catch (err) {
    const { logToFile } = require('../../utils/logger');
    logToFile('⚠️ coach card render failed — falling back to text card', { error: err.message });
    return null;
  }
}

module.exports = { COACH_VALUES, normalizeCoachValue, shouldRenderCard, buildCoachCardHtml, renderCoachCard };
