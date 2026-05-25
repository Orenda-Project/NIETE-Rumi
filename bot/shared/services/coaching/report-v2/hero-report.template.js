/**
 * Coaching Report v2 — Hero template.
 *
 * The unified "celebration" report renderer: an A4 one-pager (photo hero + big header
 * score under the Rumi mark + a 2-column body: domain scorecard | one moment + strength +
 * horizon + an LTR journey trend + a next-step). Rendered as an image (a tall single card),
 * delivered as an inline PNG with a short caption (date + topic).
 *
 * Consumes a viewModel: score adapter + narrative pass + a next-step action + trend.
 * Language-aware: en/sw LTR (Lexend + Fraunces serif), ur/ar RTL (Nastaliq / Naskh). All
 * fonts + the Rumi mark are base64-embedded — NO network at render time.
 *
 * buildHeroReportHtml(vm) → HTML string for an image renderer (selector '.report', width 794).
 */

const fs = require('fs');
const path = require('path');

const ASSET = (p) => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', '..', p)).toString('base64'); }
  catch { return ''; }
};
const A = {
  logoWhite: ASSET('assets/rumi-mark-white.png'),
  logoNavy: ASSET('assets/rumi-mark-navy.png'),
  lexR: ASSET('fonts/Lexend-Regular.ttf'),
  lexB: ASSET('fonts/Lexend-Bold.ttf'),
  frauR: ASSET('fonts/Fraunces-Regular.ttf'),
  frauB: ASSET('fonts/Fraunces-SemiBold.ttf'),
  nastR: ASSET('fonts/NotoNastaliqUrdu-Regular.ttf'),
  nastB: ASSET('fonts/NotoNastaliqUrdu-Bold.ttf'),
  naskR: ASSET('fonts/NotoNaskhArabic-Regular.ttf'),
  naskB: ASSET('fonts/NotoNaskhArabic-Bold.ttf'),
};

