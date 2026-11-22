/**
 * bd-snkn32.70 — "Make my own" G1-5: the hard rules hold on a CHANGE too, rote is checked in code, her make-time note
 * is screened, and "can't memorise" is not a rote request.
 *
 * Found by the agency eval (bd-snkn32.64): a change called the gate with {lang} only, so You Do in pairs, a board she
 * does not have and slates all passed; nothing checked the plan itself for rote drill (lp-own-fit.js said it did); a
 * make-time note asking to skip I Do went to the model unscreened; and "they can't memorize tables" was refused as rote.
 */
const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');
const { checkK5Rewrite, roteDrill } = require('../../bot/shared/services/lp-k5-own');
const { parseOwnAnswers } = require('../../bot/shared/services/lp612-own-instruction');
const { ruleBreak } = require('../../bot/shared/services/lp-own-edit-guard');

const SCRIPT = {
  goal: 'Place value', meta: { day: 2 }, hook: { story: 'h' }, iDo: { steps: [{ say: 'Show tens and ones on page 12.' }] },
  weDo: { action: 'Count along the number line on the book page together' },
  youDo: { action: 'Each child writes the tens and ones for five numbers in the copy.' }, wrap: { homework: ['hw'] },
};
// A change row carries the root's answers (lp612-own-change: answers: root.answers).
const ANSWERS = { size: 'over70', resources: ['textbook'], level: 'mixed', way: 'games', note: '' };
const EDIT = { part: 'you_do', text: 'Let children do You Do in pairs' };
const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
function client(...plans) {
  const create = jest.fn();
  plans.forEach((p) => create.mockResolvedValueOnce(reply(p)));
  return { chat: { completions: { create } }, create };
}
const change = (c) => rewriteK5({ script: SCRIPT, answers: ANSWERS, edit: EDIT, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });

describe('a change is held to the same hard rules as a make', () => {
  test('You Do in pairs is refused on a change', async () => {
    const bad = { ...SCRIPT, youDo: { action: 'Children work in pairs to write the tens and ones.' } };
    const c = client(bad, bad);
    expect(await change(c)).toBeNull();
    const second = c.create.mock.calls[1][0].messages;
    expect(second[second.length - 1].content).toMatch(/You Do has pair or group work/);
  });

  test('a board she does not have is refused on a change', async () => {
    const bad = { ...SCRIPT, iDo: { steps: [{ say: 'Write 34 on the board.' }] } };
    expect(await change(client(bad, bad))).toBeNull();
  });

  test('slates are refused on a change', async () => {
    const bad = { ...SCRIPT, youDo: { action: 'Each child writes the number on the slate.' } };
    expect(await change(client(bad, bad))).toBeNull();
  });

  test('a clean change still goes through first time', async () => {
    const good = { ...SCRIPT, youDo: { action: 'Each child circles the tens in five numbers in the book.' } };
    const out = await change(client(good));
    expect(out && out.rounds).toBe(1);
  });

  test('a change with no answers on its row keeps the old gate (no crash)', async () => {
    const c = client(SCRIPT);
    const out = await rewriteK5({ script: SCRIPT, edit: EDIT, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
    expect(out && out.rounds).toBe(1);
  });
});

describe('the plan itself is checked for rote drill, and goes back once', () => {
  test.each([
    'Children memorise the answers by heart.',
    'Children copy the sentences from the board word for word.',
    'Repeat the definitions five times.',
  ])('caught: %s', (line) => {
    expect(roteDrill({ ...SCRIPT, weDo: { action: line } }).join(' ')).toMatch(/rote/);
  });
  test.each([
    'Say the sound /b/ three times together.',
    'Read the word "cat" aloud together.',
    'Do not make them memorise the answers; ask them to explain.',
  ])('allowed: %s', (line) => {
    expect(roteDrill({ ...SCRIPT, weDo: { action: line } })).toEqual([]);
  });
  test('rote is not a hard refusal (0.7% of stored days name rote to warn against it)', () => {
    expect(checkK5Rewrite(SCRIPT, { ...SCRIPT, weDo: { action: 'Children memorise the answers by heart.' } }, { lang: 'en' })).toEqual([]);
  });
  const ROTE = { ...SCRIPT, weDo: { action: 'Children memorise the answers by heart.' } };
  test.each([['a make', { answers: { ...ANSWERS, size: 'up30' } }], ['a change', { answers: ANSWERS, edit: EDIT }]])(
    'on %s a rote reply goes back once with the reason; the fixed one is taken', async (_, extra) => {
      const c = client(ROTE, SCRIPT);
      const out = await rewriteK5({ script: SCRIPT, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm', ...extra });
      expect(out.rounds).toBe(2);
      const second = c.create.mock.calls[1][0].messages;
      expect(second[second.length - 1].content).toMatch(/rote drill/);
    });
  test('still rote after the repair: kept with a warning, never her row failed on rote alone', async () => {
    const out = await rewriteK5({ script: SCRIPT, answers: ANSWERS, edit: EDIT, lang: 'en', grade: 3, subject: 'math', client: client(ROTE, ROTE), model: 'm' });
    expect(out && out.warnings.join(' ')).toMatch(/rote drill/);
  });
});

describe('her make-time note is screened like a change', () => {
  const ctx = { segmentId: 'grade_3_math.c01.p010-012' };
  const base = { size: 'up30', resources: [], level: 'mixed', way: 'games' };
  test.each(['Skip the I do part, there is no time', 'Make them memorise the answers'])('dropped: %s', (note) => {
    const p = parseOwnAnswers({ ...base, note }, ctx);
    expect(p.ok).toBe(true);
    expect(p.answers.note).toBe('');
    expect(p.answers.noteDropped).toBe(true);
  });
  test('an ordinary note is kept', () => {
    const p = parseOwnAnswers({ ...base, note: 'Many children are still weak in counting' }, ctx);
    expect(p.answers.note).toBe('Many children are still weak in counting');
    expect(p.answers.noteDropped).toBeUndefined();
  });
});

describe("\"can't\" and \"cannot\" are negations, not rote requests", () => {
  test.each(["They can't memorize tables", 'Children cannot memorise tables, use objects', "Don't make them memorise the answers"])(
    'not rote: %s', (t) => expect(ruleBreak(t)).toBeNull(),
  );
  test('a real rote request is still caught', () => expect(ruleBreak('Make them memorise the tables')).toBe('rote'));
});
