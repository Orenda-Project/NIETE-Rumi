/**
 * bd-snkn32.30 — "Make my own" plans were too long for one period, worst in big classes (G3 English tester).
 * Before: the K-5 gate never checked minutes (the stored v8 days clock only I Do/We Do/You Do: 24 of 30), let a
 * rewrite run 1.3x her day plan, and gave every class size the same load; the 6-12 instruction said "same layout and
 * length" and told the model the teacher checks each child in You Do. Here: both bands ask for the period, a load that
 * shrinks with the class, and whole-class checks; the K-5 gate refuses a plan that breaks any of them.
 */
const { k5Messages, checkK5Rewrite, MAKE_GROWTH } = require('../../bot/shared/services/lp-k5-own');
const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');
const { buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');
const { YOU_DO_LINE } = require('../../bot/shared/services/lp612-own-ways');
const { LOAD } = require('../../bot/shared/services/lp-own-period');

const BIG = { size: 'over70', resources: ['textbook'], level: 'on_track', way: 'phonics', note: '' };
const SMALL = { ...BIG, size: 'up30' };

const day = () => ({
  goal: 'Blend sounds',
  meta: { day: 1, minutes: 30 },
  hook: { story: 'Whoosh!', conversation: [{ teacherAsks: 'Heard a whoosh?' }] },
  iDo: { minutes: 6, steps: [{ say: 'I blend wh.' }, { say: 'I clap it.' }] },
  weDo: { minutes: 10, action: 'Whole class blends elephants together.' },
  youDo: { minutes: 9, action: 'Each child does Activity 1 alone.', problems: [1, 2, 3].map((n) => ({ prompt: `Q${n}` })) },
  wrap: { exitOptions: [{ prompt: 'How many syllables in Sunny?' }], homework: ['Read p.39 aloud.'] },
});
const fitting = () => {
  const s = day();
  s.hook.minutes = 3; s.wrap.minutes = 2; s.youDo.problems = s.youDo.problems.slice(0, LOAD.over70.problems);
  return s;
};

describe('K-5 request: the period, the load for her class size, whole-class checks', () => {
  const user = (a) => k5Messages({ script: day(), answers: a, lang: 'en', grade: 3, subject: 'english' })[1].content;
  it('names the day\'s own period and asks for minutes on all five parts', () => {
    expect(user(BIG)).toMatch(/30 minutes/);
    expect(user(BIG)).toMatch(/hook.*iDo.*weDo.*youDo.*wrap/);
  });
  it('a big class gets a smaller load than a small class, working in the book (never naming slates: bd-snkn32.27)', () => {
    expect(user(BIG)).toContain(`at most ${LOAD.over70.steps} `);
    expect(user(SMALL)).toContain(`at most ${LOAD.up30.steps} `);
    expect(user(BIG)).toMatch(/in the book or their copies/);
    expect(user(BIG)).not.toMatch(/slates?/i);
  });
});

describe('K-5 gate on a make: only the hard rules refuse (bd-snkn32.40: the soft ones are fixed in lp-own-fit)', () => {
  const opts = { lang: 'en', resources: ['textbook'], size: 'over70', period: 30 };
  it('a plan that fits the period and the class passes', () => {
    expect(checkK5Rewrite(day(), fitting(), opts)).toEqual([]);
  });
  it('unclocked parts, minutes over the period, too many activities or more words are no longer refusals', () => {
    expect(checkK5Rewrite(day(), day(), opts)).toEqual([]);
    const over = fitting(); over.youDo.minutes = 20; over.youDo.problems = [1, 2, 3].map((n) => ({ prompt: `Q${n}` }));
    over.weDo.action += ' Then every child reads the whole page aloud again, slowly.';
    expect(checkK5Rewrite(day(), over, opts)).toEqual([]);
    expect(MAKE_GROWTH).toBeLessThanOrEqual(1);
  });
  it('a per-child teacher check is not a gate refusal (it is a repair-round reason only: lp-own-fit.repairOnly)', () => {
    const s = fitting(); s.youDo.action = 'Walk round and check each child\'s copy.';
    expect(checkK5Rewrite(day(), s, opts)).toEqual([]);
  });
  it('slates are refused in a make', () => {
    const s = fitting(); s.weDo.action = 'Children write it on slates.';
    expect(checkK5Rewrite(day(), s, opts).join(' ')).toMatch(/slates/);
  });
});

test('rewriteK5 fixes the period and the load in code: one model call, a plan that fits', async () => {
  const reply = day(); reply.youDo.problems = [1, 2, 3].map((n) => ({ prompt: `Q${n}` }));
  const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  const out = await rewriteK5({ script: day(), answers: BIG, lang: 'en', grade: 3, subject: 'english', client: { chat: { completions: { create } } }, model: 'm' });
  expect(create).toHaveBeenCalledTimes(1);
  const s = out.script;
  expect(['hook', 'iDo', 'weDo', 'youDo', 'wrap'].reduce((a, k) => a + s[k].minutes, 0)).toBe(30);
  expect(s.youDo.problems).toHaveLength(LOAD.over70.problems);
  expect(out.fixes.join(' ')).toMatch(/minutes/);
});

describe('6-12 instruction', () => {
  const ctx = { grade: 7, segmentId: 'grade_7_science.c01.p001-003' };
  const text = (a) => buildOwnInstruction({ ...a, way: 'discussion' }, ctx);
  it('asks for one period with GRR minutes, and no longer than the plan, not "the same length"', () => {
    expect(text(BIG)).toMatch(/ONE class period/);
    expect(text(BIG)).toMatch(/period_minutes/);
    expect(text(BIG)).not.toMatch(/same layout and length/);
  });
  it('a big class gets a smaller load than a small class', () => {
    expect(text(BIG)).toContain(`at most ${LOAD.over70.steps} `);
    expect(text(SMALL)).toContain(`at most ${LOAD.up30.steps} `);
  });
});

test('You Do stays each child alone, without promising a per-child teacher check', () => {
  expect(YOU_DO_LINE).toMatch(/alone/);
  expect(YOU_DO_LINE).not.toMatch(/teacher can check each child/);
});
