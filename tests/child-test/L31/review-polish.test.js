/**
 * L31 (bd-s1oo0.46.7) — review polish from the real-WhatsApp run (shots_v2 10, 09).
 *
 *   A non-reader's questions: when the fallback ran the coach skipped the questions by design, so they are never
 *   review items, the summary never counts them, and coach_marks scores them 'not_asked' (never wrong).
 *   The time estimate: about 6 s per item: "about a minute" up to 10 items, "about 2 minutes" beyond.
 *
 * Real: review.js, review-view.js, check-store, store.js, identity, the catalog, the thresholds. Mocked: the
 * Supabase client, the WhatsApp send, the log sinks.
 */
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../../bot/shared/services/whatsapp.service');
const Logger = require('../../../bot/shared/utils/logger');
const review = require('../../../bot/shared/services/child-test/check-flow/review');
const { handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
const { detectFlowType } = require('../../../bot/shared/utils/flow-type-detector');
const M = require('../L28/fixtures/marks-v2');

const VISIT = '11111111-1111-4111-8111-111111111111';
const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' };

/** sessions: [{ id, name, blocks: { urdu, english, maths } }] in visit order */
function seed(sessions, { lang = 'en', checked = false } = {}) {
  const rows = { sessions: [], draws: [], students: [], blocks: [] };
  sessions.forEach((s, i) => {
    rows.sessions.push({
      id: s.id, coach_user_id: s.coach || COACH.id, visit_id: VISIT, grade: 3, form: 'A', draw_id: `draw-${s.id}`,
      student_id: `stu-${s.id}`, status: 'completed', started_at: `2026-10-03T09:0${i}:00.000Z`, timings: {},
    });
    rows.draws.push({ id: `draw-${s.id}`, roll_number: String(10 + i), student_id: `stu-${s.id}` });
    rows.students.push({ id: `stu-${s.id}`, student_name: s.name || null, student_name_urdu: null });
    for (const [block, b] of Object.entries(s.blocks)) {
      if (b === undefined) continue;
      const row = { id: `blk-${s.id}-${block}`, session_id: s.id, block, checked_at: checked ? '2026-10-03T10:00:00.000Z' : null, coach_marks: null };
      if (b && b.pending) Object.assign(row, { ai_marks: null, ai_status: 'scoring', ai_reason: 'attempt:1' });
      else if (b && b.failed) Object.assign(row, { ai_marks: null, ai_status: 'failed', ai_reason: 'final:no_audio' });
      else Object.assign(row, { ai_marks: b, ai_status: 'scored' });
      rows.blocks.push(row);
    }
  });
  mockFake = createFakeSupabase({
    users: [{ ...COACH, preferred_language: lang }],
    child_test_sessions: rows.sessions,
    child_test_draws: rows.draws,
    students: rows.students,
    child_test_blocks: rows.blocks,
  });
}

const blockRow = (sessionId, block) => mockFake.__tables.child_test_blocks.find((r) => r.session_id === sessionId && r.block === block);
const allSure = () => ({ urdu: M.urdu(), english: M.english(), maths: M.maths() });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_REVIEW_FLOW_ID = 'review-flow-1';
  delete process.env.CHILD_TEST_CHECK_MODE;
});


const NON_READER = { letters: { correct: 4, of: 10, confidence: 0.9 }, words: { correct: 4, of: 10, confidence: 0.9 } };
const lowQ = (o = {}) => ({ qConf: [0.3, 0.3, 0.3], ...o });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_REVIEW_FLOW_ID = 'review-flow-1';
  delete process.env.CHILD_TEST_CHECK_MODE;
});

