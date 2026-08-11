'use strict';
/**
 * FEAT-116 (bd-2299) — the in-Flow Support Brief, as NATIVE Flow text.
 *
 * `buildBriefViewModel({teacher, trend, strength, growth, moves})` → a pure view
 * model whose fields map 1:1 to the BRIEF screen's native text components
 * (TextHeading / TextSubheading / TextBody / TextCaption). No image, no base64.
 *
 * Design change (operator, pre-deploy): the BRIEF screen renders with native
 * Flow text — NOT a Playwright PNG. A render inside the ~10s data_exchange window
 * added latency + timeout risk + a ~50KB payload for polish we don't need in v1.
 * Native text renders instantly. (A rendered "celebration" card is a future v2
 * option — see the removed renderBriefPng note at the foot of this file.)
 *
 * Binding invariants (RES-004 + plan §3):
 *  - NEVER a bare score/percent — the AI-coaching trend renders as a 3-tier HOTS
 *    band chain (Emerging → Developing → Proficient), never a number.
 *  - trend shows only with >=2 points; <2 degrades to warm first-visit copy
 *    (firstVisit=true when trend is empty).
 *  - one strength (celebratory), one growth (non-punitive).
 *  - guidance-not-a-grade footnote ALWAYS present.
 *  - all copy catalog-routed (en/ur/sw/ar).
 */

const { clampLanguage } = require('../../config/ux-strings');

// NIETE adaptation (bd-2430): the market is ur/en (Rule 20/bd-2405 — never
// Kiswahili on a NIETE surface). This used to clamp locally because no catalog
// existed; it now uses the shared clamp. The sw/ar strings below are kept
// verbatim from upstream for diff-parity but are unreachable.

// The 3-tier HOTS band (official PESRP/PECTAA scale — Emerging/Developing/
// Proficient; there is NO "Excellent"). Authored in all four catalog languages.
const BANDS = {
  emerging: { en: 'Emerging', ur: 'ابتدائی', sw: 'Inachipuka', ar: 'ناشئ' },
  developing: { en: 'Developing', ur: 'ترقی پذیر', sw: 'Inakua', ar: 'نامٍ' },
  proficient: { en: 'Proficient', ur: 'ماہر', sw: 'Hodari', ar: 'ماهر' },
};

