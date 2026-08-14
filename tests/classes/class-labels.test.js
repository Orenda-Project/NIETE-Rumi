/**
 * Grade and subject labels — coverage, field caps, and no drift from the tables.
 *
 * Written BEFORE the labels exist.
 *
 * The reference tables deliberately store NO display copy: WhatsApp field caps
 * are an outage class here (an 87-code-point footer against a 60 cap took
 * /language down silently for hours while every automated check passed), and the
 * cap audit measures SOURCE — a label living in the database is invisible to it.
 *
 * That decision only pays off if these three things are actually enforced:
 *
 *   1. COVERAGE — every seeded code has a label, in BOTH offered languages. A
 *      partial map silently degrades that language to English.
 *   2. CAPS — measured in CODE POINTS, not .length. The two diverge on Urdu, and
 *      an off-by-a-surrogate count is exactly how a string passes locally and is
 *      rejected at the Graph API.
 *   3. NO DRIFT — the label keys and the seeded codes are the same set. If a
 *      subject is added to the seed and not here, the picker renders a blank row.
 */

const fs = require('fs');
const path = require('path');

const {
  gradeLabelFor,
  subjectLabelFor,
  GRADE_LABELS,
  SUBJECT_LABELS,
} = require('../../bot/shared/config/ux-strings');

const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');

const SEED = fs.readFileSync(
  path.join(__dirname, '../../infrastructure/supabase/02_seed-data.sql'),
  'utf8',
);

/** Pull the seeded codes straight out of the SQL, so this cannot be hand-synced. */
function seededCodes(table) {
  const start = SEED.indexOf(`INSERT INTO ${table} (`);
  expect(start).toBeGreaterThan(-1);
  const block = SEED.slice(start, SEED.indexOf('ON CONFLICT', start));
  // Not anchored to line-start, and case-sensitive-agnostic: section codes are
  // upper-case ('A'), and several seeds put more than one tuple on a line. The
  // `\(` guard is what keeps this off the alias arrays, which use `['...`.
  return [...block.matchAll(/\('([A-Za-z0-9_-]+)'/g)].map((m) => m[1]);
}

/** WhatsApp's tightest teacher-facing field. A label short enough for a button
 *  is short enough for a list row (24) and a Flow dropdown item too. */
const BUTTON_CAP = 20;
const cp = (s) => [...s].length;

describe('the label maps cover the seeded reference tables exactly', () => {
  it('has a label for every seeded grade code, and no extras', () => {
    expect(Object.keys(GRADE_LABELS).sort()).toEqual(seededCodes('grade_levels').sort());
  });

  it('has a label for every seeded subject code, and no extras', () => {
    expect(Object.keys(SUBJECT_LABELS).sort()).toEqual(seededCodes('subjects').sort());
  });

  it('covers all 13 grades and 6 subjects', () => {
    expect(Object.keys(GRADE_LABELS)).toHaveLength(13);
    expect(Object.keys(SUBJECT_LABELS)).toHaveLength(6);
  });
});

describe('every label exists in every offered language', () => {
  it.each(LANGUAGE_OFFER)('grades are complete in %s', (lang) => {
    for (const [code, variants] of Object.entries(GRADE_LABELS)) {
      expect(typeof variants[lang]).toBe('string');
      expect(variants[lang].trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LANGUAGE_OFFER)('subjects are complete in %s', (lang) => {
    for (const [code, variants] of Object.entries(SUBJECT_LABELS)) {
      expect(typeof variants[lang]).toBe('string');
      expect(variants[lang].trim().length).toBeGreaterThan(0);
    }
  });

  it('does not fall back to the English string for Urdu', () => {
    // A map that "covers" ur by copying en is the partial-map failure wearing a
    // disguise: it looks complete and reads as broken to the teacher.
    const copied = Object.entries(GRADE_LABELS)
      .filter(([, v]) => v.en === v.ur)
      .map(([code]) => code);
    expect(copied).toEqual([]);
  });
});

describe('field caps, measured in code points', () => {
  const rows = [];
  for (const [code, variants] of Object.entries(GRADE_LABELS)) {
    for (const lang of LANGUAGE_OFFER) rows.push([`grade:${code}:${lang}`, variants[lang]]);
  }
  for (const [code, variants] of Object.entries(SUBJECT_LABELS)) {
    for (const lang of LANGUAGE_OFFER) rows.push([`subject:${code}:${lang}`, variants[lang]]);
  }

  it.each(rows)('%s fits the 20-code-point button cap', (_label, text) => {
    expect(cp(text)).toBeLessThanOrEqual(BUTTON_CAP);
  });

  it('measures code points, not UTF-16 units', () => {
    // Guard the guard: if this ever used .length, an Urdu label near the cap
    // would pass here and fail at Meta.
    expect(cp('⁴ A')).toBe(3);
  });
});

describe('gradeLabelFor / subjectLabelFor', () => {
  it('returns the Urdu label for an Urdu teacher', () => {
    expect(gradeLabelFor('grade_4', { preferred_language: 'ur' })).toBe(GRADE_LABELS.grade_4.ur);
  });

  it('returns the English label for an English teacher', () => {
    expect(gradeLabelFor('grade_4', { preferred_language: 'en' })).toBe(GRADE_LABELS.grade_4.en);
  });

  it('accepts a bare language code as well as a user row', () => {
    expect(subjectLabelFor('maths', 'ur')).toBe(SUBJECT_LABELS.maths.ur);
  });

  it('clamps an unoffered language to the floor rather than returning undefined', () => {
    expect(gradeLabelFor('grade_4', 'sw')).toBe(GRADE_LABELS.grade_4.en);
  });

  it('returns null for an unknown code rather than a blank row', () => {
    // A picker rendering '' is worse than a caller that can skip the row.
    expect(gradeLabelFor('grade_99', 'en')).toBeNull();
    expect(subjectLabelFor('islamiat', 'en')).toBeNull();
  });
});

describe('shift labels', () => {
  const { SHIFT_LABELS, shiftLabelFor } = require('../../bot/shared/config/ux-strings');

  it('covers every seeded shift code, and no extras', () => {
    expect(Object.keys(SHIFT_LABELS).sort()).toEqual(seededCodes('shifts').sort());
  });

  it.each(LANGUAGE_OFFER)('is complete in %s', (lang) => {
    for (const variants of Object.values(SHIFT_LABELS)) {
      expect(typeof variants[lang]).toBe('string');
      expect(variants[lang].trim().length).toBeGreaterThan(0);
    }
  });

  it('does not fall back to the English string for Urdu', () => {
    expect(Object.entries(SHIFT_LABELS).filter(([, v]) => v.en === v.ur)).toEqual([]);
  });

  it.each(Object.entries(SHIFT_LABELS).flatMap(([code, v]) =>
    LANGUAGE_OFFER.map((l) => [`${code}:${l}`, v[l]])))(
    '%s fits the 20-code-point button cap', (_k, text) => {
      expect(cp(text)).toBeLessThanOrEqual(BUTTON_CAP);
    });

  it('resolves for a teacher', () => {
    expect(shiftLabelFor('evening', { preferred_language: 'ur' })).toBe(SHIFT_LABELS.evening.ur);
    expect(shiftLabelFor('nope', 'en')).toBeNull();
  });
});

describe('sections need no label map', () => {
  it('is seeded A-E, rendered as the code itself', () => {
    expect(seededCodes('sections')).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
