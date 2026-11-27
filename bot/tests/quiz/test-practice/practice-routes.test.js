'use strict';
/**
 * The practice door over HTTP (A/B test ict-quiz-practice-door), mounted in web-quiz-internal.routes.js behind the
 * internal key. Switch off: POST /finish answers exactly today's body (nothing added) and /practice/* is 404, the
 * same as an unknown route. On, a forced child: the finish carries {practice_door}, and start/finish play a round.
 * Faked boundaries: Supabase, and the finish's own service (its answer is fixed so only the hook's change shows).
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-token-secret-not-a-secret';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('../web-quiz/fake-supabase');
const supabase = require('../../../shared/config/supabase');
const AB = require('../../../shared/services/ab-assign.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
const NextOffer = require('../../../shared/services/quiz/web-quiz-next-offer-result');
const ShareWarm = require('../../../shared/services/quiz/web-quiz-share-warm');
const Pool = require('../../../shared/services/quiz/test-practice/pool.repo');
const Door = require('../../../shared/services/quiz/test-practice/door');

const KID = '11111111-1111-4111-8111-111111111111';
const st = T.signSession({ sessionId: 's1', deviceRef: 'dev-1', shareCodeId: 'sc1' });
const TODAY = { score: { correct: 2, total: 5, pct: 40 }, stars: 2, challenge_code: 'ABCD12' };
const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };
const lp = (id, topic) => ({ id, teacher_id: 't1', grade: '3', subject: 'English', topic, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-01T00:00:00Z',
  meta: { lessons: ['L1'], digest: { slos: [{ id: 'S1', evidence_quote: 'From the plan' }] } } });
const qq = (id, quizId) => ({ id, quiz_id: quizId, question_text: `Pick the naming word in line ${id} of the poem`, option_a: 'cat', option_b: 'run', option_c: 'red', correct_option: 'A', external_id: `tq:${quizId}:S1:1` });

let server; let base; let fake;
function seed(flag) {
  fake = makeFake({
    app_settings: flag === undefined ? [] : [{ key: 'ab_quiz_practice_door', value: flag }],
    quiz_sessions: [{ id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, share_code_id: 'sc1', quiz_id: 'src' }],
    quiz_answers: [],
    quizzes: [lp('src', 'Nouns'), lp('zA', 'Naming words')],
    quiz_questions: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((q) => qq(q, 'zA')),
    exam_question_bank: [], textbooks: [], textbook_pages: [], ab_assignment: [], child_phone_bindings: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  AB._resetCache(); Pool._resetCache(); Door._reset();
}
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: KEY, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(WebQuiz, 'finishSession').mockImplementation(async () => ({ ...TODAY }));
  jest.spyOn(ShareWarm, 'afterFinish').mockImplementation(() => {});
  jest.spyOn(CardImage, 'field').mockResolvedValue({});
  jest.spyOn(NextOffer, 'finishField').mockResolvedValue({});
});

describe('switch off', () => {
  test.each([[undefined], [false], ['true']])('%p: POST /finish is today\'s body byte for byte', async (flag) => {
    seed(flag);
    const r = await post('/finish', { st });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(JSON.stringify(TODAY));
    expect(fake.calls.map((c) => c.table).filter((t) => t !== 'app_settings')).toEqual([]);
  });
  test('POST /practice/start and /practice/finish are 404', async () => {
    seed(false);
    expect((await post('/practice/start', { st })).status).toBe(404);
    expect((await post('/practice/finish', { st, round_id: 'x', answers: {} })).status).toBe(404);
  });
});

describe('switch on, a forced child', () => {
  test('the finish carries the door, and a round plays end to end', async () => {
    seed({ on: true, force_b: [KID] });
    expect(await (await post('/finish', { st })).json()).toEqual({ ...TODAY, practice_door: { rounds_left: 3 } });
    expect(await (await post('/practice/start', { st })).json()).toEqual({ topics: ['Naming words'], rounds_left: 3 });
    const r = await (await post('/practice/start', { st, topics: ['Naming words'] })).json();
    expect(r.questions).toHaveLength(5);
    const answers = Object.fromEntries(r.questions.map((q) => [q.qid, 'A']));
    const out = await (await post('/practice/finish', { st, round_id: r.round_id, answers })).json();
    expect(out).toMatchObject({ score: 5, total: 5 });
    expect(out.items[0].worked).toBe('From the plan');
  });
  test('a bad body is 400', async () => {
    seed({ on: true, force_b: [KID] });
    expect((await post('/practice/start', { st: 5 })).status).toBe(400);
    expect((await post('/practice/start', { st, topics: 'x' })).status).toBe(400);
    expect((await post('/practice/finish', { st, round_id: 7, answers: {} })).status).toBe(400);
  });
});
