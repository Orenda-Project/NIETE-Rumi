/**
 * FEAT-093 bd-52 — the observe FRAMEWORK PACK.
 *
 * One observation pipeline, many rubrics, selected by CONFIG per market:
 *   OBSERVE_FRAMEWORK=mewaka (default — Tanzania)
 *   OBSERVE_FRAMEWORK=hots   (Pakistan — AEOs + Moawin cluster coordinators)
 *
 * The pack contract (what the pipeline consumes):
 *   key        'mewaka' | 'hots'
 *   lang       officer-facing language default ('sw' | 'ur')
 *   domains    { key: { title, title_en, indicators: [{ id, name }] } } —
 *              the SAME shape the draft prefill / endpoint / Flow generator
 *              already speak (built on MEWAKA in FEAT-053; HOTS is adapted in)
 *   domainOrder / screenIds  — Flow screens, one per domain
 *   computeScores(analysis)  — totals + overall_percentage IN the domains
 *              shape, stamping self-describing titles so the teacher report
 *              never needs to know the rubric
 *   module     the framework object handed to analyzePedagogy — for mewaka
 *              this IS the real mewaka module (TZ byte-identical); for hots
 *              it is an observe-specific wrapper with Urdu prompts that
 *              produce the pipeline's JSON contract
 *
 * TRUST: field names like evidence_sw are KEYS, not languages — HOTS fills
 * them with Urdu. Renaming the keys would fork every consumer for nothing.
 */

const mewaka = require('../coaching/frameworks/mewaka-framework');
const hots = require('../coaching/frameworks/hots-framework');
const fico = require('../coaching/frameworks/fico-framework'); // FEAT-102 — ICT/NIETE canonical FICO (26 ind, sections B/C/D/F, 1-4, max 104)

const OBSERVE_FRAMEWORK_KEYS = ['mewaka', 'hots', 'fico'];

const SCREEN_IDS_6 = ['DOMAIN_A', 'DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_E', 'DOMAIN_F'];

// ── HOTS normalized to the observe domains shape, titles authored in Urdu ──
// (natively written, not machine-translated — same rule as the Kiswahili copy)
const HOTS_TITLES_UR = {
  classroom_environment: 'کلاس روم کا ماحول',
  lesson_planning: 'سبق کی منصوبہ بندی',
  instructional_strategies: 'تدریسی حکمتِ عملی',
  student_engagement: 'طلبہ کی شمولیت',
  assessment_feedback: 'جانچ اور رائے',
};

let _hotsDomainsCache = null;
function hotsDomains() {
  if (_hotsDomainsCache) return _hotsDomainsCache;
  const { areas } = hots.getScoringConstants();
  const out = {};
  for (const [key, area] of Object.entries(areas)) {
    out[key] = {
      title: HOTS_TITLES_UR[key] || area.displayName,
      title_en: area.displayName,
      indicators: area.indicators.map((i) => ({ id: i.id, name: i.name })),
    };
  }
  _hotsDomainsCache = out;
  return out;
}

/** Generic domains-shape scorer (0–3 per indicator, clamped, never NaN). */
function computeDomainScores(analysis, domains, frameworkKey) {
  const container = (analysis.domains = analysis.domains || {});
  let marks = 0;
  let max = 0;
  for (const [key, spec] of Object.entries(domains)) {
    const dom = (container[key] = container[key] || {});
    const byId = {};
    (dom.indicators || []).forEach((i) => { byId[i.id] = i; });
    let dTotal = 0;
    for (const specInd of spec.indicators) {
      const raw = Number((byId[specInd.id] || {}).score);
      const score = Number.isFinite(raw) ? Math.max(0, Math.min(3, raw)) : 0;
      if (byId[specInd.id]) byId[specInd.id].score = score;
      dTotal += score;
    }
    // mirror mewaka.computeScores field names exactly — every downstream
    // consumer (hero report adapter, PDF transformer) already reads these
    dom.domain_score = dTotal;
    dom.domain_max = spec.indicators.length * 3;
    dom.area_score = dTotal;
    dom.area_max = dom.domain_max;
    dom.title = spec.title;         // self-describing — the report reads THIS
    dom.title_en = spec.title_en;
    marks += dTotal;
    max += dom.domain_max;
  }
  analysis.scores = {
    overall_marks: marks,
    overall_max_marks: max,
    overall_percentage: max > 0 ? parseFloat(((marks / max) * 100).toFixed(1)) : 0,
  };
  analysis.framework = frameworkKey;
  return analysis;
}

