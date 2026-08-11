/**
 * bd-2531 — STEPS "S" Supervisor Remark rubric (design spec Appendix A).
 *
 * THE single source of truth for: the WhatsApp form screens, the scoring math,
 * the STEPS export column names, and the narrative prompt's evidence block.
 * Nothing may hardcode an indicator name, an anchor string, or the /20
 * denominator anywhere else.
 *
 * Scale: 4 Exemplary · 3 Proficient · 2 Developing · 1 Needs Improvement.
 *   S      = Σ(5 indicators)   → 5..20   (the floor is 5, NOT 0)
 *   S_pct  = S / 20 × 100      → 25..100 (the floor is 25, NOT 0)
 *   STEPS contribution = S_pct × 10%
 *
 * Anchors are verbatim from Appendix A (finalized-for-now by NIETE leadership,
 * 2026-07-24; supersedes the 7- and 10-indicator drafts). Because the rubric has
 * already been revised twice, scores are stored as per-indicator ROWS keyed by
 * `ordinal` — a revision changes this file and adds rows, never a migration
 * that rewrites columns.
 *
 * Rule 20 (language is data, not code): en + ur are BOTH complete here. Never
 * ship a partial map — it silently degrades an Urdu-speaking principal to
 * English. English is the deliberate floor for any unoffered language.
 */

// ─── Rating scale ───────────────────────────────────────────────────────────
const SCALE = Object.freeze({
  4: Object.freeze({ en: 'Exemplary', ur: 'مثالی' }),
  3: Object.freeze({ en: 'Proficient', ur: 'ماہر' }),
  2: Object.freeze({ en: 'Developing', ur: 'بہتری کی طرف' }),
  1: Object.freeze({ en: 'Needs Improvement', ur: 'بہتری درکار' }),
});

const LANGUAGES = Object.freeze(['en', 'ur']);
const FALLBACK_LANGUAGE = 'en';

