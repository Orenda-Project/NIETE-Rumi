/**
 * The four FBISE entries (ssc1, ssc2, hssc1, hssc2; 2027) against the 55 real-paper fixtures: for every
 * fixture the built subject/variant must agree on section marks, slot kinds, printed/attempt counts,
 * marks_each x4, OR flags, answer sheet, times and MCQ share. Pending cells are asserted pending.
 */
const fs = require('fs');
const path = require('path');
const { validatePattern } = require('../../../bot/shared/services/assessment/patterns/board/validate');

const DIR = path.join(__dirname, '..', 'fixtures', 'board');
const ENTRIES = {
  fbise_ssc1_2027: require('../../../bot/shared/services/assessment/patterns/board/fbise-ssc1'),
  fbise_ssc2_2027: require('../../../bot/shared/services/assessment/patterns/board/fbise-ssc2'),
  fbise_hssc1_2027: require('../../../bot/shared/services/assessment/patterns/board/fbise-hssc1'),
  fbise_hssc2_2027: require('../../../bot/shared/services/assessment/patterns/board/fbise-hssc2'),
};
// Subjects whose pattern cannot be shipped faithfully: the fixture is asserted pending instead (never invented).
const PENDING = { fbise_ssc1_2027: ['computer_science'] };
// A fixture 'other' is a numbered item the source does not type; it may build as any of these (never as a stimulus MCQ).
const OTHER_OK = ['srq', 'explanation_prose', 'explanation_poem', 'explanation_ghazal'];
const fixtures = fs.readdirSync(DIR).filter((f) => f.startsWith('fbise_')).sort().map((f) => [f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]);
const X4 = (m) => Math.round(m * 4);

test('there are 55 fixtures and four entries', () => {
  expect(fixtures).toHaveLength(55);
  expect(Object.keys(ENTRIES)).toHaveLength(4);
});

describe.each(Object.entries(ENTRIES))('%s', (id, P) => {
  test('is a frozen board pattern that validates clean', () => {
    expect(validatePattern(P)).toEqual([]);
    expect(Object.isFrozen(P)).toBe(true);
    expect(P).toMatchObject({ id, board: 'FBISE', profile: 'board' });
  });
  test('pending cells name a reason and are never subjects', () => {
    Object.values(P.pending).forEach((p) => { expect(p.status).toBe('design_pending'); expect(p.reason.length).toBeGreaterThan(10); expect(P.subjects[p.key]).toBeUndefined(); });
  });
});

describe.each(fixtures)('fixture %s', (file, fx) => {
  const P = ENTRIES[fx.pattern];
  if ((PENDING[fx.pattern] || []).includes(fx.subject)) {
    test('is pending, not built', () => {
      expect(P.subjects[fx.subject]).toBeUndefined();
      expect(P.pending[fx.subject]).toMatchObject({ status: 'design_pending' });
      expect(P.pending[fx.subject].reason).toBeTruthy();
    });
    return;
  }
  test('built subject and variant agree with the fixture', () => {
    const S = P.subjects[fx.subject];
    expect(S).toBeDefined();
    const V = S.variants.find((v) => v.variant_id === fx.variant);
    expect(V).toBeDefined();
    expect(X4(V.total_marks)).toBe(fx.total_marks_x4);
    expect(V.total_time_min).toBe(fx.total_time_min);
    expect(V.shared_time_min).toBe(fx.shared_time_min);
    expect(V.sections.map((s) => s.id)).toEqual(fx.sections.map((s) => s.id));
    expect(V.sections[0].time_min).toBe(fx.time_a_min);
    expect(V.shared_sections).toEqual(fx.sections.slice(1).map((s) => s.id));
    fx.sections.forEach((fs_, i) => {
      const s = V.sections[i];
      expect(s.marks_x4).toBe(fs_.marks_x4);
      expect(s.answer_on).toBe(fs_.answer_on);
      expect(s.time_min).toBe(fs_.time_min);
      expect(s.slots).toHaveLength(fs_.slots.length);
      fs_.slots.forEach((f, j) => {
        const b = s.slots[j];
        if (f.kind === 'other') expect(OTHER_OK).toContain(b.type); else expect(b.type).toBe(f.kind);
        expect([b.printed, b.attempt, b.marks_x4]).toEqual([f.printed, f.attempt, f.marks_each_x4]);
        expect(b.prompt_rule === 'internal_or').toBe(f.or);
        expect(b.stimulus ? { count: b.stimulus.count, mcqs_per_stimulus: b.stimulus.mcqs_per_stimulus } : null).toEqual(f.stimulus);
      });
    });
    const objective = V.sections.flatMap((s) => s.slots).filter((s) => s.type === 'mcq' || s.type === 'scenario').reduce((n, s) => n + s.total_x4, 0);
    expect((100 * objective) / fx.total_marks_x4).toBeCloseTo(fx.mcq_share_pct, 5);
  });
});

test('off-year term papers use the term header (P7) and every other paper the board header', () => {
  const term = [['fbise_ssc1_2027', 'pakistan_studies_ur'], ['fbise_ssc2_2027', 'islamiat']];
  term.forEach(([id, key]) => {
    const V = ENTRIES[id].subjects[key].variants[0];
    expect(V.variant_id).toBe('term');
    expect(V.exam_header.lines_en[0]).toMatch(/^Term Examination \(FBISE SSC-II? pattern\)$/);
  });
  expect(ENTRIES.fbise_hssc1_2027.subjects.maths.variants[0].exam_header.lines_en[0]).toBe('Federal Board HSSC-I Examination');
});