// Brief chrome, all four languages (Rule 20 — never a partial map).
const BRIEF_STRINGS = {
  subtitle_fallback: {
    en: 'Go help this teacher today', ur: 'آج اس استاد کی مدد کریں',
    sw: 'Nenda umsaidie mwalimu huyu leo', ar: 'اذهب لمساعدة هذا المعلم اليوم',
  },
  grade_word: { en: 'Grade', ur: 'جماعت', sw: 'Darasa', ar: 'الصف' },
  // Leader-directed framing (operator, pre-deploy): the brief is read by the
  // OBSERVER, so these are context ("what's working") + where to focus support.
  strength_prefix: {
    en: '✅ What\'s working:', ur: '✅ کیا اچھا چل رہا ہے:', sw: '✅ Kinachofanya kazi:', ar: '✅ ما الذي ينجح:',
  },
  growth_prefix: {
    en: '🌱 Where your support helps most:', ur: '🌱 آپ کی مدد سب سے زیادہ یہاں کارآمد:',
    sw: '🌱 Ambapo msaada wako unasaidia zaidi:', ar: '🌱 حيث يساعد دعمك أكثر:',
  },
  moves_intro: {
    en: 'During your visit:', ur: 'اپنے دورے کے دوران:', sw: 'Wakati wa ziara yako:', ar: 'أثناء زيارتك:',
  },
  debrief_reminder: {
    en: 'In the debrief, pick just ONE thing to work on with them — and open with a genuine strength.',
    ur: 'ڈی بریف میں صرف ایک چیز پر کام کے لیے چنیں — اور آغاز کسی حقیقی خوبی سے کریں۔',
    sw: 'Katika maongezi, chagua jambo MOJA tu la kufanyia kazi naye — na anza na nguvu ya kweli.',
    ar: 'في جلسة النقاش، اختر أمراً واحداً فقط للعمل عليه مع المعلم — وابدأ بقوة حقيقية.',
  },
  nodata_line: {
    en: 'ℹ️ No coaching data for this teacher yet — use this visit to spot it.',
    ur: 'ℹ️ اس استاد کے لیے ابھی کوچنگ ڈیٹا نہیں — اس دورے سے اسے پہچانیں۔',
    sw: 'ℹ️ Hakuna data ya kufundisha kwa mwalimu huyu bado — tumia ziara hii kuibaini.',
    ar: 'ℹ️ لا توجد بيانات تدريب لهذا المعلم بعد — استخدم هذه الزيارة لرصدها.',
  },
  nodata_growth_leadin: {
    en: 'Below are good first moves for any first visit.',
    ur: 'کسی بھی پہلے دورے کے لیے اچھے ابتدائی اقدامات نیچے درج ہیں۔',
    sw: 'Hapa chini kuna hatua nzuri za kwanza kwa ziara yoyote ya kwanza.',
    ar: 'فيما يلي خطوات أولى جيدة لأي زيارة أولى.',
  },
  default_strength: {
    en: 'showing up for the class every day',
    ur: 'ہر روز کلاس کے لیے موجود رہنا',
    sw: 'kuwepo darasani kila siku',
    ar: 'الحضور للصف كل يوم',
  },
  default_growth: {
    en: 'opening up more student thinking',
    ur: 'بچوں کی سوچ کو مزید کھولنا',
    sw: 'kufungua fikra zaidi za wanafunzi',
    ar: 'فتح المزيد من تفكير الطلاب',
  },
  trend_prefix: { en: '📈 Journey:', ur: '📈 سفر:', sw: '📈 Safari:', ar: '📈 الرحلة:' },
  sessions_word: { en: 'sessions', ur: 'سیشنز', sw: 'vipindi', ar: 'جلسات' },
  getting_started: {
    en: '📈 First coaching session logged — the journey is just beginning.',
    ur: '📈 پہلا کوچنگ سیشن درج ہو گیا — سفر ابھی شروع ہوا ہے۔',
    sw: '📈 Kipindi cha kwanza cha kufundisha kimeandikwa — safari inaanza.',
    ar: '📈 تم تسجيل أول جلسة تدريب — الرحلة تبدأ الآن.',
  },
  guidance_footnote: {
    en: 'This is guidance to support your visit — not a grade or a ranking.',
    ur: 'یہ آپ کے دورے میں مدد کے لیے رہنمائی ہے — کوئی گریڈ یا درجہ بندی نہیں۔',
    sw: 'Huu ni mwongozo wa kusaidia ziara yako — si daraja wala orodha ya ushindani.',
    ar: 'هذا إرشاد لدعم زيارتك — وليس درجة أو ترتيباً.',
  },
  first_visit: {
    en: 'First visit with this teacher on Rumi. Start by getting to know the class — say hello, watch a lesson, and use the moves above to open the conversation.',
    ur: 'رومی پر اس استاد کے ساتھ پہلا دورہ۔ کلاس کو جاننے سے آغاز کریں — سلام کریں، ایک سبق دیکھیں، اور بات چیت شروع کرنے کے لیے اوپر دیے گئے طریقے استعمال کریں۔',
    sw: 'Ziara ya kwanza na mwalimu huyu kwenye Rumi. Anza kwa kufahamiana na darasa — salimia, tazama somo, na tumia hatua zilizo hapo juu kuanzisha mazungumzo.',
    ar: 'الزيارة الأولى لهذا المعلم على رومي. ابدأ بالتعرف على الصف — ألقِ التحية، وشاهد درساً، واستخدم الخطوات أعلاه لبدء الحوار.',
  },
};

function resolveLang(teacher) {
  const lang = (teacher && teacher.preferred_language) || 'en';
  return clampLanguage(lang); // NIETE market clamp (ur/en, English floor)
}

function s(key, lang) {
  const e = BRIEF_STRINGS[key];
  return (e && (e[lang] || e.en)) || '';
}

/** pct (0-100) → 3-tier HOTS band key. Never surfaced as a number. */
function bandKeyFromPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return null;
  if (n >= 67) return 'proficient';
  if (n >= 34) return 'developing';
  return 'emerging';
}

