/**
 * bd-17mht — writing the figure directive into `notes` must be ADDITIVE.
 *
 * 5,376 of 5,466 segment rows already carry notes written by the segmentation
 * lane, and buildUserPrompt renders that field as "obey these over your own
 * instincts". Overwriting it would silently discard every per-lesson
 * instruction the corpus carries — with no error and no failing render.
 *
 * These pin the two properties that make the write safe: the lane's own notes
 * survive, and re-running replaces the block rather than compounding it.
 */
const { stripBlock, compose, BEGIN, END } = require('../../bot/scripts/apply-lp612-figure-notes');

const BLOCK_A = `${BEGIN}\nFIGURES: draw a geometry diagram.\n${END}`;
const BLOCK_B = `${BEGIN}\nFIGURES: use ref "grade_6_geography/pg_047_f0".\n${END}`;
const LANE_NOTES =
  'Chapter opener (p11, incl. SLO checklist) folded in per rule 1. Covers 10.1 definition.';

describe('figure notes are additive', () => {
  test('keeps the segmentation lane notes and appends the block', () => {
    const out = compose(LANE_NOTES, BLOCK_A);
    expect(out).toContain(LANE_NOTES);
    expect(out).toContain('draw a geometry diagram');
    expect(out.indexOf(LANE_NOTES)).toBeLessThan(out.indexOf(BEGIN));
  });

  test('re-running REPLACES the block instead of compounding it', () => {
    const once = compose(LANE_NOTES, BLOCK_A);
    const twice = compose(once, BLOCK_B);
    expect(twice).toContain(LANE_NOTES);
    expect(twice).toContain('grade_6_geography/pg_047_f0');
    expect(twice).not.toContain('draw a geometry diagram');
    // exactly one block
    expect(twice.split(BEGIN).length - 1).toBe(1);
    expect(twice.split(END).length - 1).toBe(1);
  });

  test('is stable — applying the same block twice is a no-op', () => {
    const once = compose(LANE_NOTES, BLOCK_A);
    expect(compose(once, BLOCK_A)).toBe(once);
  });

  test('handles a row with no prior notes', () => {
    expect(compose(null, BLOCK_A)).toBe(BLOCK_A);
    expect(compose('', BLOCK_A)).toBe(BLOCK_A);
  });

  test('stripBlock leaves untouched notes alone', () => {
    expect(stripBlock(LANE_NOTES)).toBe(LANE_NOTES);
    expect(stripBlock(null)).toBe('');
  });

  test('a truncated block (no end marker) is still removed, not doubled', () => {
    const broken = `${LANE_NOTES}\n\n${BEGIN}\nhalf written`;
    const out = compose(broken, BLOCK_A);
    expect(out).toContain(LANE_NOTES);
    expect(out).not.toContain('half written');
    expect(out.split(BEGIN).length - 1).toBe(1);
  });
});
