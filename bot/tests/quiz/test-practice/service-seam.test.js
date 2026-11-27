'use strict';
/**
 * Practice rounds (A/B test ict-quiz-practice-door, arm B). start: topics first, then a round of 5 fresh questions led
 * by the skills the child got wrong, never with the answers; capped, short and not-in-B answers. finish: graded on
 * the server with the lesson plan's worked answers, idempotent, and only for the child whose round it is.
 * Faked boundary: Supabase. Invented content and ids only.
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-token-secret-not-a-secret';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('../web-quiz/fake-supabase');
const supabase = require('../../../shared/config/supabase');
const AB = require('../../../shared/services/ab-assign.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Pool = require('../../../shared/services/quiz/test-practice/pool.repo');
const Door = require('../../../shared/services/quiz/test-practice/door');
const Practice = require('../../../shared/services/quiz/test-practice/service');

const KID = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-27T06:00:00Z');
const st = T.signSession({ sessionId: 's1', deviceRef: 'dev-1', shareCodeId: 'sc1' });
const stOther = T.signSession({ sessionId: 's2', deviceRef: 'dev-2', shareCodeId: 'sc1' });

const lp = (id, topic, o = {}) => ({ id, teacher_id: 't1', grade: '3', subject: 'English', topic, quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-01T00:00:00Z',
  meta: { lessons: ['L1'], slo_codes: { S1: 'E-3-01', S2: 'E-3-02' }, digest: { slos: [{ id: 'S1', evidence_quote: `Worked from ${id}` }, { id: 'S2', evidence_quote: '' }] } }, ...o });
const qq = (id, quizId, slo, text) => ({ id, quiz_id: quizId, question_text: text || `Which word in sentence ${id} is a naming word?`, option_a: 'cat', option_b: 'run', option_c: 'red', correct_option: 'A', external_id: `tq:${quizId}:${slo}:1` });

let fake;
function seed(o = {}) {
  const flag = 'flag' in o ? o.flag : { on: true, force_b: [KID, OTHER] };
  const pool = o.pool || [
    ...['p1', 'p2', 'p3', 'p4'].map((q) => qq(q, 'zA', 'S1')),
    ...['p5', 'p6', 'p7', 'p8'].map((q) => qq(q, 'zB', 'S2')),
  ];
  fake = makeFake({
    app_settings: flag === undefined ? [] : [{ key: 'ab_quiz_practice_door', value: flag }],
    quiz_sessions: [
      { id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, share_code_id: 'sc1', quiz_id: 'src' },
      { id: 's2', student_id: OTHER, user_id: null, invited_by_student_id: null, share_code_id: 'sc1', quiz_id: 'src' },
    ],
    quiz_answers: [{ session_id: 's1', question_id: 'own1', is_correct: false }, { session_id: 's1', question_id: 'own2', is_correct: true }],
    quizzes: [lp('src', 'Nouns'), lp('zA', 'Naming words'), lp('zB', 'Action words'), ...(o.rounds || [])],
    quiz_questions: [qq('own1', 'src', 'S1', 'Own quiz question one about nouns?'), qq('own2', 'src', 'S2', 'Own quiz question two about verbs?'), ...pool],
    exam_question_bank: o.bank || [],
    textbooks: [], textbook_pages: [], ab_assignment: [], child_phone_bindings: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  AB._resetCache(); Pool._resetCache(); Door._reset();
}
const roundsOf = () => fake.db.quizzes.filter((z) => z.quiz_source === 'practice');
const pastRound = (id) => ({ id, teacher_id: 't1', topic: 'x', quiz_source: 'practice', status: 'skipped', created_at: '2026-11-27T04:00:00Z', meta: { kind: 'practice', student_id: KID, round: { items: [] } } });

describe('start', () => {
  test('no topics yet: the topics to pick from and the rounds left', async () => {
    seed();
    expect(await Practice.start({ st }, { now: NOW })).toEqual({ topics: ['Naming words', 'Action words'], rounds_left: 3 });
    expect(roundsOf()).toHaveLength(0);
  });
  test('a round of 5: the wrong skill first, then the picked topic; no answers sent; stored as a practice quiz', async () => {
    seed();
    const out = await Practice.start({ st, topics: ['Action words'] }, { now: NOW });
    expect(out.questions).toHaveLength(5);
    expect(out.rounds_left).toBe(2);
    const ids = out.questions.map((q) => q.qid);
    expect(ids.filter((q) => ['p1', 'p2', 'p3', 'p4'].includes(q))).toHaveLength(4);
    expect(JSON.stringify(out)).not.toMatch(/correct|worked/);
    const [row] = roundsOf();
    expect(row).toMatchObject({ id: out.round_id, teacher_id: 't1', grade: '3', subject: 'English', status: 'skipped',
      meta: { kind: 'practice', student_id: KID, source_quiz_id: 'src', source_session_id: 's1' } });
    expect(row.meta.round.items.find((i) => i.qid === 'p1').worked).toBe('Worked from zA');
    expect(row.meta.round.items.find((i) => i.qid === 'p5' || i.qid === 'p6' || i.qid === 'p7' || i.qid === 'p8').worked).toBeNull();
  });
  test('a topic not offered is ignored', async () => {
    seed();
    const out = await Practice.start({ st, topics: ['Made up'] }, { now: NOW });
    expect(out.questions.every((q) => q.qid !== 'own1')).toBe(true);
  });
  test('a question that matches an exam-bank question is never served; too few left → short', async () => {
    seed({ bank: [{ subject: 'English', question_statement: 'Which word in sentence p1 is a naming word?' }],
      pool: ['p1', 'p2', 'p3', 'p4', 'p5'].map((q) => qq(q, 'zA', 'S1')) });
    expect(await Practice.start({ st, topics: [] }, { now: NOW })).toEqual({ short: true });
    expect(roundsOf()).toHaveLength(0);
  });
  test('the cap: three rounds today → capped, nothing built', async () => {
    seed({ rounds: ['r1', 'r2', 'r3'].map(pastRound) });
    expect(await Practice.start({ st, topics: [] }, { now: NOW })).toEqual({ capped: true });
    expect(roundsOf()).toHaveLength(3);
  });
  test('switch off or not in arm B → null', async () => {
    seed({ flag: false });
    expect(await Practice.start({ st }, { now: NOW })).toBeNull();
    seed({ flag: { on: true, force_b: [] }, });
    jest.spyOn(AB, 'assignArm').mockReturnValue({ arm: 'a' });
    expect(await Practice.start({ st }, { now: NOW })).toBeNull();
  });
});

describe('finish', () => {
  test('graded on the server with the worked answers; a second finish returns the same result', async () => {
    seed();
    const r = await Practice.start({ st, topics: ['Action words'] }, { now: NOW });
    const answers = Object.fromEntries(r.questions.map((q, i) => [q.qid, i === 0 ? 'B' : 'A']));
    const out = await Practice.finish({ st, round_id: r.round_id, answers });
    expect(out).toMatchObject({ score: 4, total: 5 });
    expect(out.items[0]).toMatchObject({ qid: r.questions[0].qid, chosen: 'B', correct: 'A', right: false });
    expect(out.items.find((i) => i.qid === 'p1' || i.qid === 'p2').worked).toBe('Worked from zA');
    expect(roundsOf()[0].meta.result).toEqual(out);
    expect(await Practice.finish({ st, round_id: r.round_id, answers: {} })).toEqual(out);
  });
  test('another child\'s round, or a quiz that is not a practice round → null', async () => {
    seed();
    const r = await Practice.start({ st, topics: [] }, { now: NOW });
    expect(await Practice.finish({ st: stOther, round_id: r.round_id, answers: {} })).toBeNull();
    expect(await Practice.finish({ st, round_id: 'zA', answers: {} })).toBeNull();
    expect(roundsOf()[0].meta.result).toBeUndefined();
  });
});
