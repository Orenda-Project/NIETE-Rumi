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
  test('rows are newest first, at most 10, titles ≤24 and descriptions ≤72 code points, status per row', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => S(i));
    const quizzes = [
      { id: 'q9', coaching_session_id: 'sess-9', status: 'sent', meta: { started: 3, finished: 1 } },
      { id: 'q8', coaching_session_id: 'sess-8', status: 'report_sent' },
      { id: 'q7', coaching_session_id: 'sess-7', status: 'declined' },
    ];
    const rows = List.buildRows(sessions, quizzes, 'ur');
    expect(rows).toHaveLength(9);
    expect(rows[0].id).toBe('tq_pick_sess-9');
    rows.forEach((r) => { expect(cp(r.title)).toBeLessThanOrEqual(24); expect(cp(r.description)).toBeLessThanOrEqual(72); });
    expect(rows[0].description).toMatch(/3/);          // started count surfaces
    expect(rows[1].description).toMatch(/رپورٹ/);      // report sent, in Urdu
    expect(rows[3].description).toMatch(/[؀-ۿ]/);   // no quiz yet, in Urdu
  });

  test('a thin transcript is left out even when a quiz row already points at it', () => {
    // The offer gate is 1,500 characters; a shorter lesson can only fail at
    // generate, so listing it sells the teacher a tap that cannot work.
    const rows = List.buildRows(
      [S(1, { transcript_text: 'short' }), S(2)],
      [{ id: 'q1', coaching_session_id: 'sess-1', status: 'failed' }],
      'en',
    );
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_sess-2']);
  });

  test('the rows are newest first whatever order the query returned them in', () => {
    const rows = List.buildRows([S(3), S(1), S(5), S(2)], [], 'en');
    expect(rows.map((r) => r.id)).toEqual(['tq_pick_sess-5', 'tq_pick_sess-3', 'tq_pick_sess-2', 'tq_pick_sess-1']);
  });

  test('never more than the 10 WhatsApp allows, and it is the 10 most recent', () => {
    const rows = List.buildRows([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => S(i)), [], 'en');
    expect(rows).toHaveLength(9);
    const many = List.buildRows(
      Array.from({ length: 14 }, (_, i) => ({ ...S(1), id: `sess-${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T05:00:00Z` })),
      [], 'en',
    );
    expect(many).toHaveLength(10);
    expect(many[0].id).toBe('tq_pick_sess-13');
    expect(many[9].id).toBe('tq_pick_sess-4');
  });

  test('the row description names the subject so the list is not eight identical dates', () => {
    const sessions = [S(1, { analysis_data: { topic: 'Fractions', subject: 'Maths' } })];
    const quizzes = [{ id: 'q1', coaching_session_id: 'sess-1', status: 'sent', subject: 'maths', topic: 'کسریں', meta: { started: 2, finished: 1 } }];
    const rows = List.buildRows(sessions, quizzes, 'en');
    expect(rows[0].description).toMatch(/Mathematics/);
    expect(cp(rows[0].description)).toBeLessThanOrEqual(72);
    const ur = List.buildRows(sessions, quizzes, 'ur');
    expect(ur[0].description).toMatch(/ریاضی/);
    expect(cp(ur[0].description)).toBeLessThanOrEqual(72);
  });

  test('a lesson whose subject is unknown still gets a clean description', () => {
    const rows = List.buildRows([S(1, { analysis_data: { topic: 'Shapes' } })], [], 'en');
    expect(rows[0].description).not.toMatch(/other|undefined|null/i);
  });

  test('a lesson with a thin transcript is left out', () => {
    const rows = List.buildRows([S(1, { transcript_text: 'short' }), S(2)], [], 'en');
    expect(rows).toHaveLength(1);
  });
});

describe('showList', () => {
  test('sends an interactive list in the teacher language', async () => {
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
    // She is told these are the most recent ones, so a missing older lesson
    // reads as the list being capped rather than the lesson being lost.
    expect(payload.body.text).toMatch(/10/);
  });

  test('with no lessons yet, explains in the teacher language', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [] }, quizzes: { data: [] } }));
    await List.showList(USER, '923001234567', 'en');
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/lesson/i);
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
    expect(opts.buttons.map((b) => b.id)).toEqual(['tq_link_q1', 'tq_report_q1']);
    expect(opts.body).toMatch(/2/);   // started
  });

  test('a session that is not the teacher’s own is refused', async () => {
    installFrom(supabase.from, ({ coaching_sessions: { data: [] }, users: { data: [USER] } }));
    expect(await List.handleListPick('tq_pick_sess-1', '923001234567', USER)).toBe(true);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });
});

describe('handleActionButton', () => {
  test('tq_link_ resends the forwardable message', async () => {
    installFrom(supabase.from, ({
      quizzes: { data: [{ id: 'q1', teacher_id: 'u-1', status: 'sent', language: 'ur', topic: 'کسریں', meta: { share_code: 'ABC234', student_message: 'FORWARD ME QUIZ-ABC234' } }] },
      users: { data: [USER] },
    }));
    expect(await List.handleActionButton('tq_link_q1', '923001234567')).toBe(true);
    expect(WhatsAppService.sendMessage.mock.calls.some((c) => /QUIZ-ABC234/.test(c[1]))).toBe(true);
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
