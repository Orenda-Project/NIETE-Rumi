/**
 * v10 coaching test (bd-v0toag.57): the slim report image groups C and D get on WhatsApp.
 *
 * It is the /cr page's card, drawn as on Amena's ICT-3 template: a dark header (name, grade · subject · topic ·
 * date, the score in gold), "What you did well" with green ticks, then the gold "Try one thing tomorrow" box with
 * the move's step chip, why it matters and the next-recording check, then a line pointing at the report button
 * (the .19 button sent after it). Labels follow the teacher's language, as the page does. Fonts come from the
 * hero template, base64-embedded: no network at render time (Lexend stands in for the template's Inter).
 *
 * vm = { language, header: { name, meta, date, pct }, wells: [string], thing: { text, step: {name,index}|null, why } }
 * buildSlimCardHtml(vm) → HTML for an image renderer (selector '.report', width 480).
 */

const { wrapLatinRuns } = require('../../../templates/latin-runs');
const { fontFaces, esc } = require('./hero-report.template');

const W = {
  en: {
    well: 'What you did well', tryh: '★ Try one thing tomorrow', inStep: (chip) => ` · in ${chip}`,
    check: 'We’ll look for this in your next recording.', full: 'Your full report is one tap below ↓',
  },
  ur: {
    well: 'آپ نے یہ اچھا کیا', tryh: '★ کل ایک کام آزمائیں', inStep: (chip) => ` · ${chip} میں`,
    check: 'اگلی ریکارڈنگ میں ہم یہی دیکھیں گے۔', full: 'آپ کی پوری رپورٹ نیچے ایک ٹیپ پر ہے ↓',
  },
};

// The template's step colours: Opening, Explanation, We Do, You Do, Check.
const STEP_COLOUR = ['#ef8a12', '#9b55e6', '#3d5bd6', '#2f9a46', '#d63a6a'];

function buildSlimCardHtml(vm) {
  const ur = vm.language === 'ur';
  const w = ur ? W.ur : W.en;
  const T = (s) => (ur ? wrapLatinRuns(esc(s), { token: "[A-Za-z0-9'’.\\-]", requireLetter: true }) : esc(s));
  const h = vm.header || {};
  const wells = Array.isArray(vm.wells) ? vm.wells.filter(Boolean) : [];
  const t = vm.thing || {};
  const step = t.step && STEP_COLOUR[t.step.index - 1] ? t.step : null;
  const chip = step ? `<span class="chip s${step.index}">${esc(step.name)}</span>` : '';
  const meta = [h.meta, h.date].filter(Boolean).join(' · ');
  const body = ur ? `'NastaliqUrdu','Lexend',serif` : `'Lexend','NastaliqUrdu',sans-serif`;

  return `<!doctype html><html lang="${ur ? 'ur' : 'en'}" dir="${ur ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  ${fontFaces()}
  *{box-sizing:border-box;margin:0}
  body{background:#eef0f3;font-family:${body};color:#1f2433}
  .report{width:480px;padding:14px;display:grid;gap:12px;background:#eef0f3}
  .ltr,bdi{direction:ltr;unicode-bidi:isolate;font-family:'Lexend',sans-serif}
  .hd{background:#2f3446;color:#fff;border-radius:16px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}
  .nm{font-size:19px;font-weight:700;line-height:${ur ? '1.9' : '1.35'}}
  .mt{font-size:13px;color:#c9cdd8;line-height:${ur ? '2' : '1.5'}}
  .sc{flex:none;font-family:'Lexend',sans-serif;font-size:30px;font-weight:700;color:#f2b51d;line-height:1}
  .panel{background:#fff;border-radius:16px;padding:14px 16px;display:grid;gap:8px}
  .h3{font-size:15px;font-weight:700;line-height:${ur ? '2' : '1.4'}}
  .well{list-style:none;padding:0;display:grid;gap:8px}
  .well li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start;font-size:14px;line-height:${ur ? '2.05' : '1.5'}}
  .tick{width:22px;height:22px;border-radius:50%;border:2px solid #2f9a46;color:#2f9a46;display:grid;place-items:center;font-size:12px;font-weight:700;font-family:'Lexend',sans-serif;margin-top:${ur ? '8px' : '1px'}}
  .try{background:#fff6d9;border:2px solid #f2b51d;border-radius:16px;padding:14px 16px;display:grid;gap:8px}
  .chip{display:inline-block;font-family:'Lexend',sans-serif;font-size:12px;font-weight:700;color:#fff;border-radius:6px;padding:2px 8px;vertical-align:middle;line-height:1.5}
  ${STEP_COLOUR.map((c, i) => `.s${i + 1}{background:${c}}`).join('')}
  .move{font-size:15px;line-height:${ur ? '2.15' : '1.55'}}
  .why,.time{font-size:13px;color:#5f6677;line-height:${ur ? '2' : '1.5'}}
  .full{text-align:center;font-size:14px;font-weight:700;color:#3d5bd6;padding:2px 0 4px;line-height:${ur ? '2' : '1.4'}}
  </style></head><body>
  <div class="report">
    <div class="hd"><div><div class="nm">${T(h.name || '')}</div>${meta ? `<div class="mt">${T(meta)}</div>` : ''}</div>${h.pct != null ? `<div class="sc"><bdi>${esc(h.pct)}%</bdi></div>` : ''}</div>
    ${wells.length ? `<div class="panel"><div class="h3">${esc(w.well)}</div><ul class="well">${wells.map((x) => `<li><span class="tick">✓</span><span>${T(x)}</span></li>`).join('')}</ul></div>` : ''}
    ${t.text ? `<div class="try"><div class="h3">${esc(w.tryh)}${chip ? w.inStep(chip) : ''}</div><p class="move">${T(t.text)}</p>${t.why ? `<p class="why">${T(t.why)}</p>` : ''}<p class="time">${esc(w.check)}</p></div>` : ''}${vm.videoStrip ? require('../video-reco/strip').stripHtml(vm.videoStrip, { language: vm.language, T, width: 480 }) : ''}
    <div class="full">${esc(w.full)}</div>
  </div>
  </body></html>`;
}

module.exports = { buildSlimCardHtml };
