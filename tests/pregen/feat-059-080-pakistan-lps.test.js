/**
 * FEAT-059 + FEAT-080 seed script — asserts the row shape the picker Flow
 * and the PreGenLookupService both depend on. Bot-only deps are virtualised
 * so this test runs in the root-before-bot-ci sequence.
 */

describe('FEAT-059 + FEAT-080 seed constants', () => {
  let seed;

  beforeAll(() => {
    // Virtualise the two side-effect-ful requires at the top of the seed
    // script (dotenv + supabase) so this test can import it without touching
    // real env or DB.
    jest.doMock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
        }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }));
    seed = require('../../bot/scripts/seed-feat059-feat080-pakistan-lps');
  });

  it('has 11 primary rows across grades 1, 2, 3', () => {
    expect(seed.PRIMARY).toHaveLength(11);
    const grades = new Set(seed.PRIMARY.map(r => r.grade));
    expect([...grades].sort()).toEqual([1, 2, 3]);
  });

  it('has 12 method-comparison rows: G6 × 4, G7 × 4, G9 × 4', () => {
    expect(seed.METHODS).toHaveLength(12);
    const byGrade = seed.METHODS.reduce((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1;
      return acc;
    }, {});
    expect(byGrade).toEqual({ 6: 4, 7: 4, 9: 4 });
  });

  it('primary rows tag curriculum="pakistan" and point at R2 pregen keys', () => {
    for (const r of seed.PRIMARY) {
      const row = seed.primaryRow(r);
      expect(row.curriculum).toBe('pakistan');
      expect(row.generation_status).toBe('completed');
      expect(row.pdf_r2_key_en).toMatch(/^lesson_plans\/pakistan\/pregen\//);
    }
  });

  it('method rows tag curriculum="pakistan_methods" and encode grade*100+method into chapter_number', () => {
    for (const r of seed.METHODS) {
      const row = seed.methodRow(r);
      expect(row.curriculum).toBe('pakistan_methods');
      expect(row.chapter_number).toBe(r.grade * 100 + r.method_index);
      expect(row.pdf_r2_key_en).toMatch(/^lesson_plans\/pakistan\/pregen\/method_comparison\//);
    }
  });

  it('every (curriculum, grade, subject, chapter_number) tuple is unique across the 23 rows', () => {
    const rows = [
      ...seed.PRIMARY.map(seed.primaryRow),
      ...seed.METHODS.map(seed.methodRow),
    ];
    const keys = rows.map(r => `${r.curriculum}|G${r.grade}|${r.subject}|ch${r.chapter_number}`);
    expect(new Set(keys).size).toBe(rows.length);
  });

  it('R2 keys are unique — no two rows point at the same PDF', () => {
    const rows = [
      ...seed.PRIMARY.map(seed.primaryRow),
      ...seed.METHODS.map(seed.methodRow),
    ];
    const keys = rows.map(r => r.pdf_r2_key_en);
    expect(new Set(keys).size).toBe(rows.length);
  });
});
