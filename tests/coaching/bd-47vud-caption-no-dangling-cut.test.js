/**
 * bd-47vud — a photo caption that runs past the 110-char cap must end on a whole phrase.
 *
 * Seen on the staging E2E (session 72494960, 14 Sep 2026): the caption under photo 2 read
 * "From your photo: The classroom shows basic curricular materials like number charts and Urdu
 * posters on the walls, supporting." — the source was "…on the walls, supporting lesson content."
 * firstClause only breaks on critique words (", but" / ", however" / …), so a first clause with a
 * participle elaboration (", indicating …", ", supporting …", ", matching …") ran past the cap and
 * was cut at the last space. Over the 71 eval-cohort photo descriptions, 26 captions ended on a
 * dangling word ("…available and.", "…seated, indicating.").
 *
 * The descriptions below are real vision outputs, verbatim (first sentence).
 *
 *   K1  the staging E2E description ends at the comma before its participle, not mid-phrase
 *   K2  over the cap, stopped inside an elaboration → ends at the comma that opens it (", indicating/matching/including …")
 *   K3  over the cap with no comma inside it → word cut that never ends on a function word ("that", "and")
 *   K4  no real over-cap caption ends on a function word or a bare participle
 *   K5  captions that already end cleanly are unchanged (staging photo 1 as rendered today; a clause that fits)
 *   K6  no comma and no function word at the cut → plain word cut, full stop, within the cap
 *   K7  a cut inside a LIST keeps its word cut — no comma pull-back ("…, exercise books, and textbooks.")
 */
const { firstClause } = require('../../bot/shared/services/coaching/report-v2/photo-note');

const STAGING_PHOTO_2 = 'The classroom shows basic curricular materials like number charts and Urdu posters on the walls, supporting lesson content. However, routine charts and a clear daily schedule are not visible.';
const STAGING_PHOTO_1 = 'The whiteboard displays clear lesson content in Urdu, including vocabulary and polite behavior rules, reflecting alignment with curricular goals. However, there are no visible routine charts.';

const COMMA_CASES = [
  ['This classroom shows a well-organized seating arrangement with students attentively seated, indicating readiness for transitions.',
    'This classroom shows a well-organized seating arrangement with students attentively seated.'],
  ['The classroom displays a math lesson on LCM by prime factorization clearly written on the board, matching curricular expectations.',
    'The classroom displays a math lesson on LCM by prime factorization clearly written on the board.'],
  ['The classroom shows a focused learning environment with students engaged in reading textbooks, indicating alignment with curricular content.',
    'The classroom shows a focused learning environment with students engaged in reading textbooks.'],
  ['This classroom shows curriculum-aligned textbooks in use, indicating lesson materials are available and students are engaged with them.',
    'This classroom shows curriculum-aligned textbooks in use.'],
  ['The whiteboard shows a clear weekly activity plan aligned with curricular goals, including first aid and life skills, indicating lesson planning fidelity.',
    'The whiteboard shows a clear weekly activity plan aligned with curricular goals.'],
];
const NO_COMMA = 'This classroom shows active student engagement through the use of colorful student-made flashcards that reinforce lesson content visible on the whiteboard, which includes curricular topics and page references.';

const DANGLING = /\b(and|or|but|with|the|a|an|of|to|for|on|in|at|by|like|as|such|including|which|that|while|from|into|through|their|its|is|are|indicating|supporting|matching|reflecting|suggesting|showing|limiting)\.$/i;

describe('bd-47vud — over-cap captions end on a whole phrase', () => {
  test('K1: the staging E2E photo-2 description ends at the comma before its participle', () => {
    expect(firstClause(STAGING_PHOTO_2)).toBe('The classroom shows basic curricular materials like number charts and Urdu posters on the walls.');
  });

  test.each(COMMA_CASES)('K2: over the cap, inside an elaboration → ends at its comma: %s', (src, want) => {
    expect(firstClause(src)).toBe(want);
  });

  test('K3: no comma inside the cap → word cut that does not end on a function word', () => {
    expect(firstClause(NO_COMMA)).toBe('This classroom shows active student engagement through the use of colorful student-made flashcards.');
  });

  test('K4: no real over-cap caption ends on a function word or a bare participle', () => {
    for (const src of [STAGING_PHOTO_2, NO_COMMA, ...COMMA_CASES.map(([s]) => s)]) {
      const c = firstClause(src);
      expect(c).not.toMatch(DANGLING);
      expect(c.length).toBeLessThanOrEqual(111);
      expect(c.endsWith('.')).toBe(true);
    }
  });

  test('K5: captions that already end cleanly are unchanged (staging photo 1, and a clause that fits)', () => {
    expect(firstClause(STAGING_PHOTO_1)).toBe('The whiteboard displays clear lesson content in Urdu, including vocabulary and polite behavior rules.');
    expect(firstClause('The classroom shows some curricular alignment with number charts and a motivational poster, but lacks visible lesson plans.'))
      .toBe('The classroom shows some curricular alignment with number charts and a motivational poster.');
  });

  test('K6: no comma and no function word at the cut → plain word cut, full stop, within the cap', () => {
    const long = 'The board shows ' + 'alphabetletters '.repeat(12) + 'written neatly';
    const c = firstClause(long);
    expect(c.length).toBeLessThanOrEqual(111);
    expect(c).toMatch(/^The board shows (alphabetletters )*alphabetletters\.$/);
  });

  test('K7: a cut inside a list keeps its word cut — no pull-back to an earlier comma', () => {
    expect(firstClause('The classroom whiteboard displays a clear lesson plan with date, learning objectives, and a group activity aligned with Urdu writing skills, demonstrating good curricular match.'))
      .toBe('The classroom whiteboard displays a clear lesson plan with date, learning objectives, and a group activity.');
    expect(firstClause("This classroom shows evidence of lesson-related materials such as notebooks, exercise books, and textbooks on the teacher's desk, indicating alignment with curricular content."))
      .toBe('This classroom shows evidence of lesson-related materials such as notebooks, exercise books, and textbooks.');
  });
});
