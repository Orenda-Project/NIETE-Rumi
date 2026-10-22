/**
 * L39 (bd-s1oo0.50.5, CONTRACT §21.6): battery v3 results and review, from ai-marks-v3 task rows.
 *
 *   visitSummary(lang, visit)      per child: one line per block (Urdu / English / Maths), one part per task;
 *                                  rates "/min", untimed "x/of", provisional "≈", skipped "skipped", gap omitted
 *   sendReview(coach, visit)       the results as text (split under 4096 code points, never inside a child), then
 *                                  review page 1: every review[] item, grouped child → task, ≤ 15 per page
 *   completion of page p           coach_marks (coach-marks-v2 generalised to tasks) + checked_at on that page's
 *                                  task rows; page p+1 follows; the last page says saved
 *
 * Real: review.js, review-v3.js, check-store, store.js, identity, the catalog. Mocked: the Supabase client,
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
const review = require('../../../bot/shared/services/child-test/check-flow/review');
const { handleCheckCompletion } = require('../../../bot/shared/services/child-test/check-flow');
const { detectFlowType } = require('../../../bot/shared/utils/flow-type-detector');
const F = require('./fixtures/marks-v3');
const itemBank = require('../../../bot/shared/services/child-test/item-bank');

// The printed item comes from the v3 bank (L35) by position; the fixture's own ref is only the fallback.
const bankItem = (task, i) => itemBank.getTaskSpec({ grade: 3, set: 'A', task }).items[i];
const bankQuestion = (task, id) => itemBank.getTaskSpec({ grade: 3, set: 'A', task }).questions.find((q) => q.id === id);

const VISIT = '11111111-1111-4111-8111-111111111111';
const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' };
const cps = (s) => [...s].length;

/** sessions: [{ id, name, tasks: { <task>: ai_marks | {pending} | {failed} | undefined } }] */
function seed(sessions, { lang = 'en' } = {}) {
  const rows = { sessions: [], students: [], blocks: [] };
  sessions.forEach((s, i) => {
    rows.sessions.push({
      id: s.id, coach_user_id: COACH.id, visit_id: VISIT, grade: 3, form: 'A', draw_id: `draw-${s.id}`,
      student_id: `stu-${s.id}`, status: 'completed', started_at: `2026-10-05T09:${String(10 + i)}:00.000Z`, timings: {},
    });
    rows.students.push({ id: `stu-${s.id}`, student_name: s.name, student_name_urdu: null });
    for (const [task, b] of Object.entries(s.tasks)) {
      if (b === undefined) continue;
      const row = { id: `blk-${s.id}-${task}`, session_id: s.id, block: task, checked_at: null, coach_marks: null };
      if (b.pending) Object.assign(row, { ai_marks: null, ai_status: 'scoring', ai_reason: 'attempt:1' });
      else if (b.failed) Object.assign(row, { ai_marks: null, ai_status: 'failed', ai_reason: 'final:no_audio' });
      else Object.assign(row, { ai_marks: b, ai_status: 'scored' });
      rows.blocks.push(row);
    }
  });
  mockFake = createFakeSupabase({
    users: [{ ...COACH, preferred_language: lang }],
    child_test_sessions: rows.sessions,
    child_test_draws: [],
    students: rows.students,
    child_test_blocks: rows.blocks,
  });
}
const row = (sid, task) => mockFake.__tables.child_test_blocks.find((r) => r.session_id === sid && r.block === task);
const flowCall = (n) => WhatsAppService.sendFlow.mock.calls[n][1];
function submitted(n, verdictsBySlot) {
  const msg = flowCall(n);
  const out = { child_test: 'review', flow_token: msg.flowToken, review_ref: msg.screenData.review_ref };
  for (let i = 1; i <= 15; i += 1) { out[`k${i}`] = msg.screenData[`i${i}_k`]; out[`r${i}`] = verdictsBySlot[i] || ''; }
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_REVIEW_FLOW_ID = 'review-flow-1';
  delete process.env.CHILD_TEST_CHECK_MODE;
});

