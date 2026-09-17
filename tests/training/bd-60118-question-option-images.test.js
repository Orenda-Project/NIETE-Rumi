/**
 * bd-60118 — questions whose OPTIONS are images.
 *
 * I-SAPS M1 summative item 1.6 ships its four choices as a single embedded
 * picture: a 2x2 grid of lesson-plan drafts the teacher has to compare. There
 * is no option text to extract, so the item landed in sandbox with
 * `options: []` and could never be answered.
 *
 * WhatsApp interactive options are text rows, and that is not going to change.
 * So the images are sent as their OWN messages ahead of the question, each
 * panel stamped with the option NUMBER, and the interactive list then carries
 * plain numbered rows that line up with what the teacher just saw.
 *
 * The number, not the source letter, is what gets stamped and listed.
 * `correct_option` holds a 1-based index (bd-60116); a panel captioned "B"
 * against a button reading "2" is precisely the letter/index mismatch that made
 * every I-SAPS answer grade wrong before.
 *
 * These helpers are pure so the delivery path and the importer agree on what an
 * image-option question is, without a database or a WhatsApp client.
 */

const {
  parseOptionImages,
  hasImageOptions,
  imageOptionRows,
} = require('../../bot/shared/services/training/question-images.rules');

const R2 = 'https://r2.example.com/digital-coach-audio/training/rehosted/i-saps/'
  + 'level-1/question-images/m1-item-1-6';

const FOUR = [
  `${R2}/option-1.png`,
  `${R2}/option-2.png`,
  `${R2}/option-3.png`,
  `${R2}/option-4.png`,
];

describe('bd-60118 — parseOptionImages', () => {
  test('reads a JSON array of urls', () => {
    expect(parseOptionImages(FOUR)).toEqual(FOUR);
  });

  test('reads the same array when it arrives as a JSON string', () => {
    // PostgREST hands jsonb back as a string in some client paths.
    expect(parseOptionImages(JSON.stringify(FOUR))).toEqual(FOUR);
  });

  test('empty, null and malformed input yield an empty list, never a throw', () => {
    expect(parseOptionImages(null)).toEqual([]);
    expect(parseOptionImages(undefined)).toEqual([]);
    expect(parseOptionImages([])).toEqual([]);
    expect(parseOptionImages('')).toEqual([]);
    expect(parseOptionImages('{not json')).toEqual([]);
    expect(parseOptionImages({})).toEqual([]);
  });

  test('non-string entries are dropped rather than sent to WhatsApp', () => {
    expect(parseOptionImages([FOUR[0], 42, null, FOUR[1]])).toEqual([FOUR[0], FOUR[1]]);
  });
});

describe('bd-60118 — hasImageOptions', () => {
  test('true only when the question actually carries image urls', () => {
    expect(hasImageOptions({ option_images: FOUR })).toBe(true);
    expect(hasImageOptions({ option_images: [] })).toBe(false);
    expect(hasImageOptions({ option_images: null })).toBe(false);
    expect(hasImageOptions({})).toBe(false);
    expect(hasImageOptions(null)).toBe(false);
  });
});

describe('bd-60118 — imageOptionRows', () => {
  test('builds one numbered row per image', () => {
    const rows = imageOptionRows(FOUR, 'attempt-abc');
    expect(rows).toHaveLength(4);
    expect(rows[0].title).toBe('Option 1');
    expect(rows[3].title).toBe('Option 4');
  });

  test('row ids use the canonical 1-based index the grader expects', () => {
    // training_quiz_<attempt>_<optionIndex1based> — quiz-delivery.service:44.
    const rows = imageOptionRows(FOUR, 'attempt-abc');
    expect(rows[0].id).toBe('training_quiz_attempt-abc_1');
    expect(rows[1].id).toBe('training_quiz_attempt-abc_2');
    expect(rows[3].id).toBe('training_quiz_attempt-abc_4');
  });

  test('titles stay inside the WhatsApp row-title cap of 24 characters', () => {
    for (const r of imageOptionRows(FOUR, 'attempt-abc')) {
      expect([...r.title].length).toBeLessThanOrEqual(24);
    }
  });

  test('a description points the teacher at the picture above', () => {
    const rows = imageOptionRows(FOUR, 'attempt-abc');
    expect(rows[0].description).toMatch(/image/i);
  });

  test('no images means no rows — the caller falls back to text options', () => {
    expect(imageOptionRows([], 'a')).toEqual([]);
    expect(imageOptionRows(null, 'a')).toEqual([]);
  });
});
