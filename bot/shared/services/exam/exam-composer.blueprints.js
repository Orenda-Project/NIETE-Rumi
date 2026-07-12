/**
 * Exam composition blueprints.
 *
 * Was originally intended to be generated from taleemabad-core's
 * `question_bank_assessment` table, but that table is empty in the source DB
 * (verified 2026-07-12), so this file is hand-maintained for v1.
 *
 * Blueprint shape:
 *   {
 *     duration_minutes: Number,
 *     seen_pct: Number,          // 0-100
 *     unseen_pct: Number,        // seen_pct + unseen_pct = 100
 *     criteria: {
 *       type: 'blooms' | 'skills',
 *       breakdown: { <bucket>: <COUNT>, ... },   // ← counts, not percentages
 *     },
 *   }
 *
 * Keys: `${grade}::${subject}::${type}` where:
 *   grade   — Taleemabad label ("Grade Five" etc.) — see the raw bank rows
 *   subject — Taleemabad subject.label ("Math", "English", "Urdu", ...)
 *   type    — 'WEEKLY' | 'TERM'
 *
 * Fallback: if no key matches, use GENERIC_WEEKLY or GENERIC_TERM.
 */

// --- Generic fallbacks ------------------------------------------------------

const GENERIC_WEEKLY = {
  duration_minutes: 40,
  seen_pct: 80,
  unseen_pct: 20,
  criteria: {
    type: 'blooms',
    breakdown: { REMEMBER: 8, UNDERSTAND: 5, APPLY: 2 }, // ~15 questions
  },
};

const GENERIC_TERM = {
  duration_minutes: 120,
  seen_pct: 30,
  unseen_pct: 70,
  criteria: {
    type: 'blooms',
    breakdown: { REMEMBER: 12, UNDERSTAND: 12, APPLY: 8 }, // ~32 questions
  },
};

// --- Grade + Subject overrides ---------------------------------------------
// Seed the top combinations NIETE teachers are likely to use. Human-authored
// starting points; refine after real teacher use. Grade labels match the
// Taleemabad bank ("Grade Five", "Grade Four", …).
//
// Language subjects (English / Urdu) can optionally use a Skills breakdown:
//   criteria: { type: 'skills', breakdown: { reading: N, writing: N, ... } }
// For v1 we keep everything on Blooms for consistency; move to Skills once
// the composer's SKILL_TYPE_MAP has been calibrated against the imported bank.

const BLUEPRINTS = {
  // Grade Five — most common at NIETE launch
  'Grade Five::Math::WEEKLY':      { ...GENERIC_WEEKLY,
    criteria: { type: 'blooms', breakdown: { REMEMBER: 6, UNDERSTAND: 6, APPLY: 3 } } },
  'Grade Five::Math::TERM':        { ...GENERIC_TERM,
    criteria: { type: 'blooms', breakdown: { REMEMBER: 10, UNDERSTAND: 12, APPLY: 10 } } },
  'Grade Five::English::WEEKLY':   GENERIC_WEEKLY,
  'Grade Five::English::TERM':     GENERIC_TERM,
  'Grade Five::Urdu::WEEKLY':      GENERIC_WEEKLY,
  'Grade Five::Urdu::TERM':        GENERIC_TERM,

  // Grade Four
  'Grade Four::Math::WEEKLY':      GENERIC_WEEKLY,
  'Grade Four::Math::TERM':        GENERIC_TERM,
  'Grade Four::English::WEEKLY':   GENERIC_WEEKLY,
  'Grade Four::English::TERM':     GENERIC_TERM,
  'Grade Four::Urdu::WEEKLY':      GENERIC_WEEKLY,
  'Grade Four::Urdu::TERM':        GENERIC_TERM,

  // Grade Three
  'Grade Three::Math::WEEKLY':     { ...GENERIC_WEEKLY,
    criteria: { type: 'blooms', breakdown: { REMEMBER: 7, UNDERSTAND: 4, APPLY: 1 } } },
  'Grade Three::Math::TERM':       GENERIC_TERM,
  'Grade Three::English::WEEKLY':  GENERIC_WEEKLY,
  'Grade Three::English::TERM':    GENERIC_TERM,
  'Grade Three::Urdu::WEEKLY':     GENERIC_WEEKLY,
  'Grade Three::Urdu::TERM':       GENERIC_TERM,
};

function getBlueprint(grade, subject, type) {
  const key = `${grade}::${subject}::${type}`;
  if (BLUEPRINTS[key]) return BLUEPRINTS[key];
  return type === 'TERM' ? GENERIC_TERM : GENERIC_WEEKLY;
}

module.exports = { BLUEPRINTS, GENERIC_WEEKLY, GENERIC_TERM, getBlueprint };
