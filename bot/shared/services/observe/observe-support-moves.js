'use strict';
/**
 * bd-2430 (NIETE port of main-bot FEAT-116 observe-support-moves) — the
 * leader-directed "during your visit" moves for the Support Brief.
 *
 * NIETE adaptation:
 *  - Areas are the FOUR FICO V3 sections (B/C/D/F), not the five HOTS areas.
 *    The HOTS keys remain accepted by leader-source for upstream parity, but
 *    the MOVE LIBRARY here is FICO-keyed.
 *  - Languages: en/ur ONLY (NIETE market — Rule 20/bd-2405: never Kiswahili).
 *    English is the deliberate floor (text[lang] || text.en).
 *
 * Moves are for the COACH (watch-for + suggest), never teacher to-dos — the
 * brief is read by the observer before walking into the classroom.
 */

const { clampLanguage } = require('../../config/ux-strings');

const FICO_AREAS = [
  'lesson_plan_fidelity',      // FICO section B (10 indicators)
  'high_leverage_practices',   // FICO section C (12 indicators)
  'student_engagement',        // FICO section D (7 indicators)
  'teacher_subject_knowledge', // FICO section F (8 indicators)
];

// Accepted analysis area keys = FICO sections + the HOTS areas (parity with the
// upstream leader-source, which still resolves HOTS goalN_* slots).
const HOTS_AREAS = [
  'classroom_environment', 'lesson_planning', 'instructional_strategies',
  'student_engagement', 'assessment_feedback',
];
const KNOWN_AREAS = [...new Set([...FICO_AREAS, ...HOTS_AREAS])];

// Two leader-directed moves per FICO section. en + ur (Urdu is Nastaliq-ready
// plain text; rendering is native Flow TextBody so RTL is safe — bd-2331 applies
// only to NavigationList chrome, not the brief).
const MOVE_LIBRARY = {
  lesson_plan_fidelity: [
    {
      grade: null,
      text: {
        en: 'Open the lesson plan together before class — ask her to show you where today\'s lesson sits in it, and watch whether the taught steps follow it.',
        ur: 'کلاس سے پہلے سبق کا منصوبہ ساتھ کھولیں — پوچھیں کہ آج کا سبق اس میں کہاں ہے، اور دیکھیں کہ پڑھائے گئے مراحل اسی کے مطابق ہیں یا نہیں۔',
      },
    },
    {
      grade: null,
      text: {
        en: 'Watch for the lesson objective: is it said out loud and revisited at the end? If not, suggest opening and closing the lesson with it tomorrow.',
        ur: 'سبق کے مقصد پر نظر رکھیں: کیا وہ بلند آواز میں بتایا گیا اور آخر میں دہرایا گیا؟ اگر نہیں، تو مشورہ دیں کہ کل سبق کا آغاز اور اختتام اسی سے کریں۔',
      },
    },
  ],
  high_leverage_practices: [
    {
      grade: null,
      text: {
        en: 'Count the seconds after her questions — if answers come only from the same few hands, suggest "ask, wait 5 seconds, then pick" as one move to try.',
        ur: 'سوال کے بعد سیکنڈ گنیں — اگر جواب ہمیشہ وہی چند ہاتھ دیتے ہیں تو مشورہ دیں: «سوال کریں، پانچ سیکنڈ رکیں، پھر کسی کو چنیں»۔',
      },
    },
    {
      grade: null,
      text: {
        en: 'Watch one worked example on the board: does she model the thinking step by step before students try? If not, suggest "I do → we do → you do" for one topic.',
        ur: 'بورڈ پر ایک حل شدہ مثال دیکھیں: کیا بچوں کے خود کرنے سے پہلے سوچ کے مراحل دکھائے جاتے ہیں؟ اگر نہیں، تو ایک موضوع کے لیے «میں کروں → ہم کریں → تم کرو» کا مشورہ دیں۔',
      },
    },
  ],
  student_engagement: [
    {
      grade: null,
      text: {
        en: 'Track who participates for five minutes — the corners and back rows too. If a group never speaks, suggest pair-talk before whole-class answers.',
        ur: 'پانچ منٹ تک دیکھیں کہ کون حصہ لے رہا ہے — کونے اور پچھلی قطاریں بھی۔ اگر کوئی گروہ کبھی نہیں بولتا تو پوری کلاس سے پہلے جوڑی میں بات کا مشورہ دیں۔',
      },
    },
    {
      grade: null,
      text: {
        en: 'Notice what students are doing while she teaches: listening only, or doing? Suggest one 3-minute "everyone writes/solves" moment per lesson.',
        ur: 'دیکھیں کہ پڑھاتے وقت بچے کیا کر رہے ہیں: صرف سن رہے ہیں یا کچھ کر رہے ہیں؟ ہر سبق میں تین منٹ کا «سب لکھیں/حل کریں» لمحہ تجویز کریں۔',
      },
    },
  ],
  teacher_subject_knowledge: [
    {
      grade: null,
      text: {
        en: 'Listen for one concept explained two different ways. If an explanation stays word-for-word from the book, ask her afterwards to explain it to you in her own words — that surfaces where support is needed.',
        ur: 'سنیں کہ کوئی تصور دو مختلف طریقوں سے سمجھایا گیا یا نہیں۔ اگر وضاحت کتاب کے لفظ بہ لفظ ہے تو بعد میں ان سے اپنے الفاظ میں سمجھانے کو کہیں — اسی سے پتہ چلے گا کہ مدد کہاں چاہیے۔',
      },
    },
    {
      grade: null,
      text: {
        en: 'Watch how student mistakes are handled: corrected flat, or used to teach? Suggest picking ONE common error and unpacking why it happens.',
        ur: 'دیکھیں کہ بچوں کی غلطیوں سے کیسے نمٹا جاتا ہے: صرف درست کر دی جاتی ہیں یا ان سے سکھایا جاتا ہے؟ ایک عام غلطی چن کر اس کی وجہ کھولنے کا مشورہ دیں۔',
      },
    },
  ],
};

