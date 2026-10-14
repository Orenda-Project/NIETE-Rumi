/**
 * Coaching Report v2 — Hero template style constants (brand palettes, per-language chrome copy).
 * Split out of hero-report.template.js (bd-v0toag.59) — pure data, no behaviour.
 */

/**
 * Brand palettes (bd-2452). `vm.brand` selects one; default keeps the original
 * navy/gold design byte-for-byte. `niete` = the NIETE deployment's identity:
 * Green #47BA7D + Navy Slate #333748 (official wrt. brand book, reconciled in
 * the niete-brand skill 2026-08-01 — the book navy, NOT the portal charcoal
 * #32373C). Supporting tints are derived for contrast, not invented brand
 * colours; the amber/red scorecard-bar colours stay semantic across brands.
 */
const PALETTES = {
  default: {
    pageBg: '#eef1f7', text: '#1c2438',
    deep: '#0c1a4e', mid: '#1b2f7a',
    overlayA: 'rgba(12,26,78,.5)', overlayB: 'rgba(12,26,78,.45)', overlayC: 'rgba(12,26,78,.92)',
    eyebrow: '#9db0ff', scoreSub: '#bcc8ff', who: '#dfe5ff',
    ink: '#26304d', inkHead: '#16213e', note: '#5a647e', quiet: '#6a748f', faint: '#8a93ad',
    barBg: '#e7ebf3', barHigh: '#3aa775',
    momentBg: '#f7f9ff',
    pillStrengthBg: '#fff4d6', pillStrengthText: '#9a6b00',
    pillHorizonBg: '#eef3ff', pillHorizonText: '#1b2f7a',
    tryGrad: 'linear-gradient(135deg,#0c1a4e,#1b2f7a)', tryLabel: '#9db0ff',
    footBorder: '#eef0f6',
    trendArea: 'rgba(245,179,1,.16)', trendPeak: '#f5b301',
  },
  niete: {
    pageBg: '#eef1f0', text: '#232733',
    deep: '#333748', mid: '#2f7d55',
    overlayA: 'rgba(51,55,72,.5)', overlayB: 'rgba(51,55,72,.45)', overlayC: 'rgba(51,55,72,.92)',
    eyebrow: '#a9e3c4', scoreSub: '#c6e9d5', who: '#e2e5ea',
    ink: '#2b3040', inkHead: '#232735', note: '#5a6272', quiet: '#6a7284', faint: '#8a92a0',
    barBg: '#e8ece9', barHigh: '#47BA7D',
    momentBg: '#f3faf6',
    pillStrengthBg: '#e4f5ec', pillStrengthText: '#1f7a4b',
    pillHorizonBg: '#eceef2', pillHorizonText: '#333748',
    tryGrad: 'linear-gradient(135deg,#333748,#47BA7D)', tryLabel: '#a9e3c4',
    footBorder: '#eaeeeb',
    trendArea: 'rgba(71,186,125,.16)', trendPeak: '#47BA7D',
  },
};

const MARKS_WORD = { sw: ' alama', en: ' marks', ur: ' نمبر', ar: ' درجة' };

// Last resort only — the adapter supplies the localised wording with the row.
const NOT_ASSESSED_FALLBACK = 'not assessed';
const CHROME = {
  en: { celebrate: 'A celebration of your teaching', signature: 'The signature of your classroom', scores: 'Your scores · this lesson', classroom: 'From your classroom', moments: 'Moments worth remembering', strength: 'Your strength', horizon: 'Your next horizon', journey: (k) => `Your journey — ${k} lessons together`, trynext: 'One thing to try next class', made: (n) => `Made just for you, ${n}`, caption: (d, t) => `📋 Your coaching report${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  sw: { celebrate: 'Sherehe ya ufundishaji wako', signature: 'Alama ya darasa lako', scores: 'Alama kwa kila eneo · somo hili', moments: 'Matukio ya kukumbukwa', strength: 'Nguvu yako', horizon: 'Hatua yako inayofuata', journey: (k) => `Safari yako — ${k} masomo pamoja`, trynext: 'Jambo moja la kujaribu darasa lijalo', made: (n) => `Imeandaliwa kwa ajili yako, ${n}`, caption: (d, t) => `📋 Ripoti yako ya ufundishaji${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  ur: { celebrate: 'آپ کی تدریس کا جشن', signature: 'آپ کی کلاس کی پہچان', scores: 'اس سبق کے اسکور', moments: 'یادگار لمحے', strength: 'آپ کی خوبی', horizon: 'آپ کا اگلا اُفق', journey: (k) => `آپ کا سفر — ${k} اسباق ایک ساتھ`, trynext: 'اگلی کلاس میں آزمانے کے لیے ایک بات', made: (n) => `خاص آپ کے لیے، ${n}`, caption: (d, t) => `📋 آپ کی کوچنگ رپورٹ${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
  ar: { celebrate: 'احتفاء بتدريسك', signature: 'بصمة صفّك', scores: 'درجاتك · هذا الدرس', moments: 'لحظات تستحق التذكر', strength: 'قوتك', horizon: 'أفقك التالي', journey: (k) => `رحلتك — ${k} دروس معًا`, trynext: 'أمر واحد لتجربته في الحصة القادمة', made: (n) => `أُعدّ خصيصًا لك، ${n}`, caption: (d, t) => `📋 تقرير التدريب الخاص بك${t ? ` · ${t}` : ''}${d ? ` · ${d}` : ''}` },
};

module.exports = { PALETTES, MARKS_WORD, NOT_ASSESSED_FALLBACK, CHROME };
