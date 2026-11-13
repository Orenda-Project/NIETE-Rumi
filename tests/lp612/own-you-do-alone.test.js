/**
 * bd-snkn32.28 — in a "Make my own" plan You Do is each child working alone, so the teacher can check each child.
 * Tester feedback (G4 Science): "the You do section also used group work, so there was no real difference between
 * We do and You do". The request applied the teaching way (level groups, pair talk, games) to We Do AND You Do and
 * never said You Do is independent; nothing checked the reply. Groups and pairs stay in We Do.
 */
const { k5Messages, checkK5Rewrite } = require('../../bot/shared/services/lp-k5-own');
const { buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');
const { YOU_DO_LINE } = require('../../bot/shared/services/lp612-own-ways');

const ANSWERS = { size: 'over70', resources: ['textbook'], level: 'mixed', way: 'tarl', note: '' };

const script = (youDo = 'Each child labels the parts on page 5.', weDo = 'In pairs, point to each part on page 4.') => ({
  goal: 'Name the parts of a plant.',
  meta: { day: 1 },
  hook: { warmUp: { teacherAsks: 'What do plants need?' } },
  iDo: { steps: [{ n: 1, say: 'Look at the picture on page 4.' }] },
  weDo: { action: weDo },
  youDo: { action: youDo },
  wrap: { exitOptions: [{ prompt: 'Name one part.' }] },
});

const userOf = (answers) => k5Messages({ script: script(), answers, lang: 'en', grade: 4, subject: 'science' })[1].content;

describe('the request says You Do is each child alone', () => {
  it('K-5: the way is for We Do; You Do is independent', () => {
    const u = userOf(ANSWERS);
    expect(u).toContain(YOU_DO_LINE);
    expect(u).not.toMatch(/for We Do and You Do|combined in We Do and You Do/);
  });

  it('6-12: the instruction carries the same line', () => {
    expect(buildOwnInstruction({ ...ANSWERS, way: 'discussion' }, { grade: 7, segmentId: 'grade_7_science.c01.p001-003' }))
      .toContain(YOU_DO_LINE);
  });

  it('the line keeps groups and pairs in We Do and a whole-class check (bd-snkn32.30)', () => {
    expect(YOU_DO_LINE).toMatch(/alone/);
    expect(YOU_DO_LINE).toMatch(/We Do/);
    expect(YOU_DO_LINE).toMatch(/class is checked together/);
  });
});

describe('checkK5Rewrite refuses group or pair work in You Do (a make)', () => {
  const make = { resources: ['textbook'] };
  it.each([
    'Work in pairs to label the parts on page 5.',
    'In groups of four, label the parts on page 5.',
    'Group work: label the parts on page 5.',
    'Label the parts with your partner.',
    'جوڑیوں میں صفحہ 5 پر حصوں کے نام لکھیں۔',
    'گروپ میں مل کر صفحہ 5 کے حصے لکھیں۔',
  ])('refuses "%s"', (youDo) => {
    expect(checkK5Rewrite(script(), script(youDo), make).join()).toMatch(/You Do/);
  });

  it.each([
    'Each child labels the parts on page 5.',
    'Children behind label two parts; children ahead label all four and write one use. Each child works alone.',
    'ہر بچہ صفحہ 5 پر حصوں کے نام اکیلے لکھے۔',
  ])('passes "%s"', (youDo) => {
    expect(checkK5Rewrite(script(), script(youDo), make)).toEqual([]);
  });

  it('pair work in We Do is fine', () => {
    expect(checkK5Rewrite(script(), script(undefined, 'Work in pairs on page 4.'), make)).toEqual([]);
  });

  it('a change she asked for (no answers) is not checked for this', () => {
    expect(checkK5Rewrite(script(), script('Work in pairs to label page 5.'), {})).toEqual([]);
  });
});

describe('the rewrite call: a group You Do is sent back and fixed', () => {
  const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
  const client = (...answers) => {
    const create = jest.fn();
    answers.forEach((a) => create.mockResolvedValueOnce(reply(a)));
    return { chat: { completions: { create } }, create };
  };
  const call = (c) => rewriteK5({ script: script(), answers: ANSWERS, lang: 'en', grade: 4, subject: 'science', client: c, model: 'm' });

  it('group You Do, then each child alone: the second is kept and the reason was sent', async () => {
    const c = client(script('In groups, label page 5.'), script('Each child labels page 5.'));
    const out = await call(c);
    expect(out.rounds).toBe(2);
    expect(out.script.youDo.action).toBe('Each child labels page 5.');
    expect(c.create.mock.calls[1][0].messages.at(-1).content).toMatch(/You Do/);
  });
});
