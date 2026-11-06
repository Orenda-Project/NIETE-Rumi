/**
 * bd-5jmnfj.38.31 — Grades 6-12 free-mode rules: the band limits, the paper sized to its time, and the
 * rules block placed before the safety policies (safety stays last).
 */
const R = require('../../bot/shared/services/assessment/free-secondary-rules');
const { printedMinutes } = require('../../bot/shared/services/assessment/free-secondary-checks');

const types = (spec) => spec.map(([id, count, category]) => ({ id, count, category }));

describe('bandOf', () => {
  it('gives G6-8 the 14-word sentence and 25-word MCQ-stem limits', () => {
    expect(R.bandOf(7)).toMatchObject({ sentence: 14, mcqStem: 25 });
    expect(R.bandOf('8')).toMatchObject({ sentence: 14, mcqStem: 25 });
  });
  it('gives G9-10 and G11-12 their own limits', () => {
    expect(R.bandOf(9)).toMatchObject({ sentence: 17, mcqStem: 35 });
    expect(R.bandOf(12)).toMatchObject({ sentence: 20, mcqStem: 45 });
  });
});

describe('sizeTypes', () => {
  const counts = (out) => out.map((t) => [t.id, t.count]);
  const budget = Math.floor(60 * R.LOAD_SHARE);

  it('keeps the G7 a5 request 7/7/6 in proportion: it must not become 16/3/1', () => {
    const asked = types([['mcq', 7, 'objective'], ['srq', 7, 'subjective'], ['erq', 6, 'subjective']]);
    const { types: out, dropped } = R.sizeTypes(asked, 7);
    expect(counts(out)).not.toEqual([['mcq', 16], ['srq', 3], ['erq', 1]]);
    expect(R.plannedMinutes(out)).toBeLessThanOrEqual(budget);
    expect(printedMinutes(R.plannedMinutes(out))).toBeLessThanOrEqual(60);
    out.forEach((t, i) => expect(t.count).toBeLessThanOrEqual(asked[i].count));
    const shares = out.map((t, i) => t.count / asked[i].count);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(0.2);
    expect(out[2].count).toBeGreaterThanOrEqual(1);
    expect(dropped).toBe(20 - out.reduce((s, t) => s + t.count, 0));
  });

  it('shrinks the G8 Urdu mix (mcq, srq, grammar) in proportion too', () => {
    const asked = types([['mcq', 7, 'objective'], ['srq', 7, 'subjective'], ['grammar', 6, 'subjective']]);
    const { types: out } = R.sizeTypes(asked, 8);
    expect(R.plannedMinutes(out)).toBeLessThanOrEqual(budget);
    const shares = out.map((t, i) => t.count / asked[i].count);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(0.2);
  });

  it('keeps at least two written items, and every picked type at one or more', () => {
    const { types: out } = R.sizeTypes(types([['mcq', 40, 'objective'], ['srq', 2, 'subjective']]), 7);
    expect(counts(out)).toEqual([['mcq', 36], ['srq', 2]]);
    const { types: one } = R.sizeTypes(types([['mcq', 3, 'objective'], ['srq', 1, 'subjective'], ['erq', 9, 'subjective']]), 7);
    expect(one.every((t) => t.count >= 1)).toBe(true);
    expect(one[2].count).toBeGreaterThanOrEqual(1);
  });

  it('leaves a paper that already fits as it was', () => {
    const fits = types([['mcq', 10, 'objective'], ['srq', 2, 'subjective']]);
    expect(R.sizeTypes(fits, 7)).toEqual({ types: fits, dropped: 0 });
  });

  it('does not mutate its input', () => {
    const input = types([['mcq', 7, 'objective'], ['erq', 6, 'subjective']]);
    R.sizeTypes(input, 7);
    expect(input[1].count).toBe(6);
  });
});

describe('withRules', () => {
  const SAFETY = '\n### SAFETY POLICIES\nbe safe';
  it('puts the rules block before the safety policies, which stay last', () => {
    const out = R.withRules(`BASE${SAFETY}`, SAFETY, 7);
    expect(out.startsWith('BASE')).toBe(true);
    expect(out.endsWith(SAFETY)).toBe(true);
    expect(out).toContain('GRADES 6-12 RULES');
    expect(out).toContain('at most 14 words');
  });
  it('appends the block when the safety text is not at the end', () => {
    const out = R.withRules('BASE', SAFETY, 9);
    expect(out.startsWith('BASE')).toBe(true);
    expect(out).toContain('at most 17 words');
  });
});

describe('rulesBlock', () => {
  const text = R.rulesBlock(7);
  it('asks every written item for a 2-3 level band, an accept line and a do-not-accept line', () => {
    expect(text).toContain('"mark_bands"');
    expect(text).toMatch(/full \/ partial \/ none/);
    expect(text).toContain('"reject"');
  });
  it.each([
    ['marking points per item', /"marking_points"/],
    ['mark bands for extended answers', /"mark_bands"/],
    ['the key is not the longest option', /NOT the longest option/],
    ['distractors are misconceptions', /misconception/],
    ['no item answers another', /answer to another item/],
    ['the lesson subject is asked about', /main subject of the lesson/],
    ['a meaning or quality MCQ has no opposite of the key among its distractors', /meaning or a quality[^\n]*opposite/],
    ['a level tag on every item and part', /"blooms"[^\n]*every item/],
    ['a thinking-level target with some Application', /Apply[^\n]*20%/],
  ])('states %s', (_name, re) => {
    expect(text).toMatch(re);
  });
});

describe('fixNote', () => {
  it('lists each problem by question number and asks for the whole paper back', () => {
    const note = R.fixNote([{ n: 3, check: 'longest-key', text: 'the key is the longest option' }]);
    expect(note).toContain('Q3');
    expect(note).toContain('the key is the longest option');
    expect(note).toMatch(/whole paper/i);
  });
});

describe('the lesson title', () => {
  it('names the lesson and asks for two items about it when the title is known', () => {
    const text = R.rulesBlock(8, 'عبدالستار ایدھی');
    expect(text).toContain('"عبدالستار ایدھی"');
    expect(text).toMatch(/At least two items/);
    expect(R.withRules('BASE', '', 8, 'Plant System')).toContain('"Plant System"');
  });
  it('says nothing extra without a title', () => {
    expect(R.rulesBlock(8)).not.toMatch(/The lesson is "/);
  });
  it('lists a paper-wide problem without a question number', () => {
    const note = R.fixNote([{ n: 0, check: 'lesson-subject', text: 'no item names the lesson' }]);
    expect(note).toContain('- Whole paper: no item names the lesson');
  });
});
