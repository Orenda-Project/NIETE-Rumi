'use strict';
/**
 * Every rewritten recall item is blind-solved before a child can see it (PLAN §11 A19). The lesson items already
 * pass runKeyVerify inside the generate step; the recall items are written later, in afterGenerate, so they get
 * their own solve:
 *   - solved WITHOUT a lesson (there is none for a rewrite: the subject alone decides), only the recall items;
 *   - an item the solver flags (ambiguous, none_correct, or a disagree a second look confirms) is not written;
 *   - a solver that fails writes NO recall item (fail-closed: nobody reviews a round before a child plays it),
 *     and the round still goes out with its lesson items;
 *   - what it checked, dropped and spent is on the round's row.
 * Faked boundaries: Supabase (in memory), Redis off, the loggers, the two model calls (deps.complete, deps.verify).
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false }));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');

const C1 = 'c1a55000-0000-4000-8000-0000000000f1';
const T1 = '7e000000-0000-4000-8000-0000000000f1';
const ZARA = 'c0000001-0000-4000-8000-0000000000f1';
const QID = 'q-round-kv';
const ORIG = ['0a000000-0000-4000-8000-0000000000f1', '0a000000-0000-4000-8000-0000000000f2', '0a000000-0000-4000-8000-0000000000f3'];

function seed() {
  const db = {
    quizzes: [{ id: QID, teacher_id: T1, subject: 'maths', grade: '3', language: 'en', status: 'generating',
      meta: { source: 'evening_round', class_id: C1, round_day: '2026-11-24', class_link_code: 'K7Q2MXTRAB',
        recall_src: ORIG.map((qid) => ({ qid, subject: 'maths', grade: '3', kids: ['k1'], n: 1 })) } }],
    quiz_share_codes: [],
    classes: [{ id: C1, grade_code: 'grade_3', section: 'B' }],
    quiz_questions: [
      ...ORIG.map((id, i) => ({ id, quiz_id: 'qold', question_text: `Old ${i}`, option_a: '1', option_b: '2', option_c: '3', correct_option: 'A' })),
      ...[1, 2, 3, 4, 5].map((n) => ({ id: `l${n}`, quiz_id: QID, external_id: `tq:x:S1:${n}`, sort_order: n, question_text: `L${n}`, correct_option: 'A', media: {} })),
    ],
  };
  Object.assign(supabase, { from: makeFake(db).from });
  const mintCode = jest.fn(async () => { db.quiz_share_codes.push({ id: 'sc-kv', code: 'RNDKV2', quiz_id: QID, class_id: C1 }); return { id: 'sc-kv', code: 'RNDKV2' }; });
  return { db, mintCode };
}

const complete = jest.fn(async () => ({
  json: { items: [0, 1, 2].map((i) => ({ i, question: `New ${i}: what is ${i} + 1?`, options: [`${i + 1}`, `${i + 2}`, `${i + 3}`], correct: 'A', explanation: 'Count on.' })) },
  costUsd: 0.0012, model: 'm-rewrite',
}));
const recallRows = (db) => db.quiz_questions.filter((r) => r.quiz_id === QID && r.media && r.media.round === 'recall');

beforeEach(() => complete.mockClear());

test('the rewritten items are solved without a lesson; a flagged or confirmed-disagree item is not written', async () => {
  const { db, mintCode } = seed();
  const verify = jest.fn(async ({ questions, indices, again, withLesson }) => {
    expect(withLesson).toBe(false);
    expect(questions.map((q) => q.question)).toEqual(['New 0: what is 0 + 1?', 'New 1: what is 1 + 1?', 'New 2: what is 2 + 1?']);
    expect(questions.map((q) => q.correct_index)).toEqual([0, 0, 0]);
    if (again) return { verdicts: indices.map((index) => ({ index, verdict: index === 1 ? 'disagree' : 'agree' })), costUsd: 0.001, model: 'm-solve' };
    return { verdicts: [{ index: 0, verdict: 'agree' }, { index: 1, verdict: 'disagree' }, { index: 2, verdict: 'ambiguous' }], costUsd: 0.002, model: 'm-solve' };
  });
  const out = await Round.afterGenerate({ quizId: QID }, { mintCode, complete, verify });
  expect(out).toMatchObject({ ok: true, round: true });
  expect(verify).toHaveBeenCalledTimes(2); // the solve, then the second look at the one disagree
  expect(verify.mock.calls[1][0]).toMatchObject({ indices: [1], again: true });
  expect(recallRows(db).map((r) => r.media.recall.of)).toEqual([ORIG[0]]);
  expect(db.quizzes[0].meta).toMatchObject({
    n_recall: 1,
    recall_key_verify: { status: 'ok', checked: 3, dropped: 2, model: 'm-solve' },
  });
  expect(db.quizzes[0].meta.recall_cost_usd).toBeCloseTo(0.0012 + 0.003);
});

test('a disagree the second look does not confirm keeps the item', async () => {
  const { db, mintCode } = seed();
  const verify = jest.fn(async ({ indices, again }) => (again
    ? { verdicts: indices.map((index) => ({ index, verdict: 'agree' })), costUsd: 0 }
    : { verdicts: [0, 1, 2].map((index) => ({ index, verdict: index === 2 ? 'disagree' : 'agree' })), costUsd: 0 }));
  await Round.afterGenerate({ quizId: QID }, { mintCode, complete, verify });
  expect(recallRows(db)).toHaveLength(3);
  expect(db.quizzes[0].meta.recall_key_verify).toMatchObject({ status: 'ok', checked: 3, dropped: 0 });
});

test('a solver that fails writes no recall item; the round is still ready with its lesson items', async () => {
  const { db, mintCode } = seed();
  const verify = jest.fn(async () => { throw new Error('solver timeout'); });
  const out = await Round.afterGenerate({ quizId: QID }, { mintCode, complete, verify });
  expect(out).toMatchObject({ ok: true, round: true });
  expect(recallRows(db)).toHaveLength(0);
  expect(db.quizzes[0].status).toBe('ready');
  expect(db.quizzes[0].meta).toMatchObject({ n_recall: 0, n_lesson: 5, recall_key_verify: { status: 'error', checked: 3, dropped: 3 } });
});