// FIX-3 no-data variant: honest first-visit tips (leader-directed), en + ur.
const OPENING_TIPS = [
  {
    en: 'Say hello and settle in at the back — the goal of visit one is trust, not judgement.',
    ur: 'سلام کریں اور پیچھے بیٹھ جائیں — پہلے دورے کا مقصد اعتماد ہے، جانچ نہیں۔',
  },
  {
    en: 'Watch one full activity from start to finish before writing anything.',
    ur: 'کچھ بھی لکھنے سے پہلے ایک مکمل سرگرمی شروع سے آخر تک دیکھیں۔',
  },
  {
    en: 'Note ONE thing that genuinely works — you will open the debrief with it.',
    ur: 'ایک ایسی چیز نوٹ کریں جو واقعی اچھی ہو — ڈی بریف کا آغاز اسی سے کریں گے۔',
  },
  {
    en: 'Ask the teacher what SHE wants help with — her answer usually points at the real gap.',
    ur: 'استاد سے پوچھیں کہ انہیں خود کس چیز میں مدد چاہیے — ان کا جواب اکثر اصل کمی کی نشاندہی کرتا ہے۔',
  },
];

// FICO indicator ids (B1..B10, C1..C12, D1..D7, F1..F8) → section, by prefix.
const SECTION_PREFIX_TO_AREA = {
  b: 'lesson_plan_fidelity',
  c: 'high_leverage_practices',
  d: 'student_engagement',
  f: 'teacher_subject_knowledge',
};

/** Gap key ('B4', 'c2', or a full area key) → MOVE_LIBRARY area (or null). */
function gapToArea(gap) {
  const g = String(gap || '').trim().toLowerCase();
  if (!g) return null;
  if (MOVE_LIBRARY[g]) return g;
  const m = g.match(/^([bcdf])\d{1,2}$/);
  return m ? SECTION_PREFIX_TO_AREA[m[1]] : null;
}

// NIETE market languages (Rule 20): ur/en, English floor. Kept as a named
// wrapper because callers below read better for it; the clamp itself is shared.
function clampVisitLang(lang) {
  return clampLanguage(lang);
}

function moveText(move, lang) {
  return (move.text && (move.text[lang] || move.text.en)) || move.text.en;
}

/**
 * @param {{preferred_language?:string, grade?:number|string}} teacher (reader = the LEADER)
 * @param {{gaps?:string[], weakestArea?:string}} [opts]
 * @returns {Promise<Array<{areaKey:string, text:string}>>} 3-4 moves, never empty.
 */
async function buildMoves(teacher = {}, opts = {}) {
  const lang = clampVisitLang(teacher && teacher.preferred_language);
  const gaps = Array.isArray(opts.gaps) ? opts.gaps : [];

  // Draw order: gap-implied sections first (deduped), then the weakest area,
  // then the rest of the library — so we always have enough.
  const areaOrder = [];
  const pushArea = (a) => { if (a && MOVE_LIBRARY[a] && !areaOrder.includes(a)) areaOrder.push(a); };
  for (const gap of gaps) pushArea(gapToArea(gap));
  pushArea(gapToArea(opts.weakestArea));
  for (const a of FICO_AREAS) pushArea(a);

  const chosen = [];
  const seen = new Set();
  const pushMove = (areaKey, move) => {
    const text = moveText(move, lang);
    if (seen.has(text)) return;
    seen.add(text);
    chosen.push({ areaKey, text });
  };

  // Round 1: one move per area in order (breadth first).
  for (const areaKey of areaOrder) {
    if (chosen.length >= 4) break;
    const moves = MOVE_LIBRARY[areaKey] || [];
    if (moves[0]) pushMove(areaKey, moves[0]);
  }
  // Round 2: top up from the remaining moves until 3-4.
  for (const areaKey of areaOrder) {
    if (chosen.length >= 4) break;
    for (const move of (MOVE_LIBRARY[areaKey] || []).slice(1)) {
      if (chosen.length >= 4) break;
      pushMove(areaKey, move);
    }
  }

  return chosen.slice(0, 4);
}

/**
 * FIX-3 no-data variant: four leader-directed opening tips for a first visit,
 * in the LEADER's language. areaKey='opening'. Never empty.
 */
function openingTips(lang = 'en') {
  const l = clampVisitLang(lang);
  return OPENING_TIPS.map((t) => ({ areaKey: 'opening', text: t[l] || t.en }));
}

module.exports = {
  buildMoves,
  openingTips,
  MOVE_LIBRARY,
  OPENING_TIPS,
  FICO_AREAS,
  HOTS_AREAS,
  KNOWN_AREAS,
  gapToArea,
  clampVisitLang,
};