describe("a non-reader's questions (the fallback ran)", () => {
  test('are never review items, even when their confidence is low', async () => {
    seed([
      { id: 's1', name: 'Hassan Abbas', blocks: { urdu: M.urdu(lowQ({ fallback: NON_READER })), english: M.english(lowQ({ fallback: NON_READER })), maths: M.maths() } },
      { id: 's2', name: 'Ayesha Khan', blocks: { urdu: M.urdu(lowQ()), english: M.english(), maths: M.maths() } },
    ]);
    const { items } = await review.doubtfulItems(['s1', 's2']);
    expect(items.map((i) => `${i.sessionId}:${i.path}`)).toEqual([
      's2:questions[u3A-q1].verdict', 's2:questions[u3A-q2].verdict', 's2:questions[u3A-q3].verdict',
    ]);
  });

  test("a visit whose only doubtful answers are a non-reader's sends no form; their questions are saved 'not_asked'", async () => {
    seed([{ id: 's1', name: 'Hassan Abbas', blocks: { urdu: M.urdu(lowQ({ fallback: NON_READER })), english: M.english(), maths: M.maths() } }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 0 });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    const cm = blockRow('s1', 'urdu').coach_marks;
    expect(cm.questions.map((q) => q.verdict)).toEqual(['not_asked', 'not_asked', 'not_asked']);
    expect(cm.meta.not_asked).toEqual(['questions[u3A-q1].verdict', 'questions[u3A-q2].verdict', 'questions[u3A-q3].verdict']);
    expect(blockRow('s1', 'urdu').coach_edits).toEqual([]);
    // the AI's own marks are write-once and untouched
    expect(blockRow('s1', 'urdu').ai_marks.questions.map((q) => q.verdict)).not.toContain('not_asked');
    // a reader's block is unchanged
    expect(blockRow('s1', 'english').coach_marks.questions.map((q) => q.verdict)).toEqual(M.english().questions.map((q) => q.verdict));
  });

  test("submitting the form leaves the non-reader's questions 'not_asked' beside the reviewed ones", async () => {
    seed([
      { id: 's1', name: 'Hassan Abbas', blocks: { urdu: M.urdu(lowQ({ fallback: NON_READER })), english: M.english(), maths: M.maths() } },
      { id: 's2', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ qConf: [0.3, 0.95, 0.95] }), english: M.english(), maths: M.maths() } },
    ]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 1 });
    const d = WhatsAppService.sendFlow.mock.calls[0][1].screenData;
    expect(d.i1_who).toBe('Ayesha Khan · Urdu question 1');
    const { handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
    await handleCheckCompletion({ flow_token: review.buildReviewToken(COACH.id, VISIT), k1: d.i1_k, r1: 'correct' }, COACH.phone_number, COACH);
    expect(blockRow('s1', 'urdu').coach_marks.questions.map((q) => q.verdict)).toEqual(['not_asked', 'not_asked', 'not_asked']);
    expect(blockRow('s2', 'urdu').coach_marks.questions[0].verdict).toBe('correct');
  });

  test('the summary shows letters and words, never "answers", even if the fallback carries no counts', async () => {
    seed([{ id: 's1', name: 'Hassan Abbas', blocks: { urdu: M.urdu({ fallback: { confidence: 0.4 } }), english: M.english(), maths: M.maths() } }]);
    const text = await review.visitSummary('en', VISIT);
    const urdu = text.split(' · English')[0];
    expect(urdu).not.toMatch(/answers/);
    expect(urdu).toContain('Urdu letters — of 10, words — of 10');
  });
});

describe('the time the review takes, about 6 s per item', () => {
  const visit = (n) => Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`, name: `Child ${i + 1}`, blocks: { urdu: M.urdu(lowQ()), english: M.english(), maths: M.maths() },
  }));
  test.each([
    [1, 3, 'en', 'about a minute'],
    [3, 9, 'en', 'about a minute'],
    [5, 15, 'en', 'about 2 minutes'],
    [5, 15, 'ur', 'تقریباً ۲ منٹ'],
    [3, 9, 'ur', 'تقریباً ایک منٹ'],
  ])('%i children → %i items (%s): "%s"', async (children, n, lang, phrase) => {
    seed(visit(children), { lang });
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r.items).toBe(n);
    const { body, header } = WhatsAppService.sendFlow.mock.calls[0][1];
    expect(body).toContain(phrase);
    expect([...body].length).toBeLessThanOrEqual(1024);
    expect([...header].length).toBeLessThanOrEqual(60);
    if (n > 10) expect(body).not.toMatch(/about a minute|ایک منٹ/);
  });
});
