/**
 * bd-snkn32.4 — the grades 1–5 rewrite call (lp-k5-own-author): one request, and ONE repair round carrying the gate's
 * reasons. A plan the gate still refuses is null (her row fails), never a plan that broke the rules.
 */
const { rewriteK5, JOB } = require('../../bot/shared/services/lp-k5-own-author');

const SCRIPT = { goal: 'Place value', meta: { day: 2 }, hook: {}, iDo: { steps: [{ say: 'a' }] }, weDo: {}, youDo: {}, wrap: {} };
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
  expect(out).toEqual({ script: expect.objectContaining({ weDo: { action: 'Floor number line game' } }), model: 'm', rounds: 1 });
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
