/**
 * bd-snkn32.27 — a "Make my own" plan uses only the materials she selected. Tester feedback (G4 Science, Textbook
 * only) got a plan using the board and plants. The request itself named the board and slates whatever she picked,
 * the plan being rewritten keeps its own board work unless told to replace it, and nothing checked the reply.
 */
const { k5Messages, checkK5Rewrite } = require('../../bot/shared/services/lp-k5-own');
const { buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');

const BOOK_ONLY = { size: 'over70', resources: ['textbook'], level: 'on_track', way: 'cpa', note: '' };
const WITH_BOARD = { ...BOOK_ONLY, resources: ['textbook', 'board'] };

const script = (say = 'Look at the picture on page 4.') => ({
  goal: 'Name the parts of a plant.',
  meta: { day: 1 },
  hook: { warmUp: { teacherAsks: 'What do plants need?' } },
  iDo: { steps: [{ n: 1, say }] },
  weDo: { action: 'Point to each part on page 4 together.' },
  youDo: { action: 'Label the parts on page 5.' },
  wrap: { exitOptions: [{ prompt: 'Name one part.' }] },
});

const userOf = (answers) => k5Messages({ script: script(), answers, lang: 'en', grade: 4, subject: 'science' })[1].content;
const sansPlan = (text) => text.split('The day\'s plan:')[0];

describe('the K-5 request names only what she has', () => {
  it('with the textbook only, the request never offers the board or slates', () => {
    const u = sansPlan(userOf(BOOK_ONLY));
    expect(u).not.toMatch(/\bslates?\b/i);
    expect(u).not.toMatch(/board drawing|come to the board/i);
  });

  it('tells the model to replace anything in the old plan she does not have', () => {
    expect(userOf(BOOK_ONLY)).toMatch(/replace/i);
    expect(userOf(BOOK_ONLY)).toMatch(/she does not have|not on her list/i);
  });

  it('with the board selected, the board may be used', () => {
    expect(userOf(WITH_BOARD)).toMatch(/textbook, board/);
  });
});

describe('the 6-12 instruction names only what she has', () => {
  it('textbook only: no board drawing, and the old plan\'s other materials are replaced', () => {
    const text = buildOwnInstruction(BOOK_ONLY, { grade: 7, segmentId: 'g7-sci-1' });
    expect(text).not.toMatch(/board drawing/i);
    expect(text).toMatch(/replace/i);
  });
});

describe('checkK5Rewrite refuses a plan that uses a board she did not select', () => {
  it('refuses board use when she has no board', () => {
    const next = script('Draw a plant on the board.');
    expect(checkK5Rewrite(script(), next, { resources: ['textbook'] }).join()).toMatch(/board/);
  });

  it('refuses Urdu board use too', () => {
    const next = script('بورڈ پر پودا بنائیں۔');
    expect(checkK5Rewrite(script(), next, { resources: ['textbook'] }).join()).toMatch(/board/);
  });

  it('passes board use when she selected the board, and passes when no materials are given (a change)', () => {
    const next = script('Draw a plant on the board.');
    expect(checkK5Rewrite(script(), next, { resources: ['textbook', 'board'] })).toEqual([]);
    expect(checkK5Rewrite(script(), next, {})).toEqual([]);
  });

  it('a plan using only the book passes', () => {
    expect(checkK5Rewrite(script(), script(), { resources: ['textbook'] })).toEqual([]);
  });
});

describe('the rewrite call: a board plan for a teacher with no board is sent back and fixed (bd-snkn32.27)', () => {
  const { rewriteK5 } = require('../../bot/shared/services/lp-k5-own-author');
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
  const client = (...answers) => {
    const create = jest.fn();
    answers.forEach((a) => create.mockResolvedValueOnce(reply(a)));
    return { chat: { completions: { create } }, create };
  };
  const call = (c, answers, edit) => rewriteK5({ script: script(), answers, edit, lang: 'en', grade: 4, subject: 'science', client: c, model: 'm' });

  it('textbook only: the board plan is refused with the reason, the book plan is kept', async () => {
    const c = client(script('Draw a plant on the board.'), script('Point to the plant on page 4.'));
    const out = await call(c, BOOK_ONLY);
    expect(out.rounds).toBe(2);
    expect(JSON.stringify(out.script)).not.toMatch(/board/i);
    expect(c.create.mock.calls[1][0].messages.at(-1).content).toMatch(/board she does not have/);
  });

  it('a board plan that never stops using the board is no plan at all', async () => {
    const board = script('Draw a plant on the board.');
    expect(await call(client(board, board), BOOK_ONLY)).toBeNull();
  });

  it('with the board selected, the board plan is taken first time', async () => {
    const out = await call(client(script('Draw a plant on the board.')), WITH_BOARD);
    expect(out.rounds).toBe(1);
  });
});
