'use strict';
/**
 * The chip tree (FIRST_QUIZ §2): live video quizzes only (student_videos.superseded_by IS NULL × quizzes video/ready),
 * grades '1'–'5' only, subjects mapped by §5.2's table, a cell only where a quiz exists, a duplicate topic → the quiz
 * on the newest live video; and the make's server-side re-check (a tampered quiz id → 400, nothing minted).
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));

const supabase = require('../../shared/config/supabase');
const Bank = require('../../shared/services/first-touch/maker.bank');
const { seedMaker, TEACHER, qid, vid } = require('./maker-fixture');

let fake;
beforeEach(() => { jest.clearAllMocks(); fake = seedMaker(supabase); Bank._resetCache(); });

describe('chipTree()', () => {
  test('exactly the live, ready video quizzes of grades 1–5 in a mapped subject', async () => {
    const tree = await Bank.chipTree();
    // qlang: quizzes.language when set, else the (English) question texts' language — the fixture has no Urdu option
    expect(tree).toEqual({
      1: { islamic_studies: [{ quizId: qid(4), topic: 'Kalima', qlang: 'en' }] },
      3: { general_knowledge: [{ quizId: qid(5), topic: 'Our Body', qlang: 'en' }] },
      4: { maths: [{ quizId: qid(2), topic: 'Fractions', qlang: 'en' }] },
      5: { science: [{ quizId: qid(11), topic: 'Magnets', qlang: 'ur' }] },
    });
  });

  test('NURSERY, KG and grade 6 are absent; no chip without a quiz', async () => {
    const tree = await Bank.chipTree();
    expect(Object.keys(tree).sort()).toEqual(['1', '3', '4', '5']);
    expect(JSON.stringify(tree)).not.toMatch(/Algebra|Alphabet|Haroof|My Town|Plants|Nouns/);
  });

  test('a superseded video\'s quiz is absent (Decimals)', async () => {
    expect(JSON.stringify(await Bank.chipTree())).not.toContain('Decimals');
  });

  test('two quizzes under one topic in a cell → the one on the newest live video', async () => {
    const tree = await Bank.chipTree();
    expect(tree[4].maths.map((c) => c.quizId)).toEqual([qid(2)]);
    // the older video becomes the newest → its quiz wins
    fake.db.student_videos.find((v) => v.id === vid(1)).created_at = '2026-06-01T00:00:00.000Z';
    Bank._resetCache();
    expect((await Bank.chipTree())[4].maths.map((c) => c.quizId)).toEqual([qid(1)]);
  });

  test('the Grade-1 Islamic Studies cell is present only while its quiz is', async () => {
    fake.db.quizzes.find((q) => q.id === qid(4)).status = 'failed';
    Bank._resetCache();
    expect((await Bank.chipTree())[1]).toBeUndefined();
  });

  test('cached for 10 minutes: a second call makes no read', async () => {
    await Bank.chipTree();
    const n = fake.calls.length;
    await Bank.chipTree();
    expect(fake.calls.length).toBe(n);
  });

  test('a failed read throws (the route answers mk.error)', async () => {
    supabase.from = () => { throw new Error('down'); };
    await expect(Bank.chipTree()).rejects.toThrow();
  });
});

describe('make() — the server re-check', () => {
  const codes = () => fake.db.quiz_share_codes.length;
  test.each([
    ['grade 6 quiz', { grade: '4', subject: 'maths', quizId: qid(6) }],
    ['grade 6 posted', { grade: '6', subject: 'maths', quizId: qid(6) }],
    ['another subject', { grade: '4', subject: 'english', quizId: qid(2) }],
    ['another grade', { grade: '3', subject: 'maths', quizId: qid(2) }],
    ['superseded video', { grade: '4', subject: 'maths', quizId: qid(3) }],
    ['not ready', { grade: '5', subject: 'science', quizId: qid(10) }],
    ['lesson-plan quiz', { grade: '2', subject: 'english', quizId: qid(12) }],
    ['unknown id', { grade: '4', subject: 'maths', quizId: 'c0000000-0000-4000-8000-0000000000ff' }],
  ])('%s → { error: 400 } and quiz_share_codes unchanged', async (_, body) => {
    const before = codes();
    expect(await Bank.make({ uid: TEACHER.id, lang: 'en', ...body })).toEqual({ error: 400 });
    expect(codes()).toBe(before);
  });
});
