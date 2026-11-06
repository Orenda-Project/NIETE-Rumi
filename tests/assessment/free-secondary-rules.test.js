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

describe('sizeTypes (the requested count is kept: a7 ruling on A5e)', () => {
  const counts = (out) => out.map((t) => [t.id, t.count]);
  const total = (out) => out.reduce((s, t) => s + t.count, 0);
  const budget = Math.floor(60 * R.LOAD_SHARE);

  it('keeps the G7 request 7/7/6 at 20 items: MCQs as asked, extended answers become short ones, at least one stays', () => {
    const asked = types([['mcq', 7, 'objective'], ['srq', 7, 'subjective'], ['erq', 6, 'subjective']]);
    const out = R.sizeTypes(asked, 7);
    expect(total(out.types)).toBe(20);
    expect(out.types[0].count).toBe(7);
    expect(out.types[2].count).toBeGreaterThanOrEqual(1);
    expect(out.types[2].count).toBeLessThan(6);
    expect(out.types[1].count).toBe(7 + out.converted);
    expect(out.light).toBe(true);
  });

  it('converts only as many extended answers as the time needs, with full marks when that fits', () => {
    const out = R.sizeTypes(types([['mcq', 10, 'objective'], ['srq', 2, 'subjective'], ['erq', 3, 'subjective']]), 7);
    expect(counts(out.types)).toEqual([['mcq', 10], ['srq', 4], ['erq', 1]]);
    expect(out).toMatchObject({ converted: 2, light: false });
    expect(R.plannedMinutes(out.types)).toBeLessThanOrEqual(budget);
  });

  it('adds a short-answer type when the request had none to convert into', () => {
    const out = R.sizeTypes(types([['mcq', 10, 'objective'], ['erq', 3, 'subjective']]), 7);
    expect(counts(out.types)).toEqual([['mcq', 10], ['srq', 1], ['erq', 2]]);
    expect(out.types[1].category).toBe('subjective');
  });

  it('keeps the G8 Urdu mix (mcq, srq, grammar) as asked and lowers the marks per written item to fit', () => {
    const asked = types([['mcq', 7, 'objective'], ['srq', 7, 'subjective'], ['grammar', 6, 'subjective']]);
    const out = R.sizeTypes(asked, 8);
    expect(counts(out.types)).toEqual([['mcq', 7], ['srq', 7], ['grammar', 6]]);
    expect(out).toMatchObject({ converted: 0, light: true });
    expect(R.plannedMinutes(out.types, true)).toBeLessThanOrEqual(budget);
  });

  it('never goes below the requested total, even when nothing makes it fit', () => {
    const out = R.sizeTypes(types([['mcq', 30, 'objective'], ['srq', 20, 'subjective']]), 7);
    expect(counts(out.types)).toEqual([['mcq', 30], ['srq', 20]]);
    expect(out.light).toBe(true);
  });

  it('leaves a paper that already fits as it was', () => {
    const fits = types([['mcq', 10, 'objective'], ['srq', 2, 'subjective']]);
    expect(R.sizeTypes(fits, 7)).toEqual({ types: fits, converted: 0, light: false });
  });

  it('does not mutate its input', () => {
    const input = types([['mcq', 7, 'objective'], ['srq', 7, 'subjective'], ['erq', 6, 'subjective']]);
    R.sizeTypes(input, 7);
    expect(input.map((t) => t.count)).toEqual([7, 7, 6]);
  });
});

describe('rulesBlock with lighter written items', () => {
  it('asks for 2-mark short answers and 3-mark extended answers when the paper is light', () => {
    const text = R.rulesBlock(7, null, { light: true });
    expect(text).toMatch(/Short answer 2 marks/);
    expect(text).toMatch(/Extended answer 3 marks/);
    expect(R.rulesBlock(7)).toMatch(/Short answer 3 marks/);
    expect(R.withRules('BASE', '', 7, null, { light: true })).toMatch(/Short answer 2 marks/);
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
    ['the panel split 30/30/20/10/10 with Create', /30% Remember, 30% Understand, 20% Apply, 10% Analyze or Evaluate and 10% Create/],
    ['a level per part of an item in parts', /"part_levels"/],
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
