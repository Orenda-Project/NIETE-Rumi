/**
 * The sandbox seed for the child-test simulation must never write to a production database, and
 * never write without being told to.
 */
const { assertSandbox, planSeed, SIM_PREFIX } = require('../../../scripts/child-test/seed-sandbox');

describe('assertSandbox', () => {
  const ok = { SUPABASE_URL: 'https://olvritwoqujtjvwfulbh.supabase.co', DATABASE_URL: 'postgres://x@db.olvritwoqujtjvwfulbh.supabase.co/postgres' };
  test.each([
    ['NIETE production in SUPABASE_URL', { ...ok, SUPABASE_URL: 'https://ihzciabopbttygxxgrkm.supabase.co' }],
    ['NIETE production in DATABASE_URL', { ...ok, DATABASE_URL: 'postgres://u@db.ihzciabopbttygxxgrkm.supabase.co/p' }],
    ['Rumi production', { ...ok, SUPABASE_URL: 'https://jlpenspfdcwxkopaidys.supabase.co' }],
    ['no SUPABASE_URL', { DATABASE_URL: ok.DATABASE_URL }],
  ])('refuses %s', (_label, env) => {
    expect(() => assertSandbox(env, ['--yes-write'])).toThrow(/refus/i);
  });
  test('refuses without --yes-write', () => {
    expect(() => assertSandbox(ok, [])).toThrow(/--yes-write/);
  });
  test('accepts sandbox with --yes-write and names the project', () => {
    expect(assertSandbox(ok, ['--yes-write'])).toEqual({ ref: 'olvritwoqujtjvwfulbh' });
  });
});

describe('planSeed', () => {
  test('a SIM school with Grade 3 and Grade 5 classes of 25, roll numbers 1-25, placeholder names', () => {
    const p = planSeed({ sessionCode: '2026-2027' });
    expect(p.school.name.startsWith(SIM_PREFIX)).toBe(true);
    expect(p.school.is_probable_test).toBe(true);
    expect(p.classes.map((c) => c.grade_code)).toEqual(['grade_3', 'grade_5']);
    for (const c of p.classes) {
      expect(c.children).toHaveLength(25);
      expect(c.children.map((k) => k.roll_number)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    }
    expect(p.classes[0].children[6].student_name).toBe('Child 3A-07');
    expect(p.classes[1].children[24].student_name).toBe('Child 5A-25');
    expect(p.coach).toMatchObject({ role: 'coach', is_test_user: true });
  });
});
