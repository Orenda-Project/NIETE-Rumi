/**
 * FICO score adapter — 4 sections (B, C, D, F) per the ICT canonical rubric.
 *
 * `analysis.domains[sectionKey]` carries `{ domain_score, domain_max, indicators[] }`
 * on a 1-4 scale. Falls back to `area_score`/`area_max` if a session was scored
 * with the legacy area shape.
 */

const ficoFramework = require('../../frameworks/fico-framework');

// The framework owns the scale; a local copy here silently mis-sizes every section max
// the moment the rubric changes.
const { scaleMax: SCALE_MAX } = ficoFramework.getScoringConstants();

// The words a not-scored section carries where the fraction normally goes.
const NOT_ASSESSED_WORDS = {
  en: 'not assessed',
  ur: 'جانچ نہیں ہوئی',
  ar: 'لم يتم التقييم',
};

// The "why" line for a not-scored section is written HERE, in code, not by the
// narrative model. The model is handed a prompt that REQUIRES it to name one
// concrete missing element per section; pointed at a section that was never
// measured it invents one, which is how a whole cohort of Urdu lessons came to
// be told they lacked maths. Each reason gets its own sentence: one shared line
// across several distinct states misdirects every field report that follows.
const NOT_ASSESSED_WHY = {
  lp_absent: {
    en: 'No lesson plan was provided for this lesson, so lesson-plan fidelity was not observed and is not counted in the score.',
    ur: 'اس سبق کے لیے کوئی لیسن پلان فراہم نہیں کیا گیا، اس لیے لیسن پلان پر عمل کا جائزہ نہیں لیا جا سکا اور یہ اسکور میں شامل نہیں ہے۔',
  },
  other: {
    en: 'Lesson-plan fidelity could not be measured for this lesson, so it was not observed and is not counted in the score.',
    ur: 'اس سبق کے لیے لیسن پلان پر عمل کی پیمائش نہیں ہو سکی، اس لیے اس کا جائزہ نہیں لیا گیا اور یہ اسکور میں شامل نہیں ہے۔',
  },
};

function notAssessedWhy(reason, language) {
  const bucket = (!reason || reason === 'lp_absent') ? NOT_ASSESSED_WHY.lp_absent : NOT_ASSESSED_WHY.other;
  return bucket[language] || bucket.en;
}

function notAssessedWords(language) {
  return NOT_ASSESSED_WORDS[language] || NOT_ASSESSED_WORDS.en;
}

function buildFicoGroups(a, language) {
  const DOMAINS = ficoFramework.getScoringConstants().domains;
  const container = (a && (a.domains || a.areas)) || {};
  return Object.entries(DOMAINS).map(([sectionKey, def]) => {
    const d = container[sectionKey] || {};
    // A section the framework marked not-assessed has no number to show. Emitting
    // its stored proxy score would put a bar back on the card that the total no
    // longer counts; emitting 0 would read as a section she failed.
    if (d.assessed === false) {
      return {
        key: def.key,
        domainKey: sectionKey,
        name: language === 'ur' ? (def.displayName_ur || def.displayName) : def.displayName,
        score: null,
        max: null,
        pct: null,
        notAssessed: true,
        notAssessedWords: notAssessedWords(language),
        why: notAssessedWhy(d.not_assessed_reason, language),
      };
    }
    const score = d.domain_score ?? d.area_score ?? 0;
    const max = d.domain_max ?? d.area_max ?? def.indicatorCount * SCALE_MAX;
    return {
      // Use the sheet's section letter (B/C/D/F) as the group key — trainers
      // and printed rubric readers instantly cross-reference.
      key: def.key,
      // bd-1t1wz — canonical domain key, for narrative.domain_whys lookups.
      domainKey: sectionKey,
      // bd-1t1wz — the ur variant carries the bilingual bracketed label
      // (framework data, ports the main bot's bd-43483 displayName_ur pattern).
      name: language === 'ur' ? (def.displayName_ur || def.displayName) : def.displayName,
      score,
      max,
      pct: max > 0 ? Math.round((score / max) * 100) : 0,
    };
  });
}

module.exports = { buildFicoGroups, notAssessedWhy, notAssessedWords };
