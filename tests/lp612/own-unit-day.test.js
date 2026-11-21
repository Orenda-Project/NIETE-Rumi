/**
 * bd-snkn32.59 (queue #165) — a unit day's context rides in the own plan's answers (answers.unit, JSONB, no new
 * column — the answers.extend pattern): checked on the way in, then turned into prompt lines and her period.
 */
const U = require('../../bot/shared/services/lp-own-unit-day');
const I = require('../../bot/shared/services/lp612-own-instruction');

const unit = (over = {}) => ({
  unit_id: '0b6c1d9e-3f43-4c1e-9d55-1c7f1f1b2a10', day_no: 4, of: 21, kind: 'lesson', period: 35,
  lessons: ['grade_3_math_ch2_seg4'], recap: 'Addition word problems (CUBES)', ...over,
});

describe('parseUnit', () => {
  it('keeps a well-formed unit day', () => {
    expect(U.parseUnit(unit(), 'grade_3_math_ch2_seg4')).toEqual({ ok: true, unit: unit() });
  });
  it.each([
    [{ unit_id: 'x' }],
    [{ day_no: 0 }],
    [{ day_no: 22 }],
    [{ kind: 'test' }],
    [{ period: 10 }],
    [{ lessons: [] }],
    [{ lessons: ['grade_3_math_ch2_seg9'] }],
    [{ part: 3 }],
    [{ recap: 'x'.repeat(400) }],
  ])('refuses %j', (over) => {
    expect(U.parseUnit(unit(over), 'grade_3_math_ch2_seg4').ok).toBe(false);
  });
  it('drops unknown keys', () => {
    expect(U.parseUnit({ ...unit(), evil: 1 }, 'grade_3_math_ch2_seg4').unit.evil).toBeUndefined();
  });
});

describe('parseOwnAnswers passes a checked unit through (grades 1-5 only)', () => {
  const base = { size: '31_50', level: 'on_track', way: 'cpa', resources: ['textbook'] };
  it('keeps it', () => {
    const r = I.parseOwnAnswers({ ...base, unit: unit() }, { lessonId: 'grade_3_math_ch2_seg4' });
    expect(r.ok).toBe(true);
    expect(r.answers.unit).toEqual(unit());
  });
  it('a bad one is a bad request', () => {
    expect(I.parseOwnAnswers({ ...base, unit: unit({ period: 5 }) }, { lessonId: 'grade_3_math_ch2_seg4' }).ok).toBe(false);
  });
});

describe('withUnitPeriod + unitLines', () => {
  it('the day is planned for HER period', () => {
    const s = { meta: { day: 4, minutes: 40 }, iDo: {} };
    expect(U.withUnitPeriod(s, unit()).meta.minutes).toBe(35);
    expect(s.meta.minutes).toBe(40);
    expect(U.withUnitPeriod(s, null)).toBe(s);
  });
  it('says the day of the unit and asks for yesterday\'s 3-minute recap', () => {
    const t = U.unitLines(unit()).join('\n');
    expect(t).toContain('Day 4 of 21');
    expect(t).toContain('3-minute recap');
    expect(t).toContain('Addition word problems (CUBES)');
  });
  it('a practice day: no new content', () => {
    expect(U.unitLines(unit({ kind: 'practice' })).join('\n')).toMatch(/PRACTICE day.*no new content/);
  });
  it('a joined day names the second book day; a split day says its part', () => {
    const topicOf = (id) => (id === 'grade_3_math_ch2_seg5' ? 'Subtraction with and without regrouping' : null);
    expect(U.unitLines(unit({ lessons: ['grade_3_math_ch2_seg4', 'grade_3_math_ch2_seg5'] }), { topicOf }).join('\n')).toContain('Subtraction with and without regrouping');
    expect(U.unitLines(unit({ part: 1 })).join('\n')).toMatch(/part 1 of 2/);
    expect(U.unitLines(unit({ part: 2 })).join('\n')).toMatch(/part 2 of 2/);
  });
  it('the rewrite sends the unit lines first and the day at HER period (one model call per round)', async () => {
    const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');
    const seen = [];
    const client = { chat: { completions: { create: async (req) => { seen.push(req.messages); return { choices: [{ message: { content: 'not json' } }] }; } } } };
    const answers = { size: '31_50', level: 'on_track', way: 'cpa', resources: ['textbook'], note: '', unit: unit() };
    const script = { meta: { day: 4, minutes: 40 }, goal: 'g', hook: {}, iDo: {}, weDo: {}, youDo: {}, wrap: {} };
    await rewriteK5({ script, answers, lang: 'en', grade: 3, subject: 'math', client, model: 'm' });
    const user = seen[0][1].content;
    expect(user.startsWith('This is Day 4 of 21')).toBe(true);
    expect(user).toContain('"minutes":35');
    expect(script.meta.minutes).toBe(40);
  });
  it('withUnitLines leaves a plan without a unit as it was', () => {
    const m = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
    expect(U.withUnitLines(m, undefined)).toBe(m);
  });
});