// ── HOTS observe analysis module (the object analyzePedagogy consumes) ────
function hotsObserveSystemPrompt() {
  return (
    'آپ ایک تجربہ کار تعلیمی مبصر ہیں جو پاکستانی پرائمری کلاس رومز کے اسباق کا ' +
    'HOTS (اعلیٰ درجے کی سوچ کی مہارتیں) فریم ورک پر تجزیہ کرتے ہیں۔ آپ کا لہجہ ' +
    'گرم اور حوصلہ افزا ہے — آپ ایک ساتھی ہیں، معائنہ کار نہیں۔ ہر مشاہدہ سبق کے ' +
    'کسی حقیقی لمحے سے جُڑا ہونا چاہیے۔ جواب ہمیشہ درست JSON میں دیں۔'
  );
}

function hotsObserveAnalysisPrompt(transcript, metadata = {}) {
  const domains = hotsDomains();
  // FEAT-093: the officer's LOCKED language decides the analysis content
  // language (evidence/improvements land on their form and, later, the
  // teacher's report). Default ur; en-locked officers get English.
  if (metadata.observerLanguage === 'en') {
    const domainLines = Object.entries(domains).map(([key, d]) => {
      const inds = d.indicators.map((i) => `    { "id": ${i.id}, /* ${i.name} */ "score": 0-3, "evidence_sw": "…", "improvement_sw": "…" }`).join(',\n');
      return `  "${key}": { /* ${d.title_en} */ "indicators": [\n${inds}\n  ] }`;
    }).join(',\n');
    return `An education officer sent a recording of a lesson by teacher ${metadata.teacherName || ''}. Read the transcript and analyse ALL 16 HOTS indicators.\n\nRules:\n- Score each indicator 0-3 (0=absent, 1=emerging, 2=developing, 3=proficient).\n- "evidence_sw": cite a REAL moment from the lesson in English — quote the teacher's own words where possible. If the transcript holds no evidence for an indicator, say honestly that the moment was not visible — NEVER invent evidence.\n- "improvement_sw": one small actionable suggestion in English.\n- Keys must stay EXACTLY as given.\n\nReturn JSON with EXACTLY this structure:\n{\n"domains": {\n${domainLines}\n},\n"summary_sw": "warm 2-3 sentence overall summary in English",\n"strengths": [ { "title_sw": "…", "evidence_sw": "…", "anchor_indicator": 7 } ],\n"focus_area_sw": { "title_sw": "…", "why_sw": "…", "try_sw": "…" }\n}\n\nTRANSCRIPT:\n${transcript}`;
  }
  const domainLines = Object.entries(domains).map(([key, d]) => {
    const inds = d.indicators.map((i) => `    { "id": ${i.id}, /* ${i.name} */ "score": 0-3, "evidence_sw": "…", "improvement_sw": "…" }`).join(',\n');
    return `  "${key}": { /* ${d.title} — ${d.title_en} */ "indicators": [\n${inds}\n  ] }`;
  }).join(',\n');
  return (
    `ایک افسر نے استاد ${metadata.teacherName || ''} کے سبق کی ریکارڈنگ بھیجی ہے۔ ` +
    'نیچے دیا گیا ٹرانسکرپٹ پڑھیں اور HOTS فریم ورک کے تمام 16 اشاریوں پر تجزیہ کریں۔\n\n' +
    'اصول:\n' +
    '- ہر اشاریے کو 0 سے 3 تک اسکور دیں (0=غائب، 1=ابتدائی، 2=ترقی پذیر، 3=ماہر)۔\n' +
    '- "evidence_sw" میں سبق کے کسی حقیقی لمحے کا حوالہ اردو میں لکھیں — استاد کے اپنے الفاظ نقل کریں جہاں ممکن ہو۔ اگر ٹرانسکرپٹ میں اس اشاریے کا کوئی ثبوت نہیں تو ایمانداری سے لکھیں کہ یہ لمحہ سبق میں نظر نہیں آیا — کبھی ثبوت نہ گھڑیں۔\n' +
    '- "improvement_sw" میں ایک چھوٹا، قابلِ عمل مشورہ اردو میں لکھیں۔\n' +
    '- تمام متن اردو میں ہو۔ کلیدیں (keys) بالکل ویسی رکھیں جیسی دی گئی ہیں۔\n\n' +
    'اس ساخت میں HASA JSON واپس کریں:\n' +
    '{\n"domains": {\n' + domainLines + '\n},\n' +
    '"summary_sw": "سبق کا مجموعی خلاصہ، اردو میں، 2-3 جملے، گرم لہجہ",\n' +
    '"strengths": [ { "title_sw": "…", "evidence_sw": "…", "anchor_indicator": 7 } ],\n' +
    '"focus_area_sw": { "title_sw": "…", "why_sw": "…", "try_sw": "…" }\n}\n\n' +
    `ٹرانسکرپٹ:\n${transcript}`
  );
}

