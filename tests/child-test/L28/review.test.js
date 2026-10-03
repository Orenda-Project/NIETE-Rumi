/**
 * Child test v2 — the end-of-visit review (bd-s1oo0.46.4, CONTRACT §19 "L28 → L26").
 *
 *   visitSummary(lang, visitKey)       one line per child from ai_marks: words/min + answers per language, maths right of 10
 *   doubtfulItems(sessionIds)          question verdicts and maths.oral items under their bar, visit order, ≤ 15
 *   sendReview(coachUserId, visitKey)  one Flow message (navigate mode) — or, with 0 doubtful items, no message and
 *                                      every block settled straight away as 'ai_unreviewed'
 *   handleCheckCompletion(review token) the coach's verdicts → coach_marks/coach_edits/checked_at on every block, once
 *
 * Real: review.js, check-store, store.js, identity, the catalog, the thresholds. Mocked: the Supabase client,
 * the WhatsApp send, the log sinks.
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
const M = require('./fixtures/marks-v2');

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

describe('visitSummary', () => {
  test('one line per child, every part scored: words/min and answers per language, maths right of 10', async () => {
    seed([
      { id: 's1', name: 'Ayesha Khan', blocks: allSure() },
      { id: 's2', name: 'Bilal Ahmed', blocks: { urdu: M.urdu({ wc: 30, right: 1 }), english: M.english({ wc: 12, right: 0 }), maths: M.maths({ right: 4 }) } },
    ]);
    const text = await review.visitSummary('en', VISIT);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Ayesha Khan — Urdu 41 words/min, 2 of 3 answers · English 18 words/min, 1 of 3 answers · Maths 7 of 10');
    expect(lines[1]).toContain('Bilal Ahmed — Urdu 30 words/min, 1 of 3 answers');
    expect(lines[1]).toContain('Maths 4 of 10');
    // rolls are never shown in v2 (CONTRACT §19)
    expect(text).not.toMatch(/roll/i);
  });

  test('a part whose scoring failed says "not scored"; a child who finished early is scaled to a minute', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ wc: 40, seconds: 40 }), english: { failed: true }, maths: M.maths() } }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('Urdu 60 words/min');
    expect(text).toContain('English not scored');
    expect(text).toContain('Maths 7 of 10');
  });

  test('a non-reader shows letters and words; a block that never arrived is "not scored"', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ fallback: { letters: { correct: 7, of: 10 }, words: { correct: 4, of: 10 } } }), english: M.english(), maths: undefined } }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('Urdu letters 7 of 10, words 4 of 10');
    expect(text).toContain('Maths not scored');
  });

  test('Urdu: catalog copy, Urdu digits, no throw for a child with no name', async () => {
    seed([{ id: 's1', name: null, blocks: allSure() }], { lang: 'ur' });
    const text = await review.visitSummary('ur', VISIT);
    expect(text).toContain('۴۱');
    expect(text).toContain('اردو');
    expect(text).toContain('(کلاس کی فہرست میں نام نہیں)');
    expect(text).not.toMatch(/null|undefined/);
  });
});

describe('doubtfulItems', () => {
  test('questions and maths.oral items under their bar, in visit order; story and fallback counts never', async () => {
    seed([
      { id: 's1', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ qConf: [0.95, 0.5, 0.92], storyConf: 0.1 }), english: M.english({ qConf: [0.95, 0.95, 0.4] }), maths: M.maths({ lowConf: ['sums', 1] }) } },
      { id: 's2', name: 'Bilal Ahmed', blocks: { urdu: M.urdu({ qConf: [0.3, 0.95, 0.95], fallback: { letters: { correct: 2, of: 10, confidence: 0.1 }, words: { correct: 0, of: 10, confidence: 0.1 } } }), english: M.english(), maths: M.maths() } },
    ]);
    const { items, aiOnly } = await review.doubtfulItems(['s1', 's2']);
    expect(items.map((i) => `${i.sessionId}:${i.path}`)).toEqual([
      's1:questions[u3A-q2].verdict',
      's1:questions[e3A-q3].verdict',
      's1:maths.oral.sums[m3A-s2].verdict',
      's2:questions[u3A-q1].verdict',
    ]);
    expect(aiOnly).toEqual([]);
    expect(items.some((i) => /story|fallback/.test(i.path))).toBe(false);
    expect(items[0]).toMatchObject({ block: 'urdu', kind: 'question', number: 2, heard: expect.any(String) });
  });

  test('more than 15: the 15 lowest-confidence are asked, still in visit order; the rest stay AI-only', async () => {
    const low = (c) => M.urdu({ qConf: [c, c, c] });
    // 6 children × 3 doubtful Urdu questions = 18; s1's are the most confident of the doubtful ones
    seed(['s1', 's2', 's3', 's4', 's5', 's6'].map((id, i) => ({ id, name: `Child ${id}`, blocks: { urdu: low(i === 0 ? 0.8 : 0.2 + i / 100), english: M.english(), maths: M.maths() } })));
    const { items, aiOnly } = await review.doubtfulItems(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(items).toHaveLength(15);
    expect(items.every((i) => i.sessionId !== 's1')).toBe(true);
    expect(items.map((i) => i.sessionId)).toEqual(['s2', 's2', 's2', 's3', 's3', 's3', 's4', 's4', 's4', 's5', 's5', 's5', 's6', 's6', 's6']);
    expect(aiOnly.map((i) => `${i.sessionId}:${i.path}`)).toEqual(['s1:questions[u3A-q1].verdict', 's1:questions[u3A-q2].verdict', 's1:questions[u3A-q3].verdict']);
  });

  test('a question with no verdict at all is doubtful whatever its confidence', async () => {
    const u = M.urdu();
    u.questions[0].verdict = null;
    seed([{ id: 's1', name: 'A', blocks: { urdu: u, english: M.english(), maths: M.maths() } }]);
    const { items } = await review.doubtfulItems(['s1']);
    expect(items.map((i) => i.path)).toEqual(['questions[u3A-q1].verdict']);
  });
});

describe('sendReview', () => {
  test('one Flow message, navigate mode, opens on REVIEW with only the doubtful items; nothing written yet', async () => {
    seed([
      { id: 's1', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ qConf: [0.95, 0.5, 0.92] }), english: M.english(), maths: M.maths({ lowConf: ['word_problems', 0] }) } },
      { id: 's2', name: 'Bilal Ahmed', blocks: allSure() },
    ]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 2 });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to, msg] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe(COACH.phone_number);
    expect(msg.flowId).toBe('review-flow-1');
    expect(msg.screen).toBe('REVIEW');
    expect(msg.flowToken).toBe(review.buildReviewToken(COACH.id, VISIT));
    expect(msg.header).toBe('2 answers need your ear');
    expect(msg.body).toContain('Ayesha Khan — Urdu 41 words/min');
    expect(msg.body).toContain('about a minute');
    expect(msg.buttonText).toBe('Check answers');
    expect([...msg.body].length).toBeLessThanOrEqual(1024);
    const d = msg.screenData;
    expect(d.i1_v).toBe(true);
    expect(d.i1_who).toBe('Ayesha Khan · Urdu question 2');
    expect(d.i1_q).toBe(M.URDU_Q2_PROMPT);
    expect(d.i1_h).toBe('Heard: «وہ دریا پر گیا»');
    expect(d.i2_who).toBe('Ayesha Khan · Maths word problem 1');
    expect(d.i3_v).toBe(false);
    expect(d.i15_v).toBe(false);
    expect(d.verdicts.map((v) => v.title)).toEqual(['Right', 'Wrong', "Didn't answer"]);
    // every declared slot is supplied (navigate mode has no endpoint to fill the rest)
    for (let i = 1; i <= 15; i += 1) for (const k of ['v', 'who', 'q', 'h', 'k']) expect(d[`i${i}_${k}`]).toBeDefined();
    expect(mockFake.__tables.child_test_blocks.every((b) => b.checked_at === null)).toBe(true);
  });

  test('0 doubtful items: no message; every block of every session gets coach_marks = ai_marks, source ai_unreviewed', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', blocks: allSure() }, { id: 's2', name: 'Bilal Ahmed', blocks: { ...allSure(), english: { failed: true } } }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 0 });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    for (const s of ['s1', 's2']) {
      for (const b of ['urdu', 'english', 'maths']) {
        const row = blockRow(s, b);
        expect(row.checked_at).toBeTruthy();
        expect(row.coach_edits).toEqual([]);
        expect(row.coach_marks.meta.source).toBe('ai_unreviewed');
      }
    }
    expect(blockRow('s1', 'urdu').coach_marks.questions).toEqual(M.urdu().questions);
    expect(blockRow('s2', 'english').coach_marks.meta.no_ai_marks).toBe(true);
    expect(blockRow('s1', 'urdu').ai_marks).toEqual(M.urdu());
  });

  test('scoring still running on a block: nothing sent, nothing written, the caller is told', async () => {
    seed([{ id: 's1', name: 'A', blocks: { urdu: M.urdu(), english: M.english(), maths: { pending: true } } }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toEqual({ ok: false, reason: 'scoring_pending', pending: 1 });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(blockRow('s1', 'urdu').checked_at).toBeNull();
  });

  test('only this coach\'s sessions; inert when disabled; per_child mode leaves the old check alone', async () => {
    seed([{ id: 's1', name: 'A', blocks: allSure() }, { id: 's9', coach: 'coach-2', name: 'B', blocks: allSure() }]);
    await review.sendReview(COACH.id, VISIT);
    expect(blockRow('s9', 'urdu').checked_at).toBeNull();

    seed([{ id: 's1', name: 'A', blocks: allSure() }]);
    process.env.CHILD_TEST_CHECK_MODE = 'per_child';
    expect(await review.sendReview(COACH.id, VISIT)).toEqual({ ok: false, reason: 'per_child_mode' });
    expect(blockRow('s1', 'urdu').checked_at).toBeNull();
    delete process.env.CHILD_TEST_CHECK_MODE;

    process.env.CHILD_TEST_ENABLED = 'false';
    expect(await review.sendReview(COACH.id, VISIT)).toEqual({ ok: false, reason: 'disabled' });
  });

  test('no Flow id with items to ask: error logged, nothing written', async () => {
    delete process.env.CHILD_TEST_REVIEW_FLOW_ID;
    seed([{ id: 's1', name: 'A', blocks: { ...allSure(), urdu: M.urdu({ qConf: [0.2, 0.95, 0.95] }) } }]);
    expect(await review.sendReview(COACH.id, VISIT)).toEqual({ ok: false, reason: 'flow_not_configured' });
    expect(Logger.logError).toHaveBeenCalled();
    expect(blockRow('s1', 'urdu').checked_at).toBeNull();
  });
});

describe('the review is submitted', () => {
  function submitted(verdictsBySlot, token = review.buildReviewToken(COACH.id, VISIT)) {
    const sent = WhatsAppService.sendFlow.mock.calls[0][1].screenData;
    const out = { child_test: 'review', flow_token: token, review_ref: sent.review_ref };
    for (let i = 1; i <= 15; i += 1) { out[`k${i}`] = sent[`i${i}_k`]; out[`r${i}`] = verdictsBySlot[i] || ''; }
    return out;
  }

  beforeEach(async () => {
    seed([
      { id: 's1', name: 'Ayesha Khan', blocks: { urdu: M.urdu({ qConf: [0.95, 0.5, 0.92] }), english: M.english(), maths: M.maths({ lowConf: ['sums', 1] }) } },
      { id: 's2', name: 'Bilal Ahmed', blocks: { ...allSure(), english: { failed: true } } },
    ]);
    await review.sendReview(COACH.id, VISIT);
  });

  test('the completion is recognised as the child test check by the detector', () => {
    expect(detectFlowType(submitted({ 1: 'correct', 2: 'wrong' }))).toBe('child_test_check');
  });

  test('every block of every session is written once: reviewed verdicts replaced, edits listed, source per block', async () => {
    const r = await handleCheckCompletion(submitted({ 1: 'correct', 2: 'wrong' }), COACH.phone_number, COACH);
    expect(r).toMatchObject({ ok: true, review: true, saved: 6 });
    const u = blockRow('s1', 'urdu');
    expect(u.coach_marks.questions[1].verdict).toBe('correct');      // AI said wrong
    expect(u.coach_marks.meta).toMatchObject({ source: 'review', reviewed: ['questions[u3A-q2].verdict'] });
    expect(u.coach_edits).toEqual([{ path: 'questions[u3A-q2].verdict', ai: 'wrong', coach: 'correct' }]);
    const m = blockRow('s1', 'maths');
    expect(m.coach_marks.maths.oral.sums[1].verdict).toBe('wrong');  // AI said wrong too: no edit
    expect(m.coach_edits).toEqual([]);
    expect(m.coach_marks.meta.source).toBe('review');
    expect(blockRow('s1', 'english').coach_marks.meta.source).toBe('ai_unreviewed');
    expect(blockRow('s2', 'english').coach_marks.meta).toMatchObject({ source: 'ai_unreviewed', no_ai_marks: true });
    expect(mockFake.__tables.child_test_blocks.every((b) => b.checked_at)).toBe(true);
    // ai_marks are untouched
    expect(u.ai_marks.questions[1].verdict).toBe('wrong');
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/saved/i);
  });

  test('a second submit is refused politely and changes nothing', async () => {
    await handleCheckCompletion(submitted({ 1: 'correct', 2: 'wrong' }), COACH.phone_number, COACH);
    const before = JSON.stringify(mockFake.__tables.child_test_blocks);
    WhatsAppService.sendMessage.mockClear();
    const r = await handleCheckCompletion(submitted({ 1: 'wrong', 2: 'correct' }), COACH.phone_number, COACH);
    expect(r).toMatchObject({ ok: true, review: true, saved: 0, already: 6 });
    expect(JSON.stringify(mockFake.__tables.child_test_blocks)).toBe(before);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toBe('These answers were saved earlier. Nothing was changed.');
  });

  test('another coach\'s token, or a key for a session outside the visit, writes nothing', async () => {
    const other = { id: 'coach-2', preferred_language: 'en' };
    expect((await handleCheckCompletion(submitted({ 1: 'correct' }), '923000000002', other)).ok).toBe(false);
    const forged = submitted({ 1: 'correct', 2: 'wrong' });
    forged.k1 = 'sX|urdu|question|u3A-q2';
    const r = await handleCheckCompletion(forged, COACH.phone_number, COACH);
    expect(r.ok).toBe(true);
    // the forged slot is ignored: the item keeps the AI verdict
    expect(blockRow('s1', 'urdu').coach_marks.questions[1].verdict).toBe('wrong');
    expect(blockRow('s1', 'urdu').coach_edits).toEqual([]);
  });

  test('a save that fails is told to the coach and logged at error level', async () => {
    const realFrom = mockFake.from;
    mockFake.from = (t) => {
      const q = realFrom(t);
      if (t !== 'child_test_blocks') return q;
      const update = q.update;
      q.update = () => { throw new Error('db down'); };
      void update;
      return q;
    };
    const r = await handleCheckCompletion(submitted({ 1: 'correct', 2: 'wrong' }), COACH.phone_number, COACH);
    expect(r.ok).toBe(false);
    expect(Logger.logError).toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/didn't save/i);
  });
});