/** Normalise a trend point to a band key (either shape; NO % survives). */
function bandKeyOf(pt) {
  if (pt && typeof pt.band === 'string') {
    const b = pt.band.toLowerCase();
    if (BANDS[b]) return b;
    for (const k of Object.keys(BANDS)) if (BANDS[k].en.toLowerCase() === b) return k;
    return bandKeyFromPct(pt.pct) || 'developing';
  }
  if (pt && pt.pct != null) return bandKeyFromPct(pt.pct) || 'developing';
  return 'developing';
}

/**
 * @param {Object} args
 * @param {Object} args.teacher   { teacher_name/name, school_name, preferred_language, grade }
 * @param {Array}  [args.trend]   loadTrendData output OR [{date,band}]
 * @param {string} [args.strength] one-line strength label (already language-appropriate)
 * @param {string} [args.growth]   one-line growth label
 * @param {Array}  [args.moves]    [{areaKey,text}] from observe-support-moves (or opening tips)
 * @param {boolean} [args.noData]  FIX-3: no AI-coaching history — render the honest
 *   opening-tips variant (no asserted strength/growth/area), first-visit trend copy.
 * @returns {Object} pure view model with native-text fields (never throws)
 */
function buildBriefViewModel({ teacher = {}, trend = [], strength = null, growth = null, moves = [], noData = false } = {}) {
  const lang = resolveLang(teacher);
  const rtl = lang === 'ur' || lang === 'ar';
  const points = Array.isArray(trend) ? trend : [];
  const showTrend = !noData && points.length >= 2;
  const firstVisit = noData || points.length === 0;

  const name = (teacher.teacher_name || teacher.name || '').toString();
  const school = (teacher.school_name || teacher.school || '').toString();

  // Subtitle: "Grade 2 · GPS Dhok Bilal" (drop whichever part is missing).
  const subParts = [];
  if (teacher.grade != null && teacher.grade !== '') subParts.push(`${s('grade_word', lang)} ${teacher.grade}`);
  if (school) subParts.push(school);
  const subtitle = subParts.length ? subParts.join(' · ') : s('subtitle_fallback', lang);

  let strength_text;
  let growth_text;
  if (noData) {
    // FIX-3: NEVER fabricate a strength/area. One honest line + an opening-tips lead-in.
    strength_text = s('nodata_line', lang);
    growth_text = s('nodata_growth_leadin', lang);
  } else {
    const strengthLabel = (strength && String(strength).trim()) || s('default_strength', lang);
    const growthLabel = (growth && String(growth).trim()) || s('default_growth', lang);
    strength_text = `${s('strength_prefix', lang)} ${strengthLabel}`;
    growth_text = `${s('growth_prefix', lang)} ${growthLabel}`;
  }

  const moveList = Array.isArray(moves) ? moves : [];
  const moves_text = moveList.map((m, i) => `${i + 1}. ${m.text}`).join('\n');

  let trend_text;
  if (showTrend) {
    const chain = points.map((p) => BANDS[bandKeyOf(p)][lang] || BANDS[bandKeyOf(p)].en).join(' → ');
    trend_text = `${s('trend_prefix', lang)} ${chain} (${points.length} ${s('sessions_word', lang)})`;
  } else if (firstVisit) {
    trend_text = s('first_visit', lang); // FIX-3: keep the first-visit copy in the no-data case
  } else {
    trend_text = s('getting_started', lang); // exactly one session so far
  }

  return {
    lang,
    rtl,
    teacher_name: name || 'Teacher',
    subtitle,
    strength_text,
    growth_text,
    moves_intro: s('moves_intro', lang),
    moves_text,
    trend_text,
    debrief_reminder: s('debrief_reminder', lang),
    // ALWAYS present (test + invariant): guidance, not a grade.
    guidance_text: s('guidance_footnote', lang),
    // flags retained for callers/tests:
    showTrend,
    firstVisit,
    noData: !!noData,
  };
}

// renderBriefPng was REMOVED from the request path (operator, pre-deploy): the
// data_exchange endpoint must never launch Playwright. A rendered "celebration"
// card remains a possible v2 enhancement, but only OUTSIDE the ~10s Flow window
// (e.g. delivered to the leader's chat after the observation), never inline.

module.exports = { buildBriefViewModel, BANDS, BRIEF_STRINGS };
