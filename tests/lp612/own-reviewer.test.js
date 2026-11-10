'use strict';
/**
 * bd-snkn32.16 — the reviewer job: a ready own plan is scored by a cheaper model against gate v2, and the score
 * lands on her row (score, pass, per-check ratings, model, reviewed_at, library_eligible). It never touches her
 * status or her PDF; any failure leaves the score null. The model is mocked at the client boundary.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnReviewer, planKeyFor, REVIEW_JOB } = require('../../bot/shared/services/lp612-own-reviewer');
const { CHECKS } = require('../../bot/shared/services/lp612-own-review');

const READY = { id: 'own-1', status: 'ready', lang: 'en', segment_id: 's1', lesson_id: null, r2_key: 'lp612/v9/en/edits/s1/abc.pdf' };
const reply = (r, over = {}) => ({ choices: [{ message: { content: JSON.stringify({ checks: CHECKS.map((c) => ({ id: c.id, rating: over[c.id] ?? r })) }) } }] });

function harness(over = {}) {
  const patches = [];
  const create = over.create || jest.fn(async () => reply(4));
  const deps = {
    selectRow: jest.fn(async () => ({ ...READY })),
    readPlan: jest.fn(async () => '{"sections":{"warmup":"Ask"}}'),
    client: { chat: { completions: { create } } },
    model: 'anthropic/claude-haiku-4-5',
    patchOwn: jest.fn(async (id, f) => { patches.push(f); }),
    now: () => '2026-11-10T00:00:00.000Z',
    log: jest.fn(),
    ...over,
  };
  return { reviewer: createOwnReviewer(deps), deps, patches, create };
}

test('the plan beside her PDF is what gets read: .lp.json for 6-12, .json for grades 1-5', () => {
  expect(planKeyFor(READY)).toBe('lp612/v9/en/edits/s1/abc.lp.json');
  expect(planKeyFor({ ...READY, lesson_id: 'g3', segment_id: null, r2_key: 'lp612/own-k5/ur/g3/h.pdf' })).toBe('lp612/own-k5/ur/g3/h.json');
  expect(planKeyFor({ ...READY, r2_key: null })).toBeNull();
});

test('a passing plan: score, pass, per-check ratings, model and time land on her row, library-eligible', async () => {
  const { reviewer, patches, create } = harness();
  const out = await reviewer.review('own-1', 'c1');
  expect(create).toHaveBeenCalledTimes(1);
  const call = create.mock.calls[0][0];
  expect(call.model).toBe('anthropic/claude-haiku-4-5');
  expect(call.job).toBe(REVIEW_JOB);
  expect(JSON.stringify(call.messages)).toContain('Ask');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toEqual({
    review_score: 100, review_pass: true, review_items: expect.objectContaining({ '7B': 4, '5D': 4 }),
    review_model: 'anthropic/claude-haiku-4-5', reviewed_at: '2026-11-10T00:00:00.000Z', library_eligible: true,
  });
  expect(patches[0]).not.toHaveProperty('status');
  expect(out.pass).toBe(true);
});

test('below 85: scored and stored, not library-eligible, her plan untouched', async () => {
  const { reviewer, patches } = harness({ create: jest.fn(async () => reply(3)) });
  await reviewer.review('own-1');
  expect(patches[0]).toMatchObject({ review_score: 75, review_pass: false, library_eligible: false });
  expect(patches[0]).not.toHaveProperty('status');
  expect(patches[0]).not.toHaveProperty('r2_key');
});

test('a check rated 1 is not library-eligible however high the rest', async () => {
  const { reviewer, patches } = harness({ create: jest.fn(async () => reply(4, { '2C': 1 })) });
  await reviewer.review('own-1');
  expect(patches[0]).toMatchObject({ review_pass: false, library_eligible: false });
});

test('near the bar it is scored a second time and the mean decides', async () => {
  // 42 checks: 18 at 4 and 24 at 3 = 144/168 = 85.7 (near); the second at 25 x 4 = 145/168 = 86.3.
  const ids = CHECKS.map((c) => c.id).filter((id) => id !== '7B' && id !== '5D');
  const at = (n) => Object.fromEntries(ids.slice(0, n).map((id) => [id, 4]));
  const create = jest.fn()
    .mockResolvedValueOnce(reply(3, { ...at(16), '7B': 4, '5D': 4 }))
    .mockResolvedValueOnce(reply(3, { ...at(17), '7B': 4, '5D': 4 }));
  const { reviewer, patches } = harness({ create });
  await reviewer.review('own-1');
  expect(create).toHaveBeenCalledTimes(2);
  expect(patches[0].review_pass).toBe(true);
  expect(patches[0].review_score).toBeCloseTo(86.0, 1);
});

test('a row that is not ready, or not hers to find, is never scored', async () => {
  for (const row of [null, { ...READY, status: 'authoring' }, { ...READY, status: 'failed' }]) {
    const { reviewer, create, patches } = harness({ selectRow: jest.fn(async () => row) });
    expect(await reviewer.review('own-1')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
  }
});

test('a model failure, an unreadable reply or a missing plan leaves the score null and never throws', async () => {
  const cases = [
    { create: jest.fn(async () => { throw new Error('429'); }) },
    { create: jest.fn(async () => ({ choices: [{ message: { content: 'sorry' } }] })) },
    { readPlan: jest.fn(async () => { throw new Error('NoSuchKey'); }) },
  ];
  for (const over of cases) {
    const { reviewer, patches, deps } = harness(over);
    await expect(reviewer.review('own-1')).resolves.toBeNull();
    expect(patches).toHaveLength(0);
    expect(deps.log).toHaveBeenCalled();
  }
});