const EN_CHILD = [
  '*Ayesha Khan*',
  'Urdu: listening 4/6 · letters ≈57/min · made-up ≈12/min · words 20/min · story 29/min, answers 3 of 4 asked (2 not reached)',
  'English: listening ≈3/6 · letters 31/min · made-up ≈6/min · words 14/min · story 22/min, answers 1 of 2 asked (1 not reached)',
  'Maths: number ID 14/min · bigger 7/10 · missing 5/10 · + 9/min · − 6/min · harder + 3/5 · harder − 2/5 · problems 4/6',
].join('\n');

describe('visitSummary (v3)', () => {
  test('English: one line per block, one part per task, the brief\'s example', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.child() }]);
    expect(await review.visitSummary('en', VISIT)).toBe(EN_CHILD);
  });

  test('Urdu: Urdu digits in the prose, the same parts', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.child() }]);
    const text = await review.visitSummary('ur', VISIT);
    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('اردو میں:');
    expect(lines[1]).toContain('سننا ۶ میں سے ۴');
    expect(lines[1]).toContain('حروف ≈۵۷ فی منٹ');
    expect(lines[1]).toContain('پوچھے گئے ۴ میں سے ۳ جواب درست');
    expect(lines[3]).toContain('حساب میں:');
    expect(lines[3]).toContain('مشکل جمع ۵ میں سے ۳');
    expect(text).not.toMatch(/[0-9]/);
  });

  test('a skipped task reads "skipped"; a gap task is left out; a task that failed to score says so; one never recorded is omitted', async () => {
    const tasks = F.weakChild();
    tasks['ur.nonwords'] = { version: 'ai-marks-v3', task: 'ur.nonwords', gap: true, items: [], review: [] };
    tasks['en.words'] = { failed: true };
    delete tasks['ma.word_problems'];
    seed([{ id: 's1', name: 'Bilal Ahmed', tasks }]);
    const text = await review.visitSummary('en', VISIT);
    expect(text).toContain('+ 0/min · − 6/min · harder + skipped · harder − 2/5');
    expect(text).not.toMatch(/made-up ≈12/);
    expect(text).toContain('words not scored');
    expect(text).not.toMatch(/problems/);
  });

  test('five children of eighteen tasks each fit; a long visit splits between children, every message ≤ 4096 code points', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Child Number ${i} With A Long Roster Name`, tasks: F.child() }));
    seed(many);
    const parts = await review.visitSummaryMessages('ur', VISIT);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(cps(p)).toBeLessThanOrEqual(4096);
      expect(p.split("\n")[0]).toMatch(/^\u200f?\*/);  // each message starts at a child (an Urdu line opens with RLM)
    }
    expect(parts.join('\n').split('\n')).toHaveLength(30 * 4);
  });
});

describe('review (v3)', () => {
  test('lists every review[] item, child → task in visit order, as the child saw it; provisional tasks never', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.child() }, { id: 's2', name: 'Bilal Ahmed', tasks: F.child() }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 10, pages: 1, summarySent: true });
    // results first, as text; then the Flow
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toContain('*Ayesha Khan*');
    const d = flowCall(0).screenData;
    const who = [1, 2, 3, 4, 5, 6].map((i) => d[`i${i}_who`]);
    expect(who).toEqual([
      'Ayesha Khan · Urdu listening',
      'Ayesha Khan · Urdu story',
      'Ayesha Khan · Maths which is bigger',
      'Ayesha Khan · Maths missing number',
      'Ayesha Khan · Maths word problems',
      'Bilal Ahmed · Urdu listening',
    ]);
    const q1 = bankQuestion('ur.listening', 'ur.listening.q6');
    expect(d.i1_q).toBe(`Question 6: ${q1.prompt}`);
    expect(d.i2_q).toBe(`Question 4: ${bankQuestion('ur.story', 'ur.story.q4').prompt}`);
    expect(d.i2_h).toBe('Heard: «پانی»');
    const cmp = bankItem('ma.discrimination', 2);
    expect(d.i3_q).toBe(`Which is bigger: ${cmp.a} or ${cmp.b}?`);
    expect(d.i3_h).toBe('Heard: nothing clear');
    const miss = bankItem('ma.missing', 7);
    expect(d.i4_q).toBe(`Missing number: ${miss.seq.map((x) => (x == null ? '_' : x)).join(', ')}`);
    expect(d.i5_q).toBe(`Problem 6: ${bankItem('ma.word_problems', 5).prompt_en}`);
    expect(d.i11_v).toBe(false);
    // en.listening (provisional) had review [6]: never asked
    expect(Object.values(d).join('\n')).not.toMatch(/English listening/);
    // rows with nothing to review are settled at once; rows under review are not
    expect(row('s1', 'ma.add1').coach_marks.meta.source).toBe('ai_unreviewed');
    expect(row('s1', 'ma.add1').checked_at).toBeTruthy();
    expect(row('s1', 'ma.discrimination').checked_at).toBeNull();
  });

  test('a sum reads "Sum 4: a + b", from the bank', async () => {
    const tasks = F.child();
    tasks['ma.add2'] = { ...tasks['ma.add2'], review: [4] };
    seed([{ id: 's1', name: 'Ayesha Khan', tasks }]);
    await review.sendReview(COACH.id, VISIT);
    const d = flowCall(0).screenData;
    const slot = [1, 2, 3, 4, 5, 6].find((i) => /harder/.test(d[`i${i}_who`]));
    expect(d[`i${slot}_who`]).toBe('Ayesha Khan · Maths harder +');
    const sum = bankItem('ma.add2', 3);
    expect(d[`i${slot}_q`]).toBe(`Sum 4: ${sum.a} + ${sum.b}`);
  });

  test('more than 15 items: pages of whole tasks; each page is its own Flow message, sent when the last is saved', async () => {
    const kids = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: `s${i}`, name: `Child ${n}`, tasks: F.child() }));
    seed(kids);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 25, pages: 2 });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const p1 = flowCall(0);
    expect(p1.header).toMatch(/1\/2/);
    expect(p1.screenData.heading).toMatch(/1\/2/);
    const filled = Object.keys(p1.screenData).filter((k) => /^i\d+_v$/.test(k) && p1.screenData[k]).length;
    expect(filled).toBe(15);                                   // 3 children × 5 items, whole tasks

    const done = await handleCheckCompletion(submitted(0, { 3: 'correct' }), COACH.phone_number, COACH);
    expect(done).toMatchObject({ ok: true, review: true, page: 1, pages: 2 });
    expect(row('s0', 'ma.discrimination').checked_at).toBeTruthy();
    expect(row('s3', 'ma.discrimination').checked_at).toBeNull();
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(2);
    expect(flowCall(1).header).toMatch(/2\/2/);
    expect(detectFlowType(submitted(1, {}))).toBe('child_test_check');

    WhatsAppService.sendMessage.mockClear();
    const last = await handleCheckCompletion(submitted(1, {}), COACH.phone_number, COACH);
    expect(last).toMatchObject({ ok: true, page: 2, pages: 2 });
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(2);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/Saved/);
    expect(mockFake.__tables.child_test_blocks.every((b) => b.checked_at)).toBe(true);
  });

  test('on save: coach_marks per task row, the verdict replaced, the score recomputed, the edit listed; ai_marks untouched', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.child() }]);
    await review.sendReview(COACH.id, VISIT);
    // slot 3 = which is bigger item 3 (AI: none) → Right; slot 2 = story q4 (AI: wrong) → Right; slot 1 left blank
    const r = await handleCheckCompletion(submitted(0, { 2: 'correct', 3: 'correct' }), COACH.phone_number, COACH);
    expect(r.ok).toBe(true);
    const d = row('s1', 'ma.discrimination');
    expect(d.coach_marks.version).toBe('coach-marks-v2');
    expect(d.coach_marks.items[2].verdict).toBe('correct');
    expect(d.coach_marks.score).toEqual({ correct: 8, of: 10 });
    expect(d.coach_marks.meta).toMatchObject({ source: 'review', task: 'ma.discrimination', reviewed: ['items[2].verdict'] });
    expect(d.coach_edits).toEqual([{ path: 'items[2].verdict', ai: 'none', coach: 'correct' }]);
    expect(d.ai_marks.items[2].verdict).toBe('none');
    expect(d.checked_at).toBeTruthy();
    const s = row('s1', 'ur.story');
    expect(s.coach_marks.comprehension[3].verdict).toBe('correct');
    expect(s.coach_marks.score).toMatchObject({ correct: 4, asked: 4 });
    expect(s.coach_edits).toEqual([{ path: 'comprehension[ur.story.q4].verdict', ai: 'wrong', coach: 'correct' }]);
    const l = row('s1', 'ur.listening');
    expect(l.coach_marks.meta.unanswered).toEqual(['items[5].verdict']);
    expect(l.coach_edits).toEqual([]);
    expect(row('s1', 'ur.letters').coach_marks.meta.source).toBe('ai_unreviewed');
    expect(mockFake.__tables.child_test_blocks.every((b) => b.checked_at)).toBe(true);

    WhatsAppService.sendMessage.mockClear();
    const again = await handleCheckCompletion(submitted(0, { 2: 'wrong' }), COACH.phone_number, COACH);
    expect(again).toMatchObject({ saved: 0 });
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toBe('These answers were saved earlier. Nothing was changed.');
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
  });

  test('nothing to review: the results go as text, every task row is settled, no Flow', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.settledChild() }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r).toMatchObject({ ok: true, items: 0, summarySent: true });
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toBe(EN_CHILD);
    expect(mockFake.__tables.child_test_blocks).toHaveLength(18);
    expect(mockFake.__tables.child_test_blocks.every((b) => b.checked_at && b.coach_marks.meta.source === 'ai_unreviewed')).toBe(true);
  });

  test('a task still scoring holds the review back', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: { ...F.child(), 'ma.sub2': { pending: true } } }]);
    expect(await review.sendReview(COACH.id, VISIT)).toMatchObject({ ok: false, reason: 'scoring_pending', pending: 1 });
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a task with more than 15 items to review keeps the 15 least sure; the rest stay AI-only', async () => {
    const tasks = F.child();
    const n = tasks['ma.number_id'];
    n.review = n.items.map((x) => x.i);                       // all 20; 16 were reached (items after 16 are never asked)
    n.items.forEach((x, i) => { x.conf = i / 100; });
    seed([{ id: 's1', name: 'Ayesha Khan', tasks }]);
    const r = await review.sendReview(COACH.id, VISIT);
    expect(r.items).toBe(5 + 15);
    expect(r.pages).toBe(3);                                  // [listening, story] [number ID ×15] [the rest]: whole tasks
    for (let p = 0; p < 3; p += 1) await handleCheckCompletion(submitted(p, {}), COACH.phone_number, COACH);
    expect(row('s1', 'ma.number_id').coach_marks.meta.ai_only).toEqual(['items[15].verdict']);
  });
});

describe('review (v3), Urdu coach', () => {
  test('the slot heading reads "<child> کا حصہ: <block>، <task>", Urdu digits in the item', async () => {
    seed([{ id: 's1', name: 'Ayesha Khan', tasks: F.child() }], { lang: 'ur' });
    await review.sendReview(COACH.id, VISIT);
    const d = flowCall(0).screenData;
    expect(d.i3_who).toContain('کا حصہ: حساب، بڑا نمبر');
    expect(d.i3_q).toMatch(/^کون سا نمبر بڑا ہے: [۰-۹]+ یا [۰-۹]+؟$/);
    expect(d.heading).toBe('یہ جواب چیک کریں');
  });
});
