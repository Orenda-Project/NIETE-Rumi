'use strict';
/**
 * L34 (bd-s1oo0.47, CONTRACT §20) — the results line and the end-of-visit review respect the reach rule.
 *   results: "answers 2 of 2 asked", plus "(1 not reached)" when a question was past the child's reading
 *   review:  never lists a question that was not reached or not asked
 *   coach_marks: a question the coach did not ask is 'not_asked'; an asked-beyond-reach one is listed in meta
 * Real: review.js, review-view.js, check-store, store.js, the catalog. Mocked: Supabase, WhatsApp, log sinks.
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
const review = require('../../../bot/shared/services/child-test/check-flow/review');
const { handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
const M = require('../L28/fixtures/marks-v2');

const VISIT = '11111111-1111-4111-8111-111111111111';
const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' };

function seed(sessions, { lang = 'en' } = {}) {
  const rows = { sessions: [], draws: [], students: [], blocks: [] };
  sessions.forEach((s, i) => {
    rows.sessions.push({ id: s.id, coach_user_id: COACH.id, visit_id: VISIT, grade: 3, form: 'A', draw_id: `draw-${s.id}`, student_id: `stu-${s.id}`, status: 'completed', started_at: `2026-10-03T09:0${i}:00.000Z`, timings: {} });
    rows.draws.push({ id: `draw-${s.id}`, roll_number: String(10 + i), student_id: `stu-${s.id}` });
    rows.students.push({ id: `stu-${s.id}`, student_name: s.name, student_name_urdu: null });
    for (const [block, b] of Object.entries(s.blocks)) {
      rows.blocks.push({ id: `blk-${s.id}-${block}`, session_id: s.id, block, checked_at: null, coach_marks: null, ai_marks: b, ai_status: 'scored' });
    }
  });
  mockFake = createFakeSupabase({ users: [{ ...COACH, preferred_language: lang }], child_test_sessions: rows.sessions, child_test_draws: rows.draws, students: rows.students, child_test_blocks: rows.blocks });
}
const blockRow = (sid, block) => mockFake.__tables.child_test_blocks.find((r) => r.session_id === sid && r.block === block);

/** Urdu marks with §20 rows: reach/asked per question (q1..q3), verdicts and confidences given. */
function urduReach({ reached, asked, verdicts = ['correct', 'correct', 'correct'], conf = [0.95, 0.95, 0.95] }) {
  const u = M.urdu();
  u.questions = u.questions.map((q, i) => ({ ...q, verdict: verdicts[i], confidence: conf[i], reached: reached[i], asked: asked[i], ...(asked[i] && !reached[i] ? { beyond_reach: true } : {}) }));
  return u;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_REVIEW_FLOW_ID = 'review-flow-1';
  delete process.env.CHILD_TEST_CHECK_MODE;
});

describe('results line', () => {
  test('a slow reader: "answers 2 of 2 asked (1 not reached)"; the beyond-reach answer is not counted', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: urduReach({ reached: [true, true, false], asked: [true, true, true] }), english: M.english(), maths: M.maths() } }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('Urdu 41 words/min, answers 2 of 2 asked (1 not reached)');
    // older marks (no reached/asked) keep the old line
    expect(text).toContain('English 18 words/min, 1 of 3 answers');
  });

  test('every question reached and asked: no "not reached" note', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: urduReach({ reached: [true, true, true], asked: [true, true, true], verdicts: ['correct', 'wrong', 'correct'] }), english: M.english(), maths: M.maths() } }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('Urdu 41 words/min, answers 2 of 3 asked ·');
    expect(text).not.toMatch(/not reached/);
  });

  test('a reached question the coach skipped is not in "asked"', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: urduReach({ reached: [true, true, false], asked: [true, false, false] }), english: M.english(), maths: M.maths() } }]);
    expect(await review.visitSummary('en', VISIT)).toContain('answers 1 of 1 asked (1 not reached)');
  });

  test('no question reached: said plainly, never "0 of 0"', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: urduReach({ reached: [false, false, false], asked: [false, false, false] }), english: M.english(), maths: M.maths() } }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('Urdu 41 words/min, no questions asked (3 not reached)');
    expect(text).not.toMatch(/0 of 0/);
  });

  test('Urdu: catalog copy with Urdu digits', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: urduReach({ reached: [true, true, false], asked: [true, true, true] }), english: M.english(), maths: M.maths() } }], { lang: 'ur' });
    const text = await review.visitSummary('ur', VISIT);
    expect(text).toContain('پوچھے گئے ۲ میں سے ۲ جواب درست (۱ سوال تک نہیں پہنچے)');
    expect(text).not.toMatch(/[0-9]/);
  });
});

describe('the review never lists an unreached or not-asked question', () => {
  test('doubtful but not reached, or not asked: not an item', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: {
      urdu: urduReach({ reached: [true, true, false], asked: [true, false, true], verdicts: ['wrong', 'none', 'wrong'], conf: [0.3, 0.3, 0.3] }),
      english: M.english(), maths: M.maths(),
    } }]);
    const { items } = await review.doubtfulItems(['s1']);
    expect(items.map((i) => i.path)).toEqual(['questions[u3A-q1].verdict']);
  });

  test('coach_marks: the not-asked question is "not_asked"; the beyond-reach one is listed, its AI verdict kept', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: {
      urdu: urduReach({ reached: [true, true, false], asked: [true, false, true], verdicts: ['wrong', 'none', 'wrong'], conf: [0.3, 0.3, 0.3] }),
      english: M.english(), maths: M.maths(),
    } }]);
    await review.sendReview(COACH.id, VISIT);
    const sent = WhatsAppService.sendFlow.mock.calls[0][1].screenData;
    expect(sent.i1_v).toBe(true);
    expect(sent.i2_v).toBe(false);
    const out = { child_test: 'review', flow_token: review.buildReviewToken(COACH.id, VISIT), review_ref: sent.review_ref };
    for (let i = 1; i <= 15; i += 1) { out[`k${i}`] = sent[`i${i}_k`]; out[`r${i}`] = i === 1 ? 'correct' : ''; }
    const r = await handleCheckCompletion(out, COACH.phone_number, COACH);
    expect(r).toMatchObject({ ok: true, review: true });
    const cm = blockRow('s1', 'urdu').coach_marks;
    expect(cm.questions.map((q) => q.verdict)).toEqual(['correct', 'not_asked', 'wrong']);
    expect(cm.meta.not_asked).toEqual(['questions[u3A-q2].verdict']);
    expect(cm.meta.beyond_reach).toEqual(['questions[u3A-q3].verdict']);
    expect(blockRow('s1', 'urdu').coach_edits).toEqual([{ path: 'questions[u3A-q1].verdict', ai: 'wrong', coach: 'correct' }]);
  });
});