const hotsObserveModule = {
  name: 'hots',
  version: 'observe-1.0',
  displayName: 'HOTS (Observation)',
  maxMarks: 48,
  hasDebrief: false,
  hasLPBonus: false,
  getSystemPrompt: hotsObserveSystemPrompt,
  buildAnalysisPrompt: hotsObserveAnalysisPrompt,
  computeScores: (analysis) => computeDomainScores(analysis, hotsDomains(), 'hots'),
  getScoringConstants: () => ({ domains: hotsDomains(), scaleMax: 3 }),
  getPerformanceBand: hots.getPerformanceBand,
};

// ── FICO (ICT/NIETE) normalized to the observe domains shape ────────────────
// FEAT-102: FICO is the ICT canonical rubric — 4 scored sections (B/C/D/F),
// 26 indicators, scale **1-4** (max 104). Unlike MEWAKA/HOTS (0-3), FICO's
// scale differs, so the pack carries its OWN scaleOptions (single source of
// truth for both the Flow generator and the draft prefill — they must match).
// English is the officer-facing primary (operator decision 2026-07-19); the
// per-officer Urdu toggle rides on the report/analysis language, not here.
// The `module` IS NIETE's real fico-framework — analyzePedagogy already emits
// the section-keyed domains shape and computeScores does 1-4/104, and the
// hero report's fico-adapter already renders it. So FICO needs NO observe
// wrapper (HOTS needed one only for its Urdu prompts).
const FICO_TITLES_UR = {
  lesson_plan_fidelity:     'سبق کی منصوبہ بندی کی پاسداری',
  high_leverage_practices:  'اعلیٰ اثر تدریسی طریقے',
  student_engagement:       'طلبہ کی شمولیت',
  teacher_subject_knowledge:'استاد کا مضمون سے متعلق علم',
};

// FICO score scale is 1-4 (id '1'..'4'), NOT 0-3. Officer-facing English.
const FICO_SCALE_OPTIONS = [
  { id: '1', title: '1 · Not Observed / Emerging' },
  { id: '2', title: '2 · Developing' },
  { id: '3', title: '3 · Proficient / Effective' },
  { id: '4', title: '4 · Highly Effective' },
];

let _ficoDomainsCache = null;
function ficoDomains() {
  if (_ficoDomainsCache) return _ficoDomainsCache;
  const { domains } = fico.getScoringConstants();
  const out = {};
  for (const [k, section] of Object.entries(domains)) {
    out[k] = {
      key: section.key,                 // 'B' | 'C' | 'D' | 'F' — drives screenId + hero group
      title: section.displayName,       // English primary (operator decision)
      title_en: section.displayName,
      title_ur: FICO_TITLES_UR[k] || section.displayName,
      displayName: section.displayName, // flow generator reads d.displayName/d.title
      indicators: section.indicators.map((i) => ({ id: i.id, name: i.name })),
    };
  }
  _ficoDomainsCache = out;
  return out;
}

// ── The packs ──────────────────────────────────────────────────────────────
function getObservePack() {
  const key = OBSERVE_FRAMEWORK_KEYS.includes(process.env.OBSERVE_FRAMEWORK)
    ? process.env.OBSERVE_FRAMEWORK : 'mewaka';

  if (key === 'fico') {
    const domains = ficoDomains();
    const domainOrder = Object.keys(domains); // B, C, D, F order (fico-framework DOMAINS order)
    return {
      key: 'fico',
      lang: 'en',
      domains,
      domainOrder,
      // screenIds derive from each section's own letter (DOMAIN_B/C/D/F) via
      // the flow generator's `domains[key].key` path; provide the same here.
      screenIds: domainOrder.map((k) => `DOMAIN_${domains[k].key}`),
      scaleOptions: FICO_SCALE_OPTIONS,   // 1-4 — consumed by draft + flow generator
      computeScores: fico.computeScores,  // NIETE fico-framework: 1-4, max 104
      module: fico,                       // real fico module — no observe wrapper needed
    };
  }

  if (key === 'hots') {
    const domains = hotsDomains();
    const domainOrder = Object.keys(domains);
    return {
      key: 'hots',
      lang: 'ur',
      domains,
      domainOrder,
      screenIds: SCREEN_IDS_6.slice(0, domainOrder.length),
      computeScores: hotsObserveModule.computeScores,
      module: hotsObserveModule,
    };
  }

  // mewaka: PASSTHROUGH — Tanzania stays byte-identical to FEAT-053.
  const domains = mewaka.getScoringConstants().domains;
  return {
    key: 'mewaka',
    lang: 'sw',
    domains,
    domainOrder: Object.keys(domains),
    screenIds: SCREEN_IDS_6,
    computeScores: mewaka.computeScores,
    module: mewaka,
  };
}

module.exports = { getObservePack, OBSERVE_FRAMEWORK_KEYS };