// ─── The five indicators ────────────────────────────────────────────────────
// `ordinal` — the stored key (supervisor_remark_scores.indicator_ordinal) and
//             the screen order in the WhatsApp flow.
// `key`     — the STEPS export column name. A PUBLISHED CONTRACT: STEPS reads
//             these names, so renaming one breaks the nightly export.
const INDICATORS = Object.freeze([
  Object.freeze({
    ordinal: 1,
    key: 'score_growth',
    name: Object.freeze({
      en: 'Professional Growth & Feedback Uptake',
      ur: 'سیکھنے اور فیڈبیک سے بہتری',
    }),
    anchors: Object.freeze({
      4: Object.freeze({
        en: 'Actively seeks learning, applies feedback from observations/trainings, consistently improves.',
        ur: 'خود سیکھنے کے مواقع تلاش کرتا ہے، فیڈبیک پر عمل کرتا ہے، مسلسل بہتری لاتا ہے۔',
      }),
      3: Object.freeze({
        en: 'Participates in learning, usually applies feedback.',
        ur: 'تربیت میں حصہ لیتا ہے، اکثر فیڈبیک پر عمل کرتا ہے۔',
      }),
      2: Object.freeze({
        en: 'Sometimes benefits but not consistent.',
        ur: 'کبھی کبھار فائدہ اٹھاتا ہے، مستقل نہیں۔',
      }),
      1: Object.freeze({
        en: 'Little interest in learning/acting on feedback.',
        ur: 'سیکھنے/عمل میں دلچسپی نہیں۔',
      }),
    }),
  }),
  Object.freeze({
    ordinal: 2,
    key: 'score_collaboration',
    name: Object.freeze({
      en: 'Collaboration & Peer Support',
      ur: 'ساتھی اساتذہ کے ساتھ تعاون اور رہنمائی',
    }),
    anchors: Object.freeze({
      4: Object.freeze({
        en: 'Regularly shares practices, mentors colleagues, contributes to collaborative learning.',
        ur: 'طریقے شیئر کرتا ہے، رہنمائی کرتا ہے، مل کر کام کرتا ہے۔',
      }),
      3: Object.freeze({
        en: 'Works well with colleagues, shares when opportunities arise.',
        ur: 'موقع ملنے پر تعاون کرتا ہے۔',
      }),
      2: Object.freeze({
        en: 'Occasionally collaborates, generally independent.',
        ur: 'کبھی کبھار، زیادہ تر اپنے کام تک محدود۔',
      }),
      1: Object.freeze({
        en: 'Rarely collaborates/supports.',
        ur: 'تعاون/رہنمائی نہیں کرتا۔',
      }),
    }),
  }),
  Object.freeze({
    ordinal: 3,
    key: 'score_leadership',
    name: Object.freeze({
      en: 'Initiative & School Leadership',
      ur: 'اسکول کی بہتری میں کردار',
    }),
    anchors: Object.freeze({
      4: Object.freeze({
        en: 'Takes initiative, leads activities, supports colleagues, contributes to school improvement.',
        ur: 'خود آگے بڑھ کر ذمہ داریاں لیتا ہے، سرگرمیوں میں حصہ، رہنمائی۔',
      }),
      3: Object.freeze({
        en: 'Accepts responsibilities, participates in school-wide activities.',
        ur: 'اضافی ذمہ داریاں قبول کرتا ہے۔',
      }),
      2: Object.freeze({
        en: 'Occasionally contributes beyond classroom.',
        ur: 'کبھی کبھار کلاس سے باہر حصہ۔',
      }),
      1: Object.freeze({
        en: 'Limits to assigned classroom duties.',
        ur: 'صرف بنیادی ذمہ داریوں تک محدود۔',
      }),
    }),
  }),
  Object.freeze({
    ordinal: 4,
    key: 'score_student_support',
    name: Object.freeze({
      en: 'Student-Centered Support',
      ur: 'ہر طالب علم کی سیکھنے میں مدد',
    }),
    anchors: Object.freeze({
      4: Object.freeze({
        en: 'Consistently identifies students needing support, ensures every learner can succeed.',
        ur: 'ہر طالب علم پر نظر، کمزوروں کی بروقت مدد، سب کو موقع۔',
      }),
      3: Object.freeze({
        en: 'Provides support to struggling students when needed.',
        ur: 'ضرورت پر کمزور طلبہ کی مدد۔',
      }),
      2: Object.freeze({
        en: 'Occasionally supports, not consistent.',
        ur: 'کبھی کبھار، مستقل نہیں۔',
      }),
      1: Object.freeze({
        en: 'Rarely identifies/addresses needs.',
        ur: 'ضروریات پر توجہ نہیں۔',
      }),
    }),
  }),
  Object.freeze({
    ordinal: 5,
    key: 'score_parents',
    name: Object.freeze({
      en: 'Parents & Community Engagement',
      ur: 'والدین اور کمیونٹی سے رابطہ',
    }),
    anchors: Object.freeze({
      4: Object.freeze({
        en: 'Builds positive parent relationships, communicates progress, strengthens school-community partnerships.',
        ur: 'باقاعدہ رابطہ، پیش رفت سے آگاہی، اچھے تعلقات۔',
      }),
      3: Object.freeze({
        en: 'Communicates when needed, participates in community activities.',
        ur: 'ضرورت پر رابطہ، سرگرمیوں میں حصہ۔',
      }),
      2: Object.freeze({
        en: 'Limited communication, rarely participates.',
        ur: 'کم رابطہ، کم حصہ۔',
      }),
      1: Object.freeze({
        en: 'Little effort to engage.',
        ur: 'رابطہ/تعلقات کی کوشش نہیں۔',
      }),
    }),
  }),
]);

const INDICATOR_COUNT = INDICATORS.length;          // 5
const MAX_LEVEL = 4;
const MAX_SCORE = INDICATOR_COUNT * MAX_LEVEL;      // 20 — never hardcode this

// ─── Lookups ────────────────────────────────────────────────────────────────

/**
 * @param {number} ordinal 1..5
 * @returns {object} the indicator
 * @throws if the ordinal is not a real indicator
 */
function getIndicator(ordinal) {
  const ind = INDICATORS.find((i) => i.ordinal === ordinal);
  if (!ind) throw new Error(`remark-rubric: no indicator with ordinal ${ordinal}`);
  return ind;
}

