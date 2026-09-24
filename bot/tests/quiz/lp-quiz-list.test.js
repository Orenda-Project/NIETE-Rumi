'use strict';
/**
 * R8 lane D task 3.4 — ONE list in /quiz (PLAN_R8 D11).
 *
 * The /quiz list message enumerated coaching sessions and joined each to its
 * transcript quiz. A quiz written from a lesson PLAN (`quiz_source='lp_v8'`)
 * has no session, so it could never appear — the teacher would be handed a quiz
 * at 15:00 and then find no trace of it in /quiz. Now the list is the union:
 * every lp_v8 quiz of the teacher, plus every eligible coaching session, one
 * sort by date (the lesson date for lp_v8, the session's own date otherwise).
 *
 * The supabase stub applies eq/is/in/range as real filters (the idiom in
 * transcript-quiz-flow-endpoint.test.js), so a query that forgets the owner
 * filter fails here.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const SQS = require('../../shared/services/queue/sqs-queue.service');
const { UX_STRINGS } = require('../../shared/config/ux-strings');
const List = require('../../shared/services/quiz/transcript-quiz-list.service');

const TEACHER = 'teacher-1';
const OTHER = 'teacher-2';
const cp = (s) => [...String(s || '')].length;

function makeChain(rows, writes) {
  let data = [...(rows || [])];
  let desc = false;
  let orderKey = null;
  const sortNow = () => {
    if (!orderKey) return;
    data = [...data].sort((a, b) => {
      const av = new Date(a[orderKey]).getTime();
      const bv = new Date(b[orderKey]).getTime();
      return desc ? bv - av : av - bv;
    });
  };
  const chain = {
    select: () => chain,
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    is: (f, v) => { data = data.filter((r) => (v === null ? r[f] == null : r[f] === v)); return chain; },
    in: (f, vs) => { data = data.filter((r) => vs.includes(r[f])); return chain; },
    order: (f, opts) => { orderKey = f; desc = opts && opts.ascending === false; return chain; },
    range: (from, to) => { sortNow(); data = data.slice(from, to + 1); return chain; },
    limit: (n) => { sortNow(); data = data.slice(0, n); return chain; },
    update: (patch) => { writes.push({ op: 'update', patch }); return chain; },
    insert: (row) => { writes.push({ op: 'insert', row }); data = [{ id: 'new-quiz', ...row }]; return chain; },
    single: async () => ({ data: data[0] || null, error: null }),
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}
let writes;
function stub(tables) {
  writes = [];
  supabase.from.mockImplementation((t) => makeChain(tables[t] || [], writes));
}

const session = (day, extra = {}) => ({
  id: `s-${day}`, user_id: TEACHER, status: 'completed', observation_type: null,
  created_at: `2026-09-${String(day).padStart(2, '0')}T05:00:00Z`, transcript_text: 'x'.repeat(4000),
  analysis_data: { topic: `Recorded lesson ${day}`, subject: 'science' }, ...extra,
});
const lpQuiz = (day, extra = {}) => ({
  id: `lpq-${day}`, teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8',
  status: 'sent', topic: `Planned lesson ${day}`, subject: 'maths', language: 'en',
  created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`,
  meta: { lesson_date: `2026-09-${String(day).padStart(2, '0')}`, share_code_id: `sc-${day}`, student_message: 'forward me' },
  ...extra,
});
const USER = { id: TEACHER, preferred_language: 'en' };
const users = [{ id: TEACHER, phone_number: '923001112222', preferred_language: 'en' }];
const listRows = () => WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;

beforeEach(() => jest.clearAllMocks());

describe('buildRows — the union', () => {
  test('an lp_v8 quiz is a row `date · subject` / `topic · status`, newest-first among the coaching lessons', () => {
    const { rows, total } = List.buildRows([session(20), session(18)], [lpQuiz(19)], 'en');
    expect(total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_s-20', 'tq_pick_lp_lpq-19', 'tq_pick_s-18']);
    const lp = rows[1];
    expect(lp.title).toMatch(/^19 Sep · /);
    expect(lp.description).toMatch(/^Planned lesson 19 · /);
    rows.forEach((r) => { expect(cp(r.title)).toBeLessThanOrEqual(24); expect(cp(r.description)).toBeLessThanOrEqual(72); });
  });

  test('a lesson quiz on a coaching session is still joined to that session, not listed twice', () => {
    const tq = { id: 'tq-1', coaching_session_id: 's-20', quiz_source: 'transcript', status: 'sent', topic: 'Circuits' };
    const { rows } = List.buildRows([session(20)], [tq], 'en');
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_s-20']);
  });

  test('paging counts both kinds: 9 per page and an Older row', () => {
    const sessions = [1, 3, 5, 7, 9, 11].map((d) => session(d));
    const lps = [2, 4, 6, 8, 10].map((d) => lpQuiz(d));
    const p1 = List.buildRows(sessions, lps, 'en', { page: 1 });
    expect(p1.total).toBe(11);
    expect(p1.rows).toHaveLength(10);
    expect(p1.rows[9].id).toBe('tq_page_2');
    const p2 = List.buildRows(sessions, lps, 'en', { page: 2 });
    expect(p2.rows.map((r) => r.id)).toEqual(['tq_pick_lp_lpq-2', 'tq_pick_s-1']);
  });
});

describe('showList', () => {
  test('the /quiz list message carries the teacher’s lp_v8 quizzes — and never another teacher’s', async () => {
    stub({
      users,
      coaching_sessions: [session(20)],
      quizzes: [lpQuiz(21), lpQuiz(19, { id: 'lpq-other', teacher_id: OTHER })],
      quiz_sessions: [],
    });
    await List.showList(USER, '923001112222', 'en', 1);
    expect(listRows().map((r) => r.id)).toEqual(['tq_pick_lp_lpq-21', 'tq_pick_s-20']);
  });

  test('a teacher whose only lessons are lp_v8 quizzes gets the list, not "no lessons yet"', async () => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21)], quiz_sessions: [] });
    await List.showList(USER, '923001112222', 'en', 1);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(listRows()[0].id).toBe('tq_pick_lp_lpq-21');
    expect(await List.hasEligibleLessons(TEACHER)).toBe(true);
  });

  test('a coaching session without a quiz still appears', async () => {
    stub({ users, coaching_sessions: [session(20)], quizzes: [lpQuiz(21)], quiz_sessions: [] });
    await List.showList(USER, '923001112222', 'en', 1);
    expect(listRows().map((r) => r.id)).toContain('tq_pick_s-20');
  });

  test('video and in-chat-preview quizzes never enter the list', async () => {
    stub({
      users, coaching_sessions: [],
      quizzes: [lpQuiz(21, { id: 'v-1', quiz_source: 'video' }), lpQuiz(20, { id: 'p-1', quiz_source: 'in_chat_preview' })],
      quiz_sessions: [],
    });
    await List.showList(USER, '923001112222', 'en', 1);
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
  });
});

describe('handleListPick on an lp_v8 row', () => {
  test('a sent lp_v8 quiz answers with Resend link / Generate report / Back — no coaching session is read', async () => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21)], quiz_sessions: [] });
    const handled = await List.handleListPick('tq_pick_lp_lpq-21', '923001112222', USER);
    expect(handled).toBe(true);
    const call = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(call.buttons.map((b) => b.id)).toEqual(['tq_link_lpq-21', 'tq_report_lpq-21', 'tq_back_lpq-21']);
    expect(call.body).toContain('Planned lesson 21');
    expect(call.body).toContain('21 Sep');
    expect(supabase.from.mock.calls.map((c) => c[0])).not.toContain('coaching_sessions');
  });

  test('another teacher’s lp_v8 quiz is not yours', async () => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21, { teacher_id: OTHER })], quiz_sessions: [] });
    await List.handleListPick('tq_pick_lp_lpq-21', '923001112222', USER);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS.tqNotYours.en);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('an lp_v8 quiz still being written says so, and nothing is re-queued', async () => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21, { status: 'generating' })], quiz_sessions: [] });
    await List.handleListPick('tq_pick_lp_lpq-21', '923001112222', USER);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS.tqStillMaking.en);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  // The afternoon offer's yes on any subject but Urdu/Islamiyat leaves the row
  // `offered` at `awaiting_language` until the teacher taps a language. A
  // teacher who ignored that ask and opened /quiz later saw "Offered — tap to
  // make", tapped, and was told "That quiz is still being made" — while nothing
  // was queued and nothing ever would be.
  const WAIT_ID = 'a1b2c3d4-0000-4000-8000-00000000abcd';
  const waiting = () => lpQuiz(21, {
    id: WAIT_ID, status: 'offered', language: null,
    meta: { step: 'awaiting_language', awaiting_language: true, source: 'lp_offer', nudge_id: 'nudge-1', lesson_date: '2026-09-21' },
  });

  test('an lp_v8 quiz still waiting for its language re-sends the language ask — never "still being made"', async () => {
    stub({ users, coaching_sessions: [], quizzes: [waiting()], quiz_sessions: [] });
    await List.handleListPick(`tq_pick_lp_${WAIT_ID}`, '923001112222', USER);

    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith('923001112222', UX_STRINGS.tqStillMaking.en);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const ask = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(ask.body).toBe(UX_STRINGS.tqAskLanguage.en);
    // The subject rule (maths → Urdu) is the first, easy tap — as on the offer.
    expect(ask.buttons.map((b) => b.id)).toEqual([`tq_lang_ur_${WAIT_ID}`, `tq_lang_en_${WAIT_ID}`]);
    // Nothing is made until the teacher answers.
    expect(SQS.queueJob).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  test('answering the re-sent ask makes it: generating in the chosen language, the LP quiz job queued', async () => {
    stub({ users, coaching_sessions: [], quizzes: [waiting()], quiz_sessions: [] });
    await List.handleListPick(`tq_pick_lp_${WAIT_ID}`, '923001112222', USER);
    const [englishButton] = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons
      .filter((b) => b.id.startsWith('tq_lang_en_'));

    const Offer = require('../../shared/services/quiz/transcript-quiz-offer.service');
    await Offer.handleLanguageButton(englishButton.id, '923001112222', USER);

    expect(writes).toContainEqual({
      op: 'update', patch: expect.objectContaining({ status: 'generating', language: 'en' }),
    });
    expect(SQS.queueJob).toHaveBeenCalledWith(
      WAIT_ID, 'quiz_generate', expect.objectContaining({ quizId: WAIT_ID, source: 'lp_offer' }), expect.anything(),
    );
  });

  test('a failed lp_v8 quiz names the step that stopped it, and never offers to make it from a session', async () => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21, { status: 'failed', meta: { error: 'source_missing', lesson_date: '2026-09-21' } })], quiz_sessions: [] });
    await List.handleListPick('tq_pick_lp_lpq-21', '923001112222', USER);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS.tqFailedLpSource.en);
    expect(writes).toEqual([]);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  // The persisted reason decides the sentence /quiz repeats: a quiz the MODEL
  // failed is never re-described as a lesson plan that could not be read.
  test.each([
    ['model_failed', 'tqFailedLpModel'],
    ['source_unusable', 'tqFailedLpSourceUnusable'],
    ['validator_failed', 'tqFailedLpAuthor'],
    // Rows written before the split carry `digest: <what the digest threw>`.
    ['digest: lp_quiz.digest: empty reply from google/gemini-2.5-flash', 'tqFailedLpModel'],
    ['digest: 429 Rate limit reached for requests', 'tqFailedLpModel'],
    ['digest: lp digest: the slide script carries no lesson to digest', 'tqFailedLpSourceUnusable'],
  ])('a failed lp_v8 quiz with meta.error %j repeats %s', async (error, key) => {
    stub({ users, coaching_sessions: [], quizzes: [lpQuiz(21, { status: 'failed', meta: { error, lesson_date: '2026-09-21' } })], quiz_sessions: [] });
    await List.handleListPick('tq_pick_lp_lpq-21', '923001112222', USER);
    expect(UX_STRINGS[key]).toBeDefined();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('923001112222', UX_STRINGS[key].en);
    expect(writes).toEqual([]);
  });
});
