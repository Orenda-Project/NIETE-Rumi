import { describe, it, expect } from 'vitest';
import { fdeGuide, marksMix } from './fdeLevelGuide';

/**
 * ICT sheet, Assessment Generator row 7 point 7 (Hashir, RM; Amena 21 Nov): the editor shows FDE's expected thinking-level
 * mix for the paper's grade and subject, to compare against. Grades 1-4 from FDE's Assessment Scheme 2023-24 and its
 * per-subject Tables of Specification; Grade 5 from FDE's Grade V model papers (CAE 2026). Shares of marks, in three
 * bands (Apply takes Apply and every level above it, as FDE's tables do for these grades). No FDE table, no guide.
 */
describe('fdeGuide', () => {
  it.each([
    [5, 'maths', [10, 50, 40]],
    [5, 'english', [40, 30, 30]],
    [5, 'social_studies_en', [30, 40, 30]],
    [4, 'maths', [10, 60, 30]],
    [4, 'social_studies', [35, 30, 35]],
    [3, 'general_knowledge', [41, 41, 18]],
    [3, 'english', [30, 30, 40]],
    [2, 'urdu', [40, 40, 20]],
    [1, 'maths', [20, 50, 30]],
    [1, 'islamiat', [40, 40, 20]],
  ])('grade %i %s', (grade, subject, [r, u, a]) => {
    const g = fdeGuide(grade, subject)!;
    expect([g.Remember, g.Understand, g.Apply]).toEqual([r, u, a]);
    expect(g.Remember + g.Understand + g.Apply).toBe(100);
  });

  it('names its source', () => {
    expect(fdeGuide(5, 'maths')!.source).toMatch(/Grade V model papers/);
    expect(fdeGuide(2, 'english')!.source).toMatch(/2023-24/);
  });

  it('is absent where FDE gave no table: Grades 6-12, a subject FDE does not set at that grade, no grade', () => {
    expect(fdeGuide(6, 'maths')).toBeNull();
    expect(fdeGuide(2, 'science')).toBeNull();
    expect(fdeGuide(null, 'maths')).toBeNull();
    expect(fdeGuide(5, '')).toBeNull();
  });

  it('reads the subject as the bot names it', () => {
    expect(fdeGuide(5, 'Math')).toEqual(fdeGuide(5, 'maths'));
    expect(fdeGuide(4, 'genk')).toBeNull();
    expect(fdeGuide(1, 'genk')).toEqual(fdeGuide(1, 'general_knowledge'));
  });
});

describe('marksMix', () => {
  it('shares of marks in three bands, Apply taking every level above it', () => {
    expect(marksMix([
      { blooms: 'Remember', marks: 1 }, { blooms: 'Understand', marks: 2 }, { blooms: 'Apply', marks: 3 },
      { blooms: 'Analyze', marks: 2 }, { blooms: 'Create', marks: 2 },
    ])).toEqual({ Remember: 10, Understand: 20, Apply: 70 });
  });

  it('leaves untagged questions out, and is null when nothing carries a level or marks', () => {
    expect(marksMix([{ blooms: 'Remember', marks: 1 }, { marks: 3 }])).toEqual({ Remember: 100, Understand: 0, Apply: 0 });
    expect(marksMix([{ marks: 3 }])).toBeNull();
    expect(marksMix([{ blooms: 'Remember', marks: 0 }])).toBeNull();
  });
});