const MARKS_WORD = { sw: ' alama', en: ' marks', ur: ' نمبر', ar: ' درجة' };
const CHROME = {
  en: { celebrate: 'A celebration of your teaching', signature: 'The signature of your classroom', scores: 'Your scores · this lesson', moments: 'Moments worth remembering', strength: 'Your strength', horizon: 'Your next horizon', journey: (k) => `Your journey — ${k} lessons together`, trynext: 'One thing to try next class', made: (n) => `Made just for you, ${n}`, caption: (d, t) => `📋 Your coaching report${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  sw: { celebrate: 'Sherehe ya ufundishaji wako', signature: 'Alama ya darasa lako', scores: 'Alama kwa kila eneo · somo hili', moments: 'Matukio ya kukumbukwa', strength: 'Nguvu yako', horizon: 'Hatua yako inayofuata', journey: (k) => `Safari yako — ${k} masomo pamoja`, trynext: 'Jambo moja la kujaribu darasa lijalo', made: (n) => `Imeandaliwa kwa ajili yako, ${n}`, caption: (d, t) => `📋 Ripoti yako ya ufundishaji${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  ur: { celebrate: 'آپ کی تدریس کا جشن', signature: 'آپ کی کلاس کی پہچان', scores: 'اس سبق کے اسکور', moments: 'یادگار لمحے', strength: 'آپ کی خوبی', horizon: 'آپ کا اگلا اُفق', journey: (k) => `آپ کا سفر — ${k} اسباق ایک ساتھ`, trynext: 'اگلی کلاس میں آزمانے کے لیے ایک بات', made: (n) => `خاص آپ کے لیے، ${n}`, caption: (d, t) => `📋 آپ کی کوچنگ رپورٹ${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  ar: { celebrate: 'احتفاء بتدريسك', signature: 'بصمة صفّك', scores: 'درجاتك · هذا الدرس', moments: 'لحظات تستحق التذكر', strength: 'قوتك', horizon: 'أفقك التالي', journey: (k) => `رحلتك — ${k} دروس معًا`, trynext: 'أمر واحد لتجربته في الحصة القادمة', made: (n) => `أُعدّ خصيصًا لك، ${n}`, caption: (d, t) => `📋 تقرير التدريب الخاص بك${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
};

const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }

/** Short caption that accompanies the report image (date + inferred topic). */
function buildReportCaption(vm) {
  const C = CHROME[vm.language] || CHROME.en;
  return C.caption(vm.date || '', vm.topic || '');
}

function fontFaces() {
  return `
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${A.lexR})}
  @font-face{font-family:'Lexend';font-weight:700;src:url(data:font/ttf;base64,${A.lexB})}
  @font-face{font-family:'Fraunces';font-weight:400;src:url(data:font/ttf;base64,${A.frauR})}
  @font-face{font-family:'Fraunces';font-weight:600;src:url(data:font/ttf;base64,${A.frauB})}
  @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${A.nastR})}
  @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${A.nastB})}
  @font-face{font-family:'NaskhArabic';font-weight:400;src:url(data:font/ttf;base64,${A.naskR})}
  @font-face{font-family:'NaskhArabic';font-weight:700;src:url(data:font/ttf;base64,${A.naskB})}`;
}

/** Always-LTR trend with English date labels, regardless of report language. */
function ltrTrend(points, peak, w = 700, h = 110) {
  if (!points || points.length < 2) return '';
  const pad = 24, lo = 35, hi = 95, base = h - 28;
  const xs = (i) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const ys = (v) => 26 + (1 - (v - lo) / (hi - lo)) * (base - 26);
  const line = points.map((p, i) => `${xs(i)},${ys(p.pct)}`).join(' ');
  const area = `${xs(0)},${base} ${line} ${xs(points.length - 1)},${base}`;
  const peakI = points.findIndex((p) => p.pct === peak);
  const mon = (d) => { const x = new Date(String(d) + 'T00:00:00'); return Number.isNaN(x.getTime()) ? '' : `${x.getDate()} ${EN_MON[x.getMonth()]}`; };
  const dots = points.map((p, i) =>
    `<circle cx="${xs(i)}" cy="${ys(p.pct)}" r="${i === peakI ? 6 : 4}" fill="${i === peakI ? '#f5b301' : '#0c1a4e'}"/>`
    + (i === peakI ? `<text x="${xs(i)}" y="${ys(p.pct) - 12}" text-anchor="middle" font-size="14" font-weight="700" fill="#0c1a4e" font-family="Lexend">${p.pct}%</text>` : '')
    + `<text x="${xs(i)}" y="${base + 19}" text-anchor="middle" font-size="12" fill="#8a93ad" font-family="Lexend">${mon(p.date)}</text>`).join('');
  return `<div style="direction:ltr"><svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><polygon points="${area}" fill="rgba(245,179,1,.16)"/><polyline points="${line}" fill="none" stroke="#0c1a4e" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg></div>`;
}

/**
 * @param {object} vm viewModel
 * @returns {string} HTML for an image renderer (selector '.report', width 794)
 */
function buildHeroReportHtml(vm) {
  const lang = vm.language || 'en';
  const RTL = lang === 'ur' || lang === 'ar';
  const C = CHROME[lang] || CHROME.en;
  const headFam = RTL ? (lang === 'ar' ? `'NaskhArabic',serif` : `'NastaliqUrdu',serif`) : `'Fraunces',serif`;
  const bodyFam = RTL ? (lang === 'ar' ? `'NaskhArabic',serif` : `'NastaliqUrdu',serif`) : `'Lexend',sans-serif`;
  const dir = RTL ? 'rtl' : 'ltr';

  const wrapLatin = (html) => !RTL ? html : html.split(/(<[^>]+>)/).map((seg) => seg.startsWith('<') ? seg
    : seg.replace(/[A-Za-z][A-Za-z'’.\-]*(?:[\s\-][A-Za-z'’.\-]+)*/g, (m) => `<span class="ltr">${m}</span>`)).join('');
  const T = (s) => wrapLatin(esc(s));

  const n = vm.narrative || {};
  const score = vm.score || {};
  const peak = (vm.trend && vm.trend.length) ? Math.max(...vm.trend.map((t) => t.pct)) : score.overall;
  const marksLine = (score.marks != null && score.max != null) ? `${score.marks}/${score.max}${MARKS_WORD[lang] || ''}` : '';
  const moment = (n.moments || [])[0];
  const logo = (b64, cls) => b64 ? `<img class="${cls}" src="data:image/png;base64,${b64}" alt="Rumi">` : '';

  // Domain-altitude scorecard (e.g. MEWAKA: 6 rows w/ proportional bar). Indicator-altitude
  // frameworks render rows the same way (score/max + bar).
  const scorecard = (vm.groups || []).map((g) => `
    <div class="sc-row">
      <div class="sc-h"><span class="sc-n">${T(g.name)}</span><span class="sc-s">${g.score}/${g.max}</span></div>
      <div class="pbar"><div class="pfill" style="width:${g.pct}%;background:${g.pct >= 80 ? '#3aa775' : g.pct >= 50 ? '#e0a52e' : '#dd7a5c'}"></div></div>
    </div>`).join('');

  return `<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8"><style>${fontFaces()}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#eef1f7}
  .report{width:794px;background:#fff;font-family:${bodyFam};color:#1c2438}
  .ltr{font-family:'Lexend',sans-serif;font-weight:600}
  /* hero grows with the affirmation (2-4 lines) — never clipped */
  .hero{position:relative;min-height:210px;overflow:hidden;background:#0c1a4e;padding:26px 42px 30px}
  .hero>.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.4}
  .hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,26,78,.5),rgba(12,26,78,.45) 45%,rgba(12,26,78,.92))}
  .hero-in{position:relative;z-index:2;color:#fff}
  .hrow{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:18px}
  .eyebrow{font-size:12px;letter-spacing:${RTL ? '0' : '.2em'};${RTL ? '' : 'text-transform:uppercase;'}color:#9db0ff;font-weight:700;margin-top:6px}
  .logo{width:62px;opacity:.95;display:block}
  /* headline + score share ONE row, top-aligned — the cap of the score sits on the same
     line as the cap of the affirmation's first line. */
  .headline{display:flex;align-items:flex-start;justify-content:space-between;gap:30px}
  .hero h1{font-family:${headFam};font-size:${RTL ? '26px' : '31px'};line-height:${RTL ? '1.6' : '1.15'};font-weight:600;flex:1;max-width:560px;margin:0}
  .hscore{flex-shrink:0;text-align:${RTL ? 'left' : 'right'};line-height:1}
  .hscore .p{font-family:'Lexend';font-weight:700;font-size:44px;letter-spacing:-.02em;margin-top:4px}
  .hscore .s{font-family:'Lexend';font-size:12.5px;color:#bcc8ff;margin-top:6px;letter-spacing:.05em}
  .who{margin-top:14px;font-size:14px;color:#dfe5ff}.who b{color:#fff}
  .pad{padding:${RTL ? '14px' : '13px'} 42px}
  .identity{font-family:${headFam};font-size:${RTL ? '17px' : '18px'};line-height:${RTL ? '1.6' : '1.45'};color:#26304d;font-weight:400}
  .cols{display:flex;align-items:flex-start;gap:28px;padding:${RTL ? '8px' : '14px'} 42px 0}
  .col-l{flex:1.25}.col-r{flex:1}
  .label{font-size:11px;letter-spacing:${RTL ? '0' : '.14em'};${RTL ? '' : 'text-transform:uppercase;'}color:#0c1a4e;opacity:.55;font-weight:700;margin-bottom:13px}
  .ov{color:#0c1a4e;opacity:1}
  .sc-row{margin-bottom:12px}
  .sc-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
  .sc-n{font-size:13px;font-weight:700;color:#1b2f7a}.sc-s{font-family:'Lexend';font-size:13px;font-weight:700;color:#0c1a4e}
  .pbar{height:8px;border-radius:5px;background:#e7ebf3;overflow:hidden}.pfill{height:100%;border-radius:5px}
  .moment{background:#f7f9ff;border-radius:14px;padding:16px 18px;margin-bottom:14px}
  .m-q{font-family:${headFam};font-size:16px;line-height:${RTL ? '1.7' : '1.4'};color:#26304d}
  .m-w{font-size:12.5px;color:#6a748f;margin-top:6px;line-height:${RTL ? '1.7' : '1.45'}}
  .sh{margin-bottom:16px}.sh .pill{display:inline-block;font-size:11px;font-weight:700;padding:3px 11px;border-radius:14px;margin-bottom:7px;background:#fff4d6;color:#9a6b00}
  .sh.h .pill{background:#eef3ff;color:#1b2f7a}
  .sh h3{font-family:${headFam};font-size:15px;color:#16213e;font-weight:600;margin-bottom:5px;line-height:${RTL ? '1.6' : '1.3'}}
  .sh .nt{font-size:12.5px;color:#5a647e;line-height:${RTL ? '1.7' : '1.45'}}
  .journey{padding:14px 42px 0}.j-cap{font-size:12.5px;color:#5a647e;line-height:${RTL ? '1.7' : '1.5'};margin-top:2px}
  .try{margin:16px 42px 0;background:linear-gradient(135deg,#0c1a4e,#1b2f7a);color:#fff;border-radius:16px;padding:18px 24px}
  .try .label{color:#9db0ff;opacity:1;margin-bottom:6px}
  .try-text{font-family:${headFam};font-size:17px;line-height:${RTL ? '1.7' : '1.4'}}
  .foot{display:flex;align-items:center;justify-content:space-between;padding:16px 42px 24px;margin-top:14px;border-top:1px solid #eef0f6;color:#8a93ad;font-size:12px}
  .brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#0c1a4e;font-size:15px;font-family:'Lexend'}.brand img{width:30px}
  </style></head><body>
  <div class="report">
    <div class="hero">${vm.photoB64 ? `<img class="bg" src="data:image/jpeg;base64,${vm.photoB64}">` : ''}
      <div class="hero-in">
        <div class="hrow"><div class="eyebrow">${T(C.celebrate)}</div>${logo(A.logoWhite, 'logo')}</div>
        <div class="headline">
          <h1>${T(n.affirmation || '')}</h1>
          <div class="hscore"><div class="p">${score.overall}%</div>${marksLine ? `<div class="s">${marksLine}</div>` : ''}</div>
        </div>
        <div class="who"><b>${esc(vm.teacherName || '')}</b>${vm.topic ? ` &nbsp;·&nbsp; ${T(vm.topic)}` : ''}${vm.date ? ` &nbsp;·&nbsp; ${esc(vm.date)}` : ''}</div>
      </div>
    </div>
    ${n.identity ? `<div class="pad" style="padding-bottom:0"><div class="identity">${T(n.identity)}</div></div>` : ''}
    <div class="cols">
      <div class="col-l">
        <div class="label">${T(C.scores)} &nbsp; <span class="ov">${score.overall}%</span></div>
        ${scorecard}
      </div>
      <div class="col-r">
        ${moment ? `<div class="label">${T(C.moments)}</div><div class="moment"><div class="m-q">“${T(moment.quote)}”</div><div class="m-w">${T(moment.why)}</div></div>` : ''}
        <div class="sh"><span class="pill">${T(C.strength)}</span><h3>${T(n.strength_name || '')}</h3><div class="nt">${T(n.strength_note || '')}</div></div>
        <div class="sh h"><span class="pill">${T(C.horizon)}</span><h3>${T(n.horizon_title || '')}</h3><div class="nt">${T(n.horizon_note || '')}</div></div>
      </div>
    </div>
    ${(vm.trend && vm.trend.length >= 2) ? `<div class="journey"><div class="label">${T(C.journey(vm.trend.length))}</div>${ltrTrend(vm.trend, peak)}<div class="j-cap">${T(n.journey_note || '')}</div></div>` : ''}
    ${vm.tryNext ? `<div class="try"><div class="label">${T(C.trynext)}</div><div class="try-text">${T(vm.tryNext)}</div></div>` : ''}
    <div class="foot"><div class="brand">${logo(A.logoNavy, '')}Rumi</div><div>${T(C.made(vm.teacherName || ''))}</div></div>
  </div>
  </body></html>`;
}

module.exports = { buildHeroReportHtml, buildReportCaption };
