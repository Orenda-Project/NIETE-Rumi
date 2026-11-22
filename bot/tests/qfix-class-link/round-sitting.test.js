'use strict';
/**
 * An evening round plays as the child's OWN set (5 lesson items + the 2 recall items whose originals this child
 * missed), never as the whole pool. The set is chosen in the sitting seam (web-quiz.service sittingQuestions), which
 * the start reply's order, the answers and the finish all go through, so the three agree on what the child was asked.
 * The page (wq.js applyOrder) plays only the qids the start reply's order.q lists.
 *   - web_quiz_order_seed on: the child's set in the sitting's seeded order;
 *   - web_quiz_order_seed off (production today), web_quiz_evening_round on: the child's set in the round's own order;
 *   - both off: the round plays as an ordinary quiz everywhere (no order on the page, every item accepted).
 * Any other quiz: today's reply, byte for byte.
 *
 * Runs the real service (start, resume, answers, finish); Supabase is the fake at the boundary.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => false,
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../shared/services/quiz/web-quiz-publish.service', () => ({
  ...jest.requireActual('../../shared/services/quiz/web-quiz-publish.service'),
  ensureQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
  requestQuizAudio: jest.fn(() => Promise.resolve({ skipped: 'test' })),
}));

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const Pulse = require('../../shared/services/quiz/web-quiz-pulse');
const T = require('../../shared/services/quiz/web-quiz-token');
const Recall = require('../../shared/services/quiz/web-quiz-evening-round-recall');
const WQ = require('../../shared/services/quiz/web-quiz.service');

const TEACHER = '11111111-1111-4111-8111-1111111111e1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const DAY = '2026-11-24';
const KEY = `${CLASS}|${DAY}`;
const ROUND_Q = '22222222-2222-4222-8222-2222222222e1';
const ROUND_SC = '33333333-3333-4333-8333-3333333333e1';
const PLAIN_Q = '22222222-2222-4222-8222-2222222222e2';
const PLAIN_SC = '33333333-3333-4333-8333-3333333333e2';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const SANA = 'c0000001-0000-4000-8000-0000000000e3';
const REF = { cl: 'K7Q2MXTRAB', rc: 'RND234' };
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

const lid = (n) => `4e550000-0000-4000-8000-00000000000${n}`;
const rid = (n) => `4ec00000-0000-4000-8000-00000000000${n}`;
const base = (over) => ({
  option_a: 'One', option_b: 'Two', option_c: 'Three', option_d: 'Four', correct_option: 'B', explanation: 'Because.',
  option_feedback: {}, render_pattern: 'P1', ...over,
});
const lesson = (n) => base({
  id: lid(n), quiz_id: ROUND_Q, external_id: `tq:${ROUND_Q}:S1:${n}`, sort_order: n, question_text: `Lesson question ${n}?`,
  media: { round: 'lesson', round_key: KEY, round_ref: REF },
});
// recall items: R1 missed by Ali and Sana (the class's most-missed), R2 and R5 by Zara, the rest by one other child each
const recall = (rank, kids) => base({
  id: rid(rank), quiz_id: ROUND_Q, external_id: `tq:rc${rank}:recall:0a0b0c0${rank}`, sort_order: 100 + rank,
  question_text: `Recall question ${rank}?`, correct_option: 'A',
  media: { round: 'recall', round_key: KEY, round_ref: REF, recall: { of: `0f000000-0000-4000-8000-00000000000${rank}`, rank, kids: kids.map((k) => Recall.kidKey(KEY, k)), chips: [] } },
});
const ROUND_ROWS = [1, 2, 3, 4, 5].map(lesson).concat([
  recall(1, [ALI, SANA]), recall(2, [ZARA]), recall(3, [ALI]), recall(4, [SANA]), recall(5, [ZARA]), recall(6, [ALI]),
]);
const ZARA_SET = [lid(1), lid(2), lid(3), lid(4), lid(5), rid(2), rid(5)];
const ALL_ROUND = ROUND_ROWS.map((q) => q.id);
const PLAIN_ROWS = [1, 2, 3, 4].map((n) => base({ id: `91a10000-0000-4000-8000-00000000000${n}`, quiz_id: PLAIN_Q, external_id: `tq:${PLAIN_Q}:S1:${n}`, sort_order: n, question_text: `Plain question ${n}?`, media: {} }));

let db;
function world({ seed = false, round = false } = {}) {
  db = {
    app_settings: [{ key: 'web_quiz_enabled', value: true },
      ...(seed ? [{ key: 'web_quiz_order_seed', value: true }] : []),
      ...(round ? [{ key: 'web_quiz_evening_round', value: true }] : [])],
    quiz_share_codes: [
      { id: ROUND_SC, code: 'RND234', quiz_id: ROUND_Q, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Fractions', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: CLASS, created_at: ago(0) },
      { id: PLAIN_SC, code: 'PLAIN1', quiz_id: PLAIN_Q, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Plants', language: 'en',
        active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: null, created_at: ago(3) },
    ],
    quizzes: [
      { id: ROUND_Q, teacher_id: TEACHER, topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', quiz_source: 'lp_v8', status: 'ready',
        meta: { source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: REF.cl, round_code: REF.rc, share_code_id: ROUND_SC } },
      { id: PLAIN_Q, teacher_id: TEACHER, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', quiz_source: 'transcript', status: 'sent', meta: {} },
    ],
    quiz_questions: [...ROUND_ROWS, ...PLAIN_ROWS].map((q) => ({ ...q, media: JSON.parse(JSON.stringify(q.media)) })),
    students: [{ id: ZARA, student_name: 'Zara Test', self_reported_class: null }, { id: ALI, student_name: 'Ali Test', self_reported_class: null }],
    // Zara finished the teacher's plain quiz three days ago: the class's name chips offer her on the round's code
    quiz_sessions: [{ id: '5e550000-0000-4000-8000-0000000000a1', quiz_id: PLAIN_Q, student_id: ZARA, student_name: 'Zara Test', user_id: null, share_code_id: PLAIN_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-old', created_at: ago(3), completed_at: ago(3), correct_answers: 3, total_questions_answered: 4 },
    { id: '5e550000-0000-4000-8000-0000000000a2', quiz_id: PLAIN_Q, student_id: ALI, student_name: 'Ali Test', user_id: null, share_code_id: PLAIN_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-old2', created_at: ago(3), completed_at: ago(3), correct_answers: 2, total_questions_answered: 4 }],
    quiz_answers: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  HubFlags._resetCache();
  Pulse._reset();
  logEvent.mockClear();
});
afterAll(() => { process.env = SAVED; });

const asZara = (extra = {}) => WQ.startSession({ code: 'RND234', chip: T.chipId(ROUND_SC, ZARA), ...extra });
const answerAll = (st, ids, slot = (id) => (id.startsWith('4ec0') ? 'A' : 'B')) => WQ.recordAnswers({ st, a: ids.map((qid) => ({ qid, slot: slot(qid) })) });
const started = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.session_started').map(([, d]) => d);

describe.each([
  ['web_quiz_order_seed on', { seed: true, round: false }],
  ['web_quiz_order_seed off, web_quiz_evening_round on', { seed: false, round: true }],
])('a round with %s: the child plays their own 5 + 2', (_label, sw) => {
  beforeEach(() => world(sw));

  test('the start reply lists exactly the child\'s 7 qids (5 lesson + the 2 recall items whose originals they missed)', async () => {
    const a = await asZara();
    expect(a.order).toBeDefined();
    expect([...a.order.q].sort()).toEqual([...ZARA_SET].sort());
  });

  test('answers outside the set are not recorded (as any qid the sitting does not serve); finish counts the 7', async () => {
    const a = await asZara();
    const out = await answerAll(a.st, ALL_ROUND);
    expect([...out.recorded].sort()).toEqual([...ZARA_SET].sort());
    expect([...out.unknown].sort()).toEqual([rid(1), rid(3), rid(4), rid(6)].sort());
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(7);
    expect(fin.review.map((r) => r.qid).sort()).toEqual([...ZARA_SET].sort());
  });

  test('half the child\'s set is enough to finish (need = 4 of 7, not 6 of 11)', async () => {
    const a = await asZara();
    await answerAll(a.st, ZARA_SET.slice(0, 4));
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(4);
  });

  test('a resume gets the same set back', async () => {
    const a = await asZara();
    const again = await WQ.startSession({ code: 'RND234', resume_st: a.st });
    expect(again.order).toEqual(a.order);
  });
});

describe('web_quiz_order_seed off, web_quiz_evening_round on', () => {
  beforeEach(() => world({ seed: false, round: true }));

  test('the round\'s own order (lesson items by sort order, then the recall picks), no option moves, no seed on the start event', async () => {
    const a = await asZara();
    expect(a.order).toEqual({ q: ZARA_SET, o: {} });
    const ev = started().pop();
    expect(ev.order_seed).toBeUndefined();
    expect(ev.pinned_n).toBeUndefined();
  });

  test('any other quiz: the start reply carries no order (today\'s reply), a second start reads its questions no more', async () => {
    const a = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Ali Test', force: true } });
    expect(a.order).toBeUndefined();
    expect(Object.keys(a).sort()).toEqual(['child', 'counted', 'device_ref', 'resume', 'st']);
  });
});

describe('both switches off', () => {
  beforeEach(() => world({ seed: false, round: false }));

  test('a round plays as an ordinary quiz everywhere: no order on the page, every item accepted, finish counts what was played', async () => {
    const a = await asZara();
    expect(a.order).toBeUndefined();
    const out = await answerAll(a.st, ALL_ROUND);
    expect(out.recorded).toHaveLength(11);
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.score.total).toBe(11);
  });

  test('any other quiz: today\'s reply', async () => {
    const a = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Ali Test', force: true } });
    expect(a.order).toBeUndefined();
  });
});

describe('web_quiz.round_started / round_done: once per sitting, codes and counts only', () => {
  const named = (n) => logEvent.mock.calls.filter(([e]) => e === n).map(([, d]) => d);
  const FIELDS = { class_link_code: REF.cl, round_code: REF.rc, n_items: 7, n_recall: 2 };

  test.each([
    ['web_quiz_order_seed on', { seed: true, round: false }],
    ['web_quiz_order_seed off, web_quiz_evening_round on', { seed: false, round: true }],
  ])('%s: started at the start (not again on a resume), done at the first finish with n_recall_right', async (_l, sw) => {
    world(sw);
    const a = await asZara();
    expect(named('web_quiz.round_started')).toEqual([FIELDS]);
    await WQ.startSession({ code: 'RND234', resume_st: a.st });
    expect(named('web_quiz.round_started')).toHaveLength(1);
    // lesson items right, recall #2 right (A), recall #5 wrong (B): one of the child's two recall items fixed
    await answerAll(a.st, ZARA_SET, (id) => (id === rid(5) ? 'B' : id.startsWith('4ec0') ? 'A' : 'B'));
    expect(named('web_quiz.round_done')).toEqual([]);
    await WQ.finishSession({ st: a.st });
    await WQ.finishSession({ st: a.st });
    expect(named('web_quiz.round_done')).toEqual([{ ...FIELDS, n_recall_right: 1 }]);
  });

  test('any other quiz, and a round played with both switches off: no round event', async () => {
    world({ seed: true, round: true });
    const p = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Ali Test', force: true } });
    await WQ.recordAnswers({ st: p.st, a: PLAIN_ROWS.map((q) => ({ qid: q.id, slot: 'B' })) });
    await WQ.finishSession({ st: p.st });
    world({ seed: false, round: false });
    HubFlags._resetCache();
    const a = await asZara();
    await answerAll(a.st, ALL_ROUND);
    await WQ.finishSession({ st: a.st });
    expect(named('web_quiz.round_started')).toEqual([]);
    expect(named('web_quiz.round_done')).toEqual([]);
  });
});

describe('siblings\' recall picks: own misses first, ties broken by the sitting\'s seed (seedOf(session id))', () => {
  const Round = require('../../shared/services/quiz/web-quiz-evening-round');
  const OrderSeed = require('../../shared/services/quiz/web-quiz-order-seed');
  // Sana missed four originals, each missed by her alone: every one of them ties
  const POOL = [1, 2, 3, 4, 5].map(lesson).concat([
    recall(1, [ALI, ZARA]), recall(2, [ZARA]), recall(3, [SANA]), recall(4, [SANA]), recall(5, [SANA]), recall(6, [SANA]),
  ]);
  const picks = (sid, kid = SANA, pool = POOL) => Round.selectRoundItems(pool, { studentId: kid, seed: OrderSeed.seedOf(sid) }).slice(5).map((q) => q.id);
  const SIDS = ['5e550000-0000-4000-8000-0000000000b1', '5e550000-0000-4000-8000-0000000000b2', '5e550000-0000-4000-8000-0000000000b3',
    '5e550000-0000-4000-8000-0000000000b4', '5e550000-0000-4000-8000-0000000000b5', '5e550000-0000-4000-8000-0000000000b6'];

  test('two sittings with the same misses can get different rewrites; each pick is two of the child\'s own misses', () => {
    const got = SIDS.map((sid) => picks(sid));
    got.forEach((p) => { expect(p).toHaveLength(2); p.forEach((id) => expect([rid(3), rid(4), rid(5), rid(6)]).toContain(id)); });
    expect(new Set(got.map((p) => p.join())).size).toBeGreaterThan(1);
  });

  test('the same sitting always gets the same pick, whatever order the rows come in; the picks keep the round\'s order', () => {
    SIDS.forEach((sid) => {
      const p = picks(sid);
      expect(picks(sid, SANA, [...POOL].reverse())).toEqual(p);
      expect([...p]).toEqual([...p].sort());   // rid(n) sort = rank order
    });
  });

  test('more-missed still beats fewer: the class\'s most-missed fills before a tie, a child\'s own misses before both', () => {
    SIDS.forEach((sid) => {
      expect(picks(sid, ZARA)).toEqual([rid(1), rid(2)]);                       // her own two, whatever the seed
      expect(picks(sid, 'c0000001-0000-4000-8000-0000000000ff')[0]).toBe(rid(1)); // nobody's: R1 (missed by two) first
    });
  });

  test('no seed (no sitting yet): the stored rank order, as before', () => {
    expect(Round.selectRoundItems(POOL, { studentId: SANA }).slice(5).map((q) => q.id)).toEqual([rid(3), rid(4)]);
  });

  test('the service: each sitting its own seeded pick, the same at start, resume, answers and finish', async () => {
    world({ seed: false, round: true });
    // deterministic session ids, so the outcome is the same on every run
    let n = 0;
    const spy = jest.spyOn(require('crypto'), 'randomUUID').mockImplementation(() => `5e55${String(n += 1).padStart(4, '0')}-0000-4000-8000-0000000000c1`);
    try {
      const seen = new Set();
      for (let k = 0; k < 6; k += 1) {
        // Ali missed R1 (with Sana: the most-missed), R3 and R6 (one each): R1, then one of R3 / R6 by the seed
        const a = await WQ.startSession({ code: 'RND234', chip: T.chipId(ROUND_SC, ALI) });
        const set = a.order.q;
        expect(set.slice(0, 6)).toEqual([lid(1), lid(2), lid(3), lid(4), lid(5), rid(1)]);
        expect([rid(3), rid(6)]).toContain(set[6]);
        const sid = db.quiz_sessions[db.quiz_sessions.length - 1].id;
        expect(set[6]).toBe(picks(sid, ALI, ROUND_ROWS)[1]);
        expect((await WQ.startSession({ code: 'RND234', resume_st: a.st })).order.q).toEqual(set);
        const out = await answerAll(a.st, ALL_ROUND);
        expect([...out.recorded].sort()).toEqual([...set].sort());
        const fin = await WQ.finishSession({ st: a.st });
        expect(fin.review.map((r) => r.qid).sort()).toEqual([...set].sort());
        seen.add(set[6]);
      }
      expect(seen.size).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the same-day swap: lesson items the child answered RIGHT earlier today are left out; a same-day miss stays', () => {
  const DONOR = '22222222-2222-4222-8222-2222222222d0';     // the lesson's authored lp_v8 quiz (the cache donor)
  const AFT = '22222222-2222-4222-8222-2222222222a0';       // the 15:00 offer's quiz of the same lesson: a cache copy of DONOR
  const OTHER = '22222222-2222-4222-8222-2222222222b0';     // another lesson's quiz, played today too
  const AFT_SC = '33333333-3333-4333-8333-3333333333a0';
  const named = (n) => logEvent.mock.calls.filter(([e]) => e === n).map(([, d]) => d);
  const pktMidnight = () => { const P = require('../../shared/services/nudges/pkt-time'); return P.atPkt(P.pktDate(new Date()), 0, 0).getTime(); };
  // earlier today (PKT), strictly before any sitting this test starts
  const earlierToday = () => new Date(pktMidnight() + Math.floor((Date.now() - pktMidnight()) / 2)).toISOString();
  const tailRow = (quizId, n, prefix) => base({ id: `${prefix}${n}`, quiz_id: quizId, external_id: `tq:${quizId}:S1:${n}`, sort_order: n, question_text: `Lesson question ${n}?`, media: {} });
  const L = (n) => lid(n);
  let sessionN = 0;

  // the round: 7 lesson items (copied from DONOR, tails S1:1..S1:7) + the 6 recall items; the AFT copy holds the same 7
  function swapWorld({ recallRows = true } = {}) {
    world({ seed: false, round: true });
    const rq = db.quizzes.find((q) => q.id === ROUND_Q);
    rq.meta.cache_donor = { quiz_id: DONOR, key: 'lp_v8|lesson|v|h|en' };
    db.quiz_questions = db.quiz_questions.filter((q) => q.quiz_id !== ROUND_Q || (recallRows && q.media.round === 'recall'));
    db.quiz_questions.push(lesson(1), lesson(2), lesson(3), lesson(4), lesson(5),
      base({ ...lesson(6), id: '4e550000-0000-4000-8000-000000000006', external_id: `tq:${ROUND_Q}:S1:6`, sort_order: 6 }),
      base({ ...lesson(7), id: '4e550000-0000-4000-8000-000000000007', external_id: `tq:${ROUND_Q}:S1:7`, sort_order: 7 }));
    db.quizzes.push(
      { id: DONOR, teacher_id: TEACHER, topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', quiz_source: 'lp_v8', status: 'sent', meta: {} },
      { id: AFT, teacher_id: TEACHER, topic: 'Fractions', grade: '3', subject: 'Maths', language: 'en', quiz_source: 'lp_v8', status: 'sent', meta: { cache_donor: { quiz_id: DONOR } } },
      { id: OTHER, teacher_id: TEACHER, topic: 'Plants', grade: '3', subject: 'Science', language: 'en', quiz_source: 'lp_v8', status: 'sent', meta: {} });
    [1, 2, 3, 4, 5, 6, 7].forEach((n) => db.quiz_questions.push(
      tailRow(DONOR, n, `d0d00000-0000-4000-8000-00000000000`), tailRow(AFT, n, `a0a00000-0000-4000-8000-00000000000`), tailRow(OTHER, n, `b0b00000-0000-4000-8000-00000000000`)));
    db.quiz_share_codes.push({ id: AFT_SC, code: 'AFT234', quiz_id: AFT, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher', topic: 'Fractions',
      language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, class_id: null, created_at: earlierToday() });
  }
  // Zara's earlier sitting on `quizId`: {n: right?} answers on that quiz's items, at `at`
  function played(quizId, marks, at = earlierToday(), prefix = quizId === DONOR ? 'd0d00000-0000-4000-8000-00000000000' : quizId === OTHER ? 'b0b00000-0000-4000-8000-00000000000' : quizId === ROUND_Q ? null : 'a0a00000-0000-4000-8000-00000000000') {
    sessionN += 1;
    const sid = `5e55aa00-0000-4000-8000-0000000000${String(sessionN).padStart(2, '0')}`;
    db.quiz_sessions.push({ id: sid, quiz_id: quizId, student_id: ZARA, student_name: 'Zara Test', user_id: null, share_code_id: quizId === ROUND_Q ? ROUND_SC : AFT_SC,
      status: 'completed', invited_by_student_id: null, device_ref: 'd-aft', created_at: at, completed_at: at, correct_answers: 0, total_questions_answered: 0 });
    Object.entries(marks).forEach(([n, ok]) => db.quiz_answers.push({ id: `${sid}-${n}`, session_id: sid, question_id: prefix ? `${prefix}${n}` : L(Number(n)),
      selected_option: ok ? 'B' : 'C', is_correct: ok, created_at: at }));
  }
  const lessonOf = (set) => set.filter((id) => id.startsWith('4e55'));

  beforeEach(() => { require('../../shared/services/quiz/web-quiz-evening-round-seen')._reset(); });

  test('right on the 15:00 copy earlier today: those items swapped for the next unseen ones; the miss stays; start, answers, finish agree', async () => {
    swapWorld();
    played(AFT, { 1: true, 2: false, 3: true });
    const a = await asZara();
    const want = [L(2), L(4), L(5), '4e550000-0000-4000-8000-000000000006', '4e550000-0000-4000-8000-000000000007', rid(2), rid(5)];
    expect(a.order.q).toEqual(want);
    expect(named('web_quiz.round_started')).toEqual([{ class_link_code: REF.cl, round_code: REF.rc, n_items: 7, n_recall: 2, n_swapped: 2 }]);
    const out = await answerAll(a.st, [...want, L(1), L(3)]);
    expect([...out.recorded].sort()).toEqual([...want].sort());
    expect([...out.unknown].sort()).toEqual([L(1), L(3)].sort());
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.review.map((r) => r.qid).sort()).toEqual([...want].sort());
  });

  test('the authored quiz itself (the donor) counts the same way', async () => {
    swapWorld();
    played(DONOR, { 4: true, 5: true });
    expect(lessonOf((await asZara()).order.q)).toEqual([L(1), L(2), L(3), '4e550000-0000-4000-8000-000000000006', '4e550000-0000-4000-8000-000000000007']);
  });

  test('stable: a right answer recorded after the sitting started (another tab) changes nothing at answers, finish or a resume', async () => {
    swapWorld();
    played(AFT, { 1: true });
    const a = await asZara();
    const set = a.order.q;
    expect(lessonOf(set)).toEqual([L(2), L(3), L(4), L(5), '4e550000-0000-4000-8000-000000000006']);
    const later = new Date(Date.now() + 1000).toISOString();                        // after the sitting's start
    const open = db.quiz_sessions.find((x) => x.quiz_id === AFT);
    db.quiz_answers.push({ id: 'late-2', session_id: open.id, question_id: 'a0a00000-0000-4000-8000-000000000002', selected_option: 'B', is_correct: true, created_at: later });
    played(AFT, { 3: true }, later);
    require('../../shared/services/quiz/web-quiz-evening-round-seen')._reset();    // no memo: the read itself is stable
    expect((await WQ.startSession({ code: 'RND234', resume_st: a.st })).order.q).toEqual(set);
    const out = await answerAll(a.st, set);
    expect([...out.recorded].sort()).toEqual([...set].sort());
    expect((await WQ.finishSession({ st: a.st })).score.total).toBe(set.length);
  });

  test('no swap for: another lesson\'s quiz, yesterday\'s answers, the round\'s own earlier sitting', async () => {
    swapWorld();
    played(OTHER, { 1: true, 2: true });
    played(AFT, { 3: true }, new Date(pktMidnight() - 3600000).toISOString());
    played(ROUND_Q, { 4: true });
    expect(lessonOf((await asZara()).order.q)).toEqual([L(1), L(2), L(3), L(4), L(5)]);
    expect(named('web_quiz.round_started')[0].n_swapped).toBeUndefined();
  });

  test('nothing unseen left: the set is shorter (never padded with an item answered right), and the event says so', async () => {
    swapWorld();
    played(AFT, { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: false });
    const a = await asZara();
    expect(a.order.q).toEqual(['4e550000-0000-4000-8000-000000000007', rid(2), rid(5)]);
    expect(named('web_quiz.round_started')).toEqual([{ class_link_code: REF.cl, round_code: REF.rc, n_items: 3, n_recall: 2, n_swapped: 5, n_short: 4 }]);
    await answerAll(a.st, a.order.q.slice(0, 2));
    expect((await WQ.finishSession({ st: a.st })).score.total).toBe(2);
  });

  test('any other quiz: today\'s reply, whatever the child answered earlier', async () => {
    swapWorld();
    played(AFT, { 1: true });
    const p = await WQ.startSession({ code: 'PLAIN1', new: { name: 'Sana Test', force: true } });
    expect(p.order).toBeUndefined();
  });
});

describe('a round serves only its lesson and recall items: a held (or dropped) item never reaches a child', () => {
  const HELD = '4e550000-0000-4000-8000-0000000000h1';
  const DROPPED = '4e550000-0000-4000-8000-0000000000d1';
  function heldWorld(sw) {
    world(sw);
    // an item whose key is held (afterGenerate heldLessonItems: media.round 'held'), and one the key review dropped
    db.quiz_questions.push(
      base({ id: HELD, quiz_id: ROUND_Q, external_id: `tq:${ROUND_Q}:S1:9`, sort_order: 0, question_text: 'Held stem?', correct_option: 'C', media: { round: 'held', round_key: KEY } }),
      base({ id: DROPPED, quiz_id: ROUND_Q, external_id: `tq:${ROUND_Q}:S1:10`, sort_order: 0, question_text: 'Dropped stem?', correct_option: 'D', media: { round: 'dropped', round_key: KEY } }),
    );
  }

  test.each([
    ['web_quiz_order_seed on', { seed: true, round: false }],
    ['web_quiz_order_seed off, web_quiz_evening_round on', { seed: false, round: true }],
    ['both off', { seed: false, round: false }],
  ])('%s: the page GET carries neither stem nor key; the start, the answers and the finish never count them', async (_l, sw) => {
    heldWorld(sw);
    const page = await WQ.getQuiz('RND234');
    const ids = page.quiz.questions.map((q) => q.qid);
    expect(ids).not.toContain(HELD);
    expect(ids).not.toContain(DROPPED);
    expect(JSON.stringify(page)).not.toMatch(/Held stem|Dropped stem/);
    expect(ids.sort()).toEqual([...ALL_ROUND].sort());
    const a = await asZara();
    if (a.order) expect(a.order.q).not.toContain(HELD);
    const out = await answerAll(a.st, [HELD, DROPPED, ...ALL_ROUND]);
    expect(out.unknown).toEqual(expect.arrayContaining([HELD, DROPPED]));
    const fin = await WQ.finishSession({ st: a.st });
    expect(fin.review.map((r) => r.qid)).not.toContain(HELD);
  });

  test('any other quiz: every row served, as today', async () => {
    heldWorld({ seed: false, round: true });
    const page = await WQ.getQuiz('PLAIN1');
    expect(page.quiz.questions.map((q) => q.qid)).toEqual(PLAIN_ROWS.map((q) => q.id));
  });
});