/**
 * Resolve one anchor string. Unsupported languages fall back to English — the
 * deliberate floor — rather than returning undefined into a WhatsApp message.
 * @param {number} ordinal 1..5
 * @param {number} level 1..4
 * @param {string} language
 */
function getAnchor(ordinal, level, language) {
  const ind = getIndicator(ordinal);
  const anchor = ind.anchors[level];
  if (!anchor) throw new Error(`remark-rubric: no level ${level} on indicator ${ordinal}`);
  return anchor[LANGUAGES.includes(language) ? language : FALLBACK_LANGUAGE];
}

/**
 * Localised indicator name, same fallback rule.
 */
function getIndicatorName(ordinal, language) {
  const { name } = getIndicator(ordinal);
  return name[LANGUAGES.includes(language) ? language : FALLBACK_LANGUAGE];
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Are all five distinct indicators answered?
 * @param {Array<{ordinal:number}>} scores
 */
function isComplete(scores) {
  if (!Array.isArray(scores)) return false;
  const ordinals = new Set(scores.map((s) => s && s.ordinal));
  return INDICATORS.every((i) => ordinals.has(i.ordinal))
    && ordinals.size === INDICATOR_COUNT;
}

/**
 * S and S_pct from the five per-indicator rows.
 *
 * THROWS on anything incomplete or malformed rather than returning a number.
 * This is the whole point: 3 of 5 answered summing to 12 would render as a
 * plausible 60% and land in a teacher's promotion file. A partial must produce
 * NOTHING, loudly — never a number that merely looks low.
 *
 * @param {Array<{ordinal:number, score:number}>} scores
 * @returns {{s_score:number, s_pct:number}} s_score 5..20, s_pct 25.0..100.0
 */
function computeS(scores) {
  if (!Array.isArray(scores)) {
    throw new Error('remark-rubric: computeS requires an array of scores');
  }
  const seen = new Set();
  for (const row of scores) {
    if (!row || typeof row.ordinal !== 'number') {
      throw new Error('remark-rubric: malformed score row (missing ordinal)');
    }
    if (seen.has(row.ordinal)) {
      throw new Error(`remark-rubric: duplicate score for indicator ${row.ordinal}`);
    }
    seen.add(row.ordinal);
    getIndicator(row.ordinal); // throws on an unknown ordinal
    if (!Number.isInteger(row.score) || row.score < 1 || row.score > MAX_LEVEL) {
      throw new Error(
        `remark-rubric: score ${row.score} out of range 1..${MAX_LEVEL} on indicator ${row.ordinal}`);
    }
  }
  if (!isComplete(scores)) {
    const missing = INDICATORS.filter((i) => !seen.has(i.ordinal)).map((i) => i.ordinal);
    throw new Error(
      `remark-rubric: incomplete rubric — ${seen.size}/${INDICATOR_COUNT} answered, missing [${missing}]`);
  }

  const s_score = scores.reduce((sum, r) => sum + r.score, 0);
  // 1dp, matching the design spec (s_pct NUMERIC(5,1)) and the DB view.
  const s_pct = Math.round((s_score / MAX_SCORE) * 100 * 10) / 10;
  return { s_score, s_pct };
}

/**
 * Flatten the five rows into the STEPS export shape — the named sub-score
 * columns the design spec's §8 promises BigQuery. Row storage in, flat
 * contract out, so the export never needs to know the ordinal encoding.
 * @param {Array<{ordinal:number, score:number}>} scores (must be complete)
 */
function toExportColumns(scores) {
  const { s_score, s_pct } = computeS(scores); // validates first
  const byOrdinal = new Map(scores.map((r) => [r.ordinal, r.score]));
  const out = { s_score, s_pct };
  for (const ind of INDICATORS) out[ind.key] = byOrdinal.get(ind.ordinal);
  return out;
}

module.exports = {
  SCALE,
  LANGUAGES,
  FALLBACK_LANGUAGE,
  INDICATORS,
  INDICATOR_COUNT,
  MAX_LEVEL,
  MAX_SCORE,
  getIndicator,
  getIndicatorName,
  getAnchor,
  isComplete,
  computeS,
  toExportColumns,
};
