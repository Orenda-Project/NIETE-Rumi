/**
 * bd-snkn32.4 — the grades 1–5 rewrite call (lp-k5-own-author): one request, and ONE repair round carrying the gate's
 * reasons. A plan the gate still refuses is null (her row fails), never a plan that broke the rules.
 */
const { rewriteK5, JOB } = require('../../bot/shared/services/lp-k5-own-author');

const SCRIPT = { goal: 'Place value', meta: { day: 2 }, hook: { story: 'h' }, iDo: { steps: [{ say: 'a' }] }, weDo: { action: 'Count along the number line on the book page together' }, youDo: { action: 'y' }, wrap: { homework: ['hw'] } };
const ANSWERS = { size: 'up30', resources: ['textbook'], level: 'ahead', way: 'games', note: '' };
const reply = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] });

function client(...answers) {
  const create = jest.fn();
  answers.forEach((a) => create.mockResolvedValueOnce(reply(a)));
  return { chat: { completions: { create } }, create };
}

test('a good first answer is taken, on its own job', async () => {
  const c = client({ ...SCRIPT, weDo: { action: 'Floor number line game' } });
  const out = await rewriteK5({ script: SCRIPT, answers: ANSWERS, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
  expect(out).toEqual({ script: expect.objectContaining({ weDo: { action: 'Floor number line game' } }), model: 'm', rounds: 1, fixes: [], warnings: [] });
  expect(c.create.mock.calls[0][0].job).toBe(JOB);
});

test('a refused answer goes back with its reasons once; the fixed one is taken', async () => {
  const c = client({ ...SCRIPT, goal: 'Something else' }, SCRIPT);
  const out = await rewriteK5({ script: SCRIPT, answers: ANSWERS, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
  expect(out.rounds).toBe(2);
  const second = c.create.mock.calls[1][0].messages;
  expect(second[second.length - 1].content).toMatch(/goal/);
});

test('still refused, or not JSON: null', async () => {
  const c = client('nonsense', { ...SCRIPT, goal: 'no' });
  expect(await rewriteK5({ script: SCRIPT, answers: ANSWERS, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' })).toBeNull();
});

test('bd-snkn32.15: a change sends her one change, not the class answers, and the same gate checks it', async () => {
  const c = client({ ...SCRIPT, weDo: { action: 'Pair game with stones' } });
  const edit = { part: 'we_do', text: 'Make it a pair game with stones' };
  const out = await rewriteK5({ script: SCRIPT, edit, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
  expect(out.script.weDo).toEqual({ action: 'Pair game with stones' });
  const user = c.create.mock.calls[0][0].messages[1].content;
  expect(user).toMatch(/Change only the weDo part/);
  expect(user).toMatch(/pair game with stones/);
});

// bd-snkn32.40 — a teacher checking each child in a big class goes back once; it is never the last word on its own.
describe('one-by-one checks in a class over 30', () => {
  const BIG = { ...ANSWERS, size: 'over70' };
  const perChild = { ...SCRIPT, youDo: { action: 'Check each child\'s copy one by one.' } };
  const call = (c) => rewriteK5({ script: SCRIPT, answers: BIG, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });

  test('round 1: sent back with the reason; a fixed round 2 is taken', async () => {
    const c = client(perChild, SCRIPT);
    const out = await call(c);
    expect(out.rounds).toBe(2);
    expect(out.warnings).toEqual([]);
    const second = c.create.mock.calls[1][0].messages;
    expect(second[second.length - 1].content).toMatch(/each child/);
  });

  test('still there in round 2: accepted with a warning, not refused', async () => {
    const out = await call(client(perChild, perChild));
    expect(out.script.youDo.action).toMatch(/one by one/);
    expect(out.warnings.join(' ')).toMatch(/each child/);
  });

  test('round 2 breaks a hard rule: round 1\'s plan is kept, with the warning', async () => {
    const out = await call(client(perChild, { ...SCRIPT, goal: 'moved' }));
    expect(out.script.goal).toBe(SCRIPT.goal);
    expect(out.rounds).toBe(2);
    expect(out.warnings.join(' ')).toMatch(/each child/);
  });

  test('a small class is never sent back for it', async () => {
    const c = client(perChild);
    const out = await rewriteK5({ script: SCRIPT, answers: ANSWERS, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
    expect(out.rounds).toBe(1);
    expect(c.create).toHaveBeenCalledTimes(1);
  });
});

test('bd-snkn32.40: a change much longer than the plan is kept with a warning, one call', async () => {
  const c = client({ ...SCRIPT, weDo: { action: 'w'.repeat(3000) } });
  const out = await rewriteK5({ script: SCRIPT, edit: { part: 'we_do', text: 'longer' }, lang: 'en', grade: 3, subject: 'math', client: c, model: 'm' });
  expect(c.create).toHaveBeenCalledTimes(1);
  expect(out.warnings.join(' ')).toMatch(/longer/);
});
