/**
 * bd-snkn32.56 — a goal start's answers and instruction. The goal rides in her answers (JSONB, no new column); with
 * it, the class has no textbook, so every "book page" line of the ordinary instruction gives way to the goal's lines.
 */
const { parseOwnAnswers, buildOwnInstruction, MATERIALS_LINE } = require('../../bot/shared/services/lp612-own-instruction');

const ctx = { grade: 7, segmentId: 'grade_7_general_science.c01.p001-004', subject: 'General Science' };
const base = { size: '51_70', resources: ['board'], level: 'mixed', way: 'think_aloud', note: '' };
const goal = { kind: 'topic', text: 'Rain and the water cycle' };

const way = (() => {
  // the first grade-7 way the parser accepts
  for (const w of ['explain_model', 'think_aloud', 'inquiry', 'discussion', 'tarl', 'story']) {
    if (parseOwnAnswers({ ...base, way: w }, ctx).ok) return w;
  }
  throw new Error('no grade 7 way');
})();

describe('parseOwnAnswers with a goal', () => {
  it('keeps her goal and drops the textbook from what she has', () => {
    const out = parseOwnAnswers({ ...base, way, goal }, ctx);
    expect(out.ok).toBe(true);
    expect(out.answers.goal).toEqual(goal);
    expect(out.answers.resources).toEqual(['board']);
  });
  it('refuses a bad goal', () => {
    expect(parseOwnAnswers({ ...base, way, goal: { kind: 'topic', text: 'x' } }, ctx).ok).toBe(false);
  });
  it('refuses a goal for grades 1-5 (6-12 first)', () => {
    expect(parseOwnAnswers({ ...base, way: 'tarl', goal }).ok).toBe(false);
  });
  it('without a goal, answers are as before', () => {
    const out = parseOwnAnswers({ ...base, way }, ctx);
    expect(out.answers.goal).toBeUndefined();
    expect(out.answers.resources).toEqual(['textbook', 'board']);
  });
});

describe('buildOwnInstruction with a goal', () => {
  const answers = parseOwnAnswers({ ...base, way, goal }, ctx).answers;
  const text = buildOwnInstruction(answers, { ...ctx, bookText: 'PAGE TEXT FROM HER BOOK' });

  it('names her goal and says the class has no textbook', () => {
    expect(text).toContain('"Rain and the water cycle"');
    expect(text).toMatch(/NO TEXTBOOK/);
  });
  it('drops every line that sends the class to the book', () => {
    expect(text).not.toMatch(/Keep the same pages/);
    expect(text).not.toMatch(/still names the book page/);
    expect(text).not.toContain(MATERIALS_LINE);
    expect(text).not.toContain('PAGE TEXT FROM HER BOOK');
  });
  it('keeps her class, one period and I do / We do / You do', () => {
    expect(text).toMatch(/31 to 50|51 to 70/);
    expect(text).toMatch(/ONE class period/);
    expect(text).toMatch(/I do/);
  });
});
