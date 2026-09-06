'use strict';
/**
 * bd-mg9c7.17 — /quiz lists the teacher's recent lessons with the state of
 * each quiz, and a tap either makes one, resends the link, or fetches the
 * report.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-report.service', () => ({ generate: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { installFrom } = require('./helpers/supabase-chain');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');

const cp = (s) => [...String(s)].length;
const S = (i, over = {}) => ({
  id: `sess-${i}`, created_at: `2026-09-0${i}T05:00:00Z`, transcript_text: 'x'.repeat(3000),
  analysis_data: { topic: `Topic number ${i} which is rather long indeed`, subject: 'Maths' }, ...over,
});
const USER = { id: 'u-1', preferred_language: 'ur' };

beforeEach(() => { jest.clearAllMocks(); process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; });

describe('isQuizCommand', () => {
  test.each(['/quiz', '/quiz fractions', 'quiz', 'Quiz', 'کوئز'])('%s → true', (t) => expect(List.isQuizCommand(t)).toBe(true));
  test.each(['quizzes please', 'I want a quiz', '/quizx', ''])('%s → false', (t) => expect(List.isQuizCommand(t)).toBe(false));
});

describe('buildRows', () => {
  test('rows are newest first, at most 9 lesson rows on page 1, titles ≤24 and descriptions ≤72 code points, status per row', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => S(i));
    const quizzes = [
      { id: 'q9', coaching_session_id: 'sess-9', status: 'sent', meta: { started: 3, finished: 1 } },
      { id: 'q8', coaching_session_id: 'sess-8', status: 'report_sent' },
      { id: 'q7', coaching_session_id: 'sess-7', status: 'declined' },
    ];
    const { rows, total, hasMore } = List.buildRows(sessions, quizzes, 'ur');
    expect(rows).toHaveLength(9);
    expect(total).toBe(9);
    expect(hasMore).toBe(false);
    expect(rows[0].id).toBe('tq_pick_sess-9');
    rows.forEach((r) => { expect(cp(r.title)).toBeLessThanOrEqual(24); expect(cp(r.description)).toBeLessThanOrEqual(72); });
    // These fixture topics are 41 code points and Latin inside an Urdu row, so
    // they cost 2 more for the bidi isolates: 41 + 2 + 3 + a 20-plus-code-point
    // Urdu status is over 72 and the STATUS gives, never the topic. On real
    // data (62 seeded lessons × 6 statuses × 2 languages = 744 renders) that
    // happens exactly once — see transcript-quiz-rows.test.js.
    rows.forEach((r) => expect(r.description).toMatch(/Topic number \d+ which is rather long indeed/));
    const short = List.buildRows(
      [S(9, { analysis_data: { topic: 'کسریں', subject: 'Maths' } }),
       S(8, { analysis_data: { topic: 'اشکال', subject: 'Maths' } }),
       S(7, { analysis_data: { topic: 'اعداد', subject: 'Maths' } })],
      quizzes, 'ur',
    ).rows;
    expect(short[0].description).toMatch(/3/);          // started count surfaces
    expect(short[1].description).toMatch(/رپورٹ/);      // report sent, in Urdu
    expect(short[2].description).toMatch(/[؀-ۿ]/);   // no quiz yet, in Urdu
  });

  test('a thin transcript is left out even when a quiz row already points at it', () => {
    // The offer gate is 1,500 characters; a shorter lesson can only fail at
    // generate, so listing it sells the teacher a tap that cannot work.
    const { rows } = List.buildRows(
      [S(1, { transcript_text: 'short' }), S(2)],
      [{ id: 'q1', coaching_session_id: 'sess-1', status: 'failed' }],
      'en',
    );
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_sess-2']);
  });

  test('the rows are newest first whatever order the query returned them in', () => {
    const { rows } = List.buildRows([S(3), S(1), S(5), S(2)], [], 'en');
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_sess-5', 'tq_pick_sess-3', 'tq_pick_sess-2', 'tq_pick_sess-1']);
  });

  test('9 eligible lessons → 9 rows, no older row', () => {
    const { rows, hasMore } = List.buildRows([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => S(i)), [], 'en');
    expect(rows).toHaveLength(9);
    expect(hasMore).toBe(false);
    expect(rows.some((r) => r.id.startsWith('tq_page_'))).toBe(false);
  });

  const fourteen = () => Array.from({ length: 14 }, (_, i) => ({ ...S(1), id: `sess-${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T05:00:00Z` }));

  test('page 1 of 14 eligible lessons → 10 rows, the 10th is tq_page_2 titled with tqRowOlder', () => {
    const { rows, page, from, to, total, hasMore } = List.buildRows(fourteen(), [], 'en');
    expect(rows).toHaveLength(10);
    expect(page).toBe(1);
    expect(from).toBe(1);
    expect(to).toBe(9);
    expect(total).toBe(14);
    expect(hasMore).toBe(true);
    expect(rows[9].id).toBe('tq_page_2');
    expect(rows[0].id).toBe('tq_pick_sess-13');
    expect(rows[8].id).toBe('tq_pick_sess-5');
  });

  test('page 2 of 14 → 5 lesson rows and NO older row; from/to are 10 and 14', () => {
    const { rows, from, to, hasMore } = List.buildRows(fourteen(), [], 'en', { page: 2 });
    expect(rows).toHaveLength(5);
    expect(from).toBe(10);
    expect(to).toBe(14);
    expect(hasMore).toBe(false);
    expect(rows.some((r) => r.id.startsWith('tq_page_'))).toBe(false);
    expect(rows[0].id).toBe('tq_pick_sess-4');
    expect(rows[4].id).toBe('tq_pick_sess-0');
  });

  test('the row TITLE names the subject (date · subject); the DESCRIPTION always carries the topic in full', () => {
    const sessions = [S(1, { analysis_data: { topic: 'Fractions', subject: 'Maths' } })];
    const quizzes = [{ id: 'q1', coaching_session_id: 'sess-1', status: 'sent', subject: 'maths', topic: 'کسریں', meta: { started: 2, finished: 1 } }];
    const { rows } = List.buildRows(sessions, quizzes, 'en');
    expect(rows[0].title).toMatch(/Mathematics/);
    expect(rows[0].description).toContain('کسریں');
    expect(cp(rows[0].title)).toBeLessThanOrEqual(24);
    expect(cp(rows[0].description)).toBeLessThanOrEqual(72);
    const { rows: urRows } = List.buildRows(sessions, quizzes, 'ur');
    expect(urRows[0].title).toMatch(/ریاضی/);
    expect(urRows[0].description).toContain('کسریں');
    expect(cp(urRows[0].description)).toBeLessThanOrEqual(72);
  });

  test('a lesson whose subject is unknown still gets a clean title and description', () => {
    const { rows } = List.buildRows([S(1, { analysis_data: { topic: 'Shapes' } })], [], 'en');
    expect(rows[0].title).not.toMatch(/other|undefined|null/i);
    expect(rows[0].description).not.toMatch(/other|undefined|null/i);
  });

  test('a lesson with a thin transcript is left out', () => {
    const { rows } = List.buildRows([S(1, { transcript_text: 'short' }), S(2)], [], 'en');
    expect(rows).toHaveLength(1);
  });

  test('a long topic name appears in full in the description, and is not in the title', () => {
    const long = 'Fractions and Their Types';   // 25 code points, longer than the 24-cp title cap
    const sessions = [S(1, { analysis_data: { topic: long, subject: 'Maths' } })];
    const { rows } = List.buildRows(sessions, [], 'en');
    expect(rows[0].description).toContain(long);
    expect(rows[0].title).not.toContain(long);
    expect(cp(rows[0].title)).toBeLessThanOrEqual(24);
  });
});

describe('showList', () => {
  test('sends an interactive list in the teacher language, headed with the range', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [S(1), S(2)] },
      quizzes: { data: [] },
    }));
    await List.showList(USER, '923001234567', 'ur');
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    expect(payload.action.sections[0].rows).toHaveLength(2);
    expect(payload.body.text).toMatch(/[؀-ۿ]/);
    expect(cp(payload.action.button)).toBeLessThanOrEqual(20);
    // She is told the range these are, so a missing older lesson reads as
    // the list being paged rather than the lesson being lost. The 10-cap
    // promise moved out of the body — it no longer names a fixed number.
    expect(payload.body.text).not.toMatch(/\b10\b/);
    expect(payload.header.text).toMatch(/1.*2|1–2/);
    expect(logEvent).toHaveBeenCalledWith('transcript_quiz.list_shown', expect.objectContaining({ page: 1 }));
  });

  test('with no lessons yet, explains in the teacher language', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [] }, quizzes: { data: [] } }));
    await List.showList(USER, '923001234567', 'en');
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/lesson/i);
  });
});

describe('loadEligibleSessions', () => {
  test('stops at MAX_FETCHES rather than looping forever when every batch is full', async () => {
    const fullBatch = Array.from({ length: 25 }, (_, i) => S(i));
    installFrom(supabase.from, { coaching_sessions: { data: fullBatch } });
    const { sessions, exhausted } = await List.loadEligibleSessions('u-1', 1000);
    expect(sessions).toHaveLength(8 * 25);
    expect(exhausted).toBe(false);
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'coaching_sessions')).toHaveLength(8);
  });

  test('stops as soon as a short batch shows the table is exhausted', async () => {
    installFrom(supabase.from, { coaching_sessions: { data: [S(1), S(2), S(3)] } });
    const { sessions, exhausted } = await List.loadEligibleSessions('u-1', 100);
    expect(sessions).toHaveLength(3);
    expect(exhausted).toBe(true);
    expect(supabase.from.mock.calls.filter((c) => c[0] === 'coaching_sessions')).toHaveLength(1);
  });
});

describe('handleListPick — paging', () => {
  test("tq_page_2 shows page 2, with a range call that reaches past the first 9", async () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => ({ ...S(1), id: `sess-${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T05:00:00Z` }));
    installFrom(supabase.from, ({
      coaching_sessions: { data: fourteen },
      quizzes: { data: [] },
    }));
    expect(await List.handleListPick('tq_page_2', '923001234567', USER)).toBe(true);
    const rangeCalls = supabase.from.callsFor('coaching_sessions')[0].filter((c) => c[0] === 'range');
    expect(rangeCalls.length).toBeGreaterThan(0);
    expect(rangeCalls[0][2]).toBeGreaterThanOrEqual(9);   // the end of the fetched window
    const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    expect(payload.action.sections[0].rows).toHaveLength(5);
    expect(payload.action.sections[0].rows[0].id).toBe('tq_pick_sess-4');
  });

  test('a page id ≤ 0 or unparseable falls back to page 1', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [S(1)] }, quizzes: { data: [] } }));
    expect(await List.handleListPick('tq_page_0', '923001234567', USER)).toBe(true);
    let payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    expect(payload.action.sections[0].rows).toHaveLength(1);

    jest.clearAllMocks();
    installFrom(supabase.from, ({ coaching_sessions: { data: [S(1)] }, quizzes: { data: [] } }));
    expect(await List.handleListPick('tq_page_nonsense', '923001234567', USER)).toBe(true);
    payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    expect(payload.action.sections[0].rows).toHaveLength(1);
  });
});

describe('handleListPick', () => {
  test('a lesson with no quiz yet: claims a row and asks which language before generating', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [S(1, { user_id: 'u-1', observation_type: null, status: 'completed' })] },
      quizzes: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: [{ id: 'q-new' }] } : { data: [] }),
      users: { data: [USER] },
    }));
    expect(await List.handleListPick('tq_pick_sess-1', '923001234567', USER)).toBe(true);
    // Generation waits for her answer — see transcript-quiz-language-ask.test.js.
    expect(SQS.queueJob).not.toHaveBeenCalled();
    const [, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(payload.buttons.map((b) => b.id)).toEqual(['tq_lang_ur_q-new', 'tq_lang_en_q-new']);
  });

  test('a quiz already sent: offers resend-link and report buttons', async () => {
    installFrom(supabase.from, ({
      coaching_sessions: { data: [S(1, { user_id: 'u-1' })] },
      quizzes: { data: [{ id: 'q1', status: 'sent', coaching_session_id: 'sess-1', meta: { share_code_id: 'sc-1' } }] },
      quiz_sessions: { data: [{ quiz_id: 'q1', status: 'completed' }, { quiz_id: 'q1', status: 'in_progress' }] },
      users: { data: [USER] },
    }));
    expect(await List.handleListPick('tq_pick_sess-1', '923001234567', USER)).toBe(true);
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.buttons.map((b) => b.id)).toEqual(['tq_link_q1', 'tq_report_q1', 'tq_back_q1']);
    expect(opts.body).toMatch(/2/);   // started
  });

  test('a session that is not the teacher’s own is refused', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [] }, users: { data: [USER] } }));
    expect(await List.handleListPick('tq_pick_sess-1', '923001234567', USER)).toBe(true);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });
});

describe('handleActionButton', () => {
  test('tq_link_ runs the whole hand-off again — the PDF, then the SAME message', async () => {
    const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
    const spy = jest.spyOn(Handoff, 'sendHandoff').mockResolvedValue({ ok: true, code: 'ABC234', pdfSent: true, reused: true });
    installFrom(supabase.from, ({
      quizzes: { data: [{ id: 'q1', teacher_id: 'u-1', status: 'sent', language: 'ur', topic: 'کسریں', meta: { share_code: 'ABC234', share_code_id: 'sc-1', student_message: 'FORWARD ME QUIZ-ABC234' } }] },
      users: { data: [USER] },
    }));
    expect(await List.handleActionButton('tq_link_q1', '923001234567')).toBe(true);
    expect(spy).toHaveBeenCalledWith('q1', '923001234567', { firstSend: false });
    spy.mockRestore();
  });

  test('tq_report_ asks the report service for the report now', async () => {
    installFrom(supabase.from, ({
      quizzes: { data: [{ id: 'q1', teacher_id: 'u-1', status: 'sent', language: 'ur', meta: { share_code_id: 'sc-1' } }] },
      users: { data: [USER] },
    }));
    expect(await List.handleActionButton('tq_report_q1', '923001234567')).toBe(true);
    expect(Report.generate).toHaveBeenCalledWith('sc-1', expect.objectContaining({ reason: 'requested', force: true }));
  });
});
